# B-05 seam specification - filters split

Phase 02 output. One seam, one worktree, one commit. This specification exists
before any source edit and carries the hand-completed declaration inventory
(the planner seeds ranges; the destination decision is a review decision).

## Resolved values

| Key | Value |
|-----|-------|
| Batch / entry | B / B-05 |
| Worktree / branch | `.worktrees/B-05` / `seam/B/B-05-filters` |
| Base commit | `00b2fb62f083b5e507ca3281f8406472b74ab7dc` |
| Target | `packages/engine/src/filters.ts` - 2,134 lines, frozen at 2134 |
| Destination | `packages/engine/src/filters/` (directory = one seam) plus the existing `filters.ts` as a thin re-export entry |
| Covering test | `packages/engine/src/filters.test.ts` - 436 lines, 34 tests, frozen; not edited |
| Expected ratchet | 951 -> 950 frozen entries; exactly one entry removed; 0 added, 0 grown |
| Parent expected size | `filters.ts` barrel about 110 lines |
| Module cap | every destination module at or under 400 lines (350-400 target only where the concern is naturally that large) |

## Pre-flight evidence (clean worktree, before any edit)

```
$ git -C .worktrees/B-05 rev-parse HEAD
00b2fb62f083b5e507ca3281f8406472b74ab7dc
$ git -C .worktrees/B-05 status --porcelain=v1 -b
## seam/B/B-05-filters
$ pnpm audit:filesize
File-size budget OK: 6175 source files scanned; 951 over 400 lines, all frozen
in .file-size-baseline.json (tracked content).            (exit 0)

$ node scripts/quality/audit-file-size.mjs --report
Scanned 6175 source files; 951 over the 400-line cap; 951 frozen in
.file-size-baseline.json; 0 violation(s); 0 untracked WIP over-cap file(s).
Excess over cap: 307245 lines. Baseline entries: 951 (0 stale).

$ node scripts/quality/godsplit-plan.mjs packages/engine/src/filters.ts
Lines: 2134 | imports: 11 | blocks: 80               (exit 0)
Hazards: over-cap target; sub-split required for adjustmentToFilter
lines 909-1498 (590) and adjustmentDefaults lines 1681-2125 (445).

$ node scripts/quality/refactor-verify.mjs --base master     --target packages/engine/src/filters.ts --json
{"ok": true, "baseCount": 80, "presentCount": 80,
 "missing": [], "missingExports": []}                  (exit 0)

$ node node_modules/vitest/vitest.mjs run packages/engine/src/filters.test.ts
Test Files  1 passed (1); Tests  34 passed (34)         (exit 0; before-count)

$ direct recursive tsc substitute (check:agent:raw stages, before the move)
packages-checked=20 packages-fail=0
desktop-exit=0 desktop-diagnostics=0
e2e-exit=0 e2e-diagnostics=0
```

`pnpm install --frozen-lockfile` is unavailable (read-only pnpm store:
`ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`). The measured workaround was used:
22 `node_modules` symlinks from the main checkout plus the ignored
onnxruntime-libs copy, and `pnpm audit:filesize` exits 0 at 951.
`pnpm check:agent` is unavailable (validation queue EROFS on
`/run/user/1000/varve-validation-queue/exclusive.lock`); the direct tsc
program above is the measured substitution. The planner `--top` flag is not
implemented in this checkpoint (exits 2), so the supported no-flag invocation
was used.

## Single concern

Pure code motion of one module's declarations: the exported adjustment type
catalog, the per-kind conversion from `Adjustment` to `FilterIR`, the
per-kind defaults table, the CSS filter-chain fallback, the display-name helper,
and the kind guard. No behavior, API, rendering, error-state, or dependency
change. The module path and its 80 public names stay identical. The 15 files
that import `./filters` and `index.ts` are not edited.

## Hand-completed declaration inventory

