/**
 * Shared building blocks for the standard command family.
 *
 * Coordinate contract used by every command here:
 * - Positions are **parent-local CSS pixels**: the translation component of the
 *   node's `transform`, which is exactly what the editor's `setNodePosition`
 *   writes. They are not page-relative and not world coordinates.
 * - Sizes are the node's own width/height before parent scaling.
 * - Rotation is degrees, clockwise-positive as stored on the node.
 * - Colors are `#RRGGBB` or `#RRGGBBAA` sRGB hex.
 */
import {
  buildParentIndexMap,
  type Document,
  isContainer,
  type NodeId,
  type SceneNode,
} from '@varve/scene';
import { CommandRejection } from '../errors';
import { type Infer, s } from '../schema';

export const NODE_ID = s.string({ maxBytes: 128, minLength: 1 });
export const NODE_IDS = s.array(NODE_ID, { minItems: 1, maxItems: 500, unique: true });
export const HEX_COLOR = s.string({
  maxBytes: 9,
  pattern: '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$',
  description: 'sRGB color as #RRGGBB or #RRGGBBAA',
});
export const COORD = s.number({ min: -10_000_000, max: 10_000_000, unit: 'px' });
export const SIZE = s.number({ min: 0.001, max: 1_000_000, unit: 'px' });
export const NODE_NAME = s.string({ maxBytes: 256 });

export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const;

export const NODE_KINDS = [
  'shape',
  'text',
  'group',
  'frame',
  'table',
  'adjustment',
  'path',
  'raster',
] as const;

export const NODE_VIEW = s.object({
  id: s.string({ maxBytes: 128 }),
  kind: s.string({ maxBytes: 32 }),
  name: s.string({ maxBytes: 1024 }),
  parentId: s.nullable(s.string({ maxBytes: 128 })),
  index: s.integer({ min: 0 }),
  visible: s.boolean(),
  locked: s.boolean(),
  opacity: s.number(),
  rotation: s.number(),
  position: s.object({ x: s.number(), y: s.number() }),
  size: s.nullable(s.object({ width: s.number(), height: s.number() })),
  fill: s.nullable(s.string({ maxBytes: 64 })),
  childCount: s.optional(s.integer({ min: 0 })),
  text: s.optional(s.string({ maxBytes: 1_000_000 })),
});

/** The inferred shape of `NODE_VIEW`; one definition, so schema and type cannot drift. */
export type NodeView = Infer<typeof NODE_VIEW>;

export type ParentIndex = Map<NodeId, NodeId>;

export function parentIndexOf(doc: Document): ParentIndex {
  return buildParentIndexMap(doc);
}

export function parentOf(doc: Document, parents: ParentIndex, id: NodeId): NodeId | null {
  void doc;
  return parents.get(id) ?? null;
}

export function siblingsOf(doc: Document, parents: ParentIndex, id: NodeId): readonly NodeId[] {
  const parentId = parents.get(id);
  if (parentId === undefined) return doc.rootChildren;
  const parent = doc.nodes[parentId];
  return parent && isContainer(parent) ? parent.children : [];
}

function channel(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, '0');
}

