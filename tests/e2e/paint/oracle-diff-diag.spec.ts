/**
 * Diagnostic: what exactly differs between the incremental surface and an
 * authoritative full redraw?
 *
 * Opt-in, because it asserts nothing and exists to explain a *failure* of
 * `stroke-undo-responsiveness.spec.ts`. Run it when the oracle disagrees:
 *
 *   VARVE_ORACLE_DIAG=1 npx playwright test tests/e2e/paint/oracle-diff-diag.spec.ts \
 *     --project=chromium --workers=1 --reporter=list
 *
 * It writes, per step, the two PNGs and a JSON summary into the test output
 * directory, so the difference can be *looked at* instead of inferred from a
 * hash:
 *
 *  - `diffPixels`, `maxChannelDelta`, `diffBounds`: a whole-viewport difference
 *    is a wrong/stale frame; a thin band along a rectangle edge is the
 *    documented "Canvas2D antialiases differently through a partial clip" case.
 *  - the frame diagnostics for both states (renderPath, partialRedraw,
 *    dirtyRects, redrawReason, cache counters, engineNodeComputes), so a
 *    difference can be attributed to a specific decision rather than guessed.
 *  - the profile render scale, so a preview-scale frame can be ruled out.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

const CANVAS = 'canvas.editor-canvas__content-layer';
const enabled = Boolean(process.env.VARVE_ORACLE_DIAG);

interface DiagFrame {
  frameIndex: number;
  docVersion: number;
  renderPath?: string;
  actualDrawingPath?: string;
  partialRedraw?: boolean;
  wasDirty?: boolean;
  redrawReason?: string;
  invalidationReasons?: string[];
  dirtyRects?: number;
  dirtyRectsAfter?: number;
  dirtyAreaRatio?: number;
  cacheHitCount?: number;
  engineNodeComputes?: number;
  engineNodeHits?: number;
  totalMs?: number;
  hashMs?: number;
}

type DiagWindow = {
  __varvePerf?: {
    getLast?: () => DiagFrame | null;
    getFrames?: (n: number) => DiagFrame[];
    forceFullRedraw?: () => Promise<{ authoritative: boolean; frameIndex: number }>;
    profile?: { renderScale?: () => number; tier?: () => string };
  };
  __diagBefore?: Uint8ClampedArray;
  __diagW?: number;
  __diagH?: number;
};

async function settle(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const target = window as unknown as {
        __varvePerf?: { getLast?: () => DiagFrame | null };
        __varvePreviewSettling?: { state: string; since: number };
      };
      const frame = target.__varvePerf?.getLast?.();
      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas.editor-canvas__content-layer',
      );
      if (!frame || !canvas) return false;
      const state = JSON.stringify([frame.docVersion, canvas.width, canvas.height]);
      const now = performance.now();
      if (target.__varvePreviewSettling?.state !== state) {
        target.__varvePreviewSettling = { state, since: now };
        return false;
      }
      return (
        now - target.__varvePreviewSettling.since >= 500 &&
        canvas.width === Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio))
      );
    },
    undefined,
    { polling: 50, timeout: 30_000 },
  );
}

/** Snapshot the surface and remember it for the post-redraw comparison. */
async function capture(page: import('@playwright/test').Page) {
  return page.evaluate((selector) => {
    const target = window as unknown as DiagWindow;
    const canvas = document.querySelector(selector) as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    target.__diagBefore = new Uint8ClampedArray(image.data);
    target.__diagW = canvas.width;
    target.__diagH = canvas.height;
    return {
      dataUrl: canvas.toDataURL('image/png'),
      geometry: { w: canvas.width, h: canvas.height },
      frame: target.__varvePerf?.getLast?.() ?? null,
      renderScale: target.__varvePerf?.profile?.renderScale?.() ?? null,
      tier: target.__varvePerf?.profile?.tier?.() ?? null,
    };
  }, CANVAS);
}

