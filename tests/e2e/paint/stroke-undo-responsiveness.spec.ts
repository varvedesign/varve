/**
 * Paint stroke -> undo: exact visible restoration, cache-vs-authoritative
 * equivalence, and measured undo-to-first-correct-frame latency.
 *
 * Why this spec exists. `docs/adr/0241` and
 * `docs/research/perf-cow-history-cache-ledger-2026-10-16.md` change how a
 * raster stroke is stored, hashed and transported. Unit tests pin the
 * mechanisms; nothing pinned the visible result. A committed paint stroke is
 * the one workflow where all of them meet: the tile draft publishes a new
 * node, the retained layer surface re-uploads only the changed tiles, the
 * per-node IR cache decides whether to rebuild, and the history session
 * captures and restores.
 *
 * Every assertion here is either a pixel claim or a deterministic work count,
 * never a wall-clock claim:
 *
 *  1. Undo restores the *exact* visible state. The canvas hash after undo must
 *     equal the hash recorded after the same stroke earlier in the run, so a
 *     partially restored surface (a stale tile that was never re-uploaded, a
 *     dirty region that missed the stroke bounds) fails.
 *  2. The incrementally maintained surface equals an authoritative full redraw
 *     at the same camera (`__varvePerf.forceFullRedraw`, the oracle the repo
 *     already requires for any pixel-reuse change). Equal hashes mean the
 *     cached composition is equivalent to correct fresh rendering.
 *  3. Steady and camera-only frames perform no scene->engine node conversion
 *     (`engineNodeComputes === 0`), which is the load-immune signal that the
 *     raster node is not being reconverted per frame.
 *
 * Timing is recorded and reported, not asserted against a budget: this repo's
 * dev machine carries a heavy concurrent load (AGENTS.md), so a wall-clock
 * ceiling here would be a flaky test rather than a measurement. The measured
 * latency is attached to the test report instead.
 *
 * Concurrency hygiene: serial, single worker (shared dev server).
 */
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe.configure({ mode: 'serial' });

interface FrameDiagnostics {
  frameIndex: number;
  docVersion: number;
  engineNodeComputes?: number;
  engineNodeHits?: number;
  cacheHitCount: number;
  partialRedraw: boolean;
  wasDirty: boolean;
  totalMs: number;
  hashMs?: number;
  committedAt?: number;
  redrawReason?: string;
  actualDrawingPath?: string;
}

/**
 * The `?perf=1` diagnostics handle. Declared locally and reached through a cast
 * rather than by augmenting the global `Window`: two existing specs declare a
 * narrower `window.__varvePerf` globally, and global interface declarations
 * merge, so a third incompatible shape is a type error for the whole e2e
 * project. The casts below match `raster-lod-parity.spec.ts` and
 * `webgl2-smoke.spec.ts`.
 */
interface PerfHandle {
  getFrames: (n: number) => FrameDiagnostics[];
  getLast: () => FrameDiagnostics | null;
  reset: () => void;
  forceFullRedraw: () => Promise<{ authoritative: boolean }>;
}

type PerfWindow = { __varvePerf?: PerfHandle; __strokeT0?: number };

const CANVAS = 'canvas.editor-canvas__content-layer';

/**
 * FNV-1a over a strided sample of the content canvas. Strided (every 97th
 * byte) so the sample spans the whole surface while staying cheap: a stride
 * that is coprime with the 4-byte pixel stride and not a multiple of common
 * row lengths, so a shifted tile cannot alias onto itself.
 */
async function canvasHash(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate((selector) => {
    const canvas = document.querySelector(selector) as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (let i = 0; i < pixels.length; i += 97) {
      hash ^= pixels[i] ?? 0;
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }, CANVAS);
}

async function lastFrame(page: import('@playwright/test').Page): Promise<FrameDiagnostics | null> {
  return page.evaluate(() => (window as unknown as PerfWindow).__varvePerf?.getLast() ?? null);
}

/** Wait until the frame ring stops advancing: two settled rAFs, no new frame. */
async function settle(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));
    await raf();
    await raf();
  });
  const first = await lastFrame(page);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(50);
    const next = await lastFrame(page);
    if (next && first && next.frameIndex === first.frameIndex) return;
    if (next && !first) return;
  }
}

/**
 * Paint one stroke and return once the frame ring is quiet.
 */
async function paintStroke(
  page: import('@playwright/test').Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await dragOnCanvas(page, from, to);
  await settle(page);
}

/**
 * Press undo (or redo) and measure key-press -> first frame whose visible
 * pixels already match the expected state.
 *
 * `performance.now()` is taken inside the page immediately before the key
 * event and compared against the matched frame's own `committedAt`, so both
 * ends of the measurement come from the renderer's clock and CDP transport
 * time is not counted as render latency.
 */
async function undoAndMeasure(
  page: import('@playwright/test').Page,
  expectedHash: number,
  keys: string,
): Promise<{ latencyMs: number | null; frame: FrameDiagnostics | null }> {
  await page.evaluate(() => {
    (window as unknown as PerfWindow).__strokeT0 = performance.now();
  });
  await page.keyboard.press(keys);

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const hash = await canvasHash(page);
    if (hash === expectedHash) {
      const measured = await page.evaluate(() => {
        const w = window as unknown as PerfWindow;
        const t0 = w.__strokeT0 ?? 0;
        const frame = w.__varvePerf?.getLast() ?? null;
        return { latencyMs: frame?.committedAt ? frame.committedAt - t0 : null, frame };
      });
      return measured;
    }
    await page.waitForTimeout(50);
  }
  return { latencyMs: null, frame: await lastFrame(page) };
}

/**
 * The repo-mandated pixel-reuse oracle: hash, force an authoritative
 * main-thread redraw at the same camera, hash again. Equal hashes mean the
 * screen matches what a full redraw would have produced.
 */
