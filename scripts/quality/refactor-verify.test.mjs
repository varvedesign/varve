#!/usr/bin/env node
/**
 * Regression tests for the code-motion declaration verifier.
 *
 * Pure comparison tests run in-process; CLI tests build throwaway git checkouts
 * in temp directories so the real repository index is never touched. Every
 * fixture is removed in a finally block.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { declarationNames, exportedNames, verifyDeclarations } from './refactor-verify.mjs';

const CLI = fileURLToPath(new URL('./refactor-verify.mjs', import.meta.url));
const BASE = `
export function entry() { return helper(1); }
function helper(value: number) { return value + BETA; }
const BETA = 2;
export interface Contract { id: string }
`;
const TARGET =
  "export function entry() { return 2; }\nexport type { Contract } from './moved/helpers';\n";
const HELPERS =
  'function helper(v: number) { return v + 2; }\nconst BETA = 2;\nexport interface Contract { id: string }\n';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function runCli(cwd, args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      status: typeof error.status === 'number' ? error.status : 1,
      stdout: String(error.stdout ?? ''),
      stderr: String(error.stderr ?? ''),
    };
  }
}

function withTempDir(body) {
  const dir = mkdtempSync(join(tmpdir(), 'refactor-verify-'));
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A committed pre-move panel.ts plus its extracted destination. */
function withExtractionRepo(body) {
  return withTempDir((repo) => {
    git(repo, ['init', '-q']);
    git(repo, ['config', 'user.email', 'test@example.invalid']);
    git(repo, ['config', 'user.name', 'test']);
    writeFileSync(join(repo, 'panel.ts'), BASE);
    git(repo, ['add', 'panel.ts']);
    git(repo, ['commit', '-qm', 'base']);
    mkdirSync(join(repo, 'moved'));
    writeFileSync(join(repo, 'panel.ts'), TARGET);
    writeFileSync(join(repo, 'moved', 'helpers.ts'), HELPERS);
    return body(repo);
  });
}

test('passes when every declaration moved to the destination', () => {
  const result = verifyDeclarations({
    baseSource: BASE,
    baseName: 'panel.tsx',
    targetSource: 'export function entry() { return 1; }',
    targetName: 'panel.tsx',
    destSources: [
      {
        source:
          'function helper(v: number) { return v + 2; }\nconst BETA = 2;\ninterface Contract { id: string }',
        name: 'dest/helpers.ts',
      },
    ],
  });
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.missingExports, ['Contract']);
  assert.equal(result.baseCount, 4);
  assert.equal(result.ok, false);
});

test('accepts a barrel re-export as preserving the exported name', () => {
  const result = verifyDeclarations({
    baseSource: 'export interface Contract { id: string }\nexport function entry() { return 1; }\n',
    baseName: 'panel.tsx',
    targetSource:
      "export function entry() { return 1; }\nexport type { Contract } from './moved/contract';\n",
    targetName: 'panel.tsx',
    destSources: [
      { source: 'export interface Contract { id: string }', name: 'moved/contract.ts' },
    ],
  });
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.missingExports, []);
  assert.equal(result.ok, true);
});

test('fails when a declaration disappears', () => {
  const result = verifyDeclarations({
    baseSource: BASE,
    baseName: 'panel.tsx',
    targetSource: 'export function entry() { return 1; }',
    targetName: 'panel.tsx',
    destSources: [{ source: 'const BETA = 2;', name: 'dest/helpers.ts' }],
  });
  assert.deepEqual(result.missing, ['Contract', 'helper']);
  assert.equal(result.ok, false);
});

test('declarationNames only reads top-level declarations', () => {
  const names = declarationNames(
    'function outer() { const inner = 1; return inner; }\nconst TOP = 1;',
    'x.ts',
  );
  assert.deepEqual(names, ['outer', 'TOP']);
});

test('declarationNames collects every destructured variable binding', () => {
  const names = declarationNames(
    'const { alpha, beta: gamma, delta = 1 } = pair;\nconst [first, , third] = list;',
    'x.ts',
  );
  assert.deepEqual(names, ['alpha', 'gamma', 'delta', 'first', 'third']);
});

