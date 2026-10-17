/**
 * Curve fitting utilities for the Pencil tool.
 *
 * Ramer-Douglas-Peucker simplification (1972/1973) reduces point count
 * while preserving visual features. Schneider's algorithm fits cubic
 * Bezier segments to the simplified points (Graphics Gems 1990).
 *
 * Research basis:
 *   Ramer, U. "An iterative procedure for the polygonal approximation
 *     of plane curves." Computer Graphics and Image Processing, 1972.
 *   Douglas, D. and Peucker, T. "Algorithms for the reduction of the
 *     number of points required to represent a digitized line or its
 *     caricature." The Canadian Cartographer, 1973.
 *   Schneider, P. "An Algorithm for Automatically Fitting Digitized
 *     Curves." Graphics Gems, 1990.
 */

export interface Point2D {
  x: number;
  y: number;
  /**
   * Stylus pressure 0-1, carried through simplification and curve fitting so
   * variable-width vector strokes survive to the renderer. Optional because
   * most geometry callers have no pressure to give.
   */
  pressure?: number;
}

export interface BezierSegment {
  p0: Point2D;
  p1: Point2D;
  p2: Point2D;
  p3: Point2D;
}

/** Optional fidelity controls for {@link fitPathToBeziers}. */
export interface FitPathOptions {
  /** Maximum accepted geometric error, in the caller's length unit. */
  maxError?: number;
  /** Pressure deviation that earns an extra anchor; 0 disables the check. */
  pressureEpsilon?: number;
}

/**
 * PathPoint output matching the scene model: anchor point with optional
 * incoming and outgoing bezier handles (relative to the point).
 */
export interface FitPathPoint {
  x: number;
  y: number;
  handleIn: [number, number] | null;
  handleOut: [number, number] | null;
  pressure?: number;
}

/** Corner angle threshold in radians. Angle < threshold = corner. */
const CORNER_ANGLE_THRESHOLD = (30 * Math.PI) / 180;

/** Maximum Bezier fitting error before splitting, in the caller's length unit. */
const BEZIER_FIT_TOLERANCE = 2.5;

/** Maximum recursion depth for Bezier fitting. */
const BEZIER_MAX_DEPTH = 8;

/**
 * Smallest change in normalised stylus pressure worth a path anchor when the
 * caller asks for pressure-aware simplification.
 *
 * The vector rasteriser maps pressure to stroke width through
 * `pressureScale()` (a 0.5 sample is nominal width, 1 is double), so 0.02 of
 * pressure is 2 % of nominal width — below the visible threshold of an
 * antialiased edge on a 1 px nib, and above sensor noise on reported hardware.
 * A genuine light–heavy–light excursion moves pressure far more than this, so
 * the extremum survives while a straight ramp still collapses to its endpoints.
 */
export const PRESSURE_PROFILE_EPSILON = 0.02;

/** Pressure of a sample, or null when the sample carries no pressure data. */
function pressureOf(point: Point2D): number | null {
  const pressure = point.pressure;
  return typeof pressure === 'number' && Number.isFinite(pressure) ? pressure : null;
}

/**
 * Normalised position of `pt` projected onto the chord `a → b`, clamped to the
 * segment. Shared by the geometric and pressure-profile deviation measures so
 * both are evaluated at the same parameter.
 */
function projectionParam(pt: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;
  return Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq));
}

/**
 * Ramer-Douglas-Peucker simplification.
 * Returns a subset of points that approximate the original within `epsilon`.
 *
 * `pressureEpsilon` adds a second retention criterion so variable-width
 * strokes do not lose their profile. Pure geometric RDP is blind to pressure:
 * a straight light–heavy–light stroke is perfectly collinear, so every interior
 * sample is dropped and with it the pressure extremum that *is* the artwork.
 * When set, a sample is also retained if its pressure deviates from the linear
 * interpolation of the interval endpoints by more than `pressureEpsilon`.
 *
 * The geometric bound is unchanged: whenever the geometric maximum exceeds
 * `epsilon` the split still happens at the geometric argmax, so the classic
 * RDP guarantee holds. The pressure criterion only ever adds splits.
 */
