# C-02 SEAM_SPEC - inputPipeline.ts phase split

Status: prompt 02 seam specification, written before any source edit. Batch C,
entry C-02. One seam, one worktree, one commit. Executor: seam-worker.
Companion evidence: `remediation/C-02/RESEARCH.md` and
`remediation/C-02/GAP_ANALYSIS.md`.

## Resolved values

| Key | Value |
|-----|-------|
| Batch | C |
| Entry id | C-02 |
| Package | `packages/editor` |
| Target file | `packages/editor/src/canvas/inputPipeline.ts` - 2,780 lines, frozen at 2780 (offender 3, baseline line 120) |
| Covering test | `packages/editor/src/canvas/inputPipeline.test.ts` - 120 lines, 11 tests (5 pure helpers only; it never imports `useCanvasInputs`) |
| Seam | admission/gesture/pointer/keyboard phase split: one explicit named re-export barrel (same module path) plus phase-hook and helper modules under `packages/editor/src/canvas/input/` |
| Destination | `packages/editor/src/canvas/input/` (one seam; a destination directory counts as one seam) |
| Worktree | `.worktrees/C-02` (absolute: `/home/kevina/CodingProjects/varve/.worktrees/C-02`) |
| Branch | `seam/C/C-02-input-pipeline` |
| HEAD before seam | `2bf4871e7701e0abbc944f8de924375ca2666cbe` (rebased C-01 commit) |
| Parent chain | `a3796c0ba` (local master) -> `42207fee2` (rebased B-11) -> `2bf4871e7` (rebased C-01) |
| Baseline | `.file-size-baseline.json` |
| Declaration planner | `node scripts/quality/godsplit-plan.mjs <file>` (no `--top` at this checkpoint; `--json` supported) |
| Move verifier | `node scripts/quality/refactor-verify.mjs --base HEAD --target packages/editor/src/canvas/inputPipeline.ts --dest packages/editor/src/canvas/input --json` |
| Ledger | `BACKLOG_LEDGER.md` (one appended row) |
| Expected ratchet | 943 -> 942 frozen entries; exactly the `inputPipeline.ts` entry removed; 0 added, 0 grown; no `--force`, no hand edit |

