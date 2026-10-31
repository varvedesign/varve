# C-01 gap analysis - replay.ts family split

Phase 0 output. Companion to `RESEARCH.md`; the measured evidence, failure modes,
and edge-case register live there. This file records the decisions that close
each gap before implementation, with the owner prompt. Measurements are the clean
checkpoint values from `.worktrees/C-01` (branch `seam/C/C-01-replay`, HEAD
`808274125`); after-move values are the Lead's to measure.

## Measured checkpoint state (summary)

- `node scripts/quality/audit-file-size.mjs --report`: exit 0; 6,313 source
  files scanned; **944 over the cap, 944 frozen, 0 violations, 0 untracked WIP
  over-cap files**; 292,928 excess lines; **944 baseline entries, 0 stale**.
  `packages/engine/src/replay.ts` is offender 2 at `3898 [frozen]` (offender 1:
  `packages/editor/src/context.tsx` 11435). Baseline line 568:
  `"packages/engine/src/replay.ts": 3898,`.
- `node scripts/quality/godsplit-plan.mjs packages/engine/src/replay.ts`: exit 0;
  `Lines: 3898 | imports: 37 | blocks: 107`; hazards: over cap, and
  `sub-split required: paintText lines 3310-3660 is 351 lines on its own`.
- `node scripts/quality/refactor-verify.mjs --base master --target
  packages/engine/src/replay.ts --json`: exit 0;
  `{"ok":true,"baseCount":105,"presentCount":105,"missing":[],"missingExports":[]}`.
- Covering set: `replay.test.ts` 377 lines / 10 tests; 29 `replay*.test.ts`
  specs / 6,726 lines / 224 tests; 2 family helpers (256 + 149 lines); 3 direct
  goldens / 304 lines / 12 tests. This session's union run: 34 files, 243
  tests, 0 failed, 45.19 s. No test edit is expected.
- Expected ratchet: **944 -> 943** frozen entries, exactly one removed, 0 added,
  0 grown. `node scripts/audit-health.mjs` exit 0 on the checkpoint.
- Integration: HEAD `808274125` is the B-11 commit `9c9da88f4` rebased onto
  local master `39e9be06e`; **B-11 is not in master** and master moved to
  `92bafa377` during the session. `git diff --stat master HEAD --
  packages/engine/src/replay.ts` is empty.

## Gap -> action -> owner -> prompt file

