# Task 03 — Tables and dense data surfaces

Status: split 2026-10-29 → tasks/03a-timeline-dense-data.md + tasks/03b-layers-inspector-targets.md.
This file is kept as original audit context.

## Scope
- packages/editor/src/timeline/TimelinePanel.css and the timeline row components
- packages/editor/src/components/LayersPanel/layers.css (row targets only)
- packages/editor/src/components/Inspector/inspector.css (2–6 column grids)

## Failure mode
Audit-raw I/F: timeline rows are 28px with 16px mute/solo buttons
(TimelinePanel.css:382) and a 120px fixed label column duplicated as 140px in
editor.css:5542; the panel is a fixed 200px tall (TimelinePanel.css:13) at
every viewport. The dense control ladder (24/28/32/40px, tokens.css:332-344)
means only coarse-pointer promotion reaches 44px, and the audit found the
promotion is opt-in per component (98 --touch-target-min uses in 17 files).
Layers rows are 28–32px with 24px disclosures. Most reflow is already handled
by container queries, so this task is about reachable targets and duplicated
fixed columns, not about a new layout.

## Change
Reproduce first (screenshots at 1024x768, 1180x820, 1366x1024 with Layers and
Timeline open, fine + coarse pointer). Then, only for reproduced defects:
raise row action hit areas to the documented floor without changing row
height visually (pseudo-element or padding redistribution), and remove the
duplicate timeline label-width authority so one file owns the column. Keep
the compact density ladder; do not raise every row to 44px.

## Validation
- Fine + coarse Chromium at 320, 390, 768, 1024, 1180, 1366, 1440.
- ElementFromPoint hit test for every row action/checkbox at coarse pointer;
  WCAG 2.2 SC 2.5.8 24x24 floor plus 8px spacing where used.
- Timeline label column measured identical from both sources after the fix.
- Screenshots: layers-1024x768, layers-1366x1024, timeline-1180x820.

## Size check
Timeline + layers + inspector is too broad for one session: split timeline
and inspector into separate tasks at start. This file covers the reproduced
defect set only.