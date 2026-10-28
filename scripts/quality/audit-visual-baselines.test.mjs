#!/usr/bin/env node
/**
 * Regression tests for the visual-baseline hygiene audit.
 *
 * Every test builds a throwaway tests/e2e tree in a temp directory and runs the
 * real CLI or imports the pure checker. The repository's own snapshots are never
 * read: the audit's job is to describe an arbitrary tree, so its tests must not
 * depend on the current debt/state of the real one.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkVisualBaselines, REPLAY_SNAPSHOTS } from './audit-visual-baselines.mjs';

const scriptPath = fileURLToPath(new URL('./audit-visual-baselines.mjs', import.meta.url));
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const TIER_SUFFIXES = {
  '1x': ['1x', 'chromium-visual-1x'],
  '2x': ['2x', 'chromium-visual-2x'],
  '3x': ['3x', 'chromium-visual-3x'],
  gpu: ['gpu', 'chromium-visual-gpu'],
  firefox: ['firefox-visual', 'firefox-visual'],
  webkit: ['webkit-visual', 'webkit-visual'],
};

/** Build a minimal valid PNG header buffer (signature + IHDR + CRC placeholder). */
function png({ width = 800, height = 600, validSignature = true } = {}) {
  const buffer = Buffer.alloc(33);
  const signature = validSignature ? Buffer.from(PNG_SIGNATURE) : Buffer.from('NOT-A-PNG');
  signature.copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer[24] = 8;
  buffer[25] = 6;
  return buffer;
}

/** Files for one replay fixture across the requested visual variants. */
function replayFixture(name, variants = ['1x', '2x', '3x', 'gpu'], dimensions = {}) {
  const files = {};
  for (const variant of variants) {
    const [tierLabel, project] = TIER_SUFFIXES[variant];
    const size = dimensions[variant] ?? { width: 800, height: 600 };
    files[`${name}-${tierLabel}-${project}-linux.png`] = png(size);
  }
  return files;
}

function replayFiles(fixtureFiles, { owner = true } = {}) {
  const files = {};
  if (owner) files['tests/e2e/visual/replay.spec.ts'] = '';
  for (const [name, buffer] of Object.entries(fixtureFiles)) {
    files[REPLAY_SNAPSHOTS + '/' + name] = buffer;
  }
  return files;
}

