/**
 * Hashing, source identity, atomic writes, and the manifest snapshot read at
 * startup. Shared by the manifest sync and the capture runner.
 */
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pngDimensions } from '../lib/image-analysis.mjs';
import { captureSourceIdentity } from '../producer-capture.mjs';
import { MANIFEST_PATH, ROOT } from './config.mjs';

/* ------------------------------------------------------------------ */
/* Provenance, atomic writes, and the manifest concurrency guard        */
/* ------------------------------------------------------------------ */

export function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Source identity for the capture, independent of the volatile run clock.
 *
 * `sourceRevision` is the exact commit; `sourceDirty`/`sourceDigest` describe
 * uncommitted changes to the paths that decide what a capture looks like, so a
 * capture taken from a dirty tree records which tree rather than claiming a
 * clean revision it does not have.
 */
export function computeSourceIdentity() {
  return captureSourceIdentity(ROOT);
}

export function playwrightVersion() {
  for (const p of ['playwright', 'playwright-core']) {
    try {
      return JSON.parse(readFileSync(join(ROOT, 'node_modules', p, 'package.json'), 'utf8'))
        .version;
    } catch {
      /* try the next candidate */
    }
  }
  return 'unknown';
}

/**
 * Write a file atomically: a reader (a website build, another agent) must see
 * either the previous bytes or the new bytes, never a half-written file.
 */
export function writeFileAtomicSync(path, data) {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export const manifestBytesAtStart = readFileSync(MANIFEST_PATH);
export const manifestDigestAtStart = sha256Hex(manifestBytesAtStart);

/** PNG dimensions, shared with the validator so both agree on what "valid" means. */
export function pngSize(buf) {
  return pngDimensions(buf);
}
