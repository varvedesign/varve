import type { SnapGuide } from './types';

export const SNAP_PRIORITY = {
  grid: 100,
  guide: 90,
  layoutGrid: 85,
  edge: 80,
  center: 70,
  midpoint: 50,
  spacing: 30,
} as const;

export function formatSnapValue(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

/** Compete a new snap candidate; returns true if it wins (higher priority or same priority + closer). */
export function compete(
  candidatePrio: number,
  candidateDiff: number,
  bestPrio: number,
  bestDiff: number,
): boolean {
  return candidatePrio > bestPrio || (candidatePrio === bestPrio && candidateDiff < bestDiff);
}

/**
 * Binary-search the index whose sorted value is closest to `target`, excluding
 * `exclude`. Ties resolve to the smallest original index, matching the
 * pair-scan iteration order of the canonical O(k²) evaluators this replaces.
 * Returns -1 when the only candidate is the excluded index itself.
 */
export function findClosest(
  sorted: number[],
  order: number[],
  target: number,
  exclude: number,
): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  let best = -1;
  let bestDiff = Infinity;
  for (const idx of [lo - 1, lo]) {
    if (idx < 0 || idx >= sorted.length) continue;
    const orig = order[idx]!;
    if (orig === exclude) continue;
    const d = Math.abs(sorted[idx]! - target);
    if (best === -1 || d < bestDiff || (d === bestDiff && orig < order[best]!)) {
      best = idx;
      bestDiff = d;
    }
  }
  return best === -1 ? -1 : order[best]!;
}

/**
 * Find the partner index minimizing |sorted[idx] - target| among entries with
 * value strictly greater than `min` (used for gap snap candidates that must
 * straddle the moving center). Same tie-breaking as {@link findClosest}.
 */
export function findClosestGap(
  sorted: number[],
  order: number[],
  target: number,
  exclude: number,
  min: number,
): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= min) lo = mid + 1;
    else hi = mid;
  }
  const start = lo;
  lo = start;
  hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  let best = -1;
  let bestDiff = Infinity;
  for (const idx of [lo - 1, lo]) {
    if (idx < start || idx >= sorted.length) continue;
    const orig = order[idx]!;
    if (orig === exclude) continue;
    const d = Math.abs(sorted[idx]! - target);
    if (best === -1 || d < bestDiff || (d === bestDiff && orig < order[best]!)) {
      best = idx;
      bestDiff = d;
    }
  }
  return best === -1 ? -1 : order[best]!;
}

export interface SnapCandidateState {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly thresh: number;
  readonly cx: number;
  readonly cy: number;
  readonly edges: {
    left: number;
    right: number;
    centerX: number;
    top: number;
    bottom: number;
    centerY: number;
  };
  bestXDiff: number;
  bestXSnap: number;
  bestXGuide: SnapGuide | null;
  bestXPriority: number;
  bestYDiff: number;
  bestYSnap: number;
  bestYGuide: SnapGuide | null;
  bestYPriority: number;
}

export function createSnapCandidateState(
  x: number,
  y: number,
  w: number,
  h: number,
  thresh: number,
): SnapCandidateState {
  const cx = x + w / 2;
  const cy = y + h / 2;
  return {
    x,
    y,
    w,
    h,
    thresh,
    cx,
    cy,
    edges: { left: x, right: x + w, centerX: cx, top: y, bottom: y + h, centerY: cy },
    bestXDiff: Infinity,
    bestXSnap: x,
    bestXGuide: null,
    bestXPriority: -1,
    bestYDiff: Infinity,
    bestYSnap: y,
    bestYGuide: null,
    bestYPriority: -1,
  };
}