| Gap | Action | Owner | Prompt file |
|---|---|---|---|
| Batch definitions and order: C-01 must be the active entry after B-11 | Ranked backlog row 5 is `replay.ts` (Batch C, hot path, benchmark required); the campaign plan fixes Batch C order as `replay.ts`, `inputPipeline.ts`, `renderPipeline.ts` and queues C-01..C-03 after Batch B; the ledger's last row is B-11 at 944 frozen. No Batch A residual (A-05..A-07, A-09) or Batch D entry is opened in this session. | Lead / seam worker | 01 A, 02 |
| Seam text vs measured file | Ranked row 5 asks for split by primitive/fill/effect families while keeping the per-node dispatch monomorphic. The measured file matches: 4 switch sites (`paintShapeFill` 2459, `applyTextCase` 2538, `traceOutline` 3742, `primitiveBounds` 3823), `replayIr` 1187-1467 remains the per-item orchestrator, and no dispatch table exists today. Record the agreement in `SEAM_SPEC.md`; do not restructure the switches. | Seam worker | 01 A, 02 Step 1 |
| Destination ambiguity (file vs directory; module path) | One seam: destination directory `packages/engine/src/replay/`; `replay.ts` stays the thin public entry. The specifier `./replay` keeps resolving to the file (file wins over the sibling directory; same precedent as `packages/engine/src/filters.ts` from B-05). No `./replay` package-export subpath may be added, no tsconfig edit, no new entry point. | Lead (SEAM_SPEC) | 01 A.2, 02 Step 1 |
| Module map and destination ownership | The Lead owns the destination map in `SEAM_SPEC.md`; the worker does not re-decide it. `SEAM_SPEC.md` assigns all 107 planner blocks once (105 declarations + the 2 re-export statements that stay in parent), 20 destination modules planned, every module <=400 lines (target 350-400). The worker records actual sizes after extraction. | Lead / seam worker | 01 A.7, 02 Step 1/2 |
| Declaration inventory is tool-seeded, not automatic | Seed from `godsplit-plan` (107 blocks), read each range, assign a destination and export status per block; `refactor-verify` `baseCount: 105` must reconcile with the inventory. `godsplit-plan` gives ranges and hazards only; it never proposes destinations. | Seam worker | 01 A.7, 02 Step 1/3 |
| Sub-split hazard: `paintText` is 351 lines on its own | Split inside the text family within the same seam (dispatcher for path/rich/canonical modes plus the legacy `fillText`/wrap/justify path); no declaration may be dropped or renamed, and the result must be <=400 lines per module. Record the sub-split and final sizes in `SEAM_SPEC.md`. | Seam worker | 01 A, 02 Step 1/2 |
| Module-scope state ownership | Keep the four per-replay `let` bindings (935-937, 954) single-owned in `replay.ts` (the module that assigns and restores them, 1203-1210/1462-1465) or thread them as parameters; one home per cache (`decodedDepthMapCache` 107, `maskedImageCache` 1857 + counters 1859-1860, `backdropCache` 2008, `_measureCtx` 3664); one construction site for `shadowOps` (258-267) and `alphaStrokeOps` (270-278). A second instance/copy is a behavior defect, not a style issue. | Seam worker (SEAM_SPEC statement) | 01 A.1, 02 Step 1/2 |
| Public API and export preservation | `replay.ts` must keep the 12 exported declarations, the 2 re-export statements, and explicit named re-exports for every moved public name; `refactor-verify` must exit 0 with `missing: []`, `missingExports: []` before tests; `packages/engine/src/index.ts:1385-1392` exports unchanged. Direct importers use `replayIr`, `primitiveBounds`, `renderAlphaMask`, `drawClusters`, `contentEffectPadding`, `ContentEffect`, `ReplayTarget`, `ReplayGradient`, `resetGradientCacheForTest`, `__clearBackdropCache`, `__getBackdropCacheSize`; `refactor-verify` does not resolve `export *`, so no wildcard barrel. | Seam worker | 01 A.5/A.7, 02 Step 3 |
| Behavior proof for a pure move | Run the covering set before and after with identical counts and 0 failures (29 specs / 224 tests; 3 goldens / 12 tests; `replay.test.ts` 10 tests; union 34 files / 243 tests measured on the checkpoint). No test edit, skip, or snapshot; no module mock. Direct `./node_modules/.bin/vitest run <specs> --reporter=dot` because the queue is EROFS. | Seam worker | 01 A.6/A.11, 02 Step 4 |
| Hot-path benchmark (Batch C gate) | Benchmark the per-node path before and after with `packages/editor/src/canvas/__benchmarks__/renderPath.bench.ts` (`TIERS = [100, 1_000, 10_000, 50_000]`, line 222; `replayIr` calls 368-474) and gate with `node scripts/audit-render-perf.mjs --ci` against `.render-perf-baseline.json` (ratio-based, 1.5x headroom, `scripts/audit-render-perf.mjs:43`). Keep `paintShapeFill`'s switch and the `replayIr` item loop intact. Exact before/after ratios are **PENDING: Lead to measure**; record them in `SEAM_SPEC.md`. | Lead (measurement) / seam worker (code) | 01 A (Batch C policy), 02 Steps 4/8 |
| Cycle-identity guard is pre-existing red | `scripts/audit-architecture.mjs --ci` enforces cycle identities (`707-744`) against `.architecture-baseline.json:10-14` (3 engine cycles). A direct madge run at the checkpoint (same flags as `audit-architecture.mjs:163-173`) measures 11 engine cycles: ten `filters.ts -> filters/... -> types.ts` identities from the committed B-05 split plus `mockup/warpReplay.ts -> replay.ts`. So the guard already fails before C-01. Record the before/after identity sets, add no new identity (watch the isolated-surface recursion at 1127 and imports of the four state bindings), and let the Lead decide any `--update`; never regenerate the baseline to hide a new cycle. | Lead decision / seam worker evidence | 01 A.13, 02 Step 4 |
| `COMPLEXITY` marker and audit-health coupling | `audit-health.mjs:32` caps `replay.ts` at 50 complexity and `:42` lists it at 650; Check 2 (`147-166`) reads the first line. Keep `replayIr` and `// COMPLEXITY: 650 cyclo - replayIr is a hot path; ...` in `replay.ts` so the guard remains accurate; run `node scripts/audit-health.mjs` exit 0. Moving the function or marker is not a pure move. | Seam worker | 01 A.13, 02 Step 4 |
| Static checks after the move | Direct engine `tsc -p packages/engine/tsconfig.json --noEmit --pretty false` plus the full `check:agent:raw` recursive program (packages, desktop, e2e) because the queue is EROFS; `biome check --write` then `biome check` on all changed files. `verbatimModuleSyntax` and `useImportType: error` (biome.json:88) are the type/import fault lines. | Seam worker | 02 Step 4 |
| Baseline regeneration | One writer (the seam worker) runs `node scripts/quality/audit-file-size.mjs --update` in `.worktrees/C-01` after the split is green; review `git diff -- .file-size-baseline.json` = exactly one removed entry (`packages/engine/src/replay.ts`), 0 added, 0 grown; then `pnpm audit:filesize` exits 0 at 943 and `--report` shows the target gone. Never `--force`, never hand-edit, never freeze the 20 new untracked modules. Orchestrator re-measures after merge in the main checkout. | Seam worker; orchestrator after merge | 02 Step 5 |
| Seam tooling scope | `godsplit-plan` gives ranges/hazards but no destinations; `refactor-verify` is TypeScript/JavaScript-only and does not resolve `export *`; cycle identity, complexity and benchmark guards are separate manual commands (`audit-architecture.mjs --ci`, `audit-health.mjs`, `audit-render-perf.mjs --ci`). No Rust verifier applies. | Seam worker | 01 B, 02 Step 3/4 |
| Rollback | The seam is uncommitted until Step 8; a failed extraction is discarded only inside `.worktrees/C-01` (`git checkout -- packages/engine/src/replay.ts`; `rm -rf packages/engine/src/replay`). Never reset the shared checkout, never commit a partial seam. The fallback branch `seam/C/C-01-replay` exists at `808274125`. If the ratchet cannot go down or a module cannot stay <=400 lines, stop before commit. | Seam worker | 01 A.11, 02 Step 8 |
| Observability: the queue must shrink, not change shape | Progress evidence is the frozen count (944 -> 943), the excess-line delta in `--report`, exactly one `BACKLOG_LEDGER.md` row (batch C, entry C-01, frozen 3898, current lines, worktree, commit, frozen_count_after 943), the baseline diff, the verifier JSON, and before/after test counts. There is no dashboard and none is built. | Seam worker | 01 E, 02 Step 5/7 |
| Front-end, accessibility, i18n, dark mode, empty/error/loading states | Not applicable, with proof: no rendered UI surface is touched (engine-side Canvas2D IR replay only), no DOM/class/props/API shape/error/empty/loading state changes, and the covering replay specs + goldens keep identical counts. `SEAM_SPEC.md` carries 'No visual surface changed'; prompt 03 is answered not-triggered and prompt 04 does not fire (no Playwright lane, no baseline update, no screenshot). | Seam worker | 01 D, 03, 04 |
| Concurrency: single-writer surfaces and advisory claims | One writer in `.worktrees/C-01`; baseline, `docs/agents/repo-map.generated.md`, `BACKLOG_LEDGER.md`, `docs/README.md`, and manifests/lockfiles are single-writer and regenerated, never hand-merged. The main checkout is used by another session (master moved `39e9be06e` -> `92bafa377`); advisory path claims are the only cross-worktree signal (`pnpm claims`; list returned `no matching claims`; the handoff measured the claim runtime EROFS, so a failed claim record is not a blocker). | Seam worker | 01 A.10, 02 Step 6 |
| Testing sufficiency | The covering suite drives the real replay entry (`replayIr`) into a structural recording target / canvas `ReplayTarget`: draw-call order, state save/restore, blend modes, text shaping/cluster paths, gradients, image fills/mask caches, backdrop cache, table/raster primitives, filters and effects. It does not cover real browser rasterization (jsdom does not paint; `drawCallSequence.test.ts:3-7`), GPU/WebGPU output, worker image-transfer wiring, or a desktop end-to-end run; those are out of scope for a declaration move and are covered by the unchanged Playwright engine replay harness + Batch C benchmark when a pixel question is raised. | Seam worker | 01 E, 02 Step 4 |
| Docs index | This entry adds only `remediation/C-01/*`, outside `docs/`; `pnpm audit:docs` requires no `docs/README.md` row for it and no docs file is edited. The generated repo map and the ledger row are the only shared surfaces updated. | Seam worker | 01 E, 02 Step 6/7 |
| Generated surfaces and staged checkpoint | Stage the seam first (parent + destination modules + baseline + `remediation/C-01`), regenerate `docs/agents/repo-map.generated.md` from the staged tree with `pnpm agent:map`, verify with `node scripts/quality/generate-agent-map.mjs --staged`, then run `pnpm verify:commit` (staged-only: emoji, map, file-size, health, docs, direct staged tests). Commit exactly the seam paths; no `NEXT_PROMPT.md`, lockfile, build output, screenshots, or other session's files. | Seam worker | 02 Step 6/8 |
| Push/PR/merge authority | Workers never merge. Default is no push; leave the one commit on `seam/C/C-01-replay` for Lead review. A push/PR happens only if the Lead explicitly authorizes it and the remote base contains the foundation checkpoint (local master does; `origin/main` does not). | Lead / seam worker | 02 Step 9 |
| Stale handoff values and handoff | Re-measure everything on the committed branch worktree at handoff time (report, frozen count, test counts, verifier JSON, file list, benchmark); never copy numbers from the handoff or from a moving master. `NEXT_PROMPT.md` for the next Batch C entry is written untracked at the main repo root; the next entry is not started. | Lead | 02 Step 10 |
| Environment limitations (not seam blockers) | Read-only pnpm store (`ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`) and EROFS validation queue -> direct `./node_modules/.bin/vitest`, direct recursive `tsc`, direct `node` audits; 21 `node_modules` symlinks link the main checkout. Do not bypass a red gate with an ad-hoc workaround: the gate contents stay identical, only the wrapper changes. | Seam worker | 01 environment note, 02 Step 0 |
| Rust / IPC N/A | No Rust file or `#[tauri::command]` changes, so `pnpm audit:ipc`, `cargo check`, and Rust package tests are not part of this seam; `refactor-verify` TS/JS-only limitation is harmless here. | Seam worker | 01 A.12 |

