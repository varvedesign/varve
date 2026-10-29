# Raw-evidence responsive audit (Phase 1)

Repo: /home/kevina/CodingProjects/varve. Scope: apps/desktop/src, packages/editor/src, packages/home/src,
packages/ui/src, apps/website/src. Evidence gathered 2026-10-29 with ripgrep, wc -l and node aggregation
over 182 scoped CSS files plus scoped TS/TSX/Astro (node_modules, dist*, target, .worktrees excluded).
No source edits. Every row cites exact file:line. "none found" means the pattern had zero hits.

Note on the project premise: packages are plain CSS (no utility framework), but the marketing site still
runs the Tailwind pipeline (see K); there is also a pre-existing responsive layer (drawers <=899px, home
drawer <=768px, coarse-pointer target promotion) documented under B/E/F.

## A. Stylesheet map

| file:line | evidence | role / risk |
| --- | --- | --- |
| apps/desktop/src/main.tsx:1 | import './global.css' | app reset/global base, eagerly loaded |
| apps/desktop/src/main.tsx:2 | import '@varve/ui/tokens.css' | 1459-line token file; every theme block re-declares layout tokens |
| apps/desktop/src/main.tsx:3 | import '@varve/editor/editor.css' | 7504-line monolith, no @import, eager |
| apps/desktop/src/main.tsx:4 | import '@varve/home/home.css' | 3393-line home shell monolith, no @import, eager |
| apps/desktop/index.html:205 | inline boot-fallback <style>, z-index 2147483646 | only page-level CSS outside main.tsx |
| packages/editor/src/Shell.tsx:78 | import './components/Shell/shellStyles.css' | the one component stylesheet with an @import chain |
| packages/editor/src/components/Shell/shellStyles.css:1-3 | @import prototype.css, UpscaleDialog.css, ImageResizeDialog.css | dock/canvas-dock geometry contract |
| packages/ui/src/tokens/tokens.css:1-6 | auto-generated from color.ts, spacing.ts, sizing.ts, typography.ts | never hand edit; regeneration is the single writer |
| packages/ui/src/tokens/tokens.css:182-183 | --sidebar-width and --inspector-width clamp() tokens | layout width source of truth (fluid, good) |
| packages/ui/src/tokens/tokens.css:494, 710 | [data-theme="dark"], [data-theme="high-contrast"] repeat layout tokens | token duplication x5 blocks (lines 182, 668, 884, 1102, 1323) |
| packages/tokens/package.json | DTCG design-token engine, zero CSS, zero React | NOT a CSS token source; do not look for layout vars here |
| apps/website/src/layouts/Layout.astro:2 | import '../styles/global.css' | site entry |
| apps/website/src/styles/global.css:11-12 | @import "@varve/ui/tokens.css"; @import "./theme.css" | site token/theme entry |
| apps/website/src/styles/global.css:159-161 | @tailwind base/components/utilities | Tailwind layer still compiled on the site |

CSS files over 300 lines (42 such files in scope; top layout owners):

| file:line | evidence | role / risk |
| --- | --- | --- |
| packages/editor/src/editor.css:1 | 7504 lines | reset floor, shell grid, menubar/tabs/status, drawers/portrait sheets, crash/safe-mode |
| packages/editor/src/components/Inspector/inspector.css:1 | 7393 lines | inspector sections/controls plus container queries |
| packages/home/src/home.css:1 | 3393 lines | home shell grid, asset browser, dialogs, <=768 drawer block at 3306 |
| packages/ui/src/components/components.css:1 | 3245 lines | shared primitives: buttons, dialog, menu, toast, density + pointer-coarse promotion |
| packages/editor/src/components/LayersPanel/layers.css:1 | 2457 lines | layers tree rows, filters, drag reorder, container queries |
| packages/editor/src/components/Inspector/sections/effectStudio.css:1 | 1761 lines | effect studio panel |
| packages/ui/src/tokens/tokens.css:1 | 1459 lines | tokens only |
| packages/editor/src/components/AdjustmentLayer/adjustment.css:1 | 1388 lines | adjustment-layer panel |
| packages/editor/src/components/SpecPanel/SpecPanel.css:1 | 1096 lines | spec/inspection panel |
| apps/website/src/styles/global.css:1 | 1043 lines | marketing global + Tailwind layers + scroll-x recipe |
| packages/editor/src/components/FontBrowser/FontBrowser.css:1 | 1026 lines | font browser shell, full-height |
| packages/editor/src/components/Presentation/presentationNavigator.css:1 | 810 lines | presentation navigator |
| packages/editor/src/components/Upscale/UpscaleDialog.css:1 | 781 lines | large dialog with viewport-height caps |
| packages/editor/src/components/IconBrowser/IconBrowser.css:1 | 765 lines | asset/pack browser |
| packages/editor/src/timeline/TimelinePanel.css:1 | 548 lines | timeline rows, fixed 200px panel height |

## B. Breakpoints

Counts: app CSS = 229 @media blocks (55 distinct conditions: 44 viewport, 11 capability), 19 @container
blocks. Website = 124 @media blocks across .css and .astro scoped styles (35 distinct: 88 viewport,
36 capability).

App viewport breakpoints by count (top files):

