/**
 * Vite dev-server lifecycle for the capture run.
 */
import { spawn } from 'node:child_process';
import { observeValidationChild } from '../../quality/heavy-lease.mjs';
import { assertPortAvailable } from '../capture-safety.mjs';
import { BASE, PORT, ROOT } from './config.mjs';

/* ------------------------------------------------------------------ */
/* Dev server                                                          */
/* ------------------------------------------------------------------ */

const serverCleanup = new WeakMap();

export async function startServer() {
  await assertPortAvailable(PORT);
  let serverOutput = '';
  // Match the browser-test server workaround for Node 26's V8 deoptimizer.
  const viteCommand =
    Number(process.versions.node.split('.')[0]) >= 26
      ? ['node', '--no-turbofan', 'node_modules/vite/bin/vite.js']
      : ['vite'];
  const child = spawn(
    'pnpm',
    ['--filter', '@varve/desktop', 'exec', ...viteCommand, '--port', String(PORT), '--strictPort'],
    {
      cwd: ROOT,
      // Inference scenes need crossOriginIsolated: it gates SharedArrayBuffer
      // (threaded WASM) and raises the safe-model ceiling from 50 MB to
      // 400 MB, which IS-Net at 178 MB sits well above.
      env: {
        ...process.env,
        // A capture must not be reset by another checkout participant's HMR
        // update while a model scene is waiting on a worker result.
        VARVE_DISABLE_HMR: '1',
        ...(process.env.VARVE_SHOT_MODELS && !process.env.VARVE_SHOT_NO_ISOLATION
          ? { VARVE_CROSS_ORIGIN_ISOLATION: '1' }
          : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group, so the whole tree can be terminated. `pnpm` spawns
      // Vite as a grandchild; killing only the `pnpm` pid left a Vite server
      // listening on the capture port after every run (observed 2026-09-29),
      // which then made the next `--strictPort` capture fail and kept a dev
      // server resident.
      detached: true,
    },
  );
  child.stdout?.on('data', (chunk) => {
    serverOutput += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    serverOutput += chunk.toString();
  });
  serverCleanup.set(child, observeValidationChild(child));
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    if (await probe()) return child;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Vite capture server exited before becoming ready on :${PORT}. ${serverOutput.trim()}`,
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await stopServer(child);
  throw new Error(
    `Vite dev server did not come up on :${PORT} within 150s. ${serverOutput.trim()}`,
  );
}

function probe() {
  return new Promise((resolve) => {
    import('node:http')
      .then(({ get }) => {
        const r = get(`${BASE}/`, { timeout: 3000 });
        r.on('response', (res) => resolve(res.statusCode === 200));
        r.on('error', () => resolve(false));
      })
      .catch(() => resolve(false));
  });
}

/**
 * Terminate the dev server and everything it spawned.
 *
 * Observe process identities from launch and wait for bounded tree cleanup.
 * Vite is a grandchild of pnpm; a launcher's exit alone does not prove the
 * server has stopped or released its port.
 */
export async function stopServer(child) {
  if (child) await serverCleanup.get(child)?.();
}
