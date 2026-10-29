# B-06 research and gap analysis - snapping split

Phase 01 output for Batch B, entry B-06. Companion to `GAP_ANALYSIS.md`; the
declaration inventory and the seam decision live in `SEAM_SPEC.md`. Every
number below was measured on the checkpoint tree
`feb9f0eb67678b6885626699219540c8ab3e44f9` in `.worktrees/B-06` before any
source edit; the command that produced it is quoted with the result.

## Rule compliance

Do not plan and do not code before this file and `GAP_ANALYSIS.md` exist. Both
existed before implementation; `SEAM_SPEC.md` carries the hand-completed
declaration inventory. Research is repository evidence first; no external claim
was needed and no web search was used.

## Measured checkpoint state

Worktree `.worktrees/B-06`, branch `seam/B/B-06-snapping`, created from local
`master` after the Lead fast-forwarded `master` from
`00b2fb62f083b5e507ca3281f8406472b74ab7dc` to the B-05 checkpoint
`feb9f0eb67678b6885626699219540c8ab3e44f9`.

```
$ git -C .worktrees/B-06 rev-parse HEAD
feb9f0eb67678b6885626699219540c8ab3e44f9
$ git -C .worktrees/B-06 status --porcelain=v1 -b
## seam/B/B-06-snapping
$ node scripts/quality/audit-file-size.mjs --report
File-size budget report
Scanned 6192 source files; 950 over the 400-line cap; 950 frozen in
.file-size-baseline.json; 0 violation(s); 0 untracked WIP over-cap file(s).
Excess over cap: 305511 lines. Baseline entries: 950 (0 stale).
$ pnpm audit:filesize
File-size budget OK: 6192 source files scanned; 950 over 400 lines, all frozen
in .file-size-baseline.json (tracked content).   (exit 0)
```

- Baseline entries: 950 frozen, 0 stale, 0 violations, 0 untracked WIP
  over-cap. This matches the handoff checkpoint (950 / 0 stale) and is the
  authoritative reading; older dated counts are stale.
- Target `packages/editor/src/tools/snapping.ts`: 1,982 lines, frozen at
  `1982` (baseline line 413). Covering test
  `packages/editor/src/tools/__tests__/snapping.test.ts`: 827 lines, frozen at
  `827` (baseline line 408); it is not edited by this seam.
- Planner: `node scripts/quality/godsplit-plan.mjs
  packages/editor/src/tools/snapping.ts` -> `Lines: 1982 | imports: 3 |
  blocks: 62`, exit 0. Hazards: the target is over the 400-line cap;
  sub-split required for `snapPosition` lines 702-1381 (680 lines) and
  `snapSelectionBox` lines 1593-1966 (374 lines). The checkpoint planner
  accepts only `<file> [--json]`; `--top 200` exits 2 with usage text, so the
  supported no-flag full-table invocation is used.
- Verifier smoke: `node scripts/quality/refactor-verify.mjs --base master
  --target packages/editor/src/tools/snapping.ts --json` ->
  `{"ok": true, "baseCount": 61, "presentCount": 61, "missing": [], "missingExports": []}`,
  exit 0.
- Covering suite before the move:
  `node node_modules/vitest/vitest.mjs run packages/editor/src/tools/__tests__/snapping.test.ts`
  -> 1 file, 64 tests passed, exit 0 (27.33s). The handoff measured 64/64 on the
  checkpoint; the pass count may not decrease.
- Direct tsc substitute before the move (see the environment table): packages
  stage 20/20 pass, 0 fail; desktop exit 0 with 0 diagnostics; e2e exit 0.
- `pnpm worktree:status`: 43 worktrees total, 20 dirty, 0 unmerged, 0 stale
  candidates; the current row is
  `seam/B/B-06-snapping feb9f0eb6767 0d 0+0 505/149`. `node
  scripts/quality/validation-queue.mjs status`: `validation-queue: exclusive
  free; shared 0/4 slots busy; 0 waiting`.