/** Compare the current surface against the remembered pre-redraw snapshot. */
async function diffAgainstBefore(page: import('@playwright/test').Page) {
  return page.evaluate((selector) => {
    const target = window as unknown as DiagWindow;
    const before = target.__diagBefore;
    const canvas = document.querySelector(selector) as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');
    if (!before) throw new Error('no pre-redraw snapshot');
    const after = context.getImageData(0, 0, canvas.width, canvas.height).data;
    if (after.length !== before.length) {
      return { sizeChanged: true, before: before.length, after: after.length };
    }
    let diffPixels = 0;
    let maxChannelDelta = 0;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = -1;
    let maxY = -1;
    let firstDiff: { index: number; before: number[]; after: number[] } | null = null;
    const w = canvas.width;
    for (let i = 0; i < after.length; i += 4) {
      const d = Math.max(
        Math.abs((after[i] ?? 0) - (before[i] ?? 0)),
        Math.abs((after[i + 1] ?? 0) - (before[i + 1] ?? 0)),
        Math.abs((after[i + 2] ?? 0) - (before[i + 2] ?? 0)),
        Math.abs((after[i + 3] ?? 0) - (before[i + 3] ?? 0)),
      );
      if (d === 0) continue;
      diffPixels++;
      if (d > maxChannelDelta) maxChannelDelta = d;
      const px = (i / 4) % w;
      const py = Math.floor(i / 4 / w);
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
      if (!firstDiff) {
        firstDiff = {
          index: i / 4,
          before: [before[i] ?? 0, before[i + 1] ?? 0, before[i + 2] ?? 0, before[i + 3] ?? 0],
          after: [after[i] ?? 0, after[i + 1] ?? 0, after[i + 2] ?? 0, after[i + 3] ?? 0],
        };
      }
    }
    return {
      sizeChanged: false,
      totalPixels: after.length / 4,
      diffPixels,
      maxChannelDelta,
      firstDiff,
      diffBounds: maxX >= 0 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
      afterDataUrl: canvas.toDataURL('image/png'),
      frame: target.__varvePerf?.getLast?.() ?? null,
      recentFrames: target.__varvePerf?.getFrames?.(8) ?? [],
    };
  }, CANVAS);
}

test.describe('oracle diff diagnostic (opt-in)', () => {
  test.skip(!enabled, 'set VARVE_ORACLE_DIAG=1 to run');
  test('captures the incremental-vs-authoritative difference after a stroke', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page, '/?perf=1');
    await expect
      .poll(
        async () => page.evaluate(() => Boolean((window as unknown as DiagWindow).__varvePerf)),
        {
          timeout: 20_000,
        },
      )
      .toBe(true);
    await page.locator(CANVAS).waitFor({ timeout: 20_000 });

    // Deterministic tool activation: a bare `press('b')` races the app's key
    // handling under load, and a drag then paints nothing.
    await page.keyboard.press('b');
    await expect(
      page.locator('[data-testid="toolbar"] [data-tool="paint"]'),
      'the paint tool must be active before drawing',
    ).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
    await dragOnCanvas(page, { x: 320, y: 260 }, { x: 520, y: 400 });
    await settle(page);

    const before = await capture(page);
    writeFileSync(
      join(testInfo.outputPath(), 'before.png'),
      Buffer.from(before.dataUrl.split(',')[1] ?? '', 'base64'),
    );

    const result = await page.evaluate(async () => {
      const perf = (window as unknown as DiagWindow).__varvePerf;
      if (!perf?.forceFullRedraw) throw new Error('oracle unavailable');
      return perf.forceFullRedraw();
    });
    await settle(page);

    const diff = await diffAgainstBefore(page);
    const outDir = testInfo.outputPath();
    if (!diff.sizeChanged && diff.afterDataUrl) {
      writeFileSync(
        join(outDir, 'after.png'),
        Buffer.from(diff.afterDataUrl.split(',')[1] ?? '', 'base64'),
      );
    }
    const report = {
      oracleFrameIndex: result.frameIndex,
      beforeFrame: before.frame,
      beforeGeometry: before.geometry,
      beforeRenderScale: before.renderScale,
      beforeTier: before.tier,
      ...diff,
    };
    delete (report as { afterDataUrl?: string }).afterDataUrl;
    writeFileSync(join(outDir, 'oracle-diff.json'), JSON.stringify(report, null, 2));
    console.log(`[oracle-diag] ${JSON.stringify(report)}`);
  });
});

