#!/usr/bin/env node
/**
 * Cross-worktree status for concurrent-agent work.
 *
 * Lists every git worktree registered to this repository with the facts a
 * coordinator needs: branch, HEAD age, dirty/untracked counts, ahead/behind
 * base, merged state, whether it is safe to prune, and which validation-queue
 * lane is currently running. External worktrees (other tools/sessions) are
 * reported but never classified as removable.
 *
 * Usage:
 *   node scripts/quality/worktree-status.mjs [--json] [--min-age-days N]
 *
 * Diagnostics only: exits 0 when it can read the repository.
 */
import { execFileSync } from 'node:child_process';
import { resolve, sep } from 'node:path';
import { isMainModule } from '../is-main-module.mjs';
import { queueStatus } from './validation-queue-state.mjs';

const DEFAULT_MIN_AGE_DAYS = 14;

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 16 * 1024 * 1024,
  });
}

function tryGit(cwd, args) {
  try {
    return git(cwd, args);
  } catch {
    return null;
  }
}

export function repositoryRoot(cwd = process.cwd()) {
  const root = tryGit(cwd, ['rev-parse', '--show-toplevel']);
  return root ? root.trim() : null;
}

export function listWorktrees(root) {
  const raw = git(root, ['worktree', 'list', '--porcelain']);
  const entries = [];
  let current = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) entries.push(current);
      current = { path: line.slice('worktree '.length).trim() };
    } else if (line.startsWith('HEAD ') && current) {
      current.head = line.slice('HEAD '.length).trim();
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).replace('refs/heads/', '').trim();
    } else if (line === 'detached' && current) {
      current.branch = null;
    }
  }
  if (current) entries.push(current);
  return entries;
}

function baseReference(root) {
  for (const candidate of ['origin/master', 'master']) {
    if (tryGit(root, ['rev-parse', '--verify', '--quiet', candidate + '^{commit}']))
      return candidate;
  }
  return null;
}

function workingTreeCounts(path) {
  const raw = tryGit(path, ['status', '--porcelain=v1', '-z', '--untracked-files=normal']);
  if (raw === null) return { tracked: 0, untracked: 0, readable: false };
  let tracked = 0;
  let untracked = 0;
  for (const entry of raw.split('\0')) {
    if (!entry) continue;
    if (entry.startsWith('?? ')) untracked += 1;
    else tracked += 1;
  }
  return { tracked, untracked, readable: true };
}

function aheadBehind(path, base) {
  if (!base) return { ahead: 0, behind: 0 };
  const raw = tryGit(path, ['rev-list', '--left-right', '--count', base + '...HEAD']);
  if (!raw) return { ahead: 0, behind: 0 };
  const [behind, ahead] = raw.trim().split(/\s+/).map(Number);
  return { behind: behind ?? 0, ahead: ahead ?? 0 };
}

