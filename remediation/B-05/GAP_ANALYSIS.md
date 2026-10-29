# B-05 gap analysis - filters split

Phase 01 output. Companion to `RESEARCH.md`; the measured evidence, failure
modes, and edge-case register live there. This file records the decisions that
close each gap before implementation, with the owner prompt.

## Measured checkpoint state

- Worktree `.worktrees/B-05`, branch `seam/B/B-05-filters`, clean, HEAD
  `00b2fb62f083b5e507ca3281f8406472b74ab7dc` (local `master` fast-forwarded
  by the Lead from `1ee80dda6` after the B-04 seam).
- `node scripts/quality/audit-file-size.mjs --report` on the clean worktree:
  6,175 source files scanned; 951 over the 400-line cap; **951 frozen, 0 stale,
  0 violations**; 307,245 excess lines; 0 untracked WIP over-cap files.
  `pnpm audit:filesize` exit 0.
- Target `packages/engine/src/filters.ts`: 2,134 lines, baseline entry
  `2134` (baseline line 482). Covering test
  `packages/engine/src/filters.test.ts`: 436 lines, frozen at `436` (baseline
  line 481), 34 tests; not edited by this seam.
- Planner `godsplit-plan`: 2,134 lines, 11 imports, 80 blocks, exit 0;
  hazards: over-cap target, `adjustmentToFilter` 909-1498 is 590 lines,
  `adjustmentDefaults` 1681-2125 is 445 lines. Verifier smoke:
  `{ok: true, baseCount: 80, presentCount: 80, missing: [], missingExports: []}`,
  exit 0.
- Covering suite before the move:
  `node node_modules/vitest/vitest.mjs run packages/engine/src/filters.test.ts`
  -> 1 file, 34 tests passed, exit 0.
- Direct tsc substitute before the move: packages 20 checked / 20 pass / 0 fail;
  desktop exit 0 / 0 diagnostics; e2e exit 0 / 0 diagnostics.

## Gap -> action -> owner -> prompt file