test('declarationNames collects module and namespace declarations', () => {
  const names = declarationNames(
    'namespace Tools {}\nexport namespace Public {}\ndeclare global {}',
    'x.ts',
  );
  assert.deepEqual(names, ['Tools', 'Public', 'global']);
});

test('exportedNames tracks modifiers, named lists, namespace and default exports', () => {
  const names = exportedNames(
    "export function keep() {}\nexport type { Move } from './moved';\nexport * as ns from './moved';\nexport default 42;",
    'x.ts',
  );
  for (const expected of ['keep', 'Move', 'ns', 'default']) assert.ok(names.includes(expected));
  const declared = exportedNames('export default function Widget() {}', 'x.ts');
  assert.ok(declared.includes('Widget'));
  assert.ok(declared.includes('default'));
});

test('an exported declaration moved to the destination stays preserved', () => {
  const result = verifyDeclarations({
    baseSource: 'export function helper() { return 1; }\n',
    baseName: 'panel.tsx',
    targetSource: '',
    targetName: 'panel.tsx',
    destSources: [{ source: 'export function helper() { return 2; }', name: 'moved/helpers.ts' }],
  });
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.missingExports, []);
  assert.equal(result.ok, true);
});

test('CLI verifies an extraction against a git base', () => {
  withExtractionRepo((repo) => {
    const pass = runCli(repo, ['--base', 'HEAD', '--target', 'panel.ts', '--dest', 'moved']);
    assert.equal(pass.status, 0, pass.stderr);
    assert.match(pass.stdout, /refactor-verify OK/);

    writeFileSync(join(repo, 'moved', 'helpers.ts'), 'const BETA = 2;\n');
    const fail = runCli(repo, ['--base', 'HEAD', '--target', 'panel.ts', '--dest', 'moved']);
    assert.equal(fail.status, 1, fail.stderr);
    assert.match(fail.stderr, /Missing declaration\(s\): .*helper/);
  });
});

test('CLI --json prints the machine-readable result on pass and fail', () => {
  withExtractionRepo((repo) => {
    const pass = runCli(repo, [
      '--base',
      'HEAD',
      '--target',
      'panel.ts',
      '--dest',
      'moved',
      '--json',
    ]);
    assert.equal(pass.status, 0, pass.stderr);
    const passed = JSON.parse(pass.stdout);
    assert.equal(passed.ok, true);
    assert.equal(passed.baseCount, 4);
    assert.deepEqual(passed.missing, []);
    assert.deepEqual(passed.missingExports, []);

    writeFileSync(join(repo, 'panel.ts'), 'export function entry() { return 2; }\n');
    writeFileSync(join(repo, 'moved', 'helpers.ts'), 'const BETA = 2;\n');
    const fail = runCli(repo, [
      '--base',
      'HEAD',
      '--target',
      'panel.ts',
      '--dest',
      'moved',
      '--json',
    ]);
    assert.equal(fail.status, 1, fail.stderr);
    const failed = JSON.parse(fail.stdout);
    assert.equal(failed.ok, false);
    assert.ok(failed.missing.includes('helper'));
    assert.deepEqual(failed.missingExports, ['Contract']);
  });
});

test('CLI --help exits 0 and documents the interface', () => {
  withTempDir((dir) => {
    const result = runCli(dir, ['--help']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /--base <git-ref>/);
    assert.match(result.stdout, /Exit codes: 0/);
  });
});

test('CLI usage errors exit 2', () => {
  withTempDir((dir) => {
    const missing = runCli(dir, []);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /missing --base/);
    const unknown = runCli(dir, ['--json', '--bogus']);
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /unknown argument: --bogus/);
  });
});

test('CLI IO errors exit 2', () => {
  withExtractionRepo((repo) => {
    const badBase = runCli(repo, ['--base', 'NOPE', '--target', 'panel.ts']);
    assert.equal(badBase.status, 2);
    assert.match(badBase.stderr, /cannot read panel.ts at NOPE/);
    const badDest = runCli(repo, ['--base', 'HEAD', '--target', 'panel.ts', '--dest', 'missing']);
    assert.equal(badDest.status, 2);
    assert.match(badDest.stderr, /cannot read --dest missing/);
  });
});
