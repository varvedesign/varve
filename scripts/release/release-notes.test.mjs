#!/usr/bin/env node
/**
 * Confirm release-notes.mjs still writes notes when launched through a
 * symlink. A URL-only entrypoint check treats the link as a different file
 * and exits 0 without writing anything.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./release-notes.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'varve-release-notes-'));
const link = join(dir, 'release-notes.mjs');
const manifestPath = join(dir, 'manifest.json');
const outPath = join(dir, 'RELEASE_NOTES.md');

writeFileSync(
  manifestPath,
  JSON.stringify({
    version: '0.5.1',
    signed: false,
    updater: false,
    artifacts: [
      {
        os: 'linux',
        arch: 'x86_64',
        filename: 'Varve-0.5.1-x86_64.AppImage',
        format: 'appimage',
        size: '1 MB',
        sha256: 'a'.repeat(64),
      },
    ],
  }),
);
symlinkSync(script, link);

try {
  const stdout = execFileSync(
    process.execPath,
    [link, '--version', '0.5.1', '--manifest', manifestPath, '--out', outPath],
    { encoding: 'utf8', cwd: dirname(script) },
  );
  const notes = readFileSync(outPath, 'utf8');
  assert.match(stdout, /Release notes written to/);
  assert.match(notes, /^## Varve 0\.5\.1/m);
  assert.match(notes, /### Downloads/);
  assert.match(notes, /Varve-0\.5\.1-x86_64\.AppImage/);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('release-notes.test.mjs — symlink invocation writes output');
