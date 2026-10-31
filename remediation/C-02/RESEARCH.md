# C-02 research and gap analysis - inputPipeline.ts phase split

Status: Phase 0 output for Batch C entry C-02, adapted from
`remediation/prompts/01-RESEARCH-AND-GAP-ANALYSIS.md` with the C-02 resolved
values. One seam, one worktree, one commit. Measurements were taken in
`.worktrees/C-02` on branch `seam/C/C-02-input-pipeline` (HEAD `2bf4871e7`)
between 18:12 and 18:25 PT on 2026-10-29. The Lead owns the destination map and
the hand-completed declaration inventory in `SEAM_SPEC.md` (prompt 02); this
file records evidence, risks, and decision inputs only. Implementation is blocked
until this document and `GAP_ANALYSIS.md` exist.

## Measurement window and integration note

- Worktree: `/home/kevina/CodingProjects/varve/.worktrees/C-02`, branch
  `seam/C/C-02-input-pipeline` (`git branch --show-current`), HEAD
  `2bf4871e7701e0abbc944f8de924375ca2666cbe` (`git rev-parse HEAD`), clean
  working tree before these documents (`git status --porcelain` printed
  nothing).
- Integration route: local master measured `a3796c0ba`
  (`git log --oneline -1 a3796c0ba`); the main checkout is concurrently used by
  another session (`git -C /home/kevina/CodingProjects/varve status --porcelain
  | wc -l` = 31 entries), so the measured fallback was used: the branch was
  created from `seam/C/C-01-replay` tip `e5d6ff555`
  (`git log --oneline e5d6ff555 -1` = the C-01 commit) and rebased onto master;
  the handoff records that map conflicts were resolved by regeneration (this
  read-only phase did not repeat that operation). The branch now contains
  `42207fee2` (B-11) and `2bf4871e7` (C-01) linearly on top of `a3796c0ba`
  (`git log --oneline a3796c0ba..HEAD`).
- `git merge-base --is-ancestor a3796c0ba HEAD` exits 0. `git diff --stat
  a3796c0ba HEAD -- packages/editor/src/canvas/inputPipeline.ts` is empty and
  `git log --oneline a3796c0ba..HEAD -- packages/editor/src/canvas/inputPipeline.ts`
  is empty, so master is a valid `refactor-verify --base` for the target even
  though master does not contain B-11 or C-01. Local master must be re-measured
  at handoff; it moved repeatedly in the preceding sessions.
- `seam/C/C-01-replay` is checked out in another worktree (`git branch --list`
  prints `+ seam/C/C-01-replay`); it is another session's tree and is never
  written by this task.

## Measured checkpoint state

Every number below is reproduced by the quoted command from the worktree root.

- `node scripts/quality/audit-file-size.mjs --report` (exit 0):
  `Scanned 6333 source files; 943 over the 400-line cap; 943 frozen in
  .file-size-baseline.json; 0 violation(s); 0 untracked WIP over-cap file(s).`
  `Excess over cap: 289430 lines. Baseline entries: 943 (0 stale).` The target
  row is `2780  packages/editor/src/canvas/inputPipeline.ts  [frozen]`
  (offenders 1-2 are `context.tsx` 11435 and `Menubar.tsx` 2873).
- `node scripts/quality/audit-file-size.mjs` (exit 0):
  `File-size budget OK: 6333 source files scanned; 943 over 400 lines, all
  frozen in .file-size-baseline.json (tracked content).`
- `grep -n 'inputPipeline.ts' .file-size-baseline.json`:
  `120:    "packages/editor/src/canvas/inputPipeline.ts": 2780,`.
- `wc -l packages/editor/src/canvas/inputPipeline.ts
  packages/editor/src/canvas/inputPipeline.test.ts` = 2780 and 120 lines.
- `node scripts/quality/godsplit-plan.mjs packages/editor/src/canvas/inputPipeline.ts`
  (exit 0): `Lines: 2780 | imports: 30 | blocks: 15`, with the table below.
  Hazards printed: target over the 400-line cap; `sub-split required:
  useCanvasInputs lines 269-2717 is 2449 lines on its own`.
- `node scripts/quality/refactor-verify.mjs --base HEAD --target
  packages/editor/src/canvas/inputPipeline.ts --json` and the same command with
  `--base master` both exit 0 with
  `{"ok":true,"baseCount":15,"presentCount":15,"missing":[],"missingExports":[]}`.
- `./node_modules/.bin/vitest run packages/editor/src/canvas/inputPipeline.test.ts
  --reporter=dot`: `Test Files 1 passed (1)`, `Tests 11 passed (11)`,
  0 failed (47.30 s in this cold run; transform 31.91 s; the Lead's checkpoint
  run measured 13.98 s - the pass count is the invariant, duration is not).
- Only two files name the target
  (`grep -rn "inputPipeline" --include='*.ts' --include='*.tsx' --include='*.mjs'
  packages apps tests scripts` excluding the target itself):
  `packages/editor/src/CanvasArea.tsx:42: import { useCanvasInputs } from
  './canvas/inputPipeline';` and
  `packages/editor/src/canvas/inputPipeline.test.ts:8: } from './inputPipeline';`.
  There is no second production importer and no mocker.

### Planner block table (15 blocks, measured)

| lines | range | kind | name | export | first doc line |
|-------|-------|------|------|--------|----------------|
| 11 | 86-96 | Variable | NON_TEXT_INPUT_TYPES | no | - |
| 20 | 100-119 | Function | shouldSuppressMiddleButtonPaste | yes | Preserve native clipboard actions in editable controls ... |
| 50 | 121-170 | Interface | UseCanvasInputsOptions | yes | - |
| 12 | 172-183 | Interface | UseCanvasInputsResult | yes | - |
| 10 | 185-194 | Interface | CanvasPointerInteractionRecord | no | - |
| 15 | 196-210 | Function | ownsCanvasPointerInteraction | no | - |
| 12 | 212-223 | Function | cancelRecordedCanvasPointer | no | - |
| 6 | 226-231 | Function | shouldResolveHover | yes | Hover hit testing is informational ... |
| 22 | 238-259 | Function | snapshotHeldPointer | no | Retain the scalar pointer state ... |
| 3 | 261-263 | Function | isTouchLikePointerType | no | - |
| 3 | 265-267 | Function | isTouchLikeContact | no | - |
| 2449 | 269-2717 | Function | useCanvasInputs | yes | - |
| 7 | 2727-2733 | Function | shouldSkipCanvasKeydown | yes | Decide whether the canvas should ignore ... |
| 15 | 2736-2750 | Function | keyboardPanDelta | yes | Return a screen-space camera delta ... |
| 24 | 2757-2780 | Function | shouldDeferArrowToSelectedGuide | yes | A selected guide is its own keyboard target ... |

The planner reports 8 exported blocks (`shouldSuppressMiddleButtonPaste`,
`UseCanvasInputsOptions`, `UseCanvasInputsResult`, `shouldResolveHover`,
`useCanvasInputs`, `shouldSkipCanvasKeydown`, `keyboardPanDelta`,
`shouldDeferArrowToSelectedGuide`) and 7 private blocks; parsed from
`godsplit-plan ... --json` (`totalLines 2780, imports 30, blocks 15`).
`--top` is not supported at this checkpoint (`godsplit-plan: unknown argument:
--top` with a usage block; `--json` works), so prompt 02's `--top 200` must be
dropped or replaced by the no-flag table / `--json`.

