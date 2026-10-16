# Agent Validation Report — Live Artwork Systems

Status: in progress. The repeat slice now has camera-aware grid/radial/mirror
handles with 24px targets and keyboard controls, plus Release-to-source and
bounded Expand-copies actions. Grid drag/cancel/undo/redo and source-edit/save/
reopen behavior have been exercised in partial Chromium runs; a radial capture
shows the eight-copy layout and canvas controls. The full updated E2E, including
mirror and release/expand, is queued behind unrelated shared browser/editor
work. The broader artwork-system request remains incomplete.

## Changed scope

- Scene schema 2.34 live grid, radial, and mirror object repeats, shared
  rendering/replay/hit-test/bounds evaluation, Inspector controls, camera-aware
  handles, and bounded release/expand operations.
- Research ledger and ADR-0242 for source ownership and shared evaluation.
- Website feature index, live-repeat preview page, and vector-tool guide.
- Screenshot demo fixtures migrated to schema 2.34.

## Validation plan

The latest `pnpm verify:plan` selected 21 lanes across Tiers 0–4, covering
touched format/lint, audits, editor/website types and units, repeat E2E, and
website E2E. Full-suite escalation was **NO**. `pnpm verify:affected` stopped
at the known 16-entry spacing-audit drift in untouched
`FirstRunOverlay.css` and `DownloadRedirect.astro`; selected checks were run
directly where possible.

## Commands and results

- `pnpm verify:plan` — passed; full-suite escalation NO.
- `VARVE_TEST_WORKERS=1 pnpm verify:affected` — format, lint, emoji, radius,
  docs audit, E2E typecheck, website typecheck, `js-unit:@varve/website`, and
  `website-unit` passed. Each website unit lane passed 19 files / 302 tests.
  The focused browser lane did not execute: its heavy-lease wait expired behind
  the unrelated `presentation motion presenter mode fidelity` run and the
  validator cancelled it (SIGTERM). The browser assertions therefore have no
  result from this attempt. `website-e2e` was not reached.
- Latest `pnpm verify:affected` after release/expand — format,
  lint, emoji, docs, and radius passed; spacing audit failed on the same 16
  unchanged baseline declarations above. The audit suite reached Inspector
  CSS and tokens before that stop; both passed. A focused current-source check
  of repeat expansion and source-local handle bounds passed 2 files / 4 tests.
  `pnpm --filter @varve/editor typecheck` and `pnpm typecheck:e2e` passed.
  The latest `pnpm --filter @varve/website typecheck` was terminated with
  SIGTERM during Astro diagnostics under shared load; an earlier run passed
  before the latest boundary-copy edit. The serial full editor package test emitted one
  106-second timeout in `PropertiesPanel.test.tsx` under shared load and later
  ended with SIGTERM before producing a package summary. Its isolated retry
  passed 30/30, so the package lane is incomplete and the timeout did not
  reproduce. The focused Chromium run passed canvas containment, Escape
  cancellation, grid drag, undo/redo, source edit, save/reopen, and source
  persistence. A later run reached radial mode and showed its handles, but
  its keyboard assertion tried to increment a sweep already at the 360° max;
  the regression now decrements from that boundary. The reopened-source locator
  also had a stale comma expectation and has been corrected. The opened grid
  screenshot is
  `test-results/run-718396-1420/canvas-live-object-repeat--df393-d-repeat-from-the-inspector-chromium/test-failed-1.png`;
  it shows the handle and guide over the source artwork. The radial screenshot
  is `test-results/run-791034-1420/canvas-live-object-repeat--df393-d-repeat-from-the-inspector-chromium/test-failed-1.png`.
  It shows the radial copies, center/sweep controls, and Inspector values. The
  full revised browser run is queued behind the unrelated editor full suite.
- Focused pixel and morph regressions passed: `pnpm exec vitest run
  --maxWorkers=1 packages/engine/src/effects-shadow.test.ts` (12 tests) and
  `pnpm exec vitest run --maxWorkers=1
  packages/editor/src/components/Presentation/show/showEffects.test.ts` (14
  tests). Commit checkpoints also passed for both focused commits.
