#!/usr/bin/env node

/** Exact identity and common-Git-directory receipt regression tests. */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  commonGitDirectory,
  laneReceiptIdentity,
  readLaneReceipt,
  readReceipt,
  receiptPath,
  recordOverride,
  writeLaneReceipt,
  writeReceipt,
} from './validation-receipts.mjs';

const commonDir = mkdtempSync(join(tmpdir(), 'varve-receipts-common-'));
const tools = {
  node: 'v-test',
  pnpm: 'pnpm-test',
  rustc: 'rustc-test',
  cargo: 'cargo-test',
  just: 'just-test',
  packageManager: 'pnpm@11.9.0',
  playwright: '1.62.1',
  platform: 'linux',
  arch: 'x64',
};
const basePlan = {
  remote: { name: 'origin', url: 'https://example.invalid/varve.git' },
  refs: [
    {
      localRef: 'refs/heads/feature',
      localSha: 'c'.repeat(40),
      remoteRef: 'refs/heads/feature',
      remoteSha: 'b'.repeat(40),
      baseSha: 'b'.repeat(40),
      headSha: 'c'.repeat(40),
      comparisonBaseSha: 'b'.repeat(40),
      deleted: false,
    },
  ],
  changedFileHash: 'd'.repeat(64),
  outgoingCommitHash: 'e'.repeat(64),
  lockfileHash: 'f'.repeat(64),
  policyVersion: 'test-policy-v1',
  policyHash: '1'.repeat(64),
};

