import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { declarationNames, verifyDeclarations } from './refactor-verify.mjs';

const CLI = new URL('./refactor-verify.mjs', import.meta.url).pathname;
const BASE = `
export function entry() { return helper(1); }
function helper(value: number) { return value + BETA; }
const BETA = 2;
export interface Contract { id: string }
`;

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
});

test('declarationNames only reads top-level declarations', () => {
  const names = declarationNames(
    'function outer() { const inner = 1; return inner; }\nconst TOP = 1;',
    'x.ts',
  );
  assert.deepEqual(names, ['outer', 'TOP']);
});

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

test('CLI verifies an extraction against a git base', () => {
  const repo = mkdtempSync(join(tmpdir(), 'refactor-verify-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'test@example.invalid']);
  git(repo, ['config', 'user.name', 'test']);
  writeFileSync(join(repo, 'panel.ts'), BASE);
  git(repo, ['add', 'panel.ts']);
  git(repo, ['commit', '-qm', 'base']);
  mkdirSync(join(repo, 'moved'));
  writeFileSync(
    join(repo, 'panel.ts'),
    "export function entry() { return 2; }\nexport type { Contract } from './moved/helpers';\n",
  );
  writeFileSync(
    join(repo, 'moved', 'helpers.ts'),
    'function helper(v: number) { return v + 2; }\nconst BETA = 2;\nexport interface Contract { id: string }\n',
  );
  const pass = execFileSync(
    process.execPath,
    [CLI, '--base', 'HEAD', '--target', 'panel.ts', '--dest', 'moved'],
    { cwd: repo, encoding: 'utf8' },
  );
  assert.match(pass, /refactor-verify OK/);
  writeFileSync(
    join(repo, 'moved', 'helpers.ts'),
    'const BETA = 2;\ninterface Contract { id: string }\n',
  );
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [CLI, '--base', 'HEAD', '--target', 'panel.ts', '--dest', 'moved'],
        { cwd: repo, encoding: 'utf8', stdio: 'pipe' },
      ),
    /Command failed/,
  );
});
