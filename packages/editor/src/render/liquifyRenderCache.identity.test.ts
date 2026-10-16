/**
 * Tile-table revision identity for the warped and frequency-separation caches.
 *
 * These caches decided reuse from a revision built out of tile keys and
 * `version` numbers. A version is a per-node mutation counter, so an undo
 * followed by a different stroke, or a divergent-branch checkout, reaches the
 * same number with different pixels — the revision string then matches and the
 * cache returns warped/FX tiles derived from the *other* pixels. The same class
 * of defect was fixed in `RasterLayerCache`, the partial-redraw guard and the IR
 * summary; these two caches were the remaining consumers.
 */
import type { RasterTile } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { rasterTileMapRevision } from './liquifyRenderCache';

const TILE_BYTES = 128 * 128 * 4;

function tile(fill: number, version: number): RasterTile {
  return { pixels: new Uint8ClampedArray(TILE_BYTES).fill(fill), version };
}

describe('rasterTileMapRevision', () => {
  it('is the same for the same tile records', () => {
    const shared = tile(10, 3);
    const a = new Map([
      ['0:0', shared],
      ['1:0', tile(20, 4)],
    ]);
    const b = new Map([
      ['0:0', shared],
      ['1:0', a.get('1:0')!],
    ]);
    expect(rasterTileMapRevision(a)).toBe(rasterTileMapRevision(b));
  });

  it('differs when a version number is reused for different pixels', () => {
    // The aliasing case: undo then a different stroke, or a branch checkout.
    const branchA = new Map([['0:0', tile(10, 7)]]);
    const branchB = new Map([['0:0', tile(200, 7)]]);
    expect(rasterTileMapRevision(branchA)).not.toBe(rasterTileMapRevision(branchB));
  });

  it('differs when a tile is added or removed', () => {
    const one = new Map([['0:0', tile(10, 1)]]);
    const two = new Map([
      ['0:0', one.get('0:0')!],
      ['1:0', tile(10, 1)],
    ]);
    expect(rasterTileMapRevision(one)).not.toBe(rasterTileMapRevision(two));
  });

  it('is stable across a re-read of the same buffers (no needless rewarping)', () => {
    // The identity token must not make ordinary reuse a miss: the whole point of
    // the cache is that an unchanged layer keeps its warped tiles.
    const tiles = new Map([
      ['0:0', tile(10, 1)],
      ['1:0', tile(20, 2)],
    ]);
    const first = rasterTileMapRevision(tiles);
    for (let i = 0; i < 5; i++) expect(rasterTileMapRevision(tiles)).toBe(first);
  });
});