| file:line | evidence | risk |
| --- | --- | --- |
| packages/editor/src/editor.css:2308 | (max-width: 640px) x11 app-wide; editor.css owns 4, home.css 2 | most-used app value, no token |
| packages/editor/src/editor.css:2177 | (max-width: 899px) x10; editor.css 7 | de-facto drawer breakpoint, duplicated as 900 min-width in 5 rules |
| packages/editor/src/editor.css:2259 | (min-width: 900px) x5; FloatingToolbar.css and layoutPresentation.css add 1 each | 899/900 pair must be kept in sync by hand |
| packages/editor/src/components/FloatingToolbar/ToolOptionsPopover.css:130 | (max-width: 480px) x4 across 4 files | 480 duplicated with 30rem (components.css:2914) |
| packages/editor/src/components/Presentation/presentationNavigator.css:524 | (max-width: 720px) x3 | 720 vs 768 coexist |
| packages/home/src/home.css:3323 | (max-width: 768px) x3; ExportDialog.css and components.css:2506 also | home drawer breakpoint differs from editor 899 |
| packages/editor/src/components/Inspector/sections/photoSource.css:200 | (max-width: 520px) x3 | local one-off |
| packages/editor/src/components/Presentation/presentationDelivery.css:148 | (max-width: 680px) x3 | local one-off |
| packages/editor/src/editor.css:3146 | (max-width: 899px) and (orientation: portrait) x4 | portrait sheet mode |
| packages/editor/src/components/Upscale/UpscaleDialog.css:562 | height-based: (min-height: 1000px) at 562 and (max-height: 814px) at 568; also (max-width: 520px) at 587 | only dialog that adapts to short viewports |
| packages/editor/src/editor.css:2484 | (max-height: 900px); editor.css:3905 (max-height: 800px) | two more vertical breakpoints |
| packages/editor/src/editor.css:1162 | (max-width: 1180px), 1167 980px, 1172 860px, 1180 700px | a 4-step local ladder inside one file |

Container queries (19 blocks, 12 distinct conditions):

| file:line | evidence | risk |
| --- | --- | --- |
| packages/editor/src/components/LayersPanel/layers.css:720 | @container layers (min-width: 240px) / 726 (max-width: 239px) | panel responds to its own width, not viewport |
| packages/editor/src/components/LayersPanel/layers.css:998 | @container layers (max-width: 260px); also 2167, 2319 (340px), 2333, 2387 | row-action clips handled locally |
| packages/editor/src/components/Inspector/inspector.css:6355 | @container inspector (max-width: 13rem); 6716 (15.5rem) | inspector collapses when column is narrow |
| packages/editor/src/components/Inspector/sections/effects/effects.css:93 | @container inspector (max-width: 20rem) | widest inspector threshold |
| packages/editor/src/editor.css:3551 | @container layers (max-width: 280px) / 3556 inspector (max-width: 280px) | shell-level fallbacks |
| packages/editor/src/editor.css:4121 | @container settings-content (max-width: 28rem) | settings dialog |
| packages/home/src/home.css:42 | @container (max-width: 48rem) on .varve-home | documented dead for the root (see comment at home.css:3306) |

No shared breakpoint mechanism:

| file:line | evidence | risk |
| --- | --- | --- |
| packages/ui/src/tokens/tokens.css:436-440 | --bp-sm 640px, --bp-md 768px, --bp-lg 1024px, --bp-xl 1280px, --bp-2xl 1536px | rg for "--bp-" returns only these 5 definitions: zero consumers; custom props cannot be used in @media anyway |
| packages/editor/src/workspace/shellHooks.ts:140 | matchMedia('(max-width: 899px)') literal, repeated at 145, 175 | same magic number in JS |
| packages/editor/src/components/PanelDragHandle.tsx:194 | matchMedia('(max-width: 899px)') also at 206 | duplicate |
| packages/editor/src/components/Minimap/MinimapPanel.tsx:216 | matchMedia('(max-width: 899px)') also at 220 | duplicate |
| packages/editor/src/components/Inspector/PropertiesPanel.tsx:110 | matchMedia('(max-width: 899px)') also at 115 | duplicate |
| packages/editor/src/workspace/dock/useEditorDockGeometry.ts:242 | matchMedia('(max-width: 899px)') | duplicate |
| packages/home/src/HomeShell.tsx:297 | matchMedia('(max-width: 768px)') | second breakpoint family |
| apps/website/src/components/DisciplineTabs.astro:197 | matchMedia('(max-width: 720px)') also 216 | site duplicates its 720 breakpoint in JS |
| packages/editor/src/components/FloatingToolbar/useHasTouchInput.ts:31 | matchMedia('(any-pointer: coarse)') | capability probe by literal string |
| packages/editor/src/workspace/dock/useEditorDockGeometry.ts:199 | matchMedia('(pointer: coarse), (any-pointer: coarse)') | second coarse query spelling |

Website breakpoints: 680px x16 (docs/pages), 640px x11, 720px x7, 700px x7, 768px x7, 600px x4,
1100px x3 (min-width), 480px x3, 760px x3, 380px x2, 520px x2, plus 24rem/52rem/64rem/79.999rem/80rem.
Only values shared by app and site: 480, 640, 720, 768; site-dominant 680/700/760 do not exist in the app.

## C. Fixed-width hazards

