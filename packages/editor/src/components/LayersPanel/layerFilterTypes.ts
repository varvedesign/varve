import type { BlendMode, Document, LayerColor, NodeId, SceneNode } from '@varve/scene';
import { isContainer } from '@varve/scene';
import { isNodeEffectivelyHidden } from '../../scene/world';
import { isComponentInstance, isComponentNode } from './layerPresentation';
import { matchesLayerSearch } from './layerSearchIndex';

/** Filter by node kind (e.g., 'shape', 'text', 'frame', etc.) */
export type NodeKindFilter = Array<SceneNode['kind'] | 'component'>;

/** Filter by attribute state */
export interface AttributeFilter {
  locked?: boolean;
  visible?: boolean;
  hasChildren?: boolean;
  isComponent?: boolean;
  isInstance?: boolean;
  hasEffects?: boolean;
  isMasked?: boolean;
  /** Filter nodes by their color tag value (or null for uncolored). */
  layerColor?: LayerColor;
  /** Email: `emailSemantics.nodes[id].hideOnMobile === true`. */
  mobileHidden?: boolean;
  /** Email: `emailSemantics.nodes[id].hideOnDesktop === true`. */
  mobileOnly?: boolean;
  /** Print: a text node bound to a story thread (`storyBinding`). */
  threadedText?: boolean;
  /** Print/Codegen: a frame with `frameRole === 'exportRegion'`. */
  exportRegion?: boolean;
  /** Motion: the node has keyframes or animated media. Requires a match-id set. */
  animated?: boolean;
}

/** Filter by blend mode */
export type BlendModeFilter = BlendMode[];

/**
 * Extra inputs a filter predicate cannot read from the node alone.
 * `doc` is required for document-scoped semantics (email metadata); the
 * animated id set is computed once per document revision by the caller so the
 * predicate stays O(1) per node.
 */
export interface NodeFilterContext {
  doc?: Document;
  animatedIds?: ReadonlySet<NodeId>;
  /**
   * Nodes hidden by themselves or an ancestor, precomputed once per filter
   * pass. `isNodeEffectivelyHidden` walks `getParent`, which scans the whole
   * node map; calling it per node while filtering turned an O(n) projection
   * into O(n²) on large documents.
   */
  hiddenIds?: ReadonlySet<NodeId>;
}

/**
 * Precompute effective hidden state for every node in one bounded pass.
 *
 * A single parent map plus one ancestor walk per node keeps the cost linear
 * in nodes × depth with O(1) parent lookups. The depth bound protects the
 * panel from a corrupt document whose parent chain loops.
 */
export function collectEffectivelyHiddenIds(doc: Document): Set<NodeId> {
  const parentOf = new Map<NodeId, NodeId>();
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (!isContainer(node)) continue;
    for (const child of node.children) parentOf.set(child, id as NodeId);
  }

  const hidden = new Set<NodeId>();
  for (const id of Object.keys(doc.nodes) as NodeId[]) {
    let current: NodeId | undefined = id;
    let depth = 0;
    while (current && depth < 256) {
      if (doc.nodes[current]?.visible === false) {
        hidden.add(id);
        break;
      }
      current = parentOf.get(current);
      depth += 1;
    }
  }
  return hidden;
}

/** Combined layer filter specification */
export interface LayerFilterSpec {
  /** Search text (name filter) */
  search: string;
  /** Filter by node kinds */
  kinds: NodeKindFilter;
  /** Filter by attribute states */
  attributes: AttributeFilter;
  /** Filter by blend mode */
  blendModes: BlendModeFilter;
}

export const DEFAULT_FILTER: LayerFilterSpec = {
  search: '',
  kinds: [],
  attributes: {},
  blendModes: [],
};

function hasEffects(node: SceneNode): boolean {
  return ((node as unknown as { effects?: unknown[] }).effects?.length ?? 0) > 0;
}

function hasMask(node: SceneNode): boolean {
  return (node as SceneNode & { mask?: unknown }).mask != null;
}