## Front-end necessity gate (prompt 01 section D)

**Verdict: not triggered; no front-end work.**

- No remediation workbench exists or is in scope; the frozen queue is
  `.file-size-baseline.json` plus `BACKLOG_LEDGER.md` plus command output, and
  C-01 is engine-side Canvas2D IR replay code with no rendered UI surface.
- No API/IPC response shape consumed by the UI changes: the public replay names
  keep the same module path and names (`packages/engine/src/index.ts:1385-1392`).
- No error, empty, loading, or permission state changes: code moves verbatim,
  including effect-diagnostic reporting and degradation paths.
- The 944-entry queue does not become harder to understand: one entry leaves and
  one ledger row is added.

Visual statement for `SEAM_SPEC.md`: **No visual surface changed.** Proof: the
unchanged replay covering set passes with identical counts (`replay.test.ts`
10/10; 29 family specs 224 tests; 3 direct goldens 12 tests; union 34 files /
243 tests / 0 failed / 45.19 s measured on the checkpoint) plus the Batch C
benchmark ratios (**PENDING Lead**). Prompt 04 licenses this: 'Not required for
a pure code move.' No Playwright lane and no visual-baseline update are run; the
engine replay harness under `tests/e2e/visual/` would be escalated if any
draw-call/golden/spec discrepancy appeared, and any such discrepancy is a defect
to fix, never a baseline to update. No `VISUAL_VALIDATION.md` is written.

