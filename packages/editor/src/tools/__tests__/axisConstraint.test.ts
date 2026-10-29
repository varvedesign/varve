import { describe, expect, it } from 'vitest';
import { normaliseAngle, projectOntoDirection, resolveMoveConstraint } from '../axisConstraint';

describe('resolveMoveConstraint', () => {
  it('returns the raw delta when nothing is held', () => {
    const result = resolveMoveConstraint(30, 12, { shiftKey: false });
    expect(result).toMatchObject({ dx: 30, dy: 12, constrained: false, axial: false });
  });

  it('keeps a mostly-horizontal Shift drag on the horizontal axis', () => {
    const result = resolveMoveConstraint(100, 20, { shiftKey: true });
    expect(result.axial).toBe(true);
    expect(result.angleDeg).toBe(0);
    expect(result.dy).toBeCloseTo(0, 6);
    expect(result.dx).toBeGreaterThan(90);
  });

  it('keeps a mostly-vertical Shift drag on the vertical axis', () => {
    const result = resolveMoveConstraint(-8, -120, { shiftKey: true });
    expect(result.axial).toBe(true);
    expect(result.angleDeg).toBe(270);
    expect(result.dx).toBeCloseTo(0, 6);
    expect(result.dy).toBeLessThan(-118);
  });

  it('preserves a deliberate 45 degree drag instead of flattening it', () => {
    const result = resolveMoveConstraint(80, 80, { shiftKey: true });
    expect(result.axial).toBe(false);
    expect(result.angleDeg).toBe(45);
    expect(result.dx).toBeCloseTo(80, 6);
    expect(result.dy).toBeCloseTo(80, 6);
  });

  it('snaps to the nearer side of the 22.5 degree boundary', () => {
    expect(resolveMoveConstraint(100, 40, { shiftKey: true }).angleDeg).toBe(0);
    expect(resolveMoveConstraint(100, 55, { shiftKey: true }).angleDeg).toBe(45);
  });

  it('tracks the pointer rather than jumping ahead on an off-axis drag', () => {
    const result = resolveMoveConstraint(100, 30, { shiftKey: true });
    expect(Math.hypot(result.dx, result.dy)).toBeLessThan(Math.hypot(100, 30));
  });

  it('honours an explicit axis lock over the modifier', () => {
    const locked = resolveMoveConstraint(10, 90, { shiftKey: true, axisLock: 'x' });
    expect(locked.axial).toBe(true);
    expect(locked.dy).toBeCloseTo(0, 6);
    expect(locked.dx).toBeCloseTo(10, 6);
    const vertical = resolveMoveConstraint(90, -40, { shiftKey: false, axisLock: 'y' });
    expect(vertical.angleDeg).toBe(270);
    expect(vertical.dx).toBeCloseTo(0, 6);
    expect(vertical.dy).toBeCloseTo(-40, 6);
  });

  it('leaves a zero delta at the origin', () => {
    const result = resolveMoveConstraint(0, 0, { shiftKey: true });
    expect(result).toMatchObject({ dx: 0, dy: 0, constrained: true, axial: true });
  });
});

describe('projectOntoDirection', () => {
  it('drops the perpendicular component', () => {
    const projected = projectOntoDirection(50, 999, 0);
    expect(projected.dx).toBeCloseTo(50, 6);
    expect(projected.dy).toBeCloseTo(0, 6);
  });
});

describe('normaliseAngle', () => {
  it('wraps negative angles and never returns negative zero', () => {
    expect(normaliseAngle(-90)).toBe(270);
    expect(normaliseAngle(360)).toBe(0);
    expect(Object.is(normaliseAngle(-360), -0)).toBe(false);
  });
});
