#!/usr/bin/env node
/**
 * Guard the AppImageHub-shaped smoke: offline, no host WebKitGTK, xvfb,
 * and a window check. Does not launch a container.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const script = readFileSync(join(root, 'scripts/release/smoke-appimage-self-contained.sh'), 'utf8');
const containerfile = readFileSync(
  join(root, 'scripts/release/appimage-smoke.Containerfile'),
  'utf8',
);
const workflow = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8');

assert.match(script, /--network none/);
assert.match(script, /APPIMAGE_EXTRACT_AND_RUN=1/);
assert.match(script, /xvfb-run/);
assert.match(script, /WINDOW_OK/);
assert.match(script, /libwebkit2gtk-4\.1\.so\.0: cannot open/);
assert.match(script, /:ro/);
assert.doesNotMatch(
  script,
  /chmod \+x \/opt\/Varve\.AppImage/,
  'ro bind-mount cannot chmod the AppImage inside the container',
);
assert.doesNotMatch(script, /apt-get install[^\n]*libwebkit2gtk/);

assert.match(containerfile, /FROM docker\.io\/library\/ubuntu:22\.04/);
assert.match(containerfile, /xvfb/);
assert.match(containerfile, /libegl1/);
assert.match(containerfile, /libx11-6/);
assert.match(containerfile, /libxrandr2/);
assert.match(containerfile, /libnss3/);
assert.doesNotMatch(containerfile, /libwebkit2gtk-4/);
assert.match(containerfile, /libwebkit2gtk must not be installed/);
assert.match(containerfile, /libgtk-3-0 must not be installed/);

assert.match(workflow, /smoke-appimage-self-contained\.sh/);
assert.match(workflow, /Launch smoke \(AppImage self-contained, offline\)/);

console.log('smoke-appimage-self-contained tests passed');
