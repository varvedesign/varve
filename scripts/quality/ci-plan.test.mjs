#!/usr/bin/env node

/** Canonical local/CI planner parity and bounded command construction tests. */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forcedCheckboxActions } from './audit-e2e-interactions.mjs';
import { buildCiPlan, parseArgs, validateCiPlan } from './ci-plan.mjs';
import { preflightCommands } from './ci-preflight.mjs';
import { laneArgv } from './validation-lanes.mjs';
import {
  CI_CATEGORIES,
  FULL_BROWSER_SHARDS,
  deriveCiCategories,
  libraryLane,
  promisedLanesForCategories,
  selectedCiLanes,
} from './validation-policy.mjs';

// Linked worktrees have a .git pointer file, not a .git/HEAD path.
const head = execFileSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
  encoding: 'utf8',
}).trim();
assert.match(head, /^[0-9a-f]{40,64}$/, 'test repository has a commit HEAD');
const actualHead = buildCiPlan({ base: 'HEAD', head: 'HEAD', profile: 'integration' }).commitSha;
assert.equal(actualHead, head);
assert.equal(parseArgs(['--disable-library-lane']).disableLibraryLane, true);
const full = buildCiPlan({
  base: actualHead,
  head: actualHead,
  profile: 'candidate',
  forceFull: true,
});
assert.equal(full.globalImpact, true);
assert.deepEqual(
  Object.values(full.categories),
  CI_CATEGORIES.map(() => true),
);
assert.deepEqual(full.selectedLanes, promisedLanesForCategories(full.categories, 'candidate'));
assert.equal(full.candidateMode, 'final');
assert.equal(full.e2eShardCount, FULL_BROWSER_SHARDS);
assert.deepEqual(
  full.e2eShards,
  Array.from({ length: FULL_BROWSER_SHARDS }, (_, index) => index + 1),
);
assert.ok(
  validateCiPlan({ ...full, e2eShardCount: 1, e2eShards: [1] }).length,
  'a shortened full-suite matrix cannot retain certification',
);
assert.ok(
  validateCiPlan({ ...full, selectedLanes: ['e2e:all'] }).includes(
    'CI plan integrity hash mismatch',
  ),
  'a shortened lane list cannot retain the original plan hash',
);
assert.deepEqual(
  validateCiPlan(full, { expectedHead: actualHead, expectedPolicyHash: full.policyHash }),
  [],
);
const triagePlan = buildCiPlan({
  base: actualHead,
  head: actualHead,
  profile: 'candidate',
  mode: 'triage',
  forceFull: true,
});
assert.equal(triagePlan.candidateMode, 'triage');
assert.throws(
  () => buildCiPlan({ base: actualHead, head: actualHead, profile: 'candidate', mode: 'unknown' }),
  /invalid candidate mode/,
);

// Only paths inside the nine named crate trees select the library lane.
assert.deepEqual(
  libraryLane(['crates/varve-core/src/lib.rs', 'crates/varve-media/tests/decode.rs']),
  { selected: true, packages: ['varve-core', 'varve-media'] },
);
assert.deepEqual(libraryLane(['crates/varve-core/src/lib.rs', 'Cargo.lock']), {
  selected: false,
  packages: [],
});
assert.deepEqual(libraryLane(['Cargo.lock']), { selected: false, packages: [] });
assert.deepEqual(libraryLane(['Cargo.toml']), { selected: false, packages: [] });
assert.deepEqual(libraryLane(['crates/varve-wasm/src/lib.rs']), {
  selected: false,
  packages: [],
});
assert.deepEqual(libraryLane([]), { selected: false, packages: [] });
const cargoChangeCategories = {
  pipeline: true, js: false, rust: true, wasm: true, website: false,
  e2e: false, visual: false, desktop: true, models: false, bench: false,
};
const cargoChangeLanes = selectedCiLanes(
  { tiers: {}, rootCargoChanged: true },
  cargoChangeCategories,
);
for (const lane of ['rust-test:all', 'rust-clippy:all', 'cargo-fmt', 'wasm', 'desktop-native'])
  assert.ok(cargoChangeLanes.includes(lane), `root Cargo changes select ${lane}`);
