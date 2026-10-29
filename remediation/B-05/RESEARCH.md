# B-05 research and gap analysis - filters split

Phase 01 output for Batch B, entry B-05. Companion to `GAP_ANALYSIS.md`;
the declaration inventory and seam decision live in `SEAM_SPEC.md`. Every
number below was measured on the checkpoint tree
`00b2fb62f083b5e507ca3281f8406472b74ab7dc` in `.worktrees/B-05` before any
source edit; the command that produced it is quoted with the result.

## Rule compliance

Do not plan and do not code before this file and `GAP_ANALYSIS.md` exist.
Both exist before implementation; `SEAM_SPEC.md` carries the hand-completed
declaration inventory. Research is repository evidence first; no external claim
was needed and no web search was used.

## Measured checkpoint state

Worktree `.worktrees/B-05`, branch `seam/B/B-05-filters`, created from local
`master` after the Lead fast-forwarded `master` from
`1ee80dda64e67bf7a8f8c8a4f54a0f7677dcc9f6` to the B-04 checkpoint.

```
$ git -C .worktrees/B-05 rev-parse HEAD
00b2fb62f083b5e507ca3281f8406472b74ab7dc
$ git -C .worktrees/B-05 status --porcelain=v1 -b
## seam/B/B-05-filters
$ node scripts/quality/audit-file-size.mjs --report
Scanned 6175 source files; 951 over the 400-line cap; 951 frozen in
.file-size-baseline.json; 0 violation(s); 0 untracked WIP over-cap file(s).
Excess over cap: 307245 lines. Baseline entries: 951 (0 stale).
$ pnpm audit:filesize
File-size budget OK: 6175 source files scanned; 951 over 400 lines, all frozen
in .file-size-baseline.json (tracked content).   (exit 0)
```

- Baseline entries: 951 frozen, 0 stale, 0 violations, 0 untracked WIP
  over-cap. This matches the handoff checkpoint (951 frozen / 0 stale) and the
  authoritative reading; the older 956/952 counts in dated records are stale.
- Target `packages/engine/src/filters.ts`: 2,134 lines, frozen at `2134`
  (baseline line 482). Covering test `packages/engine/src/filters.test.ts`:
  436 lines, frozen at `436` (baseline line 481); it is not edited by this
  seam.
- Planner: `node scripts/quality/godsplit-plan.mjs
  packages/engine/src/filters.ts` -> `Lines: 2134 | imports: 11 | blocks: 80`,
  exit 0. Hazards: the target is over the 400-line cap; sub-split required for
  `adjustmentToFilter` lines 909-1498 (590 lines) and `adjustmentDefaults`
  lines 1681-2125 (445 lines). The checkpoint planner accepts only
  `<file> [--json]`; the handoff `--top 200` invocation exits 2 with usage
  text, so the supported no-flag full-table invocation is used.
- Verifier smoke: `node scripts/quality/refactor-verify.mjs --base master
  --target packages/engine/src/filters.ts --json` ->
  `{"ok": true, "baseCount": 80, "presentCount": 80, "missing": [], "missingExports": []}`,
  exit 0.
- Covering suite before the move:
  `node node_modules/vitest/vitest.mjs run packages/engine/src/filters.test.ts`
  -> 1 file, 34 tests passed, exit 0. The handoff measured 34/34 on the
  checkpoint; the pass count may not decrease.
- Direct recursive tsc substitute (the three stages of `check:agent:raw`, run
  through `node node_modules/typescript/bin/tsc` to avoid the pnpm pre-script
  install attempt), before the move: `packages-checked=20 packages-fail=0`,
  `desktop-exit=0 desktop-diagnostics=0`, `e2e-exit=0 e2e-diagnostics=0`.
- `git status` on the worktree is clean apart from the ignored
  `node_modules` links and the ignored onnxruntime-libs copy.

## Research themes (repository-native)

### 1. Module-evaluation side effects - applies low

