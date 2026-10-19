# Auto Layout / Responsive Layout System

**Canonical doc** — audit status, model, engine, and known limitations.

## 1. Current State (2026-10-15)

| Capability | Scene Model | Engine | Inspector | Canvas | Tests | Status |
|---|---|---|---|---|---|---|
| Horizontal / vertical layout | ✓ | ✓ | ✓ | ✓ | ✓ | **Working** |
| Reverse direction | ✓ | ✓ | ✓ | ✓ | ✓ | **Working** |
| Padding | ✓ | ✓ | ✓ (per-side) | ✓ | ✓ | **Working** |
| Gap | ✓ | ✓ | ✓ | ✓ | ✓ | **Working** |
| Wrap | ✓ | ✓ | ✓ | ✓ | ✓ | **Working** — was ignoring the flag entirely; fixed |
| Alignment (cross-axis) | ✓ | ✓ | ✓ | ✓ | ✓ | **Working**, incl. per-child override + hug/stretch conflict resolved |
| Distribution (justify) | ✓ | ✓ | ✓ | ✓ | ✓ | **Working**, incl. new spaceEvenly; spaceAround/spaceEvenly offset-accumulation bug fixed |
| Fixed size | ✓ | ✓ | ✓ | ✓ | ✓ | **Working** |
| Fill container | ✓ | ✓ | ✓ | ✓ | ✓ | **Working** — was equal-split; now correct fill-after-fixed |
| Hug contents (leaf children) | ✓ | ✓ | ✓ | ✓ | ✓ | **Working** |
| Hug contents (frame sizing itself) | ✓ | ✓ | ✓ | ✓ | ✓ | **Working (new)** — recursive bottom-up resolution |
| Per-axis sizing (width ≠ height mode) | ✓ | ✓ | ✓ | ✓ | ✓ | **Working (new)** |
| Absolute-positioned children | ✓ | ✓ | ✓ | ✓ | ✓ | **Working (new)** — filtered from flow, hug, gap |
| Hidden children | ✓ | ✓ | N/A | N/A | ✓ | **Working (new)** — filtered from flow, hug, gap |
| Min/max constraints | ✓ | ✓ | ✓ | ✓ | ✓ | **Working** — Fixed bounds remain visible but inactive |
| Relative sizing | ✓ | ✓ | ✓ | ✓ | ✓ | **Working (new)** — literal percentages retain their authored reference |
| Nested layout (multi-level, hug + fill mixed) | ✓ | ✓ | N/A | ✓ | ✓ | **Working (new)** — was single-level only |
| Cycle handling (fill inside hug) | ✓ | ✓ | ✓ | N/A | ✓ | **Working** — broken by construction (min-size contribution); same-axis Fill/Hug configurations show an inspector warning |
| Grid layout | ✓ | ✓ | ✓ | ✓ | ✓ | **Working** — repeat tracks, occupant mapping, spans, and constrained application |
| Grid hug/intrinsic sizing | ✓ | ✓ | — | — | ✓ | **Working** — px/auto tracks measure through the shared grid resolver; fractional tracks contribute no unconstrained size |
| Grid hidden/absolute filtering | ✓ | ✓ | — | — | — | **Working (new)** — parity fix, not deeply tested |
| Components/instances | ✓ | ✓ | ✓ | N/A | ✓ | Grid rules and stable child track anchors survive instantiation, document save/reopen, and detach; see the regression test. Component override and master-propagation coverage remains separate. |
| Text intrinsic sizing | ✓ | ✓ | N/A | ✓ | ✓ | **Working** (measureText), confirmed visually |
| Codegen | ✓ | N/A | N/A | N/A | ✓ | **Working with target diagnostics** — authored sizing survives intermediate conversion |
| Save/reopen | ✓ | N/A | N/A | N/A | ✓ | **Working** — schema 2.26 migration normalises optional sizing fields |
| Undo/redo | ✓ | N/A | N/A | N/A | — | **Untouched this pass** — goes through the existing updateDoc/history path, not independently re-verified |

## 2. Architecture

