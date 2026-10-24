# Shell continuity repair review — 2026-10-23

Scope: the approved Layers-first follow-up and four independently identified
continuity failures on frozen depth snapshot
`f519bcf1fd264ce2f2805fec3df7c0fe7c703dd9`. Repair branch starts from that
snapshot and includes fixture commit `a6449aa5c`. The original worktree,
untracked evidence archive and unfinished roadmap are retained.

## Confirmed defects and responsible boundaries

| Failure reproduced | Repair | Regression evidence |
| --- | --- | --- |
| Home hid mounted virtual rows; zero-height measurements shrank the spacer from 888px to 333px and resumed at 161px instead of 716px | `LayersTree` uses `measureLayerRow`: keep a cached positive size by node identity, or the density estimate for an unmeasured row | Three unit regressions failed with default measurement and pass with the helper; real Home/resume now retains selection, scroll and zoom |
| Pointer-leave dismissal removed a keyboard-focused submenu without returning focus | Shared `Menu` hands owned focus to its surviving parent item before removal | Keyboard entry followed by pointer leave failed at parent-focus assertion before repair and now passes |
| Dismissing a keyboard canvas menu lost the canvas-wide focus indicator | `canvasFocusRing` retains keyboard origin through transient overlays | Red/green unit plus browser dismissal and pointer-origin neighboring checks |
| Ancestor breadcrumb actions were clipped in the narrow status row | `SelectionInfoBar` retains actionable minimum widths while informational content yields | Real pointer hit-testing at 900px passes |
| Home and editor diagnostics disagreed after same-window preference writes | `subscribeSettings` notifies mounted consumers; section updates read current persisted state | Both directions fail before repair and pass afterward; two unit regressions also demonstrate the defect |

Settings synchronization covers canonical writes in the same window. It is not
a claim of cross-process or arbitrary direct-localStorage synchronization.

## Layers-first rendering

The user approved retaining both rails, prioritizing tree height/name capacity,
and disclosing secondary controls. The Canvases metadata and inactive presets
are compact/disclosed; canvas actions focus a surviving invoker before opening
Rename or Remove. Cancellation preserves the canvas name and returns focus.
Rules are in [Layers panel specification](../design-system/layers-panel-spec.md).

All six 900/1440px light/dark/high-contrast captures were inspected. The 900x600
tree shows roughly five rows above the bottom bar and a fully visible selected
final row. Assertions require at least 160px of tree and 48px of name space;
the exact measured values were not persisted. Names still ellipsize at 900px.
At 1440x900, Rectangle 12-style labels fit and roughly twelve rows are visible.
Expanding the already-scrolled viewport leaves the final row partially visible
at the scroll boundary. Automatic full-row reveal after resize is not verified.

These images precede Clear workbench: Home remains mark-only, and narrow status
tuning still crowds zoom while Fit yields. They do not certify the later route.

## Agent validation report

- Changed scope: Layers tree/header/filter, PagesPanel canvas actions, shared
  Menu focus, canvas focus ring, selection breadcrumbs, settings subscriptions,
  focused units/browser specs and Layers documentation.
- Plan: local repair plan selected 59 lanes without local escalation. The complete
  committed depth snapshot separately selects a final full-gate obligation
  because it changes token-audit infrastructure. That obligation is open.
- Commands actually run for this checkpoint:
  - `pnpm verify:plan`
  - `pnpm typecheck:e2e`
  - `pnpm --filter @varve/ui typecheck`
  - `pnpm --filter @varve/editor typecheck`
  - `node scripts/quality/heavy-lease.mjs "shell continuity green browser group 1" -- pnpm exec playwright test tests/e2e/workspace/shell-continuity.spec.ts tests/e2e/layers/layers-first-workflow.spec.ts --project=chromium --workers=1 --reporter=list`
  - `node scripts/quality/heavy-lease.mjs "shell continuity green browser group 2" -- pnpm exec playwright test tests/e2e/layers/layers.spec.ts tests/e2e/spec/focus-navigation.spec.ts --grep "Home/End long jump|canvas focus ring appears|a tool shortcut followed by a drag" --project=chromium --workers=1 --reporter=list`
  - `pnpm audit:docs`, `pnpm audit:imports`, `pnpm audit:emoji`, `pnpm audit:tokens`
- Passed: all listed commands, ten browser cases, unchanged source fingerprint.
  Earlier focused evidence contains 84 tests across four continuity files,
  three measurement regressions and 14 PagesPanel units. The previous focused
  browser run retains eleven passing navigator/filter/cancellation cases;
  its failed Home/resume case is recovered by the checkpoint above.
- Remaining selected checks: interrupted wider affected closure, additional
  editor/website coverage, whole-snapshot integration and final certification.
  This is a completed targeted checkpoint, not an aggregate affected-suite pass.
- Skipped as unrelated to these repairs: Rust workspace and native packaging.
  Native/WASM parity is unestablished; browser evidence uses the TS fallback.
- Full suite run: no. Whole-depth escalation remains open.

Exact local commands, original red failures and images are retained under the
common Git directory's `shell-home-evidence/20261023/`: `layers-resume-probe/`,
`depth-independent-review.md`, `shell-continuity-green.{json,log,exit}` and
`layers-rendered-review.md`. Captures are in repair-worktree
`test-results/run-357331-5406/`. The completed checkpoint's fingerprint is
`5c1ab20f65f758d9c4039ee2925afd332e76dbcee0b1d9738ec76af052da16b0`;
the coordinator independently confirmed it before lifting the source freeze.
