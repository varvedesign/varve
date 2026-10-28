#!/usr/bin/env node
/**
 * Product screenshot capture pipeline.
 *
 * Drives the real Varve editor (Vite dev server, same harness as the app
 * E2E suite) into deterministic states and captures marketing screenshots.
 *
 *   pnpm screenshots:product              — capture every scene
 *   pnpm screenshots:product -- --scenes workspace,vector
 *   pnpm screenshots:product -- --strict  — exit non-zero if ANY scene skips
 *
 * Output:
 *   docs/screenshots/product/*.png              — canonical captures
 *   apps/website/public/screenshots/*.png       — synced for the website
 *   apps/website/src/data/screenshot-manifest.json — machine-readable manifest
 *
 * Determinism contract:
 *   - fresh browser context per run (no localStorage/IndexedDB leakage);
 *   - fixed viewport 1440x900, DPR 1, reduced motion;
 *   - fixed content coordinates and tool sequences;
 *   - waits on fonts/canvas/settle rather than fixed sleeps alone;
 *   - mouse parked off-canvas before every capture (no hover ambiguity);
 *   - no text edit mode, no playhead animation, no notifications.
 *
 * If a scene cannot be produced it is recorded as skipped with a reason —
 * never silently replaced by an older screenshot. --strict fails the run.
 */

import { mkdirSync } from 'node:fs';

import { args, OUT_DIR, onlyScenes, PUBLIC_DIR } from './product/config.mjs';
import { normalizeManifest, syncReviewedPromotion } from './product/manifest-sync.mjs';
import { capturedThisRun, optedOut, ranThisRun, runCapture } from './product/runner.mjs';
import { assertSourceScenesFlags } from './product/scenes/index.mjs';
import { failures, manifest, recordFailure, skippedThisRun } from './product/state.mjs';

if (args.includes('--sync-reviewed')) syncReviewedPromotion();

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(PUBLIC_DIR, { recursive: true });

assertSourceScenesFlags();

if (args.includes('--normalize')) await normalizeManifest();

await runCapture();

// Reported separately from the manifest totals below: a run that captures
// nothing still leaves a manifest full of previously-captured scenes, which
// reads like success unless this run's own tally is shown.
console.log(
  `this run: ${ranThisRun} scene(s) attempted, ${capturedThisRun} captured, ` +
    `${skippedThisRun.length} failed-to-capture, ${optedOut} opted out` +
    `${skippedThisRun.length > 0 ? ` (${skippedThisRun.join(', ')})` : ''}`,
);
// Opting out is a deliberate choice, not a mis-typed filter — only an empty
// run with nothing opted out means the selection matched nothing.
if (ranThisRun === 0 && optedOut === 0) {
  console.error('FAIL no scenes ran — check the --scenes filter');
  recordFailure();
}

const captured = Object.values(manifest.scenes).filter((s) => s.status === 'captured').length;
const skipped = Object.values(manifest.scenes).filter((s) => s.status === 'skipped').length;
const untouched = Object.entries(manifest.scenes).filter(
  ([id, s]) => s.status === 'captured' && onlyScenes.size > 0 && !onlyScenes.has(id),
).length;
console.log(
  `manifest: ${captured} captured (${untouched} untouched by this run), ${skipped} skipped, ${failures} failure(s)`,
);
process.exit(failures > 0 ? 1 : 0);