The target declares exactly one module-scope value: `ADJUSTMENT_KINDS`
(lines 43-92), a 47-entry literal array spread with `IMAGE_TREATMENT_KINDS`
from `./imageTreatments` (7 entries, `imageTreatments/schema.ts` lines
12-20), for 54 kinds total. Everything else is types and functions. There are
no CSS side-effect imports, no worker pools, no singleton construction, and no
top-level work beyond that array literal. After the split the catalog has
exactly one home (`filters/types.ts`) and the entry `filters.ts` re-exports
it; no second copy exists, so runtime kind validation and the type source cannot
drift. Failure mode: re-declaring the catalog in the barrel or in a family
module would create two sources of truth; the inventory lists one home per value
declaration.

### 2. tsconfig project boundaries and package entry surfaces - applies, no change

`packages/engine/tsconfig.json` extends `tsconfig.base.json` with
`rootDir: "./src"`, `include: ["src"]`, `composite: false`. The destination
stays inside `packages/engine/src`, so it stays in the same tsconfig project.
`packages/engine/package.json` exports only specific subpaths (".", "./font",
"./liveEffects", "./rasterPyramid", "./gpuAdapter", "./nativeAcceleration",
"./semanticSimilarity", "./vision", "./hdr", "./raw", "./segmentationQuality",
"./foregroundSelect", "./subjectProposal"); it has no `./filters` entry. The
public surface is `. -> src/index.ts`. `index.ts` re-exports the adjustment
types (block ending line 506) and the value exports `ADJUSTMENT_KINDS,
adjustmentDefaults, adjustmentsToFilters, adjustmentToFilter, applyFilterChain,
filterChainToCss, filterKindDisplayName, filterToCss, isKnownAdjustmentKind,
makeAdjustment` (block ending line 518) from `./filters`. The specifier
`./filters` resolves to `filters.ts` (a file wins over the sibling directory),
so every importer keeps the same module path. No package entry point is added or
changed.

### 3. Path aliases and import ordering - applies

The target has 11 imports (planner), all relative: `./imageTreatments`,
`./liveEffects/bloom`, `./liveEffects/caustics`, `./liveEffects/crt`,
`./liveEffects/dither`, `./liveEffects/lightShafts`,
`./liveEffects/paletteCore`, `./liveEffects/quality`,
`./liveEffects/rgbSplit`, `./lut/types`, `./types`. No workspace package
alias is used for a value import. From `packages/engine/src/filters/` each
becomes `../...` and the new intra-directory specifiers are `./types`,
`./adjustment`, `./conversion`, `./conversionTone`, `./conversionCreative`,
`./conversionEffects`, `./conversionTreatment`, `./defaults`,
`./defaultsTone`, `./defaultsCreative`, `./defaultsEffects`,
`./defaultsTreatment`, `./cssFallback`, `./displayNames`. Two inline type
imports are rebased: the hue-saturation range import (line 163) becomes
`import('../adjustment/hueSaturation')` and the threshold luminance-mode import
(line 544) becomes `import('../threshold')`. Biome orders and formats preambles
only; semantically ordered code is not hand-reordered.

### 4. Template literals, regexes and code-like text - applies

`filterToCss` builds CSS function strings in template literals (the brightness
and contrast percentages are computed as 100 + value, and hue-rotate appends a
deg suffix; lines 1512-1531). Display-name literals include `Black & White`
(line 1643) and `Hue / Saturation` (line 1621). Defaults contain tagged
literals such as `'rgb-stripe'` (line 2011) and `'linear-srgb'` (line 1737).
A brace-based or regex-based mechanical cut can corrupt these. Guard: cuts are
made only on the planner declaration boundaries and the case-body ranges are
copied byte-verbatim; the split executor asserts a complete line partition
before writing and an independent line-identity check counts every moved line.

### 5. Overloaded and identity-sensitive declarations - applies

There are no TypeScript overloads. The identity-sensitive surfaces are:

- 80 top-level declarations, all exported: 70 type declarations (the catalog
  kind, blend-mode, provenance, base, union and 64 adjustment interfaces/aliases)
  and 10 value declarations (`ADJUSTMENT_KINDS` and 9 functions; see the
  inventory in `SEAM_SPEC.md`).
