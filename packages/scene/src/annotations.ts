/**
 * Design annotations — the canonical, durable model.
 *
 * Annotations used to live only in React state inside the Spec Panel, keyed by
 * a local counter starting at 1 (`annot-1`, `annot-2`, …). Three consequences
 * that this module exists to remove:
 *
 *   - they vanished when the panel unmounted, so a handoff note could not
 *     survive closing a panel, let alone reopening the document;
 *   - the local counter collided across documents, because every document
 *     restarted at `annot-1`;
 *   - no other surface could read them (export, duplication, revision
 *     history), because they were not part of the document at all.
 *
 * Three decisions shape the model:
 *
 * 1. **Keyed by annotation id at the document's top level**, not nested under
 *    the anchored node. `packages/history/src/diff.ts` derives per-entity
 *    diff and merge granularity from its top-level collection registry, so a
 *    flat keyed map gets per-annotation `added`/`modified`/`removed` changes
 *    and per-entity replay paths. Nesting annotations under nodes would have
 *    degraded every annotation edit to one whole-node replacement.
 *
 * 2. **The anchor is recorded, never inferred.** An annotation holds the node id
 *    it was pinned to. Nothing here walks the tree looking for "a plausible
 *    new home", because reattaching a note to the wrong object is worse than
 *    reporting it as orphaned — that is what the ledger calls silently
 *    attaching a note to another node.
 *
 * 3. **Identity comes from the document's id generator.** A module-local
 *    counter cannot be collision-resistant across documents, and two documents
 *    merged or pasted together would collide.
 *
 * Annotations are authored content, not derived state: they are excluded from
 * artwork export, prototype audience output and generated source unless a
 * caller explicitly includes them (see `annotationScope` helpers below).
 */

import { type IdGenerator, type IdNamespace, nextId } from './ids';
import type { NodeId } from './types';

/** What an annotation is for. Mirrors the documented handoff categories. */
export type AnnotationKind = 'development' | 'interaction' | 'accessibility' | 'content' | 'note';

export interface DesignAnnotation {
  id: string;
  /** The node this annotation is pinned to. Never inferred after creation. */
  anchorNodeId: NodeId;
  kind: AnnotationKind;
  text: string;
  /**
   * Author identity, only when a caller actually has one. Absent means
   * "unknown", which is the truthful value — an attributed note must not be
   * invented just to fill the field.
   */
  author?: string;
  /** Epoch ms. */
  createdAt: number;
  updatedAt?: number;
  /** A resolved note stays in the document as a record; it is not deleted. */
  resolved?: boolean;
}

/** Annotations by id. Absent (not empty) means "this document has none". */
export type AnnotationMap = Record<string, DesignAnnotation>;

export interface CreateAnnotationInput {
  anchorNodeId: NodeId;
  text: string;
  kind?: AnnotationKind;
  author?: string;
  /** Injected so the value is deterministic in tests. */
  now: number;
}

/**
 * Build an annotation with a generated id.
 *
 * The id comes from the document's own generator through `nextId`, the
 * persistent form, so the returned generator carries the advanced counter.
 * Annotation ids are therefore exactly as collision-safe as node ids — no more:
 * the guarantee is that a *paste* remaps them through the same id map the nodes
 * use, not that two independently authored documents cannot share an id.
 */
export function createAnnotation(
  generator: IdGenerator,
  namespace: IdNamespace,
  input: CreateAnnotationInput,
): { annotation: DesignAnnotation; generator: IdGenerator } {
  const [id, next] = nextId(generator, namespace);
  return {
    annotation: {
      id,
      anchorNodeId: input.anchorNodeId,
      kind: input.kind ?? 'note',
      text: input.text,
      ...(input.author !== undefined ? { author: input.author } : {}),
      createdAt: input.now,
    },
    generator: next,
  };
}

/** Add or replace an annotation. Returns a new map; never mutates the input. */
export function upsertAnnotation(map: AnnotationMap, annotation: DesignAnnotation): AnnotationMap {
  return { ...map, [annotation.id]: annotation };
}

/**
 * Edit an annotation's content or resolved state.
 *
 * `updatedAt` is set by the caller through `now` rather than read from the
 * clock here, so an edit is a pure function of its inputs.
 */
export function updateAnnotation(
  map: AnnotationMap,
  id: string,
  patch: Partial<Pick<DesignAnnotation, 'text' | 'kind' | 'resolved' | 'author'>>,
  now: number,
): AnnotationMap {
  const existing = map[id];
  if (!existing) return map;
  const next: DesignAnnotation = { ...existing, ...patch, updatedAt: now };
  return { ...map, [id]: next };
}

