#!/usr/bin/env node
/**
 * Fail when the shared index does not describe the content HEAD has.
 *
 * ## The failure this exists for
 *
 * The index is one file per repository, shared by every worktree and every agent
 * working in them. Committing through a *different* index — the "isolated index"
 * technique, `GIT_INDEX_FILE=/tmp/... git commit`, used so a commit cannot be
 * built from somebody else's half-staged work — leaves the shared index
 * describing the tree as it was *before* the commit. HEAD moves; the shared
 * index does not. Relative to the new HEAD, that stale index is exactly a staged
 * revert of the commit that just landed, and **anyone whose next command is
 * `git commit` without a pathspec erases it.**
 *
 * Note what that is: not a reset anyone performs, but an update nobody performs.
 * The isolation that protects the commit being created is the same thing that
 * leaves the shared index behind, so the two techniques have to be paired —
 * prefer `git commit --only -- <paths>`, which keeps the shared index
 * consistent, or refresh it deliberately afterwards (`git read-tree HEAD`, after
 * checking that the staged set holds nothing of anyone else's).
 *
 * It reproduces on demand, which is how this was confirmed rather than guessed:
 * `GIT_INDEX_FILE=$tmp/idx git read-tree HEAD`, stage one path into that index,
 * commit, and the shared index becomes the revert of that commit. The recorded
 * state matched exactly — a staged diff whose insertion and deletion counts were
 * the reverse of the commit's. That is also how this guard was falsified before
 * it was kept.
 *
 * ## What this checks
 *
 * A stale index has a signature that no legitimate staging state has. For a path
 * where the index differs from HEAD:
 *
 * - if the **worktree** content differs from HEAD too, then someone staged their
 *   own edit. Normal, and allowed.
 * - if the **worktree** content *equals HEAD*, then the index holds something
 *   neither HEAD nor the worktree holds. Nobody stages "the old version of a file
 *   I have not touched", so the index is describing a tree from the past.
 *
 * The second case fails, with the offending paths named. It never reverts
 * anything itself: repairing a stale index is a decision for whoever owns the
 * work in it.
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
 * Whether the checked-out file is identical to HEAD's version.
 *
 * `git diff --quiet HEAD -- <path>` compares the worktree against HEAD, which is
 * exactly the question: does what is on disk match what is committed?
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
      'worktree: the index is describing an older tree. That is the signature of an index left',
      'behind by a commit made through an isolated index, and committing it now would erase',
      'that commit:',
      '',
      ...stale.map((path) => `  ${path}`),
      '',
      `HEAD is ${git(['rev-parse', '--short', 'HEAD']).trim()}.`,
      '',
      'To repair it — this writes the index only, never the worktree, and it discards whatever',
      'is genuinely staged, so check the list above first:',
      '',
      '  git read-tree HEAD',
      '',
      'For paths that should not be staged at all, `git restore --staged <path>` is the',
      'deliberate form; then re-check `git diff --cached` for what is actually intended.',
    ].join('\n'),
  );
  process.exit(1);
}

main();
