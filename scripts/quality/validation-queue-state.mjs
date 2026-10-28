#!/usr/bin/env node

/**
 * Machine-wide admission state for the local validation queue.
 *
 * Local agents share one workstation. Heavy validation (cargo check, full
 * vitest, builds) must not run concurrently, and light validation (tsc,
 * audits, focused specs) should not stampede the CPU either. This module owns
 * the admission primitives only: process identity, stale-safe lock records,
 * shared/exclusive admission, waiters, and the memory floor for heavy runs.
 *
 * The queue is process-local CLI state, not a daemon: locks are files under
 * the runtime directory and receipts are files under the cache directory.
 * A dedicated runner would add a high-availability and command-execution
 * surface for no benefit on a single workstation; the durable unit here is
 * the lock record plus the receipt ledger, exactly like the heavy-task lease.
 *
 * Runtime:  $XDG_RUNTIME_DIR|/tmp/varve-validation-queue/
 * Cache:    $XDG_CACHE_HOME|~/.cache/varve/validation-queue/
 *
 * Environment overrides:
 *   VARVE_VALIDATION_QUEUE_TIMEOUT_MS   max wait for admission (default 45 min)
 *   VARVE_VALIDATION_QUEUE_POLL_MS      admission poll cadence (default 1 s)
 *   VARVE_VALIDATION_QUEUE_SHARED_SLOTS light-lane concurrency (default cpus/2, 1..4)
 *   VARVE_LEASE_MIN_MEM_MB              heavy-lane memory floor (default 1536)
 */

