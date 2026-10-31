import { quadBoundsOf } from '../mockup/warpReplay';
import type { Primitive, RenderItem } from '../types';
/** Get the finite, local-coordinate bounding box of a primitive. */
export function primitiveBounds(p: RenderItem['primitive']): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  switch (p.kind) {
    case 'warpedImage': {
      return quadBoundsOf(p as Extract<Primitive, { kind: 'warpedImage' }>);
    }
    case 'rect':
      return { x: p.x, y: p.y, w: p.w, h: p.h };
    case 'ellipse':
      return { x: p.cx - p.rx, y: p.cy - p.ry, w: p.rx * 2, h: p.ry * 2 };
    case 'circle':
      return { x: p.cx - p.r, y: p.cy - p.r, w: p.r * 2, h: p.r * 2 };
    case 'line':
      return {
        x: Math.min(p.from[0], p.to[0]),
        y: Math.min(p.from[1], p.to[1]),
        w: Math.max(Math.abs(p.to[0] - p.from[0]), 4),
        h: Math.max(Math.abs(p.to[1] - p.from[1]), 4),
      };
    case 'arrow': {
      const pad = p.arrowheadSize;
      return {
        x: Math.min(p.from[0], p.to[0]) - pad,
        y: Math.min(p.from[1], p.to[1]) - pad,
        w: Math.max(Math.abs(p.to[0] - p.from[0]), 4) + pad * 2,
        h: Math.max(Math.abs(p.to[1] - p.from[1]), 4) + pad * 2,
      };
    }
    case 'polygon':
      return { x: p.cx - p.radius, y: p.cy - p.radius, w: p.radius * 2, h: p.radius * 2 };
    case 'star':
      return {
        x: p.cx - p.outerRadius,
        y: p.cy - p.outerRadius,
        w: p.outerRadius * 2,
        h: p.outerRadius * 2,
      };
    case 'text':
      return { x: p.x, y: p.y, w: p.w, h: p.h };
    case 'table':
      return { x: p.x, y: p.y, w: p.w, h: p.h };
    case 'path': {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      const include = (x: number, y: number): void => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      };

      const rings = p.contours?.length ? p.contours : [p.points, ...(p.holes ?? [])];
      for (const ring of rings) {
        for (const point of ring) {
          include(point.x, point.y);
          if (point.handleIn) {
            include(point.x + point.handleIn[0], point.y + point.handleIn[1]);
          }
          if (point.handleOut) {
            include(point.x + point.handleOut[0], point.y + point.handleOut[1]);
          }
        }
      }

      if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
        return { x: 0, y: 0, w: 0, h: 0 };
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    case 'rasterLayer':
      return { x: 0, y: 0, w: p.width, h: p.height };
    default:
      return { x: 0, y: 0, w: 0, h: 0 };
  }
}