## Target anatomy (measured)

The file is a single `.ts` module with no JSX:

- Module scope, lines 1-268 (268 lines): doc header, 30 import declarations,
  the private module constant `NON_TEXT_INPUT_TYPES` (a `Set`, 86-96), 3
  interfaces (the 2 exported option/result contracts plus the private
  `CanvasPointerInteractionRecord`), and 7 helper functions (2 exported pure
  helpers, 5 private helpers).
- `export function useCanvasInputs(...)`, lines 269-2717 (2,449 lines): the
  sub-split hazard.
- Post-hook scope, lines 2718-2780 (63 lines): 3 exported pure helpers
  (`shouldSkipCanvasKeydown`, `keyboardPanDelta`,
  `shouldDeferArrowToSelectedGuide`).
- 30 imports (4 `@varve/*`, 1 `react`, 25 relative:
  `../context`, `../input`, `../performance`, `../shortcuts`, `../tools`,
  `./canvasSurface`, `./cursorPosition`, `./inputDiagnostics`,
  `./navigationRuntime`, `./navigationState`, `./perfRuntime`,
  `./pinchBridge`, `./twistRotation`, `./wheelClassifier`, `./wheelGesture`).
  `grep -nE "^import ['\"]"` finds no bare side-effect import; every import is
  a named/default declaration.
- No `export default`, no `useMemo`, no `useState`.

### Hook anatomy

`grep`/line scan of the hook gives 62 hook calls:
**36 `useRef`, 18 `useCallback`, 8 `useEffect`, 0 `useMemo`, 0 `useState`**.

Measured correction in prompt 02: the Phase 0 count of 19 `useRef` / 45 hook calls
came from a `grep -oE 'useRef(<[^>]*>)?\('` line scan, which misses `useRef<...>`
forms whose generic argument contains `>` before the call parenthesis (for
example `useRef<ReturnType<typeof setTimeout> | null>(null)`). An AST scan of the
`useCanvasInputs` body (74 top-level statements) finds 36 `useRef`, 18
`useCallback`, and 8 `useEffect` calls: 62 hook calls. The listed effect lines,
callback list, and 8-effect order are unchanged; only the totals are corrected.
The 8 effects are at lines 319, 570, 575, 576, 1419, 2212, 2242, 2690; the 18
`useCallback` declarations start at 295, 311, 455, 463, 469, 476, 484, 621, 630,
638, 849, 1179, 1329, 2264, 2633, 2657, 2667, 2683. The hook body also has 10
nested `function` declarations and several `const` functions (for example
`endWheelInteractionSoon` 396, `advanceNavigation` 414, `pinchGeometry` 434,
`setViewportAnchor` 612, `clearViewportAnchor` 617, and the listeners inside the
1419 effect).

Measured phase bands inside the hook (line numbers from the reads):

| Band | Lines | Size | Contents |
|------|-------|------|----------|
| Setup / stabilizers | 269-318 | 50 | options destructure, `buildToolCtxRef` + stable `buildToolCtx`, touch/ownership/interaction refs, middle-button paste refs |
| Middle-button paste effect | 319-354 | 36 | 4 window capture listeners (343-346) and cleanup |
| Gesture refs + nav helpers | 355-443 | 89 | pressed keys, trace timers, `pinchRef`, `nativeGestureRef`, `navigationStateRef`, wheel refs, `endWheelInteractionSoon`, `advanceNavigation`, `recordNavigationEvent`, `pinchGeometry` |
| Interaction-open refs + auto-pan state | 445-461 | 17 | auto-pan frame key/velocity/time, drag pointer, transferred ids, interaction record/generation |
| Close/cancel callbacks | 463-567 | 105 | `stopAutoPan`, close-pointer/close-touch/close-keyboard, `cancelCanvasInteraction` |
| Cancellation lifecycle effects | 569-595 | 27 | `registerCanvasInteractionCancellation` effect, unmount cancel effect, suppressed-contact document effect |
| Snap session + anchor + dispatch attrs | 597-636 | 40 | external/internal snap session + index fallbacks, `cursorRafScheduled`, `latestCursorWorld`, `gestureComplexity`, `setViewportAnchor`, `clearViewportAnchor`, `dispatchAttributes`, `traceEventId` |
| `handlePointerDown` | 638-847 | 210 | admission, suppression, middle-guard, tool dispatch |
| `handlePointerMove` | 849-1177 | 329 | ownership, navigation, pinch/twist, hover, auto-pan, tool dispatch |
| `handlePointerUp` | 1179-1327 | 149 | release, transfer, commit, tool dispatch |
| `handlePointerCancel` | 1329-1417 | 89 | cancel, capture loss, tool cancel |
| Native wheel/gesture/listener effect | 1419-2205 | 787 | wheel classifier/inertia, native gesture stream, canvas listeners |
| Unmount cleanup effect | 2212-2234 | 23 | clears drag/touch/pinch/native-gesture/ownership state |
| Modal-crop key effect | 2242-2262 | 21 | capture-phase crop keys |
| `handleKeyDown` | 2264-2631 | 368 | key ownership, nudge, zoom, pan, tool dispatch, cancel |
| `handleKeyUp` | 2633-2655 | 23 | key release, spring release, tool dispatch |
| `handleDoubleClick` | 2657-2665 | 9 | tool dispatch |
| `onPointerLeave` / `onBlur` | 2667-2683 | 17 | hover/cursor reset; cancel on blur |
| Window blur / visibility effect | 2690-2703 | 14 | cancel on blur/hidden |
| Return object | 2705-2716 | 12 | 10 result fields |

### Module-scope state and side-effect surface

- There is **no module-scope mutable state**: no module-level `let`, cache,
  counter, pool, or singleton. All input state is per-component `useRef` inside
  the hook (300-309, 355-394, 445-453, 597-610). The only module-scope binding
  besides imports is the constant `NON_TEXT_INPUT_TYPES` Set (86-96).
- No import-time DOM/canvas access: `new PointerEvent(...)` is call-time inside
  `snapshotHeldPointer` (238-259); `installInputDiagnosticsHandle()` is called
  from the native-listener effect (1550); `observeInputCapabilities` is called
  from pointer handlers (645, 856) and `refreshDrawingInputSettings` from
  `handlePointerDown` (669); `window`/`document` listeners are registered or
  cleaned only inside the 8 effects (16 `addEventListener` call sites:
  window 343-346 and 2697-2698, document 589-590, canvas element 2087-2092 and
  2174, window capture 2260).
- Side-effect calls stayed in handlers/effects and must remain there: pinning
  them at module scope in a destination module would run once at import instead
  of per interaction.
- Strings: 23 lines contain backtick template literals and 7 lines contain
  `${...}` interpolation (measured with a line scan of the file; no JSX). No
  template literal is multiline JSX-like text; cuts must still be on declaration
  boundaries.

### Per-tool dispatch and the monomorphic constraint