- 15 engine files import from `./filters`: `filterCompositor.ts`,
  `tonalState.ts`, `surfacePresets.ts`, `filterCompositor.test.ts`,
  `effectRegistry.test.ts`, `filters.test.ts`, `bench/tonalControls.bench.ts`,
  `tonalColor.test.ts`, `index.ts`, `tonalState.test.ts`,
  `sharpenIntegration.test.ts`, `replay.ts`, `replay-filter.test.ts`,
  `liveEffects/presets.ts`, `effectRegistry.ts` (grep -rln result). All of
  them keep the same specifier and therefore the same module path.
- `adjustmentToFilter` is the IR conversion contract: it returns `FilterIR`
  objects whose shapes and property order the renderer consumes. The split keeps
  every case-body return object byte-identical inside four family dispatchers and
  keeps the original unknown-kind fallback literal as the orchestrator default.
  `adjustmentsToFilters` keeps `.filter(...).map(adjustmentToFilter)`
  semantics.

### 6. Same-named private helpers in sibling modules - does not apply as a duplication risk

Every top-level declaration in the target is already exported (80/80 by the
planner), so there are no private helpers to promote. The split adds 8 new
internal helper declarations: four family conversion dispatchers
(`toneAdjustmentToFilter`, `creativeAdjustmentToFilter`,
`effectsAdjustmentToFilter`, `treatmentAdjustmentToFilter`) and four family
defaults dispatchers (`toneDefaults`, `creativeDefaults`, `effectsDefaults`,
`treatmentDefaults`). Each has one home and none is re-exported from the public
barrel. No copy-paste duplicate is allowed to drift.

### 7. Dropped declarations - applies

The inventory is complete before the cut: planner `baseCount: 80` and every
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

The entry `packages/engine/src/filters.ts: 2134` must leave the baseline
because the barrel ends far under the cap. The covering test is frozen at 436
and is not edited. Expected ratchet: 951 -> 950 frozen entries; exactly one
removed, 0 added, 0 grown. A stale sibling or a growing frozen file would be a
blocker to report, never a reason to use `--force`.

### 10. Concurrent worktree conflict on peer-hot files - applies low

The baseline, the agent map, `BACKLOG_LEDGER.md`, `docs/README.md`, package
manifests, and lockfiles are single-writer surfaces. Only this session updates
the baseline and regenerates the map from its own staged tree.
`pnpm worktree:status` showed no validation holder on this worktree and
`pnpm queue:status` reported `validation-queue: exclusive free; shared 0/4
slots busy; 0 waiting`. Path claims are advisory and not invoked by this
entry protocol.

### 11. Rollback - applies

The seam is uncommitted until the commit step. A failed extraction is abandoned
by discarding only `.worktrees/B-05` changes for the paths this task created
or edited, or by leaving the worktree unmerged for review. The shared main
checkout is never reset, and a partial seam is never committed to save it. If
the baseline cannot ratchet down, stop before committing.

### 12. Rust-crate equivalents - does not apply

This is a TypeScript package seam. Both seam tools parse TypeScript/JavaScript
and both exited 0 on the target, so the standard protocol applies. There is no
`mod` registration, `generate_handler!` entry, or `audit:ipc` surface in
this change; the measured command set is `godsplit-plan`,
`refactor-verify`, `vitest`, and the direct tsc stages.

## Environment limits and substitutions

| Limit | Measured evidence | Substitution used |
|---|---|---|
| Read-only pnpm store | `pnpm install --frozen-lockfile` fails with `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` / `Read-only file system (os error 30)`; every pnpm script also warns that its pre-script install failed | 22 `node_modules` symlinks from the main checkout plus an ignored copy of `apps/desktop/src-tauri/onnxruntime-libs`; `pnpm audit:filesize` still exits 0 at 951 |
| Validation queue EROFS | `pnpm check:agent` -> `EROFS: read-only file system, open '/run/user/1000/varve-validation-queue/exclusive.lock'`, exit 1 | direct recursive tsc: `packages-checked=20 packages-fail=0`, `desktop-exit=0`, `e2e-exit=0` |
| Queued focused tests | `pnpm test:agent` uses the same queue and is unavailable for the same reason | `node node_modules/vitest/vitest.mjs run packages/engine/src/filters.test.ts` |
| Planner flag mismatch | `godsplit-plan.mjs <file> --top 200` -> usage text, exit 2 | supported no-flag full-table invocation (exit 0) |
| Desktop tsc pre-existing diagnostics | The handoff warned of stale varve resolution diagnostics on B-02/B-03; they did not reproduce in this worktree | compared direct stages: desktop 0 diagnostics before the move (0/0 measured) |

