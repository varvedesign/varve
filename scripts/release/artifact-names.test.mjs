#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  legacyLinuxAppImageFilename,
  linuxAppImageCandidates,
  releaseArtifactFilename,
} from './artifact-names.mjs';

assert.equal(
  releaseArtifactFilename({
    product: 'Varve',
    version: '0.5.2',
    os: 'linux',
    arch: 'x86_64',
    format: 'appimage',
  }),
  'Varve-0.5.2-x86_64.AppImage',
);
assert.equal(
  releaseArtifactFilename({
    product: 'Varve',
    version: '0.5.2',
    os: 'linux',
    arch: 'aarch64',
    format: 'appimage',
  }),
  'Varve-0.5.2-aarch64.AppImage',
);
assert.doesNotMatch(
  releaseArtifactFilename({
    version: '0.5.2',
    os: 'linux',
    arch: 'x86_64',
    format: 'appimage',
  }),
  /linux/,
);

assert.equal(
  releaseArtifactFilename({
    version: '0.5.2',
    os: 'linux',
    arch: 'x86_64',
    format: 'deb',
  }),
  'Varve-0.5.2-linux-x86_64.deb',
);
assert.equal(
  releaseArtifactFilename({
    version: '0.5.2',
    os: 'windows',
    arch: 'x86_64',
    format: 'nsis',
  }),
  'Varve-0.5.2-windows-x86_64.exe',
);

assert.equal(
  legacyLinuxAppImageFilename({ version: '0.5.1', arch: 'x86_64' }),
  'Varve-0.5.1-linux-x86_64.AppImage',
);
assert.deepEqual(linuxAppImageCandidates({ version: '0.5.2', arch: 'x86_64' }), [
  'Varve-0.5.2-x86_64.AppImage',
  'Varve-0.5.2-linux-x86_64.AppImage',
]);

console.log('artifact-names tests passed');
