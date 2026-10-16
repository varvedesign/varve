import type { RasterLayerNode, RasterTile } from '@varve/scene';
import { makeRasterLayerNode, TILE_SIZE } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { sceneNodeToEngineNode } from './sceneToEngine';

function layerWith(tiles: Map<string, RasterTile>): RasterLayerNode {
  return {
    ...makeRasterLayerNode('rl', { width: 2 * TILE_SIZE, height: TILE_SIZE }),
    tiles,
  };
}

function tile(fill: number, version: number): RasterTile {
  return { pixels: new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4).fill(fill), version };
}

function convert(layer: RasterLayerNode) {
  return sceneNodeToEngineNode(layer, {}, { nodes: {}, assets: {} } as never).rasterLayerData!;
}

describe('raster layer engine conversion: tile content identity', () => {
  it('gives an unchanged tile buffer the same identity on every conversion', () => {
    const shared = tile(10, 2);
    const first = convert(layerWith(new Map([['0:0', shared]])));
    const second = convert(layerWith(new Map([['0:0', shared]])));
    expect(first.tiles['0:0']!.contentId).toBeDefined();
    expect(second.tiles['0:0']!.contentId).toBe(first.tiles['0:0']!.contentId);
  });

  it('gives a replaced buffer a new identity even when the version number is unchanged', () => {
    const before = convert(layerWith(new Map([['0:0', tile(10, 2)]])));
    const after = convert(layerWith(new Map([['0:0', tile(200, 2)]])));
    expect(after.tiles['0:0']!.version).toBe(before.tiles['0:0']!.version);
    expect(after.tiles['0:0']!.contentId).not.toBe(before.tiles['0:0']!.contentId);
  });

  it('keeps identities of untouched tiles when a different tile is replaced', () => {
    const untouched = tile(5, 1);
    const before = convert(
      layerWith(
        new Map([
          ['0:0', untouched],
          ['1:0', tile(1, 1)],
        ]),
      ),
    );
    const after = convert(
      layerWith(
        new Map([
          ['0:0', untouched],
          ['1:0', tile(2, 2)],
        ]),
      ),
    );
    expect(after.tiles['0:0']!.contentId).toBe(before.tiles['0:0']!.contentId);
    expect(after.tiles['1:0']!.contentId).not.toBe(before.tiles['1:0']!.contentId);
  });

  it('hands the tile buffer to the IR by reference instead of copying it', () => {
    // `Array.from` here cost ~130 ms per MiB of raster on every conversion —
    // and a stroke batch publishes a new node, so that was every batch — while
    // holding the pixels as an 8x larger boxed number array. Published tile
    // buffers are immutable, so the IR can read the document's buffer directly.
    const shared = tile(10, 2);
    const data = convert(layerWith(new Map([['0:0', shared]])));
    expect(data.tiles['0:0']!.pixels).toBe(shared.pixels);
  });

  it('reads the tile view own bytes when a producer hands over a subarray', () => {
    // A tile is 128x128x4 bytes, but a producer may legitimately hand over a
    // view into a shared scratch buffer. The contract the IR must honour is
    // therefore "the bytes this view covers", not "the start of the backing
    // buffer": filling the surroundings with a distinct value makes an
    // offset-blind read visible. The previous version of this test allocated a
    // full-size array, so it exercised no view at all.
    const tileBytes = TILE_SIZE * TILE_SIZE * 4;
    const backing = new Uint8ClampedArray(tileBytes * 3).fill(77);
    const view = backing.subarray(tileBytes, tileBytes * 2);
    view[0] = 9;
    view[view.length - 1] = 11;

    const data = convert(layerWith(new Map([['0:0', { pixels: view, version: 1 }]])));
    const handed = data.tiles['0:0']!.pixels as Uint8ClampedArray;

    expect(handed.length).toBe(tileBytes);
    expect(handed[0]).toBe(9);
    expect(handed[handed.length - 1]).toBe(11);
    // Exactly the view's own bytes, with the 77 fill around it untouched.
    expect([...handed].filter((b) => b !== 77)).toEqual([9, 11]);
  });
});
