#!/usr/bin/env node
/**
 * Scoped, reviewed visual-baseline update.
 *
 * A design change legitimately changes visual baselines, but a broad
 * `--update-snapshots` run silently blesses unrelated regressions and rewrites
 * every snapshot in the tree. This wrapper makes an intended update explicit:
 * exactly one spec + one Playwright project, a stated reason, serialized
 * through the heavy-task lease, `--update-snapshots=changed`, a before/after
 * snapshot diff for review, and a local review artifact under reports/.
 *
 * Usage:
 *   pnpm visual:update --spec tests/e2e/canvas/upscale-dialog-visual.spec.ts \
 *     --project chromium --reason "Enhance dialog spacing per design review"
 *   pnpm visual:update --spec ... --dry-run
 *
 * Policy: docs/quality/visual-validation.md.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { isMainModule } from '../is-main-module.mjs';

export const VISUAL_PROJECTS = new Set([
  'chromium',
  'chromium-snapshot',
  'chromium-visual-1x',
  'chromium-visual-2x',
  'chromium-visual-3x',
  'chromium-visual-gpu',
  'firefox-visual',
  'webkit-visual',
]);

const MIN_REASON_LENGTH = 20;

function git(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function repositoryRoot(cwd = process.cwd()) {
  const result = git(cwd, ['rev-parse', '--show-toplevel']);
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

export function parseVisualUpdateArgs(argv) {
  const options = { dryRun: false, help: false, project: 'chromium' };
  const valueFlags = new Set(['--spec', '--project', '--reason']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error('unexpected argument ' + arg);
    const equals = arg.indexOf('=');
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    if (!valueFlags.has(flag)) throw new Error('unknown option ' + flag);
    let value;
    if (equals !== -1) value = arg.slice(equals + 1);
    else {
      index += 1;
      value = argv[index];
    }
    if (value === undefined || value === '') throw new Error('missing value for ' + flag);
    if (flag === '--spec') options.spec = value;
    else if (flag === '--project') options.project = value;
    else options.reason = value;
  }
  return options;
}

export function resolveSpecPath(root, value) {
  if (!value) return { error: '--spec is required' };
  const absolute = value.startsWith('/') ? value : resolve(root, value);
  const allowedRoot = resolve(root, 'tests/e2e') + sep;
  if (!absolute.startsWith(allowedRoot)) return { error: 'spec must live under tests/e2e/' };
  if (!absolute.endsWith('.spec.ts')) return { error: 'spec must be a *.spec.ts file' };
  if (!existsSync(absolute)) return { error: 'spec does not exist: ' + relative(root, absolute) };
  return { path: absolute };
}

export function snapshotWorktreeChanges(root) {
  const result = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (result.status !== 0) return [];
  const changes = [];
  for (const entry of result.stdout.split('\0')) {
    if (!entry) continue;
    const path = entry.slice(3).trim();
    if (path.includes('-snapshots/')) changes.push({ status: entry.slice(0, 2).trim(), path });
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

export function artifactPath(root, specPath, project) {
  const slug = basename(specPath, '.spec.ts')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .slice(0, 60);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(
    root,
    'reports',
    'visual-baseline-updates',
    stamp + '-' + slug + '-' + project + '.json',
  );
}

function updateCommand(specPath, project) {
  return [
    'node',
    'scripts/quality/heavy-lease.mjs',
    'visual update: ' + basename(specPath),
    '--',
    'pnpm',
    'exec',
    'playwright',
    'test',
    specPath,
    '--project=' + project,
    '--workers=1',
    '--retries=0',
    '--update-snapshots=changed',
  ];
}

export function runVisualUpdate(options, { root = process.cwd(), invoke = spawnSync } = {}) {
  const spec = resolveSpecPath(root, options.spec);
  if (spec.error) {
    console.error('visual:update: ' + spec.error);
    return 2;
  }
  if (!VISUAL_PROJECTS.has(options.project)) {
    console.error('visual:update: unknown project ' + JSON.stringify(options.project));
    return 2;
  }
  const reason = options.reason ?? process.env.VARVE_VISUAL_REASON ?? '';
  if (reason.trim().length < MIN_REASON_LENGTH) {
    console.error(
      'visual:update: --reason (or VARVE_VISUAL_REASON) must state the design intent (>= ' +
        MIN_REASON_LENGTH +
        ' chars)',
    );
    return 2;
  }
  if (!existsSync(join(root, 'scripts/quality/heavy-lease.mjs'))) {
    console.error('visual:update must run from the repository root');
    return 2;
  }
  const argv = updateCommand(spec.path, options.project);
  if (options.dryRun) {
    console.log('visual:update (dry run)');
    console.log('  spec:    ' + relative(root, spec.path));
    console.log('  project: ' + options.project);
    console.log('  reason:  ' + reason.trim());
    console.log('  command: ' + argv.join(' '));
    console.log(
      '  review artifact: ' + relative(root, artifactPath(root, spec.path, options.project)),
    );
    return 0;
  }
  const before = snapshotWorktreeChanges(root);
  console.log(
    'visual:update: ' +
      relative(root, spec.path) +
      ' (' +
      options.project +
      ') under the heavy-task lease',
  );
  const result = invoke(argv[0], argv.slice(1), { cwd: root, stdio: 'inherit' });
  const exitCode = result.status ?? 1;
  const after = snapshotWorktreeChanges(root);
  const beforeKey = new Set(before.map((entry) => entry.status + ' ' + entry.path));
  const changed = after.filter((entry) => !beforeKey.has(entry.status + ' ' + entry.path));
  const head = git(root, ['rev-parse', 'HEAD']).stdout?.trim() ?? 'unknown';
  const artifact = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    head,
    spec: relative(root, spec.path),
    project: options.project,
    reason: reason.trim(),
    command: argv,
    exitCode,
    changedBaselines: changed,
    otherSnapshotWorktreeChanges: after.filter((entry) => !changed.includes(entry)),
  };
  const target = artifactPath(root, spec.path, options.project);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, JSON.stringify(artifact, null, 2) + '\n');

  console.log('');
  console.log('Review before committing:');
  console.log(
    '  changed baselines: ' +
      (changed.length
        ? changed.map((entry) => entry.status + ' ' + entry.path).join(', ')
        : '(none)'),
  );
  if (artifact.otherSnapshotWorktreeChanges.length) {
    console.log(
      '  other snapshot worktree changes (not attributed to this run): ' +
        artifact.otherSnapshotWorktreeChanges.length,
    );
  }
  console.log('  review artifact: ' + relative(root, target));
  console.log('  checks: pnpm audit:visual-baselines && pnpm verify:agent');
  console.log('  commit message must include the reason; keep only intended baseline changes.');
  if (exitCode !== 0) {
    console.error('visual:update: playwright exited ' + exitCode);
    return exitCode;
  }
  if (changed.length === 0) {
    console.error(
      'visual:update: no baseline changes were recorded; verify the spec/project and current state',
    );
    return 1;
  }
  return 0;
}

export function runVisualUpdateCli(root = process.cwd(), argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseVisualUpdateArgs(argv);
  } catch (error) {
    console.error('visual:update: ' + error.message);
    return 2;
  }
  if (options.help) {
    console.log(
      'Usage: pnpm visual:update --spec <tests/e2e/...spec.ts> [--project chromium] --reason "<intent>" [--dry-run]',
    );
    return 0;
  }
  return runVisualUpdate(options, { root });
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runVisualUpdateCli(process.cwd());
}
