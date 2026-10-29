import { describe, expect, it, vi } from 'vitest';
import { booleanTwoPolygons } from './engine';
import { type ClipperRegion, clipRegions } from './polygon-clipper';

const clipperHarness = vi.hoisted(() => ({ failDifference: false }));

vi.mock('polygon-clipping', async (importOriginal) => {
  const actual = await importOriginal<typeof import('polygon-clipping')>();
  const kernel = ((actual as { default?: typeof actual }).default ?? actual) as {
    union: (...args: never[]) => unknown;
    intersection: (...args: never[]) => unknown;
    xor: (...args: never[]) => unknown;
    difference: (...args: never[]) => unknown;
  };
  const difference = (...args: never[]) => {
    if (clipperHarness.failDifference) {
      throw new Error(
        'Unable to complete output ring starting at [0, 0]. Last matching segment found ends at [1, 1].',
      );
    }
    return kernel.difference(...args);
  };
  const wrapped = {
    union: kernel.union,
    intersection: kernel.intersection,
    xor: kernel.xor,
    difference,
  };
  return { ...actual, ...wrapped, default: wrapped };
});

function rectRegion(x: number, y: number, w: number, h: number): ClipperRegion {
  return {
    components: [
      {
        outer: [
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h },
          { x, y: y + h },
        ],
        holes: [],
      },
    ],
    fillRule: 'evenodd',
  };
}

describe('clipRegions', () => {
  it('falls back instead of throwing when the kernel cannot complete an output ring', () => {
    clipperHarness.failDifference = true;
    try {
      const subject = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ];
      const clip = [
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 10, y: 10 },
      ];
      expect(() => booleanTwoPolygons(subject, clip, 'subtract')).not.toThrow();
      const result = clipRegions(
        [rectRegion(0, 0, 10, 10), rectRegion(10, 0, 10, 10)],
        'subtract',
        1e-9,
      );
      expect(result.components.length).toBeGreaterThan(0);
      expect(result.components[0]?.outer.length).toBeGreaterThanOrEqual(3);
    } finally {
      clipperHarness.failDifference = false;
    }
  });

  it('does not throw on a subtract that shares an edge', () => {
    expect(() =>
      clipRegions([rectRegion(0, 0, 100, 100), rectRegion(100, 0, 100, 100)], 'subtract', 1e-9),
    ).not.toThrow();
  });
});
