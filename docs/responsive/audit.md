# Phase 1 — Responsive audit (2026-10-29)

Scope: editor shell + Home + marketing site. Evidence sources:

1. docs/responsive/audit-raw.md — 292 ripgrep/wc evidence rows over 182 CSS files
   and the scoped TS/TSX/Astro, produced by the Phase-1 auditor teammate.
2. Runtime probes — Playwright 1.62 (Chromium) against the real app at
   Vite :1420, 13 fine-pointer viewports 320x640 … 1536x864 plus four
   coarse-pointer/tablet contexts, measuring document scroll width, shell/
   header/panel geometry, per-control clipping, internal scroll containers,
   and hit-testability. Raw JSON: .tmp-resp/probe/results.json (session-local,
   not committed; reproduced by scripts/validate-responsive.mjs).
3. Prior campaign records: docs/audits/responsive-layers-inspector-2026-09-30.md
   (open items O1–O8) and docs/architecture/responsive-workspace.md (contract).

## Runtime baseline (measured 2026-10-29, before this session's fixes)

Editor, fine pointer, document scroll width never exceeded the viewport at any
of the 13 tested widths (320, 375, 390, 640, 768, 820, 1024, 1180, 1366, 1440,
1512, 1536). Shell fills the viewport; canvas width measured 320–928 CSS px;
at the 13–14in targets: 1180x820 canvas 635px, 1366x1024 canvas 758px,
1366x768 canvas 758px, 1024x1366 canvas 551px — the band is structurally
healthy, so the 13in gap is a coverage/evidence gap, not a layout collapse.

Home: no horizontal overflow at any tested width (320–1536).

Coarse-pointer contexts (hasTouch, no fine pointer): 820x1180 → compact tier,
launcher FABs 44x44, zero targets below 24px of 49 interactive elements;
1024x1366 / 1180x820 / 1366x1024 stayed in docked-panel presentation in the
probe (any-pointer: fine still reported in headless Chromium; see D7/limits).

Real defects found (measured, reproducible):

### D1 — Compact header row clips the context tools and Share — HIGH, FIXED in 59bd283a9 (task 02); regression spec passes 2/2

Measured at 320x640: context-bar pills 'Text' x=274..348, 'Pen' x=351..425 and
the Share button x=438..484 — all beyond the 320px viewport, document scroll
width 320 (so they are clipped by html/body overflow: clip, not scrollable).
At 390x844: 'Pen tool' 351..426 and Share 439..485 beyond 390. At 640x400 and
1280x800: clean. Cause: .editor-shell__header-row is a flex row (space-between)
with .context-control-bar carrying flex-shrink: 0 from ContextControlBar.css,
so the context bar is content-sized, its own overflow-x: auto never engages,
and Share is pushed past the window edge. The menubar rail and status bar are
NOT affected (both are genuine internal scrollers: at 320 menubar
scrollWidth 342/clientWidth 262; status scrollWidth 339/clientWidth 320).

### D5 — Marketing dense tables have no scroll wrapper — MEDIUM, FIXED in 26e8dc5a6 (task 07); Chromium route check clean at 320/375/768/1366

apps/website/src/pages/about/license.astro:80 (.license-table) and
apps/website/src/pages/docs/performance.astro:41 (.perf-table) render tables
without the shared .scroll-x region used by compare.astro:109 and
download.astro:655 (overflow-x: auto; tabindex=0; role=region; aria-label).
The site body has no overflow-x guard (global.css:176-184), so a table that
cannot wrap creates page-level horizontal scroll — the one failure the site's
own reflow corpus forbids. Neither route is in reflow.spec.ts ROUTES.

### D6 — Tauri window geometry is desktop-only — MEDIUM, FIXED in 738c9a943 (task 06); harness validates 1180x720 + 1093x614 (7d81006e6)

apps/desktop/src-tauri/tauri.conf.json:18-21 opens at 1280x800 with min
900x600. A 1366x768 13in laptop has ~1366x728 of work area at 100% scaling
(window taller than the screen), and at 125% scaling ~1093x614 CSS px;
minHeight 600 leaves 14px of headroom and minWidth 900 prevents using the
validated compact tiers below that. The app's own e2e matrix already covers
480x640 and 640x400, i.e. the layout supports far smaller windows than the
desktop shell allows.

### D2 — Safe-area insets are inert — MEDIUM, FIXED in 95f2b82a0 (task 01a)

10 env(safe-area-inset-*) declarations on 7 lines in 4 files (editor portrait
sheets, toasts, tablet offsets, site mobile nav) but neither
apps/desktop/index.html:5 nor apps/website/src/layouts/Layout.astro:210 sets
viewport-fit=cover, so iOS resolves every inset to 0. Resolved: both metas now
set viewport-fit=cover; .editor-shell carries one inset padding for all grid
areas; the viewport-relative fixed overlays (drawers, launchers, toasts, exit
control, contextual help, safe-mode indicator, skip links) add the insets
individually; the site header/footer/container/nav/consent card do the same.
Validation: CDP Emulation.setSafeAreaInsetsOverride on Chromium 151 gives real
env() values, covered by 124 automated checks; real iDevice evidence remains
docs/responsive/device-checklist.md.

