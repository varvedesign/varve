/**
 * Shared constants for the safe-area validation harness (task 01a).
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const EDITOR_URL = 'http://localhost:1420';
export const SITE_DIST = path.join(ROOT, 'apps', 'website', 'dist');
export const SHOT_ROOT = path.join(ROOT, 'docs', 'responsive', 'screenshots');
/** Portrait phone/tablet: notch or iOS status bar on top, home indicator below. */
export const PORTRAIT_INSETS = { top: 47, bottom: 34, left: 0, right: 0 };
/** Landscape notched phone: the sensor housing occupies a vertical edge. */
export const LANDSCAPE_INSETS = { top: 0, bottom: 21, left: 47, right: 47 };
export const READY_TIMEOUT_MS = 180000;
export const TOLERANCE = 1.5;
export const NEWLINE = String.fromCharCode(10);

/** Current commit, for the evidence directory and report header. */
export function shortSha() {
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim();
}

export function relativeToRoot(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

export function numberFromCss(value) {
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}