The hot-path dispatch is not a switch in this file. `dispatchToTool(phase, ...)`
from `../performance/dispatchSpan` wraps 5 call sites: `'down'` at 825,
`'move'` at 1071, 1146, 1298, and `'up'` at 1302. Inside those wrappers the
hook calls the tool manager directly: `tmInst.handlePointerDown` (826),
`tmInst.handlePointerMove` (1072), `activeTool.handlePointerMove` (1147),
`tmInst.handlePointerMove` (1299), `tmInst.handlePointerUp` (1303), plus
`handlePointerCancel` (518, 729, 2485), `handleKeyDown` (2255, 2397),
`handleKeyUp` (2651), and `handleDoubleClick` (2662). The per-tool dispatch
itself is the direct-call chain in `packages/editor/src/tools/ToolManager.ts:238-315`
(no switch, no dispatch table); the only `switch` in the target is
`keyboardPanDelta` (2738-2749), which is not a dispatch site. The seam must keep
this shape: one dispatch site per event phase, direct method calls, no
`Record<ToolId, Handler>` table, no added switch on tool id in the hot path.

### Consumers, covering test, and guarding surfaces

- Public surface: 8 exported declarations (above). `CanvasArea.tsx` imports only
  `useCanvasInputs` (line 42), calls it at 1061-1080 with all 18 option fields
  (`contentCanvasRef`, `canvasRectRef`, `viewportAnchorRef`,
  `refreshCanvasRect`, `onContextMenu`, `editor`, `stateRef`, `tmRef`,
  `buildToolCtx`, `commitCamera`, `previewCamera`, `setSnapGuides`,
  `setHoveredNode`, `setRenameDialog`, `snapSessionRef`, `snapIndexRef`,
  `rootNodes`, `canvasFocusedRef`), and attaches 8 returned handlers to the
  canvas at 1519-1526; the 10-field `UseCanvasInputsResult` contract must stay
  identical.
- `UseCanvasInputsOptions` and `UseCanvasInputsResult` have no consumer outside
  the target (`grep -rln` over `packages apps tests scripts`), but they are part
  of the exported module contract and should stay re-exported by name.
- Covering test: `packages/editor/src/canvas/inputPipeline.test.ts` is 120 lines
  with 5 `describe` blocks and 11 `it` tests. It imports exactly 5 declarations
  (lines 2-8): `keyboardPanDelta`, `shouldDeferArrowToSelectedGuide`,
  `shouldResolveHover`, `shouldSkipCanvasKeydown`,
  `shouldSuppressMiddleButtonPaste`. It never imports `useCanvasInputs` and
  never renders a component.
- Indirect jsdom coverage: `CanvasArea.render.test.tsx` (127 lines),
  `CanvasArea.emptyState.test.tsx` (220), and
  `packages/editor/src/__tests__/canvasRedrawOnDocChange.test.tsx` (180) mount
  `CanvasArea`, which executes the hook and registers its effects; a grep for
  `pointerDown`/`pointerMove`/`PointerEvent`/`fireEvent` in those three files
  finds no pointer dispatch, so the handlers themselves are not exercised.
- Guard coupling: `.health-baseline.json:10-15` records `CanvasArea.tsx` at
  1596 lines / 38 imports with max 1746 / 38 (current `wc -l` is 1640 lines);
  the seam must stay import- and line-neutral in `CanvasArea.tsx` (do not add a
  hub import or move option plumbing into it). `scripts/audit-health.mjs` lists
  only `CanvasArea.tsx` in `COMPLEXITY_CEILINGS` (line 30) and
  `OVER_CEILING_FILES` (line 40); the target is not listed, so there is no
  first-line `// COMPLEXITY:` coupling for `inputPipeline.ts`.
  `.architecture-baseline.json` records exactly 1 editor cycle
  (`render/workerHost.ts -> render/workerRenderSpan.ts`), none under
  `canvas/`; the seam must add no new cycle identity.
- Baseline tooling: `scripts/quality/audit-file-size.mjs:334` parses
  `--report/--update/--force/--staged/--help`; `--staged` is the pre-commit
  measurement (line 345-346). `--update` refuses to freeze a new over-cap path
  or record growth; the ratchet is monotone non-increasing.
- `refactor-verify` limits (header lines 24-26): TypeScript/JavaScript only and
  `export *` wildcards are not resolved, so every moved public name that must
  stay reachable from `./inputPipeline` needs an explicit named re-export in the
  parent (this is also required to keep the covering test byte-identical).

## A. Research themes (repository evidence first)

1. **Module-evaluation side effects.** For this target the import graph is
   already side-effect-free: 30 import declarations, zero bare imports, zero
   module-scope mutable bindings, and no import-time DOM/canvas access (verified
   by reading 1-268 and the greps above). All state is per-render `useRef`
   state inside the hook. The failure mode to prevent is the opposite direction:
   a destination module that owns a singleton or a module-scope cache (for
   example a snap session, pointer map, or interaction record) would either
   duplicate per-instance state or leak across instances. C-01's theme 1 documents
   the analogous hazard with module-scope LRU/cache identity, and the A-04 prompt
   describes it with a singleton worker pool. Guardrail: destination modules contain declarations only, no module-level
   `let`, no import-time construction; `createSnapSession()` stays an argument
   of `useRef` inside the hook (597), and the imported runtime getters
   (`getNavigationSettings`, `refreshDrawingInputSettings`,
   `observeInputCapabilities`, `installInputDiagnosticsHandle`) stay call-time at
   their current handler/effect sites.
2. **tsconfig project boundaries and package exports.** `packages/editor/tsconfig.json`
   sets `rootDir: ./src` and `include: ["src", "../compositor/src/webgpu/webgpu-env.d.ts"]`,
   so `packages/editor/src/canvas/input/` compiles in the same project with no
   tsconfig edit. `packages/editor/package.json` exports only `.`, `./auxiliary`,
   and `./editor.css`; the destination adds no package entry point and no
   cross-package import. The moved code keeps its exact `@varve/*` specifiers.
3. **Path aliases and import ordering.** There is no tsconfig `paths` alias
   layer; imports use package exports/`@varve/*` or relative paths. Moving to
   `canvas/input/` rebases relative specifiers one level deeper
   (`./wheelClassifier` -> `../wheelClassifier`, `../tools/inputPolicy` ->
   `../../tools/inputPolicy`, ...). There are no side-effect imports, so import
   order is semantic only for readability; one `biome check --write` pass may
   sort/format, and it must not rewrite moved logic. `tsconfig.base.json` sets
   `verbatimModuleSyntax` and `biome.json` sets `useImportType: error`, so a
   missing `type` modifier is a type error, not a warning.
4. **Template-literal and code-like text.** The target has no JSX (it is a
   `.ts` file), but 23 lines contain backtick template literals and 7 lines
   contain `${...}` interpolations (for example
   `${kind}:handler:${sequence}` at 634 and the diagnostic strings at 422).
   Declaration-boundary cuts are mandatory; no brace-matching or line-count
   cuts. The B-09 precedent proved moved ranges byte-identical (701 lines
   verbatim / 1,399 dedented) and C-01 proved AST-printer identity; prompt 02
   should require the same partition proof for the moved hook bands.
5. **Overloaded and identity-sensitive declarations.** No TypeScript overloads
   exist. The identity risks are: `useCanvasInputs` must be exported from the
   same module path (`./canvas/inputPipeline`) because `CanvasArea.tsx:42`
   imports it there; the 5 pure helpers must remain named exports of that module
   because the covering test imports them from there; and the 10-field handler
   object returned by the hook keeps its field names and handler semantics.
   Keep the parent as the public entry with explicit named re-exports (no
   `export *`, which the verifier does not resolve); do not rename any
   declaration.