```
Scene Model (persistent, packages/scene/src/types.ts)
    │
    ├── FrameNode.layoutStyle       → container properties (direction, gap, padding, align, justify, wrap)
    ├── NodeBase.layoutSizing       → legacy unified sizing (fixed/hug/fill), kept for back-compat
    ├── NodeBase.layoutSizingWidth  → per-axis width sizing (falls back to layoutSizing)
    ├── NodeBase.layoutSizingHeight → per-axis height sizing (falls back to layoutSizing)
    ├── NodeBase.layoutPosition     → flow | absolute
    ├── NodeBase.layoutAlign        → per-child cross-axis alignment override
    └── NodeBase.minWidth/maxWidth/minHeight/maxHeight → constraints, enforced on every axis regardless of sizing mode
    │
    ▼
Layout Engine (@varve/layout — pure TS, no DOM)
    │
    ├── measure.ts            → shared: node natural size, optional visible-border footprint, flow filter, min/max clamp
    ├── computeFlexLayout()   → row/column/reverse, wrap, gap, padding, align/justify, fill-after-fixed, per-axis sizing, min/max
    ├── computeGridLayout()   → explicit tracks, auto-flow, placement overrides (unchanged this pass)
    ├── intrinsicSize.ts      → resolveIntrinsicSizes(): bottom-up hug resolution across a subtree
    ├── reflow.ts             → reflowLayoutChildren(): the single entry point (see phases below)
    └── cycleDetection.ts     → checkLayoutCycle(): axis-aware diagnostic shown by the child layout inspector
    │
    ▼
Resolved Geometry (transform + w/h written back onto each node)
    │
    ▼
Render Pipeline (Canvas2D / selection overlay / export) — reads the same resolved geometry, no separate representation
```

### `reflowLayoutChildren(doc, frameId)` — the four-step pass

Called with the frame whose children (and, transitively, descendants) need laying out. Every layout-mutating editor action funnels through this one function — sizing-mode setters, padding/gap/align edits, canvas resize, insert/delete/reparent.

1. **Bottom-up intrinsic resolution** (`resolveIntrinsicSizes`): walks `frameId`'s subtree post-order (deepest frames first) and, for every frame whose width/height sizing is `hug`, recomputes its own box from its *already-resolved* flow children — natural size for fixed/hug children, `minWidth`/`minHeight` (or 0) for fill/grow children. Using the min size instead of an expanded size for fill children is what breaks the classic "parent hugs child, child fills parent" cycle by construction, without needing a runtime guard.
2. **Top-down flex/grid layout**: `computeFlexLayout` (or `applyGridLayout` for grid-mode) positions `frameId`'s children against its now-resolved box. Per axis, a child's geometry is only overwritten when that axis's sizing mode isn't `fixed` — hug children get their own (already-correct) size re-applied, fill/grow children get their computed share.
3. **Recurse into child layout frames**: any child that is itself a frame with `layoutStyle` gets `reflowLayoutChildren` called on it, now that its box is final, so deeper nesting resolves correctly.
4. **Propagate upward**: if `frameId`'s own size changed (because it hugs), that invalidates its parent's measurement, so the parent is reflowed too. Bounded by tree depth — a fill/hug pair can't oscillate because of the min-size contribution in step 1.

### Cross-axis hug vs. stretch

A child whose cross-axis sizing is `hug` never stretches, even under `alignItems: stretch` or an explicit `layoutAlign: 'stretch'` override sourced from the parent. Without this rule, a hug *frame* child would get stretched by its parent's alignment pass, then immediately shrink back to its intrinsic size on the next reflow (step 1 of the child's own recursive call) — visibly fighting itself. Hug is treated as the more authoritative signal: "sized by my own content," full stop.

### Authored sizing and occupied geometry

`layoutSizingWidth` and `layoutSizingHeight` are independent. A Relative axis
stores `layoutRelativeWidth` or `layoutRelativeHeight` as a finite percentage
of the parent content budget; values above 100% remain literal and may
overflow. Switching to Relative derives a percentage from the current finite
reference, while a zero reference stores 100% and leaves an explanation for
the inspector. Switching to Fixed captures the current resolved geometry.

Min/max values remain serialised when an axis is Fixed so a later mode switch
does not lose authored intent, but the inspector renders those bounds inactive.
A Hug frame measures the union of its children, including overlaps from signed
flex gaps. `includeBordersInLayout` is opt-in and adds the maximum visible
stroke protrusion per edge; shadows, blur, and other effects do not contribute.

The resolved layout result is the source for canvas handles, hit testing,
thumbnails, and exports. Target emitters may provide a resolved snapshot when
their runtime cannot represent the authored responsive behavior.

### Dependable layout contract (2026-10-15)

The exact behavior matrix and versioning rationale are recorded in
[ADR-0245](../adr/0245-dependable-layout-contract.md). Existing documents keep
the legacy grid sizing interpretation when `layoutSemanticsVersion` is absent
or `1`; new grid layouts opt into version `2`. This avoids silently shifting
saved artwork when intrinsic grid sizing is corrected.

- Flex wrapping resolves line membership from hypothetical bases before Fill
  distribution. Flexible space is allocated per line, and items that reach a
  min/max bound release or consume their remaining share through another
  allocation pass. Signed flow gaps remain supported and are not CSS gaps.
- Physical row and column gaps stay independent. In a row flow, column gap is
  main-axis spacing and row gap is cross-axis spacing; a column flow maps them
  to the opposite physical axes.
- Grid track syntax is limited to bounded `px`, `fr`, `auto`, and bounded
  `repeat()` definitions. Unsupported expressions are rejected before
  expansion. Track arrays carry stable identities; grid cell anchors and spans
  follow those IDs through reorder and resize. Removing a referenced track
  opens a before/after preview and deterministically rehomes placements only
  when the candidate remains valid.
