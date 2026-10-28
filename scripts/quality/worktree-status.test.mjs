#!/usr/bin/env node
/** Regression tests for the cross-worktree status diagnostics. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inspectWorktrees, listWorktrees } from './worktree-status.mjs';

const SCRIPT = fileURLToPath(new URL('./worktree-status.mjs', import.meta.url));

function git(cwd, args, env = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
}

function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'worktree-status-'));
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

test('classifies current, stale, dirty, unmerged and external worktrees', () => {
  process.env.VARVE_VALIDATION_QUEUE_RUNTIME_DIR = mkdtempSync(
    join(tmpdir(), 'worktree-status-queue-'),
  );
  const repo = makeRepo();
  try {
    const stale = addWorktree(repo, 'stale', 'stale-branch');
    commitFile(stale, 'stale.txt', 'old work\n', { daysAgo: 30 });
    git(repo, ['merge', '--ff-only', 'stale-branch']);

    const dirty = addWorktree(repo, 'dirty', 'dirty-branch');
    writeFileSync(join(dirty, 'README.md'), '# dirty\n');

    const unmerged = addWorktree(repo, 'unmerged', 'unmerged-branch');
    commitFile(unmerged, 'feature.txt', 'unmerged work\n');

    const externalPath = join(mkdtempSync(join(tmpdir(), 'worktree-status-ext-')), 'wt');
    git(repo, ['worktree', 'add', '-q', externalPath, '-b', 'external-branch']);

    const report = inspectWorktrees({ root: repo, minAgeDays: 14 });
    const byKind = report.worktrees.map((entry) => entry.kind).sort();
    assert.deepEqual(byKind, ['current', 'dirty', 'external', 'stale', 'unmerged']);
    const staleEntry = report.worktrees.find((entry) => entry.kind === 'stale');
    assert.equal(staleEntry.stale, true);
    assert.ok(staleEntry.ageDays >= 14);
    assert.equal(staleEntry.merged, true);
    const externalEntry = report.worktrees.find((entry) => entry.kind === 'external');
    assert.equal(externalEntry.external, true);
    assert.equal(report.summary.stale, 1);
    assert.equal(report.summary.dirty, 1);
    assert.equal(report.summary.external, 1);
    assert.ok(listWorktrees(repo).length >= 5);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('CLI JSON output and argument handling', () => {
  const repo = makeRepo();
  try {
    const json = execFileSync(process.execPath, [SCRIPT, '--json'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const report = JSON.parse(json);
    assert.equal(report.summary.total, 1);
    assert.equal(report.worktrees[0].kind, 'current');
    const help = execFileSync(process.execPath, [SCRIPT, '--help'], {
      cwd: repo,
      encoding: 'utf8',
    });
    assert.match(help, /Usage: node scripts\/quality\/worktree-status/);
    assert.throws(() =>
      execFileSync(process.execPath, [SCRIPT, '--bogus'], { cwd: repo, stdio: 'ignore' }),
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('non-git directories fail closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worktree-status-plain-'));
  try {
    assert.throws(() =>
      execFileSync(process.execPath, [SCRIPT, '--json'], { cwd: dir, stdio: 'ignore' }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