Integration note (measured, carried from the Lead handoff): local master does not
contain B-11, C-01, or C-02. The measured fallback route created this branch from
`seam/C/C-01-replay` tip `e5d6ff555` and rebased it onto local master
`a3796c0ba`; the two generated-map conflicts were resolved by regeneration
(they are not part of this seam's diff). `git merge-base --is-ancestor
a3796c0ba HEAD` exits 0, and `git diff --stat a3796c0ba HEAD --
packages/editor/src/canvas/inputPipeline.ts` is empty, so `--base HEAD` is the
correct verifier base for this worktree.

## Re-measured pre-flight in this worktree (executor run, 2026-10-29)

All commands run from `/home/kevina/CodingProjects/varve/.worktrees/C-02`.
`git status --porcelain` before the seam: exactly `?? remediation/C-02/`
(the Phase 0 docs are untracked until the seam commit); no source edits.

1. `node scripts/quality/audit-file-size.mjs --report` -> exit 0:
   `Scanned 6333 source files; 943 over the 400-line cap; 943 frozen in
   .file-size-baseline.json; 0 violation(s); 0 untracked WIP over-cap file(s).`
   `Excess over cap: 289430 lines. Baseline entries: 943 (0 stale).`
   Top offenders: `11435 packages/editor/src/context.tsx [frozen]`,
   `2873 packages/editor/src/Menubar.tsx [frozen]`,
   `2780 packages/editor/src/canvas/inputPipeline.ts [frozen]`.
2. `node scripts/quality/audit-file-size.mjs` -> exit 0:
   `File-size budget OK: 6333 source files scanned; 943 over 400 lines, all
   frozen in .file-size-baseline.json (tracked content).`
3. `grep -n 'inputPipeline.ts' .file-size-baseline.json` ->
   `120:    "packages/editor/src/canvas/inputPipeline.ts": 2780,`.
4. `wc -l` -> target 2780, covering test 120.
5. `node scripts/quality/godsplit-plan.mjs packages/editor/src/canvas/inputPipeline.ts`
   -> exit 0: `Lines: 2780 | imports: 30 | blocks: 15`; the 15-block table
   below; hazards: target over cap and `sub-split required: useCanvasInputs
   lines 269-2717 is 2449 lines on its own`. (The planner has no `--top` flag at
   this checkpoint: `godsplit-plan: unknown argument: --top`, exit 2. The
   no-flag form and `--json` are used.)
6. `node scripts/quality/refactor-verify.mjs --base HEAD --target
   packages/editor/src/canvas/inputPipeline.ts --json` -> exit 0,
   `{"ok":true,"baseCount":15,"presentCount":15,"missing":[],"missingExports":[]}`.
7. Covering spec before the move:
   `./node_modules/.bin/vitest run packages/editor/src/canvas/inputPipeline.test.ts --reporter=dot`
   -> `Test Files 1 passed (1)`, `Tests 11 passed (11)`, 0 failed; 21.08 s this
   run (duration is not an invariant; the pass count is).
8. Indirect jsdom mount evidence before the move:
   `./node_modules/.bin/vitest run packages/editor/src/CanvasArea.render.test.tsx
   packages/editor/src/CanvasArea.emptyState.test.tsx
   packages/editor/src/__tests__/canvasRedrawOnDocChange.test.tsx --reporter=dot`
   -> `Test Files 2 passed | 1 skipped (3)`, `Tests 19 passed | 1 skipped (20)`,
   0 failed; 43.71 s.
9. `git rev-parse HEAD` -> `2bf4871e7701e0abbc944f8de924375ca2666cbe`;
   `git branch --show-current` -> `seam/C/C-02-input-pipeline`.

### Benchmark proxies before the move (Batch C gate decision; no harness imports inputPipeline.ts)

No benchmark harness imports `inputPipeline.ts` (the only importers are
`CanvasArea.tsx:42` and the covering spec), so no microbenchmark can gate this
move directly. Per the Lead decision the two existing comparable harnesses are
run before and after with the plain command; no benchmark file is added or
modified. `renderPath.bench.ts` / `audit-render-perf` are NOT run: they measure
the replay path (C-03's concern) and would be a false gate.

Commands and measured "before" output (quiet, no other heavy job of the
executor running):

`./node_modules/.bin/vitest bench --run packages/editor/src/tools/__benchmarks__/move.bench.ts`
(exit 0; primary pointer-move proxy, `snapPosition` snapping path):

| env | name | hz | min | mean | p75 | p99 |
|-----|------|----|-----|------|-----|-----|
| jsdom | snapPosition 100 candidates | 7,806.40 | 0.0987 | 0.1281 | 0.1259 | 0.5422 |
| jsdom | snapPosition 1000 candidates | 639.02 | 1.1979 | 1.5649 | 1.7561 | 3.0764 |
| jsdom | snapPosition 5000 candidates | 100.86 | 7.3995 | 9.9142 | 10.5433 | 20.9526 |
| node | snapPosition 100 candidates | 4,672.63 | 0.1472 | 0.2140 | 0.1738 | 1.3063 |
| node | snapPosition 1000 candidates | 437.77 | 1.7623 | 2.2843 | 2.5914 | 3.7567 |
| node | snapPosition 5000 candidates | 88.9204 | 9.4714 | 11.2460 | 12.2008 | 14.9243 |

`./node_modules/.bin/vitest bench --run packages/editor/src/tools/__benchmarks__/inputNormalizer.bench.ts`
(exit 0; secondary input-side proxy; the plain command found the bench file, so
no `--config vitest.bench.config.ts` fallback was needed):

| env | name | hz | min | mean | p75 | p99 |
|-----|------|----|-----|------|-----|-----|
| jsdom | as-was identity key 64 | 53,103.51 | 0.0138 | 0.0188 | 0.0175 | 0.0348 |
| jsdom | dynamics-aware key 64 | 10,152.74 | 0.0616 | 0.0985 | 0.0915 | 0.7255 |
| jsdom | as-was identity key 256 | 10,522.20 | 0.0703 | 0.0950 | 0.0997 | 0.2586 |
| jsdom | dynamics-aware key 256 | 2,699.91 | 0.2470 | 0.3704 | 0.3993 | 1.2199 |
| jsdom | as-was identity key 1024 | 2,114.25 | 0.3145 | 0.4730 | 0.5199 | 1.3307 |
| jsdom | dynamics-aware key 1024 | 757.66 | 1.0167 | 1.3199 | 1.4064 | 2.9070 |
| node | as-was identity key 64 | 51,696.29 | 0.0129 | 0.0193 | 0.0182 | 0.0369 |
| node | dynamics-aware key 64 | 14,141.84 | 0.0601 | 0.0707 | 0.0675 | 0.1186 |
| node | as-was identity key 256 | 11,842.40 | 0.0714 | 0.0844 | 0.0863 | 0.1400 |
| node | dynamics-aware key 256 | 3,546.18 | 0.2451 | 0.2820 | 0.2749 | 0.7409 |
| node | as-was identity key 1024 | 2,744.91 | 0.3192 | 0.3643 | 0.3552 | 0.7937 |
| node | dynamics-aware key 1024 | 488.82 | 1.1165 | 2.0457 | 2.0500 | 5.2636 |

Interpretation: no harness loads the moved module, so these are regression-signal
proxies only. The primary structural protection for the monomorphic per-tool
dispatch is the diff review plus verifier/type identity; the proxy numbers must
show no regression signal (sanity band: same order of magnitude; the after run is
interpreted only against the paired before run on the same machine).

## Declaration inventory (hand-completed, all 15 planner blocks)

Planner seed: `godsplit-plan` no-flag table (exit 0, 15 blocks, 8 exported).
Ranges are the planner's. Destination or "stays in parent" is this seam's map.

| # | lines | range | kind | name | export | destination |
|---|-------|-------|------|------|--------|-------------|
| 1 | 11 | 86-96 | Variable | NON_TEXT_INPUT_TYPES | no | `input/primitives.ts` (module constant, one definition) |
| 2 | 20 | 100-119 | Function | shouldSuppressMiddleButtonPaste | yes | `input/primitives.ts`; parent re-exports by name |
| 3 | 50 | 121-170 | Interface | UseCanvasInputsOptions | yes | `input/types.ts`; parent re-exports by name |
| 4 | 12 | 172-183 | Interface | UseCanvasInputsResult | yes | `input/types.ts`; parent re-exports by name |
| 5 | 10 | 185-194 | Interface | CanvasPointerInteractionRecord | no | `input/types.ts` |
| 6 | 15 | 196-210 | Function | ownsCanvasPointerInteraction | no | `input/primitives.ts` (module export for the phase modules) |
| 7 | 12 | 212-223 | Function | cancelRecordedCanvasPointer | no | `input/primitives.ts` |
| 8 | 6 | 226-231 | Function | shouldResolveHover | yes | `input/primitives.ts`; parent re-exports by name |
| 9 | 22 | 238-259 | Function | snapshotHeldPointer | no | `input/primitives.ts` |
| 10 | 3 | 261-263 | Function | isTouchLikePointerType | no | `input/primitives.ts` |
| 11 | 3 | 265-267 | Function | isTouchLikeContact | no | `input/primitives.ts` |
| 12 | 2449 | 269-2717 | Function | useCanvasInputs | yes | body split across `input/useCanvasInputs.ts` (orchestrator) and the phase modules below; `useCanvasInputs` stays a named export of the same public module path via the parent barrel |
| 13 | 7 | 2727-2733 | Function | shouldSkipCanvasKeydown | yes | `input/keyboardHelpers.ts`; parent re-exports by name |
| 14 | 15 | 2736-2750 | Function | keyboardPanDelta | yes | `input/keyboardHelpers.ts`; parent re-exports by name |
| 15 | 24 | 2757-2780 | Function | shouldDeferArrowToSelectedGuide | yes | `input/keyboardHelpers.ts`; parent re-exports by name |

Parent `packages/editor/src/canvas/inputPipeline.ts` holds no declarations of its
own after the move: it keeps the module doc header and an explicit named
re-export barrel for the 8 exported names (`useCanvasInputs`,
`shouldSuppressMiddleButtonPaste`, `shouldResolveHover`,
`shouldSkipCanvasKeydown`, `keyboardPanDelta`,
`shouldDeferArrowToSelectedGuide`, `UseCanvasInputsOptions`,
`UseCanvasInputsResult`). No `export *` (the verifier does not resolve
wildcards). Expected parent size ~40-60 lines.

### Hook internal composition (measured; corrects the Phase 0 grep count)

`useCanvasInputs` has 74 top-level statements and **62 hook calls**: 36
`useRef`, 18 `useCallback`, 8 `useEffect`, 0 `useMemo`, 0 `useState`
(corrected from the Phase 0 count of 19/18/8 = 45 - see the correction note in
`RESEARCH.md`; the effect/callback line lists are unchanged).

- Hook-top-level plain `function` declarations (6): `endWheelInteractionSoon`
  (original 396), `advanceNavigation` (414), `recordNavigationEvent` (420),
  `pinchGeometry` (434) -> lifecycle phase; `setViewportAnchor` (612),
  `clearViewportAnchor` (617) -> setup phase (they are referenced from earlier
  hooks - `cancelCanvasInteraction` original 537 and the suppressed-contact
  effect 586 - so they move to the earliest phase instead of being reordered
  inside the lifecycle phase; bodies verbatim, plain functions only, no hook
  order effect).
- Nested functions that move with their enclosing body: effect 1
  `expireAfterMiddleButtonRelease`/`suppressMiddleButtonPaste`/
  `allowExplicitKeyboardPaste`; effect 4 `endSuppressedContact`; the native
  listener effect's `zoomAboutClientPoint`, `placeWorldAnchorAtClientPoint`,
  `startInertia`, `cancelInertia`, `canvasCenterClient`, `resolveGesturePoint`,
  `captureNativeGestureAnchor`, `onGestureStart/Change/End/Cancel`,
  `trackPointer`, `onPointerLeave` (nested), `recordPinchBridgeDiagnostic`,
  `pinchBridgeEvent`, `onLostPointerCapture`; handlePointerMove's
  `traceFinish` and `tick`; handleKeyDown's `paintOrder` and
  `zoomAboutCanvasCentre`; effect 7 `handleModalCropKey`; effect 8
  `onWindowBlur`/`onVisibilityChange`.
- Result contract (10 fields, order preserved): `handlePointerDown`,
  `handlePointerMove`, `handlePointerUp`, `handlePointerCancel`,
  `handleKeyDown`, `handleKeyUp`, `handleDoubleClick`, `onPointerLeave`,
  `onBlur`, `stopAutoPan`.
- Consumers: `packages/editor/src/CanvasArea.tsx:42` imports
  `{ useCanvasInputs }` from `./canvas/inputPipeline`, calls it at ~1061-1080
  with all 18 option fields, and attaches the 8 handlers at ~1519-1526. The
  covering spec imports 5 pure helpers from `./inputPipeline`. No other
  importer, no mocker.

## Destination map (planned sizes; every module <= 400 lines)

| Module (under `packages/editor/src/canvas/input/`) | Contents | Planned lines |
|---|---|---|
| `../inputPipeline.ts` (parent, same public path) | doc header + explicit named re-exports only | 40-70 |
| `types.ts` | `UseCanvasInputsOptions`, `UseCanvasInputsResult`, `CanvasPointerInteractionRecord` | ~85 |
| `primitives.ts` | `NON_TEXT_INPUT_TYPES`, `shouldSuppressMiddleButtonPaste`, `ownsCanvasPointerInteraction`, `cancelRecordedCanvasPointer`, `shouldResolveHover`, `snapshotHeldPointer`, `isTouchLikePointerType`, `isTouchLikeContact` | ~200 |
| `keyboardHelpers.ts` | `shouldSkipCanvasKeydown`, `keyboardPanDelta`, `shouldDeferArrowToSelectedGuide` | ~100 |
| `useCanvasInputs.ts` | orchestrator: calls the phase hooks in original order and returns the 10-field contract | ~60 |
| `useInputSetup.ts` | phase A: hooks 1-11 (buildToolCtxRef/buildToolCtx, 7 refs, clearMiddleButtonPasteGuard, effect 1) + moved `setViewportAnchor`/`clearViewportAnchor` | ~200 |
| `useInteractionLifecycle.ts` | phase B: hooks 12-42 (23 refs, 6 helpers, 5 callbacks, effects 2-4) | ~350 |
| `useGestureDispatchRuntime.ts` | phase C: hooks 43-49 (5 refs, snap-session fallbacks, dispatchAttributes, traceEventId) | ~90 |
| `usePointerDownPhase.ts` | phase D: hook 50 (`handlePointerDown`) | ~250 |
| `usePointerMovePhase.ts` | phase E: hook 51 (`handlePointerMove`; auto-pan tick/traceFinish stay nested) | ~390 |
| `usePointerReleasePhases.ts` | phase F+G: hooks 52-53 (`handlePointerUp`, `handlePointerCancel`) | ~290 |
| `useNativeInputListeners.ts` | phase H: hook 54 (effect 5 wrapper; identical 13-item deps array) calling the installer | ~80 |
| `nativeZoomPlacement.ts` | zoom-about-client-point + place-world-anchor helpers over a small deps object | ~110 |
| `nativeWheelRuntime.ts` | wheel factory: inertia state/start/cancel, classifier init, `installInputDiagnosticsHandle()`, `onWheel` | ~300 |
| `nativeGestureRuntime.ts` | native-gesture factory: presence vars, `canvasCenterClient`, `resolveGesturePoint`, `captureNativeGestureAnchor`, gesture handlers, `trackPointer`, nested `onPointerLeave` | ~320 |
| `nativePinchBridge.ts` | Tauri pinch-bridge factory: `disposePinchBridge`/`pinchBridgeCancelled`/update count, diagnostics, bridge event, dynamic import, dispose | ~230 |
| `nativeLostCapture.ts` | lost-pointer-capture factory | ~140 |
| `nativeInputListeners.ts` | installer: composes the four factories, registers the 7 listeners in original order, returns the cleanup in original order | ~130 |
| `useInputLifecycleEffects.ts` | hooks 55-56 (effects 6-7: unmount cleanup, modal crop key) | ~80 |
| `useKeyboardPhase.ts` | hook 57 (`handleKeyDown`); Tab/Escape/Enter + paintOrder stay, zoom-preset block delegated | ~310 |
| `keyboardZoomShortcuts.ts` | plain helper hosting the original 2509-2614 zoom-preset/fit block verbatim under a destructuring preamble | ~150 |
| `useKeyboardCallbacks.ts` | hooks 58-61 (`handleKeyUp`, `handleDoubleClick`, `onPointerLeave`, `onBlur`) | ~110 |
| `useWindowFocusEffect.ts` | hook 62 (effect 8: window blur/visibility cancellation) | ~30 |

Contingency recorded before coding: if a planned module measures over 400 lines
after generation, its self-contained nested function/block is extracted into one
more plain-function module in the same destination (same pattern as
`keyboardZoomShortcuts.ts`), never by changing control flow. Planned candidates:
`handlePointerMove`'s auto-pan `tick` (56 lines) or `traceFinish` (21), and
`handleKeyDown`'s Tab/Escape branches. A STOP is only a *phase module that
cannot fit without a behavior change*.

## Hook containment decision (Lead brief adaptation, recorded reasoning)

The Lead brief's first sentence ("orchestrator contains EVERY React hook call")
and its mechanism sentence ("move contiguous phase blocks into phase modules as
custom hooks called unconditionally at their original positions") conflict at the
400-line cap: an orchestrator holding all 62 hook calls, 18 dependency arrays,
36 ref initializers, the result object, and the cross-phase argument plumbing
measures well over 500 lines in this hook. The chosen shape is the brief's
mechanism: contiguous phase bands move into custom hooks called unconditionally
by one thin orchestrator in exactly the original order. The invariant the brief
protects - flattened hook order and effect cleanup order byte-for-byte preserved -
is met because each phase module contains a contiguous subsequence of the
original hook calls and the orchestrator's phase-call order is that same sequence
(evidence: the 62-row ordered table below). No hook is added, removed, reordered,
or conditionally called. This adaptation is recorded here per "adapt only with
recorded reasoning".

Cross-phase values are passed as function parameters: each phase hook receives
`options: UseCanvasInputsOptions` plus the typed return record of the earlier
phase hooks it reads from; it destructures those values into local bindings whose
names are identical to the original hook-scope bindings, so moved callback and
effect bodies stay byte-identical (including dependency-array text and parameter
shapes). No React context, no module-scope mutable state, no new ref for an
existing concept, no second owner for a session/ref.

## Before / expected-after declaration sets

Before (base HEAD, 15 declarations):
`NON_TEXT_INPUT_TYPES`, `shouldSuppressMiddleButtonPaste`,
`UseCanvasInputsOptions`, `UseCanvasInputsResult`,
`CanvasPointerInteractionRecord`, `ownsCanvasPointerInteraction`,
`cancelRecordedCanvasPointer`, `shouldResolveHover`, `snapshotHeldPointer`,
`isTouchLikePointerType`, `isTouchLikeContact`, `useCanvasInputs`,
`shouldSkipCanvasKeydown`, `keyboardPanDelta`,
`shouldDeferArrowToSelectedGuide`. Exported names (8): `useCanvasInputs`,
`shouldSuppressMiddleButtonPaste`, `shouldResolveHover`,
`shouldSkipCanvasKeydown`, `keyboardPanDelta`,
`shouldDeferArrowToSelectedGuide`, `UseCanvasInputsOptions`,
`UseCanvasInputsResult`.

After (planned): the same 15 names somewhere in the parent or
`canvas/input/`, all 8 exported names still exported. Expected new top-level
declarations (the only new identifiers; documented glue):
phase hooks `useInputSetup`, `useInteractionLifecycle`,
`useGestureDispatchRuntime`, `usePointerDownPhase`, `usePointerMovePhase`,
`usePointerUpPhase`, `usePointerCancelPhase`, `useNativeInputListeners`,
`useInputLifecycleEffects`, `useKeyboardPhase`, `useKeyboardCallbacks`,
`useWindowFocusEffect`, orchestrator `useCanvasInputs`; native factories
`createWheelInputRuntime`, `createNativeGestureRuntime`,
`createNativePinchBridge`, `createLostPointerCaptureHandler`,
`installNativeInputListeners`; helper functions `zoomAboutClientPointWith`,
`placeWorldAnchorAtClientPointWith`, `applyCanvasZoomShortcuts`; and phase
result type aliases (`ReturnType` aliases, no new runtime bindings beyond the
hooks/factories). `refactor-verify` `baseCount` must stay 15 and
`presentCount` may exceed 15 only by these documented glue declarations.

## Before/after ordered hook-call list (type + original line -> destination file)

Flattened order is the concatenation of the destination files in orchestrator
call order. After: same 62 calls, same order (evidence: phase modules contain
contiguous subsequences; orchestrator calls them in the table order).

| # | type | original line | name | after destination |
|---|------|---------------|------|-------------------|
| 1 | useRef | 293 | buildToolCtxRef | input/useInputSetup.ts |
| 2 | useCallback | 295 | buildToolCtx | input/useInputSetup.ts |
| 3 | useRef | 300 | touchPointers | input/useInputSetup.ts |
| 4 | useRef | 301 | pointerOwnershipRef | input/useInputSetup.ts |
| 5 | useRef | 302 | pointerEditorInteractionOpen | input/useInputSetup.ts |
| 6 | useRef | 303 | touchNavigationEditorInteractionOpen | input/useInputSetup.ts |
| 7 | useRef | 304 | keyboardEditorInteractionOpen | input/useInputSetup.ts |
| 8 | useRef | 309 | middleButtonPasteGuardRef | input/useInputSetup.ts |
| 9 | useRef | 310 | middleButtonPasteGuardTimerRef | input/useInputSetup.ts |
| 10 | useCallback | 311 | clearMiddleButtonPasteGuard | input/useInputSetup.ts |
| 11 | useEffect | 319 | middle-button paste listeners | input/useInputSetup.ts |
| 12 | useRef | 355 | pressedKeyboardKeys | input/useInteractionLifecycle.ts |
| 13 | useRef | 358 | lastWheelTraceAt | input/useInteractionLifecycle.ts |
| 14 | useRef | 359 | lastHoverTraceAt | input/useInteractionLifecycle.ts |
| 15 | useRef | 360 | wheelTraceEndTimer | input/useInteractionLifecycle.ts |
| 16 | useRef | 361 | hoverTraceEndTimer | input/useInteractionLifecycle.ts |
| 17 | useRef | 362 | pinchRef | input/useInteractionLifecycle.ts |
| 18 | useRef | 372 | nativeGestureRef | input/useInteractionLifecycle.ts |
| 19 | useRef | 380 | nativeGestureEditorInteractionOpen | input/useInteractionLifecycle.ts |
| 20 | useRef | 381 | nativeFactorInteractionEndTimer | input/useInteractionLifecycle.ts |
| 21 | useRef | 384 | navigationStateRef | input/useInteractionLifecycle.ts |
| 22 | useRef | 388 | wheelInteractionEndTimer | input/useInteractionLifecycle.ts |
| 23 | useRef | 389 | wheelEditorInteractionOpen | input/useInteractionLifecycle.ts |
| 24 | useRef | 390 | wheelInertiaActive | input/useInteractionLifecycle.ts |
| 25 | useRef | 391 | cancelWheelInertiaRef | input/useInteractionLifecycle.ts |
| 26 | useRef | 392 | wheelGestureClassifierRef | input/useInteractionLifecycle.ts |
| 27 | useRef | 445 | autoPanFrameKey | input/useInteractionLifecycle.ts |
| 28 | useRef | 447 | autoPanActive | input/useInteractionLifecycle.ts |
| 29 | useRef | 448 | autoPanVelocity | input/useInteractionLifecycle.ts |
| 30 | useRef | 449 | autoPanFrameTime | input/useInteractionLifecycle.ts |
| 31 | useRef | 450 | activeDragPointer | input/useInteractionLifecycle.ts |
| 32 | useRef | 451 | transferredPointerIds | input/useInteractionLifecycle.ts |
| 33 | useRef | 452 | activeInteractionRecord | input/useInteractionLifecycle.ts |
| 34 | useRef | 453 | interactionGeneration | input/useInteractionLifecycle.ts |
| 35 | useCallback | 455 | stopAutoPan | input/useInteractionLifecycle.ts |
| 36 | useCallback | 463 | closePointerEditorInteraction | input/useInteractionLifecycle.ts |
| 37 | useCallback | 469 | closeTouchNavigationInteraction | input/useInteractionLifecycle.ts |
| 38 | useCallback | 476 | closeKeyboardEditorInteraction | input/useInteractionLifecycle.ts |
| 39 | useCallback | 484 | cancelCanvasInteraction | input/useInteractionLifecycle.ts |
| 40 | useEffect | 570 | register interaction cancellation | input/useInteractionLifecycle.ts |
| 41 | useEffect | 575 | unmount cancel | input/useInteractionLifecycle.ts |
| 42 | useEffect | 576 | suppressed-contact document listeners | input/useInteractionLifecycle.ts |
| 43 | useRef | 597 | internalSnapSessionRef | input/useGestureDispatchRuntime.ts |
| 44 | useRef | 598 | internalSnapIndexRef | input/useGestureDispatchRuntime.ts |
| 45 | useRef | 605 | cursorRafScheduled | input/useGestureDispatchRuntime.ts |
| 46 | useRef | 606 | latestCursorWorld | input/useGestureDispatchRuntime.ts |
| 47 | useRef | 610 | gestureComplexity | input/useGestureDispatchRuntime.ts |
| 48 | useCallback | 621 | dispatchAttributes | input/useGestureDispatchRuntime.ts |
| 49 | useCallback | 630 | traceEventId | input/useGestureDispatchRuntime.ts |
| 50 | useCallback | 638 | handlePointerDown | input/usePointerDownPhase.ts |
| 51 | useCallback | 849 | handlePointerMove | input/usePointerMovePhase.ts |
| 52 | useCallback | 1179 | handlePointerUp | input/usePointerReleasePhases.ts |
| 53 | useCallback | 1329 | handlePointerCancel | input/usePointerReleasePhases.ts |
| 54 | useEffect | 1419 | native wheel/gesture/listener effect | input/useNativeInputListeners.ts |
| 55 | useEffect | 2212 | unmount cleanup | input/useInputLifecycleEffects.ts |
| 56 | useEffect | 2242 | modal crop key | input/useInputLifecycleEffects.ts |
| 57 | useCallback | 2264 | handleKeyDown | input/useKeyboardPhase.ts |
| 58 | useCallback | 2633 | handleKeyUp | input/useKeyboardCallbacks.ts |
| 59 | useCallback | 2657 | handleDoubleClick | input/useKeyboardCallbacks.ts |
| 60 | useCallback | 2667 | onPointerLeave (returned callback) | input/useKeyboardCallbacks.ts |
| 61 | useCallback | 2683 | onBlur | input/useKeyboardCallbacks.ts |
| 62 | useEffect | 2690 | window blur / visibility cancel | input/useWindowFocusEffect.ts |

### Effect cleanup order (preserved)

React runs effect cleanups in declaration order on unmount. The 8 effects keep
their original order 1..8 because the orchestrator calls the phase hooks in the
order setup -> lifecycle -> gesture -> pointer -> native -> lifecycle-effects ->
keyboard -> callbacks -> window-focus, and each effect stays in its original
band:

1. 319 middle-button paste: remove 4 window capture listeners, clear guard.
2. 570 cancellation registration: unregister the registered cancel.
3. 575 unmount cancel: `cancelCanvasInteraction()`.
4. 576 suppressed contact: remove 2 document listeners.
5. 1419 native listeners: remove 7 element listeners, cancel pinch bridge, clear
   native-factor timer, dispose Tauri unlisten (installer cleanup keeps this
   exact order).
6. 2212 unmount cleanup: clear drag/touch/pinch/native-gesture state, reset
   pointer ownership, clear viewport anchor. (Comment 2207-2211 kept: do not clear
   pointer ownership from the native effect cleanup.)
7. 2242 modal crop key: remove the window capture keydown listener.
8. 2690 window blur/visibility: remove 2 window/document listeners.

## Shared-reference / session ownership table (one owner each)

Every ref is created exactly once, in the phase that owns it; later phases read it
as a parameter. No phase creates a ref for a concept it does not own. Ref
initializer expressions and their positions are unchanged.

| Ref/session | Original line | Owner phase / file | Consumers (by parameter) |
|---|---|---|---|
| buildToolCtxRef | 293 | setup / useInputSetup.ts | setup buildToolCtx wrapper only |
| touchPointers | 300 | setup | lifecycle, pointer down/move/up/cancel, native gesture+lost-capture, unmount |
| pointerOwnershipRef | 301 | setup | lifecycle, pointer phases, native gesture/lost-capture, unmount |
| pointerEditorInteractionOpen | 302 | setup | lifecycle close/cancel, pointer down |
| touchNavigationEditorInteractionOpen | 303 | setup | lifecycle close/cancel, pointer down |
| keyboardEditorInteractionOpen | 304 | setup | lifecycle close-keyboard, keyboard phase |
| middleButtonPasteGuardRef | 309 | setup | effect 1, pointer down/clear |
| middleButtonPasteGuardTimerRef | 310 | setup | effect 1, clear callback, pointer down |
| pressedKeyboardKeys | 355 | lifecycle | closeKeyboardEditorInteraction, keyboard phase, keyboard callbacks |
| lastWheelTraceAt | 358 | lifecycle | native wheel runtime |
| lastHoverTraceAt | 359 | lifecycle | pointer move |
| wheelTraceEndTimer | 360 | lifecycle | native wheel runtime |
| hoverTraceEndTimer | 361 | lifecycle | pointer move, onPointerLeave, cancelCanvasInteraction |
| pinchRef | 362 | lifecycle | pointer phases, native gesture/lost-capture, cancel |
| nativeGestureRef | 372 | lifecycle | pointer phases, native gesture runtime, bridge, cancel |
| nativeGestureEditorInteractionOpen | 380 | lifecycle | native gesture runtime, bridge, effects 5/6, cancel |
| nativeFactorInteractionEndTimer | 381 | lifecycle | bridge, effects 5/6, cancel |
| navigationStateRef | 384 | lifecycle | advanceNavigation helper (lifecycle) only |
| wheelInteractionEndTimer | 388 | lifecycle | endWheelInteractionSoon, cancelCanvasInteraction |
| wheelEditorInteractionOpen | 389 | lifecycle | endWheelInteractionSoon, native wheel runtime, cancel |
| wheelInertiaActive | 390 | lifecycle | native wheel runtime |
| cancelWheelInertiaRef | 391 | lifecycle | lifecycle cancel, native gesture runtime, bridge |
| wheelGestureClassifierRef | 392 | lifecycle | native wheel runtime (sticky classifier reused across rebinds) |
| autoPanFrameKey | 445 | lifecycle | stopAutoPan, pointer move auto-pan |
| autoPanActive | 447 | lifecycle | stopAutoPan, pointer up |
| autoPanVelocity | 448 | lifecycle | stopAutoPan, pointer move |
| autoPanFrameTime | 449 | lifecycle | stopAutoPan, pointer move tick |
| activeDragPointer | 450 | lifecycle | pointer phases, native gesture/lost-capture, unmount |
| transferredPointerIds | 451 | lifecycle | pointer phases, lost capture, cancel |
| activeInteractionRecord | 452 | lifecycle | pointer phases, native gesture/lost-capture, keyboard |
| interactionGeneration | 453 | lifecycle | pointer down only |
| internalSnapSessionRef | 597 | gesture runtime | fallback for snapSessionForPointer only |
| internalSnapIndexRef | 598 | gesture runtime | fallback for snapIndexForPointer only |
| snapSessionForPointer / snapIndexForPointer | 603/604 | gesture runtime | pointer down (single owner of the external-vs-internal fallback) |
| cursorRafScheduled | 605 | gesture runtime | pointer move, onPointerLeave |
| latestCursorWorld | 606 | gesture runtime | pointer move, onPointerLeave |
| gestureComplexity | 610 | gesture runtime | dispatchAttributes, pointer down |
| interactionSessionId (render-time const) | 569 | lifecycle | effect 2 deps only |
| wheel classifier instance | created inside effect 5 | native wheel runtime factory (stored in the lifecycle-owned ref) | wheel runtime only |
| inertia state (inertiaRef/frame key/times) | 1479-1483 | native wheel runtime factory (effect-local, not a React ref) | wheel runtime only |
| lastPointer / pointerInside | 1686-1689 | native gesture runtime factory (effect-local) | gesture runtime + bridge (bridge reads `pointerInside` through an accessor owned by the gesture factory) |
| disposePinchBridge / pinchBridgeCancelled / update count | 1943-1945 | native pinch bridge factory (effect-local) | bridge factory only; installer calls its cancel/dispose methods in the original cleanup order |

Callbacks and helpers are owned once by the phase that declares them and passed
as parameters; no callback is re-wrapped and no dependency array is edited.

## Planned-edit register (every deliberate non-verbatim edit)

1. Phase-hook parameters + destructuring preambles: each phase destructures
   `options` (with the original renames `buildToolCtx: buildToolCtxOption`,
   `snapSessionRef: externalSnapSessionRef`,
   `snapIndexRef: externalSnapIndexRef`) and earlier phase result records into
   local bindings with the original names. Moved bodies, dependency arrays, and
   parameter shapes are byte-identical; this is the only reason a moved body
   can stay verbatim.
2. `setViewportAnchor`/`clearViewportAnchor` move from the gesture band
   (original 612-619) into the setup phase (bodies verbatim, plain function
   declarations); they are referenced by earlier hooks (cancelCanvasInteraction
   537, suppressed-contact effect 586), so the earliest phase is their only
   order-safe home.
3. Native effect 5 body decomposition (one effect stays one effect): the effect
   wrapper (first 2 body lines + installer call) stays in
   `useNativeInputListeners.ts` with the identical 13-item dependency array;
   the body is composed from four factory functions in
   `nativeWheelRuntime.ts`, `nativeGestureRuntime.ts`, `nativePinchBridge.ts`,
   `nativeLostCapture.ts` and the installer `nativeInputListeners.ts`.
   Effect-local mutable state keeps one owner per factory (table above); factory
   creation order preserves the original side-effect order (classifier init +
   `installInputDiagnosticsHandle()` -> bridge dynamic import -> listener
   registration). Listener add/remove order (7 listeners) is unchanged. Two
   bridge-body reads of the gesture factory's `pointerInside` become
   `isPinchPointerInside() === false` (an accessor with identical semantics;
   null remains distinct from false). The pinch-bridge dynamic import body is
   unchanged except for being inside the factory closure.
4. Zoom/placement helpers (`zoomAboutClientPoint`, `placeWorldAnchorAtClientPoint`,
   original 1423-1477) move verbatim to `nativeZoomPlacement.ts` behind a
   four-field deps object; the factories keep local wrappers with the original
   names and signatures so every call site in the moved bodies is unchanged.
5. `handleKeyDown`'s zoom-preset/fit block (original 2509-2614) moves verbatim
   into `applyCanvasZoomShortcuts` in `keyboardZoomShortcuts.ts` behind a
   destructuring preamble; the call site replaces the block, and because nothing
   follows the block in the original handler, the helper's early returns have the
   same handler-return effect. `paintOrder`, the Tab/Escape/Enter branches, and
   the pre-block dispatch stay in `useKeyboardPhase.ts`.
6. The orchestrator rebuilds the 10-field result object field-for-field from the
   phase records, in the original order.
7. Imports are split per module and rebased one directory deeper
   (`./wheelClassifier` -> `../wheelClassifier`,
   `../tools/inputPolicy` -> `../../tools/inputPolicy`, ...); module-scope
   helpers moved to new modules are imported where needed. No import adds a
   package dependency; `@varve/*` specifiers are unchanged. No side-effect
   imports exist (30 named import declarations; 0 bare imports).
8. `biome check --write` may reflow/format/import-sort the new files (formatting
   only; no logic rewrite). Any reflowed moved line is recorded in the measured
   results.

No behavior, API, option/result contract, error-state, comment, JSDoc, or
dependency-array edit is planned. No test, snapshot, benchmark, baseline
architecture/health/visual file is edited.

## Edge-case answers carried from GAP_ANALYSIS/RESEARCH

- Module-evaluation side effects: destination modules are declaration hosts; the
  only module-scope binding that moves is the `NON_TEXT_INPUT_TYPES` Set (one
  definition, `primitives.ts`). No module-level `let`, cache, constructor call,
  DOM access, or listener at import time. Runtime getters stay call-time at their
  original handler/effect sites. `createSnapSession()` stays a `useRef`
  initializer expression at the same call position.
- tsconfig/package boundaries: destination is inside `packages/editor/src`;
  `rootDir ./src`, `include ["src", ...]`; no tsconfig, package export, or
  manifest edit. `@varve/*` specifiers unchanged.
- Import ordering and rebasing: one level deeper; no tsconfig `paths` alias
  layer; `verbatimModuleSyntax` + biome `useImportType` mean type-only imports
  are generated as `import type` where the moved code only uses them in types.
- Template literals: 23 lines with backtick literals, 7 with interpolation, no
  JSX in this `.ts` file; extraction is by AST statement boundaries, never by
  brace matching or line count.
- Identity of public names: same module path, explicit named re-exports, no
  rename, 10-field result contract unchanged, 18-field options contract
  unchanged; `useCanvasInputs` is the only production import (CanvasArea.tsx:42).
- Same-named private helpers: two `onPointerLeave` declarations exist in
  different scopes (effect-local at 1920 and the returned useCallback at 2667);
  they stay in different modules and are never merged.
- Dropped declarations: verifier must exit 0 with `missing: []` and
  `missingExports: []` before any test run.
- Tracked vs untracked baseline: new modules are untracked WIP until staged;
  they are never frozen; parent ends <= 400; staged file-size check at
  `verify:commit`.
- Baseline ratchet: 943 -> 942, exactly one removed entry, 0 added, 0 grown,
  0 other stale entries; `--force` forbidden.
- StrictMode: `apps/desktop/src/main.tsx:128` wraps the app in StrictMode; the
  extraction keeps the 8 effects as 8 effects with the same cleanup idempotence,
  so dev double-invocation semantics are unchanged.
- External-vs-internal fallbacks: `snapSessionForPointer`/`snapIndexForPointer`
  (597-604), `viewportAnchorRef` optionality (613-618),
  `canvasFocusedRef` optionality are owned once in the gesture/setup phases and
  passed down; no phase-local default is introduced.
- `buildToolCtx` stabilization (`buildToolCtxRef` 293-299) and `editor` prop
  identity: the same stable wrapper is passed to every phase; props are never
  re-wrapped by a phase.
- Per-render read of `stateRef.current.activeId` (569) stays a render-time read
  in the lifecycle phase (it drives effect 2 deps).
- Per-tool dispatch stays monomorphic: 5 `dispatchToTool` sites
  (`'down'` 825, `'move'` 1071, 1146, 1298, `'up'` 1302) and the 13 direct
  tool-manager calls stay direct-call chains inside the moved handler bodies;
  pointer-down/move/up/cancel bodies each keep exactly one dispatch site (move
  keeps its auto-pan continuation dispatch, as originally); no tool-keyed table,
  no added switch, no per-tool handler, no double dispatch. The only switch in
  the module remains `keyboardPanDelta` (not a dispatch).
- Browser event timing: no listener registration moves across effects or
  changes order; the native effect still rebinds on exactly the same 13 deps.

## Front-end / visual statement (prompts 03 and 04)

**No visual surface changed.** Prompt 03 is NOT triggered (internal module/
implementation move only: no rendered surface, DOM, JSX, class name, prop,
style, token, accessibility, i18n, or error/empty/loading/permission state
change; hook options (18 fields) and result (10 fields) contracts and the module
path are preserved; `CanvasArea.tsx` keeps the same call and the same 8 attached
handlers). Prompt 04 is NOT required (pure-move exception): no engine replay
output, no design-surface appearance, no API/error/empty/loading/permission state
consumed by the UI. Therefore this seam runs **no Playwright lane, no screenshot,
no visual-baseline update, and no canvas E2E**.

Measured blocker recorded as a limit, not a pass: the Playwright `webServer` in
this worktree cannot start (`pnpm --filter @varve/desktop exec vite` exits 1 with
`ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH` because the 21 `node_modules` entries are
symlinks to the main checkout), and the heavy-lease runtime dir
(`XDG_RUNTIME_DIR=/run/user/1000`) is EROFS. Row 9 of
`docs/quality/agent-context-remediation-2026-10-28.md:41` ("Pointer semantics
need canvas E2E coverage after each seam") is recorded as a separate bounded
follow-up after the Batch C seams land: one `--workers=1` heavy-lease
invocation of `pointer-release-over-inspector` (1), `middle-button-pan` (3),
`input-navigation` (11), `gesture-contract` (3) = 18 tests in a checkout with a
real (non-symlinked) `node_modules` and a writable `XDG_RUNTIME_DIR`.

Coverage limitation stated verbatim: the covering spec exercises only the 5 pure
helpers (11 tests); the three indirect `CanvasArea` jsdom mount tests execute the
hook and register/clean up effects but dispatch no pointer events. The hook is
**not** claimed to be covered by tests. Handler semantics are reviewed, not
unit-proven; the review checks are the hook-order/cleanup-order table, the
dependency-array identity, the dispatch-site invariant, and the diff identity
checks in the proof plan.

## Benchmark plan (Batch C gate; Lead decision)

Run the two existing comparable harnesses before and after; add or modify no
benchmark file:
- Primary pointer-move proxy:
  `./node_modules/.bin/vitest bench --run packages/editor/src/tools/__benchmarks__/move.bench.ts`
  (tiers 100/1000/5000 candidates, `snapPosition` pointer-move snapping).
- Secondary input-side proxy:
  `./node_modules/.bin/vitest bench --run packages/editor/src/tools/__benchmarks__/inputNormalizer.bench.ts`
  (64/256/1024). Plain command found the file; no bench config fallback needed.
Before numbers are recorded above; after numbers are recorded in the measured
results. Do not run `renderPath.bench.ts` / `audit-render-perf`: replay path,
C-03's concern, a false gate for C-02. Protection for the monomorphic dispatch is
the structural review plus verifier/type identity; the proxies are a regression
signal only.

## Proof plan (commands, in order)

1. Temporary extraction/verification script under `/tmp` (not in the worktree,
   deleted or left outside the repo): asserts every original line 1-2780 is
   assigned exactly once to a destination or the parent; every hook call appears
   exactly once and in order; every planned edit is enumerated; every destination
   module <= 400 lines.
2. `node scripts/quality/refactor-verify.mjs --base HEAD --target
   packages/editor/src/canvas/inputPipeline.ts --dest
   packages/editor/src/canvas/input --json` -> exit 0, `baseCount 15`,
   `missing: []`, `missingExports: []` (before tests).
3. Covering spec after: identical `1 file / 11 passed / 0 failed`; indirect three
   mount tests after: identical counts (before: 2 passed/1 skipped files, 19
   passed/1 skipped tests). No test path in the diff.
4. Direct recursive tsc substitute for the EROFS-queued `pnpm check:agent`:
   `./node_modules/.bin/tsc -p <each packages/*/tsconfig.json> --noEmit --pretty
   false` (20 package projects), then `tsc -p apps/desktop/tsconfig.json`, then
   `tsc -p tests/e2e/tsconfig.json`; plus `tsc -p
   packages/editor/tsconfig.json`. Record N projects / N failures before and
   after (before is measured on the pristine tree in this session).
5. `./node_modules/.bin/biome check --write` on the changed files, then
   `biome check` clean. Formatting/import order only.
6. `node scripts/audit-health.mjs` exit 0; record the editor architecture cycle
   identity set before/after if measurable cheaply (pre-existing state: 1 editor
   cycle; no baseline update; a new cycle is a review item/STOP report).
7. Ratchet once: `node scripts/quality/audit-file-size.mjs --update` (no
   `--force`); `git diff -- .file-size-baseline.json` -> exactly one removed
   entry, 0 added, 0 grown; then `audit-file-size` exit 0 and `--report`
   re-measured (new modules are untracked WIP-reportable and each must already be
   <= 400).
8. Stage parent + `canvas/input/` + `.file-size-baseline.json` +
   `remediation/C-02`; regenerate the map from the staged tree
   (`node scripts/quality/generate-agent-map.mjs --write`, then `git add
   docs/agents/repo-map.generated.md`); append exactly one ledger row; then
   `node scripts/quality/generate-agent-map.mjs --staged` and
   `pnpm verify:commit` (staged-only driver). If `verify:commit` fails for an
   environment reason, record it and STOP without committing.
9. One commit on `seam/C/C-02-input-pipeline` with exactly the allowed paths;
   `git show --stat` and `git status` clean afterwards. Then regenerate
   `NEXT_PROMPT.md` in the main checkout root (untracked, not committed).

Environment substitutions (measured): read-only pnpm store
(`ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`), validation queue EROFS
(`/run/user/1000/varve-validation-queue`), heavy-lease runtime EROFS, advisory
path claims ENOENT (`/run/user/1000/varve-path-claims`; advisory only). Use
direct `node`/`tsc`/`vitest` and the staged scripts; the gate contents stay
identical, only the wrapper changes. `pnpm verify:commit` may itself use the
queue/pnpm layer; if it cannot run for an environment reason, the staged script
components are run directly and the result is recorded as a limit.

## Stop conditions

1. Hook call order, effect order, or cleanup order changes (including a
   conditional phase-hook call): STOP and restore the original sequence.
2. A duplicated ref/session instance, module-scope mutable state, React context,
   or phase-local fallback that duplicates the orchestrator's: STOP.
3. Any per-tool dispatch table, added hot-path switch, per-tool handler, or a
   move/click path that performs two dispatches: STOP.
4. Any `useCallback`/effect dependency array text or parameter-shape change, or
   a re-wrapped prop identity: STOP.
5. Verifier missing declaration/export, lost exported name, renamed
   declaration, or any test edit: STOP (never edit the verifier or a spec).
6. A destination file over 400 lines that cannot be split without a behavior
   change; any baseline added/grown entry; any stale entry other than the target;
   `--update` refusing: STOP before commit (no `--force`).
7. `CanvasArea.tsx` import/line change beyond none; a new editor architecture
   cycle identity; `audit-health` failure: STOP and report.
8. `verify:commit` failure not fixable inside the seam, or any need to write the
   main checkout beyond `NEXT_PROMPT.md`: STOP and report.
9. Any use of `renderPath.bench.ts` as the C-02 gate, any new benchmark
   harness, or any browser pointer E2E inside this seam: STOP and report.
10. Any claim that local master contains B-11/C-01/C-02, or any stale handoff
    number reused: STOP and re-measure on the committed branch worktree.

## Ownership and writing scopes

- One writer in `.worktrees/C-02` (this executor). No teammate/other agent is
  spawned into this worktree; the main checkout is never written except the single
  untracked `NEXT_PROMPT.md`, and never reset/checkout/clean/rebase.
- Write scope (worktree): `packages/editor/src/canvas/inputPipeline.ts`,
  `packages/editor/src/canvas/input/**`, `.file-size-baseline.json`,
  `docs/agents/repo-map.generated.md`, `BACKLOG_LEDGER.md`,
  `remediation/C-02/{RESEARCH,GAP_ANALYSIS,SEAM_SPEC}.md`; scratch scripts only
  under `/tmp`.
- Not touched: tests/specs, snapshots, benchmarks, `CanvasArea.tsx`, package
  manifests, lockfiles, tsconfigs, `docs/**` other than the generated repo map,
  the dated remediation doc, the campaign plan, visual/perf/health/architecture
  baselines, other worktrees, `.worktrees/C-01`.
- Single-writer surfaces: `.file-size-baseline.json` (one `--update`),
  `docs/agents/repo-map.generated.md` (regenerated from the staged tree),
  `BACKLOG_LEDGER.md` (exactly one appended row).

## Measured results (Lead-verified on the pre-commit tree; no planned value is a result)

Process note: the executor's turn ended after it generated the 23 destination
modules, ran the ratchet, and ran the core gates, but before it filled this
section, staged the seam, committed, or regenerated the handoff. The Lead
completed the verification from measured output, filled this section, staged the
seam, passed the staged checkpoint, and made the single commit. Every number
below was re-measured on this worktree's final tree; the verifier, type, test,
and benchmark evidence is from the same tree that was staged.

### Destination modules (final `wc -l`, every file <= 400)

| file | lines |
|------|-------|
| `packages/editor/src/canvas/input/usePointerMovePhase.ts` | 372 |
| `packages/editor/src/canvas/input/nativeGestureRuntime.ts` | 341 |
| `packages/editor/src/canvas/input/useKeyboardPhase.ts` | 330 |
| `packages/editor/src/canvas/input/usePointerReleasePhases.ts` | 322 |
| `packages/editor/src/canvas/input/useInteractionLifecycle.ts` | 313 |
| `packages/editor/src/canvas/input/usePointerDownPhase.ts` | 278 |
| `packages/editor/src/canvas/input/nativeWheelRuntime.ts` | 268 |
| `packages/editor/src/canvas/input/nativePinchBridge.ts` | 236 |
| `packages/editor/src/canvas/input/keyboardZoomShortcuts.ts` | 144 |
| `packages/editor/src/canvas/input/primitives.ts` | 121 |
| `packages/editor/src/canvas/input/nativeLostCapture.ts` | 116 |
| `packages/editor/src/canvas/input/pointerMoveAutoPanTick.ts` | 107 |
| `packages/editor/src/canvas/input/useInputSetup.ts` | 103 |
| `packages/editor/src/canvas/input/types.ts` | 87 |
| `packages/editor/src/canvas/input/useInputLifecycleEffects.ts` | 85 |
| `packages/editor/src/canvas/input/nativeZoomPlacement.ts` | 82 |
| `packages/editor/src/canvas/input/useKeyboardCallbacks.ts` | 82 |
| `packages/editor/src/canvas/input/useGestureDispatchRuntime.ts` | 62 |
| `packages/editor/src/canvas/input/keyboardHelpers.ts` | 62 |
| `packages/editor/src/canvas/input/useNativeInputListeners.ts` | 50 |
| `packages/editor/src/canvas/input/nativeInputListeners.ts` | 48 |
| `packages/editor/src/canvas/input/useCanvasInputs.ts` | 42 |
| `packages/editor/src/canvas/input/useWindowFocusEffect.ts` | 28 |
| `packages/editor/src/canvas/inputPipeline.ts` (parent) | 15 |

Parent + 23 modules, 3,694 lines total (before: one 2,780-line file). The largest
module is 372; no file exceeds the 400-line cap. Contingency used as recorded
before coding: `pointerMoveAutoPanTick.ts` (107) carries `handlePointerMove`'s
auto-pan tick as a plain function extracted per the contingency paragraph, with
no control-flow change; it is inside the one destination directory, not a second
seam.

### Move identity (Lead AST audit against `git show 2bf4871e7`)

- `node scripts/quality/refactor-verify.mjs --base HEAD --target
  packages/editor/src/canvas/inputPipeline.ts --dest
  packages/editor/src/canvas/input --json`: exit 0,
  `{"ok":true,"baseCount":15,"presentCount":45,"missing":[],"missingExports":[]}`.
  The 30 additional present declarations are exactly the documented glue phase
  hooks/factories/helpers listed earlier in this spec.
- Hook calls: base 36 `useRef` + 18 `useCallback` + 8 `useEffect` = 62; after
  36/18/8 = 62. Flattened order comparison: the orchestrator calls the 12 phase
  hooks in the recorded order with 11, 31, 7, 1, 1, 1, 1, 1, 2, 1, 4, 1 hook
  calls respectively (62 total); AST comparison of kind + bound name reports
  0 mismatches. Effect 5 stays one effect with one cleanup; the installer cleanup
  order (7 element listeners -> bridge.cancel -> timer clear -> bridge.dispose)
  matches the original cleanup order.
- Comments: AST-extracted comments base 212 / after 234; missing 0; the 22 new
  comments are the module headers/planned extraction notes. All moved comments
  and JSDoc are preserved verbatim (whitespace-reindent normalised comparison).
- Public contracts: `UseCanvasInputsOptions` 18/18 fields,
  `UseCanvasInputsResult` 10/10 fields; the parent exports the same 8 names via
  4 explicit re-export statements from the unchanged module path
  `./canvas/inputPipeline`.
- Monomorphic dispatch: `dispatchToTool` sites 5/5; direct tool-manager calls
  handlePointerDown 1/1, handlePointerMove 3/3, handlePointerUp 1/1,
  handlePointerCancel 2/2, handleKeyDown 2/2, handleKeyUp 1/1,
  handleDoubleClick 1/1; total `switch` 1/1 (the moved `keyboardPanDelta` only);
  total `Record<` 1/1 (the moved `ZOOM_PRESETS` only, base line 2510). No
  dispatch table, lookup object, or extra dispatch site was added.
- Listener surface: `addEventListener` 16/16, `removeEventListener` 16/16; the
  native installer registers the 7 element listeners in the original order and
  removes them in the original cleanup order.
- Line reachability: of the 2,780 base lines, 72 non-blank lines are not
  byte-identical after reindentation; all 72 are covered by the planned-edit
  register: 38 import/type-specifier rebase lines, 3 orchestrator
  signature/destructure lines, 7 extracted-helper signature/format adjustments
  (including biome reflow), 2 `pointerInside === false` ->
  `isPinchPointerInside() === false` accessor edits, 14 native listener
  registration/cleanup lines rewritten to named handler references with the same
  order/options, and 8 result-object field lines rebuilt field-for-field.
  0 unexplained non-verbatim base lines; every other base line is present in the
  new tree verbatim modulo dedent (trimmed-line match).
- The 23 destination modules form an acyclic subgraph: a direct import-graph DFS
  over `canvas/input/*.ts` reports 0 internal cycles, and only the parent imports
  `./input/*` (the orchestrator); no existing module imports the new subgraph.

### Gates

- Covering spec before -> after: `1 file / 11 passed / 0 failed` -> identical;
  the test file is untouched (no test path in the diff).
- Indirect jsdom mounts (`CanvasArea.render.test.tsx`,
  `CanvasArea.emptyState.test.tsx`, `__tests__/canvasRedrawOnDocChange.test.tsx`):
  before (executor run) `2 passed | 1 skipped files / 19 passed | 1 skipped
  tests`; after (Lead run) identical. These mount the hook and execute its
  effects but dispatch no pointer events, so they are not handler coverage.
- Direct recursive tsc substitute (20 package tsconfigs + `apps/desktop` +
  `tests/e2e`): before 22 projects / 0 failures (pristine `2bf4871e7` tree,
  measured by stashing the seam) and after 22 projects / 0 failures;
  `packages/editor` tsc exit 0.
- `biome check` on the parent + 23 modules: clean (24 files, no pending fixes);
  `node scripts/audit-health.mjs`: exit 0 (guard script is not coupled to the
  target; `CanvasArea.tsx` untouched).
- Ratchet: `audit-file-size --update` (never `--force`) -> baseline diff is
  exactly one removal (`packages/editor/src/canvas/inputPipeline.ts`: 2780),
  0 added, 0 grown, 943 -> 942; `audit-file-size` exit 0; `--report` after:
  6,356 scanned, 942 over cap, 942 frozen, 0 violations, 0 untracked WIP,
  287,050 excess lines (delta -2,380 = the removed entry's over-cap excess),
  942 baseline entries / 0 stale.
- Architecture: no architecture/performance/visual/health baseline was updated.
  `audit-architecture --ci` is pre-existing red at this checkpoint from earlier
  batches; this seam adds no import edge from an existing module into the new
  subgraph and its internal graph is acyclic (above), so it adds no cycle
  identity attributable to C-02.

### Batch C benchmark (existing harnesses only; no benchmark file added or edited)

Primary pointer-move proxy: `packages/editor/src/tools/__benchmarks__/move.bench.ts`
(`snapPosition`, the pointer-drag snapping path downstream of tool dispatch;
tiers 100/1000/5000 candidate bounds). Command (both runs):
`./node_modules/.bin/vitest bench --run packages/editor/src/tools/__benchmarks__/move.bench.ts`.
Mean ms before (pristine tree, quiet) -> after (final tree, quiet):

| tier | jsdom before -> after | node before -> after |
|------|----------------------|----------------------|
| 100 candidates | 0.1281 -> 0.1260 | 0.2140 -> 0.1743 |
| 1000 candidates | 1.5649 -> 1.3991 | 2.2843 -> 2.0315 |
| 5000 candidates | 9.9142 -> 8.1997 | 11.2460 -> 9.8090 |

Secondary input-side proxy: `packages/editor/src/tools/__benchmarks__/inputNormalizer.bench.ts`
(`canonicalizeInputEvents`, 64/256/1024 samples; dynamics-aware mean ms
jsdom/node): before 0.0985/0.0707, 0.3704/0.2820, 1.3199/2.0457 -> after
0.0741/0.0713, 0.3359/0.3152, 1.4430/1.4680. The as-was control means moved
within the same run-to-run spread.

Interpretation: no existing harness imports `inputPipeline.ts`, so these are
regression-signal proxies, not a direct gate. The primary pointer-move proxy is
equal-or-faster after the move at every tier, the secondary proxy is within
microbenchmark noise, and there is no regression signal. `renderPath.bench.ts` /
`audit-render-perf` were deliberately not used (replay path; a false gate for
C-02). The monomorphic requirement is additionally protected by the dispatch
counts and diff review above.

### Staged checkpoint, commit, and final state

- The seam is staged as the parent + `canvas/input/**` +
  `.file-size-baseline.json` + `remediation/C-02/{RESEARCH,GAP_ANALYSIS,SEAM_SPEC}.md`;
  the repo map is regenerated from the staged tree
  (`generate-agent-map.mjs --write`) and the staged map check
  (`generate-agent-map.mjs --staged`) plus `pnpm verify:commit` (emoji, staged
  map, staged file size, health, docs, staged tests) run before the commit.
- Exactly one commit is created on `seam/C/C-02-input-pipeline`, with parents
  `a3796c0ba` (local master) -> `42207fee2` (rebased B-11) -> `2bf4871e7`
  (rebased C-01) -> the C-02 commit. No merge, push, or prune is performed; the
  commit SHA is reported to the Lead and recorded in the ledger/handoff after the
  commit (a commit cannot contain its own SHA).
- Final `git status` in the worktree after the commit is clean; `NEXT_PROMPT.md`
  is written untracked at the main checkout root and is never committed.
