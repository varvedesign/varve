# B-06 gap analysis - snapping split

Phase 01 output. Companion to `RESEARCH.md`; the measured evidence, failure
modes, and edge-case register live there. This file records the decisions that
close each gap before implementation, with the owner prompt.

## Measured checkpoint state

- Worktree `.worktrees/B-06`, branch `seam/B/B-06-snapping`, clean, HEAD
  `feb9f0eb67678b6885626699219540c8ab3e44f9` (local `master` fast-forwarded
  by the Lead from `00b2fb62f` after the B-05 seam).
- `node scripts/quality/audit-file-size.mjs --report` on the clean worktree:
  6,192 source files scanned; 950 over the 400-line cap; **950 frozen, 0 stale,
  0 violations**; 305,511 excess lines; 0 untracked WIP over-cap files.
  `pnpm audit:filesize` exit 0.
- Target `packages/editor/src/tools/snapping.ts`: 1,982 lines, baseline entry
  `1982` (baseline line 413). Covering test
  `packages/editor/src/tools/__tests__/snapping.test.ts`: 827 lines, frozen at
  `827` (baseline line 408), 64 tests; not edited by this seam.
- Planner `godsplit-plan`: 1,982 lines, 3 imports, 62 blocks, exit 0;
  hazards: over-cap target, `snapPosition` 702-1381 is 680 lines,
  `snapSelectionBox` 1593-1966 is 374 lines. Verifier smoke:
  `{ok: true, baseCount: 61, presentCount: 61, missing: [], missingExports: []}`,
  exit 0.
- Covering suite before the move:
  `node node_modules/vitest/vitest.mjs run packages/editor/src/tools/__tests__/snapping.test.ts`
  -> 1 file, 64 tests passed, exit 0.
- Direct tsc substitute before the move: packages 20 checked / 20 pass / 0 fail;
  desktop exit 0 / 0 diagnostics; e2e exit 0 / 0 diagnostics.

## Gap -> action -> owner -> prompt file

| Gap | Action | Owner | Prompt file |
|---|---|---|---|
| Batch definitions and order | Batch B order in the campaign plan is lib.rs (B-01), print (B-02), clipboard (B-03), document codec (B-04), filters (B-05), then snapping (B-06), room server (B-07), bgremove, SAM2, ContentAwareFill, AdjustmentEditor. The ledger records B-01..B-05; the checkpoint is the committed B-05 seam. B-06 is the correct next entry. No other queue entry is opened in this session. | This session (Lead) | 01 |
| Seam text vs measured file content | Ranked backlog row 19 and the handoff agree with the measured file: target filtering/normalization, per-snap-type strategies (grid, guides, objects), sticky-lock state. The measured concerns match: `snapPosition` (680 lines) is a flat sequence of candidate families, the lock functions are lines 362-442, target filtering/normalization is lines 179-360, and the resize/selection-box resolver is lines 1383-1966. No seam text conflicts with the code; recorded in `SEAM_SPEC.md`. | This session | 01 -> 02 Step 1 |
| Destination ambiguity | 1,982 lines cannot fit the 400-line cap, so the destination is a directory `packages/editor/src/tools/snapping/` (one seam) with 11 cohesive modules plus `snapping.ts` as the thin re-export entry. The specifier `./tools/snapping` keeps resolving to `snapping.ts` (file wins over the sibling directory). | This session | 01 -> 02 Step 1 |
| Declaration over 400 lines (1 hazard; second is 374) | `snapPosition` (680 lines) is the only declaration that exceeds the cap on its own. It is sub-split into an orchestrator plus per-family strategy helpers in `grid.ts`, `guides.ts`, and `objects.ts`, sharing a `SnapCandidateState` accumulator in `candidates.ts`. Candidate order, literals, and strict-before update order are preserved. `snapSelectionBox` (374 lines) stays one module at about 386 lines with imports, under the cap. | This session | 02 Step 1/2 |
| Type catalog over 400 lines | The 11 interfaces, 4 constants, and the normalized-target helper type total about 166 lines; they move verbatim into `snapping/types.ts` (about 178 lines with imports). | This session | 02 Step 1/2 |
| Baseline regeneration | Single writer: this session runs `node scripts/quality/audit-file-size.mjs --update` in `.worktrees/B-06` after the split is green, no `--force`; diff must remove exactly `packages/editor/src/tools/snapping.ts: 1982`, 0 added, 0 grown; `pnpm audit:filesize` then exits 0 at 949. | This session | 02 Step 5 |
| Seam tooling scope | Both seam tools parse this TypeScript target and exit 0, so the standard protocol applies. The checkpoint planner accepts only `<file> [--json]`; the supported no-flag full table is used (exit 0) and the `--top` mismatch is recorded. | This session | 01/02 |
| Module-scope state | `SNAP_PRIORITY` (line 444), `VERTICAL_SOURCE_FEATURES` (line 579), and `HORIZONTAL_SOURCE_FEATURES` (line 580) are the only module-scope values. Each gets exactly one home (`candidates.ts` and `guides.ts`); only the original four constants are re-exported by the barrel. | This session | 02 Step 2 |
| Import distribution | The original 3-import preamble cannot move verbatim; each new module gets the subset it uses, with `./isometricSnapping` rebased to `../isometricSnapping` for files one level deep. Biome sorts and formats import preambles; moved declaration bodies stay verbatim. | This session | 02 Step 2/4 |
| Public API preservation | The barrel explicitly re-exports all 24 original names (12 types, 4 constants, 8 functions) plus the two re-exported isometric types. The new internal helpers are not re-exported. The 10 importing files and the covering test keep the same specifier and names; no renames. | This session | 02 Step 1/2/4 |
| Solver behavior | `snapPosition` output must stay identical: same candidate order, same priorities, same strict-before tie rules, same guide literals and return shape. The extraction parameterizes the same accumulator; the sticky resolver is a 1:1 branch mapping; the covering suite plus the snapParity parity test gate it. | This session | 02 Step 2/3/4 |
| Rollback | The seam is uncommitted until step 8; a failed extraction is discarded only inside `.worktrees/B-06`. Never reset the shared main checkout and never commit a partial seam. | This session | 02 Step 8 |
| Observability | Progress is the frozen count (950 -> 949), one ledger row, the baseline diff, the verifier JSON, and the before/after test counts; there is no dashboard. | This session | 02 Step 5/7 |
| Front-end / accessibility / i18n / dark mode | Does not apply: pure TypeScript tooling-code move, no rendered UI. Verdict: the front-end necessity gate does not fire; 03/04 are not opened. | This session | 01 Section D |
| Testing sufficiency | `packages/editor/src/tools/__tests__/snapping.test.ts` is the real covering suite: 64 Vitest tests over position/size/selection-box snapping, grid/guide/layout/object/midpoint/spacing families, hierarchy filtering, sticky hysteresis, isometric projection, and page targets. It does not cover a desktop pointer E2E; that is out of scope for a declaration move and is recorded as a residual. | This session | 02 Step 4 |
| Docs index | This entry adds only `remediation/B-06/*`, outside `docs/`; `pnpm audit:docs` does not require a `docs/README.md` row for it. The regenerated repo map and the ledger row are the only shared surfaces edited. | This session | 02 Step 6/7 |
| Concurrency | One writer in `.worktrees/B-06`; baseline/map/ledger are regenerated, never hand-merged. `node scripts/quality/validation-queue.mjs status` reported the exclusive queue free and no waiters; queued gates themselves are unavailable (EROFS). | This session | 02 Step 6 |
| Environment limits | Read-only pnpm store -> 21 node_modules symlinks plus the ignored onnxruntime-libs copy; recursive `pnpm -r` unsafe on symlinked node_modules -> direct typescript binary loop; queue EROFS -> direct tsc program substitute for `check:agent` and direct vitest for `test:agent`; planner `--top` unsupported; all recorded in `RESEARCH.md` and `SEAM_SPEC.md`. | This session | 01 environment table |
| Push/PR | Not authorized. Leave the one commit on `seam/B/B-06-snapping` unmerged for review; do not push, merge, or prune. | Orchestrator/Lead | 02 Step 9 |
| Handoff | Re-instantiate `templates/NEXT-PROMPT.md` for the following unblocked Batch B entry (room server, `crates/varve-room/src/server.rs`) with fresh checkpoint measurements; write `NEXT_PROMPT.md` untracked at the main repo root; do not start that entry. | This session | 02 Step 10 |

