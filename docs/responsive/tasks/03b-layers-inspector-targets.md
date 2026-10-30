# Task 03b — Layers/inspector target and fixed-column defects

Status: in-progress — fix landed 2026-10-29, independent re-measurement pending | Depends on: 02 (done) | Rollback: revert the 03b commit (CSS-only)
Split from: tasks/03-tables-and-dense-data.md on 2026-10-29T15:59:01-07:00

## Scope
- packages/editor/src/components/LayersPanel/layers.css (row targets only)
- packages/editor/src/components/Inspector/inspector.css (dense control rows /
  2-6 column grids only; dialog-specific grids belong to 04b)
- the layers components if a target cannot be enlarged in CSS

## Failure mode
Audit-raw I/F: layers rows are 28-32px with 24px disclosure triangles; only
coarse-pointer promotion reaches 44px, and the audit found promotion is opt-in
per component (98 --touch-target-min uses in 17 files). Inspector dense grids
use 2-6 column tracks with no compact rule. Reproduce before editing; the
bounded audit did not reproduce a page-level overflow, only marginal targets.

## Change
Only for reproduced defects: enlarge row action hit areas to the 24x24 SC 2.5.8
floor (44px on coarse) without changing visual row height, using pseudo-element
or padding redistribution; add a compact collapse rule for a reproduced dense
grid. Do not rewrite shared panel structure. If nothing reproduces, record the
measurements and close with no code change.

## Validation
- Fine + coarse Chromium at 320, 390, 768, 1024, 1180, 1366, 1440 with Layers
  and Inspector open.
- elementFromPoint hit test for every row action; no clipped bulk-bar actions.
- Screenshots committed: layers-1024x768, layers-1366x1024 and
  inspector-1180x820 (plus coarse variants) under
  docs/responsive/screenshots/<sha>/.

## Rollback
Revert the task 03b commit; CSS-only.

## Size check
Fits one session (two panels, reproduced defects only).
