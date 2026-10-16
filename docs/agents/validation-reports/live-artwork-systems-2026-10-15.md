# Agent Validation Report — Live Artwork Systems

Status: in progress. This report records completed repeat/website slices and
the validation gaps that remain before the broader artwork-system request is
complete.

## Changed scope

- Scene schema 2.34 live grid, radial, and mirror object repeats, shared
  rendering/replay/hit-test/bounds evaluation, Inspector controls and tests.
- Research ledger and ADR-0242 for source ownership and shared evaluation.
- Website feature index, live-repeat preview page, and vector-tool guide.
- Screenshot demo fixtures migrated to schema 2.34.

## Validation plan

The final `pnpm verify:plan` for the current website/E2E edits selected 11
lanes across Tiers 0–4: touched format/lint, emoji/radius/docs audits, E2E
typecheck, website typecheck and units, the focused repeat E2E, and website
E2E. Full-suite escalation was **NO**. It deliberately skipped the Rust
workspace and full visual suite because this website slice did not change
native/Rust or global renderer surfaces.

## Commands and results

- `pnpm verify:plan` — passed; full-suite escalation NO.
- `VARVE_TEST_WORKERS=1 pnpm verify:affected` — format, lint, emoji, radius,
  docs audit, E2E typecheck, website typecheck, `js-unit:@varve/website`, and
  `website-unit` passed. Each website unit lane passed 19 files / 302 tests.
  The focused browser lane did not execute: its heavy-lease wait expired behind
  the unrelated `presentation motion presenter mode fidelity` run and the
  validator cancelled it (SIGTERM). The browser assertions therefore have no
  result from this attempt. `website-e2e` was not reached.
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
  controls. The newly added source-edit and save/reopen portion is typechecked
  but has not run in a browser yet.
- Website route was opened and inspected in the in-app browser at 390×844 and
  1440×960, in light and dark themes; the default ~786px viewport was also
  inspected. Mobile cards stack, and desktop/tablet cards remain readable.
  Forced-colors/high-contrast and an actual 200% browser zoom were not tested.
- `audit:docs` passed (1,141 docs, 817 links, 179 ADRs indexed); commit
  checkpoints passed for commits `ea64f0c25` and `46d62b510`.

## Skipped / unverified

- No Rust workspace or native desktop GUI run; no architecture audit because
  the repeat slice did not change the protected renderer hubs or contexts.
- No native, WebKitGTK, or packaged-app visual qualification.
- No independent SVG, PDF, or raster export inspection for object repeats;
  marketing accurately states that fidelity is not yet qualified.
- No repeat release/expand, canvas handles, source-edit-after-reopen browser
  run, or website Playwright E2E yet.
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

The working branch is `codex/live-artwork-systems`, isolated in the
`live-artwork-systems` worktree from kickoff SHA
`a4c58227081edc3039a688af88539713eb962ea6`. The dirty primary checkout was
preserved. No deploy or publication was performed.