| file:line | evidence | risk |
| --- | --- | --- |
| packages/editor/src/editor.css:2207 | .editor__logo-panel width: 340px (drawer variant adds max-width: 90vw) | only panel not width-capped by a clamp token |
| packages/editor/src/editor.css:2220 | .editor__library-panel width: 300px in <=899 drawer | fixed drawer, no vw cap |
| packages/editor/src/editor.css:2078 | .editor-menubar__doc-name-input width: 200px | menubar title field cannot shrink |
| packages/editor/src/editor.css:5542 | .timeline-track-row__label width: 140px (duplicate of TimelinePanel.css:354 width: 120px) | two different fixed label widths for the same row |
| packages/editor/src/timeline/TimelinePanel.css:13 | .timeline-panel height: 200px | fixed vertical budget on small screens |
| packages/editor/src/components/Inspector/inspector.css:724 | .insp-section-manager__panel width: 280px; also 6834 preset popover 280px, 2242 220px, 2173 min-width 190px, 2538 min-width 120px | fixed popovers; no vw cap on 280px |
| packages/editor/src/onboard/ContextualHelp/ContextualHelpPanel.css:1 | width: 320px | fixed 320px card inside narrow canvas |
| packages/editor/src/onboard/OnboardingChecklist/OnboardingChecklist.css:1 | width: 240px | fixed card |
| packages/home/src/home.css:1960 | .search-palette__container width: 480px, max-width: calc(100vw - 2rem) | capped (fix landed R5 2026-08-10) |
| packages/editor/src/shortcuts/ShortcutPalette.css:15 | width: 26.25rem, max-width: calc(100vw - 2rem), max-height: 25rem | capped, but height is fixed |
| packages/editor/src/components/ColorConversion/color-conversion.css:1 | .color-conversion-dialog min-width: 320px | dialog body cannot go below 320px |
| packages/editor/src/components/Inspector/sections/ColorizeSection.css:322 | .colorize-dialog__body min-width: 420px | 420px floor exceeds a 375px viewport |
| packages/editor/src/editor.css:9 | html { min-width: 320px } | page-level floor; below it horizontal page scroll (intended WCAG 1.4.10 floor) |
| packages/home/src/home.css:3 | .varve-home grid-template-columns: var(--sidebar-width) 1fr; sidebar clamp(14rem, 12rem + 8vw, 18rem) = 224-288px | overridden to 1fr only inside <=768 media (home.css:3323) |
| packages/editor/src/editor.css:331 | shell grid minmax(0, sidebar) minmax(320px, 1fr) minmax(0, inspector) var(--logo-panel-width, 0px) | 320px canvas floor; logo column is 340px when open (editor.css:349) |
| packages/editor/src/editor.css:7286 | grid 0 minmax(320px, 1fr) 0 0; also 7383 and 7424 with minmax(240px, min(300px, 30vw)) | 240-340px panel tracks resume at >=900 |
| packages/editor/src/components/Settings/layoutPresentation.css:67 | tablet mode --sidebar-width: 0, --inspector-width: clamp(280px, 30vw, 360px), grid 0 minmax(320px, 1fr) | tablet inspector up to 360px |
| packages/editor/src/components/Upscale/UpscaleDialog.css:1 | grid minmax(0, 1.45fr) minmax(300px, 0.75fr) | 300px minimum side rail |
| packages/editor/src/components/FrequencySeparation/frequencySeparation.css:45 | grid minmax(0, 1fr) minmax(220px, 260px) | 220px minimum side rail |
| packages/editor/src/editor.css:2075 | max-width: 200px (menubar doc-name) and 2089 width: 200px | duplicated fixed doc-name geometry |

No min-width on body/#root: body uses width/height 100% (apps/desktop/src/global.css:10-20), #root uses
100dvw/100dvh (global.css:89-93); the only shell-level floor is html min-width at editor.css:9.

## D. Viewport units

Counts (all scoped roots): vh 46, dvh 25, vw 214, dvw 4; svh 0 and lvh 0 (none found).

| file:line | evidence | risk |
| --- | --- | --- |
| packages/ui/src/tokens/tokens.css:142 | 127 vw occurrences across tokens.css; e.g. --space-6: clamp(1.4rem, 1.31rem + 0.45vw, 1.85rem) here | the spacing/type scale is viewport-fluid; every rem token indirectly depends on viewport width |
| packages/editor/src/editor.css:6242 | 37 viewport-unit occurrences in this file (11 dvh, 21 vw, 3 vh, 2 dvw); this dialog cap is one | shell + dialogs mix vh and dvh |
| packages/ui/src/components/components.css:650 | 13 viewport-unit occurrences (10 vw, 2 dvh, 1 vh); this dialog cap is representative | shared dialog/toast viewport caps |
| packages/home/src/home.css:7-10 | height: 100vh then 100dvh, width: 100vw | intentional vh->dvh fallback (comment R8) |
| apps/desktop/src/global.css:90-91 | #root width: 100dvw, height: 100dvh | root depends on dvh only; no vh fallback here |
| packages/editor/src/editor.css:3754 | height: min(88dvh, calc(var(--visual-viewport-height, 100dvh) - 2rem), 760px) | JS-injected visual-viewport var is the primary cap |
| packages/editor/src/components/Presentation/presentationDelivery.css:3-6 | width: 100vw, height: 100dvh, max 100dvh | presenter depends on full height |
| packages/editor/src/components/FontBrowser/FontBrowser.css:24 | height: 100dvh | full-height font browser |
| packages/editor/src/onboard/ContextualHelp/ContextualHelpPanel.css:6 | height: 100vh (no dvh fallback) | oldest pattern, no dvh upgrade |
| packages/editor/src/auxiliary/AuxiliaryShell.css:4-5 | width: 100dvw, height: 100dvh | auxiliary window root |
| packages/ui/src/components/radius-system.css:196 | .radius-gallery__dark min-height: 100vh | dev gallery |
| packages/editor/src/components/BackgroundRemoval/SubjectCard.css:189-190 | max-width: 100vw, max-height: 100vh | overlay uses vw/vh without scrollbar compensation |
| packages/editor/src/components/FloatingToolbar/TabletTouchControls.css:26 | width: 100vw | touch control strip |
| packages/editor/src/components/GuideLayouts/GuideLayoutsDialogHost.css:2-3 | width: 100vw, max-height: 100vh | dialog host |
| apps/website/src/styles/global.css:1 | 6 occurrences (4 vh, 2 vw) | marketing pages |

JS viewport reads (72 production occurrences of window.innerWidth/innerHeight; no shared helper):

