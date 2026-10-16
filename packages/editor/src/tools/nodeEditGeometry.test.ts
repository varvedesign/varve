import type { PathPoint } from '@varve/engine';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NODE_EDIT_TOLERANCES,
  findNodeEditHit,
  nodeEditTolerancesForPointer,
  TOUCH_NODE_EDIT_TOLERANCES,
} from './nodeEditGeometry';

const point = (x: number, y: number, handleOut: [number, number] | null = null): PathPoint => ({
  x,
  y,
  handleIn: null,
  handleOut,
});

describe('node edit screen-space hit testing', () => {
  it('uses the complete affine projection for rotated and non-uniform paths', () => {
    const transform = [0, 2, -1, 0, 300, 40] as const;
    const rings = [[point(10, 20), point(80, 20)]];
    const hit = findNodeEditHit(rings, false, transform, { x: 280, y: 60 }, (world) => world);
    expect(hit).toEqual({ kind: 'anchor', anchorIdx: 0 });
  });

  it('gives anchors priority over collapsed or nearby handles', () => {
    const rings = [[point(0, 0, [12, 0]), point(100, 0)]];
    expect(
      findNodeEditHit(rings, false, [1, 0, 0, 1, 0, 0], { x: 0, y: 0 }, (world) => world),
    ).toEqual({ kind: 'anchor', anchorIdx: 0 });
    expect(
      findNodeEditHit(rings, false, [1, 0, 0, 1, 0, 0], { x: 12, y: 0 }, (world) => world),
    ).toEqual({ kind: 'handle', anchorIdx: 0, which: 'out' });
  });

  it('includes the closing segment and returns its local parameter', () => {
    const rings = [[point(0, 0), point(100, 0), point(100, 100)]];
    const hit = findNodeEditHit(
      rings,
      true,
      [1, 0, 0, 1, 0, 0],
      { x: 20, y: 30 },
      (world) => world,
    );
    expect(hit?.kind).toBe('segment');
    expect(hit && hit.kind === 'segment' ? hit.segmentIndex : -1).toBe(2);
    expect(hit && hit.kind === 'segment' ? hit.t : -1).toBeGreaterThan(0);
    expect(hit && hit.kind === 'segment' ? hit.t : 2).toBeLessThan(1);
  });

  it('keeps compound holes closed when the outer contour is open', () => {
    const rings = [
      [point(0, 0), point(100, 0)],
      [point(20, 20), point(80, 20), point(50, 80)],
    ];
    const hit = findNodeEditHit(
      rings,
      false,
      [1, 0, 0, 1, 0, 0],
      { x: 35, y: 50 },
      (world) => world,
    );
    expect(hit?.kind).toBe('segment');
    expect(hit && hit.kind === 'segment' ? hit.ringIndex : -1).toBe(1);
    expect(hit && hit.kind === 'segment' ? hit.segmentIndex : -1).toBe(2);
  });

  it('keeps mouse/pen tolerances at the tight defaults and treats unknown as touch-like', () => {
    expect(nodeEditTolerancesForPointer('mouse')).toBe(DEFAULT_NODE_EDIT_TOLERANCES);
    expect(nodeEditTolerancesForPointer('pen')).toBe(DEFAULT_NODE_EDIT_TOLERANCES);
    expect(nodeEditTolerancesForPointer('touch')).toBe(TOUCH_NODE_EDIT_TOLERANCES);
    // Same touch-like policy as input ownership for unreporting WebViews.
    expect(nodeEditTolerancesForPointer('unknown')).toBe(TOUCH_NODE_EDIT_TOLERANCES);
    expect(nodeEditTolerancesForPointer('')).toBe(TOUCH_NODE_EDIT_TOLERANCES);
    expect(nodeEditTolerancesForPointer(undefined)).toBe(DEFAULT_NODE_EDIT_TOLERANCES);
  });

  it('grows touch tolerance in screen space without moving geometry', () => {
    const rings = [[point(0, 0), point(200, 0)]];
    // (10,10) sits 14px from the anchor and 10px above the segment: a miss for
    // the precise-pointer radii, an anchor hit for the touch radii.
    const pointer = { x: 10, y: 10 };
    expect(findNodeEditHit(rings, false, [1, 0, 0, 1, 0, 0], pointer, (world) => world)).toBeNull();
    expect(
      findNodeEditHit(
        rings,
        false,
        [1, 0, 0, 1, 0, 0],
        pointer,
        (world) => world,
        TOUCH_NODE_EDIT_TOLERANCES,
      ),
    ).toEqual({ kind: 'anchor', anchorIdx: 0 });
  });

  it('resolves dense anchors predictably under touch tolerance (nearest wins)', () => {
    const rings = [[point(0, 0), point(20, 0), point(40, 0)]];
    // Equidistant-ish tap between anchors 0 and 1 must pick the nearest one.
    const hit = findNodeEditHit(
      rings,
      false,
      [1, 0, 0, 1, 0, 0],
      { x: 13, y: 0 },
      (world) => world,
      TOUCH_NODE_EDIT_TOLERANCES,
    );
    expect(hit).toEqual({ kind: 'anchor', anchorIdx: 1 });
  });
});