- The worktree is clean apart from the ignored `node_modules` links (21
  measured; the B-05 handoff's 22nd link was `packages/automation`, an
  untracked package that does not exist at this checkpoint) and the ignored
  `apps/desktop/src-tauri/onnxruntime-libs` copy.

## Research themes (repository-native)

### 1. Module-evaluation side effects - applies low

The target has no import-time work: only imports, type declarations, three
module-scope constants (`SNAP_PRIORITY` and the two source-feature tuples at
lines 444, 579 and 580) and pure functions. There are no CSS side-effect
imports, worker pools, singletons, or top-level calls. The split must keep
exactly one module-scope home for each constant: `SNAP_PRIORITY` in
`snapping/candidates.ts`, `VERTICAL_SOURCE_FEATURES` and
`HORIZONTAL_SOURCE_FEATURES` in `snapping/guides.ts`. A copy placed in the
barrel or in two strategy modules would be a second source of truth. Execution
order of module evaluation changes only by declaration grouping; no declaration
evaluates anything observable at import time.

### 2. tsconfig project boundaries and package entry surfaces - applies, no change

`packages/editor/tsconfig.json` extends `tsconfig.base.json` with
`rootDir: "./src"`, `include: ["src"]`, `composite: false`. The destination
stays inside `packages/editor/src`, so it stays in the same tsconfig project.
`packages/editor/package.json` exports only `.`, `./auxiliary`, and
`./editor.css`; none of them names this tool module. No package entry point is
added or changed.

### 3. Path aliases and import ordering - applies

The target has 3 imports (`@varve/scene`, `@varve/shared`, and
`./isometricSnapping`). Destination modules move one directory deeper, so
`./isometricSnapping` becomes `../isometricSnapping`; the `@varve/*`
specifiers are unchanged. The inline type imports `import('@varve/scene').Vec2`
and `import('@varve/scene').Document` stay as inline types. Biome sorts and
formats only the import preambles; moved declaration bodies are copied
verbatim.

### 4. Template literals, regexes and code-like text - applies

