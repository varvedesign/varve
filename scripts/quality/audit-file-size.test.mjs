#!/usr/bin/env node
/**
 * Regression tests for the file-size budget guard.
 *
 * Every test builds a throwaway git checkout in a temp directory and runs the
 * real CLI against it. The repository's own .file-size-baseline.json is never
 * touched: a guard whose tests depend on the debt snapshot it is ratcheting
 * would break on the first intentional split.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('./audit-file-size.mjs', import.meta.url));

/** Build fixture file content with an exact line count. */
function sourceLines(count, label = 'line') {
  const rows = [];
  for (let index = 1; index <= count; index += 1) rows.push(`// ${label} ${index}`);
  return `${rows.join('\n')}\n`;
}

/**
 * @param {Record<string, string>} files repository-relative path -> content
 * @param {{ git?: boolean }} options
 */
function makeFixture(files, { git = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'audit-file-size-'));
  if (git) execFileSync('git', ['init', '-q'], { cwd: root });
  for (const [file, content] of Object.entries(files)) {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  if (git) execFileSync('git', ['add', '-A'], { cwd: root });
  return root;
}

/** Stage everything (used after tests add or rewrite files). */
function stage(root) {
  execFileSync('git', ['add', '-A'], { cwd: root });
}

function runAudit(root, args = []) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output: stdout };
  } catch (error) {
    return {
      status: error.status ?? 1,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    };
  }
}

function readBaseline(root) {
  return JSON.parse(readFileSync(join(root, '.file-size-baseline.json'), 'utf8'));
}

function withFixture(files, options, body) {
  const root = makeFixture(files, options);
  try {
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('clean fixture passes and reports the scanned count', () => {
  withFixture(
    {
      'packages/demo/src/small.ts': sourceLines(120),
      'crates/demo/src/lib.rs': sourceLines(399),
      'scripts/tool.py': sourceLines(40),
    },
    {},
    (root) => {
      const result = runAudit(root);
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /File-size budget OK/);
      assert.match(result.output, /3 source files scanned/);
    },
  );
});

test('a new over-cap source file fails before it is committed', () => {
  withFixture({ 'packages/demo/src/god.ts': sourceLines(500) }, {}, (root) => {
    const result = runAudit(root);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /NEW\s+packages\/demo\/src\/god\.ts/);
    assert.match(result.output, /500 lines/);
    assert.match(result.output, /FAILED: 1 violation/);
  });
});

test('untracked WIP is reported but only enforced once tracked', () => {
  withFixture({ 'packages/demo/src/ok.ts': sourceLines(20) }, {}, (root) => {
    writeFileSync(join(root, 'packages/demo/src/wip.ts'), sourceLines(620));

    // Another agent's in-flight scratch file must not fail this session's gate.
    const wip = runAudit(root);
    assert.equal(wip.status, 0, wip.output);
    assert.match(wip.output, /WIP\s+1 untracked over-cap file/);
    assert.match(wip.output, /packages\/demo\/src\/wip\.ts/);

    // Untracked WIP is never frozen into the baseline.
    assert.equal(runAudit(root, ['--update']).status, 0);
    assert.equal(readBaseline(root).files['packages/demo/src/wip.ts'], undefined);

    // Staging it makes it repository content: now it fails until split/adopted.
    stage(root);
    const tracked = runAudit(root);
    assert.equal(tracked.status, 1, tracked.output);
    assert.match(tracked.output, /NEW\s+packages\/demo\/src\/wip\.ts/);
    assert.equal(runAudit(root, ['--update']).status, 1, '--update must refuse to freeze it');
  });
});

test('--update prunes baseline entries that are no longer tracked', () => {
  withFixture({ 'packages/demo/src/god.ts': sourceLines(900) }, {}, (root) => {
    assert.equal(runAudit(root, ['--update']).status, 0);
    assert.equal(readBaseline(root).files['packages/demo/src/god.ts'], 900);
    // Remove it from the index but keep it on disk as untracked WIP.
    execFileSync('git', ['rm', '--cached', '-q', 'packages/demo/src/god.ts'], { cwd: root });
    const update = runAudit(root, ['--update']);
    assert.equal(update.status, 0, update.output);
    assert.equal(readBaseline(root).files['packages/demo/src/god.ts'], undefined);
  });
});

test('--update freezes current offenders deterministically and is idempotent', () => {
  withFixture(
    {
      'packages/demo/src/god.ts': sourceLines(500),
      'packages/demo/src/large.ts': sourceLines(901),
      'packages/demo/src/ok.ts': sourceLines(80),
    },
    {},
    (root) => {
      const first = runAudit(root, ['--update']);
      assert.equal(first.status, 0, first.output);
      const raw = readFileSync(join(root, '.file-size-baseline.json'), 'utf8');
      assert.ok(raw.endsWith('\n'), 'baseline must end with a newline');
      const baseline = readBaseline(root);
      assert.equal(baseline.schemaVersion, 1);
      assert.equal(baseline.maxLines, 400);
      assert.deepEqual(Object.keys(baseline.files), [
        'packages/demo/src/god.ts',
        'packages/demo/src/large.ts',
      ]);
      assert.deepEqual(baseline.files, {
        'packages/demo/src/god.ts': 500,
        'packages/demo/src/large.ts': 901,
      });
      const second = runAudit(root, ['--update']);
      assert.equal(second.status, 0, second.output);
      assert.equal(readFileSync(join(root, '.file-size-baseline.json'), 'utf8'), raw);
      const check = runAudit(root);
      assert.equal(check.status, 0, check.output);
      assert.match(check.output, /File-size budget OK/);
    },
  );
});

