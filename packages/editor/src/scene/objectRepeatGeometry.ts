import { type Document, type GroupNode, nodeLocalBounds, type SceneNode } from '@varve/scene';
import type { Affine, Rect } from '@varve/shared';
import { applyAffine, multiplyAffine, tryInvertAffine } from '@varve/shared';

/** Bounds of the authored source subtree in repeat-group-local coordinates. */
export function sourceLocalBounds(
  document: Document,
  group: GroupNode,
  getWorldTransform: (id: string) => Affine,
): Rect | null {
  const groupInverse = tryInvertAffine(getWorldTransform(group.id));
  if (!groupInverse) return null;
  let result: Rect | null = null;
  const visit = (nodeId: string) => {
    const node = document.nodes[nodeId] as SceneNode | undefined;
    if (!node) return;
    if (node.kind === 'group') {
      for (const childId of node.children) visit(childId);
      return;
    }
    const bounds = nodeLocalBounds(node, document);
    if (!bounds) return;
    const relative = multiplyAffine(groupInverse, getWorldTransform(node.id));
    const corners = [
      applyAffine(relative, [bounds.x, bounds.y]),
      applyAffine(relative, [bounds.x + bounds.w, bounds.y]),
      applyAffine(relative, [bounds.x, bounds.y + bounds.h]),
      applyAffine(relative, [bounds.x + bounds.w, bounds.y + bounds.h]),
    ];
    const minX = Math.min(...corners.map(([x]) => x));
    const minY = Math.min(...corners.map(([, y]) => y));
    const maxX = Math.max(...corners.map(([x]) => x));
    const maxY = Math.max(...corners.map(([, y]) => y));
    if (!result) result = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    else {
      const left = Math.min(result.x, minX);
      const top = Math.min(result.y, minY);
      const right = Math.max(result.x + result.w, maxX);
      const bottom = Math.max(result.y + result.h, maxY);
      result = { x: left, y: top, w: right - left, h: bottom - top };
    }
  };
  for (const childId of group.children) visit(childId);
  return result;
}
