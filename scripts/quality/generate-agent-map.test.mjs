#!/usr/bin/env node
/** Regression tests for the stable, structure-only generated agent map. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildAgentMap } from './generate-agent-map.mjs';

const SCRIPT = fileURLToPath(new URL('./generate-agent-map.mjs', import.meta.url));

function sourceLines(count) {
  return Array.from({ length: count }, (_, index) => '// line ' + (index + 1)).join('\n') + '\n';
}

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function makeFixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'agent-map-test-'));
  git(root, ['init', '-q']);
  for (const [file, content] of Object.entries(files)) {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  git(root, ['add', '-A']);
  return root;
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

const FIXTURE = {
  'AGENTS.md': '# agents\n',
  'docs/README.md': '# docs\n',
  '.ai/skills/README.md': '# skills\n',
  'package.json': JSON.stringify({ name: 'demo-root', private: true }),
  'packages/a/package.json': JSON.stringify({ name: '@demo/a' }),
  'packages/a/src/index.ts': sourceLines(20),
  'crates/demo/Cargo.toml': '[package]\nname = "demo_crate"\nversion = "0.1.0"\n',
  'crates/demo/src/lib.rs': sourceLines(40),
  'vendor/demo/src/lib.rs': sourceLines(900),
  '.file-size-baseline.json': JSON.stringify({
    schemaVersion: 1,
    maxLines: 400,
    files: { 'packages/frozen/god.ts': 900 },
  }),
  '.gitignore': 'dist/\n',
};

test('map is deterministic and records structure, not live line counts', () => {
  const root = makeFixture(FIXTURE);
  try {
    const first = buildAgentMap(root);
    const second = buildAgentMap(root);
    assert.equal(first.content, second.content, 'same tree must produce identical maps');
    assert.match(first.content, /@demo\/a/);
    assert.match(first.content, /demo_crate/);
    assert.match(first.content, /packages\/frozen\/god\.ts/);
    assert.doesNotMatch(
      first.content,
      /vendor\/demo\/src\/lib\.rs 900/,
      'vendored sources are replaced by the baseline signal',
    );
    assert.equal(first.stats.sourceFiles, 2);
    assert.ok(first.stats.trackedFiles >= 10);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ordinary edits do not churn the map; adding a tracked file does', () => {
  const root = makeFixture(FIXTURE);
  try {
    const before = buildAgentMap(root);
    writeFileSync(join(root, 'packages/a/src/index.ts'), sourceLines(200));
    assert.equal(
      buildAgentMap(root).content,
      before.content,
      'line-count changes must not change the map',
    );

    writeFileSync(join(root, 'packages/a/src/added.ts'), sourceLines(10));
    git(root, ['add', 'packages/a/src/added.ts']);
    assert.notEqual(
      buildAgentMap(root).content,
      before.content,
      'adding a tracked file changes source counts',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('untracked WIP is not part of the generated map', () => {
  const root = makeFixture(FIXTURE);
  try {
    const before = buildAgentMap(root);
    writeFileSync(join(root, 'packages/a/src/wip.ts'), sourceLines(200));
    assert.equal(buildAgentMap(root).content, before.content);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('check fails on missing or drifted map; --write fixes it', () => {
  const root = makeFixture(FIXTURE);
  try {
    const missing = run(root);
    assert.equal(missing.status, 1, missing.output);
    assert.match(missing.output, /Agent map missing/);

    assert.equal(run(root, ['--write']).status, 0);
    assert.ok(existsSync(join(root, 'docs/agents/repo-map.generated.md')));
    assert.equal(run(root).status, 0);

    const mapPath = join(root, 'docs/agents/repo-map.generated.md');
    writeFileSync(mapPath, buildAgentMap(root).content + 'stale line\n');
    const stale = run(root);
    assert.equal(stale.status, 1, stale.output);
    assert.match(stale.output, /Agent map drift/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--staged compares the staged blob (pre-commit contract)', () => {
  const root = makeFixture(FIXTURE);
  try {
    assert.equal(run(root, ['--write']).status, 0);
    assert.equal(run(root, ['--staged']).status, 1, 'map is not staged yet');
    git(root, ['add', '-A']);
    // Adding the map itself changes tracked-file counts once; regenerate and re-stage.
    assert.equal(run(root, ['--write']).status, 0);
    git(root, ['add', '-A']);
    assert.equal(run(root, ['--staged']).status, 0, 'staged map matches staged tree');

    const mapPath = join(root, 'docs/agents/repo-map.generated.md');
    writeFileSync(mapPath, buildAgentMap(root).content + 'worktree-only edit\n');
    assert.equal(run(root, ['--staged']).status, 0, 'worktree-only edit is ignored by --staged');
    assert.equal(run(root).status, 1, 'worktree check still notices the edit');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unknown arguments and --write --staged fail closed', () => {
  const root = makeFixture(FIXTURE);
  try {
    assert.equal(run(root, ['--json']).status, 2);
    assert.equal(run(root, ['--write', '--staged']).status, 2);
    assert.equal(run(root, ['--help']).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