export function simplifyPoints(points: Point2D[], epsilon: number, pressureEpsilon = 0): Point2D[] {
  if (points.length <= 2) return [...points];

  let dmax = 0;
  let idx = 0;
  let pmax = 0;
  let pidx = 0;

  const p0 = points[0];
  const pN = points[points.length - 1];
  const p0Pressure = p0 ? pressureOf(p0) : null;
  const pNPressure = pN ? pressureOf(pN) : null;
  const trackPressure = pressureEpsilon > 0 && p0Pressure !== null && pNPressure !== null;

  for (let i = 1; i < points.length - 1; i++) {
    const pi = points[i];
    if (!pi || !p0 || !pN) continue;
    const t = projectionParam(pi, p0, pN);
    const d = perpendicularDist(pi, p0, pN);
    if (d > dmax) {
      idx = i;
      dmax = d;
    }
    if (trackPressure) {
      const pressure = pressureOf(pi);
      if (pressure !== null) {
        const reference = p0Pressure + (pNPressure - p0Pressure) * t;
        const deviation = Math.abs(pressure - reference);
        if (deviation > pmax) {
          pmax = deviation;
          pidx = i;
        }
      }
    }
  }

  const splitAtGeometry = dmax > epsilon && idx > 0 && idx < points.length - 1;
  const splitAtPressure = !splitAtGeometry && trackPressure && pmax > pressureEpsilon;
  const splitIndex = splitAtGeometry ? idx : splitAtPressure ? pidx : -1;

  if (splitIndex > 0 && splitIndex < points.length - 1) {
    const left = simplifyPoints(points.slice(0, splitIndex + 1), epsilon, pressureEpsilon);
    const right = simplifyPoints(points.slice(splitIndex), epsilon, pressureEpsilon);
    return [...left.slice(0, -1), ...right];
  }

  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return [...points];
  return [first, last];
}

function perpendicularDist(pt: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((pt.x - a.x) ** 2 + (pt.y - a.y) ** 2);
  const t = projectionParam(pt, a, b);
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.sqrt((pt.x - projX) ** 2 + (pt.y - projY) ** 2);
}

/**
 * Fit a single cubic Bezier segment to a polyline using least squares.
 * Schneider's algorithm (Graphics Gems, 1990).
 *
 * Returns null if the fit error exceeds the tolerance and the depth limit
 * hasn't been reached (caller should split and retry).
 */
export function fitBezierCurve(
  points: Point2D[],
  maxError: number = BEZIER_FIT_TOLERANCE,
): { segment: BezierSegment; error: number } | null {
  if (points.length < 2) return null;
  if (points.length === 2) {
    const p0 = points[0]!;
    const p3 = points[points.length - 1]!;
    const p1 = { x: p0.x + (p3.x - p0.x) / 3, y: p0.y + (p3.y - p0.y) / 3 };
    const p2 = { x: p0.x + (2 * (p3.x - p0.x)) / 3, y: p0.y + (2 * (p3.y - p0.y)) / 3 };
    return { segment: { p0, p1, p2, p3 }, error: 0 };
  }

  return fitSchneider(points, maxError);
}

/**
 * Largest deviation of an interior sample's pressure from the linear profile
 * between the interval endpoints, evaluated at the sample's chord-length
 * parameter. Returns the worst sample so a fit can split there.
 */
function pressureProfileDeviation(
  points: Point2D[],
  u: number[],
): { deviation: number; index: number } {
  const n = points.length;
  const first = pressureOf(points[0]!);
  const last = pressureOf(points[n - 1]!);
  if (first === null || last === null) return { deviation: 0, index: 0 };

  let deviation = 0;
  let index = 0;
  for (let i = 1; i < n - 1; i++) {
    const pressure = pressureOf(points[i]!);
    if (pressure === null) continue;
    const t = u[i] ?? 0;
    const reference = first + (last - first) * t;
    const delta = Math.abs(pressure - reference);
    if (delta > deviation) {
      deviation = delta;
      index = i;
    }
  }
  return { deviation, index };
}

