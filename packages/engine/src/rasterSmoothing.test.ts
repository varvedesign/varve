/**
 * Raster smoothing policy.
 *
 * A placed image drawn smaller than its pixel size is minified by the canvas.
 * The interactive compositor asks for `imageSmoothingQuality: 'high'`; an
 * export surface that leaves the default samples with a cheaper filter, so the
 * exported file is raggeder than the same artwork on screen. These tests pin
 * the shared policy so the two surfaces cannot drift apart again.
 */
import { describe, expect, it } from 'vitest';
import { applyRasterSmoothingPolicy } from './raster';

interface FakeContext {
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
}

type SmoothingTarget = Parameters<typeof applyRasterSmoothingPolicy>[0];

function fakeContext(): FakeContext {
  return { imageSmoothingEnabled: false, imageSmoothingQuality: 'low' };
}

function apply(ctx: FakeContext, options?: { antiAlias?: boolean }): void {
  applyRasterSmoothingPolicy(ctx as unknown as SmoothingTarget, options);
}

describe('applyRasterSmoothingPolicy', () => {
  it('asks for high-quality sampling on a normal surface', () => {
    const ctx = fakeContext();
    apply(ctx);
    expect(ctx.imageSmoothingEnabled).toBe(true);
    expect(ctx.imageSmoothingQuality).toBe('high');
  });

  it('honours an explicit nearest-neighbour request', () => {
    const ctx = fakeContext();
    apply(ctx, { antiAlias: false });
    expect(ctx.imageSmoothingEnabled).toBe(false);
    // The quality hint is meaningless while smoothing is off; leaving it
    // untouched keeps a later re-enable from inheriting a stale value.
    expect(ctx.imageSmoothingQuality).toBe('low');
  });

  it('matches the interactive compositor policy', () => {
    // packages/compositor/src/canvas2d/backend.ts sets exactly these values.
    const ctx = fakeContext();
    apply(ctx);
    expect({ enabled: ctx.imageSmoothingEnabled, quality: ctx.imageSmoothingQuality }).toEqual({
      enabled: true,
      quality: 'high',
    });
  });
});
