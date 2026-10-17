import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';

/**
 * Required threaded-trace acceptance lane (threaded-WASM program).
 *
 * Gated behind VARVE_THREADED_TRACE_E2E=1 and run through the
 * inference-probe Playwright config (its own dev server, one worker):
 *
 *   just wasm-build-threads
 *   VARVE_THREADED_TRACE_E2E=1 npx playwright test \
 *     tests/e2e/canvas/threaded-trace-pool.spec.ts \
 *     --config playwright.inference-probe.config.ts --project=chromium
 *
 * The REQUIRED lane fails unless the pool initializes, performs the target
 * workload on >= 2 distinct workers, and returns byte-identical trace output
 * to the unshared single-threaded path for the same input. Isolation comes
 * from the dev server itself (VARVE_CROSS_ORIGIN_ISOLATION=1) — response
 * headers injected on route-fulfilled pages do not confer isolation (the
 * recorded probe evidence shows crossOriginIsolated stayed false) — so this
 * lane exercises the same headers a real deployment must send. The
 * without-isolation gate is unit-covered (ThreadedTraceHost eligibility) and
 * posture-covered by browser-readiness.spec.ts.
 */

// Playwright runs specs from the repo root; import.meta is unavailable in
// its transpiled specs.
const repoRoot = process.cwd();
const engineSrc = path.join(repoRoot, 'packages/engine/src');
const gateEnabled = process.env.VARVE_THREADED_TRACE_E2E === '1';

const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
} as const;

async function installIsolatedProbePage(page: Page): Promise<void> {
  await page.route('**/threaded-pool.html', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      headers: ISOLATION_HEADERS,
      body: `<!doctype html><html><head><title>threaded trace pool</title></head>
<body>
<script type="module">
  window.__poolReady = Promise.all([
    import('/@fs/${engineSrc}/threadedTrace/threadedTraceHost.ts'),
    import('/@fs/${engineSrc}/wasmLoader.ts'),
  ]).then(([hostModule, loaderModule]) => ({ ...hostModule, ...loaderModule }));
</script>
</body></html>`,
    }),
  );
}

declare global {
  interface Window {
    // Assigned by the probe page's inline module before any evaluate runs.
    __poolReady: Promise<unknown>;
  }
}

test.skip(
  !gateEnabled,
  'set VARVE_THREADED_TRACE_E2E=1 (and build the threads artifact) to run the required threaded lane',
);

