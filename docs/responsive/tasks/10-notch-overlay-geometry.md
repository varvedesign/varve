# Task 10 — Notch-safe floating overlay geometry

Status: deferred (carried risk #4; recipe captured 2026-10-29 second session) | Depends: 01a | Rollback: — (not started)
Split: 10a product geometry, 10b harness probe — do not combine with other tasks.

## Scope
- packages/ui/src/components/overlayGeometry.ts — `safeAreaInsets()` + inset-aware `safeViewportRect`/`visualViewportClampRect`
- packages/ui/src/components/components.css — `:root` env() bridge custom properties
- packages/editor/src/components/Onboarding/SpotlightOverlay.tsx — tooltip placement clamp
- NEW packages/editor/src/components/Onboarding/spotlightGeometry.ts + its unit test
- scripts/responsive/safe-area/* — overlay checks under emulated landscape insets

## Failure mode
No JS overlay code reads `env(safe-area-inset-*)`. `FloatingPortal` clamps to the
layout viewport + 8px (`resolveCollisionRegion`/`safeViewportRect` in
overlayGeometry.ts) and `SpotlightOverlay`'s `left`/`right` placements use raw
`window.innerWidth` with no clamp, so landscape-notch insets (47px left/right
on iPhone-class devices) can place menus, tooltips, selects and the onboarding
tour tooltip under the notch. CSS chrome already consumes the insets (task 01a);
only JS-positioned surfaces are notch-blind.

## Change (10a — product geometry, one commit)
1. components.css `:root`: publish `--varve-safe-area-top/right/bottom/left`
   as `env(safe-area-inset-*, 0px)` (env() resolves to 0 on desktop/Tauri).
2. overlayGeometry.ts: new `safeAreaInsets(ownerDocument)` reads the four
   custom properties via `getComputedStyle(documentElement)` with a 0 fallback
   (jsdom/older shells); subtract them in `safeViewportRect` and
   `visualViewportClampRect` so every FloatingPortal consumer inherits the fix
   (Tooltip, Menu, Select, Combobox, MultiSelect, QuickActionsBar,
   FloatingTextBar, menubarSubmenu); export the helper.
3. SpotlightOverlay: move placement math into a pure
   `spotlightGeometry.ts` helper (one responsibility) that clamps
   top/bottom/left/right placements and maxWidth/maxHeight into the
   inset-adjusted viewport; keep the existing estimated-size heuristic.
4. Tests: overlayGeometry.test.ts zero-default + mocked-inset cases;
   spotlightGeometry.test.ts pure placement cases. Test bodies <=15 lines.

## Change (10b — harness probe, second commit)
Extend scripts/responsive/safe-area/* under `LANDSCAPE_INSETS {top:0,
bottom:21, left:47, right:47}` from scripts/responsive/safe-area/config.mjs:
open a menubar menu, hover a context-bar pill tooltip, and start the onboarding
tour (Help > Start Tour); assert `.varve-floating-layer`, `[role=tooltip]` and
`.spotlight-overlay__tooltip` are fully inside the inset-adjusted rect. Keep the
env()=0 desktop baseline assertion (zero delta).

## Validation
- `pnpm test:agent packages/ui/src/components/overlayGeometry.test.ts` and the
  new spotlightGeometry test pass.
- `pnpm validate:safe-area` PASS with the new overlay checks; screenshots at
  1180x820 and 1366x1024 landscape notch plus the 1440x900 env()=0 baseline,
  committed under `docs/responsive/screenshots/<sha>/safe-area/`.
- Desktop: env()==0 must keep the 1440x900/1536x864 frames byte-identical
  against the previous evidence set.
- Real-device note: manual checklist in docs/responsive/device-checklist.md is
  still required for a physical notch; CDP emulation proves the CSS contract.

## Rollback
Revert the 10a/10b commits (additive geometry + CSS custom properties only).

## Size check
Fits two sessions if split as 10a/10b; 10a alone fits one. Do not run 10a and
10b in one commit — the smoke blast radius of the FloatingPortal seam is the
reason. Re-open with a reproduced notch screenshot from the CDP harness.
