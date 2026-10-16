/**
 * Raster-layer history capture and per-dab tile allocation baseline.
 *
 * The vector benches in `history.bench.ts` never include a raster layer, so the
 * cost of committing a paint stroke against a large layer was unmeasured. This
 * reports, per layer size: the whole-document canonical hash, the semantic
 * diff (which hashes both documents), raster delta capture, and the number of
 * tile buffers one 16-dab stroke batch allocates versus the number of distinct
 * tiles it touched.
 *
 * Reports measurements; it does not enforce budgets.
 *
 * Run: pnpm exec vitest run --config vitest.bench.config.ts \
 *        packages/history/src/__benchmarks__/rasterCapture.bench.ts
 * Sizes: VARVE_BENCH_RASTER_SIZES="2x2,4x4,8x8" (columns x rows of 128px tiles).
 * Rows are also appended as JSON lines to $VARVE_BENCH_OUT when it is set.
 */

import { appendFileSync } from 'node:fs';
import type { BrushDab, Document, RasterLayerNode, RasterTile } from '@varve/scene';
import {
  addNode,
  beginRasterTileDraft,
  canonicalHistoryHash,
  compositeDabOnNode,
  createDocument,
  makeRasterLayerNode,
  TILE_SIZE,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { diffDocuments } from '../diff';
import { captureRasterTileDeltas } from '../rasterDelta';

const SIZES = (process.env.VARVE_BENCH_RASTER_SIZES ?? '2x2,4x4,8x8')
  .split(',')
  .map((s) => s.split('x').map(Number) as [number, number]);

const COLOR: [number, number, number, number] = [200, 40, 40, 255];
const LAYER_ID = 'rl_bench';

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/** Deterministic, incompressible-looking pixels so JSON size is realistic. */
function noiseTile(seed: number): RasterTile {
  const pixels = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
  let s = Math.imul(seed + 1, 2654435761) >>> 0;
  for (let i = 0; i < pixels.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    pixels[i] = s >>> 24;
  }
  return { pixels, version: 1 };
}

function buildDocument(cols: number, rows: number): { doc: Document; layer: RasterLayerNode } {
  const tiles = new Map<string, RasterTile>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) tiles.set(`${c}:${r}`, noiseTile(r * cols + c));
  }
  const layer: RasterLayerNode = {
    ...makeRasterLayerNode(LAYER_ID, { width: cols * TILE_SIZE, height: rows * TILE_SIZE }),
    tiles,
  };
  return { doc: addNode(createDocument('raster-bench', { flat: true }), layer), layer };
}

function dabAt(x: number, y: number): BrushDab {
  return {
    x,
    y,
    radius: 24,
    opacity: 1,
    flow: 1,
    hardness: 0.8,
    angle: 0,
    roundness: 1,
    strokeT: 0,
    strokeDistance: 0,
  };
}

/** Count Uint8ClampedArray constructions made while `fn` runs. */
function countAllocations<T>(fn: () => T): { out: T; count: number; bytes: number } {
  const Original = globalThis.Uint8ClampedArray;
  let count = 0;
  let bytes = 0;
  class Counting extends Original {
    constructor(...args: ConstructorParameters<typeof Original>) {
      super(...args);
      count++;
      bytes += this.byteLength;
    }
  }
  (globalThis as { Uint8ClampedArray: unknown }).Uint8ClampedArray = Counting;
  try {
    const out = fn();
    return { out, count, bytes };
  } finally {
    (globalThis as { Uint8ClampedArray: unknown }).Uint8ClampedArray = Original;
  }
}

function time<T>(fn: () => T, runs: number): { out: T; medianMs: number } {
  const samples: number[] = [];
  let out!: T;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    out = fn();
    samples.push(performance.now() - t0);
  }
  return { out, medianMs: median(samples) };
}