function fitSchneider(
  points: Point2D[],
  maxError: number,
): { segment: BezierSegment; error: number } | null {
  const n = points.length;
  const p0 = points[0]!;
  const p3 = points[n - 1]!;

  // Estimate left and right tangent vectors
  const leftTangent = computeTangent(points, 0);
  const rightTangent = computeTangent(points, n - 1);
  const tangentLen = Math.sqrt((p3.x - p0.x) ** 2 + (p3.y - p0.y) ** 2) / 3;

  // Compute chord-length parameterization
  const u: number[] = new Array(n);
  u[0] = 0;
  for (let i = 1; i < n; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    u[i] = u[i - 1]! + Math.sqrt((curr.x - prev.x) ** 2 + (curr.y - prev.y) ** 2);
  }
  const totalLen = u[n - 1]! || 1;
  for (let i = 0; i < n; i++) {
    u[i] = u[i]! / totalLen;
  }

  // Build the 2x2 linear system for least-squares
  // A * [p1; p2] = B, where A is 2x2, B is 2xlen(points)-2
  let A11 = 0;
  let A12 = 0;
  let A22 = 0;
  const B1: [number, number] = [0, 0];
  const B2: [number, number] = [0, 0];

  for (let i = 1; i < n - 1; i++) {
    const t = u[i]!;
    const pt = points[i]!;

    // Bezier basis: B(t) = (1-t)³p0 + 3(1-t)²t·p1 + 3(1-t)t²·p2 + t³p3
    const a1 = 3 * (1 - t) ** 2 * t;
    const a2 = 3 * (1 - t) * t ** 2;

    const bx = pt.x - (1 - t) ** 3 * p0.x - t ** 3 * p3.x;
    const by = pt.y - (1 - t) ** 3 * p0.y - t ** 3 * p3.y;

    A11 += a1 * a1;
    A12 += a1 * a2;
    A22 += a2 * a2;
    B1[0] += a1 * bx;
    B1[1] += a1 * by;
    B2[0] += a2 * bx;
    B2[1] += a2 * by;
  }

  // Solve 2x2 system for [p1; p2] in both x and y dimensions
  const det = A11 * A22 - A12 * A12;
  let p1: Point2D;
  let p2: Point2D;

  if (Math.abs(det) < 1e-10) {
    // Degenerate case: use endpoint tangents
    p1 = {
      x: p0.x + leftTangent[0] * tangentLen,
      y: p0.y + leftTangent[1] * tangentLen,
    };
    p2 = {
      x: p3.x - rightTangent[0] * tangentLen,
      y: p3.y - rightTangent[1] * tangentLen,
    };
  } else {
    p1 = {
      x: (A22 * B1[0] - A12 * B2[0]) / det,
      y: (A22 * B1[1] - A12 * B2[1]) / det,
    };
    p2 = {
      x: (A11 * B2[0] - A12 * B1[0]) / det,
      y: (A11 * B2[1] - A12 * B1[1]) / det,
    };
  }

  // Compute max error
  let maxErr = 0;
  let maxErrIdx = 0;
  for (let i = 1; i < n - 1; i++) {
    const t = u[i]!;
    const pt = points[i]!;
    const bx = (1 - t) ** 3 * p0.x + a1(t) * p1.x + a2(t) * p2.x + t ** 3 * p3.x;
    const by = (1 - t) ** 3 * p0.y + a1(t) * p1.y + a2(t) * p2.y + t ** 3 * p3.y;
    const err = Math.sqrt((pt.x - bx) ** 2 + (pt.y - by) ** 2);
    if (err > maxErr) {
      maxErr = err;
      maxErrIdx = i;
    }
  }

  return {
    segment: { p0, p1, p2, p3 },
    error: maxErr,
    splitIdx: maxErr > maxError ? maxErrIdx : undefined,
  } as { segment: BezierSegment; error: number; splitIdx?: number };
}

