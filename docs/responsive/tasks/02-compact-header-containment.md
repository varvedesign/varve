# Task 02 — Compact header containment (context bar + Share)

Status: done | Depends on: none | Rollback: 59bd283a9 (revert restores clipping; no schema/data change)

## Scope
- packages/editor/src/editor.css (the .editor-shell__header-row block only)
- tests/e2e/responsive/compact-header-containment.spec.ts (new)

## Failure mode
Audit D1, measured at 2026-10-29: at 320x640 the context-bar Text pill
(x 274..348), Pen pill (351..425) and the Share control (438..484) paint
beyond the viewport; at 390x844 Pen (351..426) and Share (439..485) do. The
document scroll width stays 320/390 because html/body overflow: clip, so the
controls are unreachable by pointer and there is no scroll container: the
.context-control-bar has overflow-x: auto but flex-shrink: 0, so it is
content-sized and never overflows itself. Desktop (640+) is unaffected.

## Change
In the header-row layout authority, make the context bar shrink and own the
overflow instead of the row: .editor-shell__header-row > .context-control-bar
{ flex: 1 1 auto; min-width: 0; } while the Share control keeps flex: 0 0 auto.
Do not add a duplicate overflow rule in the component stylesheet; do not touch
the menubar rail or status bar (both already scroll internally and are
correct), and do not hide any tool.

## Validation
- Fine pointer Chromium: 320x640, 375x667, 390x844, 480x640, 640x400,
  768x1024, 1024x768, 1180x820, 1366x1024, 1440x900.
- Assertions: documentElement.scrollWidth <= innerWidth; header row and Share
  fully inside the viewport and hit-testable; every ccb tool pill reachable
  after scrollIntoView (internal scroller); at >=1366 the context bar is not
  scrolling (clientWidth >= scrollWidth) so desktop chrome is unchanged.
- Coarse pointer (hasTouch): Share >= 44x44 and inside the viewport at 390.
- Keyboard: focus the Share control and the last visible ccb pill; both keep
  a visible focus ring and are reached by Tab.
- Screenshots (committed by task 08): editor/320x640-header.png,
  editor/390x844-header.png, editor/1366x1024-header.png and the matrix
  editor-default shots.
- Desktop equivalence: 1440x900 frame before/after must differ only inside the
  context bar's scroll region (no Share/toolbar/tab-strip movement).

## Size check
One CSS rule + one spec file: comfortably one session.