6. **Same-named private helpers.** The 7 private helper names
   (`ownsCanvasPointerInteraction`, `cancelRecordedCanvasPointer`,
   `snapshotHeldPointer`, `isTouchLikePointerType`, `isTouchLikeContact`, plus
   the `CanvasPointerInteractionRecord` type) have 0 occurrences outside the
   target, so there are no cross-file duplicates to reconcile - but they must
   keep exactly one home each in the destination. One real same-name collision is
   inside the target already: `onPointerLeave` exists as a nested function in the
   native-listener effect (1920) and as the returned `useCallback` (2667); they
   have different scopes and must not be merged or hoisted to one module-level
   name. No extra export may be introduced just because a sibling needs a helper.
7. **Dropped declarations.** The planner's 15 blocks are a complete declaration
   inventory (8 exported + 7 private); `refactor-verify` reports
   `baseCount 15 / presentCount 15`. Prompt 02 must assign every block to exactly
   one destination (or "stays in the parent") and run the verifier with
   `--dest packages/editor/src/canvas/input` before tests; `missing: []` and
   `missingExports: []` are mandatory, and the verifier is never edited to pass.
8. **Tracked-versus-untracked baseline policy.** New `canvas/input/` modules are
   untracked WIP until staged: they are reported as WIP, never frozen, and are
   enforced by `audit-file-size --staged` when staged in prompt 02 Step 6. The
   parent must end at or under 400 lines before the entry leaves the baseline.
   No WIP module may be left over 400 lines at staging time.
9. **Stale and grandfathered baseline entries.** The checkpoint has 943 frozen
   entries with 0 stale. Exactly the `inputPipeline.ts` entry may leave when the
   parent is split (expected ratchet **943 -> 942**, 0 added, 0 grown). Any other
   stale entry, any grown frozen file (including `CanvasArea.tsx` and the files
   moved to), or any new over-cap file is a stop-and-report condition, never a
   reason for `--update --force`.
10. **Concurrent worktree conflict on peer-hot files.** `.file-size-baseline.json`,
    `docs/agents/repo-map.generated.md`, `BACKLOG_LEDGER.md`, `docs/README.md`,
    and manifests/lockfiles are single-writer surfaces; only one split updates
    them at a time, and generated surfaces are regenerated, never hand-merged.
    This task writes only `remediation/C-02/` in `.worktrees/C-02`; the main
    checkout is concurrently used (31 dirty/untracked entries) and was never
    written. Advisory path claims are visibility only and their runtime is
    blocked here: `node scripts/quality/path-claims.mjs claim ...` exits 1 with
    `ENOENT: no such file or directory, mkdir '/run/user/1000/varve-path-claims'`,
    while `... list` prints `no matching claims`. That failure is recorded, not
    fatal: claims never gate.
11. **Rollback.** The seam is uncommitted until prompt 02 Step 8. A failed
    extraction is discarded only inside `.worktrees/C-02`:
    `git checkout -- packages/editor/src/canvas/inputPipeline.ts` and
    `rm -rf packages/editor/src/canvas/input`. Never reset the shared checkout,
    never revert another session's uncommitted work, never commit a partial seam
    "to save it". Branch `seam/C/C-02-input-pipeline` is at `2bf4871e7`; if the
    ratchet cannot go down or a module cannot stay at/under 400 lines, stop
    before committing.
12. **Rust-crate equivalents (does not apply).** There is no Rust seam in C-02:
    target and destination are TypeScript inside `packages/editor/src`. The Batch
    B Rust risks (`mod`/registrations, `generate_handler!`, `audit:ipc`) do not
    apply, `cargo check` and `audit:ipc` are out of scope, and
    `refactor-verify` being TypeScript/JavaScript-only is harmless here. This
    is recorded so a future entry cannot inherit the wrong verification.

## Hook sub-split risk analysis (C-02-specific)

The sub-split hazard is not the moved pure helpers; it is turning one 2,449-line
hook into an orchestrator plus phase hooks/modules. The following failure modes
have no static gate that fully catches them, so prompt 02 must record the
decisions in `SEAM_SPEC.md` and treat deviations as STOP conditions.

### 1. Hook-order and cleanup-order invariance

React identifies hook state by call order. The hook currently calls 62 hooks in a
fixed top-level order (`useRef`/`useCallback`/`useEffect` interleaved; the 8
`useEffect` calls are at 319, 570, 575, 576, 1419, 2212, 2242, 2690). Extraction
to custom hooks is safe only if the orchestrator calls each phase unconditionally
in a fixed order and the flattened hook order is unchanged. The cleanup order of
effects (reverse mount order within the component) can change if an effect moves
across another effect: for example the cancellation-registration effect
(570-574), the unmount cancel effect (575), the suppressed-contact effect
(576-595) and the native-listener cleanup (2176-2190) have distinct cleanup
semantics, and the native effect's comment at 2207-2211 explicitly warns that
clearing pointer ownership in a cleanup is wrong. Guardrail: `SEAM_SPEC.md`
records the before/after ordered hook list (type + line) and the effect cleanup
order; the extraction may not add, remove, reorder, or conditionally call a
hook. `apps/desktop/src/main.tsx:128` is `<StrictMode>`, so dev-mode
mount/unmount double-invocation also exercises cleanup idempotence.
### 2. Closure capture and shared-state ownership

Every handler closes over the hook's refs and each other (for example
`cancelCanvasInteraction` calls `stopAutoPan`, `setSnapGuides`,
`closePointerEditorInteraction`, `closeTouchNavigationInteraction`,
`closeKeyboardEditorInteraction` at 484-567). Moving callbacks into phase hooks
requires the orchestrator to own every shared ref/state and pass it down by
parameter; a phase hook that creates its own ref for the same concept creates a
second instance and a silent behavior split. The external-vs-internal fallbacks
(`snapSessionForPointer = externalSnapSessionRef ?? internalSnapSessionRef`
597-604) must stay in one owner. Guardrail: ownership table in `SEAM_SPEC.md`
(one owner per ref, one construction site per session), no module-level state,
no React context copying, and the exact same values passed to handlers.
### 3. `useCallback`/effect dependency arrays and handler identity

18 `useCallback` declarations carry hand-maintained dependency arrays; the big
native-listener effect lists 13 dependencies (2191-2205) and comments that it is
allowed to rebind but its cleanup must not clear pointer ownership. Any extraction
that re-wraps a prop (for example `buildToolCtx` is deliberately stabilized via
`buildToolCtxRef` at 293-299), forwards a new arrow function, or drops a member
from a deps array changes when the effect rebinds, when listeners are
re-registered, and whether handlers see stale state. `tsc` cannot catch a stale
closure; the repo has no exhaustive-deps lint proof (biome is format/import
oriented). Guardrail: each callback moves with its exact deps array and the
B-09 precedent ("apply wrapper whose deps array and param shape are byte-identical",
`BACKLOG_LEDGER.md` B-09 row) is the model; deviations are a STOP condition.
### 4. Module-evaluation side effects in destination modules

The target imports modules that own module-level runtime singletons
(`interactionSession`, navigation settings, performance tracing, snap session
factory) and calls them at interaction time. New destination modules must be
declaration hosts only: importing them must not construct a session, register a
listener, read `navigator`/DOM, or call any runtime getter at evaluation time.
The only module-scope constant allowed to move is the `NON_TEXT_INPUT_TYPES` Set
(86-96), which must keep one definition. Guardrail: grep for module-scope
`let`/constructor calls in `canvas/input/`; review import blocks; the destination
modules must be loadable in isolation without DOM.
### 5. Monomorphic per-tool dispatch preservation

