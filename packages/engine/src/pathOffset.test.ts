import { describe, expect, it } from 'vitest';
import { expandStroke, offsetPath, roundCorners } from './pathOffset';
import type { PathPoint } from './types';

function linePath(fromX: number, fromY: number, toX: number, toY: number): PathPoint[] {
  return [
    { x: fromX, y: fromY, handleIn: null, handleOut: null },
    { x: toX, y: toY, handleIn: null, handleOut: null },
  ];
}

function rectPath(x: number, y: number, w: number, h: number): PathPoint[] {
  return [
    { x, y, handleIn: null, handleOut: null },
    { x: x + w, y, handleIn: null, handleOut: null },
    { x: x + w, y: y + h, handleIn: null, handleOut: null },
    { x, y: y + h, handleIn: null, handleOut: null },
  ];
}

describe('offsetPath', () => {
  it('returns same path for distance=0', () => {
    const pts = linePath(0, 0, 100, 0);
    const result = offsetPath(pts, false, 0);
    expect(result).toHaveLength(2);
    expect(result[0]!.x).toBe(0);
    expect(result[1]!.x).toBe(100);
  });

  it('offsets a horizontal line upward', () => {
    const pts = linePath(0, 0, 100, 0);
    const result = offsetPath(pts, false, 10);
    // All points should be at y=-10 (offset upward = negative y)
    // But with miter join at non-closed end, result may include end caps
    expect(result.length).toBeGreaterThanOrEqual(2);
    for (const p of result) {
      expect(p.y).toBeLessThan(0);
    }
  });

  it('offsets a horizontal line downward (negative distance)', () => {
    const pts = linePath(0, 0, 100, 0);
    const result = offsetPath(pts, false, -10);
    expect(result.length).toBeGreaterThanOrEqual(2);
    for (const p of result) {
      expect(p.y).toBeGreaterThan(0);
    }
  });

  it('offsets a closed rectangle outward', () => {
    const pts = rectPath(0, 0, 100, 50);
    const result = offsetPath(pts, true, 5, 'miter', 10);
    // Offset should expand the rectangle — at least 4 points, all finite
    expect(result.length).toBeGreaterThanOrEqual(4);
    for (const p of result) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    // Some point should be outside original bounds (expanded)
    const expanded = result.some((p) => p.x < 0 || p.x > 100 || p.y < 0 || p.y > 50);
    expect(expanded).toBe(true);
  });

  it('keeps offset work bounded for an extreme distance (no hang or OOM)', () => {
    // vectorcraft#1028: a user-supplied distance multiplied the per-vertex arc
    // steps, so offsetting a many-vertex outline froze the app until it ran out
    // of memory. Work must stay bounded by the geometry, not by the distance.
    const pts = Array.from({ length: 512 }, (_, i) => {
      const a = (i / 512) * Math.PI * 2;
      return { x: Math.cos(a) * 100, y: Math.sin(a) * 100, handleIn: null, handleOut: null };
    });
    const startedAt = performance.now();
    const result = offsetPath(pts, true, 1_000_000, 'round');
    const elapsed = performance.now() - startedAt;

    expect(result.length).toBeLessThanOrEqual(200_000);
    expect(elapsed).toBeLessThan(2_000);
    for (const p of result) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('tessellates a round join into an arc instead of a single miter point', () => {
    // Choosing "round" used to return one miter point per corner, because the
    // arc branch was unreachable for a normal corner.
    const pts = rectPath(0, 0, 100, 100);
    const distance = 10;
    const result = offsetPath(pts, true, distance, 'round');
    // Four corners, each an arc: strictly more points than the miter result.
    expect(result.length).toBeGreaterThan(4);
    // Every arc point sits at the offset radius from some original corner.
    const corners = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const arcPoints = result.filter((p) =>
      corners.some((c) => Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - distance) < 1e-6),
    );
    expect(arcPoints.length).toBeGreaterThanOrEqual(8);
  });

  it('rounds only the outside: an inward round offset keeps sharp corners', () => {
    // Regression: the arc was drawn on inner corners too, scooping
    // |distance|*(sqrt(2)-1) out of every corner. The default Offset Path
    // prompt is -8, so this was the default user path.
    const pts = rectPath(0, 0, 100, 100);
    const distance = 10;
    const result = offsetPath(pts, true, -distance, 'round');

    for (const p of result) {
      expect(p.x).toBeGreaterThan(distance - 1e-6);
      expect(p.y).toBeGreaterThan(distance - 1e-6);
    }
    // The eroded corner is the intersection of the two offset edges.
    expect(
      result.some((p) => Math.abs(p.x - distance) < 1e-6 && Math.abs(p.y - distance) < 1e-6),
    ).toBe(true);
  });

  it('enforces the point ceiling across the whole path, not per join', () => {
    // A spiky outline with enough vertices that per-join arcs exceed the global
    // ceiling. Without the loop-level check the total grew with the vertex
    // count even after the ceiling was reached.
    const count = 8192;
    const pts = Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2;
      const r = i % 2 === 0 ? 100 : 2;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r, handleIn: null, handleOut: null };
    });
    const result = offsetPath(pts, true, 10_000, 'round');

    expect(result.length).toBeLessThanOrEqual(200_000);
    // The cap was actually reached, so the assertion above is not vacuous.
    expect(result.length).toBeGreaterThan(150_000);
    expect(result.length).toBeGreaterThan(0);
    for (const p of result) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('keeps a sharp miter corner when the miter limit allows it', () => {
    const pts = rectPath(0, 0, 100, 100);
    const result = offsetPath(pts, true, 10, 'miter', 10);
    // The four mitered corners sit at (-10,-10) and friends: outside both
    // offset edges, which a bevel corner would never reach.
    expect(result.some((p) => p.x < -9.9 && p.y < -9.9)).toBe(true);
  });

  it('offsets an open path without bridging its two ends', () => {
    const pts = [
      { x: 0, y: 0, handleIn: null, handleOut: null },
      { x: 50, y: 0, handleIn: null, handleOut: null },
      { x: 100, y: 0, handleIn: null, handleOut: null },
    ];
    const result = offsetPath(pts, false, 10);
    // A straight open path has no joins: one point per segment boundary, and
    // no arc bridging the far end back to the start.
    expect(result).toHaveLength(3);
    expect(result[0]!.x).toBeCloseTo(0);
    expect(result[result.length - 1]!.x).toBeCloseTo(100);
    for (const p of result) expect(p.y).toBeCloseTo(-10);
  });

  it('offsets a closed rectangle inward (negative)', () => {
    const pts = rectPath(0, 0, 100, 50);
    const result = offsetPath(pts, true, -5);
    // Should have at least 4 finite points
    expect(result.length).toBeGreaterThanOrEqual(4);
    for (const p of result) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});

describe('expandStroke', () => {
  it('expands a line segment into a closed outline', () => {
    const pts = linePath(0, 0, 100, 0);
    const widths = [10, 10];
    const result = expandStroke(pts, false, widths, 'round');
    // Should produce left + right with round caps
    expect(result.length).toBeGreaterThan(2);
    // All points should form a closed outline
    expect(result[0]!.x).toBeCloseTo(0);
    expect(result[result.length - 1]!.x).toBeCloseTo(0);
  });

  it('expands with different widths per vertex', () => {
    const pts = linePath(0, 0, 100, 0);
    const widths = [10, 20]; // Wider at end
    const result = expandStroke(pts, false, widths, 'butt');
    expect(result.length).toBeGreaterThan(2);
    // The right offset curve should be wider at the end
    // (right offset is at negative y, more negative = wider)
  });

  it('expands a closed triangle', () => {
    const pts: PathPoint[] = [
      { x: 0, y: 0, handleIn: null, handleOut: null },
      { x: 50, y: -50, handleIn: null, handleOut: null },
      { x: 100, y: 0, handleIn: null, handleOut: null },
    ];
    const result = expandStroke(pts, true, [10, 10, 10], 'round');
    // Should produce left + right, so at least 6 points
    expect(result.length).toBeGreaterThanOrEqual(6);
  });
});

describe('roundCorners', () => {
  it('returns same path for 0 radius', () => {
    const pts = rectPath(0, 0, 100, 50);
    const result = roundCorners(pts, true, 0);
    expect(result).toHaveLength(pts.length);
    expect(result[0]!.x).toBe(0);
  });

  it('rounds corners of a rectangle', () => {
    const pts = rectPath(0, 0, 100, 50);
    const result = roundCorners(pts, true, 10);
    // Should have more points than original (arc segments added)
    expect(result.length).toBeGreaterThan(pts.length);
    // TL corner should be clipped: no point should be exactly at (0,0) since it's rounded
    const atOrigin = result.find((p) => Math.abs(p.x) < 1 && Math.abs(p.y) < 1);
    expect(atOrigin).toBeUndefined();
    // Every point's x,y should be finite
    for (const p of result) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('does not modify open path endpoints', () => {
    const _pts = linePath(0, 0, 100, 0);
    // Add intermediate points so we have corners to round
    const pts3: PathPoint[] = [
      { x: 0, y: 0, handleIn: null, handleOut: null },
      { x: 50, y: 50, handleIn: null, handleOut: null },
      { x: 100, y: 0, handleIn: null, handleOut: null },
    ];
    const result = roundCorners(pts3, false, 10);
    // Open endpoints should be unchanged
    expect(result[0]!.x).toBe(0);
    expect(result[0]!.y).toBe(0);
    expect(result[result.length - 1]!.x).toBe(100);
    expect(result[result.length - 1]!.y).toBe(0);
  });

  it('handles very large radius by clamping to segment length', () => {
    const pts = rectPath(0, 0, 20, 20);
    // Radius = 100 is larger than any side (20px), should clamp
    const result = roundCorners(pts, true, 100);
    expect(result.length).toBeGreaterThanOrEqual(4);
    // Should not crash and should produce reasonable results
    for (const p of result) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});

describe('miter limit semantics', () => {
  /** Closed triangle with a ~5.7 degree apex at (50, 0): ratio ~20. */
  const spike = [
    { x: 50, y: 0, handleIn: null, handleOut: null },
    { x: 60, y: 200, handleIn: null, handleOut: null },
    { x: 40, y: 200, handleIn: null, handleOut: null },
  ];

  it('clips an acute miter once the ratio exceeds the limit', () => {
    // ratio = 1 / sin(2.86 deg) ~ 20, so miterLimit 4 must bevel the corner
    // instead of letting the spike run past the offset edge.
    const result = offsetPath(spike, true, 10, 'miter', 4);
    expect(Math.min(...result.map((p) => p.y))).toBeGreaterThan(-10);
  });

  it('keeps the same miter when the limit allows it', () => {
    const result = offsetPath(spike, true, 10, 'miter', 100);
    expect(Math.min(...result.map((p) => p.y))).toBeLessThan(-100);
  });

  it('decides from the angle, not the edge length', () => {
    // Uniform scaling preserves the angles, so the decision must not change.
    // The pre-fix ratio divided by edge length, so longer edges never clipped.
    const scaled = spike.map((p) => ({ ...p, x: p.x * 5, y: p.y * 5 }));
    const short = offsetPath(spike, true, 10, 'miter', 4);
    const long = offsetPath(scaled, true, 10, 'miter', 4);
    expect(Math.min(...short.map((p) => p.y))).toBeGreaterThan(-10);
    expect(Math.min(...long.map((p) => p.y))).toBeGreaterThan(-10);
  });
});
