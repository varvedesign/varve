/**
 * Two-finger twist accumulation for view rotation.
 *
 * A pinch's two contacts also carry an angle; rotating them about the
 * centroid rotates the *view* (camera), never the artwork. The accumulator
 * exists because raw per-move angle deltas jitter a few degrees at contact
 * resolution changes: a dead zone keeps a normal pinch from rotating the
 * canvas at all, while an intended twist crosses it immediately and then
 * tracks every subsequent delta one-to-one. The residue inside the dead
 * zone is deliberately discarded — rotation becomes visible at the
 * threshold crossing, not retroactively.
 *
 * Angle deltas are wrapped to [-π, π] so contact-pair replacements and the
 * atan2 branch cut cannot produce a spurious ~360° spin. This module is
 * pure: the canvas adapter supplies deltas and applies the returned delta
 * through the shared camera rotation (`rotateAboutScreenPoint`), which
 * keeps the world point under the gesture centroid stationary.
 */

export const TWIST_DEAD_ZONE_RADIANS = (5 * Math.PI) / 180;

/** Wrap an angle delta onto [-π, π]; non-finite input maps to 0. */
export function normalizeAngleDelta(delta: number): number {
  if (!Number.isFinite(delta)) return 0;
  let wrapped = delta;
  while (wrapped > Math.PI) wrapped -= 2 * Math.PI;
  while (wrapped < -Math.PI) wrapped += 2 * Math.PI;
  return wrapped;
}

export interface TwistRotationAccumulator {
  /**
   * Feed one raw per-move angle delta; returns the rotation to apply this
   * move (0 while the gesture is still inside the dead zone).
   */
  feed(deltaRadians: number): number;
  /** Clear state for a new gesture. */
  reset(): void;
  /** True once the gesture has crossed the dead zone. */
  isActive(): boolean;
}

export function createTwistRotationAccumulator(
  deadZone: number = TWIST_DEAD_ZONE_RADIANS,
): TwistRotationAccumulator {
  let accumulated = 0;
  let active = false;
  return {
    feed(delta) {
      const wrapped = normalizeAngleDelta(delta);
      if (wrapped === 0) return 0;
      if (active) return wrapped;
      accumulated += wrapped;
      if (Math.abs(accumulated) < deadZone) return 0;
      active = true;
      return wrapped;
    },
    reset() {
      accumulated = 0;
      active = false;
    },
    isActive: () => active,
  };
}