## PENDING measurements (resolved by the Lead on the final tree)

All of the following were measured after the seam was complete; the decisive
values are recorded in SEAM_SPEC.md and the commit message:

- Covering set before -> after, identical: replay.test.ts 10/10; replay*.test.ts
  29 files / 224 tests; __goldens__ 3 files / 12 tests; 0 failures.
- Batch C benchmark: canonical replay bench before/after (100/1k) plus extended
  same-harness 10k/50k; node scripts/audit-render-perf.mjs --ci before PASS and
  two quiet after runs PASS (one intermediate noisy 100-node boundary reading
  re-verified). No performance baseline regenerated.
- node scripts/audit-architecture.mjs --ci: pre-existing red before and after;
  engine cycle identity sets 11 -> 19, +8 attributable to C-01, recorded in
  SEAM_SPEC.md with the safety argument; no allowlist or baseline update.
- Final module sizes all <=400 (replay.ts 371; largest module text.ts 370);
  verifier presentCount 105; baseline diff exactly one removal 944 -> 943;
  frozen count 943; report scan count/excess lines and ledger row/SHA recorded
  at commit time.

## Decisions resolved before review

1. Destination is one seam: `packages/engine/src/replay/` with `replay.ts` as
   the thin public entry; no package-export or tsconfig change.