import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { cpus, freemem, homedir, platform, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';

export const QUEUE_SCHEMA = 3;
export const ACTIVE_ENV = 'VARVE_VALIDATION_QUEUE_ACTIVE';

const DEFAULT_TIMEOUT_MS = 45 * 60 * 1000;
const DEFAULT_POLL_MS = 1000;
const MIN_MEM_MB = Number(process.env.VARVE_LEASE_MIN_MEM_MB ?? 1536);
const WAIT_LOG_MS = 15000;
// Process identity is captured by the OS; the number is only used to keep the
// queue records self-describing.
export const QUEUE_VERSION = '2026-10-28.validation-queue.v1';

export function queueRuntimeDirectory() {
  const base = process.env.XDG_RUNTIME_DIR || tmpdir();
  return process.env.VARVE_VALIDATION_QUEUE_RUNTIME_DIR || join(base, 'varve-validation-queue');
}

export function queueCacheDirectory() {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return process.env.VARVE_VALIDATION_QUEUE_CACHE_DIR || join(base, 'varve', 'validation-queue');
}

export function sharedSlots() {
  const override = Number(process.env.VARVE_VALIDATION_QUEUE_SHARED_SLOTS);
  if (Number.isSafeInteger(override) && override > 0) return Math.min(override, 8);
  const count = cpus().length || 2;
  return Math.min(4, Math.max(1, Math.floor(count / 2)));
}

export function admissionTimeoutMs() {
  const override = Number(process.env.VARVE_VALIDATION_QUEUE_TIMEOUT_MS);
  return Number.isSafeInteger(override) && override > 0 ? override : DEFAULT_TIMEOUT_MS;
}

function pollMs() {
  const override = Number(process.env.VARVE_VALIDATION_QUEUE_POLL_MS);
  return Number.isSafeInteger(override) && override > 0 ? override : DEFAULT_POLL_MS;
}

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function processIdentity(pid) {
  try {
    if (platform() === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat
        .slice(stat.lastIndexOf(')') + 2)
        .trim()
        .split(/\s+/);
      return { identity: fields[19] ?? null, zombie: fields[0] === 'Z' };
    }
    return { identity: null, zombie: false };
  } catch {
    return null;
  }
}

function recordLive(record) {
  if (!record || record.schema !== QUEUE_SCHEMA || !Number.isSafeInteger(record.pid)) return false;
  if (!pidAlive(record.pid)) return false;
  if (record.identity === null || record.identity === undefined) return true;
  const current = processIdentity(record.pid);
  return Boolean(current && !current.zombie && current.identity === record.identity);
}

function readRecord(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Throwing here is deliberate: corrupt metadata must never license a second
 * owner of the same slot (the heavy-task lease makes the same choice). */
function reclaimIfStale(path) {
  const record = readRecord(path);
  if (!record)
    return { waiting: { pid: 'unknown', label: 'invalid queue metadata', corrupt: true } };
  if (recordLive(record)) return { waiting: record };
  console.warn(
    `validation-queue: reclaiming stale lock (pid ${record.pid}, label ${record.label ?? 'unknown'})`,
  );
  unlinkSync(path);
  return null;
}

function lockPath(kind, index = 0) {
  const dir = queueRuntimeDirectory();
  return kind === 'exclusive' ? join(dir, 'exclusive.lock') : join(dir, `shared-${index}.lock`);
}

function createRecord({ kind, label, cwd }) {
  return {
    schema: QUEUE_SCHEMA,
    queueVersion: QUEUE_VERSION,
    queueId: randomUUID(),
    pid: process.pid,
    identity: processIdentity(process.pid)?.identity ?? null,
    class: kind,
    label,
    cwd,
    hostname: homedir(),
    startedAt: Date.now(),
  };
}

function tryClaim(path, record) {
  try {
    writeFileSync(path, JSON.stringify(record, null, 2), { flag: 'wx' });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

/** Acquire one admission slot. Waits are reported through onWait so the CLI
 * can print queue position without this module knowing about output. */
export async function acquire({
  kind = 'shared',
  label,
  cwd = process.cwd(),
  timeoutMs = admissionTimeoutMs(),
  onWait,
} = {}) {
  if (kind !== 'shared' && kind !== 'exclusive') {
    throw Object.assign(new Error(`validation-queue: unknown class ${JSON.stringify(kind)}`), {
      exitCode: 2,
    });
  }
  mkdirSync(queueRuntimeDirectory(), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  const record = createRecord({ kind, label, cwd });
  let lastWaitLog = 0;
  while (Date.now() < deadline) {
    const candidates =
      kind === 'exclusive'
        ? [lockPath('exclusive')]
        : Array.from({ length: sharedSlots() }, (_, i) => lockPath('shared', i));
    let blocked = null;
    for (const path of candidates) {
      if (!existsSync(path)) {
        if (tryClaim(path, record)) return { record, path };
        blocked = readRecord(path);
        break;
      }
      const result = reclaimIfStale(path);
      if (result) {
        blocked = result.waiting;
        break;
      }
      blocked = null; // reclaimed; retry this slot immediately
    }
    if (blocked) {
      const now = Date.now();
      if (now - lastWaitLog >= WAIT_LOG_MS) {
        lastWaitLog = now;
        onWait?.(blocked);
      }
    }
    await pause(Math.min(pollMs(), Math.max(1, deadline - Date.now())));
  }
  throw Object.assign(
    new Error(
      `validation-queue: deadline reached after ${Math.round(timeoutMs / 1000)}s waiting for a ${kind} slot`,
    ),
    { exitCode: 1 },
  );
}

export function release({ record, path }) {
  try {
    const current = readRecord(path);
    if (current?.queueId === record.queueId) unlinkSync(path);
  } catch {
    // Losing a lease we no longer own must not fail the command.
  }
}

function waitersDirectory() {
  return join(queueRuntimeDirectory(), 'waiters');
}

export function registerWaiter({ label, kind, cwd = process.cwd() }) {
  const id = randomUUID();
  try {
    mkdirSync(waitersDirectory(), { recursive: true });
    writeFileSync(
      join(waitersDirectory(), `${id}.json`),
      JSON.stringify({
        schema: QUEUE_SCHEMA,
        queueId: id,
        pid: process.pid,
        identity: processIdentity(process.pid)?.identity ?? null,
        label,
        class: kind,
        cwd,
        startedAt: Date.now(),
      }),
    );
  } catch {
    // A missing waiter entry only weakens status output, never admission.
  }
  return id;
}

export function unregisterWaiter(id) {
  try {
    unlinkSync(join(waitersDirectory(), `${id}.json`));
  } catch {
    // Already gone.
  }
}

function liveWaiters() {
  try {
    return readdirSync(waitersDirectory())
      .map((name) => readRecord(join(waitersDirectory(), name)))
      .filter(Boolean)
      .filter((waiter) => {
        if (!Number.isSafeInteger(waiter.pid) || !pidAlive(waiter.pid)) return false;
        return true;
      });
  } catch {
    return [];
  }
}

function liveHolders() {
  const holders = [];
  const exclusive = lockPath('exclusive');
  const record = existsSync(exclusive) ? readRecord(exclusive) : null;
  if (record && recordLive(record)) holders.push(record);
  for (let i = 0; i < sharedSlots(); i += 1) {
    const path = lockPath('shared', i);
    const shared = existsSync(path) ? readRecord(path) : null;
    if (shared && recordLive(shared)) holders.push(shared);
  }
  return holders;
}

export function queueStatus() {
  const holders = liveHolders();
  return {
    schema: QUEUE_SCHEMA,
    runtimeDirectory: queueRuntimeDirectory(),
    cacheDirectory: queueCacheDirectory(),
    sharedSlots: sharedSlots(),
    sharedBusy: holders.filter((holder) => holder.class === 'shared').length,
    exclusiveBusy: holders.some((holder) => holder.class === 'exclusive'),
    holders,
    waiters: liveWaiters(),
  };
}

function memAvailableMB() {
  if (platform() === 'linux') {
    try {
      const match = readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)\s*kB/m);
      if (match) return Math.round(Number(match[1]) / 1024);
    } catch {
      // fall through
    }
  }
  return Math.round(freemem() / (1024 * 1024));
}

/** Heavy runs wait for real memory headroom, not just a free slot: a free
 * exclusive slot says nothing about an unwrapped Chromium elsewhere. */
export async function waitForMemoryHeadroom({
  label,
  timeoutMs = admissionTimeoutMs(),
  onWait,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let warned = false;
  while (memAvailableMB() < MIN_MEM_MB) {
    if (Date.now() >= deadline) {
      throw Object.assign(
        new Error(
          `validation-queue: memory still under ${MIN_MEM_MB}MB after ${Math.round(timeoutMs / 1000)}s; ${label} not launched`,
        ),
        { exitCode: 1 },
      );
    }
    if (!warned) {
      console.warn(
        `validation-queue: ${memAvailableMB()}MB available, below the ${MIN_MEM_MB}MB floor for ${label} — waiting`,
      );
      warned = true;
    }
    onWait?.({ label: 'memory headroom', pid: '-' });
    await pause(2500);
  }
}

export function formatAge(startedAt, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`;
}

export function queueHostname() {
  return homedir();
}

export function totalMemoryMB() {
  return Math.round(totalmem() / (1024 * 1024));
}
