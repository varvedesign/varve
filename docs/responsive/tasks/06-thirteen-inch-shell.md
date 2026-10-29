# Task 06 — 13–14in shell and window geometry

Status: done | Depends on: none (uses task 08 harness) | Rollback: 738c9a943 (revert restores 1280x800 / 900x600 minimum)

## Scope
- apps/desktop/src-tauri/tauri.conf.json (main window block only)
- validation through scripts/validate-responsive.mjs (matrix already contains
  1180x820, 1366x768, 1366x1024, 1024x1366, 1280x800, 1512x982)

## Failure mode
Audit D6/D7: the desktop window opens at 1280x800 with min 900x600. A common
13in 1366x768 panel exposes ~1366x728 of work area at 100% scaling, so the
default window is taller than the screen; at 125% scaling the CSS work area is
~1093x614 and minHeight 600 leaves ~14px of headroom, while minWidth 900 stops
users reaching the compact layout the app validates down to 320/480. The
13–14in viewport band (1180x820, 1366x1024, 1366x768, 1440x900, 1512x982) was
absent from automated coverage, so a regression here would be invisible.

## Change
Set the main window default to 1180x720 (fits 1366x768@100% work area), keep
the window centered so it can never open off the visible work area, and lower
the minimum to the layout-validated compact floor 480x400 (the e2e matrix
already exercises 480x640 and 640x400). No other window flags change. Add the
13–14in band to the committed harness matrix (task 08 owns the file) so the
geometry is asserted at 1180x720 and at 1093x614 (the 125% scaling equivalent).

## Validation
- JSON parses; Tauri config schema fields unchanged apart from the four values.
- Harness editor matrix passes with no page overflow at 1180x720, 1093x614,
  1180x820, 1366x768, 1366x1024, 1024x1366, 1440x900, 1512x982.
- Screenshots: editor-default-1366x1024.png, editor-default-1180x820.png,
  editor-default-1366x768.png, editor-default-1024x1366.png.
- Note the real window-manager clamp is a packaged-app check; Chromium cannot
  prove OS placement, so this task validates the geometry contract and the
  viewport band, not Windows/macOS window placement.
- Result (2026-10-29, harness commit 7d81006e6): editor matrix PASS at
  13in-125pct-scaling-1093x614 and 13in-window-default-1180x720, plus
  1180x820, 1366x768, 1366x1024, 1024x1366, 1280x800, 1440x900, 1512x982 —
  no page-level overflow; report at docs/responsive/screenshots/7d81006e6/.

## Size check
One config block + harness matrix already written: one session.