/**
 * Is a blank canvas after a committed stroke a *render* failure or a
 * *presentation* failure?
 *
 * `stroke-undo-responsiveness.spec.ts` asserts "a paint stroke must change
 * visible pixels" and has failed with the layer present in the Layers panel
 * (`Brush Layer`), `nodes: 1`, `cacheEntries: 1`, and an empty canvas on a
 * `worker-cached clean full` frame (`source: worker-reply`, `dirty: 0%`). That
 * is consistent with either a stale worker bitmap being presented, or the IR
 * genuinely lacking the stroke's tiles.
 *
 * A forced authoritative full redraw separates them: if the pixels come back,
 * the document and the render path are correct and the defect is that a stale
 * bitmap was allowed to stand for the current revision. If they do not, the IR
 * or the tile upload is at fault.
 *
 * The symptom is intermittent (roughly one run in two or three), so this paints
 * several strokes in one session and reports every iteration.
 */
test('after strokes: does a forced full redraw recover silent pixels?', async ({
  page,
}, testInfo) => {
  test.skip(!enabled, 'set VARVE_ORACLE_DIAG=1 to run');

  await page.setViewportSize({ width: 1280, height: 800 });
  await navigateToEditor(page, '/?perf=1');
  await expect
    .poll(async () => page.evaluate(() => Boolean((window as unknown as DiagWindow).__varvePerf)), {
      timeout: 20_000,
    })
    .toBe(true);
  await page.locator(CANVAS).waitFor({ timeout: 20_000 });

  const hashOf = () =>
    page.evaluate((selector) => {
      const canvas = document.querySelector(selector) as HTMLCanvasElement;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('no 2d context');
      const px = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261;
      for (let i = 0; i < px.length; i += 97) {
        hash ^= px[i] ?? 0;
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    }, CANVAS);

  await page.keyboard.press('b');
  await expect(
    page.locator('[data-testid="toolbar"] [data-tool="paint"]'),
    'the paint tool must be active before drawing',
  ).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });

  const iterations: Array<Record<string, unknown>> = [];
  let previousHash = await hashOf();
  let caught: Record<string, unknown> | null = null;

  for (let i = 0; i < 5; i++) {
    const dy = i * 40;
    await dragOnCanvas(page, { x: 300, y: 220 + dy }, { x: 520, y: 340 + dy });
    await settle(page);
    const hash = await hashOf();
    const changed = hash !== previousHash;
    const entry: Record<string, unknown> = {
      iteration: i,
      changed,
      hashBefore: previousHash,
      hash,
    };

    if (!changed && !caught) {
      const framesBefore = await page.evaluate(
        () => (window as unknown as DiagWindow).__varvePerf?.getFrames?.(8) ?? [],
      );
      const status = await page.evaluate(() => {
        const perf = window as unknown as {
          __varvePerf?: { workerStatus?: () => unknown; renderPath?: () => unknown };
        };
        return {
          worker: perf.__varvePerf?.workerStatus?.() ?? null,
          renderPath: perf.__varvePerf?.renderPath?.() ?? null,
        };
      });
      await page.evaluate(async () => {
        const perf = (window as unknown as DiagWindow).__varvePerf;
        await perf?.forceFullRedraw?.();
      });
      await settle(page);
      const afterForce = await hashOf();
      const framesAfter = await page.evaluate(
        () => (window as unknown as DiagWindow).__varvePerf?.getFrames?.(8) ?? [],
      );
      caught = {
        iteration: i,
        // The decisive split: if a forced redraw brings the pixels back, the
        // document and render path are right and the defect is a stale bitmap
        // standing in for the current revision. If not, the IR or the tile
        // upload never had the stroke.
        recoveredByForcedRedraw: afterForce !== hash,
        hashAfterForceRedraw: afterForce,
        layerCount: await page.getByRole('treeitem').count(),
        status,
        framesBefore,
        framesAfter,
      };
      entry.caught = caught;
    }

    iterations.push(entry);
    previousHash = hash;
  }

  writeFileSync(
    join(testInfo.outputPath(), 'stroke-present.json'),
    JSON.stringify({ iterations, caught }, null, 2),
  );
  console.log(
    `[stroke-present] ${JSON.stringify({
      silentStrokes: iterations.filter((it) => it.changed === false).length,
      iterations: iterations.length,
      recoveredByForcedRedraw: caught?.recoveredByForcedRedraw ?? null,
    })}`,
  );
  // Reports rather than asserts: the gating assertion lives in
  // stroke-undo-responsiveness.spec.ts.
});
