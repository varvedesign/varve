/**
 * Corner preservation in Bezier fitting.
 *
 * `fitPathToBeziers` splits a polyline at corner samples and gives each side
 * its own curve. Getting the corner test backwards is not a subtle quality
 * regression — it is two visible defects at once:
 *
 *   - a straight run is split at every retained sample, so a smooth stroke is
 *     committed as a chain of tiny curves instead of one;
 *   - a real corner is fitted with smooth symmetric handles, so a deliberate
 *     sharp turn is rounded off and the drawn shape no longer matches the
 *     drawn gesture.
 *
 * Both are pinned here against the actual committed geometry.
 */
import { describe, expect, it } from 'vitest';
import { fitPathToBeziers, simplifyPoints } from '../fitting';

/** L-shaped: straight along +x, then straight along +y. */
function rightAngle(): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= 10; i++) points.push({ x: i * 10, y: 0 });
  for (let i = 1; i <= 10; i++) points.push({ x: 100, y: i * 10 });
  return points;
}

/** One smooth quarter-circle, no corners anywhere. */
function quarterCircle(): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= 32; i++) {
    const t = (i / 32) * (Math.PI / 2);
    points.push({ x: 100 * Math.cos(t), y: 100 * Math.sin(t) });
  }
  return points;
}

describe('fitPathToBeziers corner detection', () => {
  it('adds no corner anchor inside a smooth run', () => {
    const fitted = fitPathToBeziers(quarterCircle());
    // A quarter circle is one or two Bezier segments, never one per sample.
    expect(fitted.length).toBeLessThanOrEqual(4);
    expect(fitted.length).toBeGreaterThanOrEqual(2);
    // Interior anchors of a smooth run carry handles on both sides.
    for (let i = 1; i < fitted.length - 1; i++) {
      expect(fitted[i]?.handleIn).not.toBeNull();
      expect(fitted[i]?.handleOut).not.toBeNull();
    }
  });

  it('keeps a right-angle corner as an anchor with no rounded handles on the turn', () => {
    const simplified = simplifyPoints(rightAngle(), 2);
    const cornerIndex = simplified.findIndex((p) => p.x === 100 && p.y === 0);
    expect(cornerIndex).toBeGreaterThan(0);
    expect(cornerIndex).toBeLessThan(simplified.length - 1);

    const fitted = fitPathToBeziers(simplified);
    const corner = fitted.find((p) => p.x === 100 && p.y === 0);
    expect(corner).toBeDefined();
    if (!corner) return;

    // A corner sample is split into two independent curves: the incoming
    // handle must not be the exact negative of the outgoing handle, which is
    // what a smooth continuation would produce.
    const inHandle: [number, number] | null = corner.handleIn;
    const outHandle: [number, number] | null = corner.handleOut;
    expect(inHandle).not.toBeNull();
    expect(outHandle).not.toBeNull();
    if (!inHandle || !outHandle) return;
    const isSymmetric =
      Math.abs(inHandle[0] + outHandle[0]) < 1e-9 && Math.abs(inHandle[1] + outHandle[1]) < 1e-9;
    expect(isSymmetric).toBe(false);
  });

  it('does not fragment a long straight stroke into many curves', () => {
    const straight: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 40; i++) straight.push({ x: i * 5, y: 0 });
    const fitted = fitPathToBeziers(straight);
    expect(fitted).toHaveLength(2);
  });

  it('reports the corner through geometry rather than tangential drift', () => {
    // The corner anchor must sit exactly on the drawn corner, not near it.
    const fitted = fitPathToBeziers(simplifyPoints(rightAngle(), 2));
    const corner = fitted.find((p) => p.x === 100 && p.y === 0);
    expect(corner?.x).toBe(100);
    expect(corner?.y).toBe(0);
  });
});
