/**
 * Shared dev-server lifecycle for the responsive validation harnesses.
 *
 * An editor already listening on the canonical port is reused; otherwise vite
 * is started detached and torn down by the harness exit hook. The website build
 * is served from apps/website/dist by the repo static server.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EDITOR_URL = 'http://localhost:1420';
export const WEBSITE_DIST = path.join(ROOT, 'apps', 'website', 'dist');

const children = new Set();

function spawnTracked(command, args) {
  const child = spawn(command, args, {
    cwd: ROOT,
    detached: process.platform !== 'win32',
    stdio: 'ignore',
  });
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
}

/** Terminate every child server started by this process. Safe to call twice. */
export function stopChildren() {
  for (const child of children) stopChild(child);
}

async function waitForHttpOk(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let error = 'no attempt';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return { ok: true };
      error = 'HTTP ' + response.status;
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(1000, Math.max(1, deadline - Date.now()))),
    );
  }
  return { ok: false, error };
}

async function findFreePort(start, end) {
  for (let port = start; port <= end; port += 1) {
    const free = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => server.close(() => resolve(true)));
      server.listen(port, '127.0.0.1');
    });
    if (free) return port;
  }
  throw new Error('no free port in ' + start + '-' + end + ' for the website server');
}

/**
 * Resolve the editor URL, starting vite when nothing is listening.
 * @param {{ editorUrl?: string | null }} options
 * @returns {Promise<{ url: string, started: boolean }>}
 */
export async function ensureEditor(options = {}) {
  const editorUrl = options.editorUrl ?? null;
  if (editorUrl !== null) {
    const probe = await waitForHttpOk(editorUrl, 5000);
    if (!probe.ok) throw new Error('editor at ' + editorUrl + ' unreachable (' + probe.error + ')');
    return { url: editorUrl, started: false };
  }
  const existing = await waitForHttpOk(EDITOR_URL, 2500);
  if (existing.ok) return { url: EDITOR_URL, started: false };
  console.log('[responsive] editor not running; starting vite on ' + EDITOR_URL);
  const child = spawnTracked('pnpm', [
    '--filter',
    '@varve/desktop',
    'exec',
    'vite',
    '--port',
    '1420',
    '--strictPort',
  ]);
  const ready = await waitForHttpOk(EDITOR_URL, 180000);
  if (ready.ok) return { url: EDITOR_URL, started: true };
  stopChild(child);
  throw new Error('vite on 1420 not ready in 180s (' + ready.error + ')');
}

/**
 * Resolve a served marketing-site build, reusing or starting one.
 * @param {{ websiteUrl?: string | null, reuseWebsiteDist?: boolean }} options
 * @returns {Promise<{ url: string, started: boolean }>}
 */
export async function ensureWebsite(options = {}) {
  const websiteUrl = options.websiteUrl ?? null;
  if (websiteUrl !== null) {
    const probe = await waitForHttpOk(websiteUrl, 5000);
    if (!probe.ok)
      throw new Error('website at ' + websiteUrl + ' unreachable (' + probe.error + ')');
    return { url: websiteUrl, started: false };
  }
  if (options.reuseWebsiteDist) {
    if (!existsSync(path.join(WEBSITE_DIST, 'index.html'))) {
      throw new Error(
        '--reuse-website-dist: ' + WEBSITE_DIST + '/index.html is missing; build first',
      );
    }
  } else {
    console.log('[responsive] building website (astro build); this is the slow step');
    const build = spawnSync('pnpm', ['--filter', '@varve/website', 'exec', 'astro', 'build'], {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: 900000,
    });
    if (build.error) throw build.error;
    if (build.status !== 0) throw new Error('website build failed (exit ' + build.status + ')');
  }
  const port = await findFreePort(4391, 4401);
  const url = 'http://127.0.0.1:' + port;
  spawnTracked(process.execPath, [
    path.join(ROOT, 'apps/website/scripts/serve-dist.mjs'),
    String(port),
    WEBSITE_DIST,
  ]);
  const ready = await waitForHttpOk(url, 10000);
  if (ready.ok) return { url, started: true };
  throw new Error('website server on ' + url + ' did not start (' + ready.error + ')');
}
