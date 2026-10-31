# C-02 gap analysis - inputPipeline.ts phase split

Status: Phase 0 output. Companion to `RESEARCH.md`: the measured evidence,
failure-mode table, hook sub-split risk analysis, benchmark inventory, and
edge-case register live there. This file records the decisions that close each gap
before implementation, with the owner prompt. Measurements are the clean
checkpoint values from `.worktrees/C-02` (branch `seam/C/C-02-input-pipeline`,
HEAD `2bf4871e7`, clean working tree before these documents). After-move values
are the executor's and Lead's to measure; no count in this file may be copied to
the commit message without re-measuring it on the committed tree.

## Measured checkpoint state (summary)

- `node scripts/quality/audit-file-size.mjs --report` (exit 0): 6,333 source
  files scanned; **943 over the cap, 943 frozen, 0 violations, 0 untracked WIP
  over-cap files**; 289,430 excess lines; **943 baseline entries, 0 stale**.
  `packages/editor/src/canvas/inputPipeline.ts` is offender 3 at
  `2780 [frozen]` (offenders 1-2: `context.tsx` 11435, `Menubar.tsx` 2873).
  Baseline line 120: `"packages/editor/src/canvas/inputPipeline.ts": 2780,`.
- `node scripts/quality/audit-file-size.mjs` (exit 0):
  `File-size budget OK: 6333 source files scanned; 943 over 400 lines, all
  frozen in .file-size-baseline.json (tracked content).`
- `wc -l`: target 2,780; covering test 120.
- `node scripts/quality/godsplit-plan.mjs packages/editor/src/canvas/inputPipeline.ts`
  (exit 0): `Lines: 2780 | imports: 30 | blocks: 15`; hazards: over cap, and
  `sub-split required: useCanvasInputs lines 269-2717 is 2449 lines on its own`.
  `--json` works; `--top` is unsupported at this checkpoint
  (`godsplit-plan: unknown argument: --top`).
- `node scripts/quality/refactor-verify.mjs --base HEAD --target
  packages/editor/src/canvas/inputPipeline.ts --json` and `--base master`: both
  exit 0 with
  `{"ok":true,"baseCount":15,"presentCount":15,"missing":[],"missingExports":[]}`.