The target builds display labels in template literals (`\`${gx}px\`,
`\`${b.w}px\`, spacing gap labels) and a numeric formatter uses the regex
`/0+$/` (line 458). A brace/regex-based mechanical cut can corrupt these.
Guard: cuts are made only on the planner declaration boundaries; moved bodies
are copied verbatim except for the mechanical extraction edits listed in
`SEAM_SPEC.md`, and the covering suite compares the resulting guide values.

### 5. Overloaded and identity-sensitive declarations - applies

There are no TypeScript overloads. The identity-sensitive surfaces are:

- 24 exported declarations: 12 type declarations, 4 constants, and 8 functions
  (see the inventory in `SEAM_SPEC.md`). The barrel re-exports all 24 names
  explicitly plus the two re-exported isometric types, so the specifier
  `./tools/snapping` resolves to `snapping.ts` (a file wins over a sibling
  directory) and keeps the same module identity.
- Importers that keep the same specifier and names: `SelectionOverlay.tsx`
  (`filterSnapTargetEntries`, `SnapBoxOptions`, `snapSelectionBox`),
  `SnapGuidesOverlay.tsx` and `CanvasOverlays.tsx` (`SnapGuide`),
  `CanvasArea.tsx` (`createSnapSession`, `IsometricSnapLock`, `SnapGuide`,
  `SnapSession`), `canvas/inputPipeline.ts` (`SnapGuide`,
  `createSnapSession`, inline `import('../tools/snapping').SnapSession`),
  `canvas/toolContext.ts` (`createSnapSession`, `filterSnapTargetEntries`,
  `pageSnapTargets`, `SnapGuide`, `SnapSession`, `SnapTarget`,
  `snapPosition`, `snapTargetSearchRect`), `tools/selectionSnapTargets.ts`
  (`SnapLineTarget`, `SnapSegmentTarget`),
  `tools/__benchmarks__/move.bench.ts` (`GridSnapConfig`, `snapPosition`),
  `tools/__benchmarks__/snapParity.bench.test.ts`, and
  `tools/__tests__/isometricSnapping.test.ts`. The covering test imports
  `createSnapSession`, `filterSnapTargets`, `pageSnapTargets`,
  `snapPosition`, `snapSelectionBox`, `snapSize`, `snapTargetSearchRect`.
- `snapPosition` is the solver contract: its return object keeps the
  `x/y/guides/matches/session/isometricLock` shape and the guide objects keep
  their fields and values byte-for-byte. `snapSelectionBox` keeps its
  `SelectionBox` output shape.

### 6. Same-named private helpers in sibling modules - applies

All 61 base declarations are assigned exactly one destination in
`SEAM_SPEC.md`. The extraction introduces new internal declarations that do not
exist in the base file (the candidate-state accumulator and the per-family
strategy functions). Each has exactly one home, none is re-exported from the
barrel, and none may be duplicated in a second module. The split must not
promote a private helper into the public surface: only the original 24 exports
leave the barrel.

### 7. Dropped declarations - applies

The inventory is complete before the cut: planner `baseCount: 61` and every
block was read in range and assigned a destination (see `SEAM_SPEC.md`). The
verifier must exit 0 before tests; a missing declaration or exported name means
the cut is incomplete, so the extraction is fixed rather than the verifier
suppressed.

### 8. Tracked-versus-untracked baseline policy - applies

New destination modules are untracked until staged; the report lists them as
untracked WIP but never freezes them. The staged-only check inside
`pnpm verify:commit` measures the blobs about to be committed, so every new
module is judged against the 400-line cap at staging time. `--update` never
freezes WIP and prunes entries whose file fell at or under the cap.

### 9. Stale and grandfathered baseline entries - applies

The entry `packages/editor/src/tools/snapping.ts: 1982` must leave the
baseline because the barrel ends far under the cap. The covering test is frozen
at 827 and is not edited. Expected ratchet: 950 -> 949 frozen entries; exactly
one removed, 0 added, 0 grown. A stale sibling or a growing frozen file would be
a blocker to report, never a reason to use `--force`.

### 10. Concurrent worktree conflict on peer-hot files - applies low

The baseline, the agent map, `BACKLOG_LEDGER.md`, `docs/README.md`, package
manifests, and lockfiles are single-writer surfaces. Only this session updates
the baseline and regenerates the map from its own staged tree. The queue is
idle, and path claims are advisory and not invoked by this entry protocol.

### 11. Rollback - applies

The seam is uncommitted until the commit step. A failed extraction is abandoned
by discarding only `.worktrees/B-06` changes for the paths this task created or
edited, or by leaving the worktree unmerged for review. The shared main checkout
is never reset, and a partial seam is never committed to save it. If the
baseline cannot ratchet down, stop before committing.

### 12. Rust-crate equivalents - does not apply

This is a TypeScript package seam. Both seam tools parse TypeScript/JavaScript
and both exited 0 on the target, so the standard protocol applies. There is no
`mod` registration, `generate_handler!` entry, or `audit:ipc` surface in this
change; the measured command set is `godsplit-plan`, `refactor-verify`,
focused Vitest, and the direct tsc stages.

## Environment limits and substitutions

| Limit | Measured evidence | Substitution used |
|---|---|---|
| Read-only pnpm store | `pnpm install --frozen-lockfile` (and every pnpm script's pre-run install) fails with `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` / `Read-only file system (os error 30)` | 21 `node_modules` symlinks from the main checkout plus an ignored copy of `apps/desktop/src-tauri/onnxruntime-libs`; `pnpm audit:filesize` still exits 0 at 950 |
| Recursive pnpm task state on symlinked trees | `pnpm -r --filter "./packages/*" exec tsc ...` -> `ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH` (node_modules is a symbolic link) | direct `node node_modules/typescript/bin/tsc -p packages/<pkg>/tsconfig.json --noEmit --pretty false` loop; `pnpm --dir apps/desktop exec tsc` and `./node_modules/.bin/tsc -p tests/e2e/tsconfig.json` worked |
| Validation queue EROFS | `pnpm check:agent` -> `EROFS: read-only file system, open '/run/user/1000/varve-validation-queue/exclusive.lock'`, exit 1 | direct recursive tsc program measured before and after (expected 20/20 packages, desktop 0, e2e 0) |
| Queued focused tests | `pnpm test:agent` uses the same queue and is unavailable for the same reason | `node node_modules/vitest/vitest.mjs run packages/editor/src/tools/__tests__/snapping.test.ts` |
| Planner flag mismatch | `godsplit-plan.mjs <file> --top 200` -> usage text, exit 2 | supported no-flag full-table invocation (exit 0) |

## Reference-tool and failure-mode analysis

Codemod-style and batch refactoring tools fail in four ways relevant here:
silent skips (a declaration or inline candidate block not matched by the
pattern), false success (the tool reports a count that does not prove the
move), type-check failures after automated edits (unrebased imports or widened
signatures), and changeset review blindness (a large diff that hides a behavior
edit). This seam answers each:

- Silent skips are prevented by the planner-seeded, hand-completed inventory and
  by `refactor-verify` as the independent AST check; it exits 1 on a missing
  declaration or exported name.
- False success is prevented by running the verifier before tests, recording its
  JSON, and by the before/after covering-suite counts (64/64 measured above).
- Type-check failures are caught by the direct recursive tsc stages (20
  packages, desktop, e2e) run before and after; the before baseline must be
  clean so any after diagnostics are attributable to the move.
- Review blindness is bounded by the planned-edit set in `SEAM_SPEC.md` (import
  preambles, the candidate-state parameterization, the per-family strategy
  calls, and the barrel) and by keeping every moved body otherwise verbatim.

Existing machinery: `pnpm check:agent` (here the direct tsc substitute) types
the tree after the move; `refactor-verify` proves declaration and export
preservation; the focused Vitest suite exercises 64 behavior tests;
`pnpm audit:filesize` is shrink-only; `pnpm verify:commit` judges only the
staged tree. Precedents reused: `packages/editor/src/menu/defs.ts` became an
11-line barrel plus 15 modules under `menu/defs/`; B-05 (filters) preserved
80/80 declarations behind a thin barrel.

Residual risks that stay explicit checks in `SEAM_SPEC.md`: (a) the
`snapPosition` sub-split is the only structural edit to a function body, so the
inline candidate groups are extracted without changing their order, literals,
or accumulator update order, and the sticky-resolution helper is a 1:1 mapping
of the original branches; (b) the new strategy helpers are new declarations that
must not leak into the public barrel; (c) the file-versus-directory resolution
for `./tools/snapping` is validated by the unchanged imports, the covering
suite, and all three tsc stages; (d) `snapSelectionBox` (374 lines) is kept as
one module, expected at 350-400 lines after imports and under the cap.

## Failure modes -> guardrails

| Failure mode | Evidence / risk here | Guardrail | Owner prompt |
|---|---|---|---|
| Silent declaration drop or rename | 61 base declarations; a split can skip a block | Complete inventory; `refactor-verify` exit 0 before tests and after biome | 02 Step 1/3 |
| Behavior change hidden in the snapPosition sub-split | `snapPosition` is one 680-line function whose candidate groups write a shared accumulator in a fixed order | Extract inline groups into strategy functions that receive the same accumulator state; preserve candidate order, literals, and strict-before updates; covering suite 64/64 before and after | 02 Step 2 |
| Sticky-lock branch drift | X and Y resolution are near-duplicated branches with release/scope handling | One `resolveAxisSticky` helper with a 1:1 branch mapping; the lock types and `tryStickyAxis` move verbatim | 02 Step 2 |
| Second copy of module-scope constants | `SNAP_PRIORITY` and the two feature tuples are the only module-scope values | One home each (`candidates.ts`, `guides.ts`); the barrel re-exports only the original constant names | 02 Step 2 |
| Cut through a template literal or regex | `solver labels and the numeric formatter | Declaration-boundary cuts; moved bodies verbatim; covering suite checks guide values | 02 Step 2/3 |
| Public API drift | 10+ importing files plus the covering test; the module specifier must stay the same | Explicit named re-exports of all 24 original names plus the two isometric types; new helpers stay internal; no renames | 02 Step 1/2 |
| New module over cap | 1,982 lines redistribute into 11 modules plus the barrel | Destination map keeps every module at or under 400; measured with `wc -l` before staging | 01/02 |
| Partial extraction (target stays frozen) | 1,982 lines must leave the path | Barrel projected about 65 lines; baseline entry removed; report no longer lists the target | 02 Step 5 |
| Frozen covering test grows | `snapping.test.ts` frozen at 827 | Do not edit the test; the staged check rejects growth | 02 Step 4 |
| Baseline growth / WIP freeze | `--update` is conservative | Never `--force`, never hand-edit; diff exactly one removed entry; `pnpm audit:filesize` green | 02 Step 5 |
| Stale generated surfaces | The agent map is generated from the staged tree | `pnpm agent:map` after staging; `pnpm verify:commit` staged-only | 02 Step 6 |

## Edge-case register

| Edge case | Verdict for B-06 |
|---|---|
| Module-eval side effects (state, CSS, pools) | Applies low: three module-scope constants, one home each; no side-effect imports or top-level calls. |
| tsconfig project boundaries / package entry points | Applies, no change: destination stays inside `packages/editor/src`; the editor package entry surface is untouched; `./tools/snapping` still resolves to `snapping.ts`. |
| Path aliases and import ordering | Applies: intra-tools imports rebased one level (`../isometricSnapping`); `@varve/*` unchanged; biome sorts preambles only. |
| Template-literal / regex / code-like text | Applies: guide labels, spacing labels, numeric formatter; cuts on declaration boundaries only. |
| Overloaded / identity-sensitive declarations | Does not apply to overloads (none). Identity applies: 24 exported names, same specifier, explicit re-export list, no renames; solver return shapes preserved. |
| Same-named private helpers in sibling modules | Applies: new strategy helpers and the candidate-state factory get one home each; no duplicates; not re-exported. |
| Dropped declaration | Applies: 61/61 base declarations must survive; verifier exit 0 before tests. |
| Parse failure in the target or destination | Applies: planner and verifier parse the target today (exit 0); tsc parses every new module. |
| Tracked-vs-untracked baseline policy | Applies: clean worktree; new modules untracked until staging, measured first; no WIP freeze. |
| Stale / grandfathered baseline entry | Applies: exactly the `snapping.ts` entry leaves; the frozen covering test is untouched; 0 added, 0 grown. |
| Baseline regeneration refusing to add or raise | Applies: `--update` must complete with removed 1 / added 0 / grown 0; a refusal is a blocker. |
| Test-file exemption from the ratchet | Does not apply: tests count as source; the covering test is frozen and untouched. |
| Generated files and exclusions | Not applicable: no `vendor` path or generated-table path is touched. |
| Concurrent worktree conflict on peer-hot files | Applies low: single writer in `.worktrees/B-06`; shared surfaces regenerated, never hand-merged; queue idle. |
| Rollback path | Applies: uncommitted seam; discard only this worktree; never reset the shared checkout. |
| Unknown / unresolved tools | Resolved: planner and verifier parse the target (exit 0); both exit 2 on bad input; planner `--top` flag mismatch recorded. |

## Front-end necessity gate

Verdict: **does not fire.** The seam is a pure TypeScript code move inside
`packages/editor/src/tools`; it renders nothing, changes no API response shape,
no error/empty/loading state, and no remediation workbench exists. The proof is
the unchanged covering suite
`packages/editor/src/tools/__tests__/snapping.test.ts` (64 tests, run before
and after the move with the identical pass count and 0 failures). The visual
surface statement for `SEAM_SPEC.md` is: no visual surface changed; visual
validation is not triggered, so prompts 03 and 04 stay unopened.
