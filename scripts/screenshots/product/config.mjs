/**
 * CLI configuration for the product screenshot pipeline: argument parsing,
 * output paths, and the review-directory safety check. Importing this module
 * runs the same argv parsing the entry point used to run at module scope.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReviewDirectorySafe } from '../capture-safety.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const args = process.argv.slice(2);
export const reviewFlag = args.indexOf('--review-dir');
export const reviewDir = reviewFlag < 0 ? undefined : args[reviewFlag + 1];
if (reviewFlag >= 0 && (!reviewDir || reviewDir.startsWith('--'))) {
  throw new Error('--review-dir requires an output directory');
}
export const sourceScenesFlag = args.indexOf('--source-scenes-dir');
export const sourceScenesArg = sourceScenesFlag < 0 ? undefined : args[sourceScenesFlag + 1];
if (sourceScenesFlag >= 0 && (!sourceScenesArg || sourceScenesArg.startsWith('--'))) {
  throw new Error('--source-scenes-dir requires a test-results run directory');
}
export const sourceScenesDir = sourceScenesArg ? resolve(ROOT, sourceScenesArg) : undefined;
export const CANONICAL_DIR = join(ROOT, 'docs', 'screenshots', 'product');
export const OUT_DIR = reviewDir ? resolve(reviewDir) : CANONICAL_DIR;
export const PUBLIC_DIR = join(ROOT, 'apps', 'website', 'public', 'screenshots');
export const MANIFEST_PATH = join(
  ROOT,
  'apps',
  'website',
  'src',
  'data',
  'screenshot-manifest.json',
);
/**
 * Where a failing scene's diagnostic frame goes.
 *
 * This must never be the canonical or published screenshot directory: a debug
 * dump that lands next to published captures looks like a published capture
 * (it broke `validate.mjs`'s orphan check on the shared checkout, 2026-09-29).
 * `reports/` is gitignored, so diagnostics are never committed.
 */
export const DEBUG_DIR = join(ROOT, 'reports', 'screenshot-debug');
export const PORT = Number(process.env.VARVE_SHOT_PORT ?? 1430);
export const BASE = `http://localhost:${PORT}`;

export const OUTPUT_DIRS = reviewDir ? [OUT_DIR] : [OUT_DIR, PUBLIC_DIR];
export const OUTPUT_MANIFEST = reviewDir ? join(OUT_DIR, 'manifest.json') : MANIFEST_PATH;
if (reviewDir) assertReviewDirectorySafe(OUT_DIR, [CANONICAL_DIR, PUBLIC_DIR]);

// indexOf returns -1 when --scenes is absent, so reading args[index + 1]
// unguarded picks up args[0] — turning `--strict` into a scene filter that
// matches nothing and silently capturing zero scenes.
export const scenesFlag = args.indexOf('--scenes');
export const onlyScenes = new Set(
  (scenesFlag === -1 ? '' : (args[scenesFlag + 1] ?? ''))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);
export const strict = args.includes('--strict');