/** `#rrggbb[aa]` for an sRGB color; `null` for spaces with no lossless hex form. */
export function colorToHex(color: unknown): string | null {
  if (typeof color !== 'object' || color === null) return null;
  const c = color as { space?: string; r?: number; g?: number; b?: number; a?: number };
  if (c.space !== 'rgb') return null;
  if (![c.r, c.g, c.b].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const alpha = typeof c.a === 'number' && Number.isFinite(c.a) ? c.a : 255;
  const base = `#${channel(c.r as number)}${channel(c.g as number)}${channel(c.b as number)}`;
  return alpha >= 255 ? base : `${base}${channel(alpha)}`;
}

/** Parse a validated hex color. Alpha defaults to opaque. */
export function hexToRgb(hex: string): {
  space: 'rgb';
  r: number;
  g: number;
  b: number;
  a: number;
} {
  const body = hex.slice(1);
  return {
    space: 'rgb',
    r: Number.parseInt(body.slice(0, 2), 16),
    g: Number.parseInt(body.slice(2, 4), 16),
    b: Number.parseInt(body.slice(4, 6), 16),
    a: body.length === 8 ? Number.parseInt(body.slice(6, 8), 16) : 255,
  };
}

export function positionOf(node: SceneNode): { x: number; y: number } {
  const t = node.transform;
  const x = typeof t?.[4] === 'number' && Number.isFinite(t[4]) ? t[4] : 0;
  const y = typeof t?.[5] === 'number' && Number.isFinite(t[5]) ? t[5] : 0;
  return { x, y };
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function sizeOf(node: SceneNode): { width: number; height: number } | null {
  if (node.kind === 'frame' || node.kind === 'text') {
    const w = finite((node as { w?: number }).w);
    const h = finite((node as { h?: number }).h);
    return w !== null && h !== null ? { width: w, height: h } : null;
  }
  if (node.kind !== 'shape') return null;
  const shape = node.shape as unknown as Record<string, unknown>;
  switch (shape.kind) {
    case 'rect': {
      const w = finite(shape.w);
      const h = finite(shape.h);
      return w !== null && h !== null ? { width: w, height: h } : null;
    }
    case 'ellipse': {
      const rx = finite(shape.rx);
      const ry = finite(shape.ry);
      return rx !== null && ry !== null ? { width: rx * 2, height: ry * 2 } : null;
    }
    case 'circle': {
      const r = finite(shape.r);
      return r !== null ? { width: r * 2, height: r * 2 } : null;
    }
    default:
      return null;
  }
}

export function describeNode(
  doc: Document,
  node: SceneNode,
  parents: ParentIndex,
  options: { includeText?: boolean } = {},
): NodeView {
  const parentId = parents.get(node.id) ?? null;
  const siblings = siblingsOf(doc, parents, node.id);
  const view: NodeView = {
    id: node.id,
    kind: node.kind,
    name: node.name,
    parentId,
    index: Math.max(0, siblings.indexOf(node.id)),
    visible: node.visible,
    locked: node.locked,
    opacity: node.opacity,
    rotation: node.rotation,
    position: positionOf(node),
    size: sizeOf(node),
    fill: colorToHex(node.fill),
  };
  if (isContainer(node)) view.childCount = node.children.length;
  if (node.kind === 'text' && options.includeText) {
    view.text = (node as unknown as { text?: string }).text ?? '';
  }
  return view;
}

/**
 * Resolve every id or refuse the whole request, naming all that are missing.
 * Reject-before-mutate: a list with one bad id never half-applies.
 */
export function requireNodes(
  doc: Document,
  ids: readonly string[],
  field = 'nodeIds',
): SceneNode[] {
  const missing = ids.filter((id) => doc.nodes[id] === undefined);
  if (missing.length > 0) {
    throw new CommandRejection('UNKNOWN_TARGET', {
      message: `${field}: ${missing.length} node(s) do not exist in this document: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ', ...' : ''}`,
      hint: 'ids are opaque; list nodes with varve.node.list or look one up by name with varve.node.find. A name is not an id.',
      details: { missing },
    });
  }
  return ids.map((id) => doc.nodes[id] as SceneNode);
}

/** The first locked node on the path from `id` up to the root, or `null`. */
export function lockedOnPath(doc: Document, parents: ParentIndex, id: NodeId): NodeId | null {
  let cursor: NodeId | undefined = id;
  const seen = new Set<NodeId>();
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor);
    const node: SceneNode | undefined = doc.nodes[cursor];
    if (node?.locked) return cursor;
    cursor = parents.get(cursor);
  }
  return null;
}

/** Refuse edits to locked layers (own lock or any ancestor's), listing which. */
export function assertEditable(doc: Document, parents: ParentIndex, ids: readonly string[]): void {
  const blocked: Array<{ id: string; lockedBy: string }> = [];
  for (const id of ids) {
    const lockedBy = lockedOnPath(doc, parents, id);
    if (lockedBy !== null) blocked.push({ id, lockedBy });
  }
  if (blocked.length > 0) {
    throw new CommandRejection('LOCKED', {
      message: `${blocked.length} node(s) are locked and were not changed: ${blocked
        .slice(0, 5)
        .map((b) => (b.id === b.lockedBy ? b.id : `${b.id} (locked via ${b.lockedBy})`))
        .join(', ')}`,
      hint: 'unlock the node first with varve.node.set { locked: false }; a locked ancestor must be unlocked itself',
      details: { blocked },
    });
  }
}

/** Page content roots and master roots must never be deleted or reparented. */
export function protectedRoots(doc: Document): Set<string> {
  const roots = new Set<string>();
  for (const page of doc.pages ?? []) roots.add(page.contentRoot);
  for (const master of Object.values(doc.masters ?? {})) roots.add(master.contentRoot);
  return roots;
}