- `./node_modules/.bin/vitest run packages/editor/src/canvas/inputPipeline.test.ts
  --reporter=dot`: 1 file / 11 tests passed / 0 failed (47.30 s cold in this
  session; the Lead's checkpoint run was 13.98 s; pass count is the invariant).
- Only importers: `packages/editor/src/CanvasArea.tsx:42` (`useCanvasInputs`,
  called at 1061-1080, 8 handlers attached at 1519-1526) and
  `packages/editor/src/canvas/inputPipeline.test.ts:8` (5 pure helpers).
- Expected ratchet: **943 -> 942** frozen entries, exactly one removed
  (`packages/editor/src/canvas/inputPipeline.ts`), 0 added, 0 grown.
- Integration: local master measured `a3796c0ba` with 31 dirty/untracked entries
  in the concurrently used main checkout
  (`git -C /home/kevina/CodingProjects/varve status --porcelain | wc -l`);
  measured fallback route: branch created from `seam/C/C-01-replay` tip
  `e5d6ff555` and rebased onto master (map conflicts resolved by regeneration
  per the handoff). Branch content: `42207fee2` (B-11), `2bf4871e7` (C-01) on
  top of `a3796c0ba`; master does not contain B-11 or C-01, and the target is
  byte-identical between master and HEAD (`git diff --stat a3796c0ba HEAD --
  packages/editor/src/canvas/inputPipeline.ts` prints nothing). C-01's branch is
  checked out in another worktree and is another session's tree.
- Environment: read-only pnpm store (`pnpm check:agent` fails with
  `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` after a read-only install warning),
  validation queue EROFS (`/run/user/1000/varve-validation-queue/exclusive.lock`),
  21 `node_modules` symlinks to the main checkout, path-claims claim runtime
  ENOENT (`/run/user/1000/varve-path-claims`; `list` still prints
  `no matching claims`), `XDG_RUNTIME_DIR=/run/user/1000` not writable (heavy
  lease lock path EROFS). Playwright 1.62.1 and Chromium builds are installed,
  but the Playwright `webServer` command cannot start in this worktree (see
  section D).

## Gap -> action -> owner -> prompt file

| Gap | Action | Owner | Prompt file |
|---|---|---|---|
| Batch definition and order: C-02 must be the active entry after C-01 | Ranked backlog row 9 is `inputPipeline.ts` (Batch C, hot path, "pointer semantics need canvas E2E coverage after each seam", line 41); the campaign plan fixes Batch C order as `replay.ts`, `inputPipeline.ts`, `renderPipeline.ts` (lines 146-149) and C-01 has landed (ledger row 39, frozen 943). No Batch A residual, Batch B, or Batch D entry is opened here. | Lead / executor | 01 A, 02 |
| Seam text vs measured file | Ranked row 9 asks for admission/gesture state, per-tool dispatch, and overlay/measurement helpers under `canvas/input/` with monomorphic dispatch. Measured agreement: 2,449-line hook; phase bands in `RESEARCH.md`; 5 `dispatchToTool` sites wrapping 13 direct tool-manager calls; per-tool dispatch itself in `tools/ToolManager.ts:238-315`; only switch is `keyboardPanDelta` 2738. Record the agreement in `SEAM_SPEC.md`; do not restructure the dispatch. | Lead (SEAM_SPEC) | 01 A, 02 Step 1 |
| Hook sub-split is mandatory | The planner flags `useCanvasInputs` (lines 269-2717) as a 2,449-line sub-split hazard; the parent must end <=400 lines. Plan orchestrator-plus-phases inside `packages/editor/src/canvas/input/`; a destination directory counts as one seam; no declaration may be dropped or renamed. | Lead / executor | 01 A, 02 Step 1/2 |
| Destination ambiguity (file vs directory) | One seam: destination directory `packages/editor/src/canvas/input/`; the parent stays `packages/editor/src/canvas/inputPipeline.ts` as the public entry. The module specifier `./canvas/inputPipeline` and the directory `./canvas/input/` are distinct paths, so no file/directory precedence issue arises (unlike the engine `replay.ts`/`replay/` case). No package-export subpath, no tsconfig edit, no new entry point. | Lead (SEAM_SPEC) | 01 A.2, 02 Step 1 |
| Hook-order and cleanup-order invariance | React identifies state by hook call order. The hook has 62 hook calls (36 `useRef`, 18 `useCallback`, 8 `useEffect`; 0 `useMemo`/`useState`; corrected from the Phase 0 grep-based 19/45 count - see `RESEARCH.md` hook anatomy note) and 8 effects at 319, 570, 575, 576, 1419, 2212, 2242, 2690. Extract phase hooks only if the orchestrator calls them unconditionally in a fixed order and the flattened hook/cleanup order is unchanged; StrictMode (`apps/desktop/src/main.tsx:128`) makes cleanup duplication observable in dev. Record the before/after ordered hook list and cleanup order in `SEAM_SPEC.md`; any reorder is a STOP. | Lead / executor | 01 A.1, 02 Step 1 |
| Shared ref/state ownership | 19 refs are per-component instances; handlers close over each other and over the refs. The orchestrator must own every shared ref/callback/session and pass values by parameter; external-vs-internal snap fallbacks (597-604), viewport anchor fallback (612-619), and `buildToolCtxRef` stabilization (293-299) keep one owner. No module-scope state, no React context copy, no per-phase duplicate ref. Record the ownership table in `SEAM_SPEC.md`. | Lead / executor | 01 A.1, 02 Step 1 |
| `useCallback` / effect dependency arrays | 18 `useCallback` declarations carry hand-maintained deps; the native-listener effect lists 13 dependencies (2191-2205) and its comment (2207-2211) forbids clearing pointer ownership in cleanup. Move each callback with byte-identical deps and parameter shape (B-09 precedent: hook deps/params byte-identical, `BACKLOG_LEDGER.md` row 36); do not re-wrap props or forward new arrow functions. `tsc` cannot catch a stale closure. | Executor | 01 A.1, 02 Step 2 |
| Monomorphic per-tool dispatch | Keep one dispatch site per phase with direct `handlePointerDown/Move/Up/Cancel`, `handleKeyDown/Up`, `handleDoubleClick` calls; no tool-keyed table, no added switch, no double dispatch on a move/click. Policy: `docs/quality/file-size-policy.md:90-100`; repo rule `AGENTS.md:84`. Verified by diff review plus the benchmark proxy decision below. | Executor | 01 A, 02 Steps 4/8 |
| Declaration inventory is tool-seeded, not automatic | Seed from the planner's 15 blocks (8 exported + 7 private) and hand-complete the inventory in `SEAM_SPEC.md` with kind, range, export status, destination or "stays in the parent". `godsplit-plan` gives ranges/hazards only; it never proposes destinations. The verifier `baseCount` must reconcile with 15. | Lead / executor | 01 A.7, 02 Step 1/3 |
| Public API and export preservation | Parent keeps `export function useCanvasInputs` and explicit named re-exports for the 5 test-imported helpers (`keyboardPanDelta`, `shouldDeferArrowToSelectedGuide`, `shouldResolveHover`, `shouldSkipCanvasKeydown`, `shouldSuppressMiddleButtonPaste`) and the 2 exported interface types; no default export; no rename. `refactor-verify` does not resolve `export *` (`refactor-verify.mjs:24-26`), so no wildcard barrel. | Executor | 01 A.5/A.7, 02 Step 3 |
| Behavior proof for a pure move | Run the covering spec before and after with identical counts (1 file / 11 tests / 0 failed) and do not edit it (120 lines, imports 5 helpers only; `git diff` shows no test path). Add the three cheap indirect jsdom mount tests as extra evidence (`CanvasArea.render.test.tsx` 127 lines, `CanvasArea.emptyState.test.tsx` 220, `__tests__/canvasRedrawOnDocChange.test.tsx` 180) while stating they dispatch no pointer events and therefore do not exercise the handlers. | Executor | 01 A.6/A.11, 02 Step 4 |
| Baseline regeneration | One writer runs `node scripts/quality/audit-file-size.mjs --update` in `.worktrees/C-02` after the split is green; review `git diff -- .file-size-baseline.json` = exactly one removed entry, 0 added, 0 grown; `audit-file-size` exits 0 at 942 and `--report` no longer lists the target. Never `--force`, never hand-edit, never freeze the new untracked modules (they are enforced when staged via `audit-file-size.mjs --staged`, script line 334-346). Orchestrator re-measures after merge. | Executor; orchestrator after merge | 02 Step 5 |
| Guard-script coupling | `scripts/audit-health.mjs` lists only `CanvasArea.tsx` (COMPLEXITY_CEILINGS line 30, OVER_CEILING_FILES line 40), not the target; `.health-baseline.json:10-15` caps `CanvasArea.tsx` at 1596 lines / 38 imports (current 1640 lines; max 1746). Keep `CanvasArea.tsx` import- and line-neutral; run `node scripts/audit-health.mjs` exit 0. `.architecture-baseline.json` has exactly 1 editor cycle identity (render/workerHost.ts -> render/workerRenderSpan.ts), none under `canvas/`; add none and record the before/after cycle identity set. | Executor | 01 A.13, 02 Step 4 |
| Batch C benchmark gate | No harness imports `inputPipeline.ts`. Closest pointer-path comparable: `packages/editor/src/tools/__benchmarks__/move.bench.ts` (100/1000/5000 candidates, `snapPosition`) with `inputNormalizer.bench.ts` (64/256/1024 samples) as a secondary proxy; `renderPath.bench.ts` has the mandated 100/1k/10k/50k tiers and the ratio gate (`.render-perf-baseline.json`, version 2026-07-26; `audit-render-perf.mjs` HEADROOM 1.5, line 32) but exercises replay, not input, so it is not a valid C-02 gate. Do not add a benchmark in this seam; prompt 02 records the proxy numbers before/after and the monomorphic-review invariant, or escalates a scoped exception to the Lead. | Lead decision / executor | 01 A (Batch C), 02 Steps 4/8 |
| Prompt 03/04 gate + pointer E2E coverage | Prompt 03: not triggered (no rendered surface/contract, API shape, or error/empty/loading/permission state change). Prompt 04: not required for a pure move; closeout statement recorded in `SEAM_SPEC.md`. Row 9's "canvas E2E coverage after each seam" is a separate bounded follow-up, not an unplanned browser lane; see section D for the full recommendation and the measured blockers. | Lead decision / executor | 01 D, 03, 04 |
| Static checks after the move | Substitutes for the EROFS queue: direct recursive `tsc` (22 projects: 20 package tsconfigs + `apps/desktop` + `tests/e2e`) exit 0 with 0 diagnostics; `packages/editor` tsc exit 0; `biome check --write` then `biome check` clean on all changed files. `verbatimModuleSyntax` and `useImportType: error` are the type/import fault lines; 30 imports are split and rebased one level deeper. | Executor | 02 Step 4 |
| Seam tooling scope | `godsplit-plan` gives ranges/hazards, not destinations; it supports `--json` but not `--top` at this checkpoint. `refactor-verify` is TypeScript/JavaScript only and does not resolve wildcards; it verifies target + `--dest` trees. No Rust verifier applies. | Executor | 01 B, 02 Step 1/3 |
| Rollback | The seam is uncommitted until Step 8. A failed extraction is discarded only inside `.worktrees/C-02`: `git checkout -- packages/editor/src/canvas/inputPipeline.ts`; `rm -rf packages/editor/src/canvas/input`. Never reset the shared checkout, never revert another session's work, never commit a partial seam. If the ratchet cannot go down or a module cannot stay <=400 lines, stop before commit. | Executor | 01 A.11, 02 Step 8 |
| Observability: the queue must shrink, not change shape | Progress evidence is frozen count 943 -> 942, the excess-line delta in `--report`, exactly one `BACKLOG_LEDGER.md` row (batch C, entry C-02, frozen 2780, current lines, worktree `.worktrees/C-02`, branch/commit, frozen_count_after 942), the baseline diff, the verifier JSON, and before/after test counts. There is no dashboard and none is built. | Executor | 01 E, 02 Step 5/7 |
| Front-end, accessibility, i18n, dark mode, empty/error/loading states | Not applicable, with proof: no rendered surface is touched (internal canvas input handlers only), no DOM/JSX/class/props/style/API-shape/state change, hook options (18 fields) and result (10 fields) contracts preserved, and the unchanged covering spec + unchanged `CanvasArea` JSX prove it. `SEAM_SPEC.md` carries "No visual surface changed"; prompt 03 is answered not-triggered and prompt 04 does not fire. | Executor | 01 D, 03, 04 |
| Concurrency: single-writer surfaces and advisory claims | One writer in `.worktrees/C-02`; baseline, `docs/agents/repo-map.generated.md`, `BACKLOG_LEDGER.md`, `docs/README.md`, and manifests/lockfiles are single-writer and regenerated, never hand-merged. The main checkout is concurrently used (31 dirty/untracked entries). Advisory claims: `node scripts/quality/path-claims.mjs claim ...` exits 1 with ENOENT under `/run/user/1000/varve-path-claims`; `list` returns `no matching claims`. The failure is recorded and never gates; worktree isolation and the merge protocol remain the real controls. | Executor | 01 A.10, 02 Step 6 |
| Testing sufficiency | The unchanged direct spec proves only the 5 pure helpers (11 tests); the hook, admission helpers, and dispatch have no direct unit test. Three jsdom mount tests execute the hook/effects but dispatch no pointer events. This limitation is accepted for a pure move and stated in `SEAM_SPEC.md`; browser pointer E2E is the only real handler evidence and is analyzed in section D. | Executor / Lead | 01 E, 02 Step 4 |
| Docs index | This entry adds only `remediation/C-02/*` (outside `docs/`); no `docs/README.md` row is required and no docs file is edited. The generated repo map and the ledger row are the only shared surfaces updated. | Executor | 01 E, 02 Step 6/7 |
| Generated surfaces and staged checkpoint | Stage the seam first (parent + `canvas/input/` modules + baseline + `remediation/C-02`), regenerate `docs/agents/repo-map.generated.md` from the staged tree with `pnpm agent:map`, verify with `node scripts/quality/generate-agent-map.mjs --staged`, then run the staged pre-commit checkpoint (`pnpm verify:commit` substitute where the queue is EROFS). Commit exactly the seam paths; no `NEXT_PROMPT.md`, lockfile, build output, screenshots, or another session's files. | Executor | 02 Step 6/8 |
| Push/PR/merge authority | Workers never merge. Default: no push; leave one commit on `seam/C/C-02-input-pipeline` for Lead review. A push/PR only if the Lead explicitly authorizes it and the remote base contains the foundation checkpoint (local master does; `origin/main` does not). | Lead / executor | 02 Step 9 |
| Stale handoff values and moving master | Re-measure everything on the committed branch worktree at handoff (report, frozen count, test counts, verifier JSON, file list, benchmark proxies); never copy numbers from the handoff or from a moving master. Local master was `a3796c0ba` at measurement and does not contain B-11/C-01; the branch is the integration line. | Lead | 02 Step 10, 01 A.10 |
| Environment limitations (not seam blockers) | Read-only pnpm store (`ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`), EROFS validation queue and heavy-lease runtime dir, and ENOENT advisory claims. Use direct `node`/`tsc`/`vitest` and staged scripts instead of pnpm wrappers; the gate contents stay identical, only the wrapper changes. Playwright cannot start in this worktree (section D). | Executor | 01 environment note, 02 Step 0 |
| Rust / IPC N/A | No Rust file or `#[tauri::command]` change, so `cargo check`, Rust package tests, and `audit:ipc` are out of scope; `refactor-verify`'s TS/JS-only limitation is harmless here. | Executor | 01 A.12 |

## Front-end necessity gate (prompt 01 section D)

**Verdict: not triggered; no front-end work.**

- No remediation workbench exists or is in scope; the frozen queue is
  `.file-size-baseline.json` plus `BACKLOG_LEDGER.md` plus command output, and
  C-02 is an internal canvas input refactor with no rendered UI surface of its
  own.
- No API/IPC response shape consumed by the UI changes: the hook's
  `UseCanvasInputsOptions` (18 fields) and `UseCanvasInputsResult` (10 fields)
  contracts and the module path are preserved, and `CanvasArea.tsx` keeps the
  same call and the same 8 attached handlers.
- No error, empty, loading, or permission state changes: code moves verbatim,
  including admission/cancellation/fallback paths.
- The 943-entry queue does not become harder to understand: one entry leaves and
  one ledger row is added.

Visual statement for `SEAM_SPEC.md`: **No visual surface changed.** Proof: the
unchanged covering spec passes 11/11 before and after (1 file, 0 failed;
`./node_modules/.bin/vitest run packages/editor/src/canvas/inputPipeline.test.ts
--reporter=dot`), the diff changes no DOM, JSX, class name, prop, style,
state-transition, or API shape, and no visual baseline is updated. Prompt 04
licenses this for a pure code move.

## D. Gate analysis for prompts 03/04 and E2E pointer-coverage recommendation

### D1. Prompt 03 (front-end gate) - does it fire?

| Trigger question | Answer | Evidence |
|---|---|---|
| Does the change alter anything an operator sees or does in an existing surface? | No | Internal TS module move; no component/renderer/style file is edited; `CanvasArea.tsx` JSX 1519-1526 unchanged; the hook contract is unchanged. |
| Does it change an API/IPC response shape the UI consumes? | No | No IPC command, no payload, no package export change; options/result interfaces preserved. |
| Does it change error, empty, loading, or permission states? | No | Pure move; behavior changes would be defects. |
| Is the change only internal (module boundary/export path/implementation)? | Yes | One destination directory under `canvas/`; parent keeps the same export path. |

**Verdict: prompt 03 not triggered** (03 lines 12-41, 77-86). No UI code, no
workbench, no accessibility/token/state work.

### D2. Prompt 04 (visual validation) - does it fire?

| Trigger | Fires? | Evidence |
|---|---|---|
| Renderer output covered by the engine replay harness | No | No engine/rendering code changed; replay harness untouched. |
| Reviewed appearance of a design surface captured with `toHaveScreenshot` | No | No DOM/class/style/JSX change; canvas chrome untouched. |
| API/error/empty/loading/permission state consumed by the UI | No | Same contract, verbatim code. |
| Bounded UI surface admitted by prompt 03 | No | Prompt 03 not triggered. |

**Verdict: prompt 04 not required** - the pure-move exception applies (04
lines 22-32). The required closeout statement is the one above in
`SEAM_SPEC.md`; no Playwright lane, no `pnpm visual:update`, no
`audit:visual-baselines` change, no screenshot review, no
`VISUAL_VALIDATION.md`.

### D3. Row 9's canvas-pointer E2E note

`docs/quality/agent-context-remediation-2026-10-28.md:41` says: "High risk,
batch C. Pointer semantics need canvas E2E coverage after each seam." That is a
backlog risk note, and it names a real gap: the only spec that imports
`inputPipeline.ts` covers 5 pure helpers (11 tests), the hook has no direct test,
and the indirect jsdom `CanvasArea` mount tests dispatch no pointer events. A
hook sub-split can therefore pass every required unit/type/seam gate while
breaking pointer admission, gesture transitions, or listener lifetime. The row is
not a prompt-04 trigger and does not override the pure-move exception; the
correct treatment is evidence in `SEAM_SPEC.md` plus a bounded follow-up, not an
unplanned browser lane inside this seam.

### D4. Measured E2E capability (what a browser lane would need)

- `playwright.config.ts:242-250`: `webServer.command = viteServerCommand`,
  `url = e2eBaseUrl`, `reuseExistingServer: false`, `timeout: 120000`.
  `viteServerCommand` (lines 11-14) is
  `pnpm --filter @varve/desktop exec vite --port ${e2ePort} --strictPort`;
  `e2eBaseUrl` is `http://localhost:${e2ePort}` (lines 5-6); every run starts
  its own dev server.
- `tests/e2e/global-setup.ts:3-13`: cold Vite transform/warm-up is ~90-100 s
  before the first test; `playwright.config.ts:56` sets a 180 s test timeout.
- Measured in this worktree: `pnpm --filter @varve/desktop exec vite --version`
  exits 1 with `ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH` ("Refusing to use task run
  state directory ... `node_modules` because it is a symbolic link"), because
  the worktree has 21 `node_modules` symlinks to the main checkout. The
  Playwright `webServer` therefore cannot start here.
- Heavy lease: `node scripts/quality/heavy-lease.mjs "e2e: canvas pointer" -- npx
  playwright test <spec> --project=chromium --workers=1 --reporter=list` is the
  mandated wrapper; its lock directory is `$XDG_RUNTIME_DIR|/tmp/varve-leases`
  (`heavy-lease.mjs:180,197`). `XDG_RUNTIME_DIR=/run/user/1000` is not writable
  (`EROFS`, measured), so the lease cannot be acquired without overriding
  `XDG_RUNTIME_DIR` or the `VARVE_HEAVY_TASK_PARALLELISM=0` bypass (writes no
  receipt; not default evidence).
- Playwright 1.62.1 is installed (`./node_modules/.bin/playwright --version`)
  and `~/.cache/ms-playwright` contains chromium builds, so browser binaries are
  not the blocker; the dev-server/pnpm and lease-runtime constraints are.
- Inventory: `tests/e2e/canvas/` has 221 specs / 52,243 lines; 141 contain
  `pointerdown`/`pointermove`/`page.mouse` patterns. The pointer-relevant
  subset is 14 specs / 95 tests / 3,306 lines:
  `middle-button-pan` (201 lines, 3 tests), `tools` (308, 12),
  `input-navigation` (422, 11), `gesture-contract` (61, 3),
  `keyboard-nav` (273, 18), `nudge` (403, 9), `snap-after-move` (439, 4),
  `drag-precision` (259, 3), `crop-pointers` (311, 13),
  `pointer-release-over-inspector` (45, 1), `overlay-interaction` (376, 10),
  `selection-marquee-modes` (31, 2), `design-canvas-navigation` (59, 3),
  `interaction-latency` (118, 3). They would cover the moved phases broadly
  (middle-button/PRIMARY paste, wheel/navigation, native gestures, modal crop
  keys, keydown/nudge, pointer release across the inspector, marquee, drag).

### D5. Recommendation (recorded for prompt 02 and the Lead)

**Do not run Playwright for C-02 as part of this seam.** Reasoning:

1. Gate answers: prompt 03 - no (internal-only move); prompt 04 - no (pure-move
   exception). No canonical gate schedules a browser lane here.
2. The browser lane cannot run in this worktree as configured: the Playwright
   `webServer` command fails before any spec (measured
   `ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH` on the symlinked `node_modules`), the
   heavy-lease runtime dir is EROFS, and the validation queue is EROFS. Running
   it elsewhere means a checkout with a real `node_modules`, a writable
   `XDG_RUNTIME_DIR` (or a deliberate bypass), and a heavy-lease slot - that is
   an orchestrator decision, not something this seam can do quietly.
3. The honest treatment of row 9 is a separate, bounded canvas-pointer E2E
   follow-up after the Batch C seams land (or an explicit Lead override of
   prompt 04 for C-02). If overridden, the smallest meaningful slice is one
   `--workers=1` heavy-lease invocation of
   `pointer-release-over-inspector.spec.ts` (1 test) +
   `middle-button-pan.spec.ts` (3) + `input-navigation.spec.ts` (11) +
   `gesture-contract.spec.ts` (3) = 18 tests; that slice covers admission,
   middle-button/PRIMARY paste, navigation/gestures, and release handoff, not the
   whole 3,306-line pointer surface.
4. Until then, the recorded evidence for a pure move is: unchanged 11/11 direct
   spec, unchanged three `CanvasArea` jsdom mount tests, `refactor-verify` 15/15,
   direct tsc and biome clean, the hook-order/deps/dispatch review checks, and
   the informational pointer-path benchmark proxies. `SEAM_SPEC.md` must state
   that handler semantics are reviewed, not unit-proven.

## Testing coverage map (what the unchanged set proves)

| Covering set | What it drives | What it proves for this seam |
|---|---|---|
| `inputPipeline.test.ts` (120 lines, 11 tests) | The 5 exported pure helpers: keyboard pan deltas, middle-button paste suppression, hover policy, keydown ownership/IME, selected-guide arrow priority | Those 5 declarations keep their exact values and contracts after the move; this is the only direct spec and it does not execute the hook |
| `CanvasArea.render.test.tsx` (127), `CanvasArea.emptyState.test.tsx` (220), `__tests__/canvasRedrawOnDocChange.test.tsx` (180) | Mount `CanvasArea`, which calls `useCanvasInputs` and registers its effects | The hook still renders and registers/cleans up effects without throwing; no pointer event is dispatched, so handler bodies are not exercised |
| `refactor-verify` (15/15), direct recursive tsc, biome | Declaration/export preservation; types and imports after rebase; formatting only | Nothing was dropped, renamed, or left untyped by the extraction |
| Not covered | Real browser pointer dispatch, gesture semantics, listener lifetime under real events, per-event cost, WebKit/Tauri behavior | Accepted for a declaration move; the browser pointer specs are the escalation path (section D), and any pixel/behavior suspicion is a defect, never a baseline update |

## Environment substitution map

| Canonical gate | Substitute measured here | Why |
|---|---|---|
| `pnpm test:agent <spec>` | `./node_modules/.bin/vitest run <spec> --reporter=dot` | read-only pnpm store; EROFS queue |
| `pnpm check:agent` | direct recursive `tsc` (22 projects: 20 package tsconfigs + desktop + e2e) | queue EROFS; worktree `node_modules` are 21 symlinks |
| `pnpm audit:filesize` / `--update` | `node scripts/quality/audit-file-size.mjs` / `--update` / `--staged` | same script; direct node invocation |
| `pnpm claims claim ...` | advisory-only; claim exits 1 ENOENT, `list` returns `no matching claims` | claims runtime EROFS; claims never gate |
| `pnpm queue:status` / `pnpm verify:commit` | `node scripts/quality/validation-queue.mjs status` for status; staged script components directly | pnpm install/store and queue runtime are read-only/EROFS |
| Playwright lane | not run (blocked): webServer command fails; heavy-lease runtime EROFS | section D |

The substitutions keep the gate contents identical; they never bypass a red
check. A green gate must still be green under the canonical command on a machine
where the store and queue are writable, and the Lead re-measures at handoff.

## Residual risks accepted for this seam

- Hook-order, cleanup-order, and stale-closure correctness have no unit or type
  proof; they are review checks recorded in `SEAM_SPEC.md`. `StrictMode` dev
  double-invocation is the only runtime signal available without a browser lane.
- Handler-level pointer semantics are not covered by any unit test; browser
  pointer E2E is deferred per section D. Any `CanvasArea` mount-test failure or
  seam-review suspicion escalates to the Lead instead of adding a lane.
- No existing benchmark measures the moved hook. The informational
  `move.bench.ts` (100/1000/5000) and `inputNormalizer.bench.ts`
  (64/256/1024) proxies, plus the monomorphic-dispatch review invariant, are the
  accepted C-02 performance evidence unless the Lead scopes a new benchmark.
- The jsdom tests cannot rasterize; real pixels remain the Playwright contract,
  which prompt 04 excludes for a pure move.
- The generated repo map and ledger are shared single-writer surfaces; the
  orchestrator regenerates them from the merged tree and re-measures the frozen
  count (the worker's baseline diff is exactly one removal).

## Decisions resolved before review

1. Destination is one seam: `packages/editor/src/canvas/input/` with
   `packages/editor/src/canvas/inputPipeline.ts` as the parent/public entry; no
   package-export, tsconfig, or `CanvasArea.tsx` contract change.
2. The hook is sub-split as orchestrator-plus-phases; the parent keeps
   `useCanvasInputs` and explicit named re-exports of the 5 tested helpers and
   the 2 exported types; every destination module ends <=400 lines.
3. Hook call order (62 calls), effect cleanup order, callback dependency arrays,
   and parameter shapes are preserved and recorded in `SEAM_SPEC.md`;
   `buildToolCtx` keeps its ref-stabilized wrapper and the external/internal
   snap-session fallbacks stay in one owner.
4. Per-tool dispatch stays one direct site per phase (5 `dispatchToTool` sites,
   13 direct tool-manager calls); no dispatch table, no added switch.
5. No module-scope mutable state or import-time side effects are introduced in
   `canvas/input/`; the only movable module-scope binding is the
   `NON_TEXT_INPUT_TYPES` Set.
6. No test is edited, skipped, weakened, or snapshot-updated; the 11/11 direct
   count and the three unchanged mount tests are the behavior evidence, with the
   coverage limit stated.
7. Benchmark gate: no new harness; the Lead/executor decides between
   informational pointer proxies plus review invariant, or a scoped exception.
8. Prompt 03/04: not triggered/not required; no browser lane, no visual baseline
   update; row 9 tracked as a separate bounded follow-up (section D).
9. Baseline ratchet is 943 -> 942, exactly one removal, 0 added, 0 grown;
   `--force` is forbidden.
10. No docs file is edited; `remediation/C-02/*` is outside `docs/` and needs no
    `docs/README.md` row.

## Lead review checklist before merge

1. `SEAM_SPEC.md` records the destination map, all 15 blocks, the hook-call and
   cleanup order, the ref/state ownership table, and the dependency-array
   preservation statement.
2. `refactor-verify --base master --target packages/editor/src/canvas/inputPipeline.ts
   --dest packages/editor/src/canvas/input --json` exits 0 with `missing: []`,
   `missingExports: []`.
3. Same covering count before/after (1 file / 11 tests / 0 failed), no test diff,
   three mount tests unchanged; the coverage limitation is stated.
4. Direct recursive `tsc` (22 projects) and biome clean; `node
   scripts/audit-health.mjs` exit 0; `CanvasArea.tsx` import/line neutral
   (hub cap 38/38); architecture cycle identity set unchanged (1 editor cycle).
5. Monomorphic dispatch review: one direct dispatch site per phase, no table, no
   added switch; benchmark proxy numbers recorded before/after (or the scoped
   benchmark exception is explicit and approved).
6. Baseline diff is exactly the removal of
   `packages/editor/src/canvas/inputPipeline.ts`; frozen count 943 -> 942; 0
   added/grown; `--force` unused.
7. Parent and every destination module <=400 lines; no other frozen file grew.
8. Repo map regenerated from the staged tree; staged file-size/map checks pass;
   one ledger row with real re-measured numbers; one commit on
   `seam/C/C-02-input-pipeline`; no merge.
9. `SEAM_SPEC.md` states "No visual surface changed" with the covering-set proof;
   prompt 03 not triggered, prompt 04 not required, no Playwright lane, no
   visual-baseline update, no `VISUAL_VALIDATION.md`.
10. Handoff report states the integration route (branch from C-01 tip rebased
    onto master; master does not contain B-11/C-01) and re-measures every count
    on the committed branch worktree.
11. Section D recommendation is adopted (no Playwright in this seam) or the Lead
    records the explicit override, its bounded spec subset, and the heavy-lease
    preconditions.
12. Environment limits are reported as limits, not as passes: pnpm store,
    validation queue, heavy-lease runtime, and advisory claims.