/** Remove an annotation. Returns the same map when the id is unknown. */
export function removeAnnotation(map: AnnotationMap, id: string): AnnotationMap {
  if (!map[id]) return map;
  const next = { ...map };
  delete next[id];
  return next;
}

/** Annotations anchored to one node, ordered by creation then id for stability. */
export function annotationsForNode(map: AnnotationMap, nodeId: NodeId): DesignAnnotation[] {
  return Object.values(map)
    .filter((annotation) => annotation.anchorNodeId === nodeId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** Every annotation, in a stable order. */
export function allAnnotations(map: AnnotationMap): DesignAnnotation[] {
  return Object.values(map).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export interface AnnotationAnchorReport {
  /** Annotations whose anchor still exists. */
  live: DesignAnnotation[];
  /**
   * Annotations whose anchor no longer exists. These are **reported, not
   * repaired**: the node is gone and any reattachment would be a guess.
   */
  orphaned: DesignAnnotation[];
}

/**
 * Resolve every annotation against the current node map.
 *
 * Deleting an anchor must surface the note for repair rather than silently
 * attaching it to something else, so this returns the orphan set instead of
 * dropping it or reassigning it.
 */
export function resolveAnnotationAnchors(
  map: AnnotationMap,
  nodes: Record<string, unknown>,
): AnnotationAnchorReport {
  const live: DesignAnnotation[] = [];
  const orphaned: DesignAnnotation[] = [];
  for (const annotation of allAnnotations(map)) {
    if (Object.hasOwn(nodes, annotation.anchorNodeId)) live.push(annotation);
    else orphaned.push(annotation);
  }
  return { live, orphaned };
}

/** Where annotations are allowed to appear. Declared, not implied. */
export type AnnotationScope =
  | 'document'
  | 'artwork-export'
  | 'prototype-audience'
  | 'generated-source';

/**
 * Whether annotations may appear in a given output.
 *
 * Only the document itself carries them by default. Artwork export, prototype
 * audience output and generated source must opt in explicitly — a note is
 * developer-facing content and leaking it into delivered artwork or a
 * stakeholder-facing prototype is a disclosure bug, not a preference.
 */
export function annotationScope(scope: AnnotationScope): boolean {
  return scope === 'document';
}

/**
 * Re-anchor annotations onto a copied subtree.
 *
 * Duplication and paste produce an id map for the copied nodes; without remapping
 * through it, a duplicated frame's notes would keep pointing at the original
 * nodes — the same defect class as a duplicated page retaining navigation to the
 * original destination.
 *
 * `idMap` is `originalId → copiedId`. An annotation whose anchor was **not**
 * copied does not move: a reference to something outside the copied scope is
 * intentional and must be preserved.
 */
export function remapAnnotationAnchors(
  map: AnnotationMap,
  idMap: ReadonlyMap<string, string>,
): AnnotationMap {
  let changed = false;
  const next: AnnotationMap = {};
  for (const [id, annotation] of Object.entries(map)) {
    const copied = idMap.get(annotation.anchorNodeId);
    if (copied === undefined) {
      next[id] = annotation;
      continue;
    }
    changed = true;
    next[id] = { ...annotation, anchorNodeId: copied };
  }
  return changed ? next : map;
}

/**
 * Copy the annotations anchored inside a subtree, remapped onto the copy.
 *
 * New ids are derived from the source id through the same map-free scheme as
 * the anchor remap: the copy is a distinct annotation, so it needs a distinct
 * id, but the association between a copy and its source must stay inferable.
 */
export function copyAnnotationsForSubtree(
  map: AnnotationMap,
  copiedNodeIds: readonly string[],
  idMap: ReadonlyMap<string, string>,
  idForCopy: (sourceId: string) => string,
  now: number,
): { annotations: AnnotationMap; generatorNote: string } {
  const copied = new Set(copiedNodeIds);
  const annotations: AnnotationMap = {};
  for (const annotation of allAnnotations(map)) {
    const copiedAnchor = idMap.get(annotation.anchorNodeId);
    if (copiedAnchor === undefined || !copied.has(copiedAnchor)) continue;
    const id = idForCopy(annotation.id);
    annotations[id] = {
      ...annotation,
      id,
      anchorNodeId: copiedAnchor,
      createdAt: now,
      updatedAt: undefined,
    };
  }
  return {
    annotations,
    generatorNote:
      'Copies carry fresh annotation ids; the anchor is remapped through the same id map as the copied nodes.',
  };
}