## Failure modes -> guardrails

| Failure mode | Evidence / risk here | Guardrail | Owner prompt |
|---|---|---|---|
| Silent declaration drop or rename | 80 base declarations; a split can skip a block or a case label | Complete inventory; range partition asserted before writing; `refactor-verify` exit 0 before tests and after biome | 02 Step 1/3 |
| Behavior change hidden in the conversion sub-split | `adjustmentToFilter` is one 590-line switch over 54 kinds; a family dispatcher could omit a kind or change a return object | Four family dispatchers copy case bodies byte-verbatim; all 54 kinds assigned exactly once; unknown-kind fallback preserved; covering suite 34/34 before and after | 02 Step 2 |
| Defaults table drift | `adjustmentDefaults` is one 445-line switch whose values feed every new adjustment | Four family defaults dispatchers copy case bodies byte-verbatim; the shared literal base stays one construction in the orchestrator | 02 Step 2/3 |
| Second copy of module-scope state | `ADJUSTMENT_KINDS` is the only module-scope value | One home in `filters/types.ts`; the barrel re-exports it; nothing else re-declares it | 02 Step 2 |
| Cut through a template literal or a CSS string | `filterToCss` template literals, display-name copy, tagged values | Declaration-boundary cuts; byte-verbatim case bodies; independent line-identity count | 02 Step 2/3 |
| Public API drift | 15 importing files plus `index.ts` re-export blocks; `./filters` must stay the same path | Explicit named re-exports of all 80 original names in `filters.ts`; 8 new helpers stay internal; no renames | 02 Step 1/2 |
| New module over cap | about 2,040 declaration lines redistribute into 17 modules plus the barrel | Destination map keeps every module at or under 400 (largest projected `adjustmentTypesEffects.ts` about 310); measured with `wc -l` before staging | 01/02 |
| Partial extraction (target stays frozen) | 2,134 lines must leave the path | Barrel projected about 110 lines; baseline entry removed; report no longer lists the target | 02 Step 5 |
| Frozen covering test grows | `filters.test.ts` frozen at 436 | Do not edit the test; the staged check rejects growth | 02 Step 4 |
| Baseline growth / WIP freeze | `--update` is conservative | Never `--force`, never hand-edit; diff exactly one removed entry; `pnpm audit:filesize` green | 02 Step 5 |
| Stale generated surfaces | The agent map is generated from the staged tree | `pnpm agent:map` after staging; `pnpm verify:commit` staged-only | 02 Step 6 |

## Reference-tool and failure-mode analysis

Codemod-style and batch refactoring tools fail in four ways relevant here:
silent skips (a declaration or case branch not matched by the pattern), false
success (the tool reports a count that does not prove the move), type-check
failures after automated edits (unrebased imports or widened signatures), and
changeset review blindness (a large diff that hides a behavior edit). This seam
answers each:

- Silent skips are prevented by the planner-seeded, hand-completed inventory and
  by the split executor assertion that every one of the 2,134 base lines is
  assigned; `refactor-verify` is the independent AST check and exits 1 on a
  missing declaration or exported name.
- False success is prevented by running the verifier before tests, recording its
  JSON (`baseCount`, `presentCount`, `missing`, `missingExports`), and by the
  before/after covering-suite counts (34/34 today, measured above).
- Type-check failures are caught by the direct recursive tsc stages (20
  packages, desktop, e2e) run before and after; the before baseline is clean
  (0 fail, 0 diagnostics), so any after diagnostics are attributable to the move.
