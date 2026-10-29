# Task 01a — Safe-area foundation (viewport-fit=cover + inset chrome)

Status: not-started | Depends on: none | Rollback: — (not started)
Split from: tasks/01-global-viewport-foundation.md on 2026-10-29T15:59:01-07:00

## Decision (this unblocks original task 01)
Validation method: emulated safe-area insets over CDP on the installed
Playwright 1.62.1 Chromium (151.0.7922.34). `Emulation.setSafeAreaInsetsOverride`
with the nested shape `{ insets: { top, bottom, left, right } }` (flat shape is
rejected) makes `env(safe-area-inset-*)` resolve for real in the page; proven
with a computed-style probe (47/34/11/12 px padding on a probe element, with and
without viewport-fit=cover in the emulator — the meta is therefore also asserted
structurally). Real-device evidence remains a manual checklist
(docs/responsive/device-checklist.md); the code no longer blocks on it.

## Scope
- apps/desktop/index.html (viewport meta only)
- apps/website/src/layouts/Layout.astro (viewport meta only)
- packages/editor/src/editor.css (shell inset padding; fixed drawer/FAB/exit-focus geometry; three static --menubar-total-height definitions)
- packages/editor/src/components/Settings/layoutPresentation.css (tablet fixed-drawer inset only)
- packages/ui/src/components/components.css (toast container horizontal insets; its existing bottom env stays)
- apps/website/src/styles/global.css (.container-custom inline insets only)
- apps/website/src/components/SiteHeader.astro and SiteFooter.astro (top/bottom + inline insets only)
- NEW scripts/responsive/safe-area.mjs + package.json script entry validate:safe-area
- NEW docs/responsive/device-checklist.md (manual evidence list)

## Failure mode
Audit D2: the 8 env(safe-area-inset-*) declarations in editor.css,
layoutPresentation.css, components.css and SiteHeader.astro are inert because
neither entry document sets viewport-fit=cover. apps/desktop/public/manifest.json
is display:standalone, so the installed app can run edge-to-edge on a notched
iPhone/iPad and paint interactive chrome under the notch, status bar and home
indicator. No shell chrome (menubar, tab strip, status bar, fixed drawers, FABs,
toasts) consumes insets at all today.

## Change
1. Add viewport-fit=cover to both viewport meta tags.
2. Give .editor-shell ONE inset padding using env(safe-area-inset-top/right/bottom/left, 0px).
   This insets every grid area (header, tab strip, layers/canvas/inspector, bottom
   panels, status) in a single place instead of duplicating padding per component.
   Desktop/Tauri is byte-identical because all four values resolve to 0.
3. Patch geometry that is viewport-relative and therefore not covered by shell
   padding: add safe-top to the three static --menubar-total-height definitions;
   add safe left/right/bottom to the fixed drawer projections at <=899px and in
   the >=900px tablet/dock-fallback projections; add safe top/right to
   .editor-shell__exit-focus; add horizontal safe insets to the toast container
   while keeping its existing bottom env.
4. Site: header padding-top, footer padding-bottom, .container-custom and
   .site-nav inline insets, and the fixed analytics-consent card bottom/right.
   The mobile-nav dialog already carries full env padding and starts working
   once the meta is present.
No new layout and no breakpoint-value changes.

## Validation
- NEW `pnpm validate:safe-area`: CDP insets 47/34/11/12 at 390x844; asserts the
  meta string, .editor-shell padding, header/tab/status offsets, fixed drawer
  top/bottom/left/right, FAB and exit-focus geometry, toast math, and no
  document horizontal overflow. Site: served build asserts header/footer/
  container insets and the meta. Screenshots: editor 320x640 + 390x844, site
  home 375x800 + 768x900 under docs/responsive/screenshots/<sha>/safe-area/.
- `pnpm validate:responsive --app all --reuse-website-dist` PASS, fresh <sha>
  screenshot set committed.
- Desktop equivalence at 1440x900: layout geometry identical (env() = 0).
- Audits: audit:filesize (new script <=400 lines), audit:emoji, biome on
  changed JS, audit:docs after the new device checklist is linked.
- Real device: docs/responsive/device-checklist.md stays unchecked until an iOS
  run; recorded as a known limitation, not a blocker.

## Rollback
Revert the task 01a commit; every change is additive CSS/meta and the new
script/package entry, so no data or schema migration is involved.

## Size check
Fits one focused session: one meta pair, one shell inset, a bounded set of
fixed-position geometry corrections, two site components, one 300-line script,
one checklist. The breakpoint-constant extraction is split out to task 01b.