2. `replayIr` and the line-1 `// COMPLEXITY:` marker stay in `replay.ts`; the
   per-item loop and the four per-primitive switch sites stay monomorphic.
3. The four per-replay `let` bindings are single-owned by `replay.ts`; moved
   readers either receive them as parameters or stay in the parent. The chosen
   shape and its cycle/timing consequences are recorded in `SEAM_SPEC.md`.
4. Every moved public name is re-exported by explicit name from `replay.ts`
   (no `export *`), because `refactor-verify` does not resolve wildcards.
5. Benchmark before/after is mandatory; the ratio baseline is not regenerated to
   pass, and the arithmetic benchmark numbers go in `SEAM_SPEC.md`, not in these
   phase-0 documents.
6. No docs file is edited; `remediation/C-01/*` is outside `docs/` and needs no
   `docs/README.md` row.

## Testing coverage map (what the unchanged set proves)

| Covering set | What it drives | What it proves for this seam |
|---|---|---|
| `replay.test.ts` (10 tests) | `replayIr` into `Recorder`; text primitives, ligatures, kerning clusters, path-text fallback, empty text, RTL shaped runs, fontWeight clamping | The public entry paints through the same dispatcher and text family after the move; no wrapper changed semantics |
| `replay*.test.ts` family (29 files, 224 tests) | `replayIr` into recorder/canvas targets: shapes/path curves, gradients and tiling, image fills and masks, patterns, strokes, filters, effects (incl. advanced), blend/compositing, multi-item, table, raster, paragraph, rich text, text stroke/style, variable axes, bounds, clusters, state save/restore | Primitive/fill/effect/text families keep identical call order and state transitions; caches (`backdrop`, masked-image) behave per replay |
| `__goldens__` (3 files, 12 tests) | `replayIr` determinism and draw-call sequence; `primitiveBounds` quad coverage | Structural output and public bounds function are unchanged; the fast non-pixel regression net (`drawCallSequence.test.ts:3-7`) still matches |
| `contentEffectBounds.test.ts`, `primitiveBounds.test.ts` | `contentEffectPadding` and `primitiveBounds` directly from `./replay` | Direct-path exported helpers keep their exact values and signatures |
| Not covered by the set | real browser rasterization, GPU/WebGPU output, worker image transfer, desktop end-to-end | Accepted for a declaration move; the pixel contract is the Playwright engine replay harness, which prompt 04 excludes for a pure move; any pixel suspicion escalates to the Lead instead of updating baselines |

