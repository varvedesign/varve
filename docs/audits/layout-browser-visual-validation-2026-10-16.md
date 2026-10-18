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
