# Task 04a — Colorize dialog phone fit

Status: not-started | Depends on: 02 (done) | Rollback: — (not started)
Split from: tasks/04-forms-and-modals.md on 2026-10-29T15:59:01-07:00

## Scope
- packages/editor/src/components/Inspector/sections/ColorizeSection.css:322
  (the min-width: 420px floor)
- the same dialog's 2-column grid rules only if the reproduction shows they do
  not collapse at <=480px
- no shared varve-dialog primitive edits (it is already fluid:
  min(90vw, 32rem) and keyboard-capped)

## Failure mode
Audit D4: the Colorize dialog body has min-width: 420px, wider than a 375px
viewport, so the dialog cannot fit a phone. This was never exercised in a
screenshot; reproduce through the real UI first.

## Change
Reproduce the Colorize dialog at 375x812 and 320x640 first (open through the
real UI). Replace the fixed floor with a capped one
(min(420px, calc(100vw - 2rem))) and add container/width rules that collapse the
affected 2-column grids at <=480px. Body must scroll; footer actions must stay
reachable. One dialog per commit.

## Validation
- 320x640, 375x812, 390x844, 768x1024, 1180x820, 1366x1024.
- Dialog fits the viewport, body scrolls, footer actions reachable and
  hit-testable, no horizontal document overflow; keyboard focus order unchanged.
- Screenshots committed per dialog at 375 and 1180 under
  docs/responsive/screenshots/<sha>/.

## Rollback
Revert the task 04a commit; CSS-only.

## Size check
Fits one session (one dialog family). The remaining dialog grids are split out
to task 04b.
