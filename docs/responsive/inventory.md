# Phase 0.5 — Bounded discovery inventory (2026-10-29)

Repo: /home/kevina/CodingProjects/varve · branch master at 6128380b3 when this
inventory was taken. Scope: the dashboard surface (editor shell, Home, shared
UI primitives) and the marketing site.

**Why this file exists.** The task named no files, so discovery was required —
but bounded. This is a *scored inventory*, not a code review. A fresh session
must be able to decide what to read from this file alone.

## Method and budget

1. **Enumerate only.** rg --files over apps/ and packages/ for .ts/.tsx/.css/
   .astro/.mjs → **5,337 source files** (3,978 .ts, 1,009 .tsx, 183 .css,
   152 .astro, 15 .mjs). No contents opened first.
2. **Score by risk** from path/name heuristics (layout, nav, header, sidebar,
   shell, modal, drawer, dialog, form, table, grid, card, pricing, onboard,
   footer, marketing, landing, hero): **551 matching files**.
3. **Read only the top of that list plus config.** Files actually read are
   marked 'read' below; stop condition met once framework, CSS strategy,
   breakpoint tokens, global styles, navigation ownership and densest data
   view were known.
4. Files over 500 lines were read in targeted line ranges only (never
   end-to-end).

Concentration: packages/editor/src 2,429 source files, apps/website/src 199,
packages/home/src 77, apps/desktop/src 46.

**Discovery cap (recorded):** entry points traced no further than two import
hops — apps/desktop/src/main.tsx → editor shell (Shell.tsx) and
apps/website/src/layouts/Layout.astro → SiteHeader.astro / global.css.
Everything below the fold stays in the backlog at the end of this file.

## Answers (stop condition)

