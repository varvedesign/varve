import path from 'node:path';
import { expect, test } from '@playwright/test';

const engineSrc = path.join(process.cwd(), 'packages/engine/src').split(path.sep).join('/');
const hostUrl = `/@fs/${engineSrc}/threadedTrace/threadedTraceHost.ts`;
const scalarUrl = `/@fs/${engineSrc}/upscaleProviders/wasmTraceProvider.ts`;

test.describe('threaded WASM contour tracing', () => {
  test.skip(
    !process.env.VARVE_THREADED_TRACE_E2E,
    'Set VARVE_THREADED_TRACE_E2E=1 after building wasm-build-threads',
  );

  test('runs the real tracer on multiple workers and matches scalar WASM output', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    // Navigate to a genuinely SERVED page: the dev server (with
    // VARVE_CROSS_ORIGIN_ISOLATION=1) sends the isolation headers. Headers
    // injected on a route-fulfilled response do not confer isolation — that
    // was measured (crossOriginIsolated stayed false), which is why this
    // lane previously could not have passed as a fulfilled page.
    await page.goto('/dev-probe/isolated.html');
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

    const result = await page.evaluate(
      async ({ hostUrl, scalarUrl }) => {
        const [{ ThreadedTraceHost }, { wasmTraceProvider }] = await Promise.all([
          import(/* @vite-ignore */ hostUrl),
          import(/* @vite-ignore */ scalarUrl),
        ]);
        const threads = new ThreadedTraceHost();
        const ready = await threads.ensureReady();
        if (ready.phase !== 'ready') throw new Error(`threaded init: ${ready.reason}`);
        const workers = await threads.verifyParallelism(2);

        const width = 96;
        const height = 96;
        const image = new ImageData(width, height);
        for (let y = 8; y < 88; y += 1) {
          for (let x = 8; x < 88; x += 1) {
            if ((x > 20 && x < 40 && y > 20 && y < 40) || (x > 55 && x < 78 && y > 48 && y < 75)) {
              const offset = (y * width + x) * 4;
              image.data[offset] = 0;
              image.data[offset + 1] = 0;
              image.data[offset + 2] = 0;
              image.data[offset + 3] = 255;
            }
          }
        }
        const options = {
          mode: 'monochrome' as const,
          threshold: 128,
          minArea: 4,
          foreground: 'dark' as const,
        };
        try {
          const threaded = await threads.trace(new Uint8Array(image.data), width, height, options);
          const scalar = await wasmTraceProvider.trace(image, options);
          return {
            workers,
            threaded: JSON.parse(threaded),
            scalar,
            threadCount: ready.threads,
          };
        } finally {
          threads.retire('runtime acceptance probe complete');
        }
      },
      { hostUrl, scalarUrl },
    );

    await testInfo.attach('threaded-trace-runtime.json', {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    });
    expect(result.threadCount).toBe(2);
    expect(result.workers).toBeGreaterThanOrEqual(2);
    expect(result.threaded.width).toBe(96);
    expect(result.threaded.height).toBe(96);
    expect(result.threaded.paths.length).toBeGreaterThan(0);
    expect(result.threaded).toEqual(result.scalar);
  });
});
