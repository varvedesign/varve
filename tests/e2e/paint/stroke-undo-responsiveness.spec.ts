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
 *  3. A same-state authoritative redraw — no document change at all — performs
 *     no scene->engine node conversion while the memo serves the frame
 *     (`engineNodeComputes === 0`), which is the load-immune signal that the
 *     raster node is not being reconverted per redraw. Deliberately *not*
 *     claimed for camera-only frames: a zoom can reveal nodes that were culled
 *     and therefore never memoized, so `0` is not a valid expectation there.
 *
 * Timing is recorded and reported, not asserted against a budget: this repo's
 * dev machine carries a heavy concurrent load (AGENTS.md), so a wall-clock
 * ceiling here would be a flaky test rather than a measurement. The measured
 * latency and the renderer that actually painted are attached to the test
 * report instead — the first run of this spec executed the main-thread fallback
 * because the render worker retired with `worker-startup-timeout`, and the
 * recorded path is what stops that run being cited as worker coverage.
 *
 * Concurrency hygiene: serial, single worker (shared dev server).
 */
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

// Deliberately not `mode: 'serial'`: the two tests are independent measurements
// (pixel-equivalence oracle; work-count reuse) and a pixel failure must not hide
// the work-count result. `--workers=1` already serializes execution against the
// shared dev server, which is the reason serial mode is used elsewhere.

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
  renderPath?: string;
  camera?: { zoom: number; panX: number; panY: number; rotation: number };
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

/**
 * Wait until the surface is genuinely settled before comparing pixels.
 *
 * This is the precondition the repo's oracle already requires
 * (`adaptive-preview-scale.spec.ts`, `waitForSettledCamera`). Two conditions,
 * both necessary:
 *
 *  1. The observed state — `[docVersion, camera, canvas.width, canvas.height]`
 *     — has not changed for 500 ms. A single quiet `frameIndex` is not enough:
 *     the adaptive profile deliberately renders interaction frames at a reduced
 *     preview scale and re-renders at full fidelity after the 180 ms preview
 *     quiet delay, so a frame can be "last" while still being a preview.
 *  2. The backing store is at full resolution
 *     (`canvas.width === clientWidth * devicePixelRatio`), i.e. condition 1's
 *     refinement has actually happened.
 *
 * Comparing an unrefined preview against an authoritative full redraw would
 * report a difference that is not a defect, and the reverse mistake — accepting
 * a preview as settled — is how "already painted" pixels get declared correct.
 */
async function waitForSettledFrame(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    delete (window as unknown as { __varvePreviewSettling?: unknown }).__varvePreviewSettling;
  });
  await page.waitForFunction(
    () => {
      const target = window as unknown as {
        __varvePerf?: { getLast?: () => FrameDiagnostics | null };
        __varvePreviewSettling?: { state: string; since: number };
      };
      const frame = target.__varvePerf?.getLast?.();
      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas.editor-canvas__content-layer',
      );
      if (!frame || !canvas) return false;
      const state = JSON.stringify([frame.docVersion, frame.camera, canvas.width, canvas.height]);
      const now = performance.now();
      if (target.__varvePreviewSettling?.state !== state) {
        target.__varvePreviewSettling = { state, since: now };
        return false;
      }
      return (
        now - target.__varvePreviewSettling.since >= 500 &&
        canvas.width === Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio)) &&
        canvas.height === Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio))
      );
    },
    undefined,
    // Generous: a paint stroke under a loaded machine can take a while to
    // finish refining, and timing out here is a clearer failure than comparing
    // an unsettled surface.
    { polling: 50, timeout: 30_000 },
  );
}

/** Backing-store geometry, for the recorded evidence. */
async function canvasGeometry(page: import('@playwright/test').Page) {
  return page.evaluate((selector) => {
    const canvas = document.querySelector(selector) as HTMLCanvasElement;
    return {
      backingWidth: canvas.width,
      backingHeight: canvas.height,
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
      dpr: devicePixelRatio,
    };
  }, CANVAS);
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
  await waitForSettledFrame(page);
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
 * Distinct render paths actually executed in the recent frame ring.
 *
 * Requested settings are not evidence: this run's console reported
 * `Render worker stopped permanently; using main-thread Canvas 2D
 * (worker-startup-timeout)`, so the pixel-equivalence oracle below validated the
 * main-thread fallback rather than the worker. Recording the observed paths
 * means the next run states which path it covered instead of implying the one
 * that was configured.
 */
async function observedRenderPaths(
  page: import('@playwright/test').Page,
): Promise<{ actual: string[]; coarse: string[] }> {
  return page.evaluate(() => {
    const frames = (window as unknown as PerfWindow).__varvePerf?.getFrames(30) ?? [];
    const actual = new Set<string>();
    const coarse = new Set<string>();
    for (const frame of frames) {
      if (frame.actualDrawingPath) actual.add(frame.actualDrawingPath);
      if (frame.renderPath) coarse.add(frame.renderPath);
    }
    return { actual: [...actual].sort(), coarse: [...coarse].sort() };
  });
}

/**
 * The repo-mandated pixel-reuse oracle: hash, force an authoritative
 * main-thread redraw at the same camera, hash again. Equal hashes mean the
 * incrementally maintained surface matches what a full redraw would produce.
 */
async function expectOracleEquality(page: import('@playwright/test').Page, label: string) {
  const before = await canvasHash(page);
  const result = await page.evaluate(async () => {
    const perf = (window as unknown as PerfWindow).__varvePerf;
    if (!perf?.forceFullRedraw) throw new Error('authoritative redraw oracle unavailable');
    return perf.forceFullRedraw();
  });
  await waitForSettledFrame(page);
  const after = await canvasHash(page);
  // `authoritative` is `true` by construction in the result type, so this only
  // proves the promise resolved rather than throwing or timing out — the
  // runtime acceptance condition in perfRuntime (frameSource ===
  // 'oracle-full-redraw', a non-partial content frame, matching document and
  // camera) is what makes the redraw authoritative, and it is not visible from
  // here. The hash equality below is the actual assertion.
  expect(result.authoritative, `${label}: the oracle must resolve`).toBe(true);
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
    // The executed path and settled backing resolution are recorded so a
    // "fast" number can never be attributed to a preview-scale frame.
    const geometry = await canvasGeometry(page);
    const paths = await observedRenderPaths(page);
    const summary = {
      note: 'key-press to first frame whose pixels match the target state',
      measured: latencies,
      settledGeometry: geometry,
      // Which renderer actually painted, so this run cannot be cited as worker
      // coverage if the worker retired and the main thread took over.
      renderPaths: paths,
      frames: [undo1.frame, undo2.frame, redo.frame],
    };
    expect(paths.actual.length, 'the run must report which renderer painted').toBeGreaterThan(0);
    // Also on stdout: the `list` reporter does not write attachments to disk, so
    // without this the measured numbers exist only inside a report UI.
    console.log(`[stroke-undo] ${JSON.stringify(summary)}`);
    await testInfo.attach('undo-latency.json', {
      body: JSON.stringify(summary, null, 2),
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
    await waitForSettledFrame(page);
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
