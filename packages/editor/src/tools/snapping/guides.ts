import { compete, SNAP_PRIORITY, type SnapCandidateState } from './candidates';
import type { SnapGuide, SnapSegmentTarget } from './types';

interface LineSnapCandidate {
  axis: 'horizontal' | 'vertical';
  position: number;
  distance: number;
  snapped: number;
  guide: SnapGuide;
}

const VERTICAL_SOURCE_FEATURES = ['left', 'centerX', 'right'] as const;
const HORIZONTAL_SOURCE_FEATURES = ['top', 'centerY', 'bottom'] as const;

function closestLineSnapCandidate(
  x: number,
  y: number,
  w: number,
  h: number,
  target: { axis: 'horizontal' | 'vertical'; position: number; id?: string },
  threshold: number,
  type: SnapGuide['type'],
  label: string,
): LineSnapCandidate | null {
  const values =
    target.axis === 'vertical'
      ? ([x, x + w / 2, x + w] as const)
      : ([y, y + h / 2, y + h] as const);
  const sourceFeatures =
    target.axis === 'vertical' ? VERTICAL_SOURCE_FEATURES : HORIZONTAL_SOURCE_FEATURES;
  let bestValue = values[0]!;
  let bestSourceFeature: (typeof sourceFeatures)[number] = sourceFeatures[0]!;
  let bestDistance = Math.abs(bestValue - target.position);
  for (let index = 1; index < values.length; index++) {
    const value = values[index]!;
    const distance = Math.abs(value - target.position);
    if (distance < bestDistance) {
      bestValue = value;
      bestSourceFeature = sourceFeatures[index]!;
      bestDistance = distance;
    }
  }
  if (bestDistance >= threshold) return null;
  const metadata = target.id
    ? {
        targetId: target.id,
        sourceFeature: bestSourceFeature,
        targetFeature: type === 'guide' ? 'guide' : (type ?? 'target-line'),
        referenceSpace: 'world' as const,
        correction: -(bestValue - target.position),
      }
    : {};
  return {
    axis: target.axis,
    position: target.position,
    distance: bestDistance,
    snapped:
      target.axis === 'vertical'
        ? x - (bestValue - target.position)
        : y - (bestValue - target.position),
    guide: {
      axis: target.axis,
      position: target.position,
      distance: bestDistance,
      type,
      label,
      ...metadata,
    },
  };
}

export function closestSegmentSnapCandidate(
  x: number,
  y: number,
  w: number,
  h: number,
  target: SnapSegmentTarget,
  threshold: number,
): { dx: number; dy: number; distance: number; guide: SnapGuide } | null {
  const vx = target.end.x - target.start.x;
  const vy = target.end.y - target.start.y;
  const lengthSquared = vx * vx + vy * vy;
  if (!(lengthSquared > 1e-12) || !Number.isFinite(lengthSquared)) return null;
  const features = [
    { x, y, name: 'top-left' },
    { x: x + w, y, name: 'top-right' },
    { x, y: y + h, name: 'bottom-left' },
    { x: x + w, y: y + h, name: 'bottom-right' },
    { x: x + w / 2, y: y + h / 2, name: 'center' },
  ];
  let best: { dx: number; dy: number; distance: number; feature: string } | null = null;
  for (const feature of features) {
    const t = Math.max(
      0,
      Math.min(
        1,
        ((feature.x - target.start.x) * vx + (feature.y - target.start.y) * vy) / lengthSquared,
      ),
    );
    const px = target.start.x + t * vx;
    const py = target.start.y + t * vy;
    const dx = px - feature.x;
    const dy = py - feature.y;
    const distance = Math.hypot(dx, dy);
    if (!best || distance < best.distance) best = { dx, dy, distance, feature: feature.name };
  }
  if (!best || best.distance >= threshold) return null;
  const axis = Math.abs(vx) >= Math.abs(vy) ? 'horizontal' : 'vertical';
  return {
    ...best,
    guide: {
      axis,
      position: axis === 'horizontal' ? target.start.y : target.start.x,
      distance: best.distance,
      label: 'Layout guide',
      type: target.type ?? 'layout-grid',
      ...(target.id
        ? {
            targetId: target.id,
            sourceFeature: best.feature,
            targetFeature: 'segment',
            referenceSpace: 'world' as const,
            correction: axis === 'horizontal' ? best.dy : best.dx,
            point: {
              x: best.dx + features.find((feature) => feature.name === best.feature)!.x,
              y: best.dy + features.find((feature) => feature.name === best.feature)!.y,
            },
            segment: { start: target.start, end: target.end },
          }
        : {}),
    },
  };
}

