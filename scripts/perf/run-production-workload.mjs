#!/usr/bin/env node
/**
 * Deterministic workload corpus against a production (release-equivalent)
 * build.
 *
 * The point of this runner is that a development build is not evidence:
 * dev-only logging, React double-invocation, unminified bundles and
 * diagnostics all move the numbers. It therefore refuses to run against a dev
 * server rather than silently falling back to one, and records the exact
 * commit, build mode, feature flags and environment alongside every result so
 * a figure without provenance cannot enter the ledger.
 *
 * Usage:
 *   node scripts/perf/run-production-workload.mjs
 *   node scripts/perf/run-production-workload.mjs --workloads=single-drag,pan
 *   node scripts/perf/run-production-workload.mjs --iterations=30 --warmup=5
 *   node scripts/perf/run-production-workload.mjs --duplications=7   # ~512 nodes
 *   node scripts/perf/run-production-workload.mjs --allow-dev-build  # explicit opt-in
 *   node scripts/perf/run-production-workload.mjs --out=results.json
 *   node scripts/perf/run-production-workload.mjs --fixture=vector-1k
 *   node scripts/perf/run-production-workload.mjs --mode=canvas2d-worker --fixture=vector-1k --preflight-only --out=preflight.json
 *   node scripts/perf/run-production-workload.mjs --headed --mode=webgl2 --preflight-only --out=headed-preflight.json
 *   node scripts/perf/run-production-workload.mjs --quality=full --fixture=vector-1k
 *   node scripts/perf/run-production-workload.mjs --quality=automatic --fixture=vector-1k
 *   node scripts/perf/run-production-workload.mjs --help
 *   node scripts/perf/run-production-workload.mjs --fixture=vector-5k \
 *       --workloads=single-drag,zoom,undo-redo,nudge
 *
 * `--quality` explicitly selects Automatic or Full interactive preview quality;
 * reports record this alongside the renderer mode. The default is Automatic.
 * `--fixture` seeds a deterministic corpus fixture (vector-100/500/1k/5k,
 * dense-overlap, wide-spread, effects-heavy, raster-heavy, ...) through the
 * app itself and opens it from the home screen; the fixture checksum and node
 * count are recorded with the results. Every workload record carries the
 * machine state captured around it and a `validity` classification
 * (valid/contended/thermally_suspect/background_activity/
 * insufficient_samples/instrumentation_error); only `valid` runs may be used
 * as authoritative regression evidence.
 *
 * Workloads are driven with real CDP pointer and keyboard input rather than an
 * in-page hook, so the measured path includes the browser's own event
 * dispatch, coalescing and hit-testing.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import {
  ALLOW_DEV,
  DIST,
  DPR,
  EXTERNAL_BASE,
  fail,
  HEADLESS,
  OUT,
  PREFLIGHT_ONLY,
  PREVIEW_QUALITY,
  RENDERER_MODE,
  ROOT,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
} from './workload/cli.mjs';
import { buildIdentity } from './workload/evidence.mjs';
import { browser, openMeasurementSession, prepareBaseline } from './workload/session.mjs';
import { runMeasurementLoop } from './workload/workloads.mjs';

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

// ── Build ───────────────────────────────────────────────────────────────────

if (!ALLOW_DEV && !EXTERNAL_BASE) {
  console.log('Building production bundle (vite build)…');
  try {
    // `vite build` directly rather than the package's `build` script: that
    // script gates on `tsc --noEmit` over the whole workspace, so unrelated
    // in-flight type errors elsewhere in the tree would block a perf run that
    // does not depend on them. The emitted bundle is identical either way —
    // Vite strips types without checking them — but the bypass is recorded in
    // the results so a reader knows the typecheck gate did not run.
    execFileSync('npx', ['vite', 'build'], {
      cwd: `${ROOT}apps/desktop`,
      stdio: 'inherit',
      timeout: 15 * 60 * 1000,
    });
  } catch {
    fail(
      'production build failed. Fix the build rather than measuring a dev server — ' +
        'dev-build numbers are not comparable. Pass --allow-dev-build only for smoke-testing this runner.',
    );
  }
  if (!existsSync(DIST)) {
    fail(`expected a production bundle at ${DIST} but none exists`);
  }
}

const buildMode = ALLOW_DEV ? 'development' : 'production';
if (ALLOW_DEV) {
  console.warn(
    '\n  WARNING: running against a development build. Results are NOT comparable\n' +
      '  with production figures and must never be recorded as a budget.\n',
  );
}

// ── Serve ───────────────────────────────────────────────────────────────────

let server = null;
let serverLog = '';
let BASE = EXTERNAL_BASE;

if (!EXTERNAL_BASE) {
  const port = await findFreePort();
  const serverCmd = ALLOW_DEV
    ? ['pnpm', ['--dir', 'apps/desktop', 'dev', '--port', String(port), '--strictPort']]
    : ['pnpm', ['--dir', 'apps/desktop', 'preview', '--port', String(port), '--strictPort']];

  server = spawn(serverCmd[0], serverCmd[1], { cwd: ROOT, stdio: 'pipe' });
  server.stdout.on('data', (d) => {
    serverLog += d.toString();
  });
  server.stderr.on('data', (d) => {
    serverLog += d.toString();
  });

  // `localhost`, not `127.0.0.1`: vite preview binds the loopback name, which
  // on a dual-stack host resolves to ::1 — probing the IPv4 literal then never
  // connects and the runner reports a phantom startup timeout.
  BASE = `http://localhost:${port}`;
}

async function waitForServer(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

let exitCode = 0;
const partial = {
  identity: buildIdentity(),
  buildMode,
  requestedRendererMode: RENDERER_MODE,
  previewQuality: PREVIEW_QUALITY,
  viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT, dpr: DPR },
  browserMode: HEADLESS ? 'headless' : 'headed',
  presentationBoundary: 'browser event-to-commit / EventTiming only; not physical presentation',
  // Recorded so a reader knows the bundle is production-mode but was emitted
  // without the workspace typecheck gate having passed.
  typecheckGateBypassed: !ALLOW_DEV,
  workloads: [],
  errors: [],
  runtimeErrors: [],
};

function flush(reason) {
  partial.completedAt = new Date().toISOString();
  partial.terminationReason = reason;
  const json = JSON.stringify(partial, null, 2);
  if (OUT) {
    writeFileSync(OUT, json);
    console.log(`\nWrote ${OUT} (${reason})`);
  } else {
    console.log(json);
  }
}

// Partial results are still evidence; a run killed halfway must not vanish.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    flush(`interrupted by ${signal}`);
    server?.kill();
    browser?.close();
    process.exit(130);
  });
}

try {
  if (!(await waitForServer())) {
    fail(`server did not start within 90s. Log:\n${serverLog.slice(-2000)}`);
  }

  const { page, box, scene } = await openMeasurementSession({ partial, BASE });

  const rendererAvailable = partial.rendererQualification.available;
  partial.modeStatus = rendererAvailable ? 'available' : 'unavailable';
  if (!rendererAvailable) {
    partial.modeUnavailableReason = partial.rendererQualification.reason;
    exitCode = 0;
  }

  if (PREFLIGHT_ONLY) partial.preflightOnly = true;

  if (!PREFLIGHT_ONLY) {
    const { restoreBaselineCamera, baselineSceneFingerprint } = await prepareBaseline({
      page,

      partial,

      rendererAvailable,
    });

    exitCode = await runMeasurementLoop({
      baselineSceneFingerprint,

      box,

      exitCode,

      page,

      partial,

      rendererAvailable,

      restoreBaselineCamera,

      scene,

      server,
    });
  }
  const terminationReason = PREFLIGHT_ONLY
    ? rendererAvailable
      ? 'preflight completed'
      : 'requested renderer unavailable'
    : rendererAvailable
      ? 'completed'
      : 'requested renderer unavailable';
  flush(terminationReason);
} catch (error) {
  partial.errors.push(error instanceof Error ? error.message : String(error));
  partial.errorStack = error instanceof Error ? (error.stack ?? null) : null;
  flush('aborted');
  exitCode = 1;
} finally {
  await browser?.close();
  server?.kill();
}

process.exit(exitCode);
