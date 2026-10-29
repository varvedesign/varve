import type { ResizeHandle, SelectionBox } from '@varve/shared';

import { compete, SNAP_PRIORITY } from './candidates';
import { snapCoordToGrid } from './grid';
import { thresholdWorld } from './targets';
import type { SnapGuide, SnapLineTarget } from './types';

export function snapSize(
  w: number,
  h: number,
  otherBounds: Array<{ x: number; y: number; w: number; h: number }>,
  zoom = 1,
  tolerancePx?: number,
): { w: number; h: number; matched: boolean; guide?: SnapGuide } {
  const threshold = thresholdWorld(zoom, tolerancePx);
  for (const b of otherBounds) {
    if (Math.abs(b.w - w) < threshold) {
      return {
        w: b.w,
        h,
        matched: true,
        guide: { axis: 'horizontal', position: 0, type: 'size-match', label: `${b.w}px` },
      };
    }
    if (Math.abs(b.h - h) < threshold) {
      return {
        w,
        h: b.h,
        matched: true,
        guide: { axis: 'vertical', position: 0, type: 'size-match', label: `${b.h}px` },
      };
    }
  }
  return { w, h, matched: false };
}

export type ResizeSide = 'start' | 'end';

interface ResizeAxisTarget {
  position: number;
  priority: number;
}

export function lineTargetPriority(type: SnapGuide['type']): number {
  switch (type) {
    case 'guide':
      return SNAP_PRIORITY.guide;
    case 'layout-grid':
      return SNAP_PRIORITY.layoutGrid;
    default:
      return SNAP_PRIORITY.edge;
  }
}

export function lineAxisTargets(
  lineTargets: SnapLineTarget[],
  axis: 'x' | 'y',
): ResizeAxisTarget[] {
  const expectedAxis = axis === 'x' ? 'vertical' : 'horizontal';
  return lineTargets
    .filter((target) => target.axis === expectedAxis && Number.isFinite(target.position))
    .map((target) => ({
      position: target.position,
      priority: lineTargetPriority(target.type),
    }));
}

export interface ResizeAxisSnap {
  center: number;
  size: number;
  priority: number;
  diff: number;
}

function preferResizeAxis(x: ResizeAxisSnap | null, y: ResizeAxisSnap | null): 'x' | 'y' | null {
  if (!x && !y) return null;
  if (!y) return 'x';
  if (!x) return 'y';
  if (x.priority !== y.priority) return x.priority > y.priority ? 'x' : 'y';
  if (x.diff !== y.diff) return x.diff < y.diff ? 'x' : 'y';
  // A corner can be close to two equally strong targets. Keeping X as the
  // stable tie-breaker makes the result independent of candidate iteration.
  return 'x';
}

export function preserveProportionalResize(
  box: SelectionBox,
  snapped: SelectionBox,
  resizeX: ResizeSide | null,
  resizeY: ResizeSide | null,
  xSnap: ResizeAxisSnap | null,
  ySnap: ResizeAxisSnap | null,
  centered: boolean,
): SelectionBox {
  const axis = preferResizeAxis(xSnap, ySnap);
  if (!axis || box.w <= Number.EPSILON || box.h <= Number.EPSILON) return snapped;

  const width = axis === 'x' ? xSnap?.size : box.w * ((ySnap?.size ?? box.h) / box.h);
  const height = axis === 'y' ? ySnap?.size : box.h * ((xSnap?.size ?? box.w) / box.w);
  if (
    width === undefined ||
    height === undefined ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= Number.EPSILON ||
    height <= Number.EPSILON
  ) {
    return snapped;
  }

  let cx = box.cx;
  let cy = box.cy;
  if (!centered) {
    const fixedX = resizeX ? box.cx + (resizeX === 'end' ? -box.w / 2 : box.w / 2) : null;
    const fixedY = resizeY ? box.cy + (resizeY === 'end' ? -box.h / 2 : box.h / 2) : null;
    if (fixedX !== null && resizeX) {
      cx = fixedX + (resizeX === 'end' ? width / 2 : -width / 2);
    }
    if (fixedY !== null && resizeY) {
      cy = fixedY + (resizeY === 'end' ? height / 2 : -height / 2);
    }
  }

  return { ...snapped, cx, cy, w: width, h: height };
}

export function resizeSideForHandle(handle: ResizeHandle, axis: 'x' | 'y'): ResizeSide | null {
  if (axis === 'x') {
    if (handle === 'w' || handle === 'nw' || handle === 'sw') return 'start';
    if (handle === 'e' || handle === 'ne' || handle === 'se') return 'end';
  } else {
    if (handle === 'n' || handle === 'nw' || handle === 'ne') return 'start';
    if (handle === 's' || handle === 'sw' || handle === 'se') return 'end';
  }
  return null;
}

/**
 * Snap the moving side of a resize without translating its opposite anchor.
 * A generic selection-box snap may safely translate a box; doing that during
 * resize makes the fixed handle side drift, so resize has its own resolver.
 */
export function snapResizeAxis(
  center: number,
  size: number,
  side: ResizeSide,
  targets: ResizeAxisTarget[],
  centered: boolean,
  threshold: number,
): ResizeAxisSnap | null {
  const moving = center + (side === 'end' ? size / 2 : -size / 2);
  const fixed = center + (side === 'end' ? -size / 2 : size / 2);
  let best: ResizeAxisSnap | null = null;

  for (const target of targets) {
    const diff = Math.abs(moving - target.position);
    if (diff >= threshold) continue;
    if (best && !compete(target.priority, diff, best.priority, best.diff)) continue;

    const nextSize = centered
      ? size + (side === 'end' ? 2 * (target.position - moving) : 2 * (moving - target.position))
      : side === 'end'
        ? target.position - fixed
        : fixed - target.position;
    if (nextSize <= Number.EPSILON) continue;
    best = {
      center: centered ? center : (fixed + target.position) / 2,
      size: nextSize,
      priority: target.priority,
      diff,
    };
  }

  return best;
}

export function objectAxisTargets(
  otherBounds: Array<{ x: number; y: number; w: number; h: number }>,
  axis: 'x' | 'y',
): ResizeAxisTarget[] {
  const targets: ResizeAxisTarget[] = [];
  for (const b of otherBounds) {
    const start = axis === 'x' ? b.x : b.y;
    const size = axis === 'x' ? b.w : b.h;
    targets.push(
      { position: start, priority: SNAP_PRIORITY.edge },
      { position: start + size / 2, priority: SNAP_PRIORITY.center },
      { position: start + size, priority: SNAP_PRIORITY.edge },
    );
  }
  return targets;
}

export function snapResizeAxisToGrid(
  center: number,
  size: number,
  side: ResizeSide,
  spacing: number,
  offset: number,
  centered: boolean,
  threshold: number,
  priority: number,
): ResizeAxisSnap | null {
  const moving = center + (side === 'end' ? size / 2 : -size / 2);
  return snapResizeAxis(
    center,
    size,
    side,
    [{ position: snapCoordToGrid(moving, spacing, offset), priority }],
    centered,
    threshold,
  );
}
