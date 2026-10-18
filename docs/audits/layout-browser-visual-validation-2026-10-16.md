# Layout browser visual validation — 2026-10-16

## Runtime and scope

- Chromium project, Playwright 1.62.1, integration candidate `39e28a371889379891ec1d8d25e47da95bc36178`.
- The editor loaded the newly generated baseline and SIMD WASM modules from `just wasm-build`; these runs did not log the earlier TypeScript-stub renderer fallback.
- The clean commit at that master tip references `packages/codegen/src/bundle-assets.ts`, which was still untracked in the shared working checkout. For these scratch integration runs only, the untracked `bundle-assets.ts` and `svgTextLayout.ts` sources were copied into the temporary worktree to let Vite compile. They were not added to the feature branch or merge commit.

## Executed workflows

| Command / case | Result | What was inspected |
|---|---|---|
| `node scripts/quality/heavy-lease.mjs "e2e: wrap, fill and undo layout interactions" -- npx playwright test tests/e2e/canvas/autolayout-visual.spec.ts --project=chromium --workers=1 --reporter=list --grep 'wrap enabled\|child fill sizing expands\|undo reverts layout change'` | 3 passed | Wrapped children, Fill width geometry, and one-step undo. |
| `node scripts/quality/heavy-lease.mjs "e2e: layout guides desktop/mobile visual capture" -- npx playwright test tests/e2e/canvas/grid-system.spec.ts --project=chromium --workers=1 --reporter=list` | 2 passed | Independent guide visibility/history; Guide Layouts controls, 390×844 bounds, validation, keyboard focus, Escape cancellation. |
| `node scripts/quality/heavy-lease.mjs "e2e: responsive constraints parent resize" -- npx playwright test tests/e2e/canvas/constraints.spec.ts --project=chromium --workers=1 --reporter=list --grep 'resizing parent frame propagates constraints'` | 1 passed | Stretched child width followed parent resize. |

The screenshots were opened and inspected. The compact dialog remains within 390×844, has two-column margin controls, and preserves reachable Cancel/Apply buttons. The editor view shows visual guides in their own inspector section, separate from the layout solver. Auto-layout screenshots show children wrapping and a Fill child spanning the available row width.

### Follow-up: responsive grid removal preview — 2026-10-18

- Ran `TMPDIR=/home/kevina/.cache/varve-layout-tmp node scripts/quality/heavy-lease.mjs "e2e: grid track removal responsive preview" -- npx playwright test tests/e2e/canvas/grid-system.spec.ts --project=chromium --workers=1 --reporter=list --grep "previews grid track removal"` on `codex/layout-reliability` at `ed1cc260d` plus the uncommitted diagnostic and inspector follow-up. Result: **1 passed**.
- The editor opened the baseline and SIMD WASM artifacts copied into this isolated worktree from the primary checkout; the run output contained no WASM fallback warning. These are generated artifacts and are not tracked by the feature branch.
- The interaction added two tracks, opened the removal preview by keyboard, checked dialog focus, canceled at 390px and verified focus returned to the visible canvas after the inspector hid, then reopened at 1280px and applied removal as one history entry before verifying one undo. It checked dialog bounds and the two-column/one-column preview breakpoint at widths 481, 480, 390, and 1280px.
- Captured frames were inspected at 1280px, 481px, and 390px. The dialog remains inside the viewport, keeps Before/After geometry and both actions visible, and switches to a single preview column at 480px. The browser assertion also confirmed a single column at 390px. Exact rectangles, track definitions, and history outcome are asserted in the E2E test.

### Follow-up: generated responsive grid export — 2026-10-18

- `pnpm verify:plan` selected `format:touched`, `lint:touched`, `audit:emoji`, `typecheck:e2e`, and the single-file Chromium E2E; full-suite escalation was not selected for this test-only addition. `pnpm verify:affected` passed all five lanes.
- `tests/e2e/export/responsive-grid-codegen.spec.ts` builds a small IR fixture, calls the production HTML emitter, embeds the emitted CSS, and renders it in Chromium at 1280×844 and 390×844. Both runs passed. Assertions check the grid width, document width, 1fr/2fr computed track ratio, child order, and right edge.
- Both captures were opened and inspected. The desktop frame shows a broad two-track dashboard with pastel cards; the narrow frame keeps both tracks visible at the 1:2 ratio without horizontal overflow. Captures are retained below.

![Generated responsive grid at 1280px](../screenshots/layout/responsive-grid-codegen-1280-2026-10-18.png)

![Generated responsive grid at 390px](../screenshots/layout/responsive-grid-codegen-390-2026-10-18.png)

