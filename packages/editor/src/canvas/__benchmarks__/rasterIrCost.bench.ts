/**
 * Raster IR cost bench: what a raster layer's RenderItem costs the per-node IR
 * cache, and what converting a scene node to engine IR costs.
 *
 * Three states are measured, because the ordering matters and one of them is a
 * trap:
 *
 *   A. previous code          pixels = number[]          previous estimate
 *   B. transport change only  pixels = Uint8ClampedArray  previous estimate
 *   C. this change            pixels = Uint8ClampedArray  new estimate
 *
 * State B is why both halves land together: `JSON.stringify` renders a typed
 * array as an index-keyed object (~10 chars per element) instead of a bare
 * number list, so moving the payload to the document's buffer *raises* the
 * accounting unless `estimateItemBytes` stops walking it. See
 * `docs/perf/2026-10-16-raster-tile-transport.md`.
 *
 * Run: `pnpm bench -- packages/editor/src/canvas/__benchmarks__/rasterIrCost.bench.ts`
 * (or via `vitest run --config vitest.bench.config.ts <this file>`).
 */

import type { RenderItem } from '@varve/engine';
import { bench, describe } from 'vitest';
import { SubtreeIrCache } from '../subtreeIrCache';

const TILE_PIXELS = 128 * 128 * 4;

type PayloadForm = 'array' | 'typed';

function makeTiles(tileCount: number, form: PayloadForm): Record<string, unknown> {
  const tiles: Record<string, unknown> = {};
  for (let i = 0; i < tileCount; i++) {
    const typed = new Uint8ClampedArray(TILE_PIXELS);
    for (let j = 0; j < typed.length; j++) typed[j] = (i * 31 + j * 7) % 256;
    tiles[`${i}:0`] = {
      pixels: form === 'array' ? Array.from(typed) : typed,
      version: 1,
    };
  }
  return tiles;
}

function rasterItem(tileCount: number, form: PayloadForm): RenderItem {
  return {
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    primitive: {
      kind: 'rasterLayer',
      width: 128 * tileCount,
      height: 128,
      pixelMode: false,
      tiles: makeTiles(tileCount, form),
    },
  } as unknown as RenderItem;
}

/**
 * The previous `estimateItemBytes` body, frozen for comparison. It counted long
 * `src` strings but walked every tile pixel through `JSON.stringify`, and
 * charged the result to a cache that (after the transport change) does not own
 * those bytes.
 */
function previousEstimate(item: RenderItem): number {
  let longStringChars = 0;
  const json = JSON.stringify(item, (_key, value) => {
    if (typeof value === 'string' && value.length > 256) {
      longStringChars += value.length;
      return '';
    }
    return value;
  });
  return (json.length + longStringChars) * 2 + 64;
}

for (const tileCount of [4, 16, 64, 200]) {
  const pixelsMiB = (tileCount * TILE_PIXELS) / 1024 / 1024;
  const arrayItem = rasterItem(tileCount, 'array');
  const typedItem = rasterItem(tileCount, 'typed');

  describe(`${tileCount} tiles (${pixelsMiB.toFixed(2)} MiB of pixels)`, () => {
    bench('convert: Array.from per tile (previous producer)', () => {
      const tiles = makeTiles(tileCount, 'typed');
      for (const tile of Object.values(tiles)) {
        const t = tile as { pixels: Uint8ClampedArray };
        Array.from(t.pixels);
      }
    });

    bench('convert: reference per tile (current producer)', () => {
      const tiles = makeTiles(tileCount, 'typed');
      for (const tile of Object.values(tiles)) {
        const t = tile as { pixels: Uint8ClampedArray };
        void t.pixels;
      }
    });

    bench('estimate A: number[] + previous formula', () => {
      previousEstimate(arrayItem);
    });

    bench('estimate B: typed[] + previous formula', () => {
      previousEstimate(typedItem);
    });

    bench('estimate C: typed[] + current formula', () => {
      SubtreeIrCache.estimateItemBytes(typedItem);
    });
  });
}