The pointer/keyboard path must keep one dispatch site per phase with direct
`tmInst.handlePointerDown/Move/Up/Cancel`, `handleKeyDown/Up`, and
`handleDoubleClick` calls (5 `dispatchToTool` sites, 13 handler call sites,
measured above). A lookup table keyed by tool id, a wrapper-per-tool, an added
switch, or splitting the dispatch across phase modules so that a move event
performs two lookups would be a hot-path change. The policy text is explicit:
keep the dispatch in one monomorphic `switch` and do not replace it with a
dispatch table (`docs/quality/file-size-policy.md:90-100`; the repo rule in
`AGENTS.md:84`). Guardrail: only the orchestrator calls the tool manager for
pointer/keyboard events; the diff may not introduce any new dispatch table,
`Record<K, V>` lookup, or per-tool function registry in the hot path; the
benchmark/proxy numbers (below) plus the diff review are the evidence.
### 6. Test coverage weakness of the covering spec

The only spec that imports the module exercises 5 pure helpers, not the hook:
11 tests / 120 lines, all handler-free (lines 2-8 imports; no render, no pointer
event). Indirect `CanvasArea` jsdom tests mount the component but dispatch no
pointer events. Therefore a hook sub-split can pass the entire unit gate while
breaking pointer admission, gesture transitions, listener lifetime, or dispatch.
The honest evidence chain is: `refactor-verify` 15/15 (presence), recursive
`tsc` (types), unchanged 11/11 direct tests (pure helpers only), unchanged
indirect mount tests (render/effect registration only), the prompt 02 source
review checks above, and - only if the Lead overrides prompt 04 - the browser
pointer E2E subset. `SEAM_SPEC.md` must state this limitation verbatim; it must
not claim the hook is covered by tests.
### 7. What the split shape must record (prompt 02 decisions)

One destination directory (`packages/editor/src/canvas/input/`) is one seam. The
executor decides the module map; these are the constraints it must satisfy:
parent keeps `export function useCanvasInputs` and explicit named re-exports for
the 5 test-imported helpers plus the two exported types; every destination module
<=400 lines; one owner per ref; hook call order and cleanup order unchanged;
shared values passed as parameters (not context/singletons); per-tool dispatch in
one orchestrator site; no behavior edits; no test edit; one baseline removal.

## Benchmark harness inventory and Batch C gate decision input

Batch C requires a before/after benchmark of the pointer/per-node path at
100/1k/10k/50k (or the pointer equivalent) while keeping dispatch monomorphic
(`docs/plans/agent-infrastructure-campaign-2026-10-28.md:146-149`;
`docs/quality/file-size-policy.md:90-100`). No harness imports
`inputPipeline.ts` (the reference grep found only `CanvasArea.tsx` and the
covering test), so no existing benchmark measures the code this seam moves. The
measured inventory:

| Harness | What it measures | Scale | Baseline/gate | Comparable for C-02? |
|---------|------------------|-------|---------------|----------------------|
| `packages/editor/src/canvas/__benchmarks__/renderPath.bench.ts` | `replayIr`/render path in jsdom: full frame, incremental (1% dirty), pan/zoom, TTFP, allocation; control loop (240-256); writes `.render-perf-results.json` | `TIERS = [100, 1_000, 10_000, 50_000]` (line 222) | `node scripts/audit-render-perf.mjs --ci` gates ratios vs `.render-perf-baseline.json` (version 2026-07-26; HEADROOM 1.5, script line 32) | Only the tier/gate mechanism matches. It does not load the input hook, so it cannot detect a C-02 regression; a "pass" here would be a false gate. |
| `packages/editor/src/tools/__benchmarks__/move.bench.ts` | `snapPosition` on N candidate bounds: the pointer-move snapping path downstream of tool dispatch | `[100, 1000, 5000]` candidates (line 20) | none (informational vitest bench) | Closest pointer-path harness: pointer-drag adjacent, but it measures `snapping.ts`, not the hook, and stops at 5k (no 10k/50k). |
| `packages/editor/src/tools/__benchmarks__/inputNormalizer.bench.ts` | Input normalization (`canonicalizeInputEvents`) vs an as-was control | `[64, 256, 1024]` samples (line 56) | none (bench comparison control) | Input-event adjacent microbench, ~2 orders below the required tiers. |
| `packages/editor/src/canvas/__benchmarks__/hashLoop.bench.ts` | Per-frame content-hash loop (jsdom), informational timings | no fixed tiers | one deterministic O(1)-in-image-bytes assertion | Not pointer/input. |
| `packages/editor/src/canvas/__benchmarks__/rasterIrCost.bench.ts` | Tile conversion/estimate cost for raster IR | tiles `[4, 16, 64, 200]` (line 75) | none | Not pointer/input. |
| `packages/editor/src/canvas/__benchmarks__/`, `packages/engine/src/bench/` family (30 `*.bench.ts` repo-wide per `glob **/*.bench.ts`) | render/replay/history/spatial/geometry families | varies | only renderPath has the ratio gate | none exercise the moved hook |

Decision input for prompt 02 (the executor/Lead decides; this phase adds no
harness):

- The closest comparable **pointer-path** pre/post gate is
  `packages/editor/src/tools/__benchmarks__/move.bench.ts` (100/1000/5000
  candidates, pointer-move snapping) with
  `packages/editor/src/tools/__benchmarks__/inputNormalizer.bench.ts`
  (64/256/1024 samples) as a secondary input-event proxy. Both are informational:
  no committed baseline, no `--ci` gate; record identical command output before
  and after and report p50 numbers side by side.
- `renderPath.bench.ts` is the only harness that matches the mandated
  100/1k/10k/50k tiers and the only ratio gate, but it exercises the replay path,
  not the input hook; running it before/after cannot prove anything about C-02
  and must not be presented as the C-02 gate. It can be used only as a
  "collateral render path unchanged" check if the Lead wants one, with the caveat
  that the seam does not touch that path.
- The exact 100/1k/10k/50k pointer tier does not exist and cannot be added in
  this phase ("do not add benchmark features"). If the Lead insists on it,
  prompt 02 needs an explicit, scoped exception to add one benchmark file (and
  its baseline), which is a decision outside this document; the monomorphic
  requirement is additionally protected by review invariants (one dispatch site,
  direct calls, no table), which no microbenchmark can verify by itself.
- Note the tier vocabulary already exists in the input dispatch instrumentation:
  `documentComplexityBucket` buckets at 100/1,000/10,000/50,000 nodes
  (`packages/editor/src/performance/dispatchSpan.ts:29-35`), and the hook samples
  it once per gesture (806-808). That is document size, not pointer-event count;
  an "input price at 100/1k/10k/50k nodes" proxy would need a harness that exists
  nowhere today, which is why the decision belongs to prompt 02.

## B. Reference-tool and failure-mode analysis

