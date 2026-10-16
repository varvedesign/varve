# Layout-system evidence ledger (2026-10-15)

Research was checked on 2026-10-15. Issue bodies and reports below are user
reports, not independently verified Varve diagnoses. Reproduce each relevant
failure against Varve before assigning a root cause. Later statuses must be
rechecked before they are repeated as current facts.

| Source | Bounded report | Varve evidence and decision | Regression / verification |
|---|---|---|---|
| [FigCraft #465](https://github.com/storytold/figcraft/issues/465) | Imported grid keeps approximate coordinates but loses track definitions and cell anchors; a later edit stacks children. The report is open and covers `.fig` and JSON import. | Audit both supported import paths for track sizing and anchor mapping. Preserve live rules only when represented completely; otherwise retain fixed geometry with an import-loss report. | Pending: import a grid, alter an unrelated property, then assert tracks, anchors, and geometry remain correct. |
| [FigCraft #460](https://github.com/storytold/figcraft/issues/460) | Its own FIG round trip changes Around/Evenly to Between without warnings. The issue's oracle checks stored enum values, not rendered positions. | Keep serialization assertions separate from geometry assertions; never normalize these modes into one another. | Pending: round-trip both authored value and independently computed child positions. |
| [FigCraft #467](https://github.com/storytold/figcraft/issues/467) | Import can omit unsupported data without a clear loss report. | Import diagnostics must identify dropped/approximated layout rules and retain a fixed-layout fallback. | Pending: unsupported layout import asserts both fallback and actionable report. |
| [DesignCraft #805](https://github.com/storytold/designcraft/issues/805) | Requests discoverable controls for grid authoring. It is a usability signal, not evidence that a particular competitor lacks controls. | Expose row/column tracks and placement editing in the inspector and canvas; keep track actions discoverable and keyboard reachable. | Pending: keyboard and pointer grid-authoring workflow. |
| [LightCraft #1263](https://github.com/storytold/lightcraft/issues/1263) | User report: controls/dialog content is clipped at 1366×768. This concerns editor UI layout, not document reflow. | Test the layout inspector and track dialogs at compact window sizes with scroll/focus reachability. | Pending: visual capture and keyboard access at 1366×768 and narrower. |
| [PhotoCraft #704](https://github.com/storytold/photocraft/issues/704) | Large row/column guide counts caused unbounded quadratic work; issue closed by #797 after adding a count limit. | Grid track parsing and placement now enforce caps before expansion/allocation; invalid templates preserve the last materialized geometry. | `computeGridLayout.test.ts`: rejects repeat count 129 and a huge integer, unsupported syntax, non-finite and negative gaps, colliding cells, and oversized spans. The 300px `auto 1fr` oracle passes in semantics v2, while the full suite preserves legacy implicit-track behavior: 83 layout tests passed on 2026-10-15. |
| [Penpot #12206](https://github.com/penpot/penpot/issues/12206) | On Windows, Penpot 2.18.3, Firefox and an unofficial desktop app: a nested component's text offset differed between SVG and OpenGL paths. Reporter could not reproduce naturally; issue remained open when checked. | Use it as a renderer-parity test class only; do not assume a Varve root cause or generalize across Penpot versions/backends. | Pending: compare Varve canvas, exported SVG, and reloaded geometry for nested text layouts. |
| [PDFCraft #1671](https://github.com/storytold/pdfcraft/issues/1671) | Resize cursor appeared while pointer drag missed the handle; preview pixels updated only at drag end. The issue was reported closed via #1677. | Layout track handles need hit-target and live-preview checks, not just a correct cursor or final geometry. | Pending: pointer-down, continuous preview, Escape, and commit/cancel E2E assertions. |
| [FilmCraft #639](https://github.com/storytold/filmcraft/issues/639) | Requested on-canvas transform handles with one-step undo and Escape cancel; closed via #667. This is a transferable interaction pattern, not layout-solver evidence. | Use direct manipulation only for visible track/guide affordances and preserve existing drag cancellation/history rules. | Pending: gesture cancels without mutation and commits once. |
| [EffectCraft #284](https://github.com/storytold/effectcraft/issues/284) | A UI issue list included controls/scrolling and scaling gaps later addressed in #391. This concerns panel usability. | Keep dense inspector sections scrollable and test full controls at compact heights. | Pending: compact inspector capture and keyboard traversal. |
| ArtCraft and DeckCraft issue searches | No directly applicable document auto-layout/grid/constraint report was found in the targeted issue searches; DeckCraft's surfaced rendering issue was not enough to infer a layout cause. | Do not force unrelated media generation or slide rendering issues into this feature. Revisit only if later evidence identifies a shared layout boundary. | Not applicable to the current behavior matrix. |
| [Figma layout-version guide](https://help.figma.com/hc/en-us/articles/42031586813719-Use-auto-layout-with-CSS-Flexbox-in-mind) | Figma documents changed stroke influence, Fill sizing, and auto-gap behavior with existing files left on the legacy version until opted in. | Preserve current Varve semantics; use explicit new `centerOffset` rather than redefining existing `center`; preview any future semantic migration. Apply constraints to absolute children inside auto-layout frames while flow items reflow independently. | `constraints.test.ts`: center-offset resize oracle passes and the legacy proportional-center oracle remains unchanged. Inspector tests: 21 passed; `TransformEngine.test.ts`: 33 passed, including a constrained absolute child in a resized layout frame, on 2026-10-15. |
| [CSS Flexbox Level 1](https://www.w3.org/TR/css-flexbox-1/) and [CSS Grid Level 2](https://www.w3.org/TR/css-grid/) | Standards define per-line flexible sizing/freezing and intrinsic track contributions before flexible tracks. | Use as bounded conformance references. Document deliberate design-editor differences such as signed flow gaps and scene-pixel units. | Pending: exact arithmetic fixtures and a bounded CSS overlap subset. |

## Current Varve source audit

- `packages/layout/src/reflow.ts` is called by editor sizing and structural
  mutations; it writes resolved geometry into the existing scene.
- `packages/layout/src/computeFlexLayout.ts` now forms wrap lines from
  hypothetical bases, resolves flexible sizes per line, redistributes around
  min/max bounds, and maps independent row/column gaps to physical axes.
- `packages/layout/src/computeGridLayout.ts` now rejects unsupported track
  syntax and bounds repeat expansion, placement spans, children, and cell work.
  `layoutSemanticsVersion: 2` resolves intrinsic/span contributions before
  fractional tracks and repeats authored implicit tracks; absent/version 1
  retains legacy sizing. Stable track identities and editor mutations remain.
- `packages/scene/src/constraints.ts` preserves proportional `center` and adds
  `centerOffset`, which keeps the child center's offset from the parent center.
- `crates/varve-layout/src/lib.rs` has no production callers and leaves grid
  templates as a stub; TypeScript remains the active layout solver.

## Status convention

`Pending` means the worktree implementation and runtime have not yet verified
the requirement. Update rows only with the exact test or runtime evidence and
code revision that passed; report unavailable platforms as unverified.
