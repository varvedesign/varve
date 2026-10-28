#!/usr/bin/env node
/**
 * Regression tests for the god-file seam planner.
 *
 * Fixtures are written to throwaway temp directories and removed in finally
 * blocks; the real repository tree is never modified.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { formatPlan, planGodFile } from './godsplit-plan.mjs';

const CLI = fileURLToPath(new URL('./godsplit-plan.mjs', import.meta.url));

function withTempDir(body) {
  const dir = mkdtempSync(join(tmpdir(), 'godsplit-plan-'));
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeFixture(dir, lines, fileName = 'fixture.ts') {
  const file = join(dir, fileName);
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
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

const BIG_FUNCTION = [
  'export function big() {',
  ...Array.from({ length: 360 }, (_, index) => `  const value${index} = ${index};`),
  '}',
];

const SAMPLE = [
  '/** Shared contract. */',
  'export interface Alpha { id: string }',
  '',
  'const BETA = 2;',
  '',
  'function helper(value: number) { return value + BETA; }',
  '',
  'export function entry() { return helper(1); }',
];

test('lists top-level blocks with ranges and doc summaries', () => {
  withTempDir((dir) => {
    const plan = planGodFile(writeFixture(dir, SAMPLE));
    assert.equal(plan.unsupported, false);
    assert.equal(plan.blocks.length, 4);
    assert.deepEqual(
      plan.blocks.map((block) => block.name),
      ['Alpha', 'BETA', 'helper', 'entry'],
    );
    assert.equal(plan.blocks[0].doc, 'Shared contract.');
    assert.equal(plan.blocks[0].exported, true);
    assert.equal(plan.blocks[3].exported, true);
    assert.equal(plan.blocks[1].exported, false);
    assert.match(formatPlan(plan), /God-file seam plan/);
  });
});

test('flags a declaration that is over the cap on its own', () => {
  withTempDir((dir) => {
    const plan = planGodFile(writeFixture(dir, BIG_FUNCTION));
    assert.ok(
      plan.hazards.some(
        (hazard) => hazard.includes('sub-split required') && hazard.includes('big'),
      ),
    );
  });
});

test('plans module, default-export and destructured declarations', () => {
  withTempDir((dir) => {
    const plan = planGodFile(
      writeFixture(dir, [
        'export namespace Tools { export const x = 1; }',
        'export default class Widget {}',
        'declare global {}',
        'const { alpha, beta: gamma } = pair;',
      ]),
    );
    assert.deepEqual(
      plan.blocks.map((block) => block.name),
      ['Tools', 'Widget', 'global', 'alpha, gamma'],
    );
    assert.deepEqual(
      plan.blocks.map((block) => block.exported),
      [true, true, false, false],
    );
    assert.deepEqual(
      plan.blocks.map((block) => block.kind),
      ['Module', 'Class', 'Module', 'Variable'],
    );
  });
});

test('reports unsupported extensions instead of guessing', () => {
  withTempDir((dir) => {
    const file = join(dir, 'fixture.rs');
    writeFileSync(file, 'fn main() {}\n');
    const plan = planGodFile(file);
    assert.equal(plan.unsupported, true);
    assert.match(plan.hazards[0], /unsupported file extension/);
  });
});

test('counts lines for unsupported extensions consistently', () => {
  withTempDir((dir) => {
    const file = join(dir, 'fixture.rs');
    writeFileSync(file, 'fn main() {}\n');
    assert.equal(planGodFile(file).totalLines, 1);
  });
});

test('CLI prints a JSON plan', () => {
  withTempDir((dir) => {
    const file = writeFixture(dir, SAMPLE);
    const result = runCli(dir, [file, '--json']);
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.file, file);
    assert.equal(plan.unsupported, false);
    assert.equal(plan.blocks.length, 4);
  });
});

test('CLI --help exits 0 and documents the interface', () => {
  withTempDir((dir) => {
    const result = runCli(dir, ['--help']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /--json/);
    assert.match(result.stdout, /Exit codes: 0/);
  });
});

test('CLI usage errors exit 2', () => {
  withTempDir((dir) => {
    const missing = runCli(dir, []);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /missing <file>/);
    const unknown = runCli(dir, ['--bogus']);
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /unknown argument: --bogus/);
  });
});

test('CLI unreadable or unsupported input exits 2', () => {
  withTempDir((dir) => {
    const missing = runCli(dir, [join(dir, 'absent.ts')]);
    assert.equal(missing.status, 2);
    const unsupported = runCli(dir, [join(dir, 'fixture.rs')]);
    assert.equal(unsupported.status, 2);
    writeFileSync(join(dir, 'fixture.rs'), 'fn main() {}\n');
    const rust = runCli(dir, [join(dir, 'fixture.rs')]);
    assert.equal(rust.status, 2);
    assert.match(rust.stderr, /unsupported file extension/);
  });
});
