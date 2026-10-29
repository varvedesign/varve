# B-11 research and gap analysis — AdjustmentEditor family split

Status: repo-native execution of the Batch B queue entry B-11. One seam, one
worktree, one commit. This document is written before the commit, from
measurements taken in `.worktrees/B-11` on `seam/B/B-11-adjustment-editor`.

## Measured checkpoint state

All values below were measured on this branch worktree; commands are quoted so
the numbers can be reproduced.

- Worktree `.worktrees/B-11`, branch `seam/B/B-11-adjustment-editor`, HEAD
  `5e4b1955c21baa05b15529c56e5221e3abfbaf2a` ("Merge seam B/B-10
  (content-aware fill) into master"). The integrated base contains the B-10
  checkpoint `196535bafd5d8095635f5d7caf1ac5d5b87fc408`
  (`git merge-base --is-ancestor 196535bafd5d master` was true at recon time);
  local `master` is moving concurrently with unrelated responsive-layout docs
  commits (`git rev-parse master` measured `0957d2db6d58...` while this
  document was written; the seam branch base stays `5e4b1955c`).
- Clean start: `git status --porcelain` returned 0 paths on the checkpoint
  worktree before any seam edit.
- Baseline: `.file-size-baseline.json` line 135 holds
  `"packages/editor/src/components/AdjustmentLayer/AdjustmentEditor.tsx": 2405`;
  `node -e` over the JSON measured `ENTRIES=945 TARGET=2405`.
- `node scripts/quality/audit-file-size.mjs --report` (clean worktree):
  "Scanned 6280 source files; 945 over the 400-line cap; 945 frozen in
  .file-size-baseline.json; 0 violation(s); 0 untracked WIP over-cap file(s)."
  "Excess over cap: 294933 lines. Baseline entries: 945 (0 stale)."
- Target file `wc -l` = 2405; covering test
  `packages/editor/src/components/AdjustmentLayer/AdjustmentEditor.test.tsx`
  `wc -l` = 309.
- `node scripts/quality/godsplit-plan.mjs <target>` exit 0: "Lines: 2405 |
  imports: 23 | blocks: 24"; hazards measured: `LegacyAdjustmentEditor`
  lines 104-910 is 807 lines on its own, `HalftoneEditor` lines 1285-1730 is
  446 lines on its own.
- `node scripts/quality/refactor-verify.mjs --base master --target <target>
  --json` on the untouched base exits 0 with
  `{ok:true,baseCount:24,presentCount:24,missing:[],missingExports:[]}` (the
  handoff checkpoint measurement; after the move the same command returns
  `{ok:true,baseCount:24,presentCount:33,missing:[],missingExports:[]}`).
- Covering component test baseline: the prompt handoff measured
  `./node_modules/.bin/vitest run
  packages/editor/src/components/AdjustmentLayer/AdjustmentEditor.test.tsx
  --reporter=dot` at 18 passed / 0 failed / 44.32 s. This session measured the
  covered pair on the clean worktree:
  `AdjustmentEditor.test.tsx` + `AdjustmentPanel.test.tsx` = 2 files /
  32 tests passed (18 + 14) / 0 failed / 45.90 s. After the move the same pair
  is 2 files / 32 passed / 0 failed / 65.76 s.
- Package: `packages/editor`; the destination stays inside
  `packages/editor/src`, so no workspace/package boundary changes.
- Environment substitutions (measured, same as B-10): the worktree's pnpm store
  is read-only (`ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`), so the main
  checkout's installed `node_modules` trees are symlinked into the worktree
  (21 symlinks measured with `find . -maxdepth 3 -name node_modules -type l |
  wc -l`). The validation queue is EROFS on
  `/run/user/1000/varve-validation-queue` although `pnpm queue:status`
  reports "validation-queue: exclusive free; shared 0/4 slots busy; 0
  waiting". Direct substitutions are used: `./node_modules/.bin/vitest run
  <spec> --reporter=dot` for tests and the direct `tsc` loop for the
  `check:agent:raw` program. No Rust substitution applies to this entry.
- `pnpm worktree:status` measured the worktree as
  `current seam/B/B-11-adjustment-editor 5e4b1955c21b ... /home/kevina/.../
  .worktrees/B-11`, 0 commits ahead of its base, no conflicting writer.

- `pnpm queue:status` measured "validation-queue: exclusive free; shared 0/4
  slots busy; 0 waiting"; `pnpm worktree:status` measured "worktrees: 48
  total, 19 dirty, 0 unmerged, 0 stale candidate(s), 47 external" with the B-11
  line `current seam/B/B-11-adjustment-editor 5e4b1955c21b 0d 0+0 524/152`.
  The 21 symlinked `node_modules` trees are the root, `.opencode`,
  `apps/desktop`, `apps/website`, and 17 package trees (crash/help/tokens
  have no package-local link).
- Direct `tsc` program derived from `package.json`: `check:agent:raw` =
  `pnpm -r --filter "./packages/*" exec tsc -p tsconfig.json --noEmit --pretty
  false && pnpm --dir apps/desktop exec tsc --noEmit --pretty false && tsc -p
  tests/e2e/tsconfig.json --noEmit --pretty false`, reproduced with
  `./node_modules/.bin/tsc` (TypeScript 6.0.3) once per project. The pre-flight
  baseline measured 22 projects checked / 0 failures / 0 diagnostics (949 s);
  its last two projects overlapped the seam writes, so the unambiguous
  post-split rerun is the gate recorded in `SEAM_SPEC.md`.
- Standalone covering-test baseline on the clean worktree (direct binary):
  `./node_modules/.bin/vitest run
  packages/editor/src/components/AdjustmentLayer/AdjustmentEditor.test.tsx
  --reporter=dot` → 18 passed / 0 failed / 26.03 s.

## Consumer and spec inventory (measured)

- Public exports of the target (base): `AdjustmentEditorProps` (L52),
  `AdjustmentEditor` (L97), `curvesPointsToCurvePoints` (L1010),
  `curvePointsToCurvesPoints` (L1020). Exactly four named exports; no default
  export.
- Import sites (repo-wide grep, `packages/`, `apps/`, `tests/`):
  `components/AdjustmentLayer/AdjustmentPanel.tsx:29`,
  `components/Inspector/sections/SmartFiltersSection.tsx:34`, and the covering
  test `AdjustmentEditor.test.tsx:5-9`. All import from the path
  `./AdjustmentEditor` / `./components/AdjustmentLayer/AdjustmentEditor`; the
  path must keep exporting the same names. No app, barrel, or script consumer.
- The covering test imports exactly
  `{ AdjustmentEditor, curvePointsToCurvesPoints, curvesPointsToCurvePoints }`
  and no type/default import; it never `vi.mock`s the module (repo-wide
  `vi.mock(.*AdjustmentEditor` = 0 hits). `AdjustmentEditorProps` has no
  external importers; it is exported API only.
- `AdjustmentPanel.test.tsx` (251 lines, 14 tests) does not name
  `AdjustmentEditor`; it renders it indirectly through `AdjustmentPanel.tsx:542`
  and therefore exercises brightness/contrast/levels/halftone paths of the
  dispatcher.
- Direct unit coverage (measured by reading the spec): 13 of the 24 top-level
  blocks are touched by `AdjustmentEditor.test.tsx`; the 18 cases directly
  assert spatial routing (motionBlur/mosaic/surfaceSmooth/edgeInk), LUT
  capability disclosure, curves (3 cases), levels (render), shadow/highlight,
  color balance, threshold, duotone, and photo filter, plus the two exported
  curve converters. 11 blocks have no direct unit hit; `SelectiveColorEditor`
  has no automated coverage at any layer today; `paramsToLevelsAdjustmentPatch`
  and `managedToColor` are not executed by the unit pair.
- e2e coverage exists but is not a unit gate for this seam: the dedicated
  `tests/e2e/canvas/front-facing-adjustments.spec.ts` (6 tests) plus family
  specs (`halftone-visual`, `tonal-workflows`, `new-effects`,
  `verify-effects`, `color-effects`, `lut-import`, `smart-filters`,
  `gradient-map`, `adjustment-picker`, `adjustments-tab-audit`) render the
  editor. No visual baseline is keyed to this component (`tests/visual/` is
  absent; the visual harness replays engine IR). The seam therefore does not
  run a browser lane and does not touch e2e files.

## Required reading (protocol order)

1. `docs/quality/agent-context-remediation-2026-10-28.md` — five-defect matrix,
   ranked backlog row 14 (AdjustmentEditor.tsx, 2,405 lines, Batch B), the
   `menu/defs.ts` and A-08 precedents.
2. `docs/plans/agent-infrastructure-campaign-2026-10-28.md` — per-split task
   protocol, worker rule, Batch B table, B-11 seam row.
3. `docs/quality/file-size-policy.md` — 400-line cap, 350-400 target, baseline
   lifecycle, `--update` / `--force` rules, seam tooling JSON contract.
4. `.ai/skills/split-god-file.md`, `.ai/skills/concurrent-worktree.md`,
   `.ai/skills/run-shared-validation.md` — the three repository playbooks.
5. `docs/quality/concurrent-agents.md` — worktree isolation, single-writer
   surfaces, staged-only validation, merge protocol.
6. `docs/agents/validation-and-workflow.md` — validation economy, exact
   commands, heavy-lease policy.
7. `remediation/prompts/00-VARVE-ADAPTER.md` … `04-VISUAL-VALIDATION-AND-CLOSEOUT.md`
   — the remediation protocol executed here.
8. The target read by line ranges only (never one whole-file read), the covering
   test read fully, and the two prior seam specs `remediation/B-09/SEAM_SPEC.md`
   and `remediation/B-10/SEAM_SPEC.md` for the orchestrator-plus-phases format.

## A. Research themes (repository evidence first)

1. **Module-evaluation side effects.** The target has exactly one side-effect
   import, `import './adjustment.css'` at L50, and no module-scope worker pool,
   singleton, subscription, or top-level instantiation; the only module-scope
   value is `const HALFTONE_SHAPE_OPTIONS` (L1271-1279). A split must keep the
   CSS import exactly once (it stays in the target shell, which every consumer
   and the test still import) and must not add a second CSS evaluation in a
   phase module. `BooleanRow` (L73-95) was defined only in this file
   (repo grep: one hit), so it gets a new single home in `controls.tsx`.
2. **tsconfig project boundaries and package exports.** The destination
   `packages/editor/src/components/AdjustmentLayer/adjustmentEditors/` is under
   `packages/editor/tsconfig.json` `include: ["src", ...]`; no cross-package
   import is introduced and `package.json`/`exports` are untouched. All
   `@varve/*` imports keep their existing specifiers.
3. **Path aliases and import ordering.** Workspace imports keep
   `@varve/*`; relative imports are rebased for the deeper destination (for
   example `./ColorBalanceAdjustmentEditor` becomes
   `../../ColorBalanceAdjustmentEditor` from `legacy/`, and
   `../Inspector/controls/RangeValueControl` becomes
   `../../../Inspector/controls/RangeValueControl`). Biome organizes and
   formats imports; it must not be used to rewrite moved logic.
4. **JSX and code-like text.** The file is dense JSX with long class names,
   accessible labels, and inline casts. Cuts are made only at planner/AST
   declaration boundaries and at measured case-clause boundaries
   (`case` labels from the TypeScript AST, not brace counting); JSX text and
   template literals are never re-flowed by hand.
5. **Identity-sensitive declarations.** `AdjustmentEditor` is the single
   exported dispatcher and stays defined in the original module path; the two
   exported curve converters move to `curves.tsx` and are re-exported by name
   from the original path (the test imports them from there). No declaration is
   renamed; the only new names are the private phase/hook/component wrappers the
   sub-split requires.
6. **Same-named private helpers in sibling modules.** One home per helper:
   `BooleanRow` → `controls.tsx`; `colorToManaged`/`managedToColor` →
   `managedColor.ts`; `levelsAdjustmentToParams`/`paramsToLevelsAdjustmentPatch`
   stay module-local in `levels.tsx`; `HALFTONE_SHAPE_OPTIONS`/`patternForShape`
   → `halftone/options.ts`. No duplicate copies are created.
7. **Dropped declarations.** The hand-completed inventory in
   `SEAM_SPEC.md` covers all 24 planner blocks; `refactor-verify` must exit 0
   with `missing: []` and `missingExports: []` before tests run. A declaration
   that moves but loses its export, or is silently dropped by a case-range cut,
   fails the verifier; edits are never hidden by verifier changes.
8. **Tracked-versus-untracked baseline policy.** The 24 new modules are
   untracked WIP until staged and are reported, never frozen; they are measured
   by the staged `--staged` check at commit time. `--update` never freezes WIP
   and prunes the parent entry because the parent ends at 15 lines.
9. **Stale and grandfathered baseline entries.** Exactly the B-11 target entry
   must leave the baseline (945 → 944); no entry may be added or grown, and
   `--force` is forbidden. The pre-edit gate measured 0 stale entries, so the
   only stale entry after the split is the B-11 target itself.
10. **Concurrent worktree conflict on peer-hot files.** Baseline, generated
    repo map, `BACKLOG_LEDGER.md`, `docs/README.md`, and package manifests are
    single-writer surfaces. The task is executed by one writer in
    `.worktrees/B-11`; the B-10 worktree and branch stay untouched; the paths
    are claimed advisory-only with `node scripts/quality/path-claims.mjs`.
11. **Rollback.** The seam is uncommitted until Step 8. A failed extraction is
    discarded inside `.worktrees/B-11` only (restore the target from HEAD, delete
    the untracked destination tree); the shared checkout, master, and other
    sessions' files are never touched, and a partial seam is never committed.
12. **Rust-crate equivalents.** Does not apply: this entry has no Rust seam.
    `refactor-verify` parses TypeScript/JavaScript only, which is the language
    surface here.

## B. Reference-tool and failure-mode analysis

Codemod/batch-refactoring tools fail at silent skips (a declaration not matched
by a pattern), false-success reporting, post-edit type-check failures, and
review blindness from a large unchanged-looking changeset. The seam machinery
maps to those failures as follows.

| Failure mode | Evidence in this repository | Guardrail | Owner prompt |
|---|---|---|---|
| Silent skip / dropped declaration | `refactor-verify` exists because the Go-era tooling could "succeed" while losing declarations; `godsplit-plan` reports 24 blocks | `refactor-verify --base master --target <target> --dest <dest>` must exit 0 with `missing: []`, `missingExports: []` before tests | 02 Step 3 |
| Post-edit type failure | `tsconfig.base.json` has `verbatimModuleSyntax`, `noUnusedLocals`, `noUnusedParameters` (TS 6.0.3 measured), so a moved module with a stale import fails | direct recursive `tsc` over the `check:agent:raw` program (queue EROFS substitution) + `biome check` | 02 Step 4 |
| Behavior drift in a "pure move" | component spec imports the public path; `AdjustmentPanel.test.tsx` renders through the panel | covering tests before and after, identical count; no test edit; no snapshot update | 02 Step 4 |
| Silent baseline drift | baseline is shrink-only; 945 entries, 0 stale pre-edit | `node scripts/quality/audit-file-size.mjs --update` then `pnpm audit:filesize`; review diff = exactly one removal, 0 added/grown | 02 Step 5 |
| Unreviewable changeset | B-10 commit is 49 files; this seam is 25 files + map/baseline/ledger/docs | one commit, one seam, receipt + ledger row; commit file list restricted to seam files | 02 Steps 6-8 |
| Concurrent-write corruption | generated map and baseline are shared surfaces; B-10 and other sessions exist in the same checkout | one worktree, one writer; stage then regenerate map from the staged tree; `pnpm verify:commit` | 02 Step 6 |

Remaining risks that are not covered by types or tests are handled explicitly in
`SEAM_SPEC.md`: the persistence of `hueSaturationRange` state across adjustment
kind switches, the nested `LutEditor` function identity (remount/state-reset
today), and the always-mounted Halftone Advanced disclosure.

## C. Edge-case and gap register

| Edge case | Applies? | Decision / evidence | Guardrail |
|---|---|---|---|
| Module-eval side effects (CSS import, module constants) | applies (CSS only) | CSS import stays exactly once in the target shell; no module-scope value changes home except `HALFTONE_SHAPE_OPTIONS` | grep for `adjustment.css` in the seam; only pre-existing 3 files import it, and the target keeps its single import |
| tsconfig boundaries / package entry points | applies (no change) | all new paths under `packages/editor/src`; no `package.json` edit | direct `tsc -p packages/editor/tsconfig.json` |
| Path aliases and import ordering | applies | relative specifiers rebased by destination depth; workspace aliases unchanged | biome check + tsc; import diff reviewed |
| JSX/template-literal cut safety | applies | cuts by planner blocks and AST case clauses only | unit partition proof in `SEAM_SPEC.md` |
| Identity-sensitive declarations | applies | original path keeps all 4 named exports; converters re-exported by name; no default export | test imports 3 names from `./AdjustmentEditor`; refactor-verify `missingExports: []` |
| Same-named private helpers | applies | one home per helper (see theme 6) | refactor-verify declaration set + grep for duplicate definitions |
| Dropped declaration | applies | inventory complete (24/24) | `refactor-verify` exit 0 before tests |
| Parse failure in target or a destination module | applies | planner parses the target (24 blocks); tsc/biome parse every new module | `godsplit-plan` exit 0; tsc exit 0; biome exit 0 |
| Tracked-vs-untracked baseline policy | applies | new modules untracked until staging; `--update` cannot freeze WIP; staged size check at commit | `--staged` inside `pnpm verify:commit` |
| Stale/grandfathered/slack-band baseline entry | applies | exactly the target is stale after the split; 0 other stale entries measured | baseline diff review; `--force` forbidden |
| Baseline regeneration refusing to add/raise | not expected | 24 new modules all ≤400 lines (largest 322); target ends at 15 | if `--update` adds/grows anything, stop |
| Test-file exemption from the ratchet | n/a | covering test untouched (309 lines) | no test edit in the commit |
| Generated files and exclusions | n/a | `vendor/**` and 3 machine-generated data tables stay untouched | path allowlist in the commit |
| Concurrent worktree conflict | applies | one writer; advisory claims on AdjustmentLayer, baseline, map, ledger, remediation/B-11 | `pnpm worktree:status`, claims |
| Rollback path | applies | seam uncommitted until commit; discard only worktree files | no reset of the shared checkout |
| Unknown/unresolved tools | n/a | `godsplit-plan`, `refactor-verify`, `audit-file-size`, `path-claims` all exist and exit 0 at the checkpoint | pre-flight smoke |
| Hook order / state lifetime | applies (the real hazard) | hooks stay in the orchestrator/hook chain in base order; nested `LutEditor` stays a nested function; Halftone Advanced stays unconditionally mounted | `SEAM_SPEC.md` Hook invariants + unit proof |
| Front-end/visual surface | does not fire | pure code motion; jsdom component test is the rendered-surface proof; no visual baseline exists for this component | prompt 03 answered "not triggered"; prompt 04 not fired |

## Failure modes -> guardrails

| Failure mode | Measured evidence | Guardrail command | Owner |
|---|---|---|---|
| Dropped declaration | base 24 blocks, 4 exports | `refactor-verify ... --json` exit 0, `missing: []`, `missingExports: []` | seam worker (02 Step 3) |
| Type break after move | `verbatimModuleSyntax`/`noUnusedLocals` TS 6.0.3; 20 package tsconfigs | direct recursive `tsc` program exit 0 | seam worker (02 Step 4) |
| Rendered behavior break | 18 Case + 14 panel tests; direct path imports | direct vitest pair before/after, identical counts | seam worker (02 Step 4) |
| Style/lint drift | biome recommended rules, `useImportType: error` | `biome check --write` then `biome check` exit 0 | seam worker (02 Step 4) |
| Baseline drift | 945 frozen / 0 stale; target 2405 | `--update`, review diff, `pnpm audit:filesize` exit 0 | seam worker (02 Step 5) |
| Shared-surface corruption | map/baseline/ledger are generated/single-writer | stage → `pnpm agent:map` → `pnpm verify:commit` | seam worker (02 Step 6) |
| Hidden behavior change in sub-split | hook inventory and state-lifetime hazards H1-H4 | Hook invariants + partition proof; stop on any unprovable drift | seam worker + Lead review |
| Stale counts in the handoff | master moves concurrently | re-measure at handoff time from the committed branch worktree | Lead (Step 10) |