| Gap | Action | Owner | Prompt file |
|---|---|---|---|
| Batch definitions and order | Batch B order in the campaign plan is lib.rs (B-01), print (B-02), clipboard (B-03), document codec (B-04), filters (B-05), then snapping, room server, bgremove, SAM2, ContentAwareFill, AdjustmentEditor. The ledger records B-01..B-04; the checkpoint is the committed B-04 seam. B-05 is the correct next entry. No other queue entry is opened in this session. | This session (Lead) | 01 |
| Seam text vs measured file content | The ranked backlog row 18 and the handoff agree with the measured file: one conversion module per adjustment family keyed by kind, a separate defaults table, and a separate CSS filter-chain fallback. The measured concerns match exactly: `adjustmentToFilter` (590 lines), `adjustmentDefaults` (445 lines), `filterToCss`/chain/apply (91 lines), plus the type catalog and the display-name helper. No seam text conflicts with the code; recorded in `SEAM_SPEC.md`. | This session | 01 -> 02 Step 1 |
| Destination ambiguity | 2,134 lines cannot fit the 400-line cap, so the destination is a directory `packages/engine/src/filters/` (one seam) with 17 cohesive modules plus `filters.ts` as the thin re-export entry. The specifier `./filters` keeps resolving to `filters.ts` (file wins over the sibling directory). | This session | 01 -> 02 Step 1 |
| Declaration over 400 lines (2 hazards) | `adjustmentToFilter` (590 lines, 54 case labels) and `adjustmentDefaults` (445 lines, 54 case labels) each exceed the cap on their own. Both are sub-split into four family dispatchers matching the seam text ("one conversion module per adjustment family keyed by kind"): tone, creative, effects, treatment. Case-body ranges are copied byte-verbatim; the shared base object stays one construction in the orchestrator; the unknown-kind fallback stays the orchestrator default. New family functions are internal only. | This session | 02 Step 1/2 |
| Type catalog over 400 lines | The 64 adjustment interfaces plus the catalog and union total about 865 lines. They are grouped by the same family boundaries into three contiguous type modules (`adjustmentTypesTone.ts`, `adjustmentTypesCreative.ts`, `adjustmentTypesEffects.ts`) with the catalog/blend/base in `types.ts` and the union in `adjustment.ts`. Type modules move verbatim; only import preambles and two inline type-import paths change. | This session | 02 Step 1/2 |
| Baseline regeneration | Single writer: this session runs `node scripts/quality/audit-file-size.mjs --update` in `.worktrees/B-05` after the split is green, no `--force`; diff must remove exactly `packages/engine/src/filters.ts: 2134`, 0 added, 0 grown; `pnpm audit:filesize` then exits 0 at 950. | This session | 02 Step 5 |
| Seam tooling scope | Both seam tools parse this TypeScript target and exit 0, so the standard protocol applies. The checkpoint planner does not implement `--top`; the supported no-flag full table is used (exit 0) and the mismatch is recorded. | This session | 01/02 |
| Module-scope state | `ADJUSTMENT_KINDS` is the only module-scope value; it gets exactly one home (`filters/types.ts`) and is re-exported by the barrel. No second copy anywhere. | This session | 02 Step 2 |
| Import distribution | The original 11-line import block cannot move verbatim; each new module gets the subset it uses, rebased one directory deeper. Two inline type imports are rebased. Biome sorts and formats import preambles; moved declaration bodies stay verbatim. | This session | 02 Step 2/4 |
| Public API preservation | The barrel explicitly re-exports all 80 original names (70 types, 10 values). The 8 new family dispatchers are not re-exported. `index.ts` and the 15 importing files keep the same specifier and names; no renames. | This session | 02 Step 1/2/4 |
| Rendering-path behavior | `adjustmentToFilter` output must stay identical: same case bodies, same property order, same fallback. The shared base object is passed in so the allocation count is unchanged; the dispatch is type-narrowed by kind. The covering suite and the render IR tests gate it. | This session | 02 Step 2/3/4 |
| Rollback | The seam is uncommitted until step 8; a failed extraction is discarded only inside `.worktrees/B-05`. Never reset the shared main checkout and never commit a partial seam. | This session | 02 Step 8 |
| Observability | Progress is the frozen count (951 -> 950), one ledger row, the baseline diff, the verifier JSON, and the before/after test counts; there is no dashboard. | This session | 02 Step 5/7 |
| Front-end / accessibility / i18n / dark mode | Does not apply: pure TypeScript engine code move, no rendered UI. Verdict: the front-end necessity gate does not fire; 03/04 are not opened. | This session | 01 Section D |
| Testing sufficiency | `packages/engine/src/filters.test.ts` is the real covering suite: 34 Vitest tests over the adjustment to `FilterIR` conversion, defaults, CSS fallback, and kind catalog. It does not cover a desktop render E2E; that is out of scope for a declaration move and is recorded as a residual. | This session | 02 Step 4 |
| Docs index | This entry adds only `remediation/B-05/*`, outside `docs/`; `pnpm audit:docs` does not require a `docs/README.md` row for it. The regenerated repo map and the ledger row are the only shared surfaces edited. | This session | 02 Step 6/7 |
| Concurrency | One writer in `.worktrees/B-05`; baseline/map/ledger are regenerated, never hand-merged. `pnpm queue:status` reported the exclusive queue free and no waiters. | This session | 02 Step 6 |
| Environment limits | Read-only pnpm store -> 22 node_modules symlinks plus the ignored onnxruntime-libs copy; queue EROFS -> direct tsc program substitute for `check:agent` and direct vitest for `test:agent`; planner `--top` unsupported; all recorded in `RESEARCH.md` and `SEAM_SPEC.md`. | This session | 01 environment table |
| Push/PR | Not authorized. Leave the one commit on `seam/B/B-05-filters` unmerged for review; do not push, merge, or prune. | Orchestrator/Lead | 02 Step 9 |
| Handoff | Re-instantiate `templates/NEXT-PROMPT.md` for the following unblocked Batch B entry (snapping) with fresh checkpoint measurements; write `NEXT_PROMPT.md` untracked at the main repo root; do not start that entry. | This session | 02 Step 10 |

## Front-end necessity gate

**No front-end work; the necessity gate does not fire.** The seam moves
TypeScript declarations only; no operator-visible surface, API response shape,
error/empty state, or remediation workbench is touched. The proof is the
unchanged 34/34 covering test result and the absence of any visual surface: no
renderer, canvas, DOM output, style file, or snapshot is in the moved set. The
statement for `SEAM_SPEC.md` is: no visual surface changed; visual validation
is not triggered.

## Decisions resolved before implementation

1. Destination directory `packages/engine/src/filters/` (one seam) because the
   target must end under the 400-line cap; `filters.ts` becomes the thin entry.
2. Seventeen destination modules plus the barrel: `types`, `adjustmentTypesTone`,
   `adjustmentTypesCreative`, `adjustmentTypesEffects`, `adjustment`,
   `conversionTone`, `conversionCreative`, `conversionEffects`,
   `conversionTreatment`, `conversion`, `cssFallback`, `displayNames`,
   `defaultsTone`, `defaultsCreative`, `defaultsEffects`,
   `defaultsTreatment`, `defaults`; every module expected at or under 400
   lines.
3. The barrel uses an explicit named re-export list (no wildcard), matching the
   A-04/B-04 precedent and making the export-preservation proof auditable.
4. `adjustmentToFilter` sub-split: four family dispatchers over disjoint kind
   sets, case bodies byte-verbatim, shared base passed as an argument, original
   unknown-kind fallback literal as the final `??` branch.
5. `adjustmentDefaults` sub-split: four family dispatchers over the same
   disjoint kind sets, case bodies byte-verbatim, the original base literal in
   the orchestrator, the original default base object as the final branch.
6. The type catalog moves verbatim in three contiguous family modules plus the
   catalog/base module and the union module; only import preambles and the two
   inline type-import paths change.
7. No `docs/` file is edited; the dated remediation record and campaign plan
   are read-only for this session.
