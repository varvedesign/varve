#!/usr/bin/env node
/** Regression tests for staged-only file-size validation (pre-commit). */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./audit-file-size.mjs', import.meta.url));

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function sourceLines(count) {
  return Array.from({ length: count }, (_, index) => '// line ' + (index + 1)).join('\n') + '\n';
}

function makeRepo(lines = 20) {
  const repo = mkdtempSync(join(tmpdir(), 'file-size-staged-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'fixture@example.invalid']);
  git(repo, ['config', 'user.name', 'Fixture']);
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'file.ts'), sourceLines(lines));
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'initial']);
  return repo;
}

function run(root, args = []) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output: stdout };
  } catch (error) {
    return { status: error.status ?? 1, output: (error.stdout ?? '') + (error.stderr ?? '') };
  }
}

test('staged over-cap files fail; untracked worktree-only growth does not', () => {
  const repo = makeRepo();
  try {
    writeFileSync(join(repo, 'src', 'wip.ts'), sourceLines(500));
    const untrackedOnly = run(repo, ['--staged']);
    assert.equal(untrackedOnly.status, 0, untrackedOnly.output);
    assert.match(untrackedOnly.output, /staged\) OK: 0 staged source file/);

    git(repo, ['add', 'src/wip.ts']);
    const staged = run(repo, ['--staged']);
    assert.equal(staged.status, 1, staged.output);
    assert.match(staged.output, /NEW\s+src\/wip\.ts/);

    git(repo, ['reset', '-q', 'src/wip.ts']);
    assert.equal(run(repo, ['--staged']).status, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('staged growth of a frozen file fails, using staged content not worktree content', () => {
  const repo = makeRepo(900);
  try {
    assert.equal(run(repo, ['--update']).status, 0);
    const baseline = JSON.parse(readFileSync(join(repo, '.file-size-baseline.json'), 'utf8'));
    assert.equal(baseline.files['src/file.ts'], 900);

    writeFileSync(join(repo, 'src', 'file.ts'), sourceLines(950));
    git(repo, ['add', 'src/file.ts']);
    const staged = run(repo, ['--staged']);
    assert.equal(staged.status, 1, staged.output);
    assert.match(staged.output, /GREW\s+src\/file\.ts.*\+50 over frozen baseline 900/);

    const full = run(repo);
    assert.equal(full.status, 1, full.output);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('staged mode rejects incompatible combinations and non-git directories', () => {
  const repo = makeRepo();
  try {
    assert.equal(run(repo, ['--staged', '--update']).status, 2);
    assert.equal(run(repo, ['--staged', '--report']).status, 2);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
  const dir = mkdtempSync(join(tmpdir(), 'file-size-staged-plain-'));
  try {
    assert.equal(run(dir, ['--staged']).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