- Review blindness is bounded by the planned-edit set in `SEAM_SPEC.md` (import
  preambles, two inline path rebases, four conversion dispatchers, four defaults
  dispatchers, the barrel) and by keeping every moved case body byte-verbatim.

Existing machinery: `pnpm check:agent` (here the direct tsc substitute) types
the tree after the move; `refactor-verify` proves declaration and export
preservation; the focused Vitest suite exercises 34 behavior tests;
`pnpm audit:filesize` is shrink-only; `pnpm verify:commit` judges only the
staged tree. Precedents reused: `packages/editor/src/menu/defs.ts` became an
11-line barrel plus 15 modules under `menu/defs/`; the B-04 document-codec
seam became a thin barrel plus 12 modules with 30/30 declarations preserved.

Residual risks that stay explicit checks in `SEAM_SPEC.md`: (a) the two
sub-splits are the only structural edits, so the family partition is reviewed
kind by kind and the case bodies are compared verbatim; (b) the new family
dispatcher functions are new declarations that must not leak into the public
barrel; (c) the new directory plus file resolution for `./filters` is validated
by the unchanged imports, the covering suite, and all three tsc stages; (d) the
rendering path now dispatches through up to four pure family functions, so the
shared base object is computed once in the orchestrator and passed in to keep
the allocation count identical to the original.

## Edge-case register

| Edge case | Verdict for B-05 |
|---|---|
| Module-eval side effects (state, CSS, pools) | Applies low: one module-scope array catalog; single home in `filters/types.ts`; no side-effect imports, pools, or other top-level work. |
| tsconfig project boundaries / package entry points | Applies, no change: destination stays inside `packages/engine/src`; the engine package entry surface is untouched; `./filters` still resolves to `filters.ts`. |
| Path aliases and import ordering | Applies: all specifiers rebased one level; two inline type imports rebased; biome sorts preambles only. |
| Template-literal / regex / code-like text | Applies: CSS function strings, display-name copy, tagged defaults; cuts on declaration boundaries only, case bodies byte-verbatim. |
| Overloaded / identity-sensitive declarations | Does not apply to overloads (none). Identity applies: 80 exported names; same path; explicit re-export list; no renames; IR object shapes and fallback preserved. |
| Same-named private helpers in sibling modules | Does not apply: no private helpers exist; 8 new family dispatchers have one home each and are not re-exported. |
| Dropped declaration | Applies: 80/80 base declarations must survive; verifier exit 0 before tests. |
| Parse failure in the target or destination | Applies: planner and verifier parse the target today (exit 0); tsc parses every new module. |
| Tracked-vs-untracked baseline policy | Applies: clean worktree; new modules untracked until staging, measured first; no WIP freeze. |
| Stale / grandfathered / slack-band baseline entry | Applies: exactly the `filters.ts` entry leaves; the frozen covering test is untouched; 0 added, 0 grown. |
| Baseline regeneration refusing to add or raise | Applies: `--update` must complete with removed 1 / added 0 / grown 0; a refusal is a blocker. |
| Test-file exemption from the ratchet | Does not apply: tests count as source; the covering test is frozen and untouched. |
| Generated files and exclusions | Not applicable: no `vendor` path or generated-table path is touched. |
| Concurrent worktree conflict on peer-hot files | Applies low: single writer in `.worktrees/B-05`; shared surfaces regenerated, never hand-merged; queue idle. |
| Rollback path | Applies: uncommitted seam; discard only this worktree; never reset the shared checkout. |
| Unknown / unresolved tools | Resolved: planner and verifier parse the target (exit 0); both exit 2 on bad input; planner `--top` flag mismatch recorded. |

## Front-end necessity gate

Verdict: **does not fire.** The seam is a pure TypeScript code move inside
`packages/engine/src`; it renders nothing, changes no API response shape, no
error/empty/loading state, and no remediation workbench exists. The proof is the
unchanged covering suite `packages/engine/src/filters.test.ts` (34 tests, run
before and after the move with the identical pass count and 0 failures). The
visual surface statement for `SEAM_SPEC.md` is: no visual surface changed;
visual validation is not triggered, so prompts 03 and 04 stay unopened.