/** Returns true when at least one filter dimension is active. */
export function isFiltering(spec: LayerFilterSpec): boolean {
  return (
    spec.search !== '' ||
    spec.kinds.length > 0 ||
    Object.values(spec.attributes).some((v) => v !== undefined) ||
    spec.blendModes.length > 0
  );
}

/**
 * Every dimension of a filter except the name search.
 *
 * Shared by the index-backed search path and the direct predicate so the two
 * can never drift: `flattenTree` previously carried its own copy of this
 * logic, which meant a new attribute had to be added in two places.
 */
export function nodeMatchesNonSearch(
  node: SceneNode,
  filter: LayerFilterSpec,
  ctx: NodeFilterContext = {},
): boolean {
  if (filter.kinds.length > 0) {
    const effectiveKind: SceneNode['kind'] | 'component' = isComponentNode(node, ctx.doc)
      ? 'component'
      : node.kind;
    if (!filter.kinds.includes(effectiveKind) && !filter.kinds.includes(node.kind)) return false;
  }

  const attr = filter.attributes;
  if (attr.locked !== undefined && node.locked !== attr.locked) return false;
  if (attr.visible !== undefined) {
    // Visibility inherits down the hierarchy. Comparing the own flag would
    // put a child of a hidden group under "Visible" even though it paints
    // nothing, contradicting both the row treatment and the accessible name.
    const effectivelyHidden = ctx.hiddenIds
      ? ctx.hiddenIds.has(node.id)
      : ctx.doc
        ? isNodeEffectivelyHidden(ctx.doc, node.id)
        : node.visible === false;
    if (effectivelyHidden === attr.visible) return false;
  }
  if (attr.hasChildren !== undefined) {
    const hasCh = isContainer(node) && node.children.length > 0;
    if (hasCh !== attr.hasChildren) return false;
  }
  if (attr.isComponent !== undefined) {
    const isComp = isComponentNode(node, ctx.doc);
    if (isComp !== attr.isComponent) return false;
  }
  if (attr.isInstance !== undefined) {
    const isInst = isComponentInstance(node);
    if (isInst !== attr.isInstance) return false;
  }
  if (attr.hasEffects !== undefined) {
    const hasFx = hasEffects(node);
    if (hasFx !== attr.hasEffects) return false;
  }
  if (attr.isMasked !== undefined) {
    const isMasked = hasMask(node);
    if (isMasked !== attr.isMasked) return false;
  }
  if (attr.layerColor !== undefined && node.layerColor !== attr.layerColor) return false;

  // Email semantics live on the document, not the node.
  if (attr.mobileHidden !== undefined) {
    const meta = ctx.doc?.emailSemantics?.nodes?.[node.id];
    if ((meta?.hideOnMobile === true) !== attr.mobileHidden) return false;
  }
  if (attr.mobileOnly !== undefined) {
    const meta = ctx.doc?.emailSemantics?.nodes?.[node.id];
    if ((meta?.hideOnDesktop === true) !== attr.mobileOnly) return false;
  }

  // Print stories: threaded text frames reference a document story.
  if (attr.threadedText !== undefined) {
    const threaded = node.kind === 'text' && node.storyBinding?.storyId != null;
    if (threaded !== attr.threadedText) return false;
  }

  // Export regions are frames the author marked for output.
  if (attr.exportRegion !== undefined) {
    const isRegion = node.kind === 'frame' && node.frameRole === 'exportRegion';
    if (isRegion !== attr.exportRegion) return false;
  }

  // Motion: membership comes from a caller-computed id set (one per revision).
  if (attr.animated !== undefined) {
    const animated = ctx.animatedIds?.has(node.id) === true;
    if (animated !== attr.animated) return false;
  }

  if (filter.blendModes.length > 0) {
    if (!filter.blendModes.includes(node.blendMode!)) return false;
  }

  return true;
}

/** Check if a node matches the filter specification */
export function nodeMatchesFilter(
  node: SceneNode,
  filter: LayerFilterSpec,
  ctx: NodeFilterContext = {},
): boolean {
  if (filter.search && !matchesLayerSearch(node.name, filter.search)) return false;
  return nodeMatchesNonSearch(node, filter, ctx);
}