async function expectOracleEquality(page: import('@playwright/test').Page, label: string) {
  const before = await canvasHash(page);
  const result = await page.evaluate(async () => {
    const perf = (window as unknown as PerfWindow).__varvePerf;
    if (!perf?.forceFullRedraw) throw new Error('authoritative redraw oracle unavailable');
    return perf.forceFullRedraw();
  });
  await settle(page);
  const after = await canvasHash(page);
  expect(result.authoritative, `${label}: oracle must report an authoritative frame`).toBe(true);
  expect(after, `${label}: incremental frame must equal an authoritative full redraw`).toBe(before);
}

test.describe('paint stroke undo — visible restoration and cache equivalence', () => {
  test('undo/redo restores exact pixels and the retained surface matches a full redraw', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page, '/?perf=1');
    await expect
      .poll(
        async () => page.evaluate(() => Boolean((window as unknown as PerfWindow).__varvePerf)),
        {
          timeout: 20_000,
        },
      )
      .toBe(true);
    await page.evaluate(() => (window as unknown as PerfWindow).__varvePerf?.reset());

    await page.locator(CANVAS).waitFor({ timeout: 20_000 });
    const emptyHash = await canvasHash(page);

    // Stroke 1.
    await page.keyboard.press('b');
    await paintStroke(page, { x: 320, y: 260 }, { x: 520, y: 400 });
    const afterFirst = await canvasHash(page);
    expect(afterFirst, 'a paint stroke must change visible pixels').not.toBe(emptyHash);
    await expectOracleEquality(page, 'after stroke 1');

    // Stroke 2.
    await paintStroke(page, { x: 380, y: 470 }, { x: 330, y: 300 });
    const afterSecond = await canvasHash(page);
    expect(afterSecond, 'the second stroke must change pixels again').not.toBe(afterFirst);
    await expectOracleEquality(page, 'after stroke 2');

    // Undo 1 -> the exact state after stroke 1, not merely "different".
    const undo1 = await undoAndMeasure(page, afterFirst, 'Control+z');
    expect(undo1.frame, 'undo must produce a frame').not.toBeNull();
    await expectOracleEquality(page, 'after undo 1');

    // Undo 2 -> the untouched canvas.
    const undo2 = await undoAndMeasure(page, emptyHash, 'Control+z');
    expect(undo2.frame, 'the second undo must produce a frame').not.toBeNull();
    await expectOracleEquality(page, 'after undo 2');

    // Redo restores stroke 1 exactly.
    const redo = await undoAndMeasure(page, afterFirst, 'Control+Shift+z');
    expect(redo.frame, 'redo must produce a frame').not.toBeNull();
    await expectOracleEquality(page, 'after redo');

    await page.screenshot({ path: testInfo.outputPath('after-redo.png') });

    const latencies = [undo1.latencyMs, undo2.latencyMs, redo.latencyMs].filter(
      (v): v is number => typeof v === 'number',
    );
    // Report, do not budget: the dev machine runs under heavy concurrent load,
    // so a wall-clock ceiling here would measure the machine, not the editor.
    await testInfo.attach('undo-latency.json', {
      body: JSON.stringify(
        {
          note: 'key-press to first frame whose pixels match the target state',
          measured: latencies,
          frames: [undo1.frame, undo2.frame, redo.frame],
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    expect(latencies.length, 'every undo/redo produced a measured frame').toBe(3);
    // Sanity ceiling only: catches a hang or a lost frame, not a perf claim.
    for (const ms of latencies) expect(ms, 'undo must not hang').toBeLessThan(5_000);
  });

  test('a same-state authoritative redraw converts no scene node again', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page, '/?perf=1');
    await expect
      .poll(
        async () => page.evaluate(() => Boolean((window as unknown as PerfWindow).__varvePerf)),
        {
          timeout: 20_000,
        },
      )
      .toBe(true);

    await page.locator(CANVAS).waitFor({ timeout: 20_000 });
    await page.keyboard.press('b');
    await paintStroke(page, { x: 300, y: 250 }, { x: 560, y: 420 });

    // Nothing about the document changes for this redraw: it invalidates the
    // retained pixel surface, not the IR or the engine-node memo. So every node
    // must be served from cache — zero scene->engine conversions. This is the
    // load-immune work-count signal (a count, not a duration), and it is the
    // assertion `FrameDiagnostics` documents for a steady frame.
    await page.evaluate(() => (window as unknown as PerfWindow).__varvePerf?.reset());
    const result = await page.evaluate(async () => {
      const perf = (window as unknown as PerfWindow).__varvePerf;
      if (!perf?.forceFullRedraw) throw new Error('authoritative redraw oracle unavailable');
      return perf.forceFullRedraw();
    });
    await settle(page);
    expect(result.authoritative).toBe(true);

    const frames = await page.evaluate(
      () => (window as unknown as PerfWindow).__varvePerf?.getFrames(10) ?? [],
    );
    const contentFrames = frames.filter((f) => f.wasDirty !== false || f.cacheHitCount > 0);
    const considered = contentFrames.length > 0 ? contentFrames : frames;
    expect(considered.length, 'the authoritative redraw must record a frame').toBeGreaterThan(0);

    const totalComputes = considered.reduce((sum, f) => sum + (f.engineNodeComputes ?? 0), 0);
    const totalHits = considered.reduce((sum, f) => sum + (f.engineNodeHits ?? 0), 0);
    expect(
      totalComputes,
      'a redraw with no document change must not reconvert scene nodes to engine nodes',
    ).toBe(0);
    expect(totalHits, 'the engine-node memo must serve the redraw').toBeGreaterThan(0);
  });
});
