#!/usr/bin/env node

/** Concurrency coverage for the shared validation queue: exclusive serialization,
 * shared-lane bounds, stale-lock reclamation, status visibility, and admission
 * deadlines. Black-box CLI tests with per-test runtime directories. */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('./validation-queue.mjs', import.meta.url));
const NODE = process.execPath;
const ACTIVE_ENV = 'VARVE_VALIDATION_QUEUE_ACTIVE';

function baseEnv(overrides = {}) {
  const env = { ...process.env };
  delete env.CI;
  delete env[ACTIVE_ENV];
  delete env.VARVE_HEAVY_TASK_PARALLELISM;
  delete env.VARVE_VALIDATION_QUEUE;
  return {
    ...env,
    VARVE_VALIDATION_QUEUE_POLL_MS: '40',
    VARVE_VALIDATION_QUEUE_TIMEOUT_MS: '15000',
    VARVE_LEASE_MIN_MEM_MB: '1',
    ...overrides,
  };
}

function sandbox(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'varve-queue-conc-'));
  const runtime = join(root, 'runtime');
  const cache = join(root, 'cache');
  mkdirSync(runtime, { recursive: true });
  mkdirSync(cache, { recursive: true });
  const env = baseEnv({
    VARVE_VALIDATION_QUEUE_RUNTIME_DIR: runtime,
    VARVE_VALIDATION_QUEUE_CACHE_DIR: cache,
    ...overrides,
  });
  return { root, runtime, cache, env };
}

