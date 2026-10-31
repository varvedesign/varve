# C-01 research and gap analysis - replay.ts family split

Status: Phase 0 output for Batch C entry C-01, adapted from
`remediation/prompts/01-RESEARCH-AND-GAP-ANALYSIS.md`. One seam, one worktree,
one commit. Measurements were taken on the clean checkpoint in `.worktrees/C-01`
on branch `seam/C/C-01-replay` (HEAD `808274125`). The Lead's `SEAM_SPEC.md` owns
the destination map and the hand-completed declaration inventory; after-move
numbers belong to `SEAM_SPEC.md` and `BACKLOG_LEDGER.md`. Implementation is
blocked until this document and `GAP_ANALYSIS.md` exist.

## Measurement window and integration note

All pre-flight numbers below were measured at 2026-10-29 17:19-17:21 PT on the
clean checkpoint (only the untracked `remediation/C-01/` directory present).
Execution then started in the same worktree after `SEAM_SPEC.md`; final sizes,
test counts, and benchmark ratios must be re-measured by the Lead.

Integration route: the primary route (merge B-11 onto local master) was skipped
because the main checkout was in use by another session and local master moved
during this session; the handoff fallback was used instead: branch from
`seam/B/B-11-adjustment-editor` tip `9c9da88f4`, rebase onto local master
`39e9be06e`, producing `808274125` (HEAD parent `39e9be06e`).
`git merge-base --is-ancestor 9c9da88f4 master` is false: **master does not
contain B-11**, and master advanced again to `92bafa377` while this document was
written. `git diff --stat master HEAD -- packages/engine/src/replay.ts` is empty,
so the verifier base remains valid.

## Measured checkpoint state

Commands are quoted so the numbers reproduce in `.worktrees/C-01`.

- `node scripts/quality/audit-file-size.mjs --report` exit 0:
  `Scanned 6313 source files; 944 over the 400-line cap; 944 frozen in .file-size-baseline.json; 0 violation(s); 0 untracked WIP over-cap file(s).`
  `Excess over cap: 292928 lines. Baseline entries: 944 (0 stale).` Target row:
  `3898  packages/engine/src/replay.ts  [frozen]` (only `context.tsx` 11435 is
  larger). `.file-size-baseline.json` is `schemaVersion: 1`, `maxLines: 400`,
  `files` map; 944 entries; line 568 is `"packages/engine/src/replay.ts": 3898,`.
- `wc -l packages/engine/src/replay.ts` = 3898.
- `node scripts/quality/godsplit-plan.mjs packages/engine/src/replay.ts` exit 0:
  `Lines: 3898 | imports: 37 | blocks: 107`. Hazards: over the 400-line cap and
  `sub-split required: paintText lines 3310-3660 is 351 lines on its own`.
- `node scripts/quality/refactor-verify.mjs --base master --target packages/engine/src/replay.ts --json`
  exit 0: `{"ok":true,"baseCount":105,"presentCount":105,"missing":[],"missingExports":[]}`
  (107 planner blocks minus 2 re-export statements = 105 declarations).
- `./node_modules/.bin/vitest run packages/engine/src/replay.test.ts
  --reporter=dot`: 1 file, 10 tests passed, 0 failed.
