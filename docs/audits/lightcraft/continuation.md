# Continuation record — lightcraft corpus

Last updated: 2026-10-22.

## Frozen baseline

- Cutoff A: issue rows read `2026-10-22T05:36:48Z`–`05:37:08Z` UTC, 26 pages,
  2 521 unique records = 981 issues (537 closed / 444 open) + 1 540 PRs. Search
  API reconciliation: 981 issues, 1 540 PRs, `incomplete_results=false`.
- Discussions: 4 315 comment records fetched after the issue inventory over
  2 028 request threads (793 issues carry comments). The passes are not atomic;
  treat a comment as newer than its issue row.
- Raw cache lives outside Git at `/tmp/opencode/lightcraft/cache/`; hashes and
  retrieval details are in `README.md`. Do not move cutoff A.
- Later arrivals belong to a follow-on queue and do not move the boundary.

## Repository and ownership

- Worktree: `/home/kevina/CodingProjects/varve/.worktrees/lightcraft-corpus`
- Branch: `feat/lightcraft-corpus`, based on `origin/master` `7a7c2a2cc`.
- The main checkout is dirty with unrelated in-flight work. It is not staged,
  reset, stashed, or committed by this task.
- All engineering commits for this corpus land on the task branch first, then
  integrate to `origin/master` through a merge commit after revalidation.

## Engineering state

| Batch | Finding | Commit | State |
|---|---|---|---|
| 1 | Exported markup carries XML-illegal characters (`findings.md` §1) | see `git log --grep lightcraft` | implemented + unit-validated |
| 2 | Name truncation splits grapheme clusters (`findings.md` §2) | see `git log --grep lightcraft` | implemented; unit and Chromium E2E passed 2026-10-22 |
| 3 | Unreadable settings discarded (`findings.md` §3a) | see `git log --grep lightcraft` | implemented + unit-validated; recovery notice still missing |

`screened-for-varve` queues from `findings.md` §4 stay open: preview/export
divergence, deterministic export bytes, mask-overlay visibility while adjusting,
settings-recovery notice, export overwrite decisions, GPU device-loss recovery.

## Next operation

1. Re-run `pnpm verify:plan` after the final documentation commit and run the
   selected lanes that the plan lists for the changed packages.
2. Integrate to `origin/master`, then re-run the affected checks on the merge
   candidate before pushing.
3. Remove this worktree (`git worktree remove`) only after the merged commit is
   verifiable on the remote.