test('growing a frozen file fails; --update refuses to launder it', () => {
  withFixture({ 'packages/demo/src/god.ts': sourceLines(500) }, {}, (root) => {
    assert.equal(runAudit(root, ['--update']).status, 0);
    writeFileSync(join(root, 'packages/demo/src/god.ts'), sourceLines(510));
    stage(root);
    const check = runAudit(root);
    assert.equal(check.status, 1, check.output);
    assert.match(check.output, /GREW\s+packages\/demo\/src\/god\.ts/);
    assert.match(check.output, /\+10 over frozen baseline 500/);
    const update = runAudit(root, ['--update']);
    assert.equal(update.status, 1, update.output);
    assert.match(update.output, /Refusing to rewrite/);
    const forced = runAudit(root, ['--update', '--force']);
    assert.equal(forced.status, 0, forced.output);
    assert.equal(readBaseline(root).files['packages/demo/src/god.ts'], 510);
    assert.equal(runAudit(root).status, 0);
  });
});

test('a file that shrank below the cap is allowed and pruned by --update', () => {
  withFixture({ 'packages/demo/src/god.ts': sourceLines(900) }, {}, (root) => {
    assert.equal(runAudit(root, ['--update']).status, 0);
    writeFileSync(join(root, 'packages/demo/src/god.ts'), sourceLines(390));
    stage(root);
    const check = runAudit(root);
    assert.equal(check.status, 0, check.output);
    const report = runAudit(root, ['--report']);
    assert.equal(report.status, 0, report.output);
    assert.match(report.output, /0 over the 400-line cap/);
    assert.match(report.output, /1 stale/);
    const update = runAudit(root, ['--update']);
    assert.equal(update.status, 0, update.output);
    assert.deepEqual(readBaseline(root).files, {});
  });
});

test('--update refuses to freeze a new over-cap path once a baseline exists', () => {
  withFixture({ 'packages/demo/src/ok.ts': sourceLines(30) }, {}, (root) => {
    assert.equal(runAudit(root, ['--update']).status, 0);
    writeFileSync(join(root, 'packages/demo/src/newGod.ts'), sourceLines(700));
    stage(root);
    const update = runAudit(root, ['--update']);
    assert.equal(update.status, 1, update.output);
    assert.match(update.output, /new over-cap file/);
    assert.match(update.output, /newGod\.ts/);
  });
});

test('excluded trees and generated data files do not count toward the budget', () => {
  withFixture(
    {
      'vendor/little_exif/src/vendor_god.rs': sourceLines(900),
      'packages/engine/src/text/lineBreakClassesData.ts': sourceLines(900),
      'packages/engine/src/inference/models/siglipT5Charmap.ts': sourceLines(900),
      'packages/shared/src/verticalOrientationData.ts': sourceLines(900),
      'packages/demo/src/ok.ts': sourceLines(40),
      '.gitignore': 'dist/\n',
    },
    {},
    (root) => {
      mkdirSync(join(root, 'dist'), { recursive: true });
      writeFileSync(join(root, 'dist', 'bundle.ts'), sourceLines(900));
      const result = runAudit(root);
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /all frozen/);
      const report = runAudit(root, ['--report']);
      assert.match(report.output, /0 over the 400-line cap/);
      assert.match(report.output, /vendor\/ and 3 machine-generated/);
    },
  );
});

test('default output caps the violation list', () => {
  const files = {};
  for (let index = 0; index < 30; index += 1) {
    files[`packages/demo/src/god${String(index).padStart(2, '0')}.ts`] = sourceLines(450);
  }
  withFixture(files, {}, (root) => {
    const result = runAudit(root);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /30 violation/);
    assert.match(result.output, /and 5 more violation/);
    const listed = result.output.split('\n').filter((line) => line.includes('NEW   '));
    assert.equal(listed.length, 25);
  });
});

test('--report ranks offenders by line count', () => {
  withFixture(
    {
      'packages/demo/src/a.ts': sourceLines(500),
      'packages/demo/src/b.ts': sourceLines(900),
      'packages/demo/src/c.ts': sourceLines(700),
    },
    {},
    (root) => {
      assert.equal(runAudit(root, ['--update']).status, 0);
      const report = runAudit(root, ['--report']);
      assert.equal(report.status, 0, report.output);
      const order = [
        report.output.indexOf('packages/demo/src/b.ts'),
        report.output.indexOf('packages/demo/src/c.ts'),
        report.output.indexOf('packages/demo/src/a.ts'),
      ];
      assert.ok(order[0] > 0 && order[0] < order[1] && order[1] < order[2], report.output);
      assert.match(report.output, /\[frozen\]/);
    },
  );
});

test('a non-git directory fails closed instead of scanning nothing silently', () => {
  withFixture({ 'packages/demo/src/god.ts': sourceLines(500) }, { git: false }, (root) => {
    const result = runAudit(root);
    assert.equal(result.status, 2, result.output);
    assert.match(result.output, /git checkout/);
  });
});

test('unknown arguments are rejected', () => {
  withFixture({ 'packages/demo/src/ok.ts': sourceLines(10) }, {}, (root) => {
    const result = runAudit(root, ['--bogus']);
    assert.equal(result.status, 2, result.output);
    assert.match(result.output, /Unknown argument/);
  });
});
