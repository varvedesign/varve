import { compete, SNAP_PRIORITY, type SnapCandidateState } from './candidates';
import type { GridSnapConfig } from './types';

export function snapCoordToGrid(value: number, spacing: number, offset = 0): number {
  if (spacing <= 0) return value;
  return Math.round((value - offset) / spacing) * spacing + offset;
}

export function snapPointToRotatedGrid(
  x: number,
  y: number,
  grid: GridSnapConfig,
): [number, number] {
  const rotation = Number.isFinite(grid.rotation) ? (grid.rotation ?? 0) : 0;
  if (rotation === 0) {
    return [
      snapCoordToGrid(x, grid.spacingX, grid.offsetX ?? 0),
      snapCoordToGrid(y, grid.spacingY, grid.offsetY ?? 0),
    ];
  }
  const originX = grid.offsetX ?? 0;
  const originY = grid.offsetY ?? 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const dx = x - originX;
  const dy = y - originY;
  const localX = dx * cos + dy * sin + originX;
  const localY = -dx * sin + dy * cos + originY;
  const snappedLocalX = snapCoordToGrid(localX, grid.spacingX, originX);
  const snappedLocalY = snapCoordToGrid(localY, grid.spacingY, originY);
  return [
    originX + (snappedLocalX - originX) * cos - (snappedLocalY - originY) * sin,
    originY + (snappedLocalX - originX) * sin + (snappedLocalY - originY) * cos,
  ];
}

export function applyGridCandidate(state: SnapCandidateState, grid: number | GridSnapConfig): void {
  const gridConfig = typeof grid === 'number' ? { spacingX: grid, spacingY: grid } : grid;
  if (gridConfig.spacingX > 0 && gridConfig.spacingY > 0) {
    const [gx, gy] = snapPointToRotatedGrid(state.x, state.y, gridConfig);
    const dx = Math.abs(gx - state.x);
    const dy = Math.abs(gy - state.y);
    const prio = SNAP_PRIORITY.grid;
    if (dx < state.thresh && compete(prio, dx, state.bestXPriority, state.bestXDiff)) {
      state.bestXDiff = dx;
      state.bestXSnap = gx;
      state.bestXGuide = {
        axis: 'vertical',
        position: gx,
        label: `${gx}px`,
        type: 'edge',
        targetId: 'grid:x',
        sourceFeature: 'left',
        targetFeature: 'grid',
        referenceSpace: 'world',
        correction: gx - state.x,
      };
      state.bestXPriority = prio;
    }
    if (dy < state.thresh && compete(prio, dy, state.bestYPriority, state.bestYDiff)) {
      state.bestYDiff = dy;
      state.bestYSnap = gy;
      state.bestYGuide = {
        axis: 'horizontal',
        position: gy,
        label: `${gy}px`,
        type: 'edge',
        targetId: 'grid:y',
        sourceFeature: 'top',
        targetFeature: 'grid',
        referenceSpace: 'world',
        correction: gy - state.y,
      };
      state.bestYPriority = prio;
    }
  }
}

export function applyLayoutGridStepCandidate(state: SnapCandidateState, step: number): void {
  const lx = Math.round(state.x / step) * step;
  const ly = Math.round(state.y / step) * step;
  const dx = Math.abs(lx - state.x);
  const dy = Math.abs(ly - state.y);
  const prio = SNAP_PRIORITY.layoutGrid;
  if (dx < state.thresh && compete(prio, dx, state.bestXPriority, state.bestXDiff)) {
    state.bestXDiff = dx;
    state.bestXSnap = lx;
    state.bestXGuide = {
      axis: 'vertical',
      position: lx,
      type: 'edge',
      targetId: 'layout-grid:x',
      sourceFeature: 'left',
      targetFeature: 'layout-grid',
      referenceSpace: 'world',
      correction: lx - state.x,
    };
    state.bestXPriority = prio;
  }
  if (dy < state.thresh && compete(prio, dy, state.bestYPriority, state.bestYDiff)) {
    state.bestYDiff = dy;
    state.bestYSnap = ly;
    state.bestYGuide = {
      axis: 'horizontal',
      position: ly,
      type: 'edge',
      targetId: 'layout-grid:y',
      sourceFeature: 'top',
      targetFeature: 'layout-grid',
      referenceSpace: 'world',
      correction: ly - state.y,
    };
    state.bestYPriority = prio;
  }
}

export function applyPixelGridCandidate(state: SnapCandidateState): void {
  const px = Math.round(state.x);
  const py = Math.round(state.y);
  const dx = Math.abs(px - state.x);
  const dy = Math.abs(py - state.y);
  const prio = SNAP_PRIORITY.grid; // Use same priority as document grid
  if (dx < state.thresh && compete(prio, dx, state.bestXPriority, state.bestXDiff)) {
    state.bestXDiff = dx;
    state.bestXSnap = px;
    state.bestXGuide = {
      axis: 'vertical',
      position: px,
      label: `${px}px`,
      type: 'edge',
      targetId: 'pixel-grid:x',
      sourceFeature: 'left',
      targetFeature: 'pixel-grid',
      referenceSpace: 'world',
      correction: px - state.x,
    };
    state.bestXPriority = prio;
  }
  if (dy < state.thresh && compete(prio, dy, state.bestYPriority, state.bestYDiff)) {
    state.bestYDiff = dy;
    state.bestYSnap = py;
    state.bestYGuide = {
      axis: 'horizontal',
      position: py,
      label: `${py}px`,
      type: 'edge',
      targetId: 'pixel-grid:y',
      sourceFeature: 'top',
      targetFeature: 'pixel-grid',
      referenceSpace: 'world',
      correction: py - state.y,
    };
    state.bestYPriority = prio;
  }
}
