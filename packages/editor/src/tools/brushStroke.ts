/**
 * Shared stroke sampling and pressure normalization for coverage-painting
 * pointer tools (refine mask, trimap, quick-mask selection paint).
 *
 * Coalesced pointer events improve resolution but do not guarantee that the
 * geometric segment between two samples is covered; tools that only painted
 * at event positions left dashed strokes on fast movement. These helpers walk
 * the segment between samples at a bounded spacing and always include the
 * segment end, so the last pointer position of a gesture is painted too.
 *
 * ## Why this file has its own pressure policy
 *
 * These tools map pressure to *deposit opacity*, not to tip width, so their
 * nominal sample is full strength rather than the raster brush's 0.5. That is
 * a deliberate difference, not a drifted copy of the brush contract. What is
 * *not* acceptable is disagreeing with the rest of the editor about what the
 * hardware reported:
 *
 *   - the user's pressure preference is honoured (disabled means constant);
 *   - a legitimately light pen touch is not inflated by a fixed floor;
 *   - a mouse deposits the same amount whatever the browser reports for
 *     `pressure` (0 and 0.5 are both ordinary mouse readings);
 *   - "the pen reports no pressure at all" is decided from observed
 *     capability, not from a single sample.
 */

import { getDrawingInputSettings } from './drawingInputRuntime';
import { getObservedInputCapabilities } from './inputNormalizer';

export interface StrokePoint {
  x: number;
  y: number;
}

/**
 * Hard ceiling on points produced for one interpolated segment.
 *
 * The interpolation walks a straight line in *source pixel* space, so a
 * pointer jump across a large mask at a 1 px spacing is legitimately long.
 * The cap exists so a malformed or absurd coordinate cannot allocate an
 * unbounded array; when a segment needs more points than the cap, the step is
 * widened instead of truncating, which keeps the whole segment covered
 * (coarser dabs) rather than leaving a silent gap.
 */
export const MAX_INTERPOLATED_SEGMENT_POINTS = 4096;

/** Deposit strength used when pressure is disabled or unavailable. */
export const NOMINAL_COVERAGE_PRESSURE = 1;

/**
 * Normalized brush pressure for coverage-painting tools.
 *
 * A positive reported pressure is used as-is (clamped, no floor) so a light
 * pen touch stays light. Zero pressure is ambiguous — it is what a pen at
 * first contact reports on some stacks, and also what a real zero-pressure
 * contact reports — so it is resolved against *observed* capability: once the
 * device has been seen reporting more than one distinct pressure value, a zero
 * is a real zero; otherwise the device has shown no pressure sensing and the
 * stroke deposits nominally instead of silently disappearing.
 *
 * Mouse and unknown pointers always deposit nominally. Browsers disagree about
 * whether a held mouse reports 0 or 0.5, and letting that leak into the mask
 * made the same gesture deposit half as much in one browser as another.
 */
export function effectivePressure(event: { pressure?: number; pointerType?: string }): number {
  if (!getDrawingInputSettings().pressureEnabled) return NOMINAL_COVERAGE_PRESSURE;

  const pointerType = event.pointerType;
  if (pointerType !== 'pen' && pointerType !== 'touch') return NOMINAL_COVERAGE_PRESSURE;

  const pressure = event.pressure;
  if (typeof pressure === 'number' && Number.isFinite(pressure) && pressure > 0) {
    return Math.min(1, pressure);
  }

  const observed = getObservedInputCapabilities();
  if (pointerType === 'pen' && observed.pressure === 'observed') {
    // A genuine zero from a device that has demonstrated pressure sensing.
    return 0;
  }
  return NOMINAL_COVERAGE_PRESSURE;
}

/**
 * Points along the segment `from → to` (excluding `from`, including `to`)
 * spaced at most `spacing` apart. Returns `[to]` for a degenerate segment and
 * a single point when the distance is already within one step.
 *
 * Non-finite input is rejected rather than forwarded: painting at a NaN
 * coordinate is not a valid sample, and passing one on as a real point is how
 * a corrupt mapping turns into a stray dab or a silent no-op that looks like a
 * broken tool. An invalid destination yields no points; an invalid origin with
 * a valid destination yields just the destination.
 */
export function interpolateStrokeSegment(
  from: StrokePoint,
  to: StrokePoint,
  spacing: number,
): StrokePoint[] {
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return [];
  if (!Number.isFinite(from.x) || !Number.isFinite(from.y)) return [{ x: to.x, y: to.y }];

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= 1e-9) return [{ x: to.x, y: to.y }];

  const requestedStep = Number.isFinite(spacing) ? Math.max(1e-6, spacing) : 1;
  const steps = Math.min(
    MAX_INTERPOLATED_SEGMENT_POINTS,
    Math.max(1, Math.ceil(distance / requestedStep)),
  );
  const points: StrokePoint[] = new Array<StrokePoint>(steps);
  for (let index = 0; index < steps; index += 1) {
    const t = (index + 1) / steps;
    points[index] = { x: from.x + dx * t, y: from.y + dy * t };
  }
  return points;
}
