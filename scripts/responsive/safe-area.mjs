#!/usr/bin/env node
/**
 * Safe-area inset validation (responsive campaign task 01a).
 *
 * Validates that viewport-fit=cover plus the env(safe-area-inset-*) chrome
 * contract resolves correctly when the viewport actually has insets. Linux
 * Chromium cannot produce real device insets, so this harness emulates them
 * over CDP (Emulation.setSafeAreaInsetsOverride, Chromium 151 / Playwright
 * 1.62): the page sees real env() values, not a test-only CSS override.
 *
 * The editor half is scripts/responsive/safe-area/editor.mjs; the site half
 * (served built dist) is scripts/responsive/safe-area/site.mjs.
 *
 * Usage: pnpm validate:safe-area (heavy-lease wrapped)
 *        node scripts/responsive/safe-area.mjs [--out DIR] [--no-screenshots]
 *          [--skip-editor] [--skip-site]
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { launchBrowser } from './capture.mjs';
import { EDITOR_URL, READY_TIMEOUT_MS, ROOT, SHOT_ROOT, shortSha } from './safe-area/config.mjs';
import { captureEditor } from './safe-area/editor.mjs';
import { writeReport } from './safe-area/report.mjs';
import { captureSite } from './safe-area/site.mjs';

function parseArgs(argv) {
  const args = { out: null, screenshots: true, editor: true, site: true };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--out') {
      index += 1;
      args.out = path.resolve(argv[index]);
    } else if (flag === '--no-screenshots') args.screenshots = false;
    else if (flag === '--skip-editor') args.editor = false;
    else if (flag === '--skip-site') args.site = false;
    else throw new Error(`unknown argument: ${flag}`);
  }
  args.out = args.out || path.join(SHOT_ROOT, shortSha(), 'safe-area');
  return args;
}

async function isUrlUp(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForUrl(url) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isUrlUp(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function stopChild(child) {
  if (!child) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

/** Reuse a live editor server, otherwise start one and return the child. */
async function ensureEditor() {
  if (await isUrlUp(EDITOR_URL)) return null;
  const child = spawn(
    'pnpm',
    ['--filter', '@varve/desktop', 'exec', 'vite', '--port', '1420', '--strictPort'],
    { cwd: ROOT, stdio: 'ignore', detached: true },
  );
  if (!(await waitForUrl(EDITOR_URL))) {
    stopChild(child);
    throw new Error(`editor dev server did not start within ${READY_TIMEOUT_MS}ms`);
  }
  return child;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const checks = [];
  const screenshotList = [];
  const options = {
    url: EDITOR_URL,
    out: args.out,
    screenshots: args.screenshots,
    checks,
    screenshotList,
  };
  let browser = null;
  let editorChild = null;
  try {
    if (args.editor) editorChild = await ensureEditor();
    browser = await launchBrowser();
    if (args.editor) await captureEditor(browser, options);
    if (args.site) await captureSite(browser, options);
  } finally {
    if (browser) await browser.close().catch(() => {});
    stopChild(editorChild);
  }
  const summary = writeReport(args.out, checks, screenshotList);
  for (const check of summary.failed) {
    console.error(`FAIL ${check.name} :: ${JSON.stringify(check.detail)}`);
  }
  console.log(
    'safe-area: ' +
      summary.passed +
      ' passed, ' +
      summary.failed.length +
      ' failed; report ' +
      summary.reportPath,
  );
  process.exitCode = summary.failed.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`safe-area validation crashed: ${error?.stack ? error.stack : String(error)}`);
  process.exitCode = 1;
});