test.describe('threaded trace pool (required lane)', () => {
  test('initializes the pool and proves execution on multiple workers', async ({ page }) => {
    test.setTimeout(240_000);
    await installIsolatedProbePage(page);
    await page.goto('/threaded-pool.html', { timeout: 30_000 });

    const report = (await page.evaluate(async (engineSrcUrl: string) => {
      const mod = (await window.__poolReady) as {
        ThreadedTraceHost: new () => {
          ensureReady: () => Promise<{
            phase: string;
            reason?: string;
            threads?: number;
            abi?: string;
            engineVersion?: string;
          }>;
          verifyParallelism: (min: number) => Promise<number>;
          getState: () => { phase: string; verifiedWorkers?: number };
        };
      };
      const host = new mod.ThreadedTraceHost();
      const state = await host.ensureReady();
      if (state.phase !== 'ready') {
        const capabilityUrl = `${engineSrcUrl}/runtimeCapabilities.ts`;
        const { getWasmCapabilitySnapshot } = await import(/* @vite-ignore */ capabilityUrl);
        const capability = getWasmCapabilitySnapshot();
        return {
          ...state,
          verifiedWorkers: 0,
          crossOriginIsolated: window.crossOriginIsolated,
          hardwareConcurrency: navigator.hardwareConcurrency,
          capability: capability.wasm,
        };
      }
      // The required signal: distinct workers observed running pool jobs.
      const minWorkers = Math.min(
        2,
        Math.max(2, Math.floor((navigator.hardwareConcurrency || 2) / 2)),
      );
      const verified = await host.verifyParallelism(minWorkers);
      return {
        ...host.getState(),
        verifiedWorkers: verified,
        crossOriginIsolated: window.crossOriginIsolated,
        hardwareConcurrency: navigator.hardwareConcurrency,
      };
    }, `/@fs/${engineSrc}`)) as {
      phase: string;
      reason?: string;
      threads?: number;
      verifiedWorkers?: number;
      crossOriginIsolated: boolean;
      hardwareConcurrency: number;
      capability?: unknown;
    };

    expect(
      report.crossOriginIsolated,
      'the isolated page must report crossOriginIsolated=true, or the header injection failed',
    ).toBe(true);
    expect(report.phase, `pool init: ${report.phase} (${report.reason ?? 'no reason'})`).toBe(
      'ready',
    );
    expect(report.threads).toBe(2);
    expect(
      report.verifiedWorkers ?? 0,
      'the pool must run probe jobs on at least two distinct workers; fewer means the workload fell back to a single worker',
    ).toBeGreaterThanOrEqual(2);

    persistReport('threaded-trace-required.json', report);
  });

  test('threaded trace output is byte-identical to the unshared path', async ({ page }) => {
    test.setTimeout(240_000);
    await installIsolatedProbePage(page);
    await page.goto('/threaded-pool.html', { timeout: 30_000 });

    const result = await page.evaluate(async () => {
      const engine = (await window.__poolReady) as {
        ThreadedTraceHost: new () => {
          ensureReady: () => Promise<{ phase: string; reason?: string }>;
          trace: (
            pixels: Uint8Array,
            width: number,
            height: number,
            options: { threshold?: number; minArea?: number },
          ) => Promise<string>;
        };
        tryLoadTraceWasm: () => Promise<{
          trace_contours_json: (
            pixels: Uint8Array,
            width: number,
            height: number,
            threshold: number,
            minPixels: number,
            foreground: string,
          ) => string;
        } | null>;
      };
      const width = 192;
      const height = 160;
      const pixels = new Uint8Array(width * height * 4);
      const discs = [
        { cx: 56, cy: 64, r: 38 },
        { cx: 128, cy: 96, r: 30 },
      ];
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = (y * width + x) * 4;
          let value = 235;
          for (const disc of discs) {
            const dx = x - disc.cx;
            const dy = y - disc.cy;
            if (dx * dx + dy * dy <= disc.r * disc.r) value = 30;
          }
          if (y >= 128 && y <= 136 && x >= 16 && x <= 176) value = 30;
          pixels[index] = value;
          pixels[index + 1] = value;
          pixels[index + 2] = value;
          pixels[index + 3] = 255;
        }
      }

      const host = new engine.ThreadedTraceHost();
      const state = await host.ensureReady();
      if (state.phase !== 'ready') {
        return { phase: state.phase, reason: state.reason, threaded: null, unshared: null };
      }
      const threaded = await host.trace(pixels, width, height, { threshold: 128, minArea: 4 });
      const unsharedModule = await engine.tryLoadTraceWasm();
      if (!unsharedModule) {
        return { phase: 'ready', reason: 'unshared module unavailable', threaded, unshared: null };
      }
      const unshared = unsharedModule.trace_contours_json(pixels, width, height, 128, 4, 'dark');
      return { phase: 'ready', threaded, unshared };
    });

    expect(result.phase).toBe('ready');
    expect(result.threaded, 'threaded trace must return output').toBeTruthy();
    expect(result.unshared, 'unshared module must load under isolation too').toBeTruthy();
    expect(result.threaded).toBe(result.unshared);

    persistReport('threaded-trace-determinism.json', {
      byteIdentical: result.threaded === result.unshared,
      threadedBytes: result.threaded?.length ?? 0,
    });
  });
});

function persistReport(name: string, payload: unknown): void {
  const dir = path.join(repoRoot, 'reports/threaded-wasm');
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, name), JSON.stringify(payload, null, 2));
  } catch {
    // Reports are evidence, not a gate: a read-only checkout must not fail
    // an otherwise-passing lane.
  }
}
