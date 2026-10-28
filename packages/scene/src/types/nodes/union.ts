import type { Affine, PathPoint } from '@varve/engine';
import type { Effect, Stroke } from '../appearance';
import type { AdjustmentNode, RasterLayerNode } from './adjustment';
import type { NodeBase } from './base';
import type { FrameNode, TableNode } from './containers';
import type { GroupNode, LiveBooleanState } from './groups';
import type { ShapeNode } from './shapes';
import type { TextNode } from './text';

/** @deprecated Use ShapeNode with imageFill(). ImageNode no longer exists as a distinct node kind. */
export type ImageNode = ShapeNode;

// ── Vector Path Node ─────────────────────────────────────────────────────────

/** @deprecated Use ShapeNode with kind:'path' shape instead. PathNode is
 *  preserved for backward compatibility with serialized documents. */
export interface PathNode extends NodeBase {
  kind: 'path';
  /** Control points in node-local coordinates. */
  points: PathPoint[];
  /** Whether the last point connects back to the first. */
  closed: boolean;
  transform: Affine;
  strokes: Stroke[];
  effects: Effect[];
}

export type SceneNode =
  | ShapeNode
  | TextNode
  | GroupNode
  | FrameNode
  | TableNode
  | AdjustmentNode
  | PathNode
  | RasterLayerNode;

export type ContainerNode = GroupNode | FrameNode;

/** True if the node is a container (has a children array). */
export function isContainer(node: SceneNode): node is ContainerNode {
  return node.kind === 'frame' || node.kind === 'group';
}

/** True when a group is a non-destructive Boolean container. */
export function isLiveBooleanNode(
  node: SceneNode,
): node is GroupNode & { boolean: LiveBooleanState } {
  return node.kind === 'group' && node.boolean !== undefined;
}

/**
 * A rectangular, non-painting marker naming an area to export.
 *
 * It is stored as a FrameNode so every existing transform, resize, clipboard,
 * codec and layer path keeps working unchanged — but it is not artwork and not
 * a layout container.
 */
export type ExportRegionNode = FrameNode & { frameRole: 'exportRegion' };

/**
 * True if the node is an Export Region.
 *
 * Callers must not adopt content into one, paint its fill, or offer it
 * frame/auto-layout semantics. `isContainer` still reports true — the node
 * really does have a (always empty) children array — so guard adoption with
 * this predicate rather than by kind alone.
 */
export function isExportRegion(node: SceneNode): node is ExportRegionNode {
  return node.kind === 'frame' && node.frameRole === 'exportRegion';
}

/** True if the node is a native table. */
export function isTableNode(node: SceneNode): node is TableNode {
  return node.kind === 'table';
}
