# Task 04b — Remaining dialog form-grid collapse

Status: deferred — 2026-10-29 session-2 recon corrected the drifted paths and found the cited grids are not viewport-dependent; only ContentAwareFill is a real dialog and its grids sit in a fixed 260px rail. The real phone defect is the dialog shell, filed below. | Depends on: 04a (done) | Rollback: — (not started)
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

## Session-2 recon (2026-10-29) — citations drifted, defect not reproduced
- The audit/task path `components/Inspector/dialogs/ContentAwareFillDialog.css`
  does not exist; the real file is
  `components/ContentAwareFill/ContentAwareFillDialog.css` (606 lines, zero
  @media). Its 2-col grids (79,162,211,221,228,234) and the 4-col mask
  operations (168) live inside a **fixed 260px left rail**, so they measure
  ~122px at every viewport including desktop — not a viewport-dependent defect.
- `Inspector/inspector.css:1844` is `.insp-paint-advanced__pair` (StrokeSection,
  an inspector drawer, not a dialog); `:2529` is repeat(6).
  `AdjustmentLayer/adjustment.css:66` and `tonalEditors.css:14` are inspector
  sections; `CodePanel/CodePanel.css:512` is the docked auxiliary panel. None is
  a dialog grid.
- Only ContentAwareFill is a real dialog (Shell.tsx:1137-1145; opened from the
  layer/canvas context menu `Generative Edit...` or the inspector button; gate =
  settings.ai.enabled + one image layer). It is reachable at 375/390, but its
  real phone defect is the SHELL: at 375 the 260px rail leaves the preview
  ~30-35px. A grid collapse rule does not fix that.
- If re-opened: 375x812/390x844/768x1024/1180x820/1366x1024 with an imported
  image, no dialog/document horizontal overflow, keyboard order unchanged;
  screenshots at 375 and 1180. Ready-made repro recipe:
  tests/e2e/caf/generative-entry-points.spec.ts:13-32 (navigateToEditor, import
  tests/e2e/fixtures/real-life-still-life.jpg, right-click layer, Generative
  Edit...). Smallest family rule if reproduced:
  `@media (max-width:480px) { .varve-dialog--caf { width:100vw; height:100dvh;
  max-width:none; max-height:none } .caf-dialog__body { flex-direction:column;
  overflow-y:auto } .caf-dialog__left { width:auto; flex:none }
  .caf-dialog__right { min-height:180px; flex:none } }`.
- Verdict: defer 04b as written (grid collapse), and track the CAF shell at
  <=480px as the real follow-up defect instead.