Codemod/batch-refactoring tools fail at: silent skips (a declaration not matched
by the pattern), false-success reporting (exit 0 while code was dropped),
post-edit type failures (broken imports/type-only edges), and review blindness
from a large uniform changeset. This repository's machinery already prevents the
known classes for a declaration move: `godsplit-plan` supplies AST-derived
ranges and hazards (15 blocks, 30 imports, the 2,449-line sub-split hazard);
`refactor-verify` proves every base declaration and exported name survives in
target + destination (15/15 now); the recursive TypeScript program proves the move
compiles under `verbatimModuleSyntax`; the unchanged covering test (11/11) and the
untouched test file prove the pure-helper behavior; `audit-file-size --update`
plus `--report` prove the ratchet moved and nothing new froze;
`pnpm verify:commit` judges staged content; and the B-09/B-10/B-11/C-01
precedents show the shape (a thin parent plus destination modules, hook order kept,
deps arrays byte-identical, a 34/34 covering set, a 20-module engine split with the
render benchmark untouched).

What remains untested or unknown for C-02, and therefore becomes explicit
`SEAM_SPEC.md` checks and STOP conditions:

- Hook-call order and cleanup order after the sub-split (no test observes it;
  StrictMode double-invoke only partially exercises it).
- Handler-level pointer behavior: the direct spec covers 5 pure helpers only and
  the indirect jsdom tests dispatch no pointer events, so admission/gesture/
  dispatch semantics have no unit proof. The browser pointer E2E lane is the
  real-world evidence, but it is not required for a pure move by prompt 04 and is
  blocked in this worktree (see GAP_ANALYSIS section D).
- Effect rebind frequency and listener duplication: a moved effect that rebinds
  more often re-registers listeners and can double-handle events; only line-level
  equality of deps arrays plus E2E would catch it.
- Per-event dispatch cost: no harness measures the hook; proxies
  (`move.bench.ts`, `inputNormalizer.bench.ts`) are informational only, and
  jsdom benchmarks cannot measure real browser event latency.
- Module-evaluation purity of destination modules (no singleton/import-time
  side effect): review/greps only; a duplicate runtime singleton would only show
  as memory/behavior drift.
- The covering spec itself never imports `useCanvasInputs`; the recommended
  (cheap) extra jsdom evidence is the three `CanvasArea` mount tests, not new
  tests.

## Failure modes -> guardrails

| Failure mode | Evidence in this repository | Guardrail command or review check | Owner prompt file |
|---|---|---|---|
| Silent skip / dropped declaration | planner reports 15 blocks; verifier design compares base declarations to target+dest | `refactor-verify --base master --target packages/editor/src/canvas/inputPipeline.ts --dest packages/editor/src/canvas/input --json` exit 0, `missing: []`, `missingExports: []` before tests | 02 Step 3 |
| Export lost or hidden behind a wildcard | verifier does not resolve `export *` (`refactor-verify.mjs:24-26`); covering test imports 5 helpers from the parent path | explicit named re-exports in `inputPipeline.ts` for `useCanvasInputs`, the 5 tested helpers and the 2 exported types; `missingExports: []`; `CanvasArea.tsx:42` import unchanged | 01 A.5/A.7, 02 Step 1/3 |
| Post-edit type failure | `verbatimModuleSyntax`; `useImportType: error`; 30 import declarations split across modules and rebased | direct recursive `tsc` substitute (22 projects: 20 package tsconfigs + desktop + e2e) exit 0, 0 diagnostics; editor tsc exit 0 | 02 Step 4 |
| Hook-order / cleanup-order violation | 62 hook calls (36 useRef/18 useCallback/8 useEffect) in fixed order; 8 effects with distinct cleanups; StrictMode in `apps/desktop/src/main.tsx:128` | ordered hook list before/after in `SEAM_SPEC.md`; no added/removed/reordered/conditional hook; cleanup order reviewed | 01 A.1 (hook split), 02 Step 1 |
| Duplicated state or ref instance | no module-scope mutable state today; 19 refs are per-instance | ownership table + grep for module-scope `let`/construction in `canvas/input/`; no new singleton; no React context | 01 A.1, 02 Step 1 |
| Stale closure / changed dependency array | 18 `useCallback` deps arrays; native effect 13 deps (2191-2205); `buildToolCtx` stabilized by ref (293-299) | move each callback with its exact deps array and parameter shape (B-09 precedent); diff review | 01 A.1, 02 Step 2 |
| Duplicated or dropped DOM listeners | 16 `addEventListener` sites across 8 effects; native effect explicitly must not clear pointer ownership in cleanup (2207-2211) | before/after count and order of add/remove listener sites; each listener registered exactly once; cleanup reviewed; E2E only if gate fires | 01 A.1, 02 Step 2 |
| Per-tool dispatch de-optimized | 5 `dispatchToTool` sites + 13 direct tool-manager calls; only switch is `keyboardPanDelta` 2738; policy forbids dispatch tables | diff review: one dispatch site per phase, direct calls, no lookup table/switch added; benchmark proxies before/after (informational) | 01 A (Batch C), 02 Steps 4/8 |
| Render/input behavior drift in an untested area | covering spec = 5 pure helpers / 11 tests, no hook import; CanvasArea mount tests dispatch no pointer events | unchanged 11/11 and unchanged mount tests; `SEAM_SPEC.md` states the coverage limit; browser pointer lane only if Lead overrides prompt 04 | 01 A.6, 02 Step 4, 04 |
| Hot-path performance regression | no inputPipeline harness exists; closest proxies `move.bench.ts` and `inputNormalizer.bench.ts`; renderPath gate is replay-only | record proxy numbers before/after; keep dispatch monomorphic; do not present renderPath as the C-02 gate | 01 A (Batch C), 02 Steps 4/8 |
| String/template corruption | 23 template-light lines / 7 `${...}` lines; no JSX | declaration/AST-boundary cuts only; partition proof of moved ranges; biome format-only | 02 Step 2 |
| Import rebase / format drift | 30 imports; destination one level deeper; no side-effect imports | biome `check --write` then `check`; tsc; import diff review | 02 Step 4 |
| Baseline drift / wrong ratchet | 943 frozen, 0 stale; target line 120; `--update` conservative | `--update`; baseline diff = exactly one removal, 0 added/grown; `audit:filesize` exit 0 at 942; `--force` forbidden | 02 Step 5 |
| Shared-surface corruption | baseline/map/ledger/docs are single-writer; main checkout 31 dirty entries | stage seam, regenerate map from staged tree, `pnpm verify:commit`; one writer per worktree; claims advisory/blocked | 02 Step 6, 01 A.10 |
| Stale handoff numbers / moving master | master `a3796c0ba` not containing B-11/C-01; C-01 branch owned elsewhere; previous sessions moved master | re-measure every count on the committed branch worktree at handoff; never copy handoff numbers | 02 Step 10, 01 A.10 |
| Row 9 E2E expectation vs prompt 04 | row 9 line 41 says pointer semantics need canvas E2E after each seam; prompt 04 excludes browser lanes for pure moves; worktree webServer cannot start | gate analysis in `GAP_ANALYSIS.md` section D; default no E2E; escalation path recorded | 01 D, 03, 04 |
| Guard-script coupling forgotten | target not in `audit-health` lists; `CanvasArea.tsx` hub is 38/38 imports (cap) and 1640 lines; editor cycle allowlist has 1 identity | keep CanvasArea import/line neutral; `node scripts/audit-health.mjs` exit 0; `audit-architecture.mjs --ci` cycle identity set unchanged | 01 A.13 (guards), 02 Step 4 |
| Pixel truth not covered by units | jsdom does not rasterize; only Playwright paints | pure-move exception: no visual baseline update; any pixel suspicion escalates instead of updating | 04 |

