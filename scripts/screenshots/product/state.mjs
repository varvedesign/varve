/**
 * Run-wide state shared by the manifest sync and the capture runner.
 */
import { computeSourceIdentity, manifestBytesAtStart } from './provenance.mjs';

export const manifest = JSON.parse(manifestBytesAtStart.toString('utf8'));
export const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
export const sourceIdentity = computeSourceIdentity();

export let failures = 0;
export const skippedThisRun = [];

/** Record one capture or normalize failure (shared by both modes). */
export function recordFailure() {
  failures += 1;
}
