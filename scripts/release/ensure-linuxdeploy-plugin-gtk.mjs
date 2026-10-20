#!/usr/bin/env node
/**
 * Place a checksum-pinned linuxdeploy-plugin-gtk.sh in Tauri's tools cache.
 *
 * Tauri otherwise fetches `linuxdeploy-plugin-gtk@master` unpinned. The
 * plugin binary-patches libwebkit* (`/usr` -> `././`). A silent upstream
 * change would ship an unpatched WebKit and fail AppImageHub.
 *
 *   node scripts/release/ensure-linuxdeploy-plugin-gtk.mjs [--tools-dir ~/.cache/tauri]
 */
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PIN = JSON.parse(
  readFileSync(new URL('./linuxdeploy-plugin-gtk.pin.json', import.meta.url), 'utf8'),
);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected argument: ${argv[i]}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

export function pinRecord() {
  return PIN;
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function installedPluginPath(toolsDir) {
  return join(toolsDir, PIN.name);
}

export function verifyPluginBytes(bytes, expected = PIN) {
  const digest = sha256(bytes);
  if (digest !== expected.sha256) {
    throw new Error(
      `${expected.name} sha256 ${digest} does not match pin ${expected.sha256} ` +
        `(commit ${expected.commit})`,
    );
  }
  const text = bytes.toString('utf8');
  if (!text.includes('s|/usr|././|g') && !text.includes('s|/usr|././|')) {
    throw new Error(`${expected.name} is missing the /usr -> ././ WebKit path patch`);
  }
  return digest;
}

export async function ensureLinuxdeployPluginGtk(toolsDir) {
  mkdirSync(toolsDir, { recursive: true });
  const dest = installedPluginPath(toolsDir);
  if (existsSync(dest)) {
    verifyPluginBytes(readFileSync(dest));
    chmodSync(dest, 0o755);
    return dest;
  }
  const response = await fetch(PIN.url);
  if (!response.ok) {
    throw new Error(`Failed to download ${PIN.url}: ${response.status} ${response.statusText}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  verifyPluginBytes(bytes);
  writeFileSync(dest, bytes, { mode: 0o755 });
  chmodSync(dest, 0o755);
  return dest;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const toolsDir = resolve(
    args['tools-dir'] ?? process.env.TAURI_CACHE_DIR ?? join(homedir(), '.cache', 'tauri'),
  );
  const dest = await ensureLinuxdeployPluginGtk(toolsDir);
  process.stdout.write(
    `Pinned ${PIN.name} (${PIN.commit.slice(0, 12)}) at ${dest} sha256=${PIN.sha256}\n`,
  );
}

const isDirectRun =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
