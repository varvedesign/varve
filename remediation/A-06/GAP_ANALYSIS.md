# Phase 0 gap analysis - A-06 product screenshot pipeline seam

**Status:** analysis complete 2026-10-28. A-06 is ready to execute after this
document and [RESEARCH.md](RESEARCH.md) are accepted. Baseline update and commit
are Lead-owned.

**Inputs:** [RESEARCH.md](RESEARCH.md), [SEAM_SPEC.md](SEAM_SPEC.md), the
file-size policy, the remediation record, the campaign plan, the execution
template (prompt 02), and the worktree measured on 2026-10-28 at checkpoint
`30cfb7a7f534ae58b42f588536783d07f9517edb`.

**Measured state used below:**

- Target 2,767 lines, frozen at 2,767 (baseline line 881). 86 planner blocks =
  72 declarations + 14 non-declaration blocks. `refactor-verify` pre-flight:
  `{ok: true, baseCount: 72, presentCount: 72, missing: [], missingExports: []}`.
- Covering test 522 lines, **15 tests**, 15 pass before the move.
- Worktree baseline: exit 0, **958 frozen**, 0 stale, 0 violations; report
  6,051 scanned, 329,922 excess lines, 0 untracked WIP over-cap.
- Queue idle; no peer claims on the target/baseline; 27 unrelated WIP entries
  remain in the main checkout and are out of scope.
- Environment: `pnpm install` blocked by a read-only store (EROFS); queued
  `pnpm check:agent` replaced by its recursive tsc program run directly; all
  `pnpm <script>` commands still execute after the install warning.

## Gap -> action -> owner -> prompt file

| ID | Gap | Action | Owner | Prompt file |
|----|-----|--------|-------|-------------|
| G1 | A-06 could be read as a multi-seam campaign (scene data, runner, manifest sync) | One destination directory (`scripts/screenshots/product/`) = one seam; the three concerns are the *design* of the module map inside that one destination, not three tasks | Split executor | 02 Step 1 |
| G2 | Protocol requires RESEARCH/GAP_ANALYSIS before source edits | This document and RESEARCH.md are the gate; source work starts only after SEAM_SPEC.md is written | Lead | 01 |
| G3 | 1,257-line `SCENES` declaration exceeds the cap on its own | Sub-split inside the same destination into four contiguous scene-data modules (max ~325 lines) plus a `scenes/index.mjs` aggregator; record the sub-split in SEAM_SPEC | Split executor | 02 Step 1/2 |
| G4 | Top-level `await` capture setup would execute at import if moved naively | Keep `browser`/`server`/`variantSupport` as module-level declarations assigned inside `runCapture()`; entry calls it after mode dispatch | Split executor | 02 Step 2 |
| G5 | reviewed-promotion and normalize dispatch are top-level blocks, not declarations | Promotion becomes `syncReviewedPromotion()` in `product/manifest-sync.mjs`; the entry calls it inside the original `if (args.includes('--sync-reviewed'))` guard. `--normalize` stays an entry dispatch calling the moved `normalizeManifest()` | Split executor | 02 Step 2 |
| G6 | Shared mutable `failures` counter is mutated in two future modules | Move the declaration to `product/state.mjs` as `export let failures` with `export function recordFailure()`; the seven `failures++` sites become `recordFailure()` calls; readers read the live binding | Split executor | 02 Step 2 |
| G7 | Covering test copies an explicit source-file list into its sandbox | Add a recursive copy of `scripts/screenshots/product/` (one `cpSync` line); assertions and test names unchanged, 15/15 before and after | Split executor | 02 Step 3/4 |
| G8 | `ROOT` and the dynamic variant import are depth-sensitive | `ROOT` gains one `'..'`; `new URL('./variants.mjs', ...)` becomes `'../variants.mjs'`; both preserve the resolved path | Split executor | 02 Step 2 |
| G9 | No type checker covers `scripts/**` | Static reference audit per module (free identifiers vs declarations/imports/globals), `node --check` on every file, module-load smoke test, `refactor-verify`, and the fixture test are the proof stack | Split executor | 02 Step 3/4 |
| G10 | Baseline regeneration is single-writer and must survive a rebase | Run `audit-file-size.mjs --update` once on the green tree; diff must be removed exactly `scripts/screenshots/product.mjs`, added 0, grown 0, lowered 0; 958 -> 957; re-run after any rebase; `--force` forbidden | Lead | 02 Step 5 |
| G11 | Commit, ledger row and agent map are single-writer surfaces | Stage exact seam paths, `pnpm agent:map` from the staged tree, `pnpm verify:commit`, one commit; no PR without authorization | Lead | 02 Steps 6-8 |
| G12 | Untracked new modules are outside the baseline until staged | Measure every module, stage, and rely on `audit-file-size --staged` in `verify:commit`; no WIP frozen | Lead | 02 Step 6 |
| G13 | External docs name `product.mjs` for specific commands | The entry path and CLI stay identical; only the internal module location changes. `scripts/screenshots/README.md`'s "SCENES in product.mjs" sentence is updated to the new scene-data module; `docs/README.md` is not touched | Split executor | 02 Step 8 |
| G14 | Front-end/workbench/a11y/visual gates could be misread as triggered | Record measured answers: no rendered surface, no IPC/API shape, no error/empty/loading/permission state, no workbench; prompts 03/04 do not fire | Reviewer | 03/04 |
| G15 | No dashboard; progress readable only from commands/ledger | Record the report/audit commands and one ledger row; no workbench work | Lead | 02 Step 7 |
| G16 | Rollback of a move that also ratchets the baseline | Before commit: restore the target, delete `product/`, revert the test copy line. After commit but before merge: revert the single commit. A removed baseline entry returns with it; never `--force` | Lead | 02 closeout |
| G17 | Environment cannot run `pnpm install` or the queued gates | Symlink installed trees; run the same recursive tsc program directly (`node_modules/.bin/tsc` over `packages/*`, `apps/desktop`, `tests/e2e`); record the limitation, not a blocker | Lead | 02 Step 0/4 |
| G18 | Planner does not support `--top N` (A-05 residual) | Use the plain/--json form; record the residual (do not edit `remediation/prompts/`) | Lead | 02 Step 0 |