for (const manifest of ['Cargo.toml', 'Cargo.lock']) {
  const categories = deriveCiCategories(
    { changed: { js: [], rust: [], other: [], app: [] }, tiers: {}, full: false },
    [manifest],
  );
  assert.equal(categories.rust, true, `${manifest} selects Rust`);
  assert.equal(categories.wasm, true, `${manifest} selects WASM`);
  assert.equal(categories.desktop, true, `${manifest} selects desktop`);
}
const laneRoot = mkdtempSync(join(tmpdir(), 'varve-ci-lane-'));
try {
  const git = (...args) => execFileSync('git', args, { cwd: laneRoot, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'CI Planner Test');
  git('config', 'user.email', 'ci-planner@example.invalid');
  const plannerFor = (files) => ({
    tiers: { 0: [], 1: [], 2: [], 3: [], 4: [] },
    changed: {
      js: [],
      rust: files.filter((file) => file.startsWith('crates/')).map((file) => file.split('/')[1]),
      other: [],
      app: [],
    },
    directE2eFiles: [], e2eDomains: [], benchDomains: [], full: false,
    stats: { jsPackages: [], rustCrates: [] },
  });
  mkdirSync(join(laneRoot, 'crates/varve-core/src'), { recursive: true });
  writeFileSync(join(laneRoot, 'crates/varve-core/src/lib.rs'), 'pub fn core() {}\n');
  git('add', '.');
  git('commit', '-qm', 'fixture baseline');
  const base = git('rev-parse', 'HEAD');
  mkdirSync(join(laneRoot, 'crates/varve-media/src'), { recursive: true });
  writeFileSync(join(laneRoot, 'crates/varve-media/src/lib.rs'), 'pub fn media() {}\n');
  git('add', '.');
  git('commit', '-qm', 'library change');
  const libraryHead = git('rev-parse', 'HEAD');
  const libraryPlan = buildCiPlan({
    base, head: libraryHead, root: laneRoot, planner: plannerFor,
  });
  assert.equal(libraryPlan.libraryOnly, true);
  assert.deepEqual(libraryPlan.libraryPackages, ['varve-media']);
  assert.deepEqual(validateCiPlan(libraryPlan), []);

  writeFileSync(join(laneRoot, 'Cargo.lock'), '# workspace lockfile change\n');
  git('add', '.');
  git('commit', '-qm', 'root lock change');
  const lockHead = git('rev-parse', 'HEAD');
  const lockPlan = buildCiPlan({ base: libraryHead, head: lockHead, root: laneRoot, planner: plannerFor });
  assert.equal(lockPlan.libraryOnly, false, 'Cargo.lock does not select library-only lane');
  assert.deepEqual(lockPlan.libraryPackages, []);
  assert.equal(lockPlan.categories.rust, true);
  assert.equal(lockPlan.categories.wasm, true);
  assert.equal(lockPlan.categories.desktop, true);
  for (const lane of ['rust-test:all', 'rust-clippy:all', 'cargo-fmt', 'wasm', 'desktop-native'])
    assert.ok(lockPlan.selectedLanes.includes(lane), `Cargo.lock changes select ${lane}`);
  assert.deepEqual(validateCiPlan(lockPlan), []);
} finally {
  rmSync(laneRoot, { recursive: true, force: true });
}

const browserSpec = buildCiPlan({
  base: 'HEAD',
  head: 'HEAD',
  planner: () => ({
    tiers: { 0: [], 1: ['e2e:file:tests/e2e/canvas/tools.spec.ts'], 2: [], 3: [], 4: [] },
    changed: { js: [], rust: [], other: [], app: [] },
    directE2eFiles: ['tests/e2e/canvas/tools.spec.ts'],
    e2eDomains: [],
    benchDomains: [],
    full: false,
    stats: { jsPackages: [], rustCrates: [] },
  }),
});
assert.equal(browserSpec.categories.e2e, true, 'a direct E2E spec selects the browser consumer');
assert.ok(browserSpec.selectedLanes.includes('e2e:file:tests/e2e/canvas/tools.spec.ts'));
assert.ok(!browserSpec.selectedLanes.includes('e2e:all'));
assert.deepEqual(browserSpec.e2eShards, [1], 'a focused browser lane uses one shard');

// A large range is chunked into bounded argv calls. Paths remain individual
// arguments, so whitespace/unusual characters cannot become shell syntax.
const manyFiles = Array.from({ length: 2000 }, (_, index) =>
  index % 2 ? 'package.json' : 'pnpm-lock.yaml',
);
const commands = preflightCommands({ files: manyFiles, plan: { tiers: { 1: [], 2: [] } } });
const biomeCommands = commands.filter(
  (command) => command[0] === 'pnpm' && command.includes('biome'),
);
assert.ok(biomeCommands.length >= 13, 'thousands of files require chunked Biome commands');
assert.ok(biomeCommands.every((command) => command.length <= 86));
assert.ok(biomeCommands.every((command) => !command.includes('--check')));
assert.ok(biomeCommands.every((command) => !command.includes('-c') && !command.includes('sh')));
assert.deepEqual(laneArgv('format:changed', { files: ['package.json'] }), [
  'biome',
  'format',
  'package.json',
]);
assert.deepEqual(laneArgv('demo-dist-validation'), [
  'node',
  'scripts/website/demo-dist-validation.test.mjs',
]);
const unusualRoot = mkdtempSync(join(tmpdir(), 'varve-preflight-paths-'));
try {
  writeFileSync(join(unusualRoot, 'path with spaces-[odd].ts'), 'export {}\n');
  const unusual = preflightCommands(
    {
      files: ['path with spaces-[odd].ts'],
      plan: { tiers: { 1: [], 2: [] } },
    },
    { root: unusualRoot },
  );
  assert.ok(unusual.some((command) => command.includes('path with spaces-[odd].ts')));
} finally {
  rmSync(unusualRoot, { recursive: true, force: true });
}

// Workflow conditions and the local planner use the same profile vocabulary.
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
assert.match(ci, /ci-plan\.mjs/);
assert.match(ci, /--profile integration/);
assert.match(ci, /--force-full/);
assert.match(ci, /commit_sha/);
assert.match(ci, /fromJSON\(needs\.changes\.outputs\.e2e_shards\)/);

// A late green/red shard divergence must not reintroduce clipped-input clicks.
for (const method of ['check', 'uncheck', 'setChecked']) {
  const args = method === 'setChecked' ? 'true, ' : '';
  assert.equal(forcedCheckboxActions(`input.${method}(${args}{force: true})`).length, 1);
  assert.equal(forcedCheckboxActions(`input.${method}(${args}{\n 'force': enabled\n})`).length, 1);
  assert.equal(forcedCheckboxActions(`input.${method}(${args}{force: false})`).length, 0);
}
assert.equal(forcedCheckboxActions('// input.check({force: true})\nlabel.click()').length, 0);
assert.equal(forcedCheckboxActions('input.check({\nforce: true\n})')[0].line, 1);
assert.throws(() => forcedCheckboxActions('input.check({'), /Invalid E2E syntax/);
assert.match(ci, /run: node scripts\/quality\/audit-e2e-interactions\.mjs/);
assert.match(
  readFileSync('.github/workflows/release-candidate.yml', 'utf8'),
  /run: node scripts\/quality\/audit-e2e-interactions\.mjs/,
);

console.log('CI plan tests passed');
