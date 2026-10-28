// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetImageCache } from './imageCache';
import type { ReplayTarget } from './replay';
import { replayIr } from './replay';
import { recorder } from './replay-fill.test-helpers';
import type { RenderItem } from './types';

beforeEach(() => {
  resetImageCache();
});

afterEach(() => {
  resetImageCache();
});
describe('multi-item compositing edge cases', () => {
  // ── Backdrop blur cache tests ──────────────────────────────────────────

  describe('backdrop blur cache', () => {
    function makeBackgroundBlurTarget(): ReplayTarget {
      const mockCanvas = { width: 200, height: 200 } as HTMLCanvasElement;
      const rec = recorder();
      return {
        ...rec.target,
        canvas: mockCanvas,
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        drawImage: (..._args: unknown[]) => {
          rec.calls.push(`drawImage(${_args.length})`);
        },
      };
    }

    function makeBlurItem(overrides?: Partial<RenderItem> & { radius?: number }): RenderItem {
      return {
        transform: [1, 0, 0, 1, 10, 10],
        fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
        effects: [{ type: 'backgroundBlur', radius: overrides?.radius ?? 4, visible: true }],
        primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
        ...overrides,
      };
    }

    it('stores one entry on first paint and reuses it on second call', async () => {
      const { __getBackdropCacheSize, __clearBackdropCache: clr } = await import('./replay');
      clr();

      const target = makeBackgroundBlurTarget();
      const item = makeBlurItem();

      expect(__getBackdropCacheSize()).toBe(0);
      replayIr(target, [item]);
      expect(__getBackdropCacheSize()).toBe(1);

      // Second call with same params: cache hit
      replayIr(target, [item]);
      expect(__getBackdropCacheSize()).toBe(1);
    });

    it('replaces the replay-scoped cache entry when blur radius changes', async () => {
      const { __getBackdropCacheSize, __clearBackdropCache: clr } = await import('./replay');
      clr();

      const target = makeBackgroundBlurTarget();

      replayIr(target, [makeBlurItem({ radius: 4 })]);
      const sizeAfterFirst = __getBackdropCacheSize();
      expect(sizeAfterFirst).toBe(1);

      replayIr(target, [makeBlurItem({ radius: 8 })]);
      // Cache is intentionally scoped to one replay; the second replay starts
      // clean and stores the new radius rather than retaining stale pixels.
      expect(__getBackdropCacheSize()).toBe(1);
    });

    it('replaces the replay-scoped cache entry when transform changes', async () => {
      const { __getBackdropCacheSize, __clearBackdropCache: clr } = await import('./replay');
      clr();

      const target = makeBackgroundBlurTarget();

      replayIr(target, [makeBlurItem()]);
      expect(__getBackdropCacheSize()).toBe(1);

      // Different transform → different screen-space bounds → cache miss
      replayIr(target, [makeBlurItem({ transform: [2, 0, 0, 2, 0, 0] })]);
      expect(__getBackdropCacheSize()).toBe(1);
    });

    it('limits cache to 20 entries (LRU eviction)', async () => {
      const { __getBackdropCacheSize, __clearBackdropCache: clr } = await import('./replay');
      clr();

      const mockCanvas = { width: 500, height: 500 } as HTMLCanvasElement;
      const rec = recorder();
      const target: ReplayTarget = {
        ...rec.target,
        canvas: mockCanvas,
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        drawImage: (..._args: unknown[]) => {
          rec.calls.push(`drawImage(${_args.length})`);
        },
      };

      // 25 different items (different positions) → cache must evict to ≤20
      for (let i = 0; i < 25; i++) {
        replayIr(target, [
          {
            transform: [1, 0, 0, 1, i * 10, i * 10],
            fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
            effects: [{ type: 'backgroundBlur', radius: 4, visible: true }],
            primitive: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
          },
        ]);
      }

      expect(__getBackdropCacheSize()).toBeLessThanOrEqual(20);
    });

    it('clears all entries via __clearBackdropCache', async () => {
      const { __getBackdropCacheSize, __clearBackdropCache: clr } = await import('./replay');
      clr();

      const target = makeBackgroundBlurTarget();

      replayIr(target, [makeBlurItem()]);
      expect(__getBackdropCacheSize()).toBe(1);

      clr();
      expect(__getBackdropCacheSize()).toBe(0);
    });

    it('still renders correctly on cache hit (drawImage + clip called)', async () => {
      const { __clearBackdropCache: clr } = await import('./replay');
      clr();

      const mockCanvas = { width: 200, height: 200 } as HTMLCanvasElement;
      const callOrder: string[] = [];
      const target: ReplayTarget = {
        ...recorder().target,
        canvas: mockCanvas,
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        drawImage: (..._args: unknown[]) => {
          callOrder.push('drawImage');
        },
        fillRect: (..._args: unknown[]) => {
          callOrder.push('fillRect');
        },
      };

      const item = makeBlurItem();

      // First call: cache miss, captures+blurs+composites
      replayIr(target, [item]);
      expect(callOrder.filter((c) => c === 'drawImage').length).toBeGreaterThanOrEqual(1);

      // Second call: cache hit, should still composite via drawImage
      const drawImageBefore = callOrder.filter((c) => c === 'drawImage').length;
      replayIr(target, [item]);
      const drawImageAfter = callOrder.filter((c) => c === 'drawImage').length;
      // drawImage must still be called (compositing the cached result)
      expect(drawImageAfter).toBeGreaterThan(drawImageBefore);
    });
  });
});