## C. Edge-case and gap register

| Edge case | Applies? | Decision / evidence | Guardrail |
|---|---|---|---|
| Module-eval side effects (state singletons, listeners, DOM reads) | applies | No module-scope mutable state today; the only movable module-scope binding is the `NON_TEXT_INPUT_TYPES` Set (86-96); runtime getters are call-time (645, 669, 856, 1550) and must stay so (A.1) | review each destination module: declarations only; grep module-scope `let`/constructors; no import-time DOM |
| tsconfig boundaries / package entry points | applies (no change) | Destination inside `packages/editor/src`; `rootDir ./src`, `include ["src", ...]`; package exports `.`, `./auxiliary`, `./editor.css` unchanged (A.2) | editor tsc + direct recursive tsc; no tsconfig/package edit |
| Path aliases and import ordering | applies | 30 imports split by owner and rebased one level; no side-effect imports; biome may sort/format only (A.3) | biome check; tsc; import diff review |
| Template-literal / code-like text | applies | 23 lines with template literals, 7 with `${...}`; no JSX (A.4) | declaration-boundary cuts; partition proof; biome format-only |
| Overloaded / method identity across modules | applies (no overloads; identity) | `useCanvasInputs` stays exported from `./canvas/inputPipeline`; 5 tested helpers and 2 types re-exported by name; 10-field result contract unchanged (A.5) | `refactor-verify` `missingExports: []`; CanvasArea call site 1061-1080 unchanged |
| Same-named private helpers in sibling modules | applies | 7 private helpers have one home each; two `onPointerLeave` declarations exist in different scopes (1920, 2667) and must not be merged (A.6) | inventory; duplicate-definition grep under `canvas/input/` |
| Dropped declaration | applies | 15 planner blocks (8 exported + 7 private) (A.7) | `refactor-verify --dest` exit 0 before tests |
| Parse failure in target or destination | applies | planner parses 15 blocks; tsc/biome parse new modules | planner exit 0; tsc/biome exit 0 |
| Tracked-vs-untracked baseline policy | applies | new modules are WIP until staged, never frozen; parent must end <=400 (A.8) | `audit-file-size --staged` at `verify:commit` |
| Stale / grandfathered / slack-band baseline entry | applies | checkpoint 943 frozen / 0 stale; exactly the target entry leaves; expected 943 -> 942 (A.9) | baseline diff review: one removal, 0 added, 0 grown |
| Baseline regeneration refusing to add or raise | expected not to fire | every destination module <=400; tree has 0 other stale entries | stop before commit if `--update` adds/grows |
| Test-file exemption from the ratchet | applies (no test edit) | covering test is 120 lines and stays byte-identical; no snapshot updates | `git diff --stat` shows no test path |
| Generated files and exclusions | does not apply to vendor/generated data; applies to the repo map | `vendor/**` and the 3 generated data tables are untouched; adding `canvas/input/` modules churns `docs/agents/repo-map.generated.md`, which is regenerated from the staged tree (never hand-edited) | `pnpm agent:map` / `generate-agent-map.mjs --staged` at prompt 02 Step 6 |
| Concurrent worktree conflict on peer-hot files | applies | one writer in `.worktrees/C-02`; main checkout dirty (31) and concurrently used; claims runtime ENOENT /run/user/1000 (advisory only) (A.10) | `git worktree list`; staged validators; regenerate, never hand-merge |
| Rollback path | applies | seam uncommitted until prompt 02 Step 8; discard only target/restore + `rm -rf canvas/input`; branch at `2bf4871e7` (A.11) | stop before commit if ratchet cannot go down or a module is over cap |
| Unknown/unresolved tools | does not apply | planner and verifier exist and were exercised (`--top` unsupported, `--json` works; verifier TS/JS only, wildcards unresolved) | pre-flight smoke in `SEAM_SPEC.md`; use no-flag planner or `--json` |
| Hook-order and cleanup-order invariance | applies | 62 hook calls (36 useRef/18 useCallback/8 useEffect) in fixed order, 8 effects; cleanup order observable; StrictMode dev double-invoke (sub-split section 1) | ordered hook list + effect cleanup order in `SEAM_SPEC.md`; no add/remove/reorder/conditional hook |
| Closure capture and shared ref ownership | applies | handlers close over shared refs/callbacks; external/internal snap fallbacks 597-604 (section 2) | ownership table; pass values as parameters; no duplicate refs |
| `useCallback` / effect dependency arrays | applies | 18 dep arrays; native effect 13 deps (2191-2205); stabilized `buildToolCtx` (293-299) (section 3) | byte-identical deps/param shape; diff review |
| Duplicated or dropped listeners/effects | applies | 16 `addEventListener` sites in 8 effects; native cleanup must not clear pointer ownership (2207-2211) (section 1) | count/order listener sites; exactly one registration each |
| Per-tool dispatch stays monomorphic | applies | 5 `dispatchToTool` sites + 13 direct tool-manager calls; per-tool dispatch is ToolManager.ts:238-315; only switch is `keyboardPanDelta` 2738 (section 5) | one dispatch site per phase; no table/switch; diff review |
| StrictMode effect double-invocation | applies | `apps/desktop/src/main.tsx:128` wraps the app in `StrictMode`; effects mount/cleanup/mount in dev | cleanups idempotent; review cleanup behavior |
| External props vs internal fallbacks | applies | `snapSessionRef`/`snapIndexRef` are optional externals with internal fallbacks (597-604); `viewportAnchorRef` optional (612-619); `canvasFocusedRef` optional | orchestrator owns fallbacks once; no phase-local defaults |
| `buildToolCtx` stabilization and `editor` prop identity | applies | prop stored in `buildToolCtxRef` and exposed via empty-deps `useCallback` (293-299); effects list `editor.registerCanvasInteractionCancellation` (570-574) | pass the same stable wrapper/member identities; do not re-wrap props |
| `createSnapSession()` in `useRef` initializer | applies | evaluated every render then discarded by `useRef` (597); existing behavior, not a defect to change in a pure move | keep the same expression at the same call position |
| `interactionSession` global reset / tracing spans | applies | `interactionSession.reset()` at 550; `beginInteraction`/`endInteractionIfKind`/`markInteractionCanvasChanged` calls throughout | keep call order relative to tool dispatch and camera commits |
| Per-render read of `stateRef.current.activeId` | applies | `interactionSessionId` read at render (569) drives the cancellation-registration effect deps | keep the render-time read and deps exactly |
| Real browser pointer/pixel behavior | unknown / not covered by units | jsdom does not dispatch real pointer events or rasterize; Playwright pointer specs exist (221 canvas specs) but the browser lane is not part of a pure move and is blocked in this worktree (GAP_ANALYSIS D) | escalation only if Lead overrides prompt 04; never update a visual baseline |
| Front-end / visual surface | does not fire | no DOM/class/props/style/API/error/empty/loading change; hook result/options contracts unchanged; CanvasArea JSX unchanged (D below) | prompt 03 not triggered; prompt 04 statement in `SEAM_SPEC.md` |
| Rust / IPC | does not apply | no Rust file or `#[tauri::command]` change | `cargo`/`audit:ipc` out of scope |
| Docs index | not applicable | only `remediation/C-02/*` is added, outside `docs/`; no `docs/README.md` row required | `pnpm audit:docs` stays green; no docs edit |

