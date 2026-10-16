/**
 * End-to-end cost of committing paint strokes through the real
 * `EditorHistorySession` against raster layers of increasing size.
 *
 * Reports, per layer size: attach (first hash, genesis snapshot), the median
 * and worst stroke capture, bytes SHA-256 consumed per capture, and the exact
 * undo and redo restore time. Measures; does not enforce budgets (CI machines
 * vary), but the bytes-hashed figure is deterministic and is asserted to stay a
 * small fraction of the layer.
 *
 * Run: pnpm exec vitest run --config vitest.bench.config.ts \
 *        packages/editor/src/history/__benchmarks__/sessionRasterCapture.bench.ts
 * Sizes: VARVE_BENCH_SESSION_SIZES="8x8,16x16,47x32" (columns x rows of 128px
 * tiles; 47x32 is about a 24 megapixel layer). Rows are also appended as JSON
 * lines to $VARVE_BENCH_OUT when it is set.
 */
import { appendFileSync } from 'node:fs';
import { createMemoryHistoryStore, MemoryRasterTileStore } from '@varve/history';
import type { BrushDab, Document, RasterLayerNode, RasterTile } from '@varve/scene';
import {
  addNode,
  beginRasterTileDraft,
  canonicalHistoryHash,
  createDocument,
  makeRasterLayerNode,
  registerBuiltinOperations,
  Sha256Stream,
  TILE_SIZE,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { EditorHistorySession } from '../editorHistorySession';

registerBuiltinOperations();

const SIZES = (process.env.VARVE_BENCH_SESSION_SIZES ?? '8x8,16x16')
  .split(',')
  .map((s) => s.split('x').map(Number) as [number, number]);

const DOC_ID = 'session-raster-bench';
const LAYER_ID = 'rl_session_bench';
const STROKES = 5;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

function noiseTile(seed: number): RasterTile {
  const pixels = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
  let s = Math.imul(seed + 1, 2654435761) >>> 0;
  for (let i = 0; i < pixels.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    pixels[i] = s >>> 24;
  }
  return { pixels, version: 1 };
}

function buildDocument(cols: number, rows: number): Document {
  const tiles = new Map<string, RasterTile>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) tiles.set(`${c}:${r}`, noiseTile(r * cols + c));
  }
  const layer: RasterLayerNode = {
    ...makeRasterLayerNode(LAYER_ID, { width: cols * TILE_SIZE, height: rows * TILE_SIZE }),
    tiles,
  };
  return addNode({ ...createDocument(DOC_ID, { flat: true }), id: DOC_ID } as Document, layer);
}

function dab(x: number, y: number): BrushDab {
  return {
    x,
    y,
    radius: 20,
    opacity: 1,
    flow: 1,
    hardness: 0.7,
    angle: 0,
    roundness: 1,
    strokeT: 0,
    strokeDistance: 0,
  };
}

/** One stroke batch: 8 dabs in a short line, touching one or two tiles. */
function stroke(doc: Document, x: number, y: number): Document {
  const draft = beginRasterTileDraft(doc.nodes[LAYER_ID] as RasterLayerNode);
  for (let i = 0; i < 8; i++) draft.compositeDab(dab(x + i * 3, y + i), [200, 40, 40, 255]);
  return { ...doc, nodes: { ...doc.nodes, [LAYER_ID]: draft.commit() } };
}

describe('session raster capture', () => {
  for (const [cols, rows] of SIZES) {
    it(`${cols}x${rows} tiles`, { timeout: 280_000 }, async () => {
      const layerBytes = cols * rows * TILE_SIZE * TILE_SIZE * 4;
      let doc = buildDocument(cols, rows);
      const original = doc;
      const session = new EditorHistorySession({
        store: createMemoryHistoryStore(),
        documentId: DOC_ID,
        authorActorId: 'bench',
        rasterTileStore: new MemoryRasterTileStore(),
      });

      const attachStart = performance.now();
      await session.attach(doc);
      const attachMs = performance.now() - attachStart;

      const sha256Update = Sha256Stream.prototype.update;
      let hashed = 0;
      Sha256Stream.prototype.update = function (
        this: Sha256Stream,
        data: Uint8Array,
        start = 0,
        end = data.length,
      ) {
        hashed += end - start;
        return sha256Update.call(this, data, start, end);
      };

      const captureMs: number[] = [];
      const hashedBytes: number[] = [];
      try {
        for (let i = 0; i < STROKES; i++) {
          const next = stroke(doc, 40 + i * 25, 40 + i * 10);
          hashed = 0;
          const t0 = performance.now();
          const revision = await session.capture(doc, next, [], {
            label: 'Paint',
            kind: 'modify',
          });
          captureMs.push(performance.now() - t0);
          hashedBytes.push(hashed);
          expect(revision).not.toBeNull();
          doc = next;
        }
      } finally {
        Sha256Stream.prototype.update = sha256Update;
      }

      const undoStart = performance.now();
      const undone = await session.undo();
      const undoMs = performance.now() - undoStart;
      const redoStart = performance.now();
      const redone = await session.redo();
      const redoMs = performance.now() - redoStart;
      expect(undone).not.toBeNull();
      expect(redone).not.toBeNull();

      // `applyLoadedRevision` decides "dirty" after every undo/redo by hashing the
      // saved document and the restored one: two whole-document hashes.
      const dirtyStart = performance.now();
      canonicalHistoryHash(original);
      canonicalHistoryHash(undone!.document);
      const dirtyCheckMs = performance.now() - dirtyStart;

      // The same decision under hash scheme 1, which re-spells every pixel.
      const dirtyV1Start = performance.now();
      canonicalHistoryHash(original, 1);
      canonicalHistoryHash(undone!.document, 1);
      const dirtyCheckV1Ms = performance.now() - dirtyV1Start;

      const row = {
        tiles: cols * rows,
        rasterMiB: +(layerBytes / 1048576).toFixed(1),
        attachMs: +attachMs.toFixed(0),
        captureMedianMs: +median(captureMs).toFixed(1),
        captureWorstMs: +Math.max(...captureMs).toFixed(1),
        hashedKiBPerCapture: +(median(hashedBytes) / 1024).toFixed(0),
        hashedFractionOfLayer: +(median(hashedBytes) / layerBytes).toFixed(4),
        undoMs: +undoMs.toFixed(1),
        redoMs: +redoMs.toFixed(1),
        dirtyCheckHashMs: +dirtyCheckMs.toFixed(1),
        dirtyCheckHashV1Ms: +dirtyCheckV1Ms.toFixed(0),
      };
      console.log(`SESSION_RASTER_CAPTURE ${JSON.stringify(row)}`);
      if (process.env.VARVE_BENCH_OUT) {
        appendFileSync(process.env.VARVE_BENCH_OUT, `${JSON.stringify(row)}\n`);
      }

      // Deterministic: a stroke on a large layer hashes only what it touched.
      if (cols * rows >= 64) expect(median(hashedBytes)).toBeLessThan(layerBytes / 6);
    });
  }
});
