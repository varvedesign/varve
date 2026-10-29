# Task 01 — Global viewport foundation (safe-area cover + breakpoint constants)

Status: blocked | Depends on: none | Rollback: — (not started)

## Scope
- apps/desktop/index.html (viewport meta)
- apps/website/src/layouts/Layout.astro (viewport meta + top-level inset padding)
- packages/editor/src/editor.css and site global.css (only the inset padding rules)
- new shared breakpoint constant module if the task is split (see under Change)

## Failure mode
Audit D2: 10 env(safe-area-inset-*) declarations on 7 lines in 4 files are
inert because neither entry document sets viewport-fit=cover. On notched iOS
devices in landscape/standalone the portrait sheet cap, toasts and mobile nav
sheet therefore ignore the notch/gesture bar. Second failure mode (D8):
breakpoints are literal values in 229 app @media blocks (44 distinct widths)
and 124 site blocks; the --bp-* token group (tokens.css:436-440) has zero
consumers and JS repeats the 899 literal in 6 files.

## Change
1) Add viewport-fit=cover to the app and site viewport meta. 2) Add inset
padding to the app shell top-level chrome and to the site header/footer and
mobile nav sheet using the existing env() pattern; keep desktop (Tauri, no
insets) byte-identical. 3) Replace the duplicated 899/768 matchMedia literals
with one exported constant (e.g. packages/editor/src/workspace/breakpoints.ts)
without changing any value. Do not migrate @media literals in this task; CSS
custom properties cannot be used in media queries, so a token migration needs
its own task with a generated-CSS plan.

## Validation
- Structural: meta tag present in both documents; no page overflow at 320,
  375, 390, 768, 1024, 1180, 1366, 1440, 1536 in the harness.
- Safe-area values cannot be produced on this Linux/Chromium host: the only
  acceptable evidence is an emulated-inset harness (override the env() results
  via an injected test custom property) or a real iOS screenshot. Choose and
  record the method before editing.
- Screenshots: editor-home-320, editor-home-390, site-home-375, site-home-768
  in docs/responsive/screenshots/<sha>/.

## Size check
Meta + inset padding is one session (2 documents + 2 CSS files). The
breakpoint-constant extraction is a second session; split before starting.

## Blocker question (recorded in STATE.md)
How do we validate env(safe-area-inset-*) on this host? Options: (a) inject
a test-only custom-property override and assert the padding math; (b) add a
Playwright CDP emulation of safe-area insets if the installed Chromium
supports it; (c) defer to a real iOS device/manual checklist. Recommended:
(a) for the math + (c) for the device evidence.