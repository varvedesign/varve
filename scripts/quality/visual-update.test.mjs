#!/usr/bin/env node
/** Regression tests for the scoped visual-baseline update wrapper. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  parseVisualUpdateArgs,
  resolveSpecPath,
  runVisualUpdate,
  VISUAL_PROJECTS,
} from './visual-update.mjs';

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'visual-update-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root });
  mkdirSync(join(root, 'scripts/quality'), { recursive: true });
  writeFileSync(join(root, 'scripts/quality/heavy-lease.mjs'), '// fixture\n');
  mkdirSync(join(root, 'tests/e2e/demo'), { recursive: true });
  writeFileSync(join(root, 'tests/e2e/demo/demo.spec.ts'), '// spec\n');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  return root;
}

const REASON = 'Enhance dialog spacing per the design review';

test('parses flags and rejects malformed arguments', () => {
  assert.deepEqual(
    parseVisualUpdateArgs([
      '--spec=a.spec.ts',
      '--project',
      'chromium',
      '--reason',
      REASON,
      '--dry-run',
    ]),
    {
      spec: 'a.spec.ts',
      project: 'chromium',
      reason: REASON,
      dryRun: true,
      help: false,
    },
  );
  assert.throws(() => parseVisualUpdateArgs(['--bogus', 'x']), /unknown option/);
  assert.throws(() => parseVisualUpdateArgs(['--spec']), /missing value/);
  assert.throws(() => parseVisualUpdateArgs(['extra']), /unexpected argument/);
});

test('spec resolution stays inside tests/e2e and requires a .spec.ts file', () => {
  const repo = makeRepo();
  try {
    assert.equal(
      resolveSpecPath(repo, 'tests/e2e/demo/demo.spec.ts').path,
      join(repo, 'tests/e2e/demo/demo.spec.ts'),
    );
    assert.match(
      resolveSpecPath(repo, 'scripts/quality/visual-update.mjs').error,
      /under tests\/e2e/,
    );
    assert.match(resolveSpecPath(repo, 'tests/e2e/demo/demo.ts').error, /\*\.spec\.ts/);
    assert.match(resolveSpecPath(repo, 'tests/e2e/demo/nope.spec.ts').error, /does not exist/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('validation rejects unknown projects, short reasons and dry-run invokes nothing', () => {
  const repo = makeRepo();
  try {
    const base = { spec: 'tests/e2e/demo/demo.spec.ts', project: 'chromium', reason: REASON };
    assert.equal(runVisualUpdate({ ...base, project: 'not-a-project' }, { root: repo }), 2);
    assert.equal(runVisualUpdate({ ...base, reason: 'too short' }, { root: repo }), 2);
    let invoked = false;
    const code = runVisualUpdate(
      { ...base, dryRun: true },
      {
        root: repo,
        invoke: () => {
          invoked = true;
          return { status: 0 };
        },
      },
    );
    assert.equal(code, 0);
    assert.equal(invoked, false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('a successful run records changed baselines and a review artifact', () => {
  const repo = makeRepo();
  try {
    const snapshotPath = join(
      repo,
      'tests/e2e/demo/demo.spec.ts-snapshots/added-chromium-linux.png',
    );
    const invoke = (command, args, options) => {
      assert.equal(args[0], 'scripts/quality/heavy-lease.mjs');
      assert.ok(args.includes('--update-snapshots=changed'));
      mkdirSync(dirname(snapshotPath), { recursive: true });
      writeFileSync(snapshotPath, 'png');
      return { status: 0, options };
    };
    const code = runVisualUpdate(
      { spec: 'tests/e2e/demo/demo.spec.ts', project: 'chromium', reason: REASON },
      { root: repo, invoke },
    );
    assert.equal(code, 0);
    const reports = join(repo, 'reports/visual-baseline-updates');
    assert.ok(existsSync(reports));
    const [artifactName] = execFileSync('ls', [reports], { encoding: 'utf8' }).trim().split('\n');
    const artifact = JSON.parse(readFileSync(join(reports, artifactName), 'utf8'));
    assert.equal(artifact.reason, REASON);
    assert.equal(artifact.project, 'chromium');
    assert.equal(artifact.exitCode, 0);
    assert.equal(artifact.changedBaselines.length, 1);
    assert.match(artifact.changedBaselines[0].path, /added-chromium-linux\.png/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('no baseline changes fails, and a failing run preserves its exit code', () => {
  const repo = makeRepo();
  try {
    const base = { spec: 'tests/e2e/demo/demo.spec.ts', project: 'chromium', reason: REASON };
    assert.equal(runVisualUpdate(base, { root: repo, invoke: () => ({ status: 0 }) }), 1);
    assert.equal(runVisualUpdate(base, { root: repo, invoke: () => ({ status: 2 }) }), 2);
    assert.ok(VISUAL_PROJECTS.has('chromium') && VISUAL_PROJECTS.has('firefox-visual'));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
