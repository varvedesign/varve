/**
 * Diagnostic: does the first stroke after worker startup appear and then get
 * overwritten, or never paint at all?
 *
 * Opt-in, because it records rather than asserts; run it when
 * `stroke-undo-responsiveness.spec.ts` reports a silent stroke (a stroke the
 * authoritative full redraw recovers):
 *
 *   VARVE_SILENT_STROKE_PROBE=1 pnpm exec playwright test \
 *     tests/e2e/paint/silent-stroke-timeline.spec.ts \
 *     --project=chromium --workers=1 --reporter=list
 *
 * It samples the FULL content-canvas hash once per animation frame across the
 * stroke and a forced full redraw, and reports where the two states differ:
 *
 *  - a hash that rises and then falls proves a present overwrote the stroke
 *    (the loan-without-fresh-frame class: a worker bitmap arriving for a
 *    document the surface has already painted past);
 *  - a hash that never rises means the stroke's frame never painted at all;
 *  - `diffBounds` localises whatever the forced redraw recovered, so "the
 *    pixels were missing" can be checked against the stroke's geometry
 *    instead of inferred from a single hash.
 */
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

const CANVAS = 'canvas.editor-canvas__content-layer';
const enabled = Boolean(process.env.VARVE_SILENT_STROKE_PROBE);

interface StrokeProbe {
  samples: Array<{ t: number; hash: number }>;
  stop: () => void;
  hashFull: () => number;
  storePre: () => void;
  storeClobber: () => void;
  png: () => string;
  pngPre: () => string;
  diffClobberAgainstNow: () => {
    changed: number;
    bounds: { x: number; y: number; w: number; h: number } | null;
  };
  diffAgainstPre: () => {
    changed: number;
    bounds: { x: number; y: number; w: number; h: number } | null;
  };
}

interface PerfFrames {
  getFrames?: (n: number) => Array<Record<string, unknown>>;
  getLast?: () => Record<string, unknown> | null;
  forceFullRedraw?: () => void;
}

declare global {
  interface Window {
    __strokeProbe?: StrokeProbe;
  }
}

/** The perf handle is declared elsewhere for fixtures/forceFullRedraw; widen for the frame ring. */
type PerfHandle = PerfFrames & { forceFullRedraw: () => void };

