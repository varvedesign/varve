#!/usr/bin/env node
import assert from 'node:assert/strict';
import { pinRecord, sha256, verifyPluginBytes } from './ensure-linuxdeploy-plugin-gtk.mjs';

const pin = pinRecord();
assert.match(pin.commit, /^[0-9a-f]{40}$/, 'pin must name a full commit SHA');
assert.doesNotMatch(pin.url, /\/master\//, 'plugin must not be fetched from master');
assert.ok(pin.url.includes(pin.commit), 'download URL must include the pinned commit');
assert.match(pin.sha256, /^[0-9a-f]{64}$/);
assert.equal(pin.name, 'linuxdeploy-plugin-gtk.sh');
assert.equal(pin.repository, 'tauri-apps/linuxdeploy-plugin-gtk');

const patched = Buffer.from('#!/bin/sh\nsed "s|/usr|././|g"\n');
assert.throws(() => verifyPluginBytes(patched), /does not match pin/);
assert.throws(
  () =>
    verifyPluginBytes(Buffer.from('no patch here'), {
      ...pin,
      sha256: sha256(Buffer.from('no patch here')),
    }),
  /path patch/,
);
assert.equal(verifyPluginBytes(patched, { ...pin, sha256: sha256(patched) }), sha256(patched));

console.log('ensure-linuxdeploy-plugin-gtk tests passed');