Seed: `node scripts/quality/godsplit-plan.mjs packages/engine/src/filters.ts`
(80 blocks, 11 import declarations, hazards "over the 400-line cap",
"sub-split required: adjustmentToFilter lines 909-1498", "sub-split required:
adjustmentDefaults lines 1681-2125"). Each block was read in range and assigned
a destination; the destination column is the review decision. Kinds are the
planner's TS AST kinds; names are verbatim. Every declaration is exported in the
base file (planner export column: 80/80 yes); the barrel re-exports all 80.

| kind | name | lines | exported | destination module |
|------|------|-------|----------|-------------------|
| Variable | `ADJUSTMENT_KINDS` | 43-92 | yes | types |
| TypeAlias | `AdjustmentKind` | 94 | yes | types |
| TypeAlias | `AdjustmentBlendMode` | 96-113 | yes | types |
| Interface | `StudioTreatmentInstanceMetadata` | 125-131 | yes | types |
| Interface | `AdjustmentBase` | 133-141 | yes | types |
| Interface | `BrightnessAdjustment` | 143-146 | yes | adjustmentTypesTone |
| Interface | `ContrastAdjustment` | 147-150 | yes | adjustmentTypesTone |
| Interface | `ExposureAdjustment` | 151-156 | yes | adjustmentTypesTone |
| Interface | `SaturationAdjustment` | 157-160 | yes | adjustmentTypesTone |
| Interface | `HueSaturationAdjustment` | 161-164 | yes | adjustmentTypesTone |
| Interface | `HueRotateAdjustment` | 165-168 | yes | adjustmentTypesTone |
| Interface | `SepiaAdjustment` | 169-172 | yes | adjustmentTypesTone |
| Interface | `GrayscaleAdjustment` | 173-176 | yes | adjustmentTypesTone |
| Interface | `InvertAdjustment` | 177-180 | yes | adjustmentTypesTone |
| Interface | `OpacityAdjustment` | 181-184 | yes | adjustmentTypesTone |
| Interface | `BlurAdjustment` | 185-188 | yes | adjustmentTypesTone |
| Interface | `SharpenAdjustment` | 189-199 | yes | adjustmentTypesTone |
| Interface | `WhiteBalanceAdjustment` | 200-208 | yes | adjustmentTypesTone |
| Interface | `SplitToneAdjustment` | 209-219 | yes | adjustmentTypesTone |
| Interface | `TemperatureAdjustment` | 220-223 | yes | adjustmentTypesTone |
| Interface | `TintAdjustment` | 224-227 | yes | adjustmentTypesTone |
| Interface | `VibranceAdjustment` | 228-231 | yes | adjustmentTypesTone |
| Interface | `LevelsAdjustment` | 232-240 | yes | adjustmentTypesTone |
| Interface | `CurvesPoint` | 241-245 | yes | adjustmentTypesTone |
| Interface | `CurvesAdjustment` | 246-252 | yes | adjustmentTypesTone |
| Interface | `SelectiveColorAdjustment` | 253-270 | yes | adjustmentTypesTone |
| Interface | `ColorBalanceTriplet` | 271-275 | yes | adjustmentTypesTone |
| Interface | `ColorBalanceAdjustment` | 276-284 | yes | adjustmentTypesTone |
| Interface | `ChannelMixerRow` | 285-290 | yes | adjustmentTypesTone |
| Interface | `ChannelMixerAdjustment` | 291-300 | yes | adjustmentTypesTone |
| Interface | `PhotoFilterAdjustment` | 301-306 | yes | adjustmentTypesTone |
| Interface | `HalftoneAdjustment` | 307-350 | yes | adjustmentTypesTone |
| Interface | `GradientMapStop` | 352-361 | yes | adjustmentTypesCreative |
| Interface | `GradientMapOpacityStop` | 364-372 | yes | adjustmentTypesCreative |
| TypeAlias | `GradientMapLuminanceMode` | 375-384 | yes | adjustmentTypesCreative |
| Interface | `EmbeddedGradientColorStop` | 391-397 | yes | adjustmentTypesCreative |
| Interface | `EmbeddedGradientOpacityStop` | 399-405 | yes | adjustmentTypesCreative |
| Interface | `EmbeddedGradientMapSettings` | 408-424 | yes | adjustmentTypesCreative |
| Interface | `EmbeddedGradientPreset` | 426-445 | yes | adjustmentTypesCreative |
| Interface | `GradientMapAdjustment` | 447-484 | yes | adjustmentTypesCreative |
| Interface | `TritoneAdjustment` | 486-498 | yes | adjustmentTypesCreative |
| Interface | `ColorHalftoneAdjustment` | 500-510 | yes | adjustmentTypesCreative |
| Interface | `DuotoneAdjustment` | 512-521 | yes | adjustmentTypesCreative |
| Interface | `BlackAndWhiteAdjustment` | 523-534 | yes | adjustmentTypesCreative |
| Interface | `PosterizeAdjustment` | 536-539 | yes | adjustmentTypesCreative |
| Interface | `ThresholdAdjustment` | 541-546 | yes | adjustmentTypesCreative |
| Interface | `LutAdjustment` | 548-562 | yes | adjustmentTypesCreative |
| Interface | `DitherAdjustment` | 569-588 | yes | adjustmentTypesEffects |
| Interface | `PaletteSnapAdjustment` | 590-601 | yes | adjustmentTypesEffects |
| Interface | `BloomAdjustment` | 603-627 | yes | adjustmentTypesEffects |
| Interface | `RgbSplitAdjustment` | 629-651 | yes | adjustmentTypesEffects |
| Interface | `CrtAdjustment` | 653-670 | yes | adjustmentTypesEffects |
| Interface | `VhsAdjustment` | 672-689 | yes | adjustmentTypesEffects |
| Interface | `LightShaftsAdjustment` | 691-711 | yes | adjustmentTypesEffects |
| Interface | `LensFlareAdjustment` | 713-731 | yes | adjustmentTypesEffects |
| Interface | `LightLeakAdjustment` | 733-749 | yes | adjustmentTypesEffects |
| Interface | `CausticsAdjustment` | 751-775 | yes | adjustmentTypesEffects |
| Interface | `ShadowHighlightAdjustment` | 777-787 | yes | adjustmentTypesEffects |
| Interface | `MicroDetailAdjustment` | 790-792 | yes | adjustmentTypesEffects |
| Interface | `DefinitionAdjustment` | 795-797 | yes | adjustmentTypesEffects |
| Interface | `AtmosphereAdjustment` | 800-802 | yes | adjustmentTypesEffects |
| Interface | `DehazeAdjustment` | 805-807 | yes | adjustmentTypesEffects |
| Interface | `EdgeFalloffAdjustment` | 810-812 | yes | adjustmentTypesEffects |
| Interface | `GrainAdjustment` | 815-817 | yes | adjustmentTypesEffects |
| Interface | `SoftBloomAdjustment` | 820-822 | yes | adjustmentTypesEffects |
| Interface | `MotionBlurAdjustment` | 824-828 | yes | adjustmentTypesEffects |
| Interface | `MosaicAdjustment` | 830-835 | yes | adjustmentTypesEffects |
| Interface | `SurfaceSmoothAdjustment` | 837-841 | yes | adjustmentTypesEffects |
| Interface | `EdgeInkAdjustment` | 843-851 | yes | adjustmentTypesEffects |
| TypeAlias | `Adjustment` | 853-907 | yes | adjustment |
| Function | `adjustmentToFilter` | 909-1498 | yes | conversion (orchestrator; 54 case bodies move into the four family dispatchers) |
| Function | `adjustmentsToFilters` | 1500-1504 | yes | conversion |
| Function | `isKnownAdjustmentKind` | 1507-1509 | yes | types |
| Function | `filterToCss` | 1512-1589 | yes | cssFallback |
| Function | `filterChainToCss` | 1592-1595 | yes | cssFallback |
| Function | `supportsCanvasFilter` | 1598-1600 | yes | cssFallback |
| Function | `applyFilterChain` | 1603-1608 | yes | cssFallback |
| Function | `filterKindDisplayName` | 1610-1679 | yes | displayNames |
| Function | `adjustmentDefaults` | 1681-2125 | yes | defaults (orchestrator; 54 case bodies move into the four family dispatchers) |
| Function | `makeAdjustment` | 2127-2134 | yes | defaults |

Counts: 80 blocks = 80 top-level declarations (verifier `baseCount: 80`).
Exported names in the target: all 80; the verifier `missingExports` must stay
`[]`. The two over-cap declarations are the only ones sub-split.

## Family partition (the seam decision)

The seam text is "one conversion module per adjustment family keyed by kind; a
separate defaults table; a separate CSS filter-chain fallback". The 54 kinds in
`ADJUSTMENT_KINDS` split into four disjoint families by shared conversion
logic, and the same boundaries are used for the type modules and the defaults:

| family | kinds | conversion cases | defaults cases |
|---|---|---|---|
| tone | brightness, contrast, exposure, saturation, hueSaturation, hueRotate, sepia, grayscale, invert, opacity, blur, motionBlur, mosaic, surfaceSmooth, edgeInk, sharpen, whiteBalance, splitTone, temperature, tint, vibrance, levels, curves, selectiveColor, colorBalance, channelMixer, photoFilter (27) | 912-1075 | 1684-1816 |
| creative | halftone, gradientMap, tritone, duotone, blackAndWhite, posterize, threshold, colorHalftone, lut (9) | 1076-1240 | 1825-1930 |
| effects | dither, paletteSnap, bloom, rgbSplit, crt, vhs, lightShafts, lensFlare, lightLeak, caustics (10) | 1241-1424 | 1931-2113 |
| treatment | shadowHighlight, microDetail, definition, atmosphere, dehaze, edgeFalloff, grain, softBloom (8) | 1425-1494 | 1817-1824 + 2114-2121 |

Total 54 kinds, each assigned exactly once; families are disjoint, so family
dispatch order cannot change a result. Tone, creative, and effects type modules
use the same contiguous 143-350 / 352-562 / 564-851 regions.

## Sub-split design - adjustmentToFilter (590 lines, 54 cases)

The declaration is preserved under its original name in `conversion.ts` as a
short orchestrator. The shared base object is computed once there and passed to
each family function, so the allocation count is unchanged:

```
export function adjustmentToFilter(adjustment: Adjustment): FilterIR {
  const base = { opacity: adjustment.opacity, blendMode: adjustment.blendMode };
  return (
    toneAdjustmentToFilter(adjustment, base) ??
    creativeAdjustmentToFilter(adjustment, base) ??
    effectsAdjustmentToFilter(adjustment, base) ??
    treatmentAdjustmentToFilter(adjustment, base) ?? {
      kind: 'opacity',
      value: 100,
      opacity: 1,
      blendMode: 'normal',
    }
  );
}
```

Each family module exports one function of the shape

```
export function toneAdjustmentToFilter(
  adjustment: Adjustment,
  base: Pick<Adjustment, 'opacity' | 'blendMode'>,
): FilterIR | undefined {
  switch (adjustment.kind) {
    // original case bodies, byte-verbatim, in original order
    default:
      return undefined;
  }
}
```

The `Pick` base type matches the original inferred `base` shape exactly
(`opacity: number`, `blendMode: AdjustmentBlendMode`). The original
unknown-kind fallback (lines 1495-1496) becomes the final `??` branch, with
the identical literal. Every case body keeps its original return object property
order.

## Sub-split design - adjustmentDefaults (445 lines, 54 cases)

```
export function adjustmentDefaults(kind: AdjustmentKind): Omit<Adjustment, 'id' | 'kind'> {
  const base = { visible: true, opacity: 1, blendMode: 'normal' as AdjustmentBlendMode };
  return (
    toneDefaults(kind, base) ??
    creativeDefaults(kind, base) ??
    effectsDefaults(kind, base) ??
    treatmentDefaults(kind, base) ??
    ({ ...base } as Omit<Adjustment, 'id' | 'kind'>)
  );
}
```

Each family module exports one function of the shape

```
export function toneDefaults(
  kind: AdjustmentKind,
  base: Pick<Adjustment, 'visible' | 'opacity' | 'blendMode'>,
): Omit<Adjustment, 'id' | 'kind'> | undefined {
  switch (kind) {
    // original case bodies, byte-verbatim, in original order
    default:
      return undefined;
  }
}
```

The original `default` branch (lines 2122-2123) returns `{ ...base }` and is
the final branch of the orchestrator. The treatment family carries the
`shadowHighlight` case (1817-1824) and the seven image-treatment cases
(2114-2121) in one module; the other families are contiguous.

## Destination map (review decision)

`packages/engine/src/filters.ts` becomes a thin barrel: the original file
docblock (lines 1-9) plus an explicit named re-export table for all 80 names. It
declares nothing. New source modules, all under
`packages/engine/src/filters/`:

| module | responsibility | moved lines | expected total |
|--------|----------------|-------------|----------------|
| `types.ts` | kind catalog, kind and blend types, provenance, base, kind guard | 107 + 4 | about 120 |
| `adjustmentTypesTone.ts` | 27 tone/color adjustment interfaces | 143-350 (208) | about 220 |
| `adjustmentTypesCreative.ts` | 15 gradient/creative adjustment declarations | 352-562 (211) | about 225 |
| `adjustmentTypesEffects.ts` | 22 live-effect/treatment adjustment interfaces | 564-851 (288) | about 310 |
| `adjustment.ts` | the `Adjustment` union over all interfaces | 853-907 (55) | about 90 |
| `conversionTone.ts` | tone family conversion dispatcher | 912-1075 (164) | about 180 |
| `conversionCreative.ts` | creative family conversion dispatcher | 1076-1240 (165) | about 180 |
| `conversionEffects.ts` | effects family conversion dispatcher | 1241-1424 (184) | about 200 |
| `conversionTreatment.ts` | treatment family conversion dispatcher | 1425-1494 (70) | about 85 |
| `conversion.ts` | `adjustmentToFilter` orchestrator and `adjustmentsToFilters` | 909 + 1500-1504 | about 40 |
| `cssFallback.ts` | `filterToCss`, `filterChainToCss`, `supportsCanvasFilter`, `applyFilterChain` | 1511-1608 (98) | about 110 |
| `displayNames.ts` | `filterKindDisplayName` | 1610-1679 (70) | about 85 |
| `defaultsTone.ts` | tone family defaults dispatcher | 1684-1816 (133) | about 150 |
| `defaultsCreative.ts` | creative family defaults dispatcher | 1825-1930 (106) | about 120 |
| `defaultsEffects.ts` | effects family defaults dispatcher | 1931-2113 (183) | about 200 |
| `defaultsTreatment.ts` | treatment family defaults dispatcher | 1817-1824 + 2114-2121 (16) | about 35 |
| `defaults.ts` | `adjustmentDefaults` orchestrator and `makeAdjustment` | 1681 + 2127-2134 | about 40 |
| `filters.ts` (barrel) | docblock plus explicit named re-exports of all 80 names | 1-9 + 80 names | about 110 |

Every module is expected at or under 400 lines. The largest expected module is
`adjustmentTypesEffects.ts` (about 310) followed by `adjustmentTypesCreative.ts`
(about 225); both have measured headroom against the cap. No declaration body
other than the two sub-splits is restructured.

## Before and expected-after declaration sets

- Before: 80 top-level declarations in `packages/engine/src/filters.ts`
  (verifier `presentCount: 80`, `missing: []`), 2,134 lines, 80 exported
  names.
- After: the same 80 declarations in the destination tree (the 70 type
  declarations across `types.ts`, the three type modules, and
  `adjustment.ts`; `adjustmentToFilter` and `adjustmentsToFilters` in
  `conversion.ts`; the four CSS functions in `cssFallback.ts`;
  `filterKindDisplayName` in `displayNames.ts`; `adjustmentDefaults` and
  `makeAdjustment` in `defaults.ts`), plus the 8 new internal family
  dispatcher declarations. `refactor-verify --dest
  packages/engine/src/filters/` must report
  `{ok: true, baseCount: 80, missing: [], missingExports: []}` (presentCount
  grows by the 8 helpers to 88).
- Parent: about 110-line barrel, target entry removed from the baseline. Covering
  test unchanged at 436 lines / 34 tests.

## Planned non-move edits (counted; no behavior change)

1. Import preambles for the 17 modules, derived from the original block
   (lines 11-33); sibling specifiers are rebased one level, and each module
   imports only what it uses. New intra-directory specifiers point at the
   destination modules.
2. Two inline type-import path rebases: `import('./adjustment/hueSaturation')`
   -> `import('../adjustment/hueSaturation')` (line 163) and
   `import('./threshold')` -> `import('../threshold')` (line 544).
3. `isKnownAdjustmentKind` (lines 1507-1509) moves verbatim into
   `types.ts` with its doc comment (line 1506).
4. The `adjustmentToFilter` sub-split adds four family dispatcher
   declarations (function keyword, signature, one switch header, one default
   return). The 54 original case bodies are copied byte-verbatim.
5. The `adjustmentDefaults` sub-split adds four family dispatcher declarations
   and the orchestrator body. The 54 original case bodies are copied
   byte-verbatim.
6. Barrel wiring: file docblock kept verbatim; the original import block is
   replaced by explicit named re-exports for all 80 original names (type-only
   blocks for the 70 types, value blocks for the 10 values).
7. Blank separators are redistributed at module boundaries. Nothing else: no
   behavior edit, no rename, no comment rewrite, no test edit, no config or docs
   edit.

## Edge-case answers (from GAP_ANALYSIS.md)

- Module evaluation: the only module-scope value is `ADJUSTMENT_KINDS`, with
  exactly one home in `types.ts`; the barrel declares nothing. No child module
  imports the barrel, so the graph is acyclic (types -> adjustmentTypes* ->
  adjustment -> conversion*; types -> conversion* -> conversion; types ->
  defaults* -> defaults; ../types and ../imageTreatments and ../liveEffects/*
  are leaf imports).
- Import-time ordering: no module performs work at evaluation time beyond the
  single catalog array literal, exactly as before; evaluation order among child
  modules is unobservable.
- Exports/identity: same module path (`./filters` resolves to `filters.ts`,
  which wins over the sibling directory), explicit named re-exports, no renames;
  `adjustmentToFilter` and `adjustmentDefaults` remain the same exported
  function names with the same behavior and fallback.
- Rendering IR: every case body and return object is byte-identical; the base
  object is constructed once and passed in, so allocation behavior is unchanged.
- Frozen test: not edited; 436 lines / 34 tests stay identical.
- Cap: all modules at or under 400; parent under cap; no new over-cap path is
  staged.
- Baseline: exactly the target entry leaves; 0 added, 0 grown; no `--force`.

## Proof plan

1. `refactor-verify --base master --target packages/engine/src/filters.ts --dest
   packages/engine/src/filters/` exits 0 with `missing: []`,
   `missingExports: []` (required before tests).
2. Covering test run before (34/34) and after the move: identical pass count,
   0 failures, same test names.
3. Direct recursive tsc substitute (packages, desktop, e2e): packages 0 fail,
   desktop 0 diagnostics, e2e exit 0; compared with the clean before baseline.
4. `pnpm exec biome check --write` then `pnpm exec biome check` on every
   changed file; moved bodies verbatim apart from import preambles, the two
   inline path rebases, the enumerated dispatchers, and the barrel.
5. Baseline: `audit-file-size.mjs --update`, diff exactly one removed entry,
   then `pnpm audit:filesize` exit 0 at 950.
6. Staged seam: `pnpm agent:map` from the staged tree, `pnpm verify:commit`
   pass, one commit with no AI attribution.

## Visual surface statement

No visual surface changed. The covering test
`packages/engine/src/filters.test.ts` (34 tests, unchanged before and after)
proves the adjustment-to-IR and CSS-fallback contract; no rendered surface,
style file, snapshot, or E2E visual spec is touched. The front-end necessity
gate does not fire and prompts 03/04 stay unopened.

## Rollback

The seam is uncommitted until the final step; discard only `.worktrees/B-05`
changes if the extraction fails. Never reset the shared main checkout, never
commit a partial seam, and never use `--update --force` to make the ratchet
pass.

## Execution results (measured after the move)

Split executor (scratch, not committed) asserted a complete partition of all
2,134 base lines before writing: 2,081 lines were copied verbatim (23 ranges)
and 53 lines were replaced (the original import block, the two function
headers/footers of the sub-split declarations, and blank separators
redistributed at module boundaries). Export-set equality was asserted before
writing: 11 value exports and 69 type exports reconstruct the base 80 exactly.

Measured modules (`wc -l` after biome; 18 files, 2,408 lines total, every
module at or under 400):

```
 97  packages/engine/src/filters.ts            (barrel)
114  filters/types.ts
211  filters/adjustmentTypesTone.ts
215  filters/adjustmentTypesCreative.ts
307  filters/adjustmentTypesEffects.ts
116  filters/adjustment.ts
176  filters/conversionTone.ts
177  filters/conversionCreative.ts
196  filters/conversionEffects.ts
 82  filters/conversionTreatment.ts
 28  filters/conversion.ts
100  filters/cssFallback.ts
 73  filters/displayNames.ts
146  filters/defaultsTone.ts
120  filters/defaultsCreative.ts
195  filters/defaultsEffects.ts
 29  filters/defaultsTreatment.ts
 26  filters/defaults.ts
```

The largest module is `adjustmentTypesEffects.ts` at 307 lines; the parent is a
97-line barrel, well under the cap.

Planned non-move edits as executed: one import preamble per destination module
(17), the two inline type-import path rebases (hueSaturation and threshold),
four conversion family dispatcher declarations, four defaults family
dispatcher declarations, the two orchestrator bodies, and the explicit named
re-export table in the barrel. `isKnownAdjustmentKind` moved verbatim with its
doc comment. No other moved line changed: the independent chunk-identity check
reports all 2,072 lines moved into `filters/` byte-verbatim, and the 9-line
file docblock is byte-verbatim at the head of the barrel (2,081 of 2,081).

Proof results:

```
$ node scripts/quality/refactor-verify.mjs --base master \
    --target packages/engine/src/filters.ts --dest packages/engine/src/filters/ --json
{"ok": true, "baseCount": 80, "presentCount": 88,
 "missing": [], "missingExports": []}
(exit 0, run before tests and again after biome/fixes; presentCount 88 =
80 base declarations + 8 new family dispatcher declarations)

$ node node_modules/vitest/vitest.mjs run packages/engine/src/filters.test.ts
before: 34 passed (34), 1 file, exit 0
after:  34 passed (34), 1 file, exit 0 (same file, untouched)

direct recursive tsc substitute, before (clean tree) and after the move:
  before: packages 20 checked / 20 pass / 0 fail; desktop exit 0 / 0 diagnostics; e2e exit 0 / 0
  after:  packages 20 checked / 20 pass / 0 fail; desktop exit 0 / 0 diagnostics; e2e exit 0 / 0
  desktop, e2e and all 20 package diagnostic files byte-identical before/after
```

Biome: `biome check --write` then `biome check` on the barrel plus the 17
modules reports `Checked 18 files`, no fixes and no warnings on the final run.
The only biome changes were import ordering/wrapping in preambles, the wrapped
union import list in `adjustment.ts`, and the wrapped re-export lines in the
barrel; no moved declaration body changed.

Baseline ratchet:

```
$ node scripts/quality/audit-file-size.mjs --update
Wrote .file-size-baseline.json: 950 frozen file(s) over 400 lines.
  added 0, grown 0, removed 1 (splits/deletes/untracked-pruned).
  17 untracked file(s) scanned; over-cap WIP is never frozen.
$ git diff -- .file-size-baseline.json
-    "packages/engine/src/filters.ts": 2134,
$ pnpm audit:filesize
File-size budget OK: 6192 source files scanned; 950 over 400 lines, all frozen
in .file-size-baseline.json (tracked content).            (exit 0)
$ node scripts/quality/audit-file-size.mjs --report
Scanned 6192 source files; 950 over the 400-line cap; 950 frozen in
.file-size-baseline.json; 0 violation(s); 0 untracked WIP over-cap file(s).
Excess over cap: 305511 lines. Baseline entries: 950 (0 stale).
```

951 -> 950 frozen entries; excess 307,245 -> 305,511 (-1,734 = the 2,134-line
target minus its 400-line allowance); scanned 6,175 -> 6,192 (the barrel stays
on the old path and 17 modules are added). The report no longer lists
`packages/engine/src/filters.ts`. No entry was added or grown; `--force` was
not used. The frozen covering test stays at 436.

Environment notes (measured in this worktree): `pnpm install --frozen-lockfile`
is blocked by the read-only store, so the 22 `node_modules` symlinks plus the
ignored onnxruntime-libs copy were used; `pnpm check:agent` fails on the
validation-queue EROFS, so the direct three-stage tsc program was used (clean
0/0 here, matching the B-04 worktree rather than the older 228-diagnostic
note); the planner `--top` flag is unsupported, so the no-flag full table was
used.

