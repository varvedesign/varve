/**
 * Correctness corpus for dirty-tile raster replay.
 *
 * The optimization changes *when* tile pixels are written into the layer's
 * intermediate surface, never what is written or how the surface is composited.
 * These tests pin that contract: every scenario asserts the resident pixel
 * state is identical to what a full rebuild would produce.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYER_SURFACE_BUDGET_BYTES,
  getRasterLayerCache,
  planTileUploads,
  RasterLayerCache,
  type RasterLayerSurface,
  resetRasterLayerCache,
} from './rasterLayerCache';
import { tilePixelsIdentity } from './rasterTileIdentity';

const TILE = 4; // Small tiles keep the fixtures readable.

function tile(version: number, fill = 0): { pixels: number[]; version: number } {
  return { pixels: new Array(TILE * TILE * 4).fill(fill), version };
}

/**
 * Minimal 2D context recording every pixel write, so a partial upload can be
 * compared against a full rebuild without a real canvas.
 */
function installFakeCanvas(): {
  writes: Array<{ x: number; y: number; fill: number }>;
  clears: Array<{ x: number; y: number }>;
  allocations: number;
} {
  const writes: Array<{ x: number; y: number; fill: number }> = [];
  const clears: Array<{ x: number; y: number }> = [];
  let allocations = 0;
  class FakeOffscreen {
    width = 0;
    height = 0;
    constructor(w: number, h: number) {
      allocations++;
      this.width = w;
      this.height = h;
    }
    getContext() {
      return {
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: (data: { data: Uint8ClampedArray }, x: number, y: number) => {
          writes.push({ x, y, fill: data.data[0] ?? 0 });
        },
        clearRect: (x: number, y: number) => {
          clears.push({ x, y });
        },
      };
    }
  }
  (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = FakeOffscreen;
  return {
    writes,
    clears,
    get allocations() {
      return allocations;
    },
  };
}

describe('planTileUploads', () => {
  const surface = (versions: Record<string, number>, w = 8, h = 8): RasterLayerSurface =>
    ({
      width: w,
      height: h,
      tileVersions: new Map(Object.entries(versions)),
    }) as RasterLayerSurface;

  it('requests every tile when there is no surface yet', () => {
    const plan = planTileUploads(null, 8, 8, { '0:0': tile(1), '1:0': tile(1) });
    expect(plan.fullRebuild).toBe(true);
    expect(plan.changed.sort()).toEqual(['0:0', '1:0']);
  });

  it('requests nothing when every tile version is already resident', () => {
    const plan = planTileUploads(surface({ '0:0': 1, '1:0': 1 }), 8, 8, {
      '0:0': tile(1),
      '1:0': tile(1),
    });
    expect(plan.fullRebuild).toBe(false);
    expect(plan.changed).toEqual([]);
    expect(plan.removed).toEqual([]);
  });

  it('requests only the tile whose version advanced — the brush-dab case', () => {
    const plan = planTileUploads(surface({ '0:0': 1, '1:0': 1, '2:0': 1 }), 8, 8, {
      '0:0': tile(1),
      '1:0': tile(2),
      '2:0': tile(1),
    });
    expect(plan.changed).toEqual(['1:0']);
  });

  it('treats a newly added tile as changed', () => {
    const plan = planTileUploads(surface({ '0:0': 1 }), 8, 8, { '0:0': tile(1), '9:9': tile(1) });
    expect(plan.changed).toEqual(['9:9']);
  });

  it('reports removed tiles so their stale pixels can be cleared', () => {
    const plan = planTileUploads(surface({ '0:0': 1, '1:0': 1 }), 8, 8, { '0:0': tile(1) });
    expect(plan.removed).toEqual(['1:0']);
  });

  it('forces a full rebuild when the layer is resized', () => {
    const plan = planTileUploads(surface({ '0:0': 1 }, 8, 8), 16, 8, { '0:0': tile(1) });
    expect(plan.fullRebuild).toBe(true);
  });
});

describe('RasterLayerCache', () => {
  let recorder: ReturnType<typeof installFakeCanvas>;

  beforeEach(() => {
    recorder = installFakeCanvas();
    resetRasterLayerCache();
  });

  it('uploads every tile on first acquire, then none when nothing changed', () => {
    const cache = new RasterLayerCache();
    const tiles = { '0:0': tile(1, 10), '1:0': tile(1, 20) };
    cache.acquire('layer', 8, 4, tiles, TILE);
    expect(recorder.writes).toHaveLength(2);

    recorder.writes.length = 0;
    cache.acquire('layer', 8, 4, tiles, TILE);
    // The whole point: an unchanged layer costs zero tile uploads.
    expect(recorder.writes).toHaveLength(0);
    expect(cache.diagnostics.hits).toBe(1);
  });

  it('uploads only the changed tile after an edit', () => {
    const cache = new RasterLayerCache();
    cache.acquire('layer', 8, 4, { '0:0': tile(1, 10), '1:0': tile(1, 20) }, TILE);
    recorder.writes.length = 0;

    cache.acquire('layer', 8, 4, { '0:0': tile(1, 10), '1:0': tile(2, 99) }, TILE);
    expect(recorder.writes).toEqual([{ x: TILE, y: 0, fill: 99 }]);
  });

  it('produces the same resident pixels as a full rebuild', () => {
    // Parity: incremental uploads must leave the surface in the state a
    // from-scratch rebuild would produce.
    const cacheIncremental = new RasterLayerCache();
    cacheIncremental.acquire('a', 8, 4, { '0:0': tile(1, 10), '1:0': tile(1, 20) }, TILE);
    cacheIncremental.acquire('a', 8, 4, { '0:0': tile(2, 30), '1:0': tile(1, 20) }, TILE);
    const incremental = [...recorder.writes];

    recorder.writes.length = 0;
    const cacheFresh = new RasterLayerCache();
    cacheFresh.acquire('b', 8, 4, { '0:0': tile(2, 30), '1:0': tile(1, 20) }, TILE);
    const fresh = [...recorder.writes];

    // Final pixel state per position must match, regardless of write order.
    const finalState = (writes: typeof fresh) => {
      const map = new Map<string, number>();
      for (const w of writes) map.set(`${w.x}:${w.y}`, w.fill);
      return [...map.entries()].sort();
    };
    expect(finalState(incremental)).toEqual(finalState(fresh));
  });

  it('clears a removed tile so stale pixels cannot persist in the retained surface', () => {
    // The one hazard a persistent surface adds that a per-frame rebuild
    // cannot have.
    const cache = new RasterLayerCache();
    cache.acquire('layer', 8, 4, { '0:0': tile(1, 10), '1:0': tile(1, 20) }, TILE);
    recorder.clears.length = 0;

    cache.acquire('layer', 8, 4, { '0:0': tile(1, 10) }, TILE);
    expect(recorder.clears).toEqual([{ x: TILE, y: 0 }]);
  });

  it('rebuilds from scratch when the layer is resized', () => {
    const cache = new RasterLayerCache();
    cache.acquire('layer', 8, 4, { '0:0': tile(1, 10), '1:0': tile(1, 20) }, TILE);
    recorder.writes.length = 0;
    cache.acquire('layer', 16, 4, { '0:0': tile(1, 10), '1:0': tile(1, 20) }, TILE);
    expect(recorder.writes).toHaveLength(2);
    expect(cache.diagnostics.misses).toBe(2);
  });

  it('keeps separate surfaces per layer', () => {
    const cache = new RasterLayerCache();
    cache.acquire('a', 8, 4, { '0:0': tile(1, 10) }, TILE);
    cache.acquire('b', 8, 4, { '0:0': tile(1, 20) }, TILE);
    recorder.writes.length = 0;
    // Neither layer may be invalidated by the other's presence.
    cache.acquire('a', 8, 4, { '0:0': tile(1, 10) }, TILE);
    cache.acquire('b', 8, 4, { '0:0': tile(1, 20) }, TILE);
    expect(recorder.writes).toHaveLength(0);
  });

  it('evicts least-recently-used surfaces to stay inside its byte budget', () => {
    // Budget for exactly one 8x4 surface (128 bytes).
    const cache = new RasterLayerCache(8 * 4 * 4);
    cache.acquire('a', 8, 4, { '0:0': tile(1, 10) }, TILE);
    cache.acquire('b', 8, 4, { '0:0': tile(1, 20) }, TILE);
    expect(cache.diagnostics.surfaces).toBe(1);
    expect(cache.residentBytes).toBeLessThanOrEqual(8 * 4 * 4);
  });

  it('never evicts the surface it is currently serving', () => {
    const cache = new RasterLayerCache(8 * 4 * 4);
    const result = cache.acquire('a', 8, 4, { '0:0': tile(1, 10) }, TILE);
    expect(result).not.toBeNull();
    expect(cache.diagnostics.surfaces).toBe(1);
  });

  it('drops everything on clear — document close or context loss', () => {
    const cache = new RasterLayerCache();
    cache.acquire('a', 8, 4, { '0:0': tile(1, 10) }, TILE);
    cache.clear();
    expect(cache.diagnostics.surfaces).toBe(0);
    expect(cache.residentBytes).toBe(0);
  });

  it('releases a single layer without disturbing the others', () => {
    const cache = new RasterLayerCache();
    cache.acquire('a', 8, 4, { '0:0': tile(1, 10) }, TILE);
    cache.acquire('b', 8, 4, { '0:0': tile(1, 20) }, TILE);
    cache.release('a');
    expect(cache.diagnostics.surfaces).toBe(1);
  });

  it('holds no surfaces at all when the budget is zero', () => {
    const cache = new RasterLayerCache(0);
    const result = cache.acquire('a', 8, 4, { '0:0': tile(1, 10) }, TILE);
    expect(result).toBeNull();
    expect(recorder.allocations).toBe(0);
    expect(cache.diagnostics.surfaces).toBe(0);
    expect(cache.diagnostics.residentBytes).toBe(0);
  });

  it('does not allocate a surface larger than a positive byte budget', () => {
    const cache = new RasterLayerCache(64);
    const result = cache.acquire('oversized', 8, 4, { '0:0': tile(1, 10) }, TILE);
    expect(result).toBeNull();
    expect(recorder.allocations).toBe(0);
    expect(cache.diagnostics.surfaces).toBe(0);
    expect(cache.diagnostics.residentBytes).toBe(0);
  });

  it('exposes a shared instance that resets cleanly', () => {
    const cache = getRasterLayerCache();
    cache.acquire('a', 8, 4, { '0:0': tile(1, 10) }, TILE);
    expect(getRasterLayerCache().diagnostics.surfaces).toBe(1);
    resetRasterLayerCache();
    expect(getRasterLayerCache().diagnostics.surfaces).toBe(0);
  });

  it('defaults to a budget below the worker bitmap budget', () => {
    expect(DEFAULT_LAYER_SURFACE_BUDGET_BYTES).toBeLessThanOrEqual(128 * 1024 * 1024);
  });

  it('counts skipped tiles, which is the work the optimization removes', () => {
    const cache = new RasterLayerCache();
    const tiles = { '0:0': tile(1, 1), '1:0': tile(1, 2), '2:0': tile(1, 3), '3:0': tile(1, 4) };
    cache.acquire('layer', 16, 4, tiles, TILE);
    cache.acquire('layer', 16, 4, { ...tiles, '0:0': tile(2, 9) }, TILE);
    // Second pass: 1 of 4 tiles uploaded, 3 skipped.
    expect(cache.diagnostics.tilesUploaded).toBe(5);
    expect(cache.diagnostics.tilesSkipped).toBe(3);
  });
});

describe('RasterLayerCache content identity', () => {
  beforeEach(() => {
    resetRasterLayerCache();
  });

  const tileWithId = (version: number, fill: number, contentId: number) => ({
    pixels: new Array(TILE * TILE * 4).fill(fill),
    version,
    contentId,
  });

  it('re-uploads a tile whose version matches but whose content differs', () => {
    const { writes } = installFakeCanvas();
    const cache = new RasterLayerCache();

    // Branch A painted tile 0:0 to version 2.
    cache.acquire('layer', TILE, TILE, { '0:0': tileWithId(2, 10, 101) }, TILE);
    writes.length = 0;

    // Branch B reached the same version number with different pixels.
    const second = cache.acquire('layer', TILE, TILE, { '0:0': tileWithId(2, 200, 202) }, TILE);

    expect(second!.plan.changed).toEqual(['0:0']);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.fill).toBe(200);
  });

  it('still skips a tile whose version and content identity are both unchanged', () => {
    const { writes } = installFakeCanvas();
    const cache = new RasterLayerCache();
    cache.acquire('layer', TILE, TILE, { '0:0': tileWithId(2, 10, 101) }, TILE);
    writes.length = 0;

    const again = cache.acquire('layer', TILE, TILE, { '0:0': tileWithId(2, 10, 101) }, TILE);

    expect(again!.plan.changed).toEqual([]);
    expect(writes).toHaveLength(0);
  });

  it('falls back to version-only comparison when no content identity is supplied', () => {
    const { writes } = installFakeCanvas();
    const cache = new RasterLayerCache();
    cache.acquire('layer', TILE, TILE, { '0:0': tile(3, 5) }, TILE);
    writes.length = 0;
    const again = cache.acquire('layer', TILE, TILE, { '0:0': tile(3, 5) }, TILE);
    expect(again!.plan.changed).toEqual([]);
    expect(writes).toHaveLength(0);
  });

  it('re-uploads when another document reuses the same layer id and version', () => {
    // Node ids are document-local and can repeat across documents (legacy
    // sequential ids, or a reopened file). A retained surface keyed only by the
    // id would then hand document A's pixels to document B, because the version
    // counter restarts too. Pixel-buffer identity is what separates them.
    const { writes } = installFakeCanvas();
    const cache = new RasterLayerCache();

    const docAPixels = new Uint8ClampedArray(TILE * TILE * 4).fill(10);
    cache.acquire(
      'n5',
      TILE,
      TILE,
      { '0:0': { pixels: docAPixels, version: 1, contentId: tilePixelsIdentity(docAPixels) } },
      TILE,
    );
    writes.length = 0;

    const docBPixels = new Uint8ClampedArray(TILE * TILE * 4).fill(200);
    const second = cache.acquire(
      'n5',
      TILE,
      TILE,
      { '0:0': { pixels: docBPixels, version: 1, contentId: tilePixelsIdentity(docBPixels) } },
      TILE,
    );

    expect(second!.plan.changed).toEqual(['0:0']);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.fill).toBe(200);
  });

  it('records the residual limit: without an identity, a colliding id and version cannot be told apart', () => {
    // Pins exactly what the identity buys, so the fallback's weakness is a
    // documented property rather than a surprise. `sceneNodeToEngineNode`
    // always supplies `contentId`; a producer that omits it is the only route
    // to this case.
    const { writes } = installFakeCanvas();
    const cache = new RasterLayerCache();
    cache.acquire('n5', TILE, TILE, { '0:0': tile(1, 10) }, TILE);
    writes.length = 0;

    const second = cache.acquire('n5', TILE, TILE, { '0:0': tile(1, 200) }, TILE);

    expect(second!.plan.changed).toEqual([]);
    expect(writes).toHaveLength(0);
  });
});