| file:line | evidence | risk |
| --- | --- | --- |
| packages/editor/src/context.tsx:684 | height: window.innerHeight - 120, repeated at 2439, 4303, 4342, 4354, 4366, 4380, 4421, 5252, 7104, 7114, 9181, 9195, 9232 | 14 occurrences of the same magic 120px chrome estimate |
| packages/editor/src/canvas/cameraState.ts:123 | height: window.innerHeight - 120 | same magic number |
| packages/editor/src/context/viewportOps.ts:117-118 | width: window.innerWidth, height: window.innerHeight - 120 | same magic number |
| packages/editor/src/canvas/isoTestHooks.ts:101-102 | fallback to window.innerWidth/innerHeight | test hook |
| packages/editor/src/collab/CollabSessionContext.tsx:468-469 | canvas client size fallback to window.innerWidth, innerHeight - 120 | remote viewport size |
| packages/editor/src/tools/ZoomTool.ts:63-64 | canvas rect fallback to window.innerWidth/innerHeight | pointer math fallback |
| packages/editor/src/importing/useFileImport.ts:81-83 | window.innerWidth, innerHeight - 120 | import sizing |
| packages/editor/src/navigation/useFindingNavigation.ts:332 | vp = innerWidth/innerHeight | find-in-page scrolling |
| packages/editor/src/performance/capabilityReport.ts:306 | win.innerWidth | capability report |
| packages/editor/src/canvas/keyboardInset.ts:156 | reads ownerWindow.visualViewport (156-176) and writes --visual-viewport-height / --keyboard-inset-bottom at 283-293 | the only visualViewport integration; all consumers must use it |
| packages/editor/src/components/TextEditOverlay.tsx:1 | 7 innerHeight/innerWidth reads | text edit overlay positioning |
| packages/ui/src/components/overlayGeometry.ts:201 | view.innerWidth fallback to documentElement.clientWidth | shared overlay clamping |

## E. Hover/tap dependency

| file:line | evidence | risk |
| --- | --- | --- |
| packages/editor/src/components/Inspector/inspector.css:1043 | :hover count by file: inspector 98, editor.css 74, components.css 51, home.css 48, layers.css 47, TimelinePanel 22; app total 719 in 110 files | hover is the dominant state vocabulary |
| capability media | app 38 pointer/hover blocks: 17 (pointer: coarse), 11 (hover: none), (pointer: coarse), 10 (pointer: coarse), (any-pointer: coarse), 7 (hover: hover) and (pointer: fine), 3 (any-hover: none), 2 (any-pointer: coarse); site 4 (SiteHeader.astro:581, SearchDialog.astro:315, ThemeToggle.astro:158, DesignCursor.astro:166) | coarse support exists but is per-component, not systemic |
| hover-reveal rules | 27 rules reveal controls on :hover; 22 have a :focus/:focus-visible/:focus-within counterpart, 5 do not | see next rows |
| packages/editor/src/editor.css:869 | .editor-tabs__tab:hover .editor-tabs__close | close button hidden until hover; mitigated for touch at editor.css:874 (hover:none -> opacity:1) |
| packages/editor/src/components/LayersPanel/layers.css:1160 | .layers-row:hover .layers-row__ai-badge (also .layers-row--focused) | badge hidden unless hover/focus; no coarse block for this one |
| packages/editor/src/components/IconBrowser/IconBrowser.css:403 | .icon-card:hover .icon-card__fav, .icon-card--focused .icon-card__fav | favourite action reveal; focus class is JS-driven |
| packages/home/src/home.css:2566 | .asset-browser__card:hover .asset-browser__card-insert | insert action reveal, no focus path |
| packages/editor/src/components/LayersPanel/layers.css:882 | .layers-row:hover .layers-row__details-trigger (+ :focus-within) | details affordance; touch fallback at layers.css:896 (opacity .75) |
| packages/editor/src/components/LayersPanel/layers.css:2223 | .layers-row:hover [data-row-action="solo"]; touch fallback at layers.css:2240 | row actions require hover on fine pointer |
| packages/editor/src/components/Inspector/inspector.css:7042 | .insp-preset-item-wrapper:hover .insp-preset-fav-btn (+ :focus-visible) | favourite action |
| packages/ui/src/components/Tooltip.tsx:348 | onPointerEnter/Leave + onFocus/onBlur wired (348-482) | tooltips are keyboard-accessible (good baseline) |
| packages/editor/src/Menubar.tsx:2548 | onMouseEnter opens a sibling menu when a menu is already open; second at 2638 | hover-to-switch menu behavior has no touch analog, click still opens |
| packages/editor/src/timeline/GraphEditor.tsx:407 | onMouseEnter sets hoveredPoint; 415 clears on leave; no touch handlers in file | keyframe value/tangents only visible on hover |
| packages/editor/src/components/Minimap/MinimapPanel.tsx:719-720 | onPointerEnter/Leave set hovering | viewport hover state; pointer events do fire for touch taps |
| packages/editor/src/components/BackgroundRemoval/SubjectCard.tsx:66 | onMouseEnter={handleMouseEnter} (2 enter/leave handlers in file) | hover preview/details |
| hover handler totals | 56 onMouseEnter/Leave/onPointerEnter/Leave in TSX; top: Tooltip.tsx 8, Menu.tsx 7, AlignmentHandleOverlay.tsx 4, PresetTile.tsx 3, GraphEditor.tsx 3 | handlers in ~20 files |
| title= tooltips | 353 title= in app TSX; chrome: Shell 7, LayersPanel 5, ContextControlBar 5, timeline 2, Menubar 1, StatusBar 0, FloatingToolbar 0 | title-only labels do not surface on touch |
| packages/editor/src/components/ContextControlBar/ContextControlBar.tsx:89 | title={title} on icon buttons (also 102) | tooltip-only affordance on chrome |
| packages/editor/src/components/Shell/WorkspaceBottomPanels.tsx:160 | title="Resize by dragging diagonally or use arrow keys" | discoverability via title only |
| packages/editor/src/components/LayersPanel/index.tsx:816 | title={...} on a row action | same |

## F. Touch targets

