#!/usr/bin/env node
/**
 * Fail when the shared index does not describe the content HEAD has.
 *
 * ## The failure this exists for
 *
 * The index is one file per repository, shared by every worktree and every
 * agent working in them. A tool that captures the index before a commit — for
 * example to run checks against exactly what is staged, or to use an isolated
 * index of its own — and then writes that captured tree *back* into the shared
 * index produces a specific, silent disaster: the commit lands, and the index
 * is immediately reset to the tree from just before it. `git status` then shows
 * the entire commit staged in reverse, and **anyone whose next command is
 * `git commit` without a pathspec erases the commit that just landed.**
 *
 * That is not hypothetical: it has been observed twice in this repository, and
 * it is the reason a plain `git commit` is dangerous here.
 *
 * ## What this checks
 *
 * A stale index has a signature that a legitimate staging state cannot have.
 * For a path where the index differs from HEAD:
 *
 * - if the **worktree** content differs from HEAD too, the person or agent
 *   staged their own edit. That is normal and allowed.
 * - if the **worktree** content *equals HEAD*, then the index holds something
 *   neither HEAD nor the worktree holds. Nobody stages "the old version of a
 *   file I have not touched", so the index is describing a tree from the past.
 *
 * The second case is a failure with the offending paths named. It never
 * reverts anything itself: fixing a stale index is a decision for the person
 * who owns the work in it.
 *
 * Usage: node scripts/quality/guard-index-not-stale.mjs [--quiet]
 */
import { spawnSync } from 'node:child_process';

function git(args, options = {}) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr?.trim() ?? result.status}`);
  }
  return result.stdout;
}

/** Paths the index records differently from HEAD, as NUL-separated names. */
function stagedPaths() {
  return git(['diff', '--cached', '--name-only', '-z']).split('\0').filter(Boolean);
}

/**
 * Whether the worktree file is byte-identical to HEAD's version.
 *
 * `git diff --quiet HEAD -- <path>` compares the worktree against HEAD, which is
 * exactly the question: does the checked-out content match what is committed?
 */
function worktreeMatchesHead(path) {
  const result = spawnSync('git', ['diff', '--quiet', 'HEAD', '--', path], { stdio: 'ignore' });
  return result.status === 0;
}

function main() {
  const quiet = process.argv.includes('--quiet');
  const paths = stagedPaths();
  if (paths.length === 0) {
    if (!quiet) console.log('index guard: index matches HEAD');
    return;
  }
  const stale = paths.filter((path) => worktreeMatchesHead(path));
  if (stale.length === 0) {
    if (!quiet) {
      console.log(`index guard: ${paths.length} staged path(s), each matching its worktree edits`);
    }
    return;
  }
  console.error(
    [
      'index guard: the shared index holds content that is neither committed nor checked out.',
      '',
      'These paths are staged with a version that matches HEAD, so nobody staged them from the',
      'worktree — the index is describing an older tree. This is the signature of a captured',
      'index being written back after a commit landed, and committing it now would erase that',
      'commit:',
      '',
      ...stale.map((path) => `  ${path}`),
      '',
      `HEAD is ${git(['rev-parse', '--short', 'HEAD']).trim()}.`,
      'Do not commit this index. Decide deliberately: `git restore --staged <path>` for paths',
      'that should not be staged at all, and re-check with `git diff --cached` what is intended.',
    ].join('\n'),
  );
  process.exit(1);
}

main();
