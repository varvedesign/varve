import {
  compete,
  findClosest,
  findClosestGap,
  formatSnapValue,
  SNAP_PRIORITY,
  type SnapCandidateState,
} from './candidates';
import type { NormalizedSnapTarget } from './types';

export function applyMidpointCandidates(
  state: SnapCandidateState,
  activeBounds: Array<{ x: number; y: number; w: number; h: number }>,
  activeTargets: NormalizedSnapTarget[],
): void {
  const n = activeBounds.length;
  const centersX: number[] = new Array(n);
  const centersY: number[] = new Array(n);
  const targetIds = activeTargets.map((target) => target.id);
  for (let i = 0; i < n; i++) {
    const b = activeBounds[i]!;
    centersX[i] = b.x + b.w / 2;
    centersY[i] = b.y + b.h / 2;
  }
  const xOrder = Array.from({ length: n }, (_, i) => i).sort((i, j) => centersX[i]! - centersX[j]!);
  const yOrder = Array.from({ length: n }, (_, i) => i).sort((i, j) => centersY[i]! - centersY[j]!);
  const sortedX = xOrder.map((i) => centersX[i]!);
  const sortedY = yOrder.map((i) => centersY[i]!);
  const prio = SNAP_PRIORITY.midpoint;

  for (let i = 0; i < n; i++) {
    const xTarget = 2 * state.cx - centersX[i]!;
    const xPartner = findClosest(sortedX, xOrder, xTarget, i);
    if (xPartner !== -1) {
      const midX = (centersX[i]! + centersX[xPartner]!) / 2;
      const dmx = Math.abs(state.cx - midX);
      if (dmx < state.thresh && compete(prio, dmx, state.bestXPriority, state.bestXDiff)) {
        state.bestXDiff = dmx;
        state.bestXSnap = state.x - (state.cx - midX);
        state.bestXGuide = {
          axis: 'vertical',
          position: midX,
          type: 'midpoint',
          label: 'mid',
          targetId: `midpoint:${[targetIds[i]!, targetIds[xPartner]!].sort().join(':')}`,
          sourceFeature: 'centerX',
          targetFeature: 'midpoint',
          referenceSpace: 'world',
          correction: -(state.cx - midX),
        };
        state.bestXPriority = prio;
      }
    }
    const yTarget = 2 * state.cy - centersY[i]!;
    const yPartner = findClosest(sortedY, yOrder, yTarget, i);
    if (yPartner !== -1) {
      const midY = (centersY[i]! + centersY[yPartner]!) / 2;
      const dmy = Math.abs(state.cy - midY);
      if (dmy < state.thresh && compete(prio, dmy, state.bestYPriority, state.bestYDiff)) {
        state.bestYDiff = dmy;
        state.bestYSnap = state.y - (state.cy - midY);
        state.bestYGuide = {
          axis: 'horizontal',
          position: midY,
          type: 'midpoint',
          label: 'mid',
          targetId: `midpoint:${[targetIds[i]!, targetIds[yPartner]!].sort().join(':')}`,
          sourceFeature: 'centerY',
          targetFeature: 'midpoint',
          referenceSpace: 'world',
          correction: -(state.cy - midY),
        };
        state.bestYPriority = prio;
      }
    }
  }
}

export function applyObjectEdgeCandidates(
  state: SnapCandidateState,
  activeTargets: NormalizedSnapTarget[],
): void {
  for (const target of activeTargets) {
    const b = target.bounds;
    const bCX = b.x + b.w / 2;
    const bCY = b.y + b.h / 2;
    const bEdges = {
      left: b.x,
      right: b.x + b.w,
      centerX: bCX,
      top: b.y,
      bottom: b.y + b.h,
      centerY: bCY,
    };

    for (const key of ['left', 'centerX', 'right'] as const) {
      const diff = state.edges[key] - bEdges[key];
      const absDiff = Math.abs(diff);
      const prio = key === 'centerX' ? SNAP_PRIORITY.center : SNAP_PRIORITY.edge;
      if (absDiff < state.thresh && compete(prio, absDiff, state.bestXPriority, state.bestXDiff)) {
        state.bestXDiff = absDiff;
        state.bestXSnap = state.x - diff;
        state.bestXGuide = {
          axis: 'vertical',
          position: bEdges[key],
          distance: absDiff,
          type: key === 'centerX' ? 'center' : 'edge',
          targetId: target.id,
          sourceFeature: key,
          targetFeature: key,
          referenceSpace: 'world',
          correction: -diff,
        };
        state.bestXPriority = prio;
      }
    }

    for (const key of ['top', 'centerY', 'bottom'] as const) {
      const diff = state.edges[key] - bEdges[key];
      const absDiff = Math.abs(diff);
      const prio = key === 'centerY' ? SNAP_PRIORITY.center : SNAP_PRIORITY.edge;
      if (absDiff < state.thresh && compete(prio, absDiff, state.bestYPriority, state.bestYDiff)) {
        state.bestYDiff = absDiff;
        state.bestYSnap = state.y - diff;
        state.bestYGuide = {
          axis: 'horizontal',
          position: bEdges[key],
          distance: absDiff,
          type: key === 'centerY' ? 'center' : 'edge',
          targetId: target.id,
          sourceFeature: key,
          targetFeature: key,
          referenceSpace: 'world',
          correction: -diff,
        };
        state.bestYPriority = prio;
      }
    }
  }
}

