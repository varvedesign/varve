#!/usr/bin/env node

/**
 * Advisory path-claim ledger: records, overlap visibility, TTL cleanup,
 * repository isolation, and the "never blocks" contract. Every test uses a
 * disposable git fixture and a private claims directory.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { pathOverlap } from './path-claims-state.mjs';

const CLI = fileURLToPath(new URL('./path-claims.mjs', import.meta.url));
const NODE = process.execPath;

function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function makeRepo(label = 'repo') {
  const root = mkdtempSync(join(tmpdir(), `varve-claims-${label}-`));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'user.name', 'Fixture');
  mkdirSync(join(root, 'packages', 'engine', 'src'), { recursive: true });
  writeFileSync(join(root, 'packages', 'engine', 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(root, 'packages', 'engine', 'src', 'b.ts'), 'export const b = 1;\n');
  return root;
}

function makeState() {
  return mkdtempSync(join(tmpdir(), 'varve-claims-state-'));
}

function run(cwd, state, args) {
  return spawnSync(NODE, [CLI, ...args], {
    cwd,
    env: { ...process.env, VARVE_PATH_CLAIMS_DIR: state },
    encoding: 'utf8',
    timeout: 20000,
  });
}

function ok(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function json(result) {
  return JSON.parse(ok(result).stdout);
}

function claim(repo, state, task, ...paths) {
  const args = ['claim', '--task', task];
  for (const path of paths) args.push('--path', path);
  args.push('--json');
  return json(run(repo, state, args));
}

test('claim records sorted repo-relative paths and lists it active', () => {
  const repo = makeRepo();
  const state = makeState();
  const body = claim(
    repo,
    state,
    'split replay-fill',
    './packages/engine/src/a.ts',
    'packages/engine/src',
  );
  assert.equal(body.advisory, true);
  assert.deepEqual(body.claim.paths, ['packages/engine/src', 'packages/engine/src/a.ts']);
  assert.equal(body.overlaps.length, 0);

  const list = json(run(repo, state, ['list', '--json']));
  assert.equal(list.claims.length, 1);
  assert.equal(list.claims[0].state, 'active');
  assert.equal(list.claims[0].task, 'split replay-fill');
});

test('overlapping claims are reported but never block', () => {
  const repo = makeRepo();
  const state = makeState();
  claim(repo, state, 'first task', 'packages/engine/src');

  const second = ok(
    run(repo, state, ['claim', '--task', 'second task', '--path', 'packages/engine/src/a.ts']),
  );
  assert.match(second.stdout, /advisory: 1 active claim\(s\) overlap/);
  assert.match(second.stdout, /nothing was blocked/);

  const check = ok(run(repo, state, ['check', '--path', 'packages/engine/src/a.ts']));
  assert.match(check.stdout, /nothing is blocked/);
});

test('re-claiming the same task refreshes instead of accumulating', () => {
  const repo = makeRepo();
  const state = makeState();
  claim(repo, state, 'same task', 'packages/engine/src/a.ts');
  const second = claim(repo, state, 'same task', 'packages/engine/src/b.ts');
  assert.equal(second.replaced.length, 1);
  assert.equal(second.overlaps.length, 0);

  const list = json(run(repo, state, ['list', '--all', '--json']));
  assert.equal(list.claims.length, 1);
  assert.deepEqual(list.claims[0].paths, ['packages/engine/src/b.ts']);
});

test('release works by task label and by claim id', () => {
  const repo = makeRepo();
  const state = makeState();
  claim(repo, state, 'release by task', 'packages/engine/src/a.ts');
  ok(run(repo, state, ['release', '--task', 'release by task']));
  assert.equal(json(run(repo, state, ['list', '--json'])).claims.length, 0);

  const byId = claim(repo, state, 'release by id', 'packages/engine/src/b.ts');
  ok(run(repo, state, ['release', byId.claim.id]));
  assert.equal(json(run(repo, state, ['list', '--json'])).claims.length, 0);
});

test('paths outside the repository are rejected', () => {
  const repo = makeRepo();
  const state = makeState();
  const result = run(repo, state, ['claim', '--task', 'escape', '--path', '../outside']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /outside the repository/);
});

test('claims do not leak across repository common directories', () => {
  const repoA = makeRepo('a');
  const repoB = makeRepo('b');
  const state = makeState();
  claim(repoA, state, 'repo a task', 'packages/engine/src/a.ts');

  const checkB = json(run(repoB, state, ['check', '--path', 'packages/engine/src/a.ts', '--json']));
  assert.equal(checkB.overlaps.length, 0);
  const listB = json(run(repoB, state, ['list', '--repo', '--json']));
  assert.equal(listB.claims.length, 0);
});

test('expired claims leave the active list and prune removes them', async () => {
  const repo = makeRepo();
  const state = makeState();
  claim(repo, state, 'short lease', 'packages/engine/src/a.ts');
  // Replace with a ~60 ms lease, then wait for it to expire.
  ok(
    run(repo, state, [
      'claim',
      '--task',
      'short lease',
      '--path',
      'packages/engine/src/a.ts',
      '--ttl-minutes',
      '0.001',
    ]),
  );
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.equal(json(run(repo, state, ['list', '--json'])).claims.length, 0);
  const all = json(run(repo, state, ['list', '--all', '--json']));
  assert.equal(all.claims.length, 1);
  assert.equal(all.claims[0].state, 'expired');

  const pruned = json(run(repo, state, ['prune', '--json']));
  assert.equal(pruned.removed.length, 1);
  assert.equal(json(run(repo, state, ['list', '--all', '--json'])).claims.length, 0);
});

test('corrupt claim files are tolerated and never block', () => {
  const repo = makeRepo();
  const state = makeState();
  mkdirSync(state, { recursive: true });
  const corrupt = join(state, 'claim-corrupt.json');
  writeFileSync(corrupt, '{not json\n');

  const list = json(run(repo, state, ['list', '--json']));
  assert.equal(list.claims.length, 0);
  assert.equal(list.invalid.length, 1);

  ok(run(repo, state, ['prune']));
  assert.equal(existsSync(corrupt), true);
});

test('overlap is segment-aware, not a raw prefix', () => {
  assert.equal(pathOverlap('packages/engine/src', 'packages/engine/src/a.ts'), true);
  assert.equal(pathOverlap('packages/engine/src/a.ts', 'packages/engine/src'), true);
  assert.equal(pathOverlap('packages/engine/src', 'packages/engine/src2'), false);
});
