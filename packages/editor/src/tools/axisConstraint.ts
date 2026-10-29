/**
 * Movement constraint for drag gestures.
 *
 * Varve documents Shift as "constrain … while drawing or transforming"
 * (`docs/architecture/input-system-behavior-matrix.md`), and SelectTool's own
 * drag-end comment says "Shift also locks the drag axis". Until this module
 * existed, the move gesture applied no constraint at all: `worldDragDelta()`
 * returned the raw pointer delta, so the `axisLock` value held by
 * `InteractionSession` had no consumer.
 *
 * A plain axis lock is the least surprising default, but it throws away the
 * diagonal drag that illustration and layout work needs. Graphite shipped an
 * axis-only constraint and its users filed a request to bring 45° movement
 * back (#4246). Projecting onto the nearest of eight directions keeps both:
 * a drag within 22.5° of an axis still moves along that axis, and a deliberate
 * diagonal travels at 45°.
 */

/** Explicit lock requested by a caller (for example the tablet Constrain control). */
export type AxisLock = 'none' | 'x' | 'y';

export interface MoveConstraintInput {
  readonly shiftKey: boolean;
  readonly axisLock?: AxisLock;
}

export interface MoveConstraint {
  /** Constrained world-space displacement. */
  readonly dx: number;
  readonly dy: number;
  /** Direction of travel in degrees, normalised to [0, 360). */
  readonly angleDeg: number;
  /** True when travel is restricted to a single axis (0/90/180/270). */
  readonly axial: boolean;
  /** True when a constraint was applied at all. */
  readonly constrained: boolean;
}

const QUARTER_TURN_DEG = 90;

/**
 * Projects a displacement onto the nearest `stepDeg` direction.
 *
 * The magnitude is the projection of the requested displacement onto the
 * snapped direction rather than its full length, so the object tracks the
 * pointer instead of jumping ahead of it when the pointer is off-axis.
 */
export function projectOntoDirection(
  dx: number,
  dy: number,
  angleDeg: number,
): { dx: number; dy: number } {
  const radians = (angleDeg * Math.PI) / 180;
  const projected = dx * Math.cos(radians) + dy * Math.sin(radians);
  return {
    dx: projected * Math.cos(radians),
    dy: projected * Math.sin(radians),
  };
}

/** Normalises an angle to the [0, 360) range without producing -0. */
export function normaliseAngle(angleDeg: number): number {
  const wrapped = ((angleDeg % 360) + 360) % 360;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

/**
 * Resolves the movement constraint for a drag delta.
 *
 * An explicit `axisLock` wins over the modifier: a latched or programmatic
 * lock must not be undone by the user's finger resting on Shift. With Shift
 * held the delta snaps to 45° steps; otherwise the raw delta is returned with
 * `constrained: false` so callers can keep their unconstrained fast path.
 */
export function resolveMoveConstraint(
  dx: number,
  dy: number,
  input: MoveConstraintInput,
  stepDeg = 45,
): MoveConstraint {
  const axisLock = input.axisLock ?? 'none';
  if (axisLock === 'x' || axisLock === 'y') {
    const angleDeg = axisLock === 'x' ? (dx < 0 ? 180 : 0) : dy < 0 ? 270 : 90;
    const locked = projectOntoDirection(dx, dy, angleDeg);
    return { ...locked, angleDeg, axial: true, constrained: true };
  }
  if (!input.shiftKey) {
    return {
      dx,
      dy,
      angleDeg: normaliseAngle((Math.atan2(dy, dx) * 180) / Math.PI),
      axial: false,
      constrained: false,
    };
  }
  const magnitude = Math.hypot(dx, dy);
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    return { dx, dy, angleDeg: 0, axial: true, constrained: true };
  }
  const snapped = Math.round((Math.atan2(dy, dx) * 180) / Math.PI / stepDeg) * stepDeg;
  const projected = projectOntoDirection(dx, dy, snapped);
  return {
    ...projected,
    angleDeg: normaliseAngle(snapped),
    axial: Math.abs(snapped % QUARTER_TURN_DEG) < 1e-9,
    constrained: true,
  };
}
