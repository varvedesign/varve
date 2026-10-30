# Task 03b — Layers/inspector target and fixed-column defects

Status: done (1009de823) | Depends on: 02 (done) | Rollback: revert 1009de823, 358d9ae2c, b8ae12951 (CSS-only)
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

## Verification (2026-10-29, HEAD 1009de823)

Independent drawer-aware probe (repro-broker's scene/measurement recipe, re-run
by the Lead; results + screenshots in
docs/responsive/screenshots/1009de823/dense/):

- Layers Solo at the 259.6px docked 1180 presentation: `soloAction` is now
  `display:flex`, 24x24, hit-testable at rest and hover on fine and coarse
  (was `display:none` for both pointer types). Details still yields at
  <=260px by design (panel header + context menu remain the routes); at 1366
  both details and solo are 24x24 hittable.
- Layers row still fits: 239.6px row inside a 259.6px panel; document
  scrollWidth == innerWidth at every run. At 1024x768 (drawer projection) solo
  and details remain hover-revealed on fine pointer (width 0 at rest, 24x24 on
  hover) — pre-existing design, unchanged.
- Timeline mute/solo: boxes are now token-sized 24x24 and the keyframe no
  longer out-stacks the label, so effective elementFromPoint extents are
  28x26 (solo) and 26-27x26 (mute) with centre hits in all five runs (was
  16-19x23); label remains 27px inside the 28px row and unclipped.
- Residual carried: layers Solo effective width on coarse at 1180 measures
  20x24 (centre reachable; row is 2.8px narrower than the last slot). Not a
  lost action; noted rather than silently claimed perfect.

## Rollback
Revert 1009de823, 358d9ae2c then b8ae12951 (CSS-only; restores the <=260px
Solo/Details fallback, 16px timeline mute/solo boxes, and equal label/keyframe
z-index).

## Size check
Fits one session (two panels, reproduced defects only).
