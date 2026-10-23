# Continuation record

Read this first when resuming. It records what is done, what is verified, and
the exact next operation. Repository state can change; re-check `git status`
and the branch before acting.

## Current follow-up — paint batch (2026-10-23)

The active work is now in `.worktrees/graphite-paint-20261023`, branch
`graphite/paint-corpus-20261023`, based on remote master `e11477176`.
Read [paint-batch.md](paint-batch.md) for the current checks, pending processes,
F14 geometry-origin repair and probes for #2445/#3019. The separate local
vector batch is preserved at `.worktrees/graphite-20261022`; findings F10–F13
are reserved for it. No paint-batch integration/release is established yet.

The sections below retain the older corpus checkpoint; they are not the
current paint batch's execution state.

## Where the work lives

- Worktree: `.worktrees/graphite-corpus`
- Branch: `feat/graphite-corpus`
- Base: `origin/master` `2e8c5b018b00a85fde341a0acc3dc80cde042f83`
  (`varvedesign/varve`; `K-Arthur/varve` redirects here)
- The pre-existing main checkout was never modified by this work. It remains
  on local `master` with its own divergent history and uncommitted changes.

## Corpus state (frozen)

- C1 `2026-10-21T19:12:39Z`, C2 `2026-10-21T20:31:38Z`.
- 1,604 issues (1,603 from the REST listing plus `#426`, recovered from the
  single-issue endpoint because the listing and search omit it).
- 2,734 comments across all 1,604 threads; no unresolved access failures.
- C2 reconciliation: 0 new issues, 0 comment-count changes.
- Issue-set SHA-256:
  `2e93c325c8b1ade2aa0b73cdde3f94583ccc9ae89a83b13bc24c274475366921`.
- Raw cache: `~/.cache/varve/graphite` (not committed).

## Review state

- `issue-ledger.jsonl` holds one row per issue with research status and
  engineering status kept separate.
- Reviewed rows carry a disposition and reason from a full read of the body
  and every retrievable comment. Unreviewed rows are `unreviewed`; they are
  the resumable frontier.
- Per-issue reasons for large volumes of Graphene/node-graph/GPU-queue issues
  cite the absent subsystem rather than a blanket exclusion.
- Packets of 100 issues and their raw inputs are in the cache; the same
  packets can be regenerated with
  `node scripts/research/graphite.mjs packet --from <position> --size 100`.

## Engineering state

| Finding | Status |
|---|---|
| F1 Shift constrains movement to 45° steps (plus the Shift-press selection bug it exposed) | Implemented; unit + E2E evidence recorded in `findings.md` |
| F2 Enter confirms the New Design dialog | Implemented; jsdom evidence recorded |
| F2b Enter in the preset search must not create | Implemented after independent review found it |
| F3 Repeated nudges cost one undo each | **Blocked** on an amend/coalesce capability in the persistent revision store |
| F4 existing protections (zero-size geometry, marquee abort, Delete with a tool active) | Verified, no change needed |
| Decorations-off Tauri window resize on KDE/Wayland | **Unverified**: needs a native build and interactive resize test |

## Next operation

1. Finish any remaining per-issue reviews (see the count in the final report
   and `ledger` status), importing each completed packet with
   `node scripts/research/graphite.mjs ledger-import --assessments <file>`.
2. Re-run the browser lanes for the changed surfaces:
   `node scripts/quality/heavy-lease.mjs "e2e: graphite batch" -- npx playwright test tests/e2e/canvas/shift-constrained-move.spec.ts tests/e2e/home --project=chromium --workers=1`
3. Run `pnpm verify:plan` then `pnpm verify:affected` on the integrated
   candidate and record the Agent Validation Report.
4. Push the branch, open the PR, and merge once the required checks pass.
5. After the merge is confirmed on `origin/master`, remove this worktree with
   `git worktree remove .worktrees/graphite-corpus` and delete the branch.

## Known blockers and caveats

- Heavy browser validation shares one cross-worktree lease. Other sessions
  hold it for long lanes; queue with `VARVE_LEASE_TIMEOUT` rather than
  bypassing it.
- `apps/website/src/test/changelog.test.ts` fails on `origin/master` before any
  change in this branch (changelog parser drops the release summary and lets
  Unreleased entries leak into the next release). Pre-existing; recorded, not
  fixed here.
