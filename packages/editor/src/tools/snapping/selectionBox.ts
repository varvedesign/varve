import type { SelectionBox } from '@varve/shared';

import { compete, SNAP_PRIORITY } from './candidates';
import { snapCoordToGrid } from './grid';
import { snapPosition } from './position';
import {
  lineAxisTargets,
  lineTargetPriority,
  objectAxisTargets,
  preserveProportionalResize,
  type ResizeAxisSnap,
  resizeSideForHandle,
  snapResizeAxis,
  snapResizeAxisToGrid,
  snapSize,
} from './resize';
import { thresholdWorld } from './targets';
import type { SnapBoxOptions } from './types';

/** Snap a selection box (position and size) to other bounds. */
export function snapSelectionBox(box: SelectionBox, options: SnapBoxOptions = {}): SelectionBox {
  const {
    zoom = 1,
    tolerancePx,
    otherBounds = [],
    resizeHandle,
    resizeCentered = false,
    resizeProportional = false,
    grid,
    layoutGridStep,
    pixelGridSnap,
    lineTargets = [],
    layoutGuideSegments = [],
  } = options;
  const thresh = thresholdWorld(zoom, tolerancePx);

  let snappedCx = box.cx;
  let snappedCy = box.cy;
  let snappedW = box.w;
  let snappedH = box.h;

  let bestXDiff = Infinity;
  let bestXPriority = -1;
  let bestYDiff = Infinity;
  let bestYPriority = -1;
  const isAxisAligned = Math.abs(Math.sin(box.rotation)) < 1e-9;
  const resizeX = resizeHandle ? resizeSideForHandle(resizeHandle, 'x') : null;
  const resizeY = resizeHandle ? resizeSideForHandle(resizeHandle, 'y') : null;
  const canSnapResizeAxes = isAxisAligned && (resizeX !== null || resizeY !== null);

  // Use the same-anchor edge/center matching as move snapping. Resize
  // gestures already call this resolver through TransformEngine, so teaching
  // this path about edges fixes handle-drag snapping without inventing a
  // parallel candidate model. An oriented box has no world-axis-aligned edges
  // at arbitrary rotation; its centre is still meaningful, but edge matching
  // is intentionally restricted to axis-aligned selections.
  let xResizeSnap: ResizeAxisSnap | null = null;
  let yResizeSnap: ResizeAxisSnap | null = null;
  if (otherBounds.length > 0 || lineTargets.length > 0) {
    if (canSnapResizeAxes && resizeX) {
      const snap = snapResizeAxis(
        box.cx,
        box.w,
        resizeX,
        [...objectAxisTargets(otherBounds, 'x'), ...lineAxisTargets(lineTargets, 'x')],
        resizeCentered,
        thresh,
      );
      if (snap) {
        xResizeSnap = snap;
        snappedCx = snap.center;
        snappedW = snap.size;
        bestXDiff = snap.diff;
        bestXPriority = snap.priority;
      }
    }
    if (canSnapResizeAxes && resizeY) {
      const snap = snapResizeAxis(
        box.cy,
        box.h,
        resizeY,
        [...objectAxisTargets(otherBounds, 'y'), ...lineAxisTargets(lineTargets, 'y')],
        resizeCentered,
        thresh,
      );
      if (snap) {
        yResizeSnap = snap;
        snappedCy = snap.center;
        snappedH = snap.size;
        bestYDiff = snap.diff;
        bestYPriority = snap.priority;
      }
    }
    if (!resizeHandle) {
      const boxEdges = {
        left: box.cx - box.w / 2,
        right: box.cx + box.w / 2,
        centerX: box.cx,
        top: box.cy - box.h / 2,
        bottom: box.cy + box.h / 2,
        centerY: box.cy,
      };
      for (const b of otherBounds) {
        const targetEdges = {
          left: b.x,
          right: b.x + b.w,
          centerX: b.x + b.w / 2,
          top: b.y,
          bottom: b.y + b.h,
          centerY: b.y + b.h / 2,
        };

        for (const key of ['left', 'centerX', 'right'] as const) {
          if (!isAxisAligned && key !== 'centerX') continue;
          const diff = boxEdges[key] - targetEdges[key];
          const absDiff = Math.abs(diff);
          const priority = key === 'centerX' ? SNAP_PRIORITY.center : SNAP_PRIORITY.edge;
          if (absDiff < thresh && compete(priority, absDiff, bestXPriority, bestXDiff)) {
            bestXDiff = absDiff;
            bestXPriority = priority;
            snappedCx = box.cx - diff;
          }
        }

        for (const key of ['top', 'centerY', 'bottom'] as const) {
          if (!isAxisAligned && key !== 'centerY') continue;
          const diff = boxEdges[key] - targetEdges[key];
          const absDiff = Math.abs(diff);
          const priority = key === 'centerY' ? SNAP_PRIORITY.center : SNAP_PRIORITY.edge;
          if (absDiff < thresh && compete(priority, absDiff, bestYPriority, bestYDiff)) {
            bestYDiff = absDiff;
            bestYPriority = priority;
            snappedCy = box.cy - diff;
          }
        }
      }
      for (const target of lineTargets) {
        const targetPriority = lineTargetPriority(target.type);
        if (target.axis === 'vertical') {
          for (const key of ['left', 'centerX', 'right'] as const) {
            const diff = boxEdges[key] - target.position;
            const absDiff = Math.abs(diff);
            if (absDiff < thresh && compete(targetPriority, absDiff, bestXPriority, bestXDiff)) {
              bestXDiff = absDiff;
              bestXPriority = targetPriority;
              snappedCx = box.cx - diff;
            }
          }
        } else {
          for (const key of ['top', 'centerY', 'bottom'] as const) {
            const diff = boxEdges[key] - target.position;
            const absDiff = Math.abs(diff);
            if (absDiff < thresh && compete(targetPriority, absDiff, bestYPriority, bestYDiff)) {
              bestYDiff = absDiff;
              bestYPriority = targetPriority;
              snappedCy = box.cy - diff;
            }
          }
        }
      }
    }
  }

  // Snap to grid (higher priority than center)
  if (canSnapResizeAxes && grid !== undefined && grid !== null) {
    const gridConfig = typeof grid === 'number' ? { spacingX: grid, spacingY: grid } : grid;
    if (gridConfig.spacingX > 0 && gridConfig.spacingY > 0) {
      if (resizeX) {
        const snap = snapResizeAxisToGrid(
          box.cx,
          box.w,
          resizeX,
          gridConfig.spacingX,
          gridConfig.offsetX ?? 0,
          resizeCentered,
          thresh,
          SNAP_PRIORITY.grid,
        );
        if (snap && compete(snap.priority, snap.diff, bestXPriority, bestXDiff)) {
          xResizeSnap = snap;
          snappedCx = snap.center;
          snappedW = snap.size;
          bestXDiff = snap.diff;
          bestXPriority = snap.priority;
        }
      }
      if (resizeY) {
        const snap = snapResizeAxisToGrid(
          box.cy,
          box.h,
          resizeY,
          gridConfig.spacingY,
          gridConfig.offsetY ?? 0,
          resizeCentered,
          thresh,
          SNAP_PRIORITY.grid,
        );
        if (snap && compete(snap.priority, snap.diff, bestYPriority, bestYDiff)) {
          yResizeSnap = snap;
          snappedCy = snap.center;
          snappedH = snap.size;
          bestYDiff = snap.diff;
          bestYPriority = snap.priority;
        }
      }
    }
  } else if (!resizeHandle && grid !== undefined && grid !== null) {
    const gridConfig = typeof grid === 'number' ? { spacingX: grid, spacingY: grid } : grid;
    if (gridConfig.spacingX > 0 && gridConfig.spacingY > 0) {
      const offsetX = gridConfig.offsetX ?? 0;
      const offsetY = gridConfig.offsetY ?? 0;
      const gridCx = snapCoordToGrid(box.cx, gridConfig.spacingX, offsetX);
      const gridCy = snapCoordToGrid(box.cy, gridConfig.spacingY, offsetY);
      const dx = Math.abs(gridCx - box.cx);
      const dy = Math.abs(gridCy - box.cy);
      if (dx < thresh && compete(SNAP_PRIORITY.grid, dx, bestXPriority, bestXDiff)) {
        bestXDiff = dx;
        bestXPriority = SNAP_PRIORITY.grid;
        snappedCx = gridCx;
      }
      if (dy < thresh && compete(SNAP_PRIORITY.grid, dy, bestYPriority, bestYDiff)) {
        bestYDiff = dy;
        bestYPriority = SNAP_PRIORITY.grid;
        snappedCy = gridCy;
      }
    }
  }

  // Snap to pixel grid (snaps to integer pixel coordinates)
  if (canSnapResizeAxes && pixelGridSnap) {
    if (resizeX) {
      const snap = snapResizeAxisToGrid(
        box.cx,
        box.w,
        resizeX,
        1,
        0,
        resizeCentered,
        thresh,
        SNAP_PRIORITY.grid,
      );
      if (snap && compete(snap.priority, snap.diff, bestXPriority, bestXDiff)) {
        xResizeSnap = snap;
        snappedCx = snap.center;
        snappedW = snap.size;
        bestXDiff = snap.diff;
        bestXPriority = snap.priority;
      }
    }
    if (resizeY) {
      const snap = snapResizeAxisToGrid(
        box.cy,
        box.h,
        resizeY,
        1,
        0,
        resizeCentered,
        thresh,
        SNAP_PRIORITY.grid,
      );
      if (snap && compete(snap.priority, snap.diff, bestYPriority, bestYDiff)) {
        yResizeSnap = snap;
        snappedCy = snap.center;
        snappedH = snap.size;
        bestYDiff = snap.diff;
        bestYPriority = snap.priority;
      }
    }
  } else if (!resizeHandle && pixelGridSnap) {
    const px = Math.round(box.cx);
    const py = Math.round(box.cy);
    const dx = Math.abs(px - box.cx);
    const dy = Math.abs(py - box.cy);
    if (dx < thresh && compete(SNAP_PRIORITY.grid, dx, bestXPriority, bestXDiff)) {
      bestXDiff = dx;
      bestXPriority = SNAP_PRIORITY.grid;
      snappedCx = px;
    }
    if (dy < thresh && compete(SNAP_PRIORITY.grid, dy, bestYPriority, bestYDiff)) {
      bestYDiff = dy;
      bestYPriority = SNAP_PRIORITY.grid;
      snappedCy = py;
    }
  }

  // Snap to layout grid
  if (canSnapResizeAxes && layoutGridStep && layoutGridStep > 0) {
    if (resizeX) {
      const snap = snapResizeAxisToGrid(
        box.cx,
        box.w,
        resizeX,
        layoutGridStep,
        0,
        resizeCentered,
        thresh,
        SNAP_PRIORITY.layoutGrid,
      );
      if (snap && compete(snap.priority, snap.diff, bestXPriority, bestXDiff)) {
        xResizeSnap = snap;
        snappedCx = snap.center;
        snappedW = snap.size;
        bestXDiff = snap.diff;
        bestXPriority = snap.priority;
      }
    }
    if (resizeY) {
      const snap = snapResizeAxisToGrid(
        box.cy,
        box.h,
        resizeY,
        layoutGridStep,
        0,
        resizeCentered,
        thresh,
        SNAP_PRIORITY.layoutGrid,
      );
      if (snap && compete(snap.priority, snap.diff, bestYPriority, bestYDiff)) {
        yResizeSnap = snap;
        snappedCy = snap.center;
        snappedH = snap.size;
        bestYDiff = snap.diff;
        bestYPriority = snap.priority;
      }
    }
  } else if (!resizeHandle && layoutGridStep && layoutGridStep > 0) {
    const step = layoutGridStep;
    const lx = Math.round(box.cx / step) * step;
    const ly = Math.round(box.cy / step) * step;
    const dx = Math.abs(lx - box.cx);
    const dy = Math.abs(ly - box.cy);
    if (dx < thresh && compete(SNAP_PRIORITY.layoutGrid, dx, bestXPriority, bestXDiff)) {
      bestXDiff = dx;
      bestXPriority = SNAP_PRIORITY.layoutGrid;
      snappedCx = lx;
    }
    if (dy < thresh && compete(SNAP_PRIORITY.layoutGrid, dy, bestYPriority, bestYDiff)) {
      bestYDiff = dy;
      bestYPriority = SNAP_PRIORITY.layoutGrid;
      snappedCy = ly;
    }
  }

  if (!resizeHandle && layoutGuideSegments.length > 0) {
    const segmentSnap = snapPosition(
      box.cx - box.w / 2,
      box.cy - box.h / 2,
      box.w,
      box.h,
      [],
      undefined,
      undefined,
      { zoom, tolerancePx, layoutGuideSegments, sticky: false },
    );
    if (segmentSnap.x !== box.cx - box.w / 2 || segmentSnap.y !== box.cy - box.h / 2) {
      snappedCx = segmentSnap.x + box.w / 2;
      snappedCy = segmentSnap.y + box.h / 2;
    }
  }

  // Snap size
  // Object-edge snapping may already have changed a resize dimension. Match
  // size against that resolved result so an unchanged perpendicular dimension
  // cannot restore the pre-snap width or height.
  if (resizeProportional && resizeHandle && canSnapResizeAxes) {
    const proportional = preserveProportionalResize(
      box,
      { cx: snappedCx, cy: snappedCy, w: snappedW, h: snappedH, rotation: box.rotation },
      resizeX,
      resizeY,
      xResizeSnap,
      yResizeSnap,
      resizeCentered,
    );
    snappedCx = proportional.cx;
    snappedCy = proportional.cy;
    snappedW = proportional.w;
    snappedH = proportional.h;
  } else {
    const sizeSnap = snapSize(snappedW, snappedH, otherBounds, zoom, tolerancePx);
    if (sizeSnap.matched) {
      snappedW = sizeSnap.w;
      snappedH = sizeSnap.h;
    }
  }

  return {
    cx: snappedCx,
    cy: snappedCy,
    w: snappedW,
    h: snappedH,
    rotation: box.rotation,
  };
}