function isMerged(path, base) {
  if (!base) return false;
  try {
    execFileSync('git', ['-C', path, 'merge-base', '--is-ancestor', 'HEAD', base], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

function headAgeDays(path, now = Date.now()) {
  const raw = tryGit(path, ['log', '-1', '--format=%ct']);
  if (!raw) return null;
  return Math.max(0, Math.floor((now - Number(raw.trim()) * 1000) / 86_400_000));
}

function isInside(child, parent) {
  const normalizedParent = parent.endsWith(sep) ? parent : parent + sep;
  return child.startsWith(normalizedParent);
}

export function inspectWorktrees({
  root = repositoryRoot(),
  minAgeDays = DEFAULT_MIN_AGE_DAYS,
  base = baseReference(root),
} = {}) {
  const absoluteRoot = resolve(root);
  const raw = listWorktrees(absoluteRoot);
  const known = raw.map((entry) => resolve(entry.path));
  const internalPrefix = resolve(absoluteRoot, '.worktrees') + sep;
  const worktrees = raw.map((entry, index) => {
    const path = known[index];
    const external = path !== absoluteRoot && !isInside(path, absoluteRoot);
    const parentIndex = known.findIndex(
      (other, otherIndex) =>
        otherIndex !== index && other !== absoluteRoot && other !== path && isInside(path, other),
    );
    const current = path === absoluteRoot;
    const counts = workingTreeCounts(path);
    const dirty = counts.tracked + counts.untracked > 0;
    const merged = isMerged(path, base);
    const ageDays = headAgeDays(path);
    const underWorktrees = path.startsWith(internalPrefix);
    const stale =
      !external &&
      !current &&
      parentIndex === -1 &&
      !dirty &&
      merged &&
      underWorktrees &&
      (ageDays ?? 0) >= minAgeDays;
    let kind;
    if (current) kind = 'current';
    else if (external) kind = 'external';
    else if (parentIndex !== -1) kind = 'nested';
    else if (stale) kind = 'stale';
    else if (dirty) kind = 'dirty';
    else if (!merged) kind = 'unmerged';
    else kind = 'clean';
    return {
      path,
      branch: entry.branch,
      head: entry.head ? entry.head.slice(0, 12) : null,
      external,
      nested: parentIndex !== -1,
      current,
      underWorktrees,
      dirty,
      trackedChanges: counts.tracked,
      untracked: counts.untracked,
      merged,
      ahead: aheadBehind(path, base).ahead,
      behind: aheadBehind(path, base).behind,
      ageDays,
      stale,
      kind,
    };
  });
  const branches = new Map();
  for (const entry of worktrees) {
    if (!entry.branch) continue;
    branches.set(entry.branch, (branches.get(entry.branch) ?? 0) + 1);
  }
  const duplicateBranches = [...branches]
    .filter(([, count]) => count > 1)
    .map(([branch]) => branch);
  const summary = {
    total: worktrees.length,
    current: worktrees.filter((entry) => entry.current).length,
    external: worktrees.filter((entry) => entry.external).length,
    dirty: worktrees.filter((entry) => entry.dirty).length,
    unmerged: worktrees.filter((entry) => entry.kind === 'unmerged').length,
    stale: worktrees.filter((entry) => entry.stale).length,
    maxAgeDays: worktrees.reduce((max, entry) => Math.max(max, entry.ageDays ?? 0), 0),
    duplicateBranches,
    base,
    minAgeDays,
  };
  let queue = null;
  try {
    queue = queueStatus();
  } catch {
    queue = null;
  }
  return { root: absoluteRoot, worktrees, summary, queue };
}

function pad(value, width) {
  const text = value === null || value === undefined ? '-' : String(value);
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

export function formatWorktreeStatus(report) {
  const lines = [];
  const summary = report.summary;
  lines.push(
    'worktrees: ' +
      summary.total +
      ' total, ' +
      summary.dirty +
      ' dirty, ' +
      summary.unmerged +
      ' unmerged,' +
      ' ' +
      summary.stale +
      ' stale candidate(s), ' +
      summary.external +
      ' external, base ' +
      (summary.base ?? '(none)'),
  );
  lines.push(
    'KIND      BRANCH                         HEAD          AGE   DIRTY  AHEAD/BEHIND  PATH',
  );
  for (const entry of report.worktrees) {
    lines.push(
      [
        pad(entry.kind, 9),
        pad(entry.branch ?? '(detached)', 30),
        pad(entry.head, 12),
        pad((entry.ageDays ?? '?') + 'd', 5),
        pad(entry.trackedChanges + '+' + entry.untracked, 6),
        pad(entry.ahead + '/' + entry.behind, 12),
        entry.path,
      ].join(' '),
    );
  }
  if (summary.duplicateBranches.length > 0)
    lines.push(
      'WARNING: branch registered by multiple worktrees: ' + summary.duplicateBranches.join(', '),
    );
  if (report.queue) {
    const holders = report.queue.holders ?? [];
    lines.push(
      'validation queue: ' +
        (holders.length
          ? holders.map((holder) => holder.label + ' (' + holder.class + ')').join(', ')
          : 'idle') +
        '; ' +
        (report.queue.waiters?.length ?? 0) +
        ' waiting',
    );
  }
  const stalePaths = report.worktrees.filter((entry) => entry.stale).map((entry) => entry.path);
  if (stalePaths.length > 0) {
    lines.push('stale candidates (clean, merged, older than ' + summary.minAgeDays + 'd):');
    for (const path of stalePaths) lines.push('  ' + path);
    lines.push('reclaim with: pnpm worktree:prune   (dry run) then --apply');
  }
  return lines.join('\n');
}

export function runWorktreeStatus(root = process.cwd(), argv = process.argv.slice(2)) {
  const known = new Set(['--json', '--help']);
  let minAgeDays = DEFAULT_MIN_AGE_DAYS;
  const unknown = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--min-age-days') {
      index += 1;
      minAgeDays = Number(argv[index]);
      if (!Number.isFinite(minAgeDays) || minAgeDays < 0) return 2;
    } else if (!known.has(arg)) {
      unknown.push(arg);
    }
  }
  if (unknown.length > 0) {
    console.error('Unknown argument(s): ' + unknown.join(', '));
    return 2;
  }
  if (argv.includes('--help')) {
    console.log(
      'Usage: node scripts/quality/worktree-status.mjs [--json] [--min-age-days N]\n\n' +
        'Lists registered worktrees, dirty/merged/ahead-behind state, stale candidates,\n' +
        'and the current validation-queue holder. Diagnostics only.',
    );
    return 0;
  }
  const repository = repositoryRoot(root);
  if (!repository) {
    console.error('worktree-status must run inside a git checkout');
    return 2;
  }
  const report = inspectWorktrees({ root: repository, minAgeDays });
  if (argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else console.log(formatWorktreeStatus(report));
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runWorktreeStatus(process.cwd());
}