function writeTree(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

function withTree(files, body) {
  const root = mkdtempSync(join(tmpdir(), 'audit-visual-baselines-'));
  try {
    writeTree(root, files);
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runCli(root, args = []) {
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
      output: String(error.stdout ?? '') + String(error.stderr ?? ''),
    };
  }
}

test('a clean tree passes with correct summary counts', () => {
  const files = {
    'tests/e2e/canvas/sample.spec.ts': '',
    'tests/e2e/canvas/sample.spec.ts-snapshots/alpha-chromium-linux.png': png({
      width: 640,
      height: 480,
    }),
    'tests/e2e/canvas/sample.spec.ts-snapshots/beta-firefox-linux.png': png({
      width: 640,
      height: 480,
    }),
    ...replayFiles(replayFixture('gradient-fixture')),
  };
  withTree(files, (root) => {
    writeFileSync(join(root, 'tests/e2e/canvas/empty.spec.ts'), '');
    mkdirSync(join(root, 'tests/e2e/canvas/empty.spec.ts-snapshots'), { recursive: true });
    const result = checkVisualBaselines({ root });
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(result.summary.snapshotDirs, 3);
    assert.equal(result.summary.ownedDirs, 3);
    assert.equal(result.summary.pngCount, 6);
    assert.equal(result.summary.byProject.chromium, 1);
    assert.equal(result.summary.byProject['chromium-visual-2x'], 1);
    const cli = runCli(root);
    assert.equal(cli.status, 0, cli.output);
    assert.match(cli.output, /Visual-baseline audit: OK/);
  });
});

test('an orphan snapshots directory is reported', () => {
  withTree(
    { 'tests/e2e/canvas/orphan.spec.ts-snapshots/alpha-chromium-linux.png': png() },
    (root) => {
      const result = checkVisualBaselines({ root });
      assert.equal(result.ok, false);
      assert.deepEqual(
        result.findings.map((finding) => finding.kind),
        ['orphan-dir'],
      );
      assert.match(
        result.findings[0].message,
        /no owning spec at tests\/e2e\/canvas\/orphan\.spec\.ts/,
      );
      assert.equal(runCli(root).status, 1);
    },
  );
});

test('corrupt, truncated and dimension-invalid PNGs are reported', () => {
  withTree(
    {
      'tests/e2e/canvas/broken.spec.ts': '',
      'tests/e2e/canvas/broken.spec.ts-snapshots/bad-signature-chromium-linux.png': png({
        validSignature: false,
      }),
      'tests/e2e/canvas/broken.spec.ts-snapshots/short-chromium-linux.png': Buffer.from('tiny'),
      'tests/e2e/canvas/broken.spec.ts-snapshots/zero-chromium-linux.png': png({ width: 0 }),
      'tests/e2e/canvas/broken.spec.ts-snapshots/huge-chromium-linux.png': png({ width: 20000 }),
    },
    (root) => {
      const result = checkVisualBaselines({ root });
      assert.equal(result.ok, false);
      const corrupt = result.findings.filter((finding) => finding.kind === 'corrupt-png');
      assert.equal(corrupt.length, 4, JSON.stringify(result.findings));
      assert.ok(corrupt.some((finding) => /signature/.test(finding.message)));
      assert.ok(corrupt.some((finding) => /minimum 25 bytes/.test(finding.message)));
      assert.ok(corrupt.some((finding) => /invalid dimensions 0x/.test(finding.message)));
      assert.ok(corrupt.some((finding) => /invalid dimensions 20000x/.test(finding.message)));
    },
  );
});

test('unknown project and platform suffixes are reported', () => {
  withTree(
    {
      'tests/e2e/canvas/sample.spec.ts': '',
      'tests/e2e/canvas/sample.spec.ts-snapshots/alpha-legacy-plan9.png': png(),
      'tests/e2e/canvas/sample.spec.ts-snapshots/alpha-legacy-mystery-linux.png': png(),
    },
    (root) => {
      const result = checkVisualBaselines({ root });
      const unknown = result.findings.filter((finding) => finding.kind === 'unknown-suffix');
      assert.equal(unknown.length, 2, JSON.stringify(result.findings));
      assert.ok(unknown.some((finding) => /unknown platform/.test(finding.message)));
      assert.ok(unknown.some((finding) => /unknown project "mystery"/.test(finding.message)));
    },
  );
});

test('a visual-tier dimension mismatch is reported', () => {
  const files = replayFiles(
    replayFixture('shape-fixture', ['1x', '2x', '3x', 'gpu', 'firefox'], {
      '2x': { width: 1200, height: 900 },
    }),
  );
  withTree(files, (root) => {
    const result = checkVisualBaselines({ root });
    const mismatch = result.findings.filter((finding) => finding.kind === 'dimension-mismatch');
    assert.equal(mismatch.length, 1, JSON.stringify(result.findings));
    assert.match(mismatch[0].message, /mismatched dimensions/);
    assert.match(mismatch[0].message, /chromium-visual-2x=1200x900/);
  });
});

test('chromium and chromium-snapshot may differ in dimensions (not a visual tier)', () => {
  withTree(
    {
      'tests/e2e/canvas/legacy.spec.ts': '',
      'tests/e2e/canvas/legacy.spec.ts-snapshots/widget-chromium-linux.png': png({
        width: 690,
        height: 544,
      }),
      'tests/e2e/canvas/legacy.spec.ts-snapshots/widget-chromium-snapshot-linux.png': png({
        width: 740,
        height: 544,
      }),
    },
    (root) => {
      const result = checkVisualBaselines({ root });
      assert.equal(result.ok, true, JSON.stringify(result.findings));
    },
  );
});

test('a missing CPU tier baseline is reported for replay fixtures', () => {
  const files = replayFiles(replayFixture('tier-fixture', ['1x', '3x', 'gpu', 'firefox']));
  withTree(files, (root) => {
    const result = checkVisualBaselines({ root });
    const missing = result.findings.filter((finding) => finding.kind === 'missing-variant');
    assert.equal(missing.length, 1, JSON.stringify(result.findings));
    assert.match(missing[0].message, /"tier-fixture" is missing required baseline\(s\): 2x/);
  });
});

test('firefox is required for every fixture once any firefox baseline exists', () => {
  const files = replayFiles({
    ...replayFixture('with-firefox', ['1x', '2x', '3x', 'gpu', 'firefox']),
    ...replayFixture('without-firefox'),
  });
  withTree(files, (root) => {
    const result = checkVisualBaselines({ root });
    const missing = result.findings.filter((finding) => finding.kind === 'missing-variant');
    assert.equal(missing.length, 1, JSON.stringify(result.findings));
    assert.match(
      missing[0].message,
      /"without-firefox" is missing required baseline\(s\): firefox/,
    );
    assert.ok(!missing.some((finding) => /with-firefox/.test(finding.message)));
  });
});

test('webkit is optional when absent', () => {
  const files = replayFiles(replayFixture('no-webkit', ['1x', '2x', '3x', 'gpu', 'firefox']));
  withTree(files, (root) => {
    const result = checkVisualBaselines({ root });
    assert.equal(result.ok, true, JSON.stringify(result.findings));
    assert.equal(runCli(root).status, 0);
  });
});

test('webkit is required for every fixture once one webkit baseline exists', () => {
  const files = replayFiles({
    ...replayFixture('with-webkit', ['1x', '2x', '3x', 'gpu', 'firefox', 'webkit']),
    ...replayFixture('without-webkit', ['1x', '2x', '3x', 'gpu', 'firefox']),
  });
  withTree(files, (root) => {
    const result = checkVisualBaselines({ root });
    const missing = result.findings.filter((finding) => finding.kind === 'missing-variant');
    assert.equal(missing.length, 1, JSON.stringify(result.findings));
    assert.match(missing[0].message, /"without-webkit" is missing required baseline\(s\): webkit/);
  });
});

test('--json emits the documented shape', () => {
  const files = replayFiles(replayFixture('json-fixture', ['1x', '3x', 'gpu']));
  withTree(files, (root) => {
    const cli = runCli(root, ['--json']);
    assert.equal(cli.status, 1, cli.output);
    const parsed = JSON.parse(cli.output);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.summary.snapshotDirs, 1);
    assert.equal(parsed.summary.pngCount, 3);
    assert.equal(parsed.summary.byKind['missing-variant'], 1);
    assert.ok(Array.isArray(parsed.findings));
    for (const finding of parsed.findings) {
      assert.equal(typeof finding.kind, 'string');
      assert.equal(typeof finding.path, 'string');
      assert.equal(typeof finding.message, 'string');
    }
  });
});

test('--help and unknown arguments return documented exit codes', () => {
  withTree({}, (root) => {
    const help = runCli(root, ['--help']);
    assert.equal(help.status, 0);
    assert.match(help.output, /Usage:/);
    const unknown = runCli(root, ['--bogus']);
    assert.equal(unknown.status, 2);
    assert.match(unknown.output, /Unknown argument/);
  });
});
