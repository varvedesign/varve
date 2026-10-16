/**
 * Two histories can reach the same per-tile version number with different
 * pixels (undo then a different stroke, or two branches that each painted the
 * tile once more). This drives that situation through the real chain a frame
 * takes: tile drafts -> scene raster layer -> engine IR conversion -> retained
 * per-layer surface, and asserts the surface ends up holding the pixels of the
 * document being shown rather than of the one shown before.
 */
import { RasterLayerCache, type RasterTileIR } from '@varve/engine';
import type { BrushDab, RasterLayerNode } from '@varve/scene';
import { beginRasterTileDraft, makeRasterLayerNode, TILE_SIZE } from '@varve/scene';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sceneNodeToEngineNode } from './sceneToEngine';

interface UploadedTile {
  x: number;
  y: number;
  /** First four bytes of the uploaded tile, enough to tell strokes apart. */
  firstPixel: number[];
}

let uploads: UploadedTile[] = [];
const OriginalOffscreen = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;

beforeEach(() => {
  uploads = [];
  class FakeOffscreenCanvas {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return {
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: (image: { data: Uint8ClampedArray }, x: number, y: number) => {
          uploads.push({ x, y, firstPixel: Array.from(image.data.subarray(0, 4)) });
        },
        clearRect: () => undefined,
      };
    }
  }
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = FakeOffscreenCanvas;
});

afterEach(() => {
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = OriginalOffscreen;
});

function dab(x: number, y: number): BrushDab {
  return {
    x,
    y,
    radius: 6,
    opacity: 1,
    flow: 1,
    hardness: 1,
    angle: 0,
    roundness: 1,
    strokeT: 0,
    strokeDistance: 0,
  };
}

function strokeOn(
  layer: RasterLayerNode,
  color: [number, number, number, number],
  at: number,
): RasterLayerNode {
  const draft = beginRasterTileDraft(layer);
  for (let i = 0; i < 3; i++) draft.compositeDab(dab(at + i, at), color);
  return draft.commit();
}

function engineTiles(layer: RasterLayerNode): Record<string, RasterTileIR> {
  const node = sceneNodeToEngineNode(layer, {}, { nodes: {}, assets: {} } as never);
  return node.rasterLayerData!.tiles;
}

describe('retained raster surface across histories that reuse a tile version', () => {
  it('re-uploads when a second branch reaches the same version with different pixels', () => {
    const base = makeRasterLayerNode('rl', { width: TILE_SIZE, height: TILE_SIZE });
    // Shared ancestor: one stroke, tile 0:0 at version 2.
    const ancestor = strokeOn(base, [10, 10, 10, 255], 40);
    // Two branches each paint the tile once more with different colour.
    const branchA = strokeOn(ancestor, [255, 0, 0, 255], 60);
    const branchB = strokeOn(ancestor, [0, 0, 255, 255], 60);

    const a = branchA.tiles.get('0:0')!;
    const b = branchB.tiles.get('0:0')!;
    expect(a.version).toBe(b.version); // the aliasing precondition
    expect(a.pixels).not.toBe(b.pixels);
    expect(Array.from(a.pixels)).not.toEqual(Array.from(b.pixels));

    const cache = new RasterLayerCache();
    cache.acquire('rl', TILE_SIZE, TILE_SIZE, engineTiles(branchA), TILE_SIZE);
    uploads.length = 0;

    const switched = cache.acquire('rl', TILE_SIZE, TILE_SIZE, engineTiles(branchB), TILE_SIZE);

    expect(switched!.plan.changed).toEqual(['0:0']);
    expect(uploads).toHaveLength(1);
  });

  it('does not re-upload when the same branch is re-rendered unchanged', () => {
    const base = makeRasterLayerNode('rl', { width: TILE_SIZE, height: TILE_SIZE });
    const layer = strokeOn(strokeOn(base, [10, 10, 10, 255], 40), [255, 0, 0, 255], 60);

    const cache = new RasterLayerCache();
    cache.acquire('rl', TILE_SIZE, TILE_SIZE, engineTiles(layer), TILE_SIZE);
    uploads.length = 0;
    const again = cache.acquire('rl', TILE_SIZE, TILE_SIZE, engineTiles(layer), TILE_SIZE);

    expect(again!.plan.changed).toEqual([]);
    expect(uploads).toHaveLength(0);
  });

  it('keeps untouched tiles resident when only one tile is repainted', () => {
    const base = makeRasterLayerNode('rl', { width: 2 * TILE_SIZE, height: TILE_SIZE });
    const left = strokeOn(base, [10, 10, 10, 255], 40);
    const both = (() => {
      const draft = beginRasterTileDraft(left);
      for (let i = 0; i < 3; i++) draft.compositeDab(dab(TILE_SIZE + 40 + i, 40), [9, 9, 9, 255]);
      return draft.commit();
    })();
    const repainted = (() => {
      const draft = beginRasterTileDraft(both);
      for (let i = 0; i < 3; i++) draft.compositeDab(dab(TILE_SIZE + 60 + i, 60), [1, 2, 3, 255]);
      return draft.commit();
    })();
    expect(repainted.tiles.get('0:0')).toBe(both.tiles.get('0:0'));

    const cache = new RasterLayerCache();
    cache.acquire('rl', 2 * TILE_SIZE, TILE_SIZE, engineTiles(both), TILE_SIZE);
    uploads.length = 0;
    const next = cache.acquire('rl', 2 * TILE_SIZE, TILE_SIZE, engineTiles(repainted), TILE_SIZE);

    expect(next!.plan.changed).toEqual(['1:0']);
    expect(uploads.map((u) => u.x)).toEqual([TILE_SIZE]);
  });
});
