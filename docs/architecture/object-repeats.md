# Object repeats

Object repeats are source-preserving scene generators owned by a group. The
group children remain the only authored artwork; evaluated instances are
derived from the group's `objectRepeat` recipe. Object repeats are distinct
from `PatternFill`, which repeats a tile as paint inside one shape.

## Recipe contract

`ObjectRepeat` currently defines three local-space arrangements:

- **Grid** stores total rows and columns including the source, plus local
  origin spacing. Instances are ordered row-major, with the authored source
  at index zero.
- **Radial** stores total instances including the source, a local rotation
  center, and a sweep angle. Full turns divide by the instance count so the
  first and final instances do not overlap.
- **Mirror** stores enabled local axes and a local reflection center. It emits
  the source, then horizontal, vertical, and combined reflections when enabled.

`objectRepeatTransforms` in `packages/scene/src/objectRepeat.ts` is the single
pure transform evaluator. It limits grid axes to 32, radial instances to 512,
and all evaluated output to 512 transforms. Malformed numeric inputs receive
finite defaults and are clamped before any list is allocated.

## Integration status

The source model, schema version 2.34, and transform evaluator are integrated
with the numeric group inspector, Canvas2D structural replay, structured scene
replay, hit testing, and repeated world bounds. The authored group remains the
only source subtree, so edits to its children feed every evaluated copy. Native
save preserves the recipe and source group; older documents migrate without
changing their scene content.

This slice is still incomplete. The inspector exposes numeric controls, but
there are no canvas handles, no release/expand command, and no first-class
copy-to-document workflow. Portable SVG/PDF/raster exports and thumbnail paths
still need independent structural and pixel verification before marketing can
make a fidelity or editability claim. Singular group transforms intentionally
fall back to the authored source only. The evaluator caps output at 512
instances; very large requested grids/radials are bounded rather than rendered
without limit.

See [ADR-0242](../adr/0242-live-artwork-source-and-evaluation.md) for the
shared source-ownership and evaluation contract, and the [issue regression
ledger](../research/live-artwork-issue-regression-ledger-2026-10-15.md) for
reports that informed the bounds and seam requirements.