- Covering family `packages/engine/src/replay*.test.ts`: 29 spec files, 6,726
  lines, 224 tests (Lead pre-flight). Plus helpers `replay.test-helpers.ts` 256
  lines and `replay-fill.test-helpers.ts` 149 lines = 31 family files (the
  handoff's `31 files, 6,726 lines` mixed the file count with the spec lines).
- Direct goldens `packages/engine/src/__goldens__`: 3 files, 304 lines, 12 tests
  (`goldenReplay` 3, `drawCallSequence` 4, `warpedImage` 5).
- This session ran 29 specs + 3 goldens + `contentEffectBounds.test.ts` +
  `primitiveBounds.test.ts`: 34 files passed, 243 tests passed, 0 failed,
  45.19 s. `node scripts/audit-health.mjs` exit 0 per `SEAM_SPEC.md` pre-flight.
- `git worktree list`: `.worktrees/C-01 808274125 [seam/C/C-01-replay]`.
- Environment: direct `node` / `./node_modules/.bin` only, because the pnpm
  store is read-only (`ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`) and the
  validation queue is EROFS (handoff). 21 `node_modules` symlinks to the main
  checkout (`find . -maxdepth 3 -name node_modules -type l | wc -l`).
  `pnpm queue:status` fails before printing status (`Read-only file system (os
  error 30)`, then the store-lock error). `node scripts/quality/path-claims.mjs
  list` returns `no matching claims`; claims are advisory only and the handoff
  measured the claim runtime EROFS.

## Consumer and covering-spec inventory

- The target exports 12 declarations plus 2 re-export statements:
  `ReplayColorOptions` (123), `EffectMaskResolver` (129), `renderAlphaMask`
  (150), `ContentEffect` (381), `contentEffectPadding` (388),
  `EffectDiagnosticCode` (940), `EffectDiagnostic` (947), `replayIr` (1187),
  `__clearBackdropCache` (2050), `__getBackdropCacheSize` (2054),
  `drawClusters` (3172), `primitiveBounds` (3817); re-exports at 105
  (`resetGradientCacheForTest`) and 121 (`ReplayGradient`, `ReplayPattern`,
  `ReplayTarget`). No overloads, no default export.
- Public surface: `packages/engine/src/index.ts:1385-1391` re-exports the five
  type names and line 1392 re-exports `primitiveBounds`, `renderAlphaMask`,
  `replayIr`, `resetGradientCacheForTest`. `packages/engine/package.json`
  exports only `.` and named subpaths; there is no `./replay` subpath, so the
  module path is internal resolution for relative imports and tests.
- Direct importers of `./replay`/`../replay` at HEAD: 53 files repo-wide, 48
  under `packages/engine/src` (40 spec/helper files; 8 non-test: `index.ts`,
  `thumbnail.ts:11`, `thumbnail/service.ts:18`, `raster.ts:16`,
  `bench/replay.bench.ts:8`, `bench/tableReplay.bench.ts:13`,
  `__goldens__/drawCallRecorder.ts:16`, `mockup/warpReplay.ts:12` type-only).
  The 5 outside-engine matches are `packages/history`'s own distinct replay
  module.
- Named imports taken from the module path: `replayIr`, `primitiveBounds`,
  `renderAlphaMask`, `drawClusters`, `contentEffectPadding`, `ContentEffect`,
  `ReplayTarget`, `ReplayGradient`, `resetGradientCacheForTest`,
  `__clearBackdropCache`, `__getBackdropCacheSize`.
- Hot-path callers: `renderWorker.ts:123`, `replayScene.ts:441/744/763/895/907/1458/1470`,
  `renderPipeline.ts:1516`, `adjustmentHistogramSource.ts:232`, `maskReplay.ts`,
  `OnionSkinCompositor.ts:353`, `videoExportBridge.ts:220`,
  `packages/compositor/src/canvas2d/backend.ts:61`, `thumbnail.ts:224`,
  `thumbnail/service.ts:410`, `raster.ts:116`. Batch C benchmark:
  `packages/editor/src/canvas/__benchmarks__/renderPath.bench.ts` drives
  `replayIr` at `TIERS = [100, 1_000, 10_000, 50_000]` (line 222, calls 368-474);
  engine microbench `bench/replay.bench.ts:170-194` covers 100/1,000 rects.
- No test mocks the module (`grep 'vi.mock(.*replay'` over `packages` = 0), so
  moved function identities are exercised directly.

## A. Research themes (repository evidence first)

1. **Module-evaluation side effects and module-scope state.** 20 module-scope
   bindings, zero side-effect imports (`git grep -E "^import ['\"]"` = 0) and no
   default export. Import-time work is initializer evaluation only:
   `decodedDepthMapCache = new DepthMapCache(3, 32 * 1024 * 1024)` (107; the
   constructor only initializes fields, `depthMap.ts:1495-1502`), `shadowOps`
   (258-267) and `alphaStrokeOps` (270-278) object literals that capture
   function references for the leaf injection seam (`shadowSource.ts:11-16`),
   `maskedImageCache` Map + `maskedImageSourceIds` WeakMap + pixel/id counters
   (1855-1860), `backdropCache` Map + max/TTL (2008-2010),
   `CONTENT_EFFECT_TYPES` Set (975), `TAU` (202), and lazy `_measureCanvasOffscreen`
   / `_measureCtx` (3663-3664, created in `_ensureMeasureContext` 3666-3678). No
   import-time DOM/canvas access (`renderAlphaMask`'s `document.createElement`
   at 159 is call-time). Evaluation **order** therefore does not change
   behavior, but **instance identity does**: a second `maskedImageCache`/counter
   pair means colliding keys and leaked memory, and a second LRU halves the
   cache. The four mutable per-replay bindings `imageLookupForCurrentReplay`
   (935), `effectMaskResolverForCurrentReplay` (936),
   `imagePolicyForCurrentReplay` (937), `effectDiagnosticSinkForCurrentReplay`
   (954) are saved/assigned/restored by `replayIr` (1203-1210, 1462-1465) and
   read by family code at 489, 1138, 1219-1221, 1352, 1650, 1661, 2230, 2528. A
   moved module may read the imported live `let` but cannot assign it, so
   keeping readers outside `replay.ts` turns parent/child imports into an ESM
   cycle; the seam must thread the four values as parameters (the existing
   `shadowOps` injection pattern) or keep the readers in `replay.ts`, and
   `SEAM_SPEC.md` must state the choice.
2. **tsconfig boundaries and package exports.** `packages/engine/tsconfig.json`
   has `rootDir: ./src` and `include: ["src"]`, so `packages/engine/src/replay/`
   compiles in the same project with no tsconfig edit; the package `exports` map
   and `@varve/*` specifiers are unchanged; no new entry point. `tsconfig.base
   .json` sets `verbatimModuleSyntax: true`; `biome.json:88` sets
   `useImportType: error` (engine overrides `noUnusedLocals` to false, so unused
   imports are not the safety net).
3. **Path aliases and import ordering.** No `paths` block exists; workspace
   specifiers resolve through package links/exports. The 37 import declarations
   move with their code; modules under `src/replay/` rebase engine-relative
   specifiers from `./x` to `../x` (`./replayTypes`, `./filters`,
   `./replayGradient`, `./shadowSource`, `./effectPipeline`, `./types`), while
   sibling imports stay `./`. Import order is not semantic here (no side-effect
   imports); one biome pass may sort/format, never rewrite moved logic.
4. **String and template-literal hazards.** 18 template literals with `${`
   at lines 195, 199, 1546, 2021, 2184, 2263, 2268, 2275, 2285, 2798, 2823,
   3245, 3303, 3306, 3464-3467, including `rgba(...)` color strings (195, 199),
   `backdropCacheKey` (2021), and typed-text/font strings. Brace-counting or
   line-count cuts can corrupt them; cut only on planner/AST declaration
   boundaries and prove moved ranges byte- or whitespace-normalized identical.
5. **Identity-sensitive declarations.** `replay.ts` stays the public entry; the
   12 exported declarations and 2 re-exports must remain reachable by the same
   names from the same path, and the hot-path identities of `replayIr`,
   `primitiveBounds`, `renderAlphaMask` must not become wrappers. There are no
   overloads; the equivalent risk is module identity. `refactor-verify` proves
   declaration/export preservation, but it does not resolve `export *` wildcards
   (`refactor-verify.mjs:18`), so `replay.ts` must use explicit named re-exports
   for every moved public name.
6. **Same-named private helpers.** One home per helper; no duplicates. `rgba`
   exists here (185-200) and independently in `replayGradient.ts:17-25` with
   different rounding (`rgbaWorking`, 28-35); `finiteNonNegative` also exists in
   `areaSelection.ts:223`/`areaSelectionMorphology.ts:30`; `TAU` is unique to
   the target. Do not merge the `rgba` implementations or rename declarations.
7. **Dropped declarations.** 107 planner blocks = 105 declarations + 2 re-export
   statements; `refactor-verify` `baseCount` 105 confirms. Each block is
   assigned exactly once in `SEAM_SPEC.md`; the verifier must exit 0 with
   `missing: []` and `missingExports: []` before tests, and it is never edited
   to pass.
8. **Tracked-versus-untracked baseline policy.** `.file-size-baseline.json`
   measures tracked working-tree content and reports untracked WIP separately;
   new `replay/` modules are WIP-reported, never frozen, until staged; they are
   enforced by `audit-file-size.mjs --staged` inside `pnpm verify:commit`.
9. **Stale and grandfathered entries.** Only the `replay.ts` entry may leave the
   baseline (it becomes stale when the parent ends <=400 lines). Expected ratchet
   **944 -> 943**, exactly one removed, 0 added, 0 grown; `--force` and hand
   edits are forbidden; the checkpoint had 0 stale entries.
10. **Concurrent worktree conflict on peer-hot files.** Single-writer surfaces:
    `.file-size-baseline.json`, `docs/agents/repo-map.generated.md`,
    `BACKLOG_LEDGER.md`, `docs/README.md`, manifests/lockfiles. One writer in
    `.worktrees/C-01`; the main checkout is used by another session and master
    moved `39e9be06e` -> `92bafa377` during this session, so counts must be
    re-measured at handoff. Advisory claims only (`pnpm claims`; list returned
    `no matching claims`; handoff measured claim runtime EROFS). The queue is
    EROFS, hence direct `node`/`vitest`/`tsc` substitutes.
11. **Rollback.** The seam is uncommitted until Step 8. A failed extraction is
    discarded only inside `.worktrees/C-01` (`git checkout --
    packages/engine/src/replay.ts`; `rm -rf packages/engine/src/replay`); never
    reset the shared checkout, never commit a partial seam. The fallback branch
    `seam/C/C-01-replay` already exists at `808274125`. If the ratchet cannot
    go down or a module cannot stay <=400 lines, stop before committing.
12. **Rust-crate equivalents (does not apply).** No Rust seam; the target and
    destination are TypeScript inside `packages/engine/src`. The Batch B Rust
    risks (`mod`/`generate_handler!` registration, `audit:ipc`) do not apply,
    and `refactor-verify` is TypeScript/JavaScript-only by design.
13. **Guard scripts keyed to the target path.** `scripts/audit-health.mjs`
    lists the target in `COMPLEXITY_CEILINGS` (line 32, ceiling 50) and in
    `OVER_CEILING_FILES` with the comment `// 650` (line 42); Check 2
    (147-166) requires the first-line `// COMPLEXITY:` marker (target line 1:
    `// COMPLEXITY: 650 cyclo - replayIr is a hot path; ...`). `SEAM_SPEC.md`
    keeps `replayIr` in `replay.ts`, so the marker stays valid; moving
    `replayIr` without updating the guard would silently drop coverage. In
    addition, `scripts/audit-architecture.mjs --ci` enforces dependency-cycle
    **identities** (707-744, `max_cycles` 17) from madge runs over
    `packages/engine/src/index.ts` (163-173). `.architecture-baseline.json:10-14`
    allowlists three engine cycles (`filters.ts -> types.ts`,
    `mockup/warpReplay.ts -> replay.ts`, `replay.ts -> shadowSource.ts`), but a
    direct madge run at the checkpoint (same flags) measures **11** engine
    cycles: ten `filters.ts -> filters/... -> types.ts` identities from the
    committed B-05 split plus `mockup/warpReplay.ts -> replay.ts`. The guard is
    therefore **already red before C-01**; it cannot be used as a simple
    pass/fail. Record before/after identity sets, add no new cycle (watch the
    `replayItemOnIsolatedSurface -> replayIr` recursion at 1127 and the
    four-state-binding imports), and let the Lead decide any `--update`.

## B. Reference-tool and failure-mode analysis

Codemod/batch-refactoring tools fail at silent skips (a declaration not matched
by the pattern), false-success reporting, post-edit type failures, and review
blindness from a large uniform changeset. Existing machinery prevents them here:
`godsplit-plan` supplies AST-derived breadcrumb ranges and sub-split hazards, so
cuts are not invented; `refactor-verify` proves declaration/export preservation;
the direct recursive `tsc` program proves the move compiles under
`verbatimModuleSyntax`; the unchanged covering specs and direct goldens prove
behavior; `audit-file-size --update` plus `--report` prove the ratchet moved and
nothing new froze; `verify:commit` judges staged content; and the B-05/A-08
precedents (thin re-export barrel plus family modules) show the shape.

What remains untested or unknown for C-01:

- **Hot-path performance.** Function boundaries change V8 inlining; only the
  benchmark detects this. The engine microbench uses absolute p95 thresholds and
  is documented flake-prone under contention (`scripts/audit-render-perf.mjs:3-10`);
  the ratio-based Batch C harness is `renderPath.bench.ts` at 100/1k/10k/50k
  tiers against `.render-perf-baseline.json` (version 2026-07-26), gated by
  `node scripts/audit-render-perf.mjs --ci` (headroom 1.5, lines 43, 100-133).
  Exact before/after ratios were measured by the Lead on the final tree and are recorded in SEAM_SPEC.md (canonical replay bench 100/1k plus extended same-harness 10k/50k; renderPath ratio audit before and after, both PASS).
- **Real raster pixels.** jsdom does not rasterize (`drawCallSequence.test.ts:3-7`
  records that `getImageData` after a real `fillRect` is all-zero in this
  repo), so the jsdom hash golden and draw-call goldens assert structure, not
  pixel truth; real pixels live in the Playwright engine replay harness
  (`tests/e2e/visual/replay.spec.ts`), which a pure move does not run.
- **Module-scope cache identity.** No test asserts a single cache/measure
  context instance; a duplicated cache would pass many specs and only show as
  memory growth or stale ids.
- **Cycle/TDZ behavior.** A parent/child ESM cycle is legal and call-time
  live-binding reads are TDZ-safe, but a module-scope object literal capturing
  a function from a module that imports it back can throw a TDZ
  `ReferenceError` during evaluation; `shadowOps`/`alphaStrokeOps` are that
  shape and need one acyclic construction site.

## Failure modes -> guardrails

| Failure mode | Evidence in this repository | Guardrail command or review check | Owner prompt file |
|---|---|---|---|
| Silent skip / dropped declaration | `refactor-verify` exists because Go-era tooling could succeed while losing declarations (script header); planner reports 107 blocks | `refactor-verify --base master --target packages/engine/src/replay.ts --dest packages/engine/src/replay --json` exits 0, `missing: []`, `missingExports: []`, before tests | 02 Step 3 |
| Export lost or hidden behind a wildcard | verifier does not resolve `export *` (`refactor-verify.mjs:18`); 12 exported declarations + 2 re-exports | explicit named re-export list in `replay.ts`; `missingExports: []`; `index.ts:1385-1392` surface unchanged | 01 A.5, 02 Step 1/3 |
| Post-edit type failure | `verbatimModuleSyntax`; `useImportType: error` (biome.json:88) | direct engine `tsc` + the 23-project `check:agent:raw` program, 0 diagnostics | 02 Step 4 |
| Lint/import-order drift | 37 import declarations rebased one level deeper | `biome check --write` then `biome check` exit 0; moved logic not reformatted | 02 Step 4 |
| Rendered behavior drift in a pure move | 29 family specs (224 tests) + 3 goldens (12 tests) + `replay.test.ts` 10 tests; no module mock | same covering set before/after, identical counts, 0 failures; no test edit/skip/snapshot | 02 Step 4 |
| Hot-path performance regression | `replayIr` 281 lines, complexity 650 (line 1); 4 switches (2459, 2538, 3742, 3823); policy forbids a dispatch table | `renderPath.bench.ts` 100/1k/10k/50k before/after + `audit-render-perf.mjs --ci`; keep `paintShapeFill` switch and item loop intact; numbers measured by Lead and in SEAM_SPEC.md | 01 A, 02 Steps 4/8 |
| Duplicated module-scope state | 20 bindings: one LRU, 2 Maps, 1 WeakMap, counter pair, 4 per-replay lets | review each cache/counter for one definition and one construction site; `SEAM_SPEC.md` ownership statement; grep for duplicate `new Map`/`new DepthMapCache` | 01 A.1, 02 Step 1 |
| Import-time TDZ / new parent-child cycle | `shadowOps` 258-267 and `alphaStrokeOps` capture identities; `replayItemOnIsolatedSurface` calls `replayIr` (1127) | one acyclic construction site; cycle-relevant edges in `SEAM_SPEC.md`; before/after `audit-architecture.mjs --ci` identity diff | 01 A.1/A.13, 02 Step 1/4 |
| Cycle-identity drift | engine allowlist 3 identities; direct madge at checkpoint = 11 (pre-existing B-05 drift) | record before/after identity sets; introduce no new identity; Lead decides any `--update`; never regenerate to hide a new cycle | 01 A.13, 02 Step 4 |
| String/template-literal corruption | 18 interpolated template literals (A.4) | AST/planner-boundary cuts only; partition proof of moved ranges; biome format-only | 02 Step 2 |
| Baseline drift / wrong ratchet | 944 frozen, 0 stale, target line 568; `--update` is conservative | `--update`, diff = exactly one removal, `pnpm audit:filesize` exit 0 at 943; `--staged` at commit; `--force` forbidden | 02 Step 5 |
| Shared-surface corruption | baseline/map/ledger/docs index are single-writer; master moved during session | stage seam first, regenerate map from staged tree, `pnpm verify:commit`; one writer per worktree; claims advisory only | 02 Step 6, 01 A.10 |
| Stale handoff numbers | master moved `39e9be06e` -> `92bafa377`; handoff mixed 31 files with 6,726 spec lines | re-measure on the committed branch worktree at handoff; never copy counts; state that master does not contain B-11 | 01 A.10, 02 Step 10 |
| Pixel truth not covered by units | jsdom does not rasterize (`drawCallSequence.test.ts:3-7`) | prompt 04 pure-move exception: no baseline update, no Playwright lane; any draw-call/golden/spec discrepancy stops the seam and is escalated | 04 'Not required for a pure code move' |
| Guard-script coupling forgotten | `audit-health.mjs:32/42` and the cycle allowlist are keyed to `replay.ts` | keep line-1 `// COMPLEXITY:` marker and `replayIr` in `replay.ts`; `node scripts/audit-health.mjs` exit 0 | 02 Step 4 |

## C. Edge-case and gap register

| Edge case | Applies? | Decision / evidence | Guardrail |
|---|---|---|---|
| Module-eval side effects (caches, ops objects, per-replay lets) | applies | one home per cache/counter; one construction site per ops object; four per-replay lets owned by `replay.ts` or threaded as parameters; no import-time DOM access (A.1) | review for duplicate initializers; `SEAM_SPEC.md` ownership; specs/goldens |
| tsconfig boundaries / package entry points | applies (no change) | destination under `packages/engine/src`; `include: ["src"]`; package exports untouched; no new entry point | engine tsc + `check:agent:raw` |
| Path aliases and import ordering | applies | no `paths` block; `@varve/*` unchanged; relative specifiers rebased one level; no side-effect imports | biome check + tsc; import diff review |
| Template-literal / code-like text | applies | 18 interpolated literals (A.4); cuts by planner/AST boundaries only | partition proof of moved ranges; biome format-only |
| Overloaded / method identity across modules | overloads: no; identity: applies | same 12 declarations + 2 re-exports from the same path; no rename; no default export | `refactor-verify` `missingExports: []`; index surface unchanged |
| Same-named private helpers in sibling modules | applies | one home each; do not merge `rgba` with `replayGradient.ts:17` or rename while moving | inventory; duplicate-definition grep in `replay/` |
| Dropped declaration | applies | 105 declarations + 2 re-export statements inventoried | `refactor-verify` exit 0 before tests |
| Parse failure in target/destination | applies | planner parses 107 blocks; tsc/biome parse every new module | planner/tsc/biome exit 0 |
| Tracked-vs-untracked baseline policy | applies | new modules untracked WIP until staged; never frozen; staged enforcement | `--staged` inside `pnpm verify:commit` |
| Stale / grandfathered / slack-band entry | applies | only the `replay.ts` entry may become stale; checkpoint had 0 stale; parent must end <=400 | baseline diff review; one removal, 0 added/grown |
| Baseline regeneration refusing to add or raise | expected not to fire | every destination module must be <=400 (350-400 target) | stop before commit if `--update` adds/grows |
| Test-file exemption from the ratchet | applies (no test edit) | covering specs/helpers/goldens untouched (helpers 256/149 lines, under cap) | `git diff --stat` shows no test path |
| Generated files and exclusions | does not apply | `vendor/**` and 3 generated data tables not touched | commit path allowlist |
| Concurrent worktree conflict on peer-hot files | applies | one writer in `.worktrees/C-01`; baseline/map/ledger regenerate, never hand-merge; claims advisory | `pnpm worktree:status`, claims, staged `verify:commit` |
| Rollback path | applies | seam uncommitted until Step 8; discard only worktree files; fallback branch exists at `808274125` | restore target from HEAD; delete untracked `replay/`; no partial commit |
| Unknown/unresolved tools | does not apply | planner, verifier, file-size, health and architecture audits exist and were exercised; render-perf measured by Lead (SEAM_SPEC.md); cycle identity sets recorded (11 -> 19 engine identities, pre-existing red, no baseline regeneration) | pre-flight smoke in `SEAM_SPEC.md` |
| Per-node dispatch stays monomorphic | applies | keep the four switches (2459, 2538, 3742, 3823) in their functions; no dispatch table; `replayIr` loop stays in `replay.ts` | benchmark + review; file-size-policy hot-path rule |
| Sub-split hazard: `paintText` 351 lines | applies | split inside the text family (dispatcher + legacy fillText path) within this one seam | all modules <=400; sub-split recorded in `SEAM_SPEC.md` |
| `COMPLEXITY` marker / over-ceiling list | applies | `replayIr` and line-1 marker stay in `replay.ts`; `audit-health.mjs:32/42` stay accurate | `node scripts/audit-health.mjs` exit 0 |
| Cycle identity guard | applies (pre-existing drift) | checkpoint already differs via ten `filters/...` identities from B-05; C-01 adds none | before/after madge sets; `audit-architecture.mjs --ci`; Lead baseline decision |
| Real raster pixels | unknown / not covered | jsdom does not rasterize; pixel contract is the Playwright replay harness, not run for a pure move | prompt 04 exception + benchmark; escalate, never update baselines |
| Front-end / visual surface | does not fire | engine-side Canvas2D IR replay only; no DOM/props/API/error-state change | prompt 03 not triggered; prompt 04 not required |

## D. Front-end necessity gate (prompt 01 section D)

Verdict: **not triggered; no front-end work.**

1. Does it change anything an operator sees or does in a remediation workbench?
   No. There is no remediation workbench; the queue is `.file-size-baseline.json`
   plus `BACKLOG_LEDGER.md` plus command output (prompt 03), and C-01 is
   engine-side Canvas2D IR replay code with no rendered UI surface of its own.
2. Does it change an API response shape consumed by the UI? No IPC/command or
   package-exports change; the public replay names keep their module path and
   names (`packages/engine/src/index.ts:1385-1392`).
3. Does it change error, empty, loading, or permission states? No; code moves
   verbatim, including `reportEffectDiagnostic` (961-972) and the degradation
   paths.
4. Does it make the 944-entry queue harder to understand? No; one entry leaves
   and one ledger row is added (943).

Visual statement for `SEAM_SPEC.md`: **No visual surface changed.** Proof: the
unchanged covering set passes with identical counts (`replay.test.ts` 10/10; 29
family specs 224 tests; 3 direct goldens 12 tests; this session's union 34 files
/ 243 tests / 0 failed / 45.19 s) plus the Batch C benchmark (ratios **PENDING
Lead**). Prompt 04 licenses this: 'Not required for a pure code move. A
declaration-level extraction that preserves DOM, class names, props, state
transitions, and API shapes must not change pixels.' No Playwright lane and no
visual-baseline update are run; the engine replay harness under
`tests/e2e/visual/` is the pixel contract that would be escalated if any
draw-call/golden/spec discrepancy appeared, and any such discrepancy is a defect
to fix, never a baseline to update.

## Remaining risks and STOP conditions

1. New cycle identity or import-time TDZ from the isolated-surface recursion or
   from family modules reading the four per-replay bindings. STOP and fix the
   seam shape if the before/after cycle identity sets differ.
2. Hot-path regression beyond the `audit-render-perf` ratio headroom. STOP and
   report measured ratios; never regenerate the performance baseline to pass.
3. Any missing declaration, unexported moved public name, or changed test count.
   STOP; never edit the verifier or weaken a spec.
4. Any destination module over 400 lines or any baseline growth. STOP before
   commit; `--update --force` is not an option.
5. Any claim that local master contains B-11. The integrated branch is the
   rebased C-01 branch; master moved during the session and does not contain
   B-11.


## Lead resolution of PENDING measurements (measured on the final branch tree)

- Covering set after the move: replay.test.ts 10/10; replay*.test.ts family 29 files / 224 tests; __goldens__ 3 files / 12 tests; 0 failures in every run, identical to before.
- Batch C benchmark: canonical replay bench before/after and renderPath 100/1k/10k/50k ratio audit before/after are in SEAM_SPEC.md; both ratio runs after the move pass the committed .render-perf-baseline.json with no regeneration.
- Architecture cycles: before 11 engine identities (pre-existing red, ten from committed B-05), after 19 = same 11 + 8 attributable to C-01 (recorded in SEAM_SPEC.md with the safety argument); no allowlist or baseline update.
- Final sizes: replay.ts 371 lines; 20 modules 18-370 lines, all <=400 (SEAM_SPEC.md table).
- Gate results: pre-move and post-move recursive tsc 22 projects / 0 failures; refactor-verify 105/105; biome clean; audit-health exit 0.