`pnpm audit:filesize`/`--report`, `refactor-verify`, the direct `tsc` program, and
`node scripts/audit-health.mjs` cover the structural side; the benchmark and
`audit-render-perf --ci` cover the hot-path side. No test is added, skipped,
weakened, or snapshot-updated in this seam.

## Environment substitution map

| Canonical gate | Substitute used here | Why |
|---|---|---|
| `pnpm test:agent <spec>` | `./node_modules/.bin/vitest run <specs> --reporter=dot` | read-only pnpm store and EROFS validation queue |
| `pnpm check:agent` | direct recursive `tsc -p <project>` loop / `check:agent:raw` equivalent | same queue EROFS; worktree `node_modules` are 21 symlinks to the main checkout |
| `pnpm claims claim ...` | advisory-only claims; `node scripts/quality/path-claims.mjs list` returned `no matching claims` | handoff measured claim runtime EROFS; claims never gate |
| `pnpm queue:status` | not available (pnpm aborts on the read-only store) | environment limit, not a seam blocker |

These substitutions keep the gate contents identical; they never bypass a red
check. A green gate must still be green under the canonical command on a machine
where the queue and store are writable, and the Lead re-measures at handoff.

## Residual risks accepted for this seam

- The `audit-architecture.mjs --ci` cycle allowlist is already stale before
  C-01 (ten `filters/...` identities from B-05); C-01 must be judged by the delta
  of identity sets, and any regeneration of `.architecture-baseline.json` is a
  separate Lead decision. A new identity attributable to C-01 is a blocker.
- Real rendered pixels are not exercised by the unit set; the pure-move
  exception in prompt 04 is accepted on the strength of the unchanged structural
  goldens, the covering replay specs, and the Batch C benchmark.
- Eleven of the planner blocks are private types/aliases with no direct unit
  assertion; the verifier covers presence, and `tsc` covers usage. This is a
  pre-existing coverage shape, not something a pure move may fix.
- The benchmark harness runs in jsdom and measures JS-side dispatch, not GPU
  rasterization; a raster-time regression would need a browser benchmark that
  this seam does not add.

## Lead review checklist before merge

1. `SEAM_SPEC.md` records the destination map, all 107 blocks, the per-replay
   state ownership choice, and the phase-recursion handling for
   `replayItemOnIsolatedSurface -> replayIr`.
2. `refactor-verify --base master --target packages/engine/src/replay.ts --dest
   packages/engine/src/replay --json` exits 0 with `missing: []`,
   `missingExports: []`.
3. Same covering counts before/after, 0 failures, no test edit
   (`git diff --stat` shows no `*.test.*` path).
4. Direct `tsc` and biome clean; `node scripts/audit-health.mjs` exit 0 with the
   line-1 `// COMPLEXITY:` marker still in `replay.ts`.
5. `node scripts/audit-architecture.mjs --ci` before/after identity sets recorded;
   no new cycle attributable to C-01; any baseline regeneration called out
   explicitly.
6. Benchmark ratios recorded (100/1k/10k/50k) and within the ratio baseline +
   1.5x headroom; no performance-baseline regeneration to pass.
7. Baseline diff is exactly the removal of `packages/engine/src/replay.ts`;
   frozen count 944 -> 943; 0 added/grown; `--force` unused.
8. Repo map regenerated from the staged tree; `pnpm verify:commit` passed; one
   ledger row with real numbers; one commit on `seam/C/C-01-replay`; no merge.
9. `SEAM_SPEC.md` states 'No visual surface changed' with the covering-set
   proof; no Playwright lane, no visual-baseline update, no
   `VISUAL_VALIDATION.md`.
10. Handoff report states that local master does not contain B-11 and re-measures
    every count on the committed branch worktree.
