#!/usr/bin/env node
/**
 * Safe worktree pruning for concurrent-agent checkouts.
 *
 * Disk and inode pressure from dozens of experiment worktrees is a real
 * machine cost. This tool removes ONLY worktrees that are:
 *   - strictly under <repo>/.worktrees/ (never the main checkout, never
 *     external worktrees such as ~/.codex/* or sibling checkouts);
 *   - clean (no tracked or untracked changes);
 *   - fully merged into the chosen base (default origin/master, else master);
 *   - older than --min-age-days (default 14); and
 *   - contain no other registered worktree inside them.
 * Dirty, unmerged, external and current worktrees are never removed. Dry run
 * is the default; --apply performs the removals (no --force).
 *
 * Usage:
 *   node scripts/quality/worktree-prune.mjs [--apply] [--json]
 *       [--min-age-days N] [--base <ref>]
 */
import { execFileSync } from 'node:child_process';
import { resolve, sep } from 'node:path';
import { isMainModule } from '../is-main-module.mjs';
import { inspectWorktrees, repositoryRoot } from './worktree-status.mjs';

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function isClean(path) {
  try {
    const raw = git(path, ['status', '--porcelain=v1', '-z', '--untracked-files=normal']);
    return raw.length === 0;
  } catch {
    return false;
  }
}

function isMergedInto(path, base) {
  try {
    git(path, ['merge-base', '--is-ancestor', 'HEAD', base]);
    return true;
  } catch {
    return false;
  }
}

function depth(path) {
  return path.split(sep).filter(Boolean).length;
}

export function selectPruneCandidates(report) {
  const candidates = report.worktrees.filter(
    (entry) =>
      entry.stale && entry.underWorktrees && !entry.external && !entry.current && !entry.nested,
  );
  return candidates.sort((a, b) => depth(b.path) - depth(a.path) || a.path.localeCompare(b.path));
}

export function pruneWorktrees({ root, apply = false, minAgeDays = 14, base, json = false } = {}) {
  const repository = repositoryRoot(root);
  if (!repository) {
    console.error('worktree-prune must run inside a git checkout');
    return { code: 2, report: null, candidates: [], removed: [], skipped: [], failed: [] };
  }
  const report = inspectWorktrees({ root: repository, minAgeDays, base });
  const candidates = selectPruneCandidates(report);
  const removed = [];
  const skipped = [];
  const failed = [];
  if (apply) {
    for (const candidate of candidates) {
      // Re-verify immediately before removal; another agent may have started
      // writing to the worktree between listing and removal.
      if (!isClean(candidate.path)) {
        skipped.push({ path: candidate.path, reason: 'became dirty during prune' });
        continue;
      }
      if (report.summary.base && !isMergedInto(candidate.path, report.summary.base)) {
        skipped.push({ path: candidate.path, reason: 'no longer merged into base' });
        continue;
      }
      const nestedChild = report.worktrees.find(
        (entry) => entry.path !== candidate.path && entry.path.startsWith(candidate.path + sep),
      );
      if (nestedChild) {
        skipped.push({
          path: candidate.path,
          reason: 'contains registered worktree ' + nestedChild.path,
        });
        continue;
      }
      try {
        git(repository, ['worktree', 'remove', candidate.path]);
        removed.push(candidate.path);
      } catch (error) {
        failed.push({ path: candidate.path, reason: String(error.stderr ?? error.message).trim() });
      }
    }
    try {
      git(repository, ['worktree', 'prune']);
    } catch {
      // Admin metadata pruning is best-effort after removals.
    }
  }
  if (json) {
    console.log(
      JSON.stringify(
        {
          repository,
          dryRun: !apply,
          candidates: candidates.map((entry) => entry.path),
          removed,
          skipped,
          failed,
          base: report.summary.base,
        },
        null,
        2,
      ),
    );
  } else {
    if (candidates.length === 0) {
      console.log(
        'worktree-prune: no stale merged worktrees older than ' +
          minAgeDays +
          ' day(s) under .worktrees/',
      );
    } else {
      console.log(
        (apply ? 'Removing ' : 'Dry run: ') + candidates.length + ' candidate(s) under .worktrees/',
      );
      for (const candidate of candidates) {
        console.log(
          '  ' +
            candidate.path +
            '  (' +
            (candidate.branch ?? 'detached') +
            ', ' +
            (candidate.ageDays ?? '?') +
            'd, merged, clean)',
        );
      }
      if (!apply)
        console.log(
          'run with --apply to remove them; dirty/unmerged/external worktrees are never touched',
        );
    }
    if (removed.length > 0) console.log('removed ' + removed.length + ' worktree(s)');
    for (const item of skipped) console.log('skipped ' + item.path + ': ' + item.reason);
    for (const item of failed) console.log('failed  ' + item.path + ': ' + item.reason);
  }
  return { code: failed.length > 0 ? 1 : 0, report, candidates, removed, skipped, failed };
}

export function runWorktreePrune(root = process.cwd(), argv = process.argv.slice(2)) {
  let apply = false;
  let json = false;
  let minAgeDays = 14;
  let base;
  const unknown = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') apply = true;
    else if (arg === '--json') json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/quality/worktree-prune.mjs [--apply] [--json] [--min-age-days N] [--base <ref>]\n\n' +
          'Dry run by default. Removes only clean, fully merged worktrees under .worktrees/\n' +
          'older than the age threshold. Never touches dirty, unmerged, current or external worktrees.',
      );
      return 0;
    } else if (arg === '--min-age-days') {
      index += 1;
      minAgeDays = Number(argv[index]);
      if (!Number.isFinite(minAgeDays) || minAgeDays < 0) {
        console.error('--min-age-days must be a non-negative number');
        return 2;
      }
    } else if (arg === '--base') {
      index += 1;
      base = argv[index];
      if (!base) {
        console.error('--base requires a ref');
        return 2;
      }
    } else {
      unknown.push(arg);
    }
  }
  if (unknown.length > 0) {
    console.error('Unknown argument(s): ' + unknown.join(', '));
    return 2;
  }
  return pruneWorktrees({ root, apply, minAgeDays, base, json }).code;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runWorktreePrune(process.cwd());
}
