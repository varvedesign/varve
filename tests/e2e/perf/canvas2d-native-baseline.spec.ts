import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Canvas2D baseline for the native raster benchmark corpus (ADR-0244 open
 * item 4). Replays the exact IR the Rust bench rasterizes (emitted by
 * `native_render_bench --emit-corpus`) through the authoritative Canvas2D
 * replay in a real browser, so the promotion decision has both numbers from
 * one machine and one corpus.
 *
 * Gated behind VARVE_CANVAS2D_BASELINE=1 and run through the
 * inference-probe config (dedicated dev server, one worker):
 *
 *   cargo run --release -p varve-accel --example native_render_bench -- \
 *     --emit-corpus /tmp/varve-baseline
 *   VARVE_CANVAS2D_BASELINE=/tmp/varve-baseline \
 *     npx playwright test tests/e2e/perf/canvas2d-native-baseline.spec.ts \
 *     --config playwright.inference-probe.config.ts --project=chromium
 *
 * Native-side numbers for the same corpus come from `native_render_bench`.
 * Both sides must record host load, frames, and the same six cases. This
 * harness measures Canvas2D replay, full clear, and full-frame readback on a
 * detached canvas; it does not measure compositor presentation or end-to-end
 * editor frame time.
 */

const gate = process.env.VARVE_CANVAS2D_BASELINE;
const repoRoot = process.cwd();
const engineSrc = path.join(repoRoot, 'packages/engine/src');
const FRAMES = Number(process.env.VARVE_BASELINE_FRAMES ?? 60);

interface Corpus {
  width: number;
  height: number;
  view: number[];
  items: unknown[];
}

interface CaseResult {
  file: string;
  items: number;
  width: number;
  height: number;
  coldFirstFrameMs: number;
  warmP50Ms: number;
  warmP95Ms: number;
  warmMaxMs: number;
  nonTransparentPixels: number;
  visiblePixelRatio: number;
}

test.skip(!gate, 'set VARVE_CANVAS2D_BASELINE=<corpus dir> to run the Canvas2D baseline');

test('Canvas2D replay of the native bench corpus', async ({ page }) => {
  test.setTimeout(600_000);

  await page.route('**/canvas2d-baseline.html', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><head><title>canvas2d baseline</title></head>
<body>
<script type="module">
  window.__engine = import('/@fs/${engineSrc}/index.ts');
</script>
</body></html>`,
    }),
  );
  await page.goto('/canvas2d-baseline.html', { timeout: 30_000 });

  const corpusDir = gate as string;
  const files = [
    'corpus-1600x1000-600.json',
    'corpus-1600x1000-10000.json',
    'corpus-2560x1600-600.json',
    'corpus-2560x1600-10000.json',
    'corpus-3200x2000-600.json',
    'corpus-3200x2000-10000.json',
  ];
  const results: CaseResult[] = [];

  for (const file of files) {
    const corpus = JSON.parse(readFileSync(path.join(corpusDir, file), 'utf8')) as Corpus;
    const result = await page.evaluate(
      async ({ ir, width, height, frames }) => {
        const engine = (await window.__engine) as {
          replayIr: (ctx: CanvasRenderingContext2D, ir: readonly unknown[]) => void;
        };
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) throw new Error('no 2d context');
        const items: readonly unknown[] = ir;
        const replayFrame = (): ImageData => {
          ctx.clearRect(0, 0, width, height);
          engine.replayIr(ctx, items);
          // Force Canvas2D to materialize the complete frame inside the timed
          // region instead of measuring command submission alone.
          return ctx.getImageData(0, 0, width, height);
        };

        // Cold: the first replay pays any lazy replay-side setup.
        const coldStart = performance.now();
        let frame = replayFrame();
        const coldFirstFrameMs = performance.now() - coldStart;

        const samples: number[] = [];
        for (let index = 0; index < frames; index += 1) {
          const started = performance.now();
          frame = replayFrame();
          samples.push(performance.now() - started);
        }
        const pixels = frame.data;
        let nonTransparentPixels = 0;
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] !== 0) nonTransparentPixels += 1;
        }
        const visiblePixelRatio = nonTransparentPixels / (width * height);
        if (visiblePixelRatio < 0.05) {
          throw new Error(`replay coverage too low: ${(visiblePixelRatio * 100).toFixed(2)}%`);
        }
        samples.sort((a, b) => a - b);
        const percentile = (p: number): number => {
          const index = Math.min(samples.length - 1, Math.round((samples.length - 1) * p));
          const value = samples[index];
          if (value === undefined) throw new Error('empty sample set');
          return value;
        };
        const max = samples[samples.length - 1];
        if (max === undefined) throw new Error('empty sample set');
        return {
          coldFirstFrameMs,
          warmP50Ms: percentile(0.5),
          warmP95Ms: percentile(0.95),
          warmMaxMs: max,
          nonTransparentPixels,
          visiblePixelRatio,
        };
      },
      {
        ir: corpus.items,
        width: corpus.width,
        height: corpus.height,
        frames: FRAMES,
      },
    );
    results.push({
      file,
      items: corpus.items.length,
      width: corpus.width,
      height: corpus.height,
      ...result,
    });
  }

  for (const result of results) {
    expect(result.warmP50Ms).toBeGreaterThan(0);
    expect(result.visiblePixelRatio).toBeGreaterThanOrEqual(0.05);
  }

  const report = {
    host: {
      os: process.platform,
      arch: process.arch,
      node: process.version,
      browser: page.context().browser()?.version() ?? 'unknown',
      framesPerCase: FRAMES,
    },
    note: 'Canvas2D replay plus clear and full-frame readback on a detached canvas; no compositor-present timing. Native numbers from native_render_bench use the same corpus and machine. Both are single-run, host-load-sensitive.',
    cases: results,
  };
  const dir = path.join(repoRoot, 'reports', 'native-raster-baseline');
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'canvas2d-baseline.json'), JSON.stringify(report, null, 2));
  } catch {
    // Evidence, not a gate.
  }
  console.log('canvas2d baseline:', JSON.stringify(results, null, 2));
});

declare global {
  interface Window {
    __engine: Promise<unknown>;
  }
}
