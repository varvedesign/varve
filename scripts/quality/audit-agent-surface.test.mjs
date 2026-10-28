#!/usr/bin/env node
/**
 * Regression tests for the agent-context surface audit.
 *
 * Every fixture builds a throwaway repository root in a temp directory: the
 * three search-ignore files, an AGENTS.md index with a "Read next" table, and
 * docs/README.md rows. The real repository is read but never mutated, and one
 * test asserts the current tree passes so the guard cannot rot silently.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AGENTS_MAX_BYTES,
  AGENTS_MAX_LINES,
  checkAgentSurface,
  REQUIRED_IGNORE_PATTERNS,
} from './audit-agent-surface.mjs';

const scriptPath = fileURLToPath(new URL('./audit-agent-surface.mjs', import.meta.url));
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

const IGNORE_RULES = [
  '# fixture search-ignore rules',
  ...REQUIRED_IGNORE_PATTERNS,
  'vendor/',
  '',
].join('\n');

const AGENTS_MD = [
  '# AGENTS.md - fixture index',
  '',
  '## Read next',
  '',
  '| File | Load it for |',
  '|------|-------------|',
  '| `docs/README.md` | docs index |',
  '| `docs/agents/agent-context-economy.md` | context policy |',
  '| `docs/quality/file-size-policy.md` | size budget |',
  '| `https://example.com/remote.md` / `/abs/local.md` / `config.json` | ignored forms |',
  '',
].join('\n');

const DOCS_README_MD = [
  '# Docs',
  '',
  '| Doc | Purpose |',
  '|-----|---------|',
  '| `agents/agent-context-economy.md` | context policy |',
  '| `quality/file-size-policy.md` | size budget |',
  '',
].join('\n');

function fixtureFiles(overrides = {}) {
  return {
    '.ignore': IGNORE_RULES,
    '.dshignore': IGNORE_RULES,
    '.opencodeignore': IGNORE_RULES,
    'AGENTS.md': AGENTS_MD,
    'docs/README.md': DOCS_README_MD,
    'docs/agents/agent-context-economy.md': '# Context economy\n',
    'docs/quality/file-size-policy.md': '# File size policy\n',
    ...overrides,
  };
}

/** Build an AGENTS.md fixture with an exact line count. */
function agentsIndexWithLines(totalLines) {
  const lines = AGENTS_MD.trimEnd().split('\n');
  while (lines.length < totalLines) lines.push('filler line for the AGENTS.md budget');
  return `${lines.join('\n')}\n`;
}