| file:line | evidence | risk |
| --- | --- | --- |
| packages/ui/src/tokens/tokens.css:332-344 | control ladder: xs 24, compact 28, default 32, large 40, xl 48 | default chrome controls are 24-40px, below 44 |
| packages/ui/src/tokens/tokens.css:355 | --touch-target-min: 44px; packages/ui/src/tokens/sizing.ts:70 target-min-compact 24px | tokens exist |
| packages/ui/src/components/components.css:338 | @media (pointer: coarse) .varve-btn min-block/inline-size 44px; .varve-close at 454 min 24px | buttons promoted only on coarse pointer |
| packages/editor/src/components/LayersPanel/layers.css:166 | header buttons -> 44px on coarse | covered |
| packages/editor/src/editor.css:2368 | coarse block: dock items 44px, menubar items raised to 24px floor (WCAG 2.5.8) | menubar remains 24px, not 44 |
| packages/editor/src/editor.css:3486 | coarse block: detach/collapse buttons -> 44px | covered |
| packages/editor/src/components/Inspector/inspector.css:143 | (pointer: coarse), (any-pointer: coarse) block; also 4811, 6675 | inspector partially promoted |
| packages/editor/src/components/LayersPanel/layers.css:286 | .layers-row min-height var(--density-rows-min-height, --space-6) = 32px comfortable, 28px compact (components.css:2533/2543) | tree rows are 28-32px |
| packages/editor/src/timeline/TimelinePanel.css:333 | .timeline-track-row height: 28px | rows 28px |
| packages/editor/src/timeline/TimelinePanel.css:354 | .timeline-track-row__label width: 120px | fixed label column |
| packages/editor/src/timeline/TimelinePanel.css:382 | mute/solo buttons width: 16px | 16px targets |
| packages/editor/src/editor.css:791 | .editor-tabs__tab height: var(--component-default-height) = 32px | tab targets 32px |
| packages/editor/src/editor.css:2389 | coarse block raises menubar/status items to min-height 24px (WCAG 2.5.8 floor) | 24px menubar targets |
| packages/editor/src/editor.css:289-296 | --statusbar-height clamp 26-28px, --statusbar-control-height: --component-xs-height (24px) | status bar is a 24px target row |
| packages/editor/src/components/Inspector/inspector.css:2473 | .insp-icon-btn 24x24; 1600 insp-inline-btn min-width 24; 2767 segmented btn min-height 1.5rem; 4848 stepper btn 28x28; 2406 mask-card insp-btn-sm height 24 | dense inspector controls 24-28px |
| packages/home/src/home.css:133 | .varve-home__toolbar min-height: 40px | toolbar 40px, just under 44 |
| packages/editor/src/shortcuts/ShortcutPalette.css:109 | .shortcut-palette__row padding only (no min-height) | rows sized by content |
| packages/editor/src/components/LayersPanel/layers.css:541 | .layers-row__disclosure width: var(--target-min-compact) = 24px | 24px disclosure hit target |
| existing mitigations | --touch-target-min: 98 uses in 17 CSS files; min-height/height 44px: 15 occurrences (inspector.css 7, effectStudio.css 5, ModelDownloadDialog.css 2, CropOverlay.css 1, SpecPanel.css 1, components.css 1); -webkit-tap-highlight-color: 1 (global.css:19); touch-action: 26 occurrences in 15 files (layers.css:280 manipulation) | pattern is opt-in per component |

## G. Safe areas + viewport meta

| file:line | evidence | risk |
| --- | --- | --- |
| apps/desktop/index.html:5 | <meta name="viewport" content="width=device-width, initial-scale=1"> | no viewport-fit=cover |
| apps/website/src/layouts/Layout.astro:210 | <meta name="viewport" content="width=device-width, initial-scale=1.0"> | no viewport-fit=cover |
| rg "viewport-fit" | none found (0 hits in scope) | env(safe-area-inset-*) is 0 on iOS Safari without viewport-fit=cover, so the rules below are inert there |
| apps/website/src/components/SiteHeader.astro:601 | padding: env(safe-area-inset-top/right/bottom/left) on mobile nav dialog | depends on viewport-fit=cover (missing) |
| packages/editor/src/editor.css:3154-3155 | portrait sheet max-height calc(100dvh - env(safe-area-inset-top) - 24px), padding-bottom env(safe-area-inset-bottom) | inert in browser; Tauri desktop has no insets |
| packages/editor/src/components/Settings/layoutPresentation.css:65 | env(safe-area-inset-bottom, 0px) in layout offset | same |
| packages/editor/src/components/Settings/layoutPresentation.css:139 | max-height calc(100dvh - env(safe-area-inset-top) - 24px) | same |
| packages/ui/src/components/components.css:1935 | toast container bottom clamp includes env(safe-area-inset-bottom, 0px) | same |
| packages/ui/src/components/components.css:1961 | second safe-area use in toast stack | same |
| env total | 10 env(safe-area-inset-*) calls on 7 lines in 4 files | only one website location |

## H. Overflow/scroll

Counts: overflow-x: auto/scroll = 30 occurrences; overflow-x: hidden = 14; overflow: hidden is used 50x
in editor.css, 45x in inspector.css, 29x in home.css, 19x in layers.css.

Expected horizontal scrolling:

| file:line | evidence | risk |
| --- | --- | --- |
| packages/ui/src/components/ScrollArea.css:45 | horizontal viewport overflow-x | canonical horizontal scroller |
| packages/editor/src/timeline/TimelinePanel.css:95 | .timeline-panel__ruler-container overflow-x | timeline zoom/ruler scrolls horizontally |
| packages/editor/src/editor.css:1126 | comment: options bar horizontal scrolling keeps every control reachable | toolbar overflow contract |
| packages/editor/src/editor.css:3111 | <=899 panel rules; drawers use overflow-y: auto | drawers scroll vertically only |
| packages/editor/src/components/Breadcrumb/selectionBreadcrumb.css:28 | comment: segments scroll rather than clip | path bar scrolls |
| packages/editor/src/components/LogoPanel/logo-panel.css:221 | overflow-x: auto (also 234) | logo panel scroll |
| packages/editor/src/components/CodePanel/CodePanel.css:43 | overflow-x: auto (also 71) | code horizontal scroll |
| apps/website/src/styles/global.css:1018 | .scroll-x recipe (overflow-x auto, thin scrollbar) | used by compare page |
| apps/website/src/pages/compare.astro:109 | compare-table-wrap.scroll-x with tabindex=0 role=region | correct scroll-region pattern |
| apps/website/src/pages/download.astro:655-663 | distro-picker scroll region with tabindex/role/aria-label | correct pattern |
| apps/website/src/styles/global.css:251, 778 | pre and code overflow-x: auto | prose code scroll |