- The grid-track edit is one document update and one history action. The grid
  solver remains the source of resolved geometry; the inspector preview is a
  proposed document, not a second layout result.
- Absolute children inside layout frames continue to use responsive
  constraints. `centerOffset` is a distinct anchor policy that preserves the
  child's center offset from the parent's center; existing proportional
  `center` behavior is unchanged.
- HTML/CSS code generation preserves grid tracks, independent gaps, anchored
  child tracks, and spans when the target has equivalent CSS primitives.

The supporting [evidence ledger](../research/layout-system-evidence-2026-10-15.md)
records competitor reports with their reproduction limits. Native Tauri
interaction and supported-browser resize checks remain a separate runtime
verification gate and are not inferred from solver tests.

## 3. Files Changed

### Layout Engine (`packages/layout/src`)
- `measure.ts` — **new**. Shared `measureNodeSize`, `isFlowParticipant`, `axisSizing`, `clampAxis`.
- `computeFlexLayout.ts` — rewritten. Fixes: wrap flag ignored, fill-after-fixed distribution (was equal split), per-axis sizing support, hidden/absolute filtering, min/max clamping, spaceAround/spaceEvenly offset accumulation, hug-vs-stretch conflict.
- `computeGridLayout.ts` — hidden/absolute filtering parity fix.
- `intrinsicSize.ts` — **new**. Recursive bottom-up hug sizing.
- `reflow.ts` — rewritten. Two-phase (bottom-up measure, top-down layout) with recursion into child frames and upward propagation.
- `index.ts` — exports for the new modules.
- `__tests__/autolayout.test.ts`, `__tests__/reflow.test.ts` — expanded (engine bug regressions, hug/nested/cycle-breaking coverage).

### Scene Model (`packages/scene/src`)
- `types.ts` — `layoutSizingWidth`, `layoutSizingHeight`, `layoutPosition`, `layoutAlign`, `spaceEvenly` (pre-existing from an earlier pass on this branch, verified still correct).
- `canonical.ts` — new fields added to canonical key order.

### Editor (`packages/editor/src`)
- `context/layoutChildSetters.ts` — **new**. `applySelectedLayoutChildField`: batch-apply a sizing/position field to a selection and reflow every affected frame (the changed node itself when it's a frame with `layoutStyle`, plus its parent). Extracted out of `context.tsx` to stay under its complexity ceiling.
- `context.tsx` — `setSelectedLayoutSizing/Width/Height/Position` and `setNodeLayout` now reflow after mutating (previously wrote the field and did nothing else — no visible effect until an unrelated action happened to trigger a reflow).
- `context/types.ts` — new setter signatures.
- `components/Inspector/sections/LayoutChildSection.tsx` — **new**. Flow/absolute position + per-axis width/height sizing controls for non-frame children of a layout frame.
- `components/Inspector/sectionRegistry.ts` — new `layout-child` section id (was incorrectly sharing `layout`'s frame-only availability gate, which meant the section above never rendered until this fix).
- `components/Inspector/PropertiesPanel.tsx` — wires `LayoutChildSection` under the new id.
- `canvas/inputPipeline.ts` — unrelated one-line fix (`canvasRectRef` missing from a destructured parameter list, crashing on any canvas drag). Found while visually verifying; not part of Auto Layout but blocked all interactive testing.

## 4. Known Limitations (see final report for full prioritization)

- **Cycle warning is diagnostic only**: `checkLayoutCycle` detects same-axis Fill/Hug parent-child pairs, including per-axis sizing, and the child inspector explains the deterministic minimum-contribution policy. It does not block the edit because the engine already breaks the sizing loop deterministically.
- **Absolute-child constraints** apply during layout-frame reflow, while flow children are arranged independently. `centerOffset` preserves the child's signed offset from the parent center; legacy `center` remains proportional. Native interaction coverage across rotation and cancel/undo is still pending.
- **Canvas reordering**: dragging a single flow child within its existing flex frame now updates scene child order and reflows in the same undo transaction. A visual insertion indicator, multi-child reordering, and gap/padding drag handles remain future work.
- **Real typographic baseline alignment** is not implemented; `alignItems` has no `baseline` option, which is correct per the "don't expose a fake option" principle rather than an oversight.
- **RTL/logical direction** (`start`/`end` independent of `left`/`right`) is not modeled — `row`/`column` are physical, not logical.
- Figma REST JSON imports preserve the supported grid track subset, row/column gaps, manual cell anchors/spans, and row auto-flow. Unsupported grid syntax, placements, or cell alignment falls back to fixed imported geometry with an explicit loss warning. Component instantiation preserves root layout rules and child anchors across save/reopen and detach. A grid-bearing native `.fig` fixture, component override propagation, full editor undo/redo browser workflows, and native target output still need the final matrix.