function a1(t: number): number {
  return 3 * (1 - t) ** 2 * t;
}

function a2(t: number): number {
  return 3 * (1 - t) * t ** 2;
}

/** Estimate tangent at point idx using a centered difference. */
function computeTangent(points: Point2D[], idx: number): [number, number] {
  const n = points.length;
  if (n < 2) return [1, 0];

  if (idx === 0) {
    const p0 = points[0]!;
    const p1 = points[1]!;
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return [dx / len, dy / len];
  }

  if (idx === n - 1) {
    const pPrev = points[n - 2]!;
    const pLast = points[n - 1]!;
    const dx = pLast.x - pPrev.x;
    const dy = pLast.y - pPrev.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return [dx / len, dy / len];
  }

  const pPrev = points[idx - 1]!;
  const pNext = points[idx + 1]!;
  const vx = (pNext.x - pPrev.x) / 2;
  const vy = (pNext.y - pPrev.y) / 2;
  const len = Math.sqrt(vx * vx + vy * vy) || 1;
  return [vx / len, vy / len];
}

/**
 * Detect if a sharp corner separates two segment directions.
 *
 * `v1` is the incoming direction and `v2` the outgoing direction, both
 * normalised, so the angle *between them* is the turn the stroke makes: 0 for
 * a straight continuation, π/2 for a right angle. A corner is a turn LARGER
 * than the threshold.
 *
 * The comparison was previously inverted (`angle < threshold`), which flagged
 * every straight continuation as a corner — fragmenting smooth runs into one
 * Bezier per retained sample — while real right-angle corners were fitted with
 * smooth symmetric handles and rounded off. Both halves of that inversion are
 * covered by `fitting.corners.test.ts`.
 */
function isCorner(v1x: number, v1y: number, v2x: number, v2y: number): boolean {
  const dot = v1x * v2x + v1y * v2y;
  const turn = Math.acos(Math.max(-1, Math.min(1, dot)));
  return turn > CORNER_ANGLE_THRESHOLD;
}

/**
 * Fit cubic Bezier segments to a simplified polyline, producing
 * PathPoint-compatible output with handles.
 *
 * After RDP simplification, this fits Bezier curves to the remaining
 * polyline. Corner points (sharp angles) get null handles.
 * Smooth curves get proper handleIn/handleOut.
 *
 * `maxError` is in the caller's length unit (world units for a drawing tool),
 * so a zoom-aware caller can hold the on-screen fitting error constant instead
 * of accepting a fixed world-space error that grows with zoom.
 *
 * `pressureEpsilon` forces an extra anchor where the pressure profile departs
 * from the linear interpolation of the segment endpoints. Without it, an
 * accepted Bezier replaces every interior sample, and a straight stroke whose
 * only feature is its width profile would be committed as two flat anchors.
 */
