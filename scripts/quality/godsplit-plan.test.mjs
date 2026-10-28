import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { formatPlan, planGodFile } from './godsplit-plan.mjs';

function fixture(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'godsplit-plan-'));
  const file = join(dir, 'fixture.ts');
  writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

const BIG_FUNCTION = [
  'export function big() {',
  ...Array.from({ length: 360 }, (_, index) => '  const value' + index + ' = ' + index + ';'),
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
  const plan = planGodFile(fixture(SAMPLE));
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

test('flags a declaration that is over the cap on its own', () => {
  const plan = planGodFile(fixture(BIG_FUNCTION));
  assert.ok(
    plan.hazards.some((hazard) => hazard.includes('sub-split required') && hazard.includes('big')),
  );
});

test('reports unsupported extensions instead of guessing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'godsplit-plan-'));
  const file = join(dir, 'fixture.rs');
  writeFileSync(file, 'fn main() {}\n');
  const plan = planGodFile(file);
  assert.equal(plan.unsupported, true);
  assert.match(plan.hazards[0], /unsupported file extension/);
});
