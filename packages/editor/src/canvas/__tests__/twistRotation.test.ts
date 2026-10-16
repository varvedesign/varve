import { describe, expect, it } from 'vitest';
import {
  createTwistRotationAccumulator,
  normalizeAngleDelta,
  TWIST_DEAD_ZONE_RADIANS,
} from '../twistRotation';

describe('normalizeAngleDelta', () => {
  it('leaves small deltas untouched', () => {
    expect(normalizeAngleDelta(0.2)).toBe(0.2);
    expect(normalizeAngleDelta(-0.2)).toBe(-0.2);
  });

  it('wraps the atan2 branch cut to a short arc', () => {
    expect(normalizeAngleDelta(Math.PI + 0.2)).toBeCloseTo(-Math.PI + 0.2, 10);
    expect(normalizeAngleDelta(-Math.PI - 0.2)).toBeCloseTo(Math.PI - 0.2, 10);
    expect(normalizeAngleDelta(2 * Math.PI)).toBeCloseTo(0, 10);
  });

  it('maps non-finite input to 0', () => {
    expect(normalizeAngleDelta(Number.NaN)).toBe(0);
    expect(normalizeAngleDelta(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('createTwistRotationAccumulator', () => {
  it('returns 0 while jitter stays inside the dead zone', () => {
    const twist = createTwistRotationAccumulator();
    expect(twist.feed(0.02)).toBe(0);
    expect(twist.feed(-0.015)).toBe(0);
    expect(twist.isActive()).toBe(false);
  });

  it('activates once cumulative twist crosses the dead zone', () => {
    const twist = createTwistRotationAccumulator();
    const step = TWIST_DEAD_ZONE_RADIANS / 3;
    expect(twist.feed(step)).toBe(0);
    expect(twist.feed(step)).toBe(0);
    // Crossing move: this delta passes through once active.
    const crossing = twist.feed(step);
    expect(crossing).toBe(step);
    expect(twist.isActive()).toBe(true);
  });

  it('tracks every delta one-to-one once active', () => {
    const twist = createTwistRotationAccumulator();
    twist.feed(TWIST_DEAD_ZONE_RADIANS * 1.5);
    expect(twist.isActive()).toBe(true);
    expect(twist.feed(0.05)).toBe(0.05);
    expect(twist.feed(-0.03)).toBe(-0.03);
  });

  it('discards the dead-zone residue instead of applying it retroactively', () => {
    const twist = createTwistRotationAccumulator();
    let applied = 0;
    for (let i = 0; i < 100 && !twist.isActive(); i++) applied += twist.feed(0.002);
    // Residue accumulated toward the threshold is never applied at once.
    expect(applied).toBeLessThan(TWIST_DEAD_ZONE_RADIANS);
  });

  it('reset clears the active state for a replacement contact pair', () => {
    const twist = createTwistRotationAccumulator();
    twist.feed(TWIST_DEAD_ZONE_RADIANS * 2);
    expect(twist.isActive()).toBe(true);
    twist.reset();
    expect(twist.isActive()).toBe(false);
    expect(twist.feed(0.02)).toBe(0);
  });

  it('handles a wrapped delta across the branch cut while active', () => {
    const twist = createTwistRotationAccumulator();
    twist.feed(TWIST_DEAD_ZONE_RADIANS * 2);
    // +180.1° reads as -179.9°: the wrap must keep it a short negative arc.
    expect(twist.feed(Math.PI + 0.2)).toBeCloseTo(-Math.PI + 0.2, 10);
  });
});
