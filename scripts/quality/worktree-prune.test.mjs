#!/usr/bin/env node
/** Regression tests for safe worktree pruning. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { pruneWorktrees } from './worktree-prune.mjs';
import { inspectWorktrees } from './worktree-status.mjs';

const SCRIPT = fileURLToPath(new URL('./worktree-prune.mjs', import.meta.url));

function git(cwd, args, env = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
}

function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'worktree-prune-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'fixture@example.invalid']);
  git(repo, ['config', 'user.name', 'Fixture']);
  writeFileSync(join(repo, 'README.md'), '# fixture\n');
  writeFileSync(join(repo, '.gitignore'), '.worktrees/\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'initial']);
  return repo;
}

function oldDate(daysAgo) {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString();
}

function addWorktree(repo, name, branch) {
  const path = join(repo, '.worktrees', name);
  git(repo, ['worktree', 'add', '-q', path, '-b', branch]);
  return path;
}

function commitFile(cwd, file, content, { daysAgo } = {}) {
  writeFileSync(join(cwd, file), content);
  git(cwd, ['add', '-A']);
  const env =
    daysAgo === undefined
      ? {}
      : { GIT_AUTHOR_DATE: oldDate(daysAgo), GIT_COMMITTER_DATE: oldDate(daysAgo) };
  git(cwd, ['commit', '-qm', 'fixture change'], env);
}

function makeFixture() {
  const repo = makeRepo();
  const stale = addWorktree(repo, 'stale', 'stale-branch');
  commitFile(stale, 'old.txt', 'old work\n', { daysAgo: 40 });
  git(repo, ['merge', '--ff-only', 'stale-branch']);

  const dirty = addWorktree(repo, 'dirty', 'dirty-branch');
  writeFileSync(join(dirty, 'README.md'), '# dirty\n');

  const unmerged = addWorktree(repo, 'unmerged', 'unmerged-branch');
  commitFile(unmerged, 'feature.txt', 'unmerged\n');

  const externalDir = mkdtempSync(join(tmpdir(), 'worktree-prune-ext-'));
  const externalPath = join(externalDir, 'wt');
  git(repo, ['worktree', 'add', '-q', externalPath, '-b', 'external-branch']);
  return { repo, stale, dirty, unmerged, externalPath, externalDir };
}

test('dry run lists only the stale merged worktree and removes nothing', () => {
  const { repo, stale, dirty, unmerged, externalPath, externalDir } = makeFixture();
  try {
    const result = pruneWorktrees({ root: repo, apply: false, minAgeDays: 14 });
    assert.equal(result.code, 0);
    assert.deepEqual(
      result.candidates.map((entry) => entry.path),
      [stale],
    );
    assert.ok(existsSync(stale));
    assert.ok(existsSync(dirty));
    assert.ok(existsSync(unmerged));
    assert.ok(existsSync(externalPath));
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(externalDir, { recursive: true, force: true });
  }
});

test('--apply removes only clean merged repo-local worktrees', () => {
  const { repo, stale, dirty, unmerged, externalPath, externalDir } = makeFixture();
  try {
    const result = pruneWorktrees({ root: repo, apply: true, minAgeDays: 14 });
    assert.equal(result.code, 0, JSON.stringify(result.failed));
    assert.ok(!existsSync(stale), 'stale worktree should be removed');
    assert.ok(existsSync(dirty), 'dirty worktree must remain');
    assert.ok(existsSync(unmerged), 'unmerged worktree must remain');
    assert.ok(existsSync(externalPath), 'external worktree must remain');
    assert.ok(existsSync(repo), 'main checkout must remain');
    const after = inspectWorktrees({ root: repo, minAgeDays: 14 });
    assert.ok(!after.worktrees.some((entry) => entry.path === stale));
    assert.equal(after.worktrees.filter((entry) => entry.kind === 'current').length, 1);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(externalDir, { recursive: true, force: true });
  }
});

test('CLI argument handling and non-git failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worktree-prune-plain-'));
  try {
    assert.throws(() =>
      execFileSync(process.execPath, [SCRIPT, '--apply'], { cwd: dir, stdio: 'ignore' }),
    );
    assert.throws(() =>
      execFileSync(process.execPath, [SCRIPT, '--bogus'], { cwd: dir, stdio: 'ignore' }),
    );
    const help = execFileSync(process.execPath, [SCRIPT, '--help'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.match(help, /Dry run by default/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
