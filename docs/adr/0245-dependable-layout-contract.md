# ADR-0245: Dependable editable layout contract

**Status:** Accepted for implementation
**Date:** 2026-10-15

## Context

Varve already has a pure TypeScript layout package used by editor mutations. The
Rust `varve-layout` crate wraps Taffy but has no production caller and leaves
grid parsing incomplete. Layout output is materialized into the existing scene
nodes, so renderers, hit testing, history, save files, and exports can share one
resolved result without a second layout tree.

The contract must preserve authored intent and old files while making edits,
resizes, imports, and grid operations predictable. A visual guide grid is a
canvas aid; an auto-layout grid owns child placement. Fixed size is distinct
from fixed-on-scroll. Hug measures content; it is not a one-time resize action.

## Decisions

1. `@varve/layout` remains the single authoring/reflow solver. It is DOM-free;
   renderers consume scene geometry. Do not add a second runtime solver or make
   native rendering reflow independently.
2. Scene coordinates and intrinsic dimensions use floating-point document px.
   Resolved positions stay unrounded. Stroke footprint is included only when
   `includeBordersInLayout` is enabled; ink effects do not affect measurement.
3. Fixed sizing preserves authored geometry and its min/max values remain
   inactive, matching current documents. Hug measures participating children
   plus padding and spacing. Fill gets the remaining line or cell budget after
   definite/intrinsic contributions. Minimum overflow remains visible and is
   diagnosed; no negative geometry or implicit clipping is allowed.
4. Flex wrapping chooses membership from hypothetical bases before final Fill
   distribution. Flexible items use their minimum contribution (or zero) as
   their base. Each line then resolves Fill and bounds independently. `rowGap`
   and `columnGap` override `gap` on their matching physical axes; absent
   overrides inherit `gap`. Explicit signed flow gaps remain supported;
   distributed auto spacing never creates accidental negative gaps.
5. Grid tracks support fixed px, `auto`, `fr`, and bounded fixed-count
   `repeat()`. Invalid, non-finite, nested, or unsupported syntax is rejected
   by the parser; the solver retains materialized geometry and the inspector
   explains the failed template. `minmax()`, auto-fit/auto-fill, percentages,
   and masonry are unsupported until implemented end to end. `layoutSemanticsVersion: 2`
   resolves intrinsic and spanning contributions before fractional tracks and
   repeats the final authored definition for implicit tracks. Missing or `1`
   preserves legacy resolution, including repeating the prior resolved pixel
   size, so older artwork does not shift silently.
6. Grid placements reserve full spans. Explicit collisions invalidate the
   computed placement set and the inspector reports the collision. There is no
   overlap opt-in. Dense packing is opt-in and does not change reading or
   keyboard order. Deleting a track previews deterministic rehoming and never
   deletes its artwork. A reorder that would make a span discontinuous is
   refused until that span is edited.
7. Constraint `center` keeps its existing proportional behavior. Add
   `centerOffset` for a child whose center offset from the parent center remains
   constant. No existing document is silently converted.
8. Persistent per-track identities live alongside the authored template
   strings. When the grid inspector opens, it derives deterministic IDs for
   tracks that do not have them; the IDs persist when the user commits an edit.
   There is no 2.33 → 2.34 migration. Subsequent reorder/insert/delete
   operations move IDs with their definitions. Track/cell edits, constraints,
   and guide edits use one existing document command/history transaction.
9. Invalid layouts keep their last materialized geometry. The bounded grid
   solver returns typed failure reasons and the layout inspector explains
   invalid track syntax or identities, bounds, gaps, cell anchors, collisions,
   and track/placement limits without mutating the document. Flex reports
   invalid bounds/results and visible main-axis overflow; invalid geometry
   keeps the last materialized child positions. A child that Fills an axis
   inside a parent that Hugs that same axis gets a user-facing warning; the
   deterministic minimum-contribution policy still resolves the geometry.
10. Supported importers preserve editable rules and cell anchors. If a source
    layout cannot be represented, import keeps its fixed geometry and reports
    the unsupported fields instead of attaching a partial live layout.

## Behavior matrix and acceptance oracles

| Case | Required result |
|---|---|
| 500px row; one 100px Fixed item; two equal zero-basis Fill items; two 10px gaps | Fill items are 190px each |
| 230px wrapped row; four Fill items with 100px minimum; 10px item gap | Two items per line; each resolves to 110px |
| Same wrapped row with 24px row gap and 10px column gap | Second line begins 44px below the first; item spacing remains 10px |
| 300px grid; `auto 1fr`; first track intrinsic demand 100px | Tracks resolve to 100px and 200px |
| Legacy grid without a semantics version; existing implicit-track geometry | Existing resolved pixel-size repetition is preserved |
| Child x=60, width=40, parent width 200 → 300; `centerOffset` | Child x becomes 110; its -20px center offset is retained |
| Center constraint on an older file | Existing proportional behavior remains unchanged |
| One child in Between/Around/Evenly; zero, spare, or negative free space | Results are deterministic, non-negative for auto spacing, and preserve explicit signed gaps only |
| Invalid track input, colliding spans, oversized repeat/count/depth | No unbounded work or geometry overwrite; the inspector reports the bounded grid failure |
| Flex items cannot shrink enough to fit the available main-axis space | Finite child rectangles remain visible and the inspector reports overflow |
| Flex bounds or resolved geometry are non-finite | Reflow keeps prior child geometry and the inspector explains the invalid layout |
| A flow child Fills the same axis its auto-layout parent Hugs | Inspector identifies the axis-specific cycle; hidden and absolute children do not warn |
| Save/reopen, duplicate/detach, importer first edit, undo/redo | Authored sizing/track/anchor rules remain editable and the initiating edit is one undo entry |

## Consequences

TypeScript remains authoritative for layout mutation, while the Rust crate is
documented as an unused adapter scaffold until a real production caller and
parity boundary are approved. Scene schema changes require a migration and
round-trip coverage. CSS code generation maps only semantics it can preserve;
resolved fallback output carries an explicit loss diagnostic.

## References

- [CSS Flexible Box Layout Module Level 1](https://www.w3.org/TR/css-flexbox-1/)
- [CSS Grid Layout Module Level 2](https://www.w3.org/TR/css-grid/)
- [Figma layout-version behavior](https://help.figma.com/hc/en-us/articles/42031586813719-Use-auto-layout-with-CSS-Flexbox-in-mind)
- [Varve layout evidence ledger](../research/layout-system-evidence-2026-10-15.md)