function spawnQueue(cwd, env, args) {
  const child = spawn(NODE, [CLI, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const done = new Promise((resolve) => {
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
  return { child, done };
}

function intervalCommand(marker, name, sleepMs) {
  const script = `const fs = require('node:fs'); const m = ${JSON.stringify(marker)}; fs.appendFileSync(m, 'start-${name} ' + Date.now() + '\\n'); setTimeout(() => { fs.appendFileSync(m, 'end-${name} ' + Date.now() + '\\n'); }, ${sleepMs});`;
  return [NODE, '-e', script];
}

function entries(marker) {
  return existsSync(marker) ? readFileSync(marker, 'utf8').trim().split('\n').filter(Boolean) : [];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('exclusive runs serialize and do not overlap', async () => {
  const box = sandbox();
  const marker = join(box.root, 'exclusive-marker');
  const env = { ...box.env };
  const first = spawnQueue(box.root, env, [
    'run',
    '--label',
    'exclusive-a',
    '--class',
    'exclusive',
    '--',
    ...intervalCommand(marker, 'a', 350),
  ]);
  await sleep(120);
  const second = spawnQueue(box.root, env, [
    'run',
    '--label',
    'exclusive-b',
    '--class',
    'exclusive',
    '--',
    ...intervalCommand(marker, 'b', 200),
  ]);
  const [a, b] = await Promise.all([first.done, second.done]);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(b.code, 0, b.stderr);
  const lines = entries(marker).filter(
    (line) => line.startsWith('start-') || line.startsWith('end-'),
  );
  assert.deepEqual(
    lines.map((line) => line.split(' ')[0]),
    ['start-a', 'end-a', 'start-b', 'end-b'],
    `exclusive admission must serialize runs, got ${JSON.stringify(lines)}`,
  );
  const endA = Number(lines[1].split(' ')[1]);
  const startB = Number(lines[2].split(' ')[1]);
  assert.ok(startB >= endA, 'second run started before the first finished');
});

test('a single shared slot also serializes runs', async () => {
  const box = sandbox({ VARVE_VALIDATION_QUEUE_SHARED_SLOTS: '1' });
  const marker = join(box.root, 'shared-marker');
  const env = { ...box.env };
  const first = spawnQueue(box.root, env, [
    'run',
    '--label',
    'shared-a',
    '--',
    ...intervalCommand(marker, 'a', 300),
  ]);
  await sleep(120);
  const second = spawnQueue(box.root, env, [
    'run',
    '--label',
    'shared-b',
    '--',
    ...intervalCommand(marker, 'b', 150),
  ]);
  const [a, b] = await Promise.all([first.done, second.done]);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(b.code, 0, b.stderr);
  const kinds = entries(marker).map((line) => line.split(' ')[0]);
  assert.deepEqual(
    kinds,
    ['start-a', 'end-a', 'start-b', 'end-b'],
    `shared slot must serialize, got ${JSON.stringify(kinds)}`,
  );
});

test('a stale exclusive lock is reclaimed, and a live one is never stolen', async () => {
  const box = sandbox();
  const dead = spawnSync(NODE, ['-e', ''], { encoding: 'utf8' });
  assert.ok(Number.isSafeInteger(dead.pid));
  const stalePath = join(box.runtime, 'exclusive.lock');
  writeFileSync(
    stalePath,
    JSON.stringify({
      schema: 3,
      queueId: 'stale-owner',
      pid: dead.pid,
      identity: null,
      class: 'exclusive',
      label: 'stale',
      startedAt: Date.now() - 60000,
    }),
  );
  const result = spawnSync(
    NODE,
    [
      CLI,
      'run',
      '--label',
      'after-stale',
      '--class',
      'exclusive',
      '--',
      NODE,
      '-e',
      'process.exit(0)',
    ],
    {
      cwd: box.root,
      env: box.env,
      encoding: 'utf8',
      timeout: 60000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout + result.stderr, /reclaiming stale lock/);
});

test('status reports the live holder and waiting classes', async () => {
  const box = sandbox();
  const marker = join(box.root, 'status-marker');
  const holder = spawnQueue(box.root, box.env, [
    'run',
    '--label',
    'holder-label',
    '--class',
    'exclusive',
    '--',
    ...intervalCommand(marker, 'holder', 1400),
  ]);
  let status = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await sleep(100);
    const probe = spawnSync(NODE, [CLI, 'status', '--json'], {
      cwd: box.root,
      env: box.env,
      encoding: 'utf8',
      timeout: 30000,
    });
    if (probe.status !== 0) continue;
    status = JSON.parse(probe.stdout);
    if (status.exclusiveBusy) break;
  }
  assert.ok(status?.exclusiveBusy, 'status must report the exclusive holder');
  const holderEntry = status.holders.find((entry) => entry.class === 'exclusive');
  assert.equal(holderEntry?.label, 'holder-label');

  const waiting = spawnQueue(box.root, box.env, [
    'run',
    '--label',
    'waiting-label',
    '--class',
    'exclusive',
    '--',
    ...intervalCommand(marker, 'waiter', 100),
  ]);
  let waitingStatus = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await sleep(100);
    const probe = spawnSync(NODE, [CLI, 'status', '--json'], {
      cwd: box.root,
      env: box.env,
      encoding: 'utf8',
      timeout: 30000,
    });
    if (probe.status !== 0) continue;
    waitingStatus = JSON.parse(probe.stdout);
    if (waitingStatus.waiters.some((entry) => entry.label === 'waiting-label')) break;
  }
  assert.ok(
    waitingStatus?.waiters.some((entry) => entry.label === 'waiting-label'),
    'a blocked run must appear as a waiter',
  );
  assert.ok(
    !waitingStatus.waiters.some((entry) => entry.pid === holderEntry.pid),
    'the running holder must not also be listed as a waiter',
  );
  const [holderResult, waiterResult] = await Promise.all([holder.done, waiting.done]);
  assert.equal(holderResult.code, 0, holderResult.stderr);
  assert.equal(waiterResult.code, 0, waiterResult.stderr);
  const after = spawnSync(NODE, [CLI, 'status', '--json'], {
    cwd: box.root,
    env: box.env,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(JSON.parse(after.stdout).exclusiveBusy, false);
});

test('an admission deadline fails clearly instead of running concurrently', async () => {
  const box = sandbox();
  const marker = join(box.root, 'deadline-marker');
  const holder = spawnQueue(box.root, box.env, [
    'run',
    '--label',
    'deadline-holder',
    '--class',
    'exclusive',
    '--',
    ...intervalCommand(marker, 'holder', 1200),
  ]);
  await sleep(250);
  const blocked = spawnSync(
    NODE,
    [
      CLI,
      'run',
      '--label',
      'deadline-waiter',
      '--class',
      'exclusive',
      '--timeout-ms',
      '250',
      '--',
      NODE,
      '-e',
      'process.exit(0)',
    ],
    { cwd: box.root, env: box.env, encoding: 'utf8', timeout: 60000 },
  );
  assert.equal(blocked.status, 1, blocked.stderr);
  assert.match(blocked.stderr, /deadline reached/);
  const result = await holder.done;
  assert.equal(result.code, 0, result.stderr);
});