Hidden/clipping containers:

| file:line | evidence | risk |
| --- | --- | --- |
| packages/editor/src/editor.css:337 | .editor-shell overflow: hidden | shell clips any child that exceeds grid |
| packages/home/src/home.css:11 | .varve-home overflow: hidden | root clips all home children |
| packages/home/src/home.css:14 | .varve-home container-type: inline-size (layout containment) | fixed descendants are contained by .varve-home, combined with overflow hidden this clips fixed overlays inside it |
| packages/editor/src/editor.css:2180 | <=899 panels position: fixed, top var(--menubar-total-height) | fixed inside .editor-shell (overflow hidden + position relative; no transform ancestor, so not clipped by shell) |
| packages/editor/src/components/LayersPanel/layers.css:255-256 | tree overflow-y auto, overflow-x hidden | deep indentation clips horizontally |
| packages/editor/src/components/Inspector/inspector.css:6487-6488 | width 100vw, max-height 100vh | fullscreen picker escapes panel but not viewport |
| packages/editor/src/components/Shell/WorkspaceBottomPanels.css:255 | width: 100vw | recovery panel full width |
| apps/desktop/src/global.css:16 | html, body overflow: clip; overscroll-behavior: none | page can never scroll; any overflow is lost rather than scrollable |
| apps/desktop/src/global.css:98-104 | .gpu-layer contain: layout style paint | paint containment clips fixed-position descendants |
| packages/editor/src/CanvasArea.tsx:1489 | className includes gpu-layer on .editor-canvas | overlays rendered inside the canvas cannot be position:fixed relative to the viewport; they must portal |
| apps/website/src/styles/global.css:176-184 | body has no overflow-x guard | any fixed-width child (tables without a scroll wrapper) can create page-level horizontal scroll |

## I. Tables/dense data

| file:line | evidence | risk |
| --- | --- | --- |
| packages/editor/src/components/LayersPanel/layers.css:275 | .layers-row display: flex, gap/padding tokens, min-height 32/28px; indent guides absolute (layers.css:297) | tree rows have no fixed columns; row actions are hover-revealed (layers.css:2222) |
| packages/editor/src/components/LayersPanel/layers.css:720 | container queries 240/239/260/340px | reflow is container-driven, not viewport |
| packages/editor/src/timeline/TimelinePanel.css:333 | track row flex, height 28px; label 120px fixed (354); mute/solo 16px (382); ruler scroll (95) | dense horizontal+vertical data, fixed label column, 200px panel height |
| packages/editor/src/editor.css:5542 | duplicate label width 140px for timeline rows | two sources for same fixed column |
| packages/editor/src/components/Inspector/inspector.css:1844 | repeated inspector field grids: repeat(2, minmax(0, 1fr)) at 1844, repeat(6) at 2529, minmax(0,1fr) 92px at 2252, minmax(0,1fr) 5.5rem at 2839 | 2-6 column control grids with fixed secondary columns |
| packages/editor/src/components/SpecPanel/SpecPanel.css:346 | @container inspector (max-width: 22rem) | spec panel collapses by container |
| packages/editor/src/shortcuts/ShortcutPalette.css:14 | panel 26.25rem wide at 17, max-width calc(100vw - 2rem), 25rem tall; rows are flex buttons (109) | two-column label/shortcut rows must wrap at 375 |
| packages/editor/src/plugins/PluginManager.css:45 | heading grid-template-columns: minmax(0, 1fr); artwork width 112px at 143 | browser layout reflows poorly (single column) |
| packages/editor/src/components/IconBrowser/IconBrowser.css:582 | pack list grid repeat(auto-fill, minmax(220px, 1fr)); filter select min-width 130px (215) | auto-fill needs >=220px track |
| packages/editor/src/components/BrushBrowser/BrushBrowser.css:49 | repeat(auto-fill, minmax(128px, 1fr)) | small tracks, safe |
| packages/editor/src/components/Inspector/inspector.css:6355 | container queries 13rem/15.5rem | dense inspector keyed to width |
| apps/website/src/pages/compare.astro:456-476 | .compare-table min-width 680px, th/td white-space nowrap, vertical header sticky | horizontal scroll required below 680 |
| apps/website/src/pages/compare.astro:299 | .spec-row grid minmax(140px, 0.8fr) 2fr; collapses to 1fr at compare.astro:517 | 140px key column |
| apps/website/src/pages/features/design-tokens.astro:234-235 | .matrix-scroll overflow-x auto; table min-width 760px | table scroll below 760 |
| apps/website/src/pages/features/clipboard.astro:129-130 | same matrix-scroll pattern, min-width 760px | same |
| apps/website/src/pages/docs/chromeos-linux.astro:308 | .docs-table-wrap overflow-x: auto; .docs-table no min-width | safe wrapper; other docs tables lack it |
| apps/website/src/pages/about/license.astro:80 | 3-column license-table, CSS at 244-272, no scroll wrapper, no min-width | squeezes at 375 (cells wrap, no overflow guard) |
| apps/website/src/pages/docs/performance.astro:41 | perf-table, CSS at 226-241, no scroll wrapper | same risk |
| apps/website/src/pages/about/license.astro:80 | license-table td.allowed/td.restricted text-align: right (266-278) | right-aligned dense cells on narrow screens |

## J. Dialogs/forms

