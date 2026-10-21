/**
 * Path offset operations — non-destructive path expansion/contraction,
 * variable-width stroke-to-fill conversion, and parametric corner rounding.
 *
 * Research basis: Minkowski sum with disk (offset curves), Adobe Illustrator
 *   Offset Path, Figma outline stroke, Skia PathOps.
 */

import type { PathPoint } from './types';

// ── 2D vector helpers ──────────────────────────────────────────────────────

function vecLen(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

function normalize(dx: number, dy: number): [number, number] {
  const len = vecLen(dx, dy);
  if (len < 1e-12) return [0, 0];
  return [dx / len, dy / len];
}

function dot(ax: number, ay: number, bx: number, by: number): number {
  return ax * bx + ay * by;
}

// ── Point helpers ───────────────────────────────────────────────────────────

/**
 * Round-join tessellation limits.
 *
 * A join's step count must depend on how far the arc is allowed to deviate
 * from a straight chord, never on the offset distance alone: a linear
 * `distance × constant` rule both under-tessellates small offsets (visible
 * facets at the default 6 pt) and explodes on large ones. The previous rule
 * could emit hundreds of thousands of points per vertex for a user-supplied
 * distance, freezing the app until it ran out of memory — the failure
 * reported as vectorcraft#1028 ("Offset Path with miter joins never finishes
 * on some outlines, freezing the app until it runs out of memory").
 */
const ARC_TOLERANCE = 0.25;
const MAX_ARC_STEPS_PER_JOIN = 64;
/** Hard ceiling on emitted points. A synchronous main-thread effect must
 *  terminate predictably even for an extreme distance. */
const MAX_OFFSET_POINTS = 200_000;

/**
 * Steps needed to keep a circular arc within `ARC_TOLERANCE` of its chords.
 *
 * `2·acos(1 − tol/r)` is the largest angle whose sagitta stays inside the
 * tolerance, so the count follows from the radius and the sweep instead of
 * scaling linearly with the offset.
 */
function arcStepsFor(sweep: number, radius: number): number {
  const r = Math.max(Math.abs(radius), 1e-9);
  const tolerance = Math.min(ARC_TOLERANCE, r * 0.5);
  const ratio = Math.max(-1, Math.min(1, 1 - tolerance / r));
  const maxAngle = Math.max(1e-3, 2 * Math.acos(ratio));
  const steps = Math.ceil(Math.abs(sweep) / maxAngle);
  return Math.min(MAX_ARC_STEPS_PER_JOIN, Math.max(1, steps));
}

/**
 * Append a round join: the arc from the previous edge's offset endpoint to
 * this edge's offset start point, centred on the original vertex.
 *
 * Round joins previously produced a single miter point (or a bevel) because
 * the arc branch was only reachable when the offset lines were parallel.
 * Choosing "round" therefore did not round a normal corner.
 */
function pushRoundJoin(
  result: PathPoint[],
  prev: { ax: number; ay: number; bx: number; by: number },
  curr: { ax: number; ay: number; bx: number; by: number; nx: number; ny: number },
  distance: number,
): void {
  const prevDirX = prev.bx - prev.ax;
  const prevDirY = prev.by - prev.ay;
  const currDirX = curr.bx - curr.ax;
  const currDirY = curr.by - curr.ay;
  const cross = prevDirX * currDirY - prevDirY * currDirX;

  // A round join rounds the OUTSIDE of a turn. On the inside the two offset
  // lines converge and the boundary is their intersection: drawing an arc
  // there scoops material out of the shape. The default inward offset (-8) hit
  // this at every corner, losing |distance|·(√2−1) — 3.3 px on a 10 px offset.
  if (cross * distance <= 0) {
    const int = lineIntersection(
      prev.bx,
      prev.by,
      prev.ax,
      prev.ay,
      curr.ax,
      curr.ay,
      curr.bx,
      curr.by,
    );
    result.push(
      int
        ? { x: int[0], y: int[1], handleIn: null, handleOut: null }
        : { x: curr.ax, y: curr.ay, handleIn: null, handleOut: null },
    );
    return;
  }

  const cx = curr.ax - curr.nx * distance;
  const cy = curr.ay - curr.ny * distance;
  const fromAngle = Math.atan2(prev.by - cy, prev.bx - cx);
  const toAngle = Math.atan2(curr.ay - cy, curr.ax - cx);
  let sweep = toAngle - fromAngle;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;

  const budget = MAX_OFFSET_POINTS - result.length - 1;
  const radius = Math.abs(distance);
  const idealSteps = arcStepsFor(sweep, radius);
  if (Math.abs(sweep) < 1e-4 || idealSteps > budget) {
    // Never emit a truncated sweep: a partial arc ends on a straight jump to
    // the next join. Fall back to the corner instead.
    result.push({ x: curr.ax, y: curr.ay, handleIn: null, handleOut: null });
    return;
  }

  const steps = idealSteps;
  for (let s = 0; s <= steps; s++) {
    const angle = fromAngle + (s / steps) * sweep;
    result.push({
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      handleIn: null,
      handleOut: null,
    });
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Compute an offset curve for a path at a given distance.
 * Positive distance = expand outward, negative = contract inward.
 *
 * Algorithm: For each segment (edge) of the path, compute the parallel offset
 * line at the given distance along the outward normal. Then for each vertex,
 * intersect the two adjacent offset lines to find the mitered corner.
 *
 * @param points - Source path control points
 * @param closed - Whether the path is closed
 * @param distance - Offset distance (positive = outward, negative = inward)
 * @param joinStyle - 'miter' (sharp corners), 'round' (arc), 'bevel' (flat)
 * @param miterLimit - Maximum miter ratio (default 4)
 * @returns New path points describing the offset curve
 */
export function offsetPath(
  points: PathPoint[],
  closed: boolean,
  distance: number,
  joinStyle: 'miter' | 'round' | 'bevel' = 'miter',
  miterLimit = 4,
): PathPoint[] {
  if (points.length < 2 || Math.abs(distance) < 0.5) return points.map(clonePoint);

  // Step 1: Compute each edge's outward normal and offset line
  const n = closed ? points.length : points.length - 1;
  const offsetLines: { ax: number; ay: number; bx: number; by: number; nx: number; ny: number }[] =
    [];

  for (let i = 0; i < n; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = vecLen(dx, dy);
    if (len < 1e-12) continue;
    const [nx, ny] = normalize(dy, -dx);
    offsetLines.push({
      ax: a.x + nx * distance,
      ay: a.y + ny * distance,
      bx: b.x + nx * distance,
      by: b.y + ny * distance,
      nx,
      ny,
    });
  }

  if (offsetLines.length === 0) return points.map(clonePoint);

  // Single segment (open path with 2 points): return the offset endpoints directly
  if (offsetLines.length === 1 && !closed) {
    const ol = offsetLines[0]!;
    return [
      { x: ol.ax, y: ol.ay, handleIn: null, handleOut: null },
      { x: ol.bx, y: ol.by, handleIn: null, handleOut: null },
    ];
  }

  // Step 2: For each vertex, intersect adjacent offset lines to find the mitered corner
  const result: PathPoint[] = [];
  const m = offsetLines.length;

  for (let i = 0; i < m; i++) {
    const prev = offsetLines[(i - 1 + m) % m]!;
    const curr = offsetLines[i]!;

    if (!closed && i === 0) {
      // The first vertex of an open path is an endpoint, not a join. Joining it
      // to the last segment would bridge the two ends of the offset curve.
      result.push({ x: curr.ax, y: curr.ay, handleIn: null, handleOut: null });
      continue;
    }

    if (joinStyle === 'round') {
      pushRoundJoin(result, prev, curr, distance);
      if (result.length >= MAX_OFFSET_POINTS) break;
      continue;
    }

    // Miter and bevel both need the intersection of the two offset lines.
    // Intersect prev's line (from endpoint to startpoint, reversed direction)
    // with curr's line (from startpoint to endpoint).
    const int =
      joinStyle === 'miter'
        ? lineIntersection(prev.bx, prev.by, prev.ax, prev.ay, curr.ax, curr.ay, curr.bx, curr.by)
        : null;

    if (int) {
      // Check miter ratio
      const edgeLen = vecLen(curr.bx - curr.ax, curr.by - curr.ay);
      const miterLen = vecLen(int[0] - curr.ax, int[1] - curr.ay);
      const ratio = edgeLen > 0 ? miterLen / edgeLen : 0;
      // A miter beyond the limit is clipped to a bevel corner.
      result.push(
        ratio <= miterLimit
          ? { x: int[0], y: int[1], handleIn: null, handleOut: null }
          : { x: curr.ax, y: curr.ay, handleIn: null, handleOut: null },
      );
    } else {
      // Bevel join (parallel edges have no intersection to miter to).
      result.push({ x: curr.ax, y: curr.ay, handleIn: null, handleOut: null });
    }
  }

  if (!closed && offsetLines.length > 0) {
    // The open path's far endpoint was never a join candidate.
    const last = offsetLines[offsetLines.length - 1]!;
    result.push({ x: last.bx, y: last.by, handleIn: null, handleOut: null });
  }

  return result;
}

/**
 * Expand a stroked path into a filled outline (variable-width stroke).
 * Takes the center-line path and a per-vertex stroke width, returns the
 * left and right offset curves merged into a closed filled path.
 *
 * @param points - Source path (the stroke center-line)
 * @param closed - Whether the path is closed
 * @param widths - Per-vertex stroke width (half-width = width/2 on each side)
 * @param capStyle - End cap style for open paths
 * @returns A closed path representing the filled stroke outline
 */
export function expandStroke(
  points: PathPoint[],
  closed: boolean,
  widths: number[],
  capStyle: 'butt' | 'round' | 'square' = 'round',
): PathPoint[] {
  if (points.length < 2) return points.map(clonePoint);

  const halfWidths = widths.map((w) => w / 2);

  // Compute offset to the left and right for each vertex
  const leftPoints: PathPoint[] = [];
  const rightPoints: PathPoint[] = [];

  for (let i = 0; i < points.length; i++) {
    const curr = points[i]!;
    const hw = halfWidths[Math.min(i, halfWidths.length - 1)]!;
    const firstOrLast = !closed && (i === 0 || i === points.length - 1);

    if (firstOrLast) {
      // Open endpoints: use simple per-segment normal
      const neighbor = i === 0 ? points[i + 1]! : points[i - 1]!;
      const dx = i === 0 ? neighbor.x - curr.x : curr.x - neighbor.x;
      const dy = i === 0 ? neighbor.y - curr.y : curr.y - neighbor.y;
      if (vecLen(dx, dy) > 1e-12) {
        // Outward normal for screen coords (y+ down): rotate (dx,dy) CW → (dy,-dx)
        const [nx, ny] = normalize(dy, -dx);
        leftPoints.push({
          x: curr.x + nx * hw,
          y: curr.y + ny * hw,
          handleIn: curr.handleIn,
          handleOut: curr.handleOut,
        });
        rightPoints.push({
          x: curr.x - nx * hw,
          y: curr.y - ny * hw,
          handleIn: curr.handleIn,
          handleOut: curr.handleOut,
        });
      }
    } else if (points.length >= 2) {
      // Interior vertex: average entering and leaving left normals
      const prev = points[(i - 1 + points.length) % points.length]!;
      const next = points[(i + 1) % points.length]!;
      const dx1 = curr.x - prev.x;
      const dy1 = curr.y - prev.y;
      const dx2 = next.x - curr.x;
      const dy2 = next.y - curr.y;
      const [nx1, ny1] = normalize(-dy1, dx1);
      const [nx2, ny2] = normalize(-dy2, dx2);
      const len1 = vecLen(nx1, ny1);
      const len2 = vecLen(nx2, ny2);
      const nx = len1 > 0 && len2 > 0 ? (nx1 + nx2) / 2 : len1 > 0 ? nx1 : nx2;
      const ny = len1 > 0 && len2 > 0 ? (ny1 + ny2) / 2 : len1 > 0 ? ny1 : ny2;
      leftPoints.push({
        x: curr.x + nx * hw,
        y: curr.y + ny * hw,
        handleIn: curr.handleIn,
        handleOut: curr.handleOut,
      });
      rightPoints.push({
        x: curr.x - nx * hw,
        y: curr.y - ny * hw,
        handleIn: curr.handleIn,
        handleOut: curr.handleOut,
      });
    }
  }

  if (leftPoints.length === 0) return points.map(clonePoint);

  if (closed) {
    // Closed path: left curve + reversed right curve = single closed outline
    const revRight = rightPoints.slice().reverse();
    return [...leftPoints, ...revRight];
  }

  // Open path: left curve + end cap + right curve (reversed) + start cap
  const endCap: PathPoint[] = [];
  if (capStyle === 'round' && leftPoints.length > 0 && rightPoints.length > 0) {
    const lastL = leftPoints[leftPoints.length - 1]!;
    const lastR = rightPoints[rightPoints.length - 1]!;
    const capSteps = 6;
    for (let s = 0; s < capSteps; s++) {
      const t = (s + 1) / (capSteps + 1);
      const angle = (t * Math.PI) / 2;
      const rx = (lastL.x - lastR.x) / 2;
      const ry = (lastL.y - lastR.y) / 2;
      endCap.push({
        x: (lastL.x + lastR.x) / 2 + rx * Math.cos(angle),
        y: (lastL.y + lastR.y) / 2 + ry * Math.sin(angle),
        handleIn: null,
        handleOut: null,
      });
    }
  }

  const startCap: PathPoint[] = [];
  if (capStyle === 'round' && leftPoints.length > 0 && rightPoints.length > 0) {
    const firstL = leftPoints[0]!;
    const firstR = rightPoints[0]!;
    const capSteps = 6;
    for (let s = 0; s < capSteps; s++) {
      const t = (s + 1) / (capSteps + 1);
      const angle = (-t * Math.PI) / 2 + Math.PI / 2;
      const rx = (firstL.x - firstR.x) / 2;
      const ry = (firstL.y - firstR.y) / 2;
      startCap.push({
        x: (firstL.x + firstR.x) / 2 + rx * Math.cos(angle),
        y: (firstL.y + firstR.y) / 2 + ry * Math.sin(angle),
        handleIn: null,
        handleOut: null,
      });
    }
  }

  return [...leftPoints, ...endCap, ...rightPoints.slice().reverse(), ...startCap];
}

/**
 * Apply parametric corner rounding to a path.
 * Replaces sharp corners with arc segments of the given radius.
 *
 * @param points - Source path points
 * @param closed - Whether the path is closed
 * @param radius - Corner radius (0 = no rounding)
 * @returns Path with rounded corners
 */
export function roundCorners(points: PathPoint[], closed: boolean, radius: number): PathPoint[] {
  if (points.length < 3 || radius <= 0) return points.map(clonePoint);

  const result: PathPoint[] = [];

  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length]!;
    const curr = points[i]!;
    const next = points[(i + 1) % points.length]!;

    if (!closed && (i === 0 || i === points.length - 1)) {
      result.push(clonePoint(curr));
      continue;
    }

    // Vectors from curr to prev and curr to next
    const [dx1, dy1] = normalize(prev.x - curr.x, prev.y - curr.y);
    const [dx2, dy2] = normalize(next.x - curr.x, next.y - curr.y);

    // Angle between the two edges
    const angle = Math.acos(Math.max(-1, Math.min(1, dot(dx1, dy1, dx2, dy2))));
    const halfAngle = angle / 2;

    // Distance from corner to the tangent points
    const tangentDist = radius / Math.tan(halfAngle);
    const maxLen1 = vecLen(curr.x - prev.x, curr.y - prev.y) / 2;
    const maxLen2 = vecLen(next.x - curr.x, next.y - curr.y) / 2;
    const effectiveDist = Math.min(tangentDist, maxLen1, maxLen2);

    if (effectiveDist <= 1) {
      result.push(clonePoint(curr));
      continue;
    }

    // Tangent points
    const t1x = curr.x + dx1 * effectiveDist;
    const t1y = curr.y + dy1 * effectiveDist;
    const t2x = curr.x + dx2 * effectiveDist;
    const t2y = curr.y + dy2 * effectiveDist;

    // Add the first tangent point
    result.push({ x: t1x, y: t1y, handleIn: null, handleOut: null });

    // Arc center (intersection of normals at tangent points)
    const [nx1, ny1] = normalize(-dy1, dx1);
    const [nx2, ny2] = normalize(dy2, -dx2);
    const center = lineIntersection(t1x, t1y, t1x + nx1, t1y + ny1, t2x, t2y, t2x + nx2, t2y + ny2);

    if (center) {
      // Build arc with 4 steps
      const arcSteps = 4;
      const startA = Math.atan2(t1y - center[1], t1x - center[0]);
      const endA = Math.atan2(t2y - center[1], t2x - center[0]);
      let da = endA - startA;
      if (da > Math.PI) da -= 2 * Math.PI;
      if (da < -Math.PI) da += 2 * Math.PI;
      for (let s = 1; s < arcSteps; s++) {
        const t = s / arcSteps;
        const a = startA + t * da;
        result.push({
          x: center[0] + radius * Math.cos(a),
          y: center[1] + radius * Math.sin(a),
          handleIn: null,
          handleOut: null,
        });
      }
    }
  }

  return result;
}

// ── Internal helpers ────────────────────────────────────────────────────────

function clonePoint(p: PathPoint): PathPoint {
  return {
    x: p.x,
    y: p.y,
    handleIn: p.handleIn ? [p.handleIn[0], p.handleIn[1]] : null,
    handleOut: p.handleOut ? [p.handleOut[0], p.handleOut[1]] : null,
  };
}

/**
 * Line-line intersection in parametric form.
 * Returns [x, y] of intersection, or null if parallel.
 */
function lineIntersection(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): [number, number] | null {
  const denom = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denom;
  return [ax + t * (bx - ax), ay + t * (by - ay)];
}
