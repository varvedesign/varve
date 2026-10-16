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

The source model, schema version 2.34, and transform evaluator are in place.
Canvas rendering, direct manipulation, hit testing, bounds, expansion, and
portable export must all consume this evaluator before repeats are considered
a user-facing feature. Marketing must not claim live repeats until those paths
and save/reopen behavior have visual evidence. Current native saves preserve
the authored recipe and source group; older documents migrate without changing
their scene content.

See [ADR-0242](../adr/0242-live-artwork-source-and-evaluation.md) for the
shared source-ownership and evaluation contract, and the [issue regression
ledger](../research/live-artwork-issue-regression-ledger-2026-10-15.md) for
reports that informed the bounds and seam requirements.
