#!/usr/bin/env node

/** Operation journal tests: atomic lifecycle, retries, recovery, and redaction. */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifySyncState,
  classifyWorktreeStatus,
  commonGitDirectory,
  finishOperation,
  formatOperation,
  gitOperationState,
  listOperations,
  recoverInterruptedOperations,
  sanitizeRemoteUrl,
  startOperation,
} from './operation-history.mjs';
import { laneReceiptDirectory, receiptDirectory } from './validation-receipts.mjs';

const commonDir = mkdtempSync(join(tmpdir(), 'varve-operation-history-'));
try {
  // An explicit cwd must select that repository, not the process repository.
  // Use real Git, including a linked worktree with its own operation markers.
  const fixtureRepo = join(commonDir, 'repository');
  mkdirSync(fixtureRepo);
  const fixtureGit = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  fixtureGit(fixtureRepo, ['init', '-q']);
  fixtureGit(fixtureRepo, [
    '-c',
    'user.name=Varve fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '--allow-empty',
    '-qm',
    'fixture',
  ]);
  const fixtureGitDir = fixtureGit(fixtureRepo, ['rev-parse', '--absolute-git-dir']);
  assert.equal(commonGitDirectory({ cwd: fixtureRepo }), fixtureGitDir);
  assert.equal(gitOperationState({ cwd: fixtureRepo }).gitDir, fixtureGitDir);
  const linked = join(commonDir, 'linked');
  fixtureGit(fixtureRepo, ['worktree', 'add', '--detach', '-q', linked, 'HEAD']);
  const linkedGitDir = fixtureGit(linked, ['rev-parse', '--absolute-git-dir']);
  writeFileSync(
    join(linkedGitDir, 'MERGE_HEAD'),
    `${fixtureGit(fixtureRepo, ['rev-parse', 'HEAD'])}\n`,
  );
  assert.equal(commonGitDirectory({ cwd: linked }), fixtureGitDir);
  const linkedState = gitOperationState({ cwd: linked });
  assert.equal(linkedState.gitDir, linkedGitDir);
  assert.deepEqual(linkedState.kinds, ['merge']);
  assert.equal(gitOperationState({ cwd: fixtureRepo }).inProgress, false);
  for (const cwd of [fixtureRepo, linked]) {
    assert.equal(receiptDirectory({ cwd }), join(fixtureGitDir, 'varve-validation', 'receipts'));
    assert.equal(
      laneReceiptDirectory({ cwd }),
      join(fixtureGitDir, 'varve-validation', 'lane-receipts'),
    );
  }

  assert.equal(
    sanitizeRemoteUrl('https://user:token@example.test/varve.git?access_token=secret'),
    'https://example.test/varve.git',
  );
  assert.equal(
    sanitizeRemoteUrl('git@example.test:team/varve.git'),
    'git@example.test:team/varve.git',
  );
  assert.equal(classifySyncState({ upstream: 'origin/master', ahead: 0, behind: 0 }), 'up-to-date');
  assert.equal(classifySyncState({ upstream: 'origin/master', ahead: 3, behind: 0 }), 'ahead-only');
  assert.equal(
    classifySyncState({ upstream: 'origin/master', ahead: 0, behind: 2 }),
    'behind-only',
  );
  assert.equal(classifySyncState({ upstream: 'origin/master', ahead: 3, behind: 2 }), 'diverged');
  assert.equal(classifySyncState({ detached: true }), 'detached');
  assert.equal(classifySyncState(), 'missing-upstream');
  assert.deepEqual(classifyWorktreeStatus(' M changed.txt\0A  staged.txt\0?? new.txt\0'), {
    dirty: true,
    indexDirty: true,
    worktreeDirty: true,
    untracked: true,
    entryCount: 3,
  });

  const started = startOperation({
    type: 'push-checkpoint',
    cwd: '/tmp/varve-worktree-a',
    commonDir,
    destination: {
      name: 'origin',
      url: 'https://user:token@example.test/team/varve.git?token=secret',
    },
    requested: { profile: 'push', strict: false },
    refs: [
      {
        localRef: 'refs/heads/feature',
        localSha: 'a'.repeat(40),
        remoteRef: 'refs/heads/feature',
        remoteSha: 'b'.repeat(40),
        treeSha: 'c'.repeat(40),
      },
    ],
    now: Date.parse('2026-09-08T12:00:00Z'),
  });
  assert.ok(existsSync(started.path));
  assert.match(formatOperation(started.record), /push-checkpoint running/);
  const finished = finishOperation(started.path, {
    status: 'failed',
    exitCode: 1,
    phase: 'lane',
    result: { category: 'validation-failure', failedLane: 'lint:changed' },
    now: Date.parse('2026-09-08T12:00:03Z'),
  });
  assert.equal(finished.status, 'failed');
  assert.equal(finished.result.exitCode, 1);
  assert.equal(finished.durationMs, 3000);
  assert.equal(finished.destination.url, 'https://example.test/team/varve.git');
  assert.deepEqual(finished.refs[0].treeSha, 'c'.repeat(40));

  // A retry is a separate immutable operation file, not a rewrite of the
  // failed attempt.
  const retry = startOperation({
    type: 'push-checkpoint',
    commonDir,
    now: Date.parse('2026-09-08T12:01:00Z'),
  });
  finishOperation(retry.path, {
    status: 'completed',
    exitCode: 0,
    now: Date.parse('2026-09-08T12:01:01Z'),
  });
  assert.equal(readdirSync(join(commonDir, 'varve-validation', 'operations')).length, 2);
  assert.equal(listOperations({ commonDir }).length, 2);

  const interrupted = startOperation({
    type: 'pull-validation',
    commonDir,
    now: Date.parse('2026-09-08T10:00:00Z'),
  });
  const recovered = recoverInterruptedOperations({
    commonDir,
    now: Date.parse('2026-09-08T11:00:00Z'),
    maxAgeMs: 30 * 60 * 1000,
  });
  assert.equal(recovered.length, 1);
  assert.equal(
    listOperations({ commonDir }).find((entry) => entry.path === interrupted.path).record.status,
    'incomplete',
  );

  console.log('operation history tests passed');
} finally {
  rmSync(commonDir, { recursive: true, force: true });
}
