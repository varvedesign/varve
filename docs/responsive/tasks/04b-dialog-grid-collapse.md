# Task 04b — Remaining dialog form-grid collapse

Status: deferred — the cited fixed-floor defect was dead CSS (removed in 04a); real dialog 2-column grids were not reproduced at phone width in this campaign and each family needs its own reproduction first. | Depends on: 04a (done) | Rollback: — (not started)
Split from: tasks/04-forms-and-modals.md on 2026-10-29T15:59:01-07:00

## Scope
The 45 rules using repeat(2, minmax(0, 1fr)) or 1fr 1fr in dialog CSS:
- packages/editor/src/components/Inspector/dialogs/ContentAwareFillDialog.css
  76/159/208/218/224
- packages/editor/src/components/Inspector/inspector.css 1844/2529
  (dialog-specific grids only; row targets belong to 03b)
- packages/editor/src/components/Inspector/adjustment.css:62
- packages/editor/src/components/Inspector/tonalEditors.css:12
- packages/editor/src/components/ColorPanel/CodePanel.css:508

## Failure mode
Audit D4: dense two-column form grids in dialogs have no collapse rule, so at
320-390px the labels/controls become narrower than their content and fields
clip or overflow their dialog. Only reproduced where a dialog is actually
opened at phone width.

## Change
Split by dialog family before starting (ContentAwareFill first, then the
remaining surfaces). For each reproduced dialog: add a container/width query
that collapses the affected 2-column grids to one column at <=480px. One dialog
family per commit. No shared varve-dialog primitive edits.

## Validation
Per family: 320x640, 375x812, 390x844, 768x1024, 1180x820, 1366x1024; no
horizontal overflow inside the dialog or document; labels/controls do not clip;
keyboard order unchanged. Screenshots at 375 and 1180 per family.

## Rollback
Revert the per-family commit; CSS-only.

## Size check
NOT one session: 5 CSS surfaces across several dialog families. Split again per
family at session start; defer families not reached (record deferred + reason
in STATE.md, not silently skipped).