test('silent stroke: full-pixel timeline around the first stroke after startup', async ({
  page,
}, testInfo) => {
  test.skip(!enabled, 'set VARVE_SILENT_STROKE_PROBE=1 to run');

  await page.setViewportSize({ width: 1280, height: 800 });
  await navigateToEditor(page, '/?perf=1');
  await expect
    .poll(async () => page.evaluate(() => Boolean(window.__varvePerf)), { timeout: 20_000 })
    .toBe(true);
  await page.locator(CANVAS).waitFor({ timeout: 20_000 });

  await page.evaluate((selector) => {
    const canvas = document.querySelector(selector) as HTMLCanvasElement;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    const hashFull = () => {
      const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let h = 2166136261;
      for (let i = 0; i < px.length; i++) {
        h ^= px[i] ?? 0;
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    };
    let pre: Uint8ClampedArray | null = null;
    let prePng = '';
    let clobber: Uint8ClampedArray | null = null;
    const diffFrom = (base: Uint8ClampedArray | null) => {
      if (!base) return { changed: -1, bounds: null };
      const now = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let changed = 0;
      let minX = canvas.width;
      let minY = canvas.height;
      let maxX = -1;
      let maxY = -1;
      for (let px = 0; px < base.length / 4; px++) {
        const i = px * 4;
        if (
          base[i] === now[i] &&
          base[i + 1] === now[i + 1] &&
          base[i + 2] === now[i + 2] &&
          base[i + 3] === now[i + 3]
        ) {
          continue;
        }
        changed++;
        const x = px % canvas.width;
        const y = Math.floor(px / canvas.width);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      return {
        changed,
        bounds: maxX >= 0 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
      };
    };
    const samples: Array<{ t: number; hash: number }> = [];
    let running = true;
    const tick = () => {
      if (!running) return;
      samples.push({ t: Math.round(performance.now()), hash: hashFull() });
      requestAnimationFrame(tick);
    };
    window.__strokeProbe = {
      samples,
      stop: () => {
        running = false;
      },
      hashFull,
      storePre: () => {
        pre = ctx.getImageData(0, 0, canvas.width, canvas.height).data.slice();
        prePng = canvas.toDataURL('image/png');
      },
      storeClobber: () => {
        clobber = ctx.getImageData(0, 0, canvas.width, canvas.height).data.slice();
      },
      png: () => canvas.toDataURL('image/png'),
      pngPre: () => prePng,
      diffClobberAgainstNow: () => diffFrom(clobber),
      diffAgainstPre: () => diffFrom(pre),
    };
    requestAnimationFrame(tick);
  }, CANVAS);

  await page.keyboard.press('b');
  await expect(
    page.locator('[data-testid="toolbar"] [data-tool="paint"]'),
    'the paint tool must be active before drawing',
  ).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });

  const pre = await page.evaluate(() => {
    window.__strokeProbe!.storePre();
    return window.__strokeProbe!.hashFull();
  });

  await dragOnCanvas(page, { x: 120, y: 120 }, { x: 200, y: 140 });
  // Let every scheduled frame (main-thread and worker present) land.
  await page.waitForTimeout(2000);

  const beforeForce = await page.evaluate(() => window.__strokeProbe!.hashFull());
  const clobberPng = await page.evaluate(() => window.__strokeProbe!.png());
  const prePng = await page.evaluate(() => window.__strokeProbe!.pngPre());
  await page.evaluate(() => window.__strokeProbe!.storeClobber());
  const frames = await page.evaluate(() => {
    const perf = (window as { __varvePerf?: PerfHandle }).__varvePerf;
    return {
      recent: perf?.getFrames?.(10) ?? [],
      last: perf?.getLast?.() ?? null,
    };
  });

  await page.evaluate(() =>
    (window as { __varvePerf?: PerfHandle }).__varvePerf?.forceFullRedraw(),
  );
  await page.waitForTimeout(800);
  const afterForce = await page.evaluate(() => window.__strokeProbe!.hashFull());
  const forcePng = await page.evaluate(() => window.__strokeProbe!.png());
  const diff = await page.evaluate(() => window.__strokeProbe!.diffAgainstPre());
  const clobberDiff = await page.evaluate(() => window.__strokeProbe!.diffClobberAgainstNow());
  const { mkdirSync: mk, writeFileSync: wf } = await import('node:fs');
  const dir = 'reports/silent-stroke-diag';
  mk(dir, { recursive: true });
  wf(`${dir}/pre-state.png`, Buffer.from(prePng.split(',')[1] ?? '', 'base64'));
  wf(`${dir}/clobbered-state.png`, Buffer.from(clobberPng.split(',')[1] ?? '', 'base64'));
  wf(`${dir}/forced-redraw-state.png`, Buffer.from(forcePng.split(',')[1] ?? '', 'base64'));

  const timeline = await page.evaluate(() => {
    window.__strokeProbe!.stop();
    return window.__strokeProbe!.samples;
  });

  const summary = {
    pre,
    beforeForce,
    afterForce,
    silentBeforeForce: beforeForce === pre,
    recoveredByForce: afterForce !== beforeForce,
    diff: { changedPixels: diff.changed, bounds: diff.bounds },
    clobberDiff: { changedPixels: clobberDiff.changed, bounds: clobberDiff.bounds },
    distinctHashes: [...new Set(timeline.map((s) => s.hash))],
    timeline: timeline.map((s) => `${s.t}:${s.hash}`),
    frames: frames.recent.map((f) => ({
      frameIndex: f.frameIndex,
      docVersion: f.docVersion,
      redrawCount: f.redrawCount,
      redrawReason: f.redrawReason,
      invalidationReasons: f.invalidationReasons,
      renderPath: f.renderPath,
      frameSource: f.frameSource,
      cacheHitCount: f.cacheHitCount,
      replayMs: f.replayMs,
      committedAt: f.committedAt,
    })),
  };
  console.info(`[stroke-timeline] ${JSON.stringify(summary)}`);
  await testInfo.attach('stroke-timeline.json', {
    body: JSON.stringify(summary, null, 2),
    contentType: 'application/json',
  });

  // Recording test: it must observe frames, and the forced redraw must have a
  // well-defined relationship to the pre-force state.
  expect(timeline.length).toBeGreaterThan(0);
  expect(frames.recent.length).toBeGreaterThan(0);
});