## 1. Batch definitions, disjointness and order

Batch A (remediation record lines 68-74) is path-disjoint. A-04
(`packages/editor/src/panels/IntelligencePanel.tsx`), A-05
(`packages/scene/src/types.ts`) and A-08 (`replay-fill.test.ts`) are complete
and recorded; A-06 is the next queued entry in the campaign plan (line 136:
"scene data vs runner vs manifest sync"). A-07 is Rust tooling and A-09 is the
perf runner; neither is touched here. This session executes exactly one entry.

## 2. Baseline regeneration

The seam worker (Lead) runs `node scripts/quality/audit-file-size.mjs --update`
in `.worktrees/A-06` after the split is green. The diff is reviewed for exactly
one removed entry and no added/grown entry; then `pnpm audit:filesize` reruns
to exit 0 at 957. The update is not run before the split and never with
`--force`. After a future merge the orchestrator regenerates on the merged tree.

## 3. Seam tooling

`godsplit-plan` gives ranges and hazards but never destinations; the declaration
inventory and module map in [SEAM_SPEC.md](SEAM_SPEC.md) are the reviewed
decision. `refactor-verify` proves declaration preservation for JS/TS only;
there is no Rust seam here. Both are read-only and neither is edited.

## 4. Rollback

Discard the uncommitted seam by restoring `scripts/screenshots/product.mjs`,
deleting `scripts/screenshots/product/`, and reverting the covering-test copy
line; the baseline is untouched until the ratchet runs. If the ratchet cannot go
down, stop and report before committing. Never reset the shared checkout or
revert another session.

## 5. Observability

Progress is measured by `--report` (frozen count, excess lines, WIP), the one
ledger row, and the monotone ratchet. There is no dashboard and none is in
scope.

## 6. Testing sufficiency

The covering suite is a path/behavior guard for the capture pipeline's safety
contract (review-directory refusal, port preflight, producer receipts, reviewed
promotion assembly, normalize/promote CLI behavior) and it executes the real
entry from a sandbox copy. It does not run the Playwright capture loop; that is
not required for a pure move (the loop's code is byte-identical and every moved
reference is statically audited). The test count must stay 15 before and after.

## 7. Docs index

The seam adds only `remediation/A-06/` (outside `docs/`) plus one sentence
correction in `scripts/screenshots/README.md`; no `docs/README.md` row is
needed. If that README edit is made, `pnpm audit:docs` runs in the same change.

## Front-end necessity gate - not triggered

- Does the seam change what an operator sees or does in a remediation
  workbench? **No** - no workbench exists and none is in scope.
- Does it change an API/IPC response shape consumed by the UI? **No** - the
  script's CLI and output files (screenshots, manifest) are byte-identical
  contracts; no TypeScript/UI module is touched.
- Does it change error, empty, loading or permission states? **No** - code
  moves verbatim; any such change is a defect.
- Does it make the 958-entry queue harder to understand? **Not applicable** -
  the queue is the baseline, the ledger and the report commands, not a UI.

**Verdict: no front-end work; the necessity gate does not fire; visual
validation is not triggered (no rendered output).** The covering test (15/15
before and after) plus the "no visual surface changed" statement in SEAM_SPEC.md
is the required evidence.