| file:line | evidence | risk |
| --- | --- | --- |
| packages/ui/src/components/components.css:626-661 | shared .varve-dialog width min(90vw, 32rem), size lg min(92vw, 52rem), max-height min(calc(var(--visual-viewport-height, 100dvh) - 2rem), 42rem) | dialogs are already fluid + keyboard-aware |
| packages/editor/src/editor.css:108 | recovery dialog max-height min(calc(var(--visual-viewport-height, 100dvh) - 2rem), 42rem) | same pattern |
| packages/editor/src/components/ContentAwareFill/ContentAwareFillDialog.css:2 | max-width: 820px (base rule; needs a width cap to be safe) | widest feature dialog |
| packages/ui/src/components/components.css:528 | max-width: 760px | wide dialog |
| packages/editor/src/editor.css:2981 | max-width: 720px | wide dialog |
| packages/editor/src/components/FrequencySeparation/frequencySeparation.css:13 | max-width: 720px | wide dialog |
| packages/ui/src/components/radius-system.css:139 | max-width: 720px | dev gallery |
| apps/website/src/styles/global.css:957 | max-width: 720px | site dialog/content block |
| packages/editor/src/editor.css:6405 | .workspace-layouts max-width: 560px, max-height: min(75vh, 720px) | fixed 75vh height |
| packages/editor/src/components/Backup/backup.css:92 | max-width: 560px | wide dialog |
| packages/editor/src/components/Inspector/sections/ColorizeSection.css:331 | max-width: 560px, plus body min-width 420px (322) | 420px floor |
| apps/desktop/src/demo/demoBanner.css:17 | max-width: 1200px | banner |
| apps/website/src/styles/global.css:337 | .container-custom max-width: 1200px | site container |
| two-column forms | 45 CSS rules using repeat(2, minmax(0, 1fr)) or 1fr 1fr; top files: ContentAwareFillDialog.css (5 rules at 76, 159, 208, 218, 224), inspector.css (3 at 1844 and 2529), adjustment.css:62, tonalEditors.css:12, AIPerformancePanel.css:34, CodePanel.css:508 | most do not collapse (no container/media rule in the same file) |
| native <select> | packages/ui/src/components/NativeSelect.tsx:50 is the only production <select> renderer; other 8 hits are tests; used by WorkspaceCustomizeDialog.tsx, DepthMaskSection.tsx, ToolOptionsPopover.tsx, QuickConvertDialog.tsx, ContentAwareFillDialog.tsx | AGENTS.md "no native <select>" is enforced via this wrapper only |
| packages/editor/src/components/Inspector/inspector.css:2252 | input rows: label + 92px control grid; 2839 label + 5.5rem control; 4870 .insp-stepper__input width 3.25rem | fixed secondary column cannot grow |

## K. Marketing site

| file:line | evidence | risk |
| --- | --- | --- |
| apps/website/src/styles/global.css:1 | 1043-line global stylesheet (token import, Tailwind layers, components layer, scroll-x) | layout owner |
| apps/website/src/styles/theme.css:1 | 477-line semantic theme layer | theme owner |
| apps/website/src/layouts/Layout.astro:562 | @media (max-width: 700px) page-shell rule | 700px site shell breakpoint |
| apps/website/src/styles/global.css:159-161 | @tailwind base/components/utilities plus tailwind.config.mjs and astro.config.mjs:50 | Tailwind pipeline is still active (148 utility-class occurrences in .astro) |
| apps/website/src/components/SiteHeader.astro:793 | @media (max-width: 79.999rem) hides desktop nav, shows mobile-nav fallback/toggle | mobile nav starts below 1280px, not 768 |
| apps/website/src/components/SiteHeader.astro:781 | 64rem-79.999rem compact nav (hides demo/search, site-version) | 1024-1280 band |
| apps/website/src/components/SiteHeader.astro:773 | min-width 80rem shows search trigger | desktop full nav at >=1280 |
| apps/website/src/components/SiteHeader.astro:64-76 | <details data-nav-details> desktop disclosure menus | hover/click menus; focus/Escape handling in script |
| apps/website/src/components/SiteHeader.astro:133-148 | mobile-menu-toggle button + full-screen mobile-nav-dialog | proper dialog pattern |
| apps/website/src/components/SiteHeader.astro:601 | mobile nav sheet padding env(safe-area-inset-*) | inert without viewport-fit=cover (G) |
| apps/website/src/components/SiteHeader.astro:810 | @media (max-width: 24rem) nav wrap rule | supports 320-384px |
| apps/website/src/components/TrustStrip.astro:47 | base grid repeat(4, minmax(0,1fr)); 97 <=900 -> 2 cols; 118 <=480 -> 1 col | good ladder |
| apps/website/src/components/ProductShowcase.astro:158 | base grid minmax(280px, 0.85fr) minmax(0, 1.6fr); 198 minmax(220px, 0.7fr); 402 <=980 -> 1fr; 416 <=720 | 280/220px minimum side |
| apps/website/src/components/Hero.astro:257 | hero floating cards only at min-width 1100 (base display none at 252) | fixed-position cards removed below 1100 |
| apps/website/src/components/Hero.astro:453, 555 | hero content max-width 880px; <=640 CTAs stack (flex-direction column, max-width 340) | 375 layout handled |
| apps/website/src/styles/global.css:650 | .bento-grid repeat(var(--bento-cols, 3), minmax(0, 1fr)); 748-755 <=640 collapses to 1fr and span 1 | bento is responsive |
| apps/website/src/pages/index.astro:255, 302, 390 | page grids 1.1fr 0.9fr, 1.05fr 0.95fr, 1fr 0.85fr; 538-543 <=860 collapses workflow/local-first/interface to 1fr; 554-560 <=560 beta links column | 768 gets single column |
| apps/website/src/pages/docs.astro:137, 161-163 | docs-grid repeat(3, minmax(0,1fr)); <=760 -> 1fr | 768 -> single column |
| apps/website/src/pages/download.astro:1290 | quick-download grid repeat(3, 1fr); @media 720 at 1744 collapses it to 1fr at 1759 | 768 -> single column |
| apps/website/src/pages/compare.astro:109-110 | 680px-min table inside .scroll-x with tabindex/role/aria-label | horizontal scroll region at 375 |
| apps/website/src/pages/download.astro:655-663 | distro-picker scroll region with tabindex/role | horizontal scroll region |
| apps/website/src/pages/features/design-tokens.astro:234 | matrix-scroll overflow-x auto, table min-width 760px | horizontal scroll region |
| apps/website/src/components/SiteFooter.astro:245, 460-521 | base 2-col grid; <=1100 1fr; <=720 3-col link grid; <=480 2-col; <=420/330 further collapse | 4-step footer ladder |
| apps/website/src/components/SearchDialog.astro:326 | <=480 rule; 315 coarse-pointer rule | mobile search handled |