export function fitPathToBeziers(points: Point2D[], options: FitPathOptions = {}): FitPathPoint[] {
  const maxError = options.maxError ?? BEZIER_FIT_TOLERANCE;
  const pressureEpsilon = options.pressureEpsilon ?? 0;

  if (points.length < 2) {
    return points.map((p) => ({
      x: p.x,
      y: p.y,
      handleIn: null,
      handleOut: null,
      pressure: p.pressure,
    }));
  }

  const result: FitPathPoint[] = [];

  // Detect corner points
  const cornerMask = new Array<boolean>(points.length).fill(false);
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const next = points[i + 1]!;
    const v1x = curr.x - prev.x;
    const v1y = curr.y - prev.y;
    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
    if (len1 > 0 && len2 > 0) {
      cornerMask[i] = isCorner(v1x / len1, v1y / len1, v2x / len2, v2y / len2);
    }
  }

  // Split at corners and fit each segment
  let segStart = 0;
  for (let i = 1; i <= points.length; i++) {
    if (i === points.length || cornerMask[i]) {
      const segPoints = points.slice(segStart, i + (i < points.length ? 1 : 0));
      if (segPoints.length >= 2) {
        const segments = fitSegmentRecursive(segPoints, maxError, 0, pressureEpsilon);
        for (let s = 0; s < segments.length; s++) {
          const seg = segments[s]!;
          const p0 = seg.p0;
          const p3 = seg.p3;

          const handleOut: [number, number] = [seg.p1.x - p0.x, seg.p1.y - p0.y];
          const handleIn: [number, number] = [seg.p2.x - p3.x, seg.p2.y - p3.y];

          if (result.length === 0) {
            result.push({
              x: p0.x,
              y: p0.y,
              handleIn: null,
              handleOut: handleOut,
              pressure: p0.pressure,
            });
          } else {
            // Update previous point's handleOut if it was null (continuity)
            const prevPt = result[result.length - 1];
            if (prevPt && prevPt.handleOut === null) {
              prevPt.handleOut = handleOut;
            }
          }

          result.push({
            x: p3.x,
            y: p3.y,
            handleIn: handleIn,
            handleOut: null,
            // Fitted anchors are original samples, so their pressure is the
            // measured value rather than an interpolation of neighbours.
            pressure: p3.pressure,
          });
        }
      }
      segStart = i;
    }
  }

  return result;
}

function fitSegmentRecursive(
  points: Point2D[],
  maxError: number,
  depth: number,
  pressureEpsilon: number,
): BezierSegment[] {
  if (depth >= BEZIER_MAX_DEPTH || points.length <= 2) {
    // Terminal case: just return a linear segment
    const p0 = points[0]!;
    const p3 = points[points.length - 1]!;
    return [
      {
        p0,
        p1: { x: p0.x + (p3.x - p0.x) / 3, y: p0.y + (p3.y - p0.y) / 3 },
        p2: { x: p0.x + (2 * (p3.x - p0.x)) / 3, y: p0.y + (2 * (p3.y - p0.y)) / 3 },
        p3,
      },
    ];
  }

  const fit = fitSchneider(points, maxError);
  if (!fit || fit.error <= maxError) {
    // Geometry alone would accept this segment. Check that doing so does not
    // discard a pressure extremum before committing to a single curve.
    if (pressureEpsilon > 0 && points.length > 2) {
      const u = chordLengthParams(points);
      const profile = pressureProfileDeviation(points, u);
      if (profile.deviation > pressureEpsilon && profile.index > 0) {
        const left = fitSegmentRecursive(
          points.slice(0, profile.index + 1),
          maxError,
          depth + 1,
          pressureEpsilon,
        );
        const right = fitSegmentRecursive(
          points.slice(profile.index),
          maxError,
          depth + 1,
          pressureEpsilon,
        );
        return [...left, ...right];
      }
    }
    return fit
      ? [fit.segment]
      : [
          {
            p0: points[0]!,
            p1: points[0]!,
            p2: points[points.length - 1]!,
            p3: points[points.length - 1]!,
          },
        ];
  }

  const splitIdx = (fit as { splitIdx?: number }).splitIdx;
  if (splitIdx === undefined || splitIdx <= 0 || splitIdx >= points.length - 1) {
    return [fit.segment];
  }

  const left = fitSegmentRecursive(
    points.slice(0, splitIdx + 1),
    maxError,
    depth + 1,
    pressureEpsilon,
  );
  const right = fitSegmentRecursive(points.slice(splitIdx), maxError, depth + 1, pressureEpsilon);
  return [...left, ...right];
}

/** Normalised chord-length parameter for each point, as the fitter uses. */
function chordLengthParams(points: Point2D[]): number[] {
  const n = points.length;
  const u: number[] = new Array(n);
  u[0] = 0;
  for (let i = 1; i < n; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    u[i] = u[i - 1]! + Math.sqrt((curr.x - prev.x) ** 2 + (curr.y - prev.y) ** 2);
  }
  const total = u[n - 1]! || 1;
  for (let i = 0; i < n; i++) u[i] = u[i]! / total;
  return u;
}