### D3 — Function carried by hover only — MEDIUM (task 03)

27 hover-reveal rules, 5 with no focus path, e.g. layers AI badge
(layers.css:1160), Home asset-browser insert (home.css:2566), IconBrowser
favourite (IconBrowser.css:403); GraphEditor keyframe values are hover-only
JS (GraphEditor.tsx:407); 353 title= tooltips (20 in chrome) never surface
on touch. Touch-only users can lose these affordances.

Reproduced subset for dense data (2026-10-29, task 03): timeline label column is
computed 120px because TimelinePanel.css wins document order, but the dead
editor.css 140px rule still contributes align-items/font-size and mixes the
cascade, leaving the label 37.9-38.2px tall inside the 28px row (~10px overflow
onto the next row, 7px horizontal clip). Timeline mute/solo boxes are 16px and
their ::before hit extension measures only 18px asymmetric; the 0%-keyframe dot
covers the solo centre at 1024/1180/1366 fine and 1024 coarse. At a docked 320px
timeline the panel content (368-370px) clips horizontally with no scroller.
Layers: disclosure 24x24 hittable; eye/lock are hover-collapsed on fine pointer
but coarse-visible; at container width <=260px solo and details are
display:none for both pointer types (touch loses solo at the 1180 docked
presentation). These are the task 03a/03b reproduced defects.

### D4 — Fixed dialog floor wider than a phone — DEAD CSS, NOT REPRODUCIBLE (task 04a, measured 2026-10-29)

Colorize dialog body min-width: 420px (ColorizeSection.css:330; the audit-raw
citation :322 drifted) exceeds a 375px viewport, but the whole 9-rule
.colorize-dialog__* block has ZERO consumers: `rg colorize-dialog|ColorizeDialog`
over packages/apps/tests matches only that CSS block (no TS/TSX, no rendered
element at 1180x820 / 375x812 / 320x640; dialog[open]=0). The real Colorize
surface is the inspector disclosure .insp-disclosure[data-section-id="colorize"]:
document scrollWidth == innerWidth at 375/320, both actions inside the viewport
and elementFromPoint-hittable after scrolling .insp-panel. Task 04a therefore
closes as no-defect; the only action is deleting the dead rules (cleanup), not
adding a capped min-width. Other dialog 2-column grids remain unreproduced
(task 04b).

### D7 — 13–14in band missing from automated coverage — MEDIUM, COVERED in 7d81006e6 (task 06/08)

tests/e2e/interaction/chromeos-device-matrix.spec.ts covers 15 entries
(960x600, 1200x750, 1280x800, 800x1280, … 640x400) but none of 1180x820,
1366x768, 1366x1024, 1024x1366, 1440x900, 1512x982. Runtime probes found no
defect there, so the first deliverable is coverage + committed screenshots,
not a speculative layout rewrite.

### D8 — Untokenized breakpoints — LOW/MEDIUM (task 01)
229 app @media blocks with 44 distinct viewport values; website 124 blocks /
35 values; JS repeats the 899 literal in 6 files and Home repeats 768; the
--bp-* token group has zero consumers. Maintainability risk that will keep
producing drift, but not a user-visible defect.

### D9 — Viewport-unit and z-index inconsistencies — LOW (task 01/09)
#root uses 100dvh with no vh fallback (global.css:89-93); svh/lvh unused; 72
production innerWidth/innerHeight reads with 14 copies of the same '-120'
chrome estimate (context.tsx:684 et al.). Overlay z-index mixes 61 var(--z-*)
uses with 86 numeric literals plus a third --elevation-z-* vocabulary.

## Prior known-open items — re-checked

| Item (2026-09-30 audit) | Status today |
|---|---|
| O1 dock chrome covers tab strip at 200% text | still open; not touched (ownership: dock geometry) |
| O2 legacy vs dock resize handles | still open; not touched |
| O3 six pre-existing spec failures (setRail etc.) | out of this scope; not re-run |
| O4 stale navigator visual baseline | still open; do not regenerate blindly |
| O5 layers bulk-bar containment | still open; pre-existing |
| O6 short-height rail minor clipping | still open; minor |
| O7 doc says 25–36dvh portrait sheet, CSS ships 72dvh cap | still mismatched; do not edit the owned doc without the tablet owner |
| O8 inspector value ellipsis at 200% text | still open; deferred by impact |

## What this audit did NOT establish

- No real iOS/iPadOS, Android, screen-reader, physical touch/pen, or packaged
  Tauri-host run; all geometry is emulated Chromium on Linux.
- env(safe-area-inset-*) values cannot be produced here; D2 stays unvalidated.
- Firefox/WebKit engines were not run for the new checks.
- The 13–14in band was probed at 5 sizes, not as a full device sweep; the new
  harness (task 08) makes the matrix repeatable, and task 06 adds the band to
  the permanent e2e matrix.
- Only the editor shell/Home and five marketing routes were audited; the
  backlog in inventory.md records what was not read.
