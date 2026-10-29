# Task 04 — Forms and modals at phone widths

Status: split 2026-10-29 → tasks/04a-colorize-dialog.md + tasks/04b-dialog-grid-collapse.md.
This file is kept as original audit context.

## Scope
- packages/editor/src/components/Inspector/sections/ColorizeSection.css:322
- the 45 rules using repeat(2, minmax(0, 1fr)) or 1fr 1fr in dialog CSS
  (ContentAwareFillDialog.css 76/159/208/218/224, inspector.css 1844/2529,
  adjustment.css:62, tonalEditors.css:12, CodePanel.css:508)

## Failure mode
Audit D4: the Colorize dialog body has min-width: 420px, wider than a 375px
viewport, so the dialog cannot fit a phone. Dense two-column form grids in
the same dialogs have no collapse rule in the same file. Shared varve-dialog
is already fluid (min(90vw, 32rem)) and keyboard-capped, so the defect is
per-dialog floors, not the shared primitive.

## Change
Reproduce the Colorize dialog at 375x812 and 320x640 first (open it through
the real UI). Replace the fixed floor with a capped one
(min(420px, calc(100vw - 2rem))) and add container/width rules that collapse
the affected 2-column grids at <= 480px. One dialog per commit.

## Validation
- 320x640, 375x812, 390x844, 768x1024, 1180x820, 1366x1024.
- Dialog fits the viewport, body scrolls, footer actions reachable, no
  horizontal document overflow; keyboard focus order unchanged.
- Screenshots per dialog at 375 and 1180.

## Size check
One session per dialog family. Start with Colorize only.