/** @param {Record<string, string | null>} files repository-relative path -> content */
function makeFixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'audit-agent-surface-'));
  for (const [file, content] of Object.entries(files)) {
    if (content === null) continue;
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

function withFixture(files, body) {
  const root = makeFixture(files);
  try {
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

test('clean fixture passes with no findings and the CLI exits 0', () => {
  withFixture(fixtureFiles(), (root) => {
    const result = checkAgentSurface({ root });
    assert.deepEqual(result.findings, []);
    assert.equal(result.stats.ignoreFiles, 3);
    assert.equal(result.stats.ignoreIdentical, true);
    assert.equal(result.stats.ignorePatterns, REQUIRED_IGNORE_PATTERNS.length);
    assert.equal(result.stats.agentsLines, 10);
    assert.equal(result.stats.pointerTargets, 3);
    assert.equal(result.stats.missingPointerTargets, 0);
    assert.equal(result.stats.readmeRows, 2);
    const cli = runCli(root);
    assert.equal(cli.status, 0, cli.output);
    assert.match(cli.output, /Agent-context surface OK/);
    const json = runCli(root, ['--json']);
    assert.equal(json.status, 0, json.output);
    const payload = JSON.parse(json.output);
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.findings, []);
  });
});

test('byte-different ignore files fail and name the divergent file', () => {
  withFixture(fixtureFiles({ '.dshignore': `${IGNORE_RULES}extra-build/\n` }), (root) => {
    const result = checkAgentSurface({ root });
    assert.equal(result.stats.ignoreIdentical, false);
    assert.equal(result.findings.length, 1, JSON.stringify(result.findings));
    assert.match(result.findings[0], /^\.dshignore: not byte-identical to \.ignore/);
    assert.match(result.findings[0], /keep all three search-ignore files identical/);
    const cli = runCli(root);
    assert.equal(cli.status, 1, cli.output);
    assert.match(cli.output, /Agent-context surface drift: 1 finding/);
  });
});

test('a missing required ignore pattern is reported per file', () => {
  const incomplete = REQUIRED_IGNORE_PATTERNS.filter((pattern) => pattern !== '.worktrees/');
  withFixture(fixtureFiles({ '.opencodeignore': `${incomplete.join('\n')}\n` }), (root) => {
    const result = checkAgentSurface({ root });
    assert.equal(result.stats.ignorePatterns, REQUIRED_IGNORE_PATTERNS.length - 1);
    assert.ok(
      result.findings.some((finding) =>
        finding.includes('.opencodeignore: missing required search-ignore pattern: .worktrees/'),
      ),
      JSON.stringify(result.findings),
    );
  });
});

test('a missing ignore file fails closed instead of skipping the check', () => {
  withFixture(fixtureFiles({ '.dshignore': null }), (root) => {
    const result = checkAgentSurface({ root });
    assert.equal(result.stats.ignoreFiles, 2);
    assert.equal(result.stats.ignoreIdentical, false);
    assert.ok(
      result.findings.some((finding) =>
        finding.includes('.dshignore: required search-ignore file is missing'),
      ),
      JSON.stringify(result.findings),
    );
  });
});

test('AGENTS.md over the line budget fails', () => {
  withFixture(fixtureFiles({ 'AGENTS.md': agentsIndexWithLines(AGENTS_MAX_LINES + 1) }), (root) => {
    const result = checkAgentSurface({ root });
    assert.equal(result.stats.agentsLines, AGENTS_MAX_LINES + 1);
    assert.equal(result.findings.length, 1, JSON.stringify(result.findings));
    assert.match(result.findings[0], /151 lines exceeds the 150-line index budget/);
  });
});

test('AGENTS.md over the byte budget fails', () => {
  const oversized = `${AGENTS_MD}long filler line ${'x'.repeat(AGENTS_MAX_BYTES)}\n`;
  withFixture(fixtureFiles({ 'AGENTS.md': oversized }), (root) => {
    const result = checkAgentSurface({ root });
    assert.ok(result.stats.agentsBytes > AGENTS_MAX_BYTES);
    assert.equal(result.findings.length, 1, JSON.stringify(result.findings));
    assert.match(result.findings[0], /bytes exceeds the 9000-byte index budget/);
  });
});

test('a pointer target missing on disk fails with the dropped path', () => {
  const broken = AGENTS_MD.replace(
    '| `docs/README.md` | docs index |',
    '| `docs/README.md` | docs index |\n| `docs/agents/removed-playbook.md` | removed |',
  );
  withFixture(fixtureFiles({ 'AGENTS.md': broken }), (root) => {
    const result = checkAgentSurface({ root });
    assert.equal(result.stats.pointerTargets, 4);
    assert.equal(result.stats.missingPointerTargets, 1);
    assert.equal(result.findings.length, 1, JSON.stringify(result.findings));
    assert.ok(
      result.findings[0].includes(
        'pointer target missing on disk: docs/agents/removed-playbook.md',
      ),
      result.findings[0],
    );
  });
});

test('a pointer table with no repository-relative .md row fails closed', () => {
  const ignoredOnly = AGENTS_MD.replace(
    '| `docs/README.md` | docs index |\n' +
      '| `docs/agents/agent-context-economy.md` | context policy |\n' +
      '| `docs/quality/file-size-policy.md` | size budget |',
    '| `https://example.com/remote.md` / `/abs/local.md` / `config.json` | ignored forms |',
  );
  withFixture(fixtureFiles({ 'AGENTS.md': ignoredOnly }), (root) => {
    const result = checkAgentSurface({ root });
    assert.equal(result.stats.pointerTargets, 0);
    assert.ok(
      result.findings.some((finding) =>
        finding.includes('lists no repository-relative .md pointer'),
      ),
      JSON.stringify(result.findings),
    );
  });
});

test('docs/README.md missing a required index row fails', () => {
  const partial = [
    '# Docs',
    '',
    '| Doc | Purpose |',
    '|-----|---------|',
    '| `agents/agent-context-economy.md` | context policy |',
    '',
  ].join('\n');
  withFixture(fixtureFiles({ 'docs/README.md': partial }), (root) => {
    const result = checkAgentSurface({ root });
    assert.equal(result.stats.readmeRows, 1);
    assert.equal(result.stats.missingReadmeRows, 1);
    assert.ok(
      result.findings.some((finding) =>
        finding.includes('missing index table row for docs/quality/file-size-policy.md'),
      ),
      JSON.stringify(result.findings),
    );
  });
});

test('missing AGENTS.md and docs/README.md each fail closed', () => {
  withFixture(fixtureFiles({ 'AGENTS.md': null }), (root) => {
    const result = checkAgentSurface({ root });
    assert.equal(result.stats.agentsLines, null);
    assert.ok(
      result.findings.some((finding) =>
        finding.includes('AGENTS.md: required always-loaded agent index is missing'),
      ),
      JSON.stringify(result.findings),
    );
  });
  withFixture(fixtureFiles({ 'docs/README.md': null }), (root) => {
    const result = checkAgentSurface({ root });
    assert.ok(
      result.findings.some((finding) =>
        finding.includes('docs/README.md: required documentation index is missing'),
      ),
      JSON.stringify(result.findings),
    );
  });
});

test('--json reports findings machine-readably and exits 1', () => {
  withFixture(fixtureFiles({ '.ignore': '' }), (root) => {
    const cli = runCli(root, ['--json']);
    assert.equal(cli.status, 1, cli.output);
    const payload = JSON.parse(cli.output);
    assert.equal(payload.ok, false);
    assert.ok(payload.findings.length > 0);
    assert.match(payload.findings.join('\n'), /missing required search-ignore pattern/);
    assert.equal(payload.stats.ignoreFiles, 3);
  });
});

test('unknown arguments are rejected', () => {
  withFixture(fixtureFiles(), (root) => {
    const result = runCli(root, ['--bogus']);
    assert.equal(result.status, 2, result.output);
    assert.match(result.output, /Unknown argument/);
  });
});

test('the real repository passes the agent-context surface check', () => {
  const result = checkAgentSurface({ root: repoRoot });
  assert.deepEqual(result.findings, [], JSON.stringify(result.findings));
  assert.equal(result.stats.ignoreFiles, 3);
  assert.equal(result.stats.ignoreIdentical, true);
  assert.equal(result.stats.ignorePatterns, REQUIRED_IGNORE_PATTERNS.length);
  assert.ok(result.stats.agentsLines <= AGENTS_MAX_LINES);
  assert.ok(result.stats.agentsBytes <= AGENTS_MAX_BYTES);
  assert.ok(result.stats.pointerTargets > 0);
  assert.equal(result.stats.missingPointerTargets, 0);
  assert.equal(result.stats.readmeRows, 2);
});