## D. Front-end necessity gate (prompt 01 section D)

Verdict: **not triggered; no front-end work.**

1. Does it change anything an operator sees or does in a remediation workbench?
   No. There is no remediation workbench; the queue is
   `.file-size-baseline.json` plus `BACKLOG_LEDGER.md` plus command output
   (prompt 03). C-02 is an internal refactor of canvas input handlers.
2. Does it change an API response shape consumed by the UI? No. There is no
   IPC/command change; the hook's `UseCanvasInputsOptions` (18 fields) and
   `UseCanvasInputsResult` (10 fields) contracts and the same module path are
   preserved, and `CanvasArea.tsx` continues to call the hook at 1061-1080 and
   attach the same 8 handlers at 1519-1526.
3. Does it change error, empty, loading, or permission states? No. Code moves
   verbatim; pointer admission, cancellation, and fallback paths are behavior,
   and any change is a defect, not a feature.
4. Does it make the 943-entry queue harder to understand? No. One entry leaves
   (943 -> 942) and one ledger row is added.

Visual statement for `SEAM_SPEC.md`: **No visual surface changed.** Proof: the
unchanged covering spec passes 11/11 before and after (1 file, 0 failed;
`./node_modules/.bin/vitest run packages/editor/src/canvas/inputPipeline.test.ts
--reporter=dot`), no DOM/JSX/class/props/style/API change exists in the diff, and
no visual baseline is updated. Prompt 04 licenses this for a pure code move.

## Prompt 03/04 gate analysis and pointer E2E coverage (input for GAP_ANALYSIS section D)

- **Prompt 03 trigger questions**: rendered surface/contract changed? No.
  API/IPC shape consumed by the UI changed? No. Error/empty/loading/permission
  state changed? No. Only internal module boundaries/exports changed. Gate:
  **not triggered** (03 lines 12-41 and 77-86).
- **Prompt 04 required?** No: no engine replay output, no design-surface
  appearance, no API/error/empty/loading/permission state, no admitted UI
  surface changes; the pure-move exception applies (04 lines 22-32). The
  closeout statement above replaces a `VISUAL_VALIDATION.md`; no Playwright
  lane, no baseline update, no screenshot.
- **Row 9's E2E note**: `docs/quality/agent-context-remediation-2026-10-28.md:41`
  says "Pointer semantics need canvas E2E coverage after each seam". This is a
  backlog risk note, not a prompt-04 trigger. The tension is real because the
  unit gate cannot exercise the hook handlers (see the coverage-weakness
  analysis); the honest resolution is a separate bounded follow-up, not an
  unplanned browser lane inside a pure-move seam.
- **E2E capability measured in this worktree**: `playwright.config.ts:242-250`
  starts its own dev server with `command: viteServerCommand` (line 11-14:
  `pnpm --filter @varve/desktop exec vite --port ... --strictPort`),
  `url` = `http://localhost:${VARVE_E2E_PORT}`, `reuseExistingServer: false`,
  `timeout: 120000`; `tests/e2e/global-setup.ts:3-13` documents a 90-100 s cold
  transform warm-up. Measured: `pnpm --filter @varve/desktop exec vite --version`
  exits 1 with `ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH` ("Refusing to use task run
  state directory ... node_modules because it is a symbolic link") because this
  worktree has 21 `node_modules` symlinks to the main checkout - so the
  Playwright `webServer` cannot start here. The heavy lease's lock directory is
  `$XDG_RUNTIME_DIR|/tmp/varve-leases` (`scripts/quality/heavy-lease.mjs:180,197`);
  `XDG_RUNTIME_DIR=/run/user/1000` is not writable (`EROFS`, measured), so the
  lease cannot be acquired without overriding `XDG_RUNTIME_DIR` or using the
  `VARVE_HEAVY_TASK_PARALLELISM=0` bypass, which writes no receipt and is not
  default evidence. Playwright 1.62.1 and Chromium builds are installed
  (`./node_modules/.bin/playwright --version`; `~/.cache/ms-playwright` has
  chromium-* builds), so browser binaries are not the blocker. The validation
  queue is also EROFS (`/run/user/1000/varve-validation-queue/exclusive.lock`,
  measured via `pnpm check:agent` attempt).
- **Recommendation (confirmed in GAP_ANALYSIS section D)**: do not run Playwright
  for C-02. If the Lead overrides prompt 04 for the hook sub-split, the smallest
  meaningful pointer-regression slice is
  `tests/e2e/canvas/pointer-release-over-inspector.spec.ts` (45 lines, 1 test) +
  `middle-button-pan.spec.ts` (201 lines, 3 tests) +
  `input-navigation.spec.ts` (422 lines, 11 tests) +
  `gesture-contract.spec.ts` (61 lines, 3 tests) = 18 tests, one
  `--workers=1` invocation under the heavy lease, in a checkout with a real
  (non-symlinked) `node_modules` and a writable `XDG_RUNTIME_DIR`; not in this
  worktree as configured.

## Remaining risks and STOP conditions

1. Any change to hook call order, effect order, or cleanup order. STOP: restore
   the exact 45-call order and record the ordered list in `SEAM_SPEC.md`.
2. Any duplicated ref/state instance, module-scope mutable state, or per-phase
   fallback that duplicates the orchestrator's. STOP: one owner per ref/session.
3. Any per-tool dispatch table, added hot-path switch, or a move/click path that
   performs two dispatch lookups. STOP: restore one direct dispatch site per
   phase.
4. Any changed `useCallback` dependency array or re-wrapped prop identity. STOP:
   restore the byte-identical deps/param shape.
5. Any declaration missing from the verifier, any lost exported name, any
   renamed declaration, or any test edit. STOP; never edit the verifier or weaken
   a spec.
6. Any destination module over 400 lines or any baseline growth/added entry, or
   any stale entry other than the target. STOP before commit; `--update --force`
   is not an option.
7. Any change to `CanvasArea.tsx` imports/lines beyond the existing call site,
   any new editor architecture cycle identity, or `audit-health` failure. STOP
   and report.
8. Any claim that local master contains B-11 or C-01, or any stale handoff
   number reused instead of re-measured. STOP and re-measure on the committed
   branch worktree.
9. Any use of `renderPath.bench.ts` as the C-02 benchmark gate, or any new
   benchmark harness added in this seam. STOP and report the measurement gap
   instead.
10. Any browser pointer E2E work inside this seam without an explicit Lead
    override of prompt 04 and a working heavy-lease/webServer path. STOP.

## What prompt 02 must decide (executor review)

1. The destination module map under `packages/editor/src/canvas/input/` and the
   ownership table for every ref/callback/session (Lead's `SEAM_SPEC.md`).
2. The exact hook-call order and effect cleanup order, recorded before and after.
3. The parent's explicit named re-export list and the parent's <=400-line target.
4. Whether the Batch C benchmark gate is satisfied by the informational
   `move.bench.ts`/`inputNormalizer.bench.ts` comparison with the monomorphic
   review invariant, or escalates to the Lead for a scoped one-off benchmark
   exception (this phase does not add one).
5. The prompt 03/04 answers and the E2E recommendation from `GAP_ANALYSIS.md`
   section D.
6. The environment substitutions it will use (direct `node`/`tsc`/`vitest`,
   staged `verify:commit` substitute) and which gates it cannot run here.
