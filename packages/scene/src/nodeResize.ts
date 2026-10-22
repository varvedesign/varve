import type { SceneNode } from './types';

/**
 * Resize a node to world-space dimensions while preserving its local origin.
 *
 * Pure and shared: the editor (`setNodeSize`) and the automation command layer
 * both call this function so a resize means the same thing from every surface.
 * Node kinds without a resize meaning (groups, tables, adjustments, raster
 * layers) are returned unchanged by reference; callers that must distinguish
 * "resized" from "nothing to resize" compare the returned reference.
 */
export function resizeSceneNode(node: SceneNode, width: number, height: number): SceneNode {
  if (node.kind === 'frame' || node.kind === 'text') return { ...node, w: width, h: height };
  if (node.kind !== 'shape') return node;
  const shape = node.shape;
  switch (shape.kind) {
    case 'rect':
      return { ...node, shape: { ...shape, w: width, h: height } };
    case 'ellipse':
      return {
        ...node,
        shape: { ...shape, rx: width / 2, ry: height / 2, cx: width / 2, cy: height / 2 },
      };
    case 'circle':
      return {
        ...node,
        shape: {
          ...shape,
          r: Math.max(width, height) / 2,
          cx: width / 2,
          cy: height / 2,
        },
      };
    case 'line':
    case 'arrow': {
      const oldWidth = Math.abs(shape.to[0] - shape.from[0]) || 1;
      const oldHeight = Math.abs(shape.to[1] - shape.from[1]) || 1;
      const scaleX = width / oldWidth;
      const scaleY = height / oldHeight;
      const centerX = (shape.from[0] + shape.to[0]) / 2;
      const centerY = (shape.from[1] + shape.to[1]) / 2;
      return {
        ...node,
        shape: {
          ...shape,
          from: [
            centerX + (shape.from[0] - centerX) * scaleX,
            centerY + (shape.from[1] - centerY) * scaleY,
          ],
          to: [
            centerX + (shape.to[0] - centerX) * scaleX,
            centerY + (shape.to[1] - centerY) * scaleY,
          ],
        },
      };
    }
    case 'polygon':
      return { ...node, shape: { ...shape, radius: Math.max(1, width / 2) } };
    case 'star': {
      const oldOuterRadius = shape.outerRadius || 1;
      const outerRadius = Math.max(1, width / 2);
      return {
        ...node,
        shape: {
          ...shape,
          outerRadius,
          innerRadius: Math.max(1, shape.innerRadius * (outerRadius / oldOuterRadius)),
        },
      };
    }
    case 'path': {
      if (shape.points.length === 0) return node;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const point of shape.points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
      const scaleX = width / (maxX - minX || 1);
      const scaleY = height / (maxY - minY || 1);
      return {
        ...node,
        shape: {
          ...shape,
          points: shape.points.map((point) => ({
            x: (point.x - minX) * scaleX + minX,
            y: (point.y - minY) * scaleY + minY,
            handleIn: point.handleIn
              ? ([point.handleIn[0] * scaleX, point.handleIn[1] * scaleY] as [number, number])
              : null,
            handleOut: point.handleOut
              ? ([point.handleOut[0] * scaleX, point.handleOut[1] * scaleY] as [number, number])
              : null,
          })),
        },
      };
    }
    default:
      return node;
  }
}