Behavior at 375px (from code): mobile nav toggle is active (<1279.98rem), hero cards hidden (<1100),
hero CTAs stack (<=640), bento 1 column (<=640), trust strip 1 column (<=480), footer link grid 2 columns
then 1 (<=480/420/330), page grids 1 column (<=860/760), compare/matrix/disto tables scroll horizontally.
At 768px: mobile nav still active, hero cards hidden, hero CTAs row (640-1100), bento stays 3-col (only
collapses <=640), workflow/interface/local-first grids 1 column (<=860), docs grid 1 column (<=760),
product showcase 1 column (<=980), trust strip 2 columns (<=900).

Horizontal-scroll risks on the site: fixed min-width tables (compare 680px, matrix 760px) are wrapped and
keyboard-scrollable; docs-table-wrap scroller is applied at docs/chromeos-linux.astro:308 but other docs
tables (docs/performance.astro:41, about/license.astro:80) have no wrapper or min-width; body has no
overflow-x guard (global.css:176-184).

## L. Global styles + z-index

| file:line | evidence | risk |
| --- | --- | --- |
| apps/desktop/src/global.css:4-8 | *, *::before, *::after box-sizing: border-box | global reset |
| apps/desktop/src/global.css:10-20 | html, body margin/padding 0, width/height 100%, overflow: clip, overscroll-behavior: none, -webkit-tap-highlight-color: transparent | app page can never scroll; overflow is clipped |
| apps/desktop/src/global.css:46-56 | button/input/optgroup/select/textarea font reset to --type-interface-control-* | control typography contract |
| apps/desktop/src/global.css:58-61 | html text-size-adjust: 100%, -webkit-text-size-adjust: 100% | stops mobile text auto-boost |
| apps/desktop/src/global.css:68-80 | body font/interface role, background, antialiasing | base |
| apps/desktop/src/global.css:89-93 | #root width: 100dvw, height: 100dvh, overflow: clip | no vh fallback, clip hides overflow |
| apps/desktop/src/global.css:98-104 | .gpu-layer contain: layout style paint | clips fixed descendants (H) |
| packages/editor/src/editor.css:8-10 | html { min-width: 320px } | sole app viewport floor |
| apps/website/src/styles/global.css:163-184 | @layer base: html scroll-padding-top 5.5rem (172), body typography (176-184), smooth scroll only with prefers-reduced-motion: no-preference (164-168) | site has no min-width and no overflow-x guard |
| packages/ui/src/tokens/tokens.css:424-433 | z scale --z-base 0, raised 10, sticky 50, dropdown 100, popover 200, overlay 1000, dialog 1100, modal 1150, toast 1200, tooltip 1300 | canonical overlay scale |
| z-index usage | 61 var(--z-*) uses vs 86 numeric literals in scoped CSS | two systems coexist |
| packages/editor/src/editor.css:1 | 14 numeric z-index rules (most of any file); layers.css 6, UpscaleDialog.css 6, effectStudio.css 5, prototype.css 5, CropOverlay.css 4, inspector.css 4, home.css 4, color-picker.css 4, Ruler.css 3 | numeric literals bypass the scale |
| packages/editor/src/editor.css:68 | .editor-shell__skip-link z-index: 10000 | above overlay scale (escape hatch) |
| packages/home/src/home.css:26 | skip link z-index: 10000 | same |
| packages/ui/src/components/StartupLoader.css:21 | z-index: 9999 | above all toasts/tooltips |
| apps/desktop/index.html:205 | boot fallback z-index: 2147483646 | top of stack |
| packages/ui/src/components/components.css:723 | .varve-floating-layer z-index: calc(var(--z-overlay) + 10) = 1010 | above drawers/backdrop |
| packages/editor/src/editor.css:2246 | .editor__panel-backdrop z-index: calc(var(--z-overlay) - 1) = 999 | drawer layering |
| packages/editor/src/components/Inspector/inspector.css:901 | uses --elevation-z-overlay (other name) at 901/1725/2173 | third z vocabulary in addition to --z-* and literals |
| packages/editor/src/onboard/ContextualHelp/ContextualHelpPanel.css:1 | z-index: calc(var(--z-overlay) + 10) | onboarding above drawers |
| packages/ui/src/components/components.css:1927 | toast container stacks above --statusbar-height + keyboard inset | toast must clear mobile keyboard |
| packages/home/src/home.css:3304 | .drawer-overlay z-index: var(--z-overlay) | home mobile drawer |
| packages/editor/src/editor.css:2180 | <=899 panels z-index: var(--z-overlay); library panel +1 at 2199-2207 | editor mobile drawers |

Mobile-overlay planning note (evidence only): the app already reserves overlay 1000, backdrop 999,
floating layer 1010, toast 1200, tooltip 1300, startup 9999, skip link 10000, boot 2147483646; any new
mobile sheet should slot below the startup/boot outliers and above the panel backdrop.