export function applySpacingCandidates(
  state: SnapCandidateState,
  activeTargets: NormalizedSnapTarget[],
): void {
  const n = activeTargets.length;
  const rightEdges: number[] = new Array(n);
  const bottomEdges: number[] = new Array(n);
  const leftEdges: number[] = new Array(n);
  const topEdges: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const b = activeTargets[i]!.bounds;
    rightEdges[i] = b.x + b.w;
    bottomEdges[i] = b.y + b.h;
    leftEdges[i] = b.x;
    topEdges[i] = b.y;
  }
  const xOrder = Array.from({ length: n }, (_, i) => i).sort(
    (i, j) => leftEdges[i]! - leftEdges[j]!,
  );
  const yOrder = Array.from({ length: n }, (_, i) => i).sort((i, j) => topEdges[i]! - topEdges[j]!);
  const sortedLeft = xOrder.map((i) => leftEdges[i]!);
  const sortedTop = yOrder.map((i) => topEdges[i]!);
  const prio = SNAP_PRIORITY.spacing;
  const preciseSpacingLabel = activeTargets.some((target) => target.explicitId);

  let bestXGap: { mid: number; gap: number; obj: number; targetId: string } | null = null;
  for (let i = 0; i < n; i++) {
    const ra = rightEdges[i]!;
    if (!(ra < state.cx)) continue;
    const target = 3 * ra - 2 * state.cx;
    const j = findClosestGap(sortedLeft, xOrder, target, i, state.cx);
    if (j === -1) continue;
    const mid = (ra + leftEdges[j]!) / 2;
    const gap = leftEdges[j]! - ra;
    const obj = Math.abs(gap - (mid - state.cx));
    const targetId = `spacing:${[activeTargets[i]!.id, activeTargets[j]!.id].sort().join(':')}`;
    if (
      bestXGap === null ||
      obj < bestXGap.obj ||
      (obj === bestXGap.obj && targetId.localeCompare(bestXGap.targetId) < 0)
    ) {
      bestXGap = { mid, gap, obj, targetId };
    }
  }
  if (bestXGap) {
    const dmx = Math.abs(state.cx - bestXGap.mid);
    if (dmx < state.thresh * 3 && compete(prio, dmx, state.bestXPriority, state.bestXDiff)) {
      state.bestXDiff = dmx;
      state.bestXSnap = state.x - (state.cx - bestXGap.mid);
      state.bestXGuide = {
        axis: 'vertical',
        position: bestXGap.mid,
        type: 'spacing',
        label: `${preciseSpacingLabel ? formatSnapValue(bestXGap.gap) : Math.round(bestXGap.gap)}px`,
        targetId: bestXGap.targetId,
        sourceFeature: 'centerX',
        targetFeature: 'spacing-gap',
        referenceSpace: 'world',
        correction: -(state.cx - bestXGap.mid),
      };
      state.bestXPriority = prio;
    }
  }

  let bestYGap: { mid: number; gap: number; obj: number; targetId: string } | null = null;
  for (let i = 0; i < n; i++) {
    const ba = bottomEdges[i]!;
    if (!(ba < state.cy)) continue;
    const target = 3 * ba - 2 * state.cy;
    const j = findClosestGap(sortedTop, yOrder, target, i, state.cy);
    if (j === -1) continue;
    const mid = (ba + topEdges[j]!) / 2;
    const gap = topEdges[j]! - ba;
    const obj = Math.abs(gap - (mid - state.cy));
    const targetId = `spacing:${[activeTargets[i]!.id, activeTargets[j]!.id].sort().join(':')}`;
    if (
      bestYGap === null ||
      obj < bestYGap.obj ||
      (obj === bestYGap.obj && targetId.localeCompare(bestYGap.targetId) < 0)
    ) {
      bestYGap = { mid, gap, obj, targetId };
    }
  }
  if (bestYGap) {
    const dmy = Math.abs(state.cy - bestYGap.mid);
    if (dmy < state.thresh * 3 && compete(prio, dmy, state.bestYPriority, state.bestYDiff)) {
      state.bestYDiff = dmy;
      state.bestYSnap = state.y - (state.cy - bestYGap.mid);
      state.bestYGuide = {
        axis: 'horizontal',
        position: bestYGap.mid,
        type: 'spacing',
        label: `${preciseSpacingLabel ? formatSnapValue(bestYGap.gap) : Math.round(bestYGap.gap)}px`,
        targetId: bestYGap.targetId,
        sourceFeature: 'centerY',
        targetFeature: 'spacing-gap',
        referenceSpace: 'world',
        correction: -(state.cy - bestYGap.mid),
      };
      state.bestYPriority = prio;
    }
  }
}
