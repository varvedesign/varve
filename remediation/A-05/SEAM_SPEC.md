# SEAM_SPEC — Batch A / A-05 scene type aggregation

**Status:** seam plan accepted 2026-10-28 by the campaign lead (this session,
single seam). Implementation starts only after RESEARCH.md and GAP_ANALYSIS.md
exist and only inside `.worktrees/A-05` on branch `seam/A/A-05-scene-types`.
The machine-readable declaration-to-module assignment is
[`module-map.json`](module-map.json); this document is the reviewed plan.

## Seam hypothesis

- **Entry:** Batch A / A-05 (remediation rank #7).
- **Target:** `packages/scene/src/types.ts` — 3,055 lines, frozen at exactly
  3,055 in `.file-size-baseline.json` (entry line 772).
- **Single concern:** the scene document type aggregation (document/node/effect/
  fill/mask/typography/comic/presentation-adjacent type declarations).
- **Single extraction destination:** the new directory
  `packages/scene/src/types/` (one destination directory = one seam; precedent:
  `packages/editor/src/menu/defs.ts` -> `menu/defs/` and A-04
  `IntelligencePanel.tsx` -> `panels/intelligence/`).
- **Target after seam:** `packages/scene/src/types.ts` is a re-export barrel:
  the original file docstring, the original external re-export blocks
  (`@varve/shared`, `./gridTypes` x2, `./layerColor`, `./colorManagement`), and
  explicit named re-exports for every moved declaration. The one local
  re-export (`export type { GradientInterpolationSpace, ManagedColor };`, base
  line 78) stays verbatim, so the barrel keeps its two-name
  `./colorManagement` type import; the rest of the base import block (lines
  16-52) moves into the modules that use it. No declaration is defined in the
  barrel after the seam.
- **Public API:** unchanged. `packages/scene/src/index.ts` keeps
  `export * from './types'`; no consumer import changes; no name is renamed and
  no export is added or removed.

## Declaration inventory (193 top-level declarations)

Measured on base `b1ee0d09a` with
`node scripts/quality/godsplit-plan.mjs packages/scene/src/types.ts` (198 blocks:
193 declarations + 5 export statements) and `refactor-verify` pre-flight
(`baseCount: 193`). Exact per-declaration names are in
[`module-map.json`](module-map.json); destination table:

| module (`packages/scene/src/types/`) | decls | moved lines | base line ranges |
|---|---|---|---|
| `ids.ts` | 1 | 1 | 80 |
| `comic.ts` | 6 | 20 | 84-107 |
| `canvas.ts` | 6 | 36 | 385-393, 2531-2538, 3034-3055 |
| `masks.ts` | 14 | 192 | 129-381, 2142-2151 |
| `appearance.ts` | 19 | 271 | 397-702 |
| `assets.ts` | 8 | 95 | 737-887 |
| `fills.ts` | 13 | 230 | 705-728, 889-1155 |
| `typography.ts` | 22 | 248 | 1172-1462 |
| `nodes/containers.ts` | 13 | 126 | 111-116, 1998-2138 |
| `nodes/base.ts` | 1 | 109 | 1485-1593 |
| `nodes/shapes.ts` | 3 | 70 | 1596-1668 |
| `nodes/text.ts` | 5 | 149 | 1670-1774, 1825-1878 |
| `nodes/groups.ts` | 11 | 202 | 1776-1823, 1884-1995, 2155-2223 |
| `nodes/adjustment.ts` | 13 | 117 | 1464-1481, 2230-2356 |
| `nodes/union.ts` | 9 | 36 | 2226-2406 (legacy aliases, SceneNode union, type guards) |
| `document.ts` | 18 | 151 | 2508-2732 (document base, pages, spreads, masters) |
| `components.ts` | 14 | 94 | 1159-1168, 2734-2833 (components, properties, styles) |
| `logo.ts` | 9 | 80 | 2419-2506 |
| `helpers.ts` | 8 | 171 | 2838-3030 (shape/image geometry helpers) |
| **total** | **193** | **2,398** | |

Four declarations are **not exported** in the base file and must stay
non-exported in their destination module: `MaskPresentation` (`masks.ts`),
`EffectVariant` (`appearance.ts`), `CURRENT_TRACE_VERSION` (`nodes/groups.ts`),
`isImageFit` (`helpers.ts`). The barrel must not re-export them.

The 19 blocks above plus blank-line/comment trivia are the entire content of the
base file: 2,421 lines are planner block lines (2,398 declaration lines + 23
re-export-statement lines) and 634 lines are outside every block (file
docstring lines 1-15, import block lines 16-52, blank separators and the
leading doc comments of 96 declarations). `refactor-verify` is name-set based
and cannot detect a dropped comment, so the proof stack adds an independent
declaration-text identity check (below).

## Applied edge cases

- **Planner ranges are declaration-only — applies (critical).** The planner
  starts a block at the first syntax line, not at its doc comment: 634 base
  lines are outside every block, including 362 leading doc/banner comment lines
  and 32 separator blanks that belong to 96 declarations (AST full ranges add
  394 lines versus the planner ranges). Cut by AST full range
  (`statement.getFullStart()` .. `statement.getEnd()`), never by planner range
  alone, or doc comments are silently dropped. Keep every moved comment
  verbatim.
- **No dropped declarations — applies.** 193 declarations, only 189 exported;
  the four private ones would not be caught by tsc. Proof is
  `refactor-verify` with `missing: []` and `missingExports: []` plus the
  declaration-identity check in verification.
- **`export *` is not resolved by refactor-verify — applies.** The verifier
  only counts named export lists (its own docstring states this). The barrel
  therefore uses explicit named re-exports grouped per module; `export *` in
  the barrel is forbidden.
- **File-relative inline type imports — applies (measured).** Five
  `import('./x')` type specifiers in four declarations (`DocumentAsset`,
  `ImageFillData` x2, `FrameNode`, `RasterLayerNode`) are file-relative and are
  rebased mechanically when the declaration moves one or two directories
  deeper: `./photoSource` -> `../photoSource` or `../../photoSource`,
  `./mockup/types` -> `../../mockup/types`. The specifiers keep pointing at the
  same modules, so type identity and behavior are unchanged. Identity proof:
  189/189 declarations byte-identical, 4/4 byte-identical apart from those five
  path-only specifier rewrites.
- **Type-only cycles — allowed, runtime cycles — forbidden.** All
  cross-module references in the destination are type-only and erased under
  `verbatimModuleSyntax: true`, so type-import cycles are safe and expected
  (e.g. `nodes/base` <-> `nodes/containers` through the layout fields,
  `fills` <-> `nodes/union`). Measured on the rendered seam: 0 non-type imports
  between destination modules; the only value import stays inside
  `helpers.ts` (`normalizeImagePerspective` from `../imagePerspective`), so the
  destination runtime value graph is acyclic.
- **`verbatimModuleSyntax` + `noUnusedLocals` + `isolatedModules` apply.**
  Every type-only import is `import type { ... }` (or an inline `type`
  modifier); value imports are separate; unused imports fail `tsc
  --noEmit`; type re-exports use `export type { ... }`.
- **Aliased imports apply.** `OpenTypeFeatureMap as SharedOpenTypeFeatureMap`
  (from `@varve/shared`) must keep the local alias `SharedOpenTypeFeatureMap`
  in `typography.ts`; the barrel re-exports the public name
  `OpenTypeFeatureMap` (declared locally today, so it is a declaration export,
  not a re-export).
- **Module evaluation order — does not apply.** The file has no module-scope
  value construction; the three exported function groups are definitions only.
- **Generated files / build tags / JSX — do not apply.**
- **Baseline growth — banned.** `audit-file-size --update` may only remove the
  A-05 entry (959 -> 958). Added > 0 or grown > 0 means the seam is wrong;
  `--update --force` is forbidden.
- **Concurrent worktrees — applies.** The seam runs only in
  `.worktrees/A-05`; the main checkout's WIP is not touched.

## Sub-split requirements

None. The largest moved declaration is `EffectVariant` (151 lines) and the
largest destination module is `appearance.ts` (~289 moved lines + imports).
Every destination file must be at or under 400 lines (target 250-350); no
baseline entry may be created for any new file.

## Expected reductions

- Target: 3,055 lines -> a re-export barrel of roughly 60-80 lines.
- Destination: 19 modules, every one <= 400 lines.
- Excess over cap: -2,655 lines (3,055 - 400) when all new files are under cap.
- `.file-size-baseline.json`: exactly one entry removed, FROZEN_COUNT
  959 -> 958. A shrink-only stale ceiling may be lowered by `--update` only if
  a reviewed diff shows it; no entry may be added or grown.

## Proof of behavior preservation

1. Base inventory: planner used; `refactor-verify --base b1ee0d09a` pre-flight
   reported `baseCount: 193`.
2. `node scripts/quality/refactor-verify.mjs --base b1ee0d09a --target
   packages/scene/src/types.ts --dest packages/scene/src/types --json` ->
   `missing: []`, `missingExports: []`.
3. Declaration identity: a separate one-off AST check (not provided by
   refactor-verify) confirms each base declaration's text — leading doc comment
   through declaration end — appears exactly once, in exactly one destination
   file. Expected result: 189/189 declarations byte-identical and the four
   declarations carrying file-relative inline `import()` types byte-identical
   apart from the five path-only specifier rebases listed above; the
   independent verifier records matches/mismatches and any diff.
4. Public surface: barrel export-name set equals the 212-name base file export
   set (189 exported declarations + 23 external re-exports; no additions, no
   removals); `packages/scene/src/index.ts` and every consumer file are
   untouched (`git status` shows no change outside target/dest/seam
   docs/baseline/map/ledger).
5. Type gates: `node_modules/.bin/tsc -p packages/scene/tsconfig.json --noEmit`
   exit 0, plus `pnpm check:agent` (recursive tsc over the workspace packages,
   desktop and e2e) run once as the consumer gate — `tsc -p packages/scene`
   compiles only this package, and 240 import statements in 223 files reach the
   types module (`pnpm check:agent` is the only cross-package compiler proof;
   the target has no runtime test).
6. `node_modules/.bin/biome check` clean on every changed file (after a
   scoped `--write` on the new files only).
7. `node scripts/quality/audit-file-size.mjs --update` removes exactly the
   A-05 entry; then `node scripts/quality/audit-file-size.mjs` exit 0.
8. `pnpm agent:map` regenerated from the staged tree; `pnpm verify:commit`
   staged checkpoint green if available.
9. No rendered-output change: the seam is a definition move — 175 type-only
   declarations plus 17 function bodies and 1 private const definition, moved
   unchanged (the four inline-import declarations differ only in five
   file-relative specifiers). No call site, literal, CSS or UI behavior changes,
   so the front-end necessity gate and visual validation (prompts 03/04) are
   03/04) are **not triggered**; recorded here and in GAP_ANALYSIS.md.

## Out of scope

Behavior fixes, declaration renames, new exports, splitting any consumer file,
`packages/scene/src/document.ts` or other god files, edits to the dated
remediation record or campaign plan, and any second baseline entry.

## Pre-landing follow-up (outside this commit)

The full-gate-only architecture audit (`node scripts/audit-architecture.mjs
--ci`, wired into the Tier 5 full gate; it does **not** run in `verify:agent`
or `verify:commit`) reports 4 new scene cycle identities through `types/*`
plus stale allowlist entries. All new cycles are type-only (53/53 inter-module
imports are `import type`; the destination runtime value graph is acyclic —
independent verifier evidence). Refreshing `.architecture-baseline.json` with
`--update` is an integration/allowlist step for the merge owner: this seam does
not add or widen a baseline entry, so the file is untouched here.