| Question | Answer |
|---|---|
| Framework | React 19 + Vite 8 SPA in apps/desktop (Tauri 2 shell); shared UI in packages/editor, packages/home, packages/ui; Astro 7 marketing site; WASM engine behind the @varve/platform facade. |
| CSS strategy | Plain CSS, eager imports in main.tsx: global.css → @varve/ui/tokens.css → @varve/editor/editor.css (7,504 lines) → @varve/home/home.css (3,393). Component CSS colocated and imported by TSX. No Tailwind in the app. The marketing site still compiles Tailwind (global.css:159-161) alongside semantic CSS. |
| Breakpoint tokens | **None shared.** tokens.css:436-440 defines --bp-sm/md/lg/xl/2xl but custom properties cannot be used in @media and the audit found **zero consumers**. Real contract is hand-written literals: 229 app @media blocks / 44 distinct viewport values; the de-facto shell boundary is **899/900px** (17 uses); Home's drawer boundary is **768px** (home.css:3323). |
| Global styles | apps/desktop/src/global.css (reset, overflow: clip, #root 100dvw/100dvh); packages/ui/src/tokens/tokens.css (**auto-generated — never hand-edit**); packages/editor/src/editor.css (shell grid, chrome, drawers, portrait sheets); packages/home/src/home.css; website styles/global.css + theme.css + docs-prose.css. |
| Navigation | Editor: Menubar.tsx (2,873 lines) + TabStrip + ContextControlBar; compact drawers/launchers in Shell.tsx; Home: packages/home/src/HomeShell.tsx; site: apps/website/src/components/SiteHeader.astro (mobile nav switches at 79.999rem). |
| Densest data view | Editor: Layers tree (layers.css, virtualized, 28–32px rows, container queries at 240/260/340px) and the Inspector (inspector.css 7,393 lines, 2–6 column field grids). Secondary: timeline (fixed 200px height, 120px label column), IconBrowser/asset grids. Site: compare.astro table (680px min) and feature matrices (760px min). |
| Existing responsive layer | Not greenfield: <=899px drawer layout with focus trap, portrait bottom sheets, tablet presentation (resolveLayoutPresentation), keyboard-inset plumbing, coarse-pointer target promotion, text-enlargement contracts, 6 responsive e2e specs + chromeos-device-matrix.spec.ts (1,846 lines). See docs/architecture/responsive-workspace.md. |
| Window/device constraints | Tauri main window: 1280x800 default, **min 900x600** (apps/desktop/src-tauri/tauri.conf.json:18-21). Research finding: 13–14in devices land in the 900–1536 CSS-px band and two orientations; the 1180x820 / 1366x1024 iPad sizes and 1366x768 laptop are not in the app's e2e viewport matrix. |

## Scored inventory (top of the risk list)

| # | Path | Score | Why it matters | Read? |
|---|---|---|---|---|
| 1 | packages/editor/src/editor.css | H | Shell grid + all chrome responsive rules; 7,504 lines; no file-size cap applies to CSS | ranges |
| 2 | packages/editor/src/components/ContextControlBar/{ContextControlBar.css,ContextControlBar.tsx} | H | Context row that clips at 320/390 (audit D1) | yes |
| 3 | packages/editor/src/Shell.tsx (1,319) | H | Header composition, drawers, launchers | ranges |
| 4 | packages/editor/src/StatusBar.tsx + editor.css status tiers | H | Bottom instrumentation; 24px control row; scrolls at 320 | ranges |
| 5 | packages/editor/src/collab/collab.css | H | Share control in the header row | yes |
| 6 | apps/desktop/src/global.css (116) | H | Reset, overflow clip, 100dvh root | full |
| 7 | packages/ui/src/tokens/tokens.css (1,459, generated) | H | Panel widths, spacing, touch-target tokens | ranges |
| 8 | packages/ui/src/components/components.css (3,245) | H | Shared dialog/button/coarse promotion | ranges |
| 9 | packages/home/src/home.css (3,393) | H | Home shell/grid, 768px drawer | ranges |
| 10 | apps/desktop/src-tauri/tauri.conf.json | H | Window default/min size for 13in devices | full |
| 11 | docs/architecture/responsive-workspace.md (415) | H | Authoritative responsive contract (breakpoints, drawers, keyboard, rotation) | full |
| 12 | tests/e2e/interaction/chromeos-device-matrix.spec.ts (1,846) | H | 15-entry device/viewport matrix + coarse/tablet coverage | head |
| 13 | tests/e2e/responsive/*.spec.ts (6 specs) | H | Drawer, dock, hybrid input, layers/inspector, selection path, tablet reflow | heads |
| 14 | apps/website/src/styles/global.css (1,043) | H | Site layout authority + Tailwind layers | head |
| 15 | apps/website/src/components/SiteHeader.astro (830) | H | Site nav breakpoints (79.999rem/64rem/80rem) | ranges |
| 16 | apps/website/src/pages/about/license.astro, docs/performance.astro | H | Dense tables with no scroll wrapper (audit D5) | ranges |
| 17 | packages/editor/src/settings/layoutPresentation.ts | M | desktop/tablet/compact resolver | ranges |
| 18 | packages/editor/src/workspace/shellHooks.ts, dock/useEditorDockGeometry.ts | M | JS 899px literals; dock geometry owns canvas rect | grep |
| 19 | packages/editor/src/Menubar.tsx (2,873) | M | Menu rail containment | not read |
| 20 | packages/editor/src/CanvasArea.tsx (1,640) | M | gpu-layer contain: paint clips fixed descendants | grep |

## Files read (one-line purpose each)

- playwright.config.ts — e2e dev server (Vite :1420), visual determinism, projects.
- tests/e2e/global-setup.ts, tests/e2e/shared.ts — app boot/navigation helpers used by the capture harness.
- docs/quality/visual-validation.md — screenshot/baseline policy.
- docs/quality/file-size-policy.md — 400-line cap scope (excludes CSS; includes scripts/tests).
- docs/architecture/responsive-workspace.md — breakpoints, panel sizing, drawers/focus, keyboard, rotation, coverage.
- docs/agents/responsive-layers-inspector-2026-09-30-ownership.md + docs/audits/responsive-layers-inspector-2026-09-30.md — prior campaign and its open items O1–O8.
- packages/editor/src/editor.css (target ranges) — shell grid, header rows, status tiers, compact tiers.
- packages/editor/src/components/Shell/shellStyles.css — canvas dock geometry contract.
- packages/editor/src/components/ContextControlBar/ContextControlBar.css + root render — context-row sizing/overflow.
- packages/editor/src/collab/collab.css — Share control sizing.
- apps/desktop/src/global.css — page reset, overflow clip, root viewport.
- packages/ui/src/tokens/tokens.css (ranges) — panel-width/touch-target tokens; generated-file warning.
- apps/desktop/src/main.tsx — CSS import order (single global cascade entry).
- apps/desktop/src-tauri/tauri.conf.json — default/min window geometry.
- apps/website/astro.config.mjs, Layout.astro, SiteHeader.astro (ranges), styles/global.css (head), styles/theme.css (head) — site entry, nav, token/theme layers, Tailwind pipeline.
- apps/website/src/pages/about/license.astro, docs/performance.astro (ranges) — dense tables.
- tests/e2e/responsive/{compact-drawers,layers-inspector-panels}.spec.ts, tests/e2e/a11y/responsive-panels.spec.ts, tests/e2e/home/home-shell.spec.ts (heads) — existing coverage patterns.
- apps/website/tests/e2e/reflow.spec.ts, touch-targets.spec.ts — site reflow corpus.

## Deliberately not read yet (backlog, ranked)

1. Menubar.tsx internals (menu rail scroll/overflow, workspace switcher JS).
2. CanvasArea.tsx / compositor overlays (fixed-descendant clipping under contain: paint).
3. packages/editor/src/components/FloatingToolbar/* (overflow menu, tablet controls, bottom-chrome clearance).
4. Timeline / GraphEditor (dense data, hover-only keyframe values, 16px mute/solo).
5. Inspector section files (2–6 column grids, 24–28px controls, Colorize 420px floor).
6. Dialog inventory beyond shared varve-dialog (ContentAwareFill 820px, Upscale, SpecPanel).
7. Home asset browser / search palette / footer ladders.
8. Marketing pages other than the five selected routes (130 pages total).
9. Keyboard-inset / visualViewport consumers (72 production innerWidth/Height reads; 14 copies of the -120 chrome estimate).
10. packages/tokens (DTCG engine; not a CSS source — do not look for layout vars there).

## Additions made by this session

- scripts/validate-responsive.mjs + scripts/responsive/*.mjs — re-runnable matrix harness.
- tests/e2e/responsive/compact-header-containment.spec.ts — regression for the D1 fix.
- docs/responsive/screenshots/<sha>/ — committed validation artifacts.

Next session should start from docs/responsive/STATE.md, not from this file.
