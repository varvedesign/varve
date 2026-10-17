/**
 * Pressure-profile retention in simplification and Bezier fitting.
 *
 * A variable-width stroke's *centreline* and its *width profile* are two
 * separate things. Pure geometric Ramer-Douglas-Peucker only protects the
 * first: on a straight light–heavy–light stroke every interior sample lies on
 * the chord, so all of them are dropped together with the pressure extremum —
 * the stroke's only feature. These tests pin both halves of the contract:
 * geometry keeps its classic bound, and the profile keeps its extrema.
 */
import { describe, expect, it } from 'vitest';
import { fitPathToBeziers, PRESSURE_PROFILE_EPSILON, simplifyPoints } from '../fitting';

/** A straight horizontal run from x=0..100 whose pressure peaks in the middle. */
function lightHeavyLight(samples = 21): Array<{ x: number; y: number; pressure: number }> {
  const points: Array<{ x: number; y: number; pressure: number }> = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    points.push({
      x: t * 100,
      y: 0,
      // 0.1 at both ends, 0.9 at the centre; perfectly collinear in x/y.
      pressure: 0.1 + 0.8 * (1 - Math.abs(2 * t - 1)),
    });
  }
  return points;
}

/** A monotone light→heavy ramp: the linear interpolation already describes it. */
function pressureRamp(samples = 21): Array<{ x: number; y: number; pressure: number }> {
  const points: Array<{ x: number; y: number; pressure: number }> = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    points.push({ x: t * 100, y: 0, pressure: 0.2 + 0.6 * t });
  }
  return points;
}

describe('simplifyPoints pressure profile', () => {
  it('keeps a collinear pressure extremum when a pressure tolerance is given', () => {
    const points = lightHeavyLight();
    const simplified = simplifyPoints(points, 2, PRESSURE_PROFILE_EPSILON);

    expect(simplified.length).toBeGreaterThan(2);
    const peak = Math.max(...simplified.map((p) => p.pressure ?? 0));
    // The measured peak survives; it is not replaced by an interpolated value.
    expect(peak).toBeCloseTo(0.9, 5);
    expect(simplified.some((p) => Math.abs((p.pressure ?? 0) - 0.9) < 1e-6)).toBe(true);
  });

  it('still drops a collinear pressure extremum without a pressure tolerance', () => {
    // Characterization of the pre-fix behaviour: geometry-only RDP is blind to
    // the profile. This is why the Pencil tool must ask for the profile.
    const simplified = simplifyPoints(lightHeavyLight(), 2);
    expect(simplified).toHaveLength(2);
  });

  it('does not add anchors for a linear pressure ramp', () => {
    const simplified = simplifyPoints(pressureRamp(), 2, PRESSURE_PROFILE_EPSILON);
    expect(simplified).toHaveLength(2);
    expect(simplified[0]?.pressure).toBeCloseTo(0.2, 5);
    expect(simplified[1]?.pressure).toBeCloseTo(0.8, 5);
  });

  it('keeps the geometric RDP bound: a curved run still splits at the worst point', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 30 },
      { x: 100, y: 0 },
    ];
    const simplified = simplifyPoints(points, 2, PRESSURE_PROFILE_EPSILON);
    expect(simplified).toHaveLength(3);
    expect(simplified[1]).toEqual({ x: 50, y: 30 });
  });

  it('is a no-op on points that carry no pressure data', () => {
    const geometryOnly = [
      { x: 0, y: 0 },
      { x: 50, y: 0.5 },
      { x: 100, y: 0 },
    ];
    expect(simplifyPoints(geometryOnly, 2, PRESSURE_PROFILE_EPSILON)).toEqual(
      simplifyPoints(geometryOnly, 2),
    );
  });

  it('never inflates the point count past the input', () => {
    const points = lightHeavyLight();
    const simplified = simplifyPoints(points, 0, PRESSURE_PROFILE_EPSILON);
    expect(simplified.length).toBeLessThanOrEqual(points.length);
    expect(simplified.length).toBeGreaterThan(0);
  });
});

describe('fitPathToBeziers pressure profile', () => {
  it('preserves the pressure extremum as a real anchor', () => {
    const points = lightHeavyLight();
    const simplified = simplifyPoints(points, 2, PRESSURE_PROFILE_EPSILON);
    const fitted = fitPathToBeziers(simplified, {
      pressureEpsilon: PRESSURE_PROFILE_EPSILON,
    });

    const pressures = fitted.map((p) => p.pressure ?? 0);
    expect(fitted.length).toBeGreaterThan(2);
    expect(Math.max(...pressures)).toBeCloseTo(0.9, 5);
    // Both ends stay light; the profile is a peak, not a flat maximum.
    expect(pressures[0]).toBeLessThan(0.2);
    expect(pressures[pressures.length - 1]).toBeLessThan(0.2);
  });

  it('collapses the same straight stroke to two anchors without a pressure tolerance', () => {
    const fitted = fitPathToBeziers(lightHeavyLight());
    const pressures = fitted.map((p) => p.pressure ?? 0);
    // Characterization of the defect this option exists to fix.
    expect(fitted).toHaveLength(2);
    expect(Math.max(...pressures)).toBeCloseTo(0.1, 5);
  });

  it('honours a caller-supplied maxError for the on-screen fit tolerance', () => {
    const arc: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      arc.push({ x: t * 100, y: Math.sin(t * Math.PI) * 20 });
    }
    const loose = fitPathToBeziers(arc, { maxError: 5 });
    const tight = fitPathToBeziers(arc, { maxError: 0.05 });
    expect(tight.length).toBeGreaterThan(loose.length);
  });

  it('keeps the default tolerance when no options are supplied', () => {
    const arc: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      arc.push({ x: t * 100, y: Math.sin(t * Math.PI) * 10 });
    }
    expect(fitPathToBeziers(arc)).toEqual(fitPathToBeziers(arc, { maxError: 2.5 }));
  });
});