export function applyLayoutGridLineCandidates(
  state: SnapCandidateState,
  layoutGridTargets: Array<{ axis: 'horizontal' | 'vertical'; position: number; id?: string }>,
): void {
  const prio = SNAP_PRIORITY.layoutGrid;
  let bestLayoutX: LineSnapCandidate | null = null;
  let bestLayoutY: LineSnapCandidate | null = null;
  for (const target of layoutGridTargets) {
    const candidate = closestLineSnapCandidate(
      state.x,
      state.y,
      state.w,
      state.h,
      target,
      state.thresh,
      'layout-grid',
      'layout guide',
    );
    if (!candidate) continue;
    if (candidate.axis === 'vertical') {
      if (!bestLayoutX || candidate.distance < bestLayoutX.distance) bestLayoutX = candidate;
    } else if (!bestLayoutY || candidate.distance < bestLayoutY.distance) {
      bestLayoutY = candidate;
    }
  }
  if (bestLayoutX && compete(prio, bestLayoutX.distance, state.bestXPriority, state.bestXDiff)) {
    state.bestXDiff = bestLayoutX.distance;
    state.bestXSnap = bestLayoutX.snapped;
    state.bestXGuide = bestLayoutX.guide;
    state.bestXPriority = prio;
  }
  if (bestLayoutY && compete(prio, bestLayoutY.distance, state.bestYPriority, state.bestYDiff)) {
    state.bestYDiff = bestLayoutY.distance;
    state.bestYSnap = bestLayoutY.snapped;
    state.bestYGuide = bestLayoutY.guide;
    state.bestYPriority = prio;
  }
}

export function applyRulerGuideCandidates(
  state: SnapCandidateState,
  guideTargets: Array<{ axis: 'horizontal' | 'vertical'; position: number; id?: string }>,
): void {
  for (const guide of guideTargets) {
    const prio = SNAP_PRIORITY.guide;
    if (guide.axis === 'vertical') {
      for (const key of ['left', 'centerX', 'right'] as const) {
        const diff = state.edges[key] - guide.position;
        const absDiff = Math.abs(diff);
        if (
          absDiff < state.thresh &&
          compete(prio, absDiff, state.bestXPriority, state.bestXDiff)
        ) {
          state.bestXDiff = absDiff;
          state.bestXSnap = state.x - diff;
          state.bestXGuide = {
            axis: 'vertical',
            position: guide.position,
            distance: absDiff,
            type: 'guide',
            label: 'guide',
            ...(guide.id
              ? {
                  targetId: guide.id,
                  sourceFeature: key,
                  targetFeature: 'guide',
                  referenceSpace: 'world' as const,
                  correction: -diff,
                }
              : {}),
          };
          state.bestXPriority = prio;
        }
      }
    } else {
      for (const key of ['top', 'centerY', 'bottom'] as const) {
        const diff = state.edges[key] - guide.position;
        const absDiff = Math.abs(diff);
        if (
          absDiff < state.thresh &&
          compete(prio, absDiff, state.bestYPriority, state.bestYDiff)
        ) {
          state.bestYDiff = absDiff;
          state.bestYSnap = state.y - diff;
          state.bestYGuide = {
            axis: 'horizontal',
            position: guide.position,
            distance: absDiff,
            type: 'guide',
            label: 'guide',
            ...(guide.id
              ? {
                  targetId: guide.id,
                  sourceFeature: key,
                  targetFeature: 'guide',
                  referenceSpace: 'world' as const,
                  correction: -diff,
                }
              : {}),
          };
          state.bestYPriority = prio;
        }
      }
    }
  }
}