try {
  // The calling process is itself in a linked worktree. The requested cwd
  // belongs to a different repository and must not inherit the caller's Git
  // adapter (which returns an absolute common directory for linked trees).
  const primary = join(commonDir, 'primary');
  const linked = join(commonDir, 'linked');
  const foreign = join(commonDir, 'foreign');
  for (const cwd of [primary, foreign]) {
    mkdirSync(cwd);
    execFileSync('git', ['init', '-q'], { cwd });
  }
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Receipt fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--allow-empty',
      '-qm',
      'fixture',
    ],
    { cwd: primary },
  );
  execFileSync('git', ['worktree', 'add', '--detach', '-q', linked], { cwd: primary });
  const expected = execFileSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: foreign, encoding: 'utf8' },
  ).trim();
  for (const module of ['./validation-receipts.mjs', './operation-history.mjs']) {
    const moduleUrl = new URL(module, import.meta.url).href;
    const actual = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { commonGitDirectory } from ${JSON.stringify(moduleUrl)};
         console.log(commonGitDirectory({ cwd: ${JSON.stringify(foreign)} }));`,
      ],
      { cwd: linked, encoding: 'utf8' },
    ).trim();
    assert.equal(
      pathToFileURL(actual).href,
      pathToFileURL(expected).href,
      `${module}: requested cwd owns receipt storage, not the linked caller`,
    );
  }
  assert.equal(commonGitDirectory({ cwd: foreign }), join(foreign, '.git'));

  const now = Date.parse('2026-08-31T12:00:00Z');
  const written = writeReceipt(basePlan, { commonDir, tools, now, commands: [['pnpm', 'test']] });
  assert.ok(existsSync(written.path));
  assert.equal(written.path, receiptPath(basePlan, { commonDir, tools, now }));
  assert.equal(readReceipt(basePlan, { commonDir, tools, now: now + 1000 }).reusable, true);

  // A manual --since check and the actual Git hook describe the same bytes
  // using different ref names. Reuse only local lane results; the caller must
  // still rebuild the push plan and enforce ref/history policy.
  const manualSincePlan = structuredClone(basePlan);
  manualSincePlan.refs[0].localRef = 'HEAD';
  manualSincePlan.refs[0].remoteRef = 'refs/remotes/origin/master';
  const laneWritten = writeLaneReceipt(manualSincePlan, { commonDir, tools, now });
  assert.equal(readReceipt(basePlan, { commonDir, tools, now }).reusable, true);
  assert.equal(readReceipt(manualSincePlan, { commonDir, tools, now }).reusable, false);
  assert.equal(readLaneReceipt(basePlan, { commonDir, tools, now: now + 1000 }).reusable, true);
  assert.equal(
    laneReceiptIdentity(basePlan, { tools, now }).identityHash,
    laneReceiptIdentity(manualSincePlan, { tools, now }).identityHash,
  );
  assert.ok(existsSync(laneWritten.path));

  for (const field of ['baseSha', 'headSha', 'localSha', 'remoteSha', 'comparisonBaseSha']) {
    const changed = structuredClone(basePlan);
    changed.refs[0][field] = '7'.repeat(40);
    assert.equal(readLaneReceipt(changed, { commonDir, tools, now }).reusable, false, field);
  }
  for (const field of [
    'changedFileHash',
    'outgoingCommitHash',
    'lockfileHash',
    'policyVersion',
    'policyHash',
  ]) {
    const changed = structuredClone(basePlan);
    changed[field] = '7'.repeat(changed[field].length);
    assert.equal(readLaneReceipt(changed, { commonDir, tools, now }).reusable, false, field);
  }
  assert.equal(
    readLaneReceipt(basePlan, { commonDir, tools: { ...tools, node: 'other' }, now }).reusable,
    false,
  );
  assert.equal(
    readLaneReceipt(basePlan, { commonDir, tools, now: now + 7 * 60 * 60 * 1000 }).reusable,
    false,
  );

  const strictPlan = {
    ...structuredClone(basePlan),
    validation: {
      profile: 'push',
      strict: true,
      localBlocking: ['js-unit:all'],
      remoteRequired: ['pipeline-validate'],
      deferred: [],
      promisedIntegrationLanes: ['js-unit:all'],
      promisedCandidateLanes: ['js-unit:all'],
    },
    localBlockingLanes: ['js-unit:all'],
    remotelyRequiredLanes: ['pipeline-validate'],
    deferredLanes: [],
  };
  assert.equal(
    readReceipt(strictPlan, { commonDir, tools, now: now + 1000 }).reusable,
    false,
    'ordinary push evidence cannot satisfy strict push coverage',
  );

  // The same identity is reusable from another worktree sharing the common
  // Git directory; a different ref/base/head never aliases the receipt.
  const sameFromOtherWorktree = readReceipt(structuredClone(basePlan), {
    commonDir,
    tools,
    now: now + 2000,
  });
  assert.equal(sameFromOtherWorktree.reusable, true);
  const changedHead = structuredClone(basePlan);
  changedHead.refs[0].headSha = '9'.repeat(40);
  assert.equal(readReceipt(changedHead, { commonDir, tools, now }).reusable, false);
  const changedBase = structuredClone(basePlan);
  changedBase.refs[0].baseSha = '8'.repeat(40);
  assert.equal(readReceipt(changedBase, { commonDir, tools, now }).reusable, false);
  const changedRawRemoteObject = structuredClone(basePlan);
  changedRawRemoteObject.refs[0].remoteSha = '7'.repeat(40);
  assert.equal(
    readReceipt(changedRawRemoteObject, { commonDir, tools, now }).reusable,
    false,
    'annotated-tag object changes must invalidate the receipt',
  );
  const changedRefs = structuredClone(basePlan);
  changedRefs.refs.push({ ...changedRefs.refs[0], remoteRef: 'refs/heads/other' });
  assert.equal(readReceipt(changedRefs, { commonDir, tools, now }).reusable, false);

  // Lockfile, policy, and toolchain changes all produce different identities.
  for (const field of ['lockfileHash', 'policyHash', 'policyVersion']) {
    const changed = structuredClone(basePlan);
    changed[field] = changed[field].replace(/./g, '2');
    assert.equal(readReceipt(changed, { commonDir, tools, now }).reusable, false, field);
  }
  assert.equal(
    readReceipt(basePlan, {
      commonDir,
      tools: { ...tools, node: 'v-other' },
      now,
    }).reusable,
    false,
  );
  assert.equal(
    readReceipt(basePlan, {
      commonDir,
      tools,
      now: now + 7 * 60 * 60 * 1000,
    }).reason,
    'expired',
  );
  writeReceipt(basePlan, { commonDir, tools, now: now + 60_000 });
  assert.equal(readReceipt(basePlan, { commonDir, tools, now }).reason, 'expired');

  writeReceipt(basePlan, { commonDir, tools, now: now + 120_000 });
  const currentPath = receiptPath(basePlan, { commonDir, tools, now: now + 120_000 });
  const current = JSON.parse(readFileSync(currentPath, 'utf8'));
  current.identity.identityHash = '0'.repeat(64);
  writeFileSync(currentPath, `${JSON.stringify(current)}\n`);
  assert.equal(
    readReceipt(basePlan, { commonDir, tools, now: now + 120_001 }).reason,
    'corrupt-or-schema-mismatch',
    'corrupt receipt identity is not reusable',
  );

  const override = recordOverride('network outage while pushing integration branch', basePlan, {
    commonDir,
    now,
  });
  assert.equal(override.reason, 'network outage while pushing integration branch');
  const overrideLog = readFileSync(join(commonDir, 'varve-validation', 'overrides.ndjson'), 'utf8');
  assert.match(overrideLog, /network outage/);
  assert.throws(() => recordOverride('   ', basePlan, { commonDir }), /nonempty, specific/);

  console.log('validation receipt tests passed');
} finally {
  rmSync(commonDir, { recursive: true, force: true });
}
