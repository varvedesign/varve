#!/usr/bin/env node

/** Black-box coverage for the shared local validation queue: execution,
 * receipt reuse rules (clean tree only), failure exit codes, and bypasses.
 * Every scenario gets its own runtime/cache directories; no test touches the
 * developer's real queue state. */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('./validation-queue.mjs', import.meta.url));
const NODE = process.execPath;

function baseEnv() {
  // CI=true would make every child bypass admission; tests exercise admission.
  const env = { ...process.env };
  delete env.CI;
  delete env.VARVE_VALIDATION_QUEUE_ACTIVE;
  delete env.VARVE_HEAVY_TASK_PARALLELISM;
  delete env.VARVE_VALIDATION_QUEUE;
  env.VARVE_VALIDATION_QUEUE_POLL_MS = '50';
  env.VARVE_VALIDATION_QUEUE_TIMEOUT_MS = '20000';
  env.VARVE_LEASE_MIN_MEM_MB = '1';
  return env;
}

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'varve-queue-test-'));
  const runtime = join(root, 'runtime');
  const cache = join(root, 'cache');
  mkdirSync(runtime, { recursive: true });
  mkdirSync(cache, { recursive: true });
  return {
    root,
    env: {
      ...baseEnv(),
      VARVE_VALIDATION_QUEUE_RUNTIME_DIR: runtime,
      VARVE_VALIDATION_QUEUE_CACHE_DIR: cache,
    },
    cache,
  };
}

function run(cwd, env, args) {
  return spawnSync(NODE, [CLI, ...args], { cwd, env, encoding: 'utf8', timeout: 60000 });
}

function runQueued(cwd, env, label, commandArgs, extra = []) {
  return run(cwd, env, ['run', '--label', label, ...extra, '--', ...commandArgs]);
}

function git(cwd, ...args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...baseEnv(),
      GIT_AUTHOR_NAME: 'Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    },
  });
  assert.equal(result.status, 0, result.stderr);
}

function cleanRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'varve-queue-repo-'));
  git(dir, 'init', '-q');
  writeFileSync(join(dir, 'tracked.txt'), 'clean\n');
  git(dir, 'add', 'tracked.txt');
  git(dir, 'commit', '-qm', 'fixture');
  return dir;
}

function markerCommand(marker) {
  return [NODE, '-e', `require('node:fs').appendFileSync(${JSON.stringify(marker)}, 'x')`];
}

function markerCount(marker) {
  return existsSync(marker) ? readFileSync(marker, 'utf8').length : 0;
}

function receiptFiles(cache) {
  const dir = join(cache, 'receipts');
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')) : [];
}

test('a clean-tree run executes, records a passed receipt, and reuses it', () => {
  const box = sandbox();
  const repo = cleanRepo();
  const marker = join(box.root, 'marker');
  const command = markerCommand(marker);

  const first = runQueued(repo, box.env, 'unit-check', command);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /running unit-check/);
  assert.equal(markerCount(marker), 1);
  assert.equal(receiptFiles(box.cache).length, 1);

  const history = run(repo, box.env, ['history', '--json']);
  assert.equal(history.status, 0, history.stderr);
  const receipts = JSON.parse(history.stdout);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].label, 'unit-check');
  assert.equal(receipts[0].outcome, 'passed');
  assert.equal(receipts[0].clean, true);

  const second = runQueued(repo, box.env, 'unit-check', command);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /REUSED passed receipt/);
  assert.equal(markerCount(marker), 1, 'reused receipt must not execute the command');

  const forced = runQueued(repo, box.env, 'unit-check', command, ['--no-cache']);
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(markerCount(marker), 2, '--no-cache must execute the command');
});

test('dirty trees never reuse a receipt', () => {
  const box = sandbox();
  const repo = cleanRepo();
  const marker = join(box.root, 'marker');
  const command = markerCommand(marker);

  assert.equal(runQueued(repo, box.env, 'dirty-check', command).status, 0);
  writeFileSync(join(repo, 'tracked.txt'), 'dirty\n');

  const second = runQueued(repo, box.env, 'dirty-check', command);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /working tree is dirty/);
  assert.equal(markerCount(marker), 2);

  const receipts = JSON.parse(run(repo, box.env, ['history', '--json']).stdout);
  assert.equal(receipts[0].clean, false);
  assert.ok(receipts[0].dirtyHash, 'dirty receipts record a dirty-tree hash as evidence');
});

test('a failing command keeps its exit code and is never served from cache', () => {
  const box = sandbox();
  const repo = cleanRepo();
  const command = [NODE, '-e', 'process.exit(7)'];

  const first = runQueued(repo, box.env, 'failing-check', command);
  assert.equal(first.status, 7, first.stderr);
  const receipts = JSON.parse(run(repo, box.env, ['history', '--json']).stdout);
  assert.equal(receipts[0].outcome, 'failed');
  assert.equal(receipts[0].exitCode, 7);

  const second = runQueued(repo, box.env, 'failing-check', command);
  assert.equal(second.status, 7);
  assert.match(second.stdout, /running failing-check/);
  assert.doesNotMatch(second.stdout, /REUSED/);
});

test('CI and nested invocations bypass admission and write no receipts', () => {
  const box = sandbox();
  const repo = cleanRepo();
  const marker = join(box.root, 'marker');
  const command = markerCommand(marker);

  const ci = runQueued(repo, { ...box.env, CI: 'true' }, 'ci-bypass', command);
  assert.equal(ci.status, 0, ci.stderr);
  assert.match(ci.stdout, /bypassed \(CI=true\)/);
  assert.equal(receiptFiles(box.cache).length, 0);

  const nested = runQueued(
    repo,
    { ...box.env, VARVE_VALIDATION_QUEUE_ACTIVE: '1' },
    'nested-bypass',
    command,
  );
  assert.equal(nested.status, 0, nested.stderr);
  assert.match(nested.stdout, /bypassed \(nested queue invocation\)/);
  assert.equal(receiptFiles(box.cache).length, 0);
  assert.equal(markerCount(marker), 2);
});

test('a non-git directory still runs the command, without receipts', () => {
  const box = sandbox();
  const dir = mkdtempSync(join(tmpdir(), 'varve-queue-plain-'));
  const marker = join(box.root, 'marker');
  const result = runQueued(dir, box.env, 'plain-check', markerCommand(marker));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout + result.stderr, /not a git checkout/);
  assert.equal(receiptFiles(box.cache).length, 0);
  assert.equal(markerCount(marker), 1);
});