![Grid track removal preview at 1280px](../screenshots/layout/grid-track-removal-preview-wide-2026-10-18.png)

![Grid track removal preview at the 481px breakpoint](../screenshots/layout/grid-track-removal-preview-481-2026-10-18.png)

![Grid track removal preview at 390px](../screenshots/layout/grid-track-removal-preview-390-2026-10-18.png)

### Captures

![Wrapped flex children in the editor](../screenshots/layout/autolayout-wrap-2026-10-16.png)

![Fill-sized child in the editor](../screenshots/layout/autolayout-fill-2026-10-16.png)

![Layout guide editor controls](../screenshots/layout/layout-guides-editor-2026-10-16.png)

![Guide Layouts desktop dialog](../screenshots/layout/guide-layout-dialog-desktop-2026-10-16.png)

![Guide Layouts dialog at 390×844](../screenshots/layout/guide-layout-dialog-mobile-2026-10-16.png)

## Limits

These browser checks cover a subset of the requested eight-document corpus. Generated grid CSS was rendered from an isolated IR fixture at two widths; full application exports and breakpoint-specific output remain unverified. The runs also do not cover native Tauri GUI capture, track-handle pointer previews, imported-component first edit, typography/resource loading, collaborative pressure, rotated snapping, or edit-to-correct-frame latency. Those remain unverified.

### Integration-candidate gate follow-up — 2026-10-18

- On `codex/layout-master-integration`, `pnpm verify:plan` initially escalated the 59-path integration to `pnpm verify:full --local` for workspace, schema, and validation-infrastructure changes. The first gate run exposed a validation harness defect: a temporary Git fixture wrote receipts under the invoking checkout instead of its own Git directory. `commonGitDirectory` now creates its default adapter from the requested `cwd`; `node scripts/quality/full-gate.test.mjs` and `node scripts/quality/operation-history.test.mjs` passed afterward.
- The restarted full gate passed format/lint, emoji, health, architecture, workspace and E2E typechecks, CI tooling tests, and the baseline, SIMD, and color WASM builds. The architecture audit reported 14 cycles (below the enforced ceiling of 17) and zero layer violations; reported-only instability, unused-export, complexity, and hub-budget debt remains.
- The full JavaScript suite completed with **22,918 passed, 17 skipped, 3 failed**. Two failures were corrected on the integration candidate: the six direct screenshot paths in `vertical-text-orientation.spec.ts` and `visual-compositing.spec.ts` now use the isolated per-test evidence path, and `presentation.varve` was regenerated from its unchanged source generator. The capture-policy regression test passed (8/8), and the website suite passed (302 tests). The remaining observed failure is an existing timing threshold in `videoExportBridge.test.ts` (445.4 ms measured against a 343.7 ms limit under concurrent machine load). The full gate has not been rerun after these repairs, so the later full-gate lanes remain unverified.
- On the isolated candidate, `pnpm verify:plan` / `pnpm verify:affected` also selected `audit:radius`, which reports ten legacy radius consumers in untouched CSS. Candidate desktop typecheck passed directly after matching the existing collaboration helper's transform type to the scene's readonly tuple. No unrelated CSS or screenshot fixtures were changed.
- Chromium E2E captures in this report were opened and inspected, including the generated responsive HTML/CSS at 1280×844 and 390×844. The new E2E test asserts viewport fit and the 1fr/2fr track ratio. **Native Tauri GUI validation, the broader document corpus, packaged edit-to-correct-frame performance, and full application code export remain unverified.** No publish or deploy was performed.

### Solver review follow-up — 2026-10-18

- Manual review found that auto-height text was not remeasured after flex Fill/shrink width allocation or after grid columns resolved. Focused regressions and fixes are in progress on `codex/layout-reliability`; they are not part of this integration candidate yet.
- For those four changed layout files, `pnpm verify:plan` selected the two layout test files, layout/editor/import/desktop typechecks, and the associated package unit lanes; it did not escalate to the full suite. `pnpm verify:affected` passed formatting, lint, emoji audit, and layout typecheck, then stopped at the editor typecheck on the existing `packages/editor/src/components/Presentation/show/morphMatch.ts:165` cast from `number[]` to `Affine`. The layout package typecheck passed, but the focused solver tests did not run because the shared heavy-task lease was occupied by a live editor unit-test process. The standalone layout typecheck passed before running the affected plan. No change was made to the unrelated presentation cast.
- The additional `vertical-text-orientation.spec.ts` Playwright rerun also remained queued behind that live editor unit-test lease; the earlier E2E results are the only browser results claimed. No native Tauri run or app shutdown was attempted.