/**
 * A tile payload now arrives either as the document's own `Uint8ClampedArray`
 * or as a plain number array. Both must upload the same bytes: the transport
 * change is a memory and allocation change, never a pixel change.
 */
describe('tile payload forms', () => {
  const BYTES = TILE * TILE * 4;

  function recordUploads(): Array<{ x: number; y: number; bytes: Uint8ClampedArray }> {
    const uploads: Array<{ x: number; y: number; bytes: Uint8ClampedArray }> = [];
    class FakeOffscreen {
      width = 0;
      height = 0;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        return {
          createImageData: (w: number, h: number) => ({
            data: new Uint8ClampedArray(w * h * 4),
          }),
          putImageData: (data: { data: Uint8ClampedArray }, x: number, y: number) => {
            uploads.push({ x, y, bytes: new Uint8ClampedArray(data.data) });
          },
          clearRect: () => {},
        };
      }
    }
    (globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = FakeOffscreen;
    return uploads;
  }

  const pattern = (n: number): number[] =>
    Array.from({ length: BYTES }, (_, i) => (i * (n + 3)) % 256);

  beforeEach(() => {
    resetRasterLayerCache();
  });

  it('uploads a typed-array payload byte-identically to a number array', () => {
    const expected = pattern(1);

    const arrayUploads = recordUploads();
    new RasterLayerCache().acquire(
      'a',
      TILE,
      TILE,
      { '0:0': { pixels: [...expected], version: 1 } },
      TILE,
    );
    expect(arrayUploads).toHaveLength(1);

    const typedUploads = recordUploads();
    new RasterLayerCache().acquire(
      'b',
      TILE,
      TILE,
      { '0:0': { pixels: Uint8ClampedArray.from(expected), version: 1 } },
      TILE,
    );
    expect(typedUploads).toHaveLength(1);

    expect([...typedUploads[0]!.bytes]).toEqual([...arrayUploads[0]!.bytes]);
    expect([...typedUploads[0]!.bytes]).toEqual(expected);
  });

  it('leaves the document buffer untouched (the IR only reads it)', () => {
    const uploads = recordUploads();
    const pixels = Uint8ClampedArray.from(pattern(7));
    const before = Uint8ClampedArray.from(pixels);
    new RasterLayerCache().acquire('a', TILE, TILE, { '0:0': { pixels, version: 1 } }, TILE);
    expect(uploads).toHaveLength(1);
    expect([...pixels]).toEqual([...before]);
  });

  it('accepts a Uint8Array payload and an odd-sized partial tile', () => {
    const uploads = recordUploads();
    const partial = new Uint8Array(8);
    partial.set([1, 2, 3, 4, 5, 6, 7, 8]);
    new RasterLayerCache().acquire(
      'a',
      TILE,
      TILE,
      { '0:0': { pixels: partial, version: 1 } },
      TILE,
    );
    // A short payload writes its own bytes and leaves the rest of the tile
    // transparent; it must not throw and must not read past its end.
    expect(uploads).toHaveLength(1);
    expect([...uploads[0]!.bytes.slice(0, 8)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...uploads[0]!.bytes.slice(8)].every((b) => b === 0)).toBe(true);
  });
});
