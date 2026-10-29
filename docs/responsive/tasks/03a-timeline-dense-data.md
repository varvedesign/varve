# Task 03a — Timeline dense-data targets

Status: in-progress — fix landed 2026-10-29, independent re-measurement pending | Depends on: 02 (done), 01a (done) | Rollback: revert the 03a commit (CSS-only)
Split from: tasks/03-tables-and-dense-data.md on 2026-10-29T15:59:01-07:00

## Scope
- packages/editor/src/timeline/TimelinePanel.css (row/control targets only)
- timeline row components under packages/editor/src/timeline/ (only if a target
  cannot be enlarged in CSS)
- packages/editor/src/editor.css: the duplicate timeline label-width authority
  (audit-raw: TimelinePanel.css ~382 declares 120px, editor.css ~5542 declares
  140px); remove one so one file owns the column

## Failure mode
Audit-raw I/F: timeline rows are 28px with 16px mute/solo buttons and the label
column has two competing widths (120px vs 140px). The panel is a fixed 200px
tall at every viewport. The 24/28/32/40px control ladder only reaches 44px on
coarse pointers, so fine-pointer rows are WCAG 2.2 SC 2.5.8 marginal at 16px
targets. Reproduce before editing.

## Change
Reproduce first (screenshots at 1024x768, 1180x820, 1366x1024 with Layers and
Timeline open, fine + coarse pointer), then fix only reproduced defects:
- raise row action hit areas to the documented 24x24 SC 2.5.8 floor (44px on
  coarse pointers) with a pseudo-element or padding redistribution, WITHOUT
  changing the visual row height;
- delete the losing label-width authority so one file owns the column and the
  measured width is identical from both roles.
Keep the compact density ladder; do not raise every row to 44px on fine
pointers. If the reproduction shows no defect, record that evidence and close
with no code change.

## Validation
- Fine + coarse Chromium at 320, 390, 768, 1024, 1180, 1366, 1440.
- elementFromPoint hit test for every row action/checkbox at coarse pointer;
  WCAG 2.2 SC 2.5.8 24x24 floor plus 8px spacing where used.
- Timeline label column measured identical from both sources after the fix.
- Screenshots committed: timeline-1024x768, timeline-1180x820,
  timeline-1366x1024 (plus coarse-pointer variants) under
  docs/responsive/screenshots/<sha>/.

## Rollback
Revert the task 03a commit; CSS-only, desktop row geometry unchanged unless a
target was genuinely below the floor.

## Size check
Fits one session (one panel + one duplicate width). Layers/inspector targets are
split out to task 03b.
