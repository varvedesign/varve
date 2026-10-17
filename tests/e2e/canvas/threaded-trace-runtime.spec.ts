import { expect, test } from '@playwright/test';

test.describe('threaded WASM contour tracing', () => {
  test.skip(
    !process.env.VARVE_THREADED_TRACE_E2E,
    'Set VARVE_THREADED_TRACE_E2E=1 after building wasm-build-threads',
  );

  test('runs the real tracer on multiple workers and matches scalar WASM output', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.route('**/threaded-trace-probe.html', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        headers: {
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
        },
        body: '<!doctype html><html><head><title>threaded trace probe</title></head><body></body></html>',
      }),
    );
    await page.goto('/threaded-trace-probe.html');
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

    const result = await page.evaluate(async () => {
      const hostUrl =
        '/@fs/home/kevina/CodingProjects/varve/packages/engine/src/threadedTrace/threadedTraceHost.ts';
      const scalarUrl =
        '/@fs/home/kevina/CodingProjects/varve/packages/engine/src/upscaleProviders/wasmTraceProvider.ts';
      const [{ ThreadedTraceHost }, { wasmTraceProvider }] = await Promise.all([
        import(/* @vite-ignore */ hostUrl),
        import(/* @vite-ignore */ scalarUrl),
      ]);
      const threads = new ThreadedTraceHost({ threads: 2 });
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
    });

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