- Earlier `pnpm verify:affected` attempt: 301/302 website unit tests passed;
  the screenshot-manifest source scan exceeded its 30-second test timeout
  under shared-host contention. The serial retry above passed all 302.
- `UPDATE_DEMO_DOCS=1 pnpm test:website` — passed, 19 files / 302 tests after
  regenerating the demo documents for schema 2.34.
- Focused repeat tests:
  `pnpm exec vitest run --maxWorkers=1 packages/editor/src/components/Inspector/__tests__/featureOwnership.test.ts packages/editor/src/components/Inspector/__tests__/sectionRegistry.test.ts packages/editor/src/hitTest/__tests__/HitTestEngine.test.ts packages/editor/src/render/replayScene.test.ts packages/editor/src/render/sceneCompositing.test.ts packages/scene/src/coordinateService.test.ts packages/scene/src/objectRepeat.test.ts`
  — passed, 7 files / 189 tests.
- Previous grid-repeat browser workflow — passed 1/1 in Chromium with the
  TypeScript Canvas2D fallback; WASM did not load. The visible editor capture
  was opened and inspected at
  [live-object-repeat-grid.png](assets/live-object-repeat-grid.png). It shows
  three evaluated instances, source group selection, and numeric Inspector
  controls. A newer failed-run capture has now verified the updated grid
  handle visually; source edits, save/reopen, radial keyboard, and mirror axis
  controls remain queued for browser validation.
- Website route was opened and inspected in the in-app browser at 390×844 and
  1440×960, in light and dark themes; the default ~786px viewport was also
  inspected. Mobile cards stack, and desktop/tablet cards remain readable.
  The updated release/expand limit copy was visually inspected in dark theme
  at the default narrow/tablet viewport and showed no clipping. Forced-
  colors/high-contrast and an actual 200% browser zoom were not tested.
- `audit:docs` passed (1,142 docs, 818 links, 179 ADRs indexed); commit
  checkpoints passed for commits `ea64f0c25` and `46d62b510`.

## Skipped / unverified

- No Rust workspace or native desktop GUI run; no architecture audit because
  the repeat slice did not change the protected renderer hubs or contexts.
- No native, WebKitGTK, or packaged-app visual qualification.
- A manual in-app browser attempt against the isolated Vite editor preview hit
  the app's `Startup timed out` fallback. The dev server was stopped afterward;
  this is not counted as visual inspection or an application test result.
- No independent SVG, PDF, or raster export inspection for object repeats;
  marketing accurately states that fidelity is not yet qualified.
- No complete browser run of mirror editing, release/expand, or the revised
  sweep-key regression yet; the latest lease is queued behind shared work.
  Grid and radial controls have screenshot evidence. The website Playwright E2E
  and the current website Astro/typecheck lane remain unverified.
- Object blends, genuine gradient-mesh paint, and the remaining envelope/effect
  cross-context regressions are still pending slices.
- No full suite; planner did not escalate.

## Commits

- `f33398acc` — source/evaluation ADR and issue regression ledger
- `91de16a4a` — bounded live repeat recipe
- `c298f4add` — editor evaluation integration
- `efde7f23d`, `38a243b11`, `0441cbb5d` — repeat persistence, bounds, selection,
  and replay regressions
- `829a1dee1` — initial repeat editor/history E2E
- `ea64f0c25` — schema 2.34 demo fixtures
- `46d62b510` — website and vector-tool documentation
- `2276baecb` — outer-glow alpha/choke regression and research-ledger scope note
- `bd0e7da61` — type-safe deterministic presentation morph fallback regression
- `0ac8bfc0e` — outer-glow gradient-stop pixel regression and precise issue-ledger scope

The working branch is `codex/live-artwork-systems`, isolated in the
`live-artwork-systems` worktree from kickoff SHA
`a4c58227081edc3039a688af88539713eb962ea6`. The dirty primary checkout was
preserved. No deploy or publication was performed.