/** Median of `fn(input)` where `setup` builds a fresh, untimed input for every run. */
function timeFresh<I, T>(setup: () => I, fn: (input: I) => T, runs: number): number {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const input = setup();
    const t0 = performance.now();
    fn(input);
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

/** The same document with every tile buffer copied, so no digest is memoized. */
function withColdTiles(doc: Document): Document {
  const node = doc.nodes[LAYER_ID] as RasterLayerNode;
  const tiles = new Map<string, RasterTile>();
  for (const [key, tile] of node.tiles) {
    tiles.set(key, { pixels: new Uint8ClampedArray(tile.pixels), version: tile.version });
  }
  return { ...doc, nodes: { ...doc.nodes, [LAYER_ID]: { ...node, tiles } } };
}

async function timeAsync<T>(
  fn: () => Promise<T>,
  runs: number,
): Promise<{ out: T; medianMs: number }> {
  const samples: number[] = [];
  let out!: T;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    out = await fn();
    samples.push(performance.now() - t0);
  }
  return { out, medianMs: median(samples) };
}

describe('raster history capture baseline', () => {
  for (const [cols, rows] of SIZES) {
    it(`${cols}x${rows} tiles`, { timeout: 280_000 }, async () => {
      const { doc, layer } = buildDocument(cols, rows);
      const tileCount = cols * rows;

      const hashV1 = time(() => canonicalHistoryHash(doc, 1), 3);
      // Scheme 2 on buffers it has never seen (attach, reload, first hash).
      const hashV2Cold = timeFresh(
        () => withColdTiles(doc),
        (cold) => canonicalHistoryHash(cold, 2),
        3,
      );
      canonicalHistoryHash(doc, 2); // warm the memo for the stroke scenarios below

      // One stroke batch: 16 sequential dabs straddling a four-tile corner.
      const origin = TILE_SIZE - 20;
      const dabs = Array.from({ length: 16 }, (_, i) => dabAt(origin + i * 3, origin + i * 2));
      const batch = countAllocations(() => {
        let node = layer;
        for (const dab of dabs) node = compositeDabOnNode(node, dab, COLOR, {});
        return node;
      });
      const batchMs = time(() => {
        let node = layer;
        for (const dab of dabs) node = compositeDabOnNode(node, dab, COLOR, {});
        return node;
      }, 5).medianMs;

      // The same batch through one exclusive-ownership draft.
      const runDraft = () => {
        const draft = beginRasterTileDraft(layer);
        for (const dab of dabs) draft.compositeDab(dab, COLOR, {});
        return draft.commit();
      };
      const draftAlloc = countAllocations(runDraft);
      const draftMs = time(runDraft, 5).medianMs;

      // Sustained stroke: 1000 dabs delivered 8 per pointer event, the two
      // strategies alternated so machine drift hits both equally.
      const longStroke = Array.from({ length: 1000 }, (_, i) =>
        dabAt(
          10 + ((i * 2.7) % (cols * TILE_SIZE - 20)),
          10 + ((i * 1.3) % (rows * TILE_SIZE - 20)),
        ),
      );
      const perDabSustained: number[] = [];
      const draftSustained: number[] = [];
      for (let round = 0; round < 5; round++) {
        const order = round % 2 === 0 ? ['perdab', 'draft'] : ['draft', 'perdab'];
        for (const which of order) {
          let node = layer;
          const t0 = performance.now();
          for (let at = 0; at < longStroke.length; at += 8) {
            const eventDabs = longStroke.slice(at, at + 8);
            if (which === 'perdab') {
              for (const dab of eventDabs) node = compositeDabOnNode(node, dab, COLOR, {});
            } else {
              const draft = beginRasterTileDraft(node);
              for (const dab of eventDabs) draft.compositeDab(dab, COLOR, {});
              node = draft.commit();
            }
          }
          (which === 'perdab' ? perDabSustained : draftSustained).push(performance.now() - t0);
        }
      }

      const afterLayer = batch.out;
      const afterDoc: Document = { ...doc, nodes: { ...doc.nodes, [LAYER_ID]: afterLayer } };
      let distinctTilesTouched = 0;
      for (const [key, tile] of afterLayer.tiles) {
        if (tile !== layer.tiles.get(key)) distinctTilesTouched++;
      }

      // The document hashing a committed stroke pays: base known (scheme 1
      // recomputes it), then the target. Scheme 2 re-hashes only the new tiles,
      // so each sample gets a freshly drawn stroke rather than a memoized one.
      const diffV1 = time(
        () => diffDocuments(doc, afterDoc, { epsilonPolicy: 'exact', hashScheme: 1 }),
        3,
      );
      const freshStroke = (): Document => {
        let node = layer;
        for (const dab of dabs) node = compositeDabOnNode(node, dab, COLOR, {});
        return { ...doc, nodes: { ...doc.nodes, [LAYER_ID]: node } };
      };
      const diffV2Ms = timeFresh(
        freshStroke,
        (next) => diffDocuments(doc, next, { epsilonPolicy: 'exact', hashScheme: 2 }),
        5,
      );
      const diff = time(() => diffDocuments(doc, afterDoc, { epsilonPolicy: 'exact' }), 3);
      const capture = await timeAsync(
        () =>
          captureRasterTileDeltas(doc, afterDoc, 'tx_bench', {
            beforeHash: diff.out.baseHash,
            afterHash: diff.out.targetHash,
          }),
        3,
      );

      // A non-raster edit with the raster layer untouched (same node object).
      const renamed: Document = { ...doc, name: 'renamed' };
      const idle = await timeAsync(
        () =>
          captureRasterTileDeltas(doc, renamed, 'tx_idle', {
            beforeHash: 'a'.repeat(64),
            afterHash: 'b'.repeat(64),
          }),
        3,
      );

      const row = {
        tiles: tileCount,
        rasterMiB: (tileCount * TILE_SIZE * TILE_SIZE * 4) / 1048576,
        hashV1Ms: +hashV1.medianMs.toFixed(1),
        hashV2ColdMs: +hashV2Cold.toFixed(1),
        batch16DabsMs: +batchMs.toFixed(2),
        batchTileBuffersAllocated: batch.count,
        batchAllocatedMiB: +(batch.bytes / 1048576).toFixed(2),
        draft16DabsMs: +draftMs.toFixed(2),
        sustained1000PerDabMs: +median(perDabSustained).toFixed(1),
        sustained1000DraftMs: +median(draftSustained).toFixed(1),
        draftTileBuffersAllocated: draftAlloc.count,
        draftAllocatedMiB: +(draftAlloc.bytes / 1048576).toFixed(2),
        distinctTilesTouched,
        strokeDiffV1Ms: +diffV1.medianMs.toFixed(1),
        strokeDiffV2Ms: +diffV2Ms.toFixed(1),
        diffExactMs: +diff.medianMs.toFixed(1),
        captureDeltasMs: +capture.medianMs.toFixed(1),
        captureEntries: capture.out.entries.length,
        idleRasterCaptureMs: +idle.medianMs.toFixed(2),
      };
      console.log(`RASTER_CAPTURE_BASELINE ${JSON.stringify(row)}`);
      // Vitest can swallow console output depending on the reporter; a file keeps
      // the measurement retrievable.
      if (process.env.VARVE_BENCH_OUT) {
        appendFileSync(process.env.VARVE_BENCH_OUT, `${JSON.stringify(row)}\n`);
      }

      // Sanity only: the fixture really exercised the raster path.
      expect(distinctTilesTouched).toBeGreaterThan(0);
      // Exclusive ownership: one buffer per distinct tile touched, no more.
      expect(draftAlloc.count).toBe(distinctTilesTouched);
      expect(capture.out.payload).not.toBeNull();
    });
  }
});
