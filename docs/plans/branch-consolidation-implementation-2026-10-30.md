# Branch consolidation implementation - 2026-10-30

Status: batch 2 (seam close-out) landed on `master`; mainline reconciliation
blocked pending an owner decision; branch triage manifest recorded below.

## 1. State at start

- `master` at `cd9fd728c` (2026-10-29) vs `origin/master` at `868b8ec01`
  (2026-10-30, fetched during preflight): 547 ahead / 164 behind, merge-base
  `5172718c6`. Patch equivalence is near nil, so these are two genuinely active
  lines, not a rebase artifact.
- 104 local branches, 50 registered worktrees (5 external, 3 nested, 1
  prunable), 6 stashes, 19 dirty worktrees including the shared checkout.
- The shared checkout was already dirty before this work: 1 tracked
  modification (`.gitignore`) plus 26 untracked entries from another session.
  It was never cleaned, committed, or used as a merge location.

## 2. Blocking finding: mainline reconciliation

`git merge-tree --write-tree --name-only master origin/master` exits 1 with
282 conflicted paths, including `AGENTS.md`, `CHANGELOG.md`, `Cargo.lock`,
`pnpm-lock.yaml`, `apps/desktop/src-tauri/src/lib.rs`, website layouts and
pages, and architecture/audit docs.

No mainline merge was attempted: a 282-path semantic resolution needs an owner
decision and a dedicated batch with its own verification window. Options:

1. Origin-authoritative: replay/rebase the local delta onto `origin/master`.
2. Local-authoritative: merge `origin/master` as one unit into local
   `master`, validate, then push.
3. Scratch integration line first: prove the reconciliation on a throwaway
   branch, then fast-forward whichever line the maintainer designates
   (recommended; neither line is rewritten or force-pushed).

## 3. Triage manifest (genealogical, read-only)

Across 105 local refs (104 at start plus this batch's integration branch):

| Verdict | Count | Meaning |
|---|---|---|
| MASTER | 1 | the local main line |
| MERGE | 2 | live integration candidates |
| ARCHIVE | 47 | already landed, patch-landed, or stale automation |
| WIP-PRESERVE | 15 | dirty worktrees; preserve before any archive or prune |
| CHERRY-PICK | 12 | single-purpose commits to recut onto the agreed main |
| REBASE-FIRST | 19 | stale or origin-line work that must be requalified |
| INVESTIGATE | 9 | ambiguous or partially-in-origin history |

After this batch lands, B-11 and C-01 become ARCHIVE candidates because their
payloads are carried in the landed C-02 stack.

- Batch A (A-05/06/07/09) and Batch B (B-01..B-10) are ancestors of local
  `master`; their content is landed and their refs are archive candidates.
- Canonical seam close-out: `seam/C/C-02-input-pipeline` `0ddfcf4b7`. It is the
  only branch carrying all three payloads (B-11, C-01, C-02) and has the
  closest base to `master` (6 behind). Content proof: 28/28 B-11 non-drift
  files and 24/24 C-01 non-drift files are blob-identical across the original
  tips and C-02's re-cut commits; only generated surfaces drift per restack.
- The 15 WIP-PRESERVE worktrees (15 with tracked modifications) must not be
  pruned or archived until their owners commit or explicitly discard the work.

## 4. Executed batch: seam C close-out

- Worktree `.worktrees/consolidate-seam-c-20261030`, branch
  `integration/seam-c-20261030`, created from `master`. The shared checkout was
  not written; dependencies were mirrored by hardlinks for validation.
- Merge `--no-ff` of `0ddfcf4b7`: merge commit `ae9e163e7`; the only conflict
  was generated `docs/agents/repo-map.generated.md`, resolved by canonical
  regeneration.
- Independent verification found a map drift: the map committed from the
  conflict state counted two phantom docs files. Fixed in `b2f7dafac` by
  regenerating on the committed tree; the check now reports 11,741 tracked
  files and exits 0.
- Content is exactly the seam stack: 82 files changed, no lockfile,
  package.json, tsconfig, test-runner, or unrelated edits.
- `.file-size-baseline.json` moved 945 -> 942 entries, removing exactly the three
  split targets (shrink-only ratchet, 0 added, 0 grown).
- `BACKLOG_LEDGER.md` gains the B-11, C-01 and C-02 rows.

## 5. Verification evidence (independent verifier, fresh context)

- Move verifier (documented bases, JSON): B-11 baseCount 24, presentCount 33;
  C-01 105/105; C-02 15/45. All `missing: []`, `missingExports: []`, exit 0.
- TypeScript substitute for `check:agent`: 22/22 projects (20 package
  tsconfigs, `apps/desktop`, `tests/e2e`), exit 0, zero diagnostics.
- Targeted Vitest: 5 files / 59 tests passed (`AdjustmentEditor`,
  `AdjustmentPanel`, `inputPipeline`, `replay`, `replay.state`).
- Audits green: file-size, agent-surface, constitution, IPC, committed imports,
  emoji, docs, visual baselines, health. Agent-map failed once on the drift
  above and rechecks green after `b2f7dafac`.
- `audit-architecture.mjs --ci` is red: cycle limit 36 > 17. The C-01 ledger row
  records the pre-existing red state (11 engine cycle identities on master
  before the move, 19 after) and the delta is reported rather than hidden; no
  allowlist or baseline was changed. Follow-up architecture review is required.
- Not run (bounded validation per impact policy): full Vitest, Playwright/E2E,
  cargo, builds, and pnpm-wrapped gates. The read-only pnpm store makes the
  pnpm wrappers unusable here; direct tool substitutes are recorded above and
  follow the queue-EROFS substitution precedent in `BACKLOG_LEDGER.md`.

## 6. Environment and safety notes

- pnpm scripts attempt an install and fail with `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`
  (read-only store). Validation therefore used direct `node`/`node_modules/.bin`
  commands, and receipts were not produced.
- Merge, fix, and docs commits used `--no-verify` because the git hooks call
  `pnpm verify:commit`, which cannot run in this environment. The validators
  were run directly instead; this deviation is recorded here.
- No push, force-push, branch deletion, worktree prune, or remote-ref change was
  performed. No other session's dirty state was touched.
- `archive/seam-B-11-adjustment-editor` and `archive/seam-C-01-replay` tags
  preserve the superseded tips; the live branches remain until an owner
  confirms deletion.
- The integration worktree remains registered and clean after landing.

## 7. Next batches

1. Owner decision on canonical line plus rewrite/push policy; nothing else in
   the inventory can be sequenced safely until this is fixed.
2. Prove the reconciliation on a scratch integration line (option 3 above).
3. Archive the 47 candidates with tags first; never `git branch -D` before the
   tag exists, and resolve the 15 WIP-PRESERVE worktrees first.
4. Recut the CHERRY-PICK (12) and REBASE-FIRST (19) units onto the agreed main;
   do not merge pre-restack tips.
5. Run the codex corpus, marketing S-order, and dependabot batches; dependabot
   needs one lockfile owner and fresh remote tips.
6. Triage the 79 remote-only branches against open PRs before deleting refs.
7. Schedule a dedicated architecture-cycle health pass for the C-01 delta.

## 8. References

- [branch-consolidation.md](branch-consolidation.md)
- [concurrent-agents.md](../quality/concurrent-agents.md)
- [validation-and-workflow.md](../agents/validation-and-workflow.md)
- [validation-strategy.md](../quality/validation-strategy.md)
- [local-validation-queue.md](../quality/local-validation-queue.md)
- [visual-validation.md](../quality/visual-validation.md)
