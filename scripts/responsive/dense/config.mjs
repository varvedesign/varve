/** Configuration for the dense-data (timeline + layers) responsive probe. */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ROOT } from '../server.mjs';

export const DENSE_SCREENSHOT_ROOT = path.join(ROOT, 'docs', 'responsive', 'screenshots');
export const BOOT_TIMEOUT_MS = 240000;

/**
 * Docked 13-14in presentations plus the compact 1024 drawer presentation.
 * Fine-pointer runs reuse one page resized through the matrix; coarse runs get
 * a fresh hasTouch context each.
 */
export const FINE_RUNS = [
  { label: '1180x820-fine', width: 1180, height: 820 },
  { label: '1366x1024-fine', width: 1366, height: 1024 },
  { label: '1024x768-fine', width: 1024, height: 768 },
];

export const COARSE_RUNS = [
  { label: '1180x820-coarse', width: 1180, height: 820 },
  { label: '1024x768-coarse', width: 1024, height: 768 },
];

/** Short HEAD sha used for the commit-anchored evidence directory. */
export function shortSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}
