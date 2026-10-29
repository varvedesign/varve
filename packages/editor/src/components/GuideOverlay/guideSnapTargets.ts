import {
  activePageNodes,
  buildParentIndexMap,
  type Document,
  type NodeId,
  type SceneNode,
  walkNodes,
} from '@varve/scene';
import { applyAffine } from '@varve/shared';
import { nodeWorldBounds, nodeWorldTransform } from '../../scene/world';

export interface GuideSnapTarget {
  axis: 'vertical' | 'horizontal';
  position: number;
  nodeId: NodeId;
  kind: 'edge' | 'center' | 'path-point';
}

export interface GuideSnapHit {
  position: number;
  target: GuideSnapTarget;
}

/**
 * Nodes eligible as guide-snap geometry.
 *
 * Locked nodes stay eligible: locking protects artwork from editing, it does
 * not hide it, and locked frames/artboards are the most common guide-alignment
 * reference. `snapExcluded` is the explicit per-node opt-out, matching the
 * object-snap pipeline. Hidden nodes (and anything under a hidden ancestor)
 * are excluded because they are not on screen.
 */
function isExcluded(
  nodeId: NodeId,
  parentIndex: ReadonlyMap<NodeId, NodeId>,
  nodes: Document['nodes'],
): boolean {
  let current: NodeId | null = nodeId;
  while (current) {
    const node = nodes[current];
    if (!node || node.visible === false || node.snapExcluded === true) return true;
    current = parentIndex.get(current) ?? null;
  }
  return false;
}

function addBoundsTargets(
  targets: GuideSnapTarget[],
  nodeId: NodeId,
  bounds: { x: number; y: number; w: number; h: number },
): void {
  const right = bounds.x + bounds.w;
  const bottom = bounds.y + bounds.h;
  targets.push(
    { axis: 'vertical', position: bounds.x, nodeId, kind: 'edge' },
    { axis: 'vertical', position: right, nodeId, kind: 'edge' },
    { axis: 'vertical', position: bounds.x + bounds.w / 2, nodeId, kind: 'center' },
    { axis: 'horizontal', position: bounds.y, nodeId, kind: 'edge' },
    { axis: 'horizontal', position: bottom, nodeId, kind: 'edge' },
    { axis: 'horizontal', position: bounds.y + bounds.h / 2, nodeId, kind: 'center' },
  );
}

function pathPoints(node: SceneNode): ReadonlyArray<{ x: number; y: number }> | undefined {
  if (node.kind === 'path') return node.points;
  if (node.kind === 'shape' && node.shape.kind === 'path') return node.shape.points;
  return undefined;
}

/**
 * Candidate guide positions for the active editing surface.
 *
 * Built on demand at a gesture start, never during render: the traversal is
 * O(N) in the surface and `nodeWorldBounds` unions group children, so an eager
 * call on every document mutation would tax every text keystroke for a value
 * only a guide drag reads.
 *
 * Pass `authoredNodeIds` from `resolveEditorSceneScope` to walk exactly the
 * editing surface (master edit, isolation, design canvas, publishing). Without
 * it the active page is used.
 */
export function getGuideSnapTargets(
  doc: Document,
  options: { authoredNodeIds?: ReadonlySet<NodeId> } = {},
): readonly GuideSnapTarget[] {
  const { authoredNodeIds } = options;
  // The traversal root must be the editing surface, not the active page: in
  // master edit the surface is the master content root (which
  // `activePageNodes` deliberately excludes), and a design-canvas document
  // lives outside page children entirely. The scope ids are exactly the
  // surface's authored nodes, so walking from them reaches the same subtree.
  const roots = authoredNodeIds ? [...authoredNodeIds] : activePageNodes(doc);
  const entries = walkNodes(doc, roots);
  // One parent index for the whole document: `nodeWorldBounds` and
  // `nodeWorldTransform` otherwise resolve the ancestor chain per node (the
  // expensive part of a deep traversal), and a scope-rooted walk still needs
  // ancestors above the root for their transforms.
  const parentIndex = buildParentIndexMap(doc);
  const targets: GuideSnapTarget[] = [];

  for (const { nodeId, node } of entries.values()) {
    if (isExcluded(nodeId, parentIndex, doc.nodes)) continue;
    const bounds = nodeWorldBounds(doc, nodeId, parentIndex);
    if (!bounds) continue;
    addBoundsTargets(targets, nodeId, bounds);

    const points = pathPoints(node);
    if (!points?.length) continue;
    const transform = nodeWorldTransform(doc, nodeId, parentIndex);
    for (const point of points) {
      const [x, y] = applyAffine(transform, [point.x, point.y]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      targets.push(
        { axis: 'vertical', position: x, nodeId, kind: 'path-point' },
        { axis: 'horizontal', position: y, nodeId, kind: 'path-point' },
      );
    }
  }
  return targets;
}

/**
 * Return the nearest target on the dragged axis within the magnetic tolerance,
 * or `null` when the guide is free.
 *
 * Tolerance is expressed in screen pixels, so the world range tightens as the
 * camera zooms in. The returned position is the target's exact coordinate:
 * guide alignment is a precision workflow, so snapping must not round.
 */
export function snapGuidePosition(
  position: number,
  axis: GuideSnapTarget['axis'],
  targets: readonly GuideSnapTarget[],
  zoom: number,
  tolerancePx: number,
): GuideSnapHit | null {
  if (!Number.isFinite(position) || !Number.isFinite(zoom) || zoom <= 0 || tolerancePx <= 0) {
    return null;
  }
  let closest: GuideSnapTarget | null = null;
  let closestDistancePx = tolerancePx;
  for (const target of targets) {
    if (target.axis !== axis || !Number.isFinite(target.position)) continue;
    const distancePx = Math.abs(target.position - position) * zoom;
    if (distancePx > closestDistancePx) continue;
    closest = target;
    closestDistancePx = distancePx;
  }
  return closest ? { position: closest.position, target: closest } : null;
}