## Front-end necessity gate

**No front-end work; the necessity gate does not fire.** The seam moves
TypeScript declarations only; no operator-visible surface, API response shape,
error/empty state, or remediation workbench is touched. The proof is the
unchanged 64/64 covering test result and the absence of any visual surface: no
renderer, canvas, DOM output, style file, or snapshot is in the moved set. The
statement for `SEAM_SPEC.md` is: no visual surface changed; visual validation
is not triggered.

## Decisions resolved before implementation

1. Destination directory `packages/editor/src/tools/snapping/` (one seam)
   because the target must end under the 400-line cap; `snapping.ts` becomes
   the thin entry.
2. Eleven destination modules plus the barrel: `types`, `targets`,
   `stickyLock`, `candidates`, `grid`, `guides`, `objects`, `position`,
   `resize`, `selectionBox`, `pageTargets`; every module expected at or
   under 400 lines.
3. The barrel uses an explicit named re-export list (no wildcard), matching the
   B-05/A-04 precedent and making the export-preservation proof auditable.
4. `snapPosition` sub-split: the orchestrator keeps initialization, the
   joint-layout candidate collection, the isometric block, sticky resolution,
   the joint-layout override, and the matches projection; the inline candidate
   families move to `grid.ts` (grid, layout-grid step, pixel grid),
   `guides.ts` (ruler guides, authored layout guides), and `objects.ts`
   (midpoint, object edges/centres, spacing), each mutating the same
   `SnapCandidateState` accumulator.
5. The sticky X/Y resolution (including the spacing re-resolution) becomes one
   `resolveAxisSticky` helper in `stickyLock.ts` with a 1:1 branch mapping;
   the lock predicate/mapping functions move verbatim.
6. The resize resolver family (`snapSize`, `snapResizeAxis`,
   `preserveProportionalResize` and helpers) moves to `resize.ts`;
   `snapSelectionBox` keeps its 374-line body verbatim in
   `selectionBox.ts`.
7. No `docs/` file is edited; the dated remediation record and campaign plan
   are read-only for this session.
