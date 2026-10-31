# B-11 seam spec — AdjustmentEditor split into adjustmentEditors/ modules

Single concern: move the 2,405-line
`packages/editor/src/components/AdjustmentLayer/AdjustmentEditor.tsx` into one
module per adjustment family under
`packages/editor/src/components/AdjustmentLayer/adjustmentEditors/` plus shared
row primitives, types, and helper modules; the original path stays a 15-line
definition shell and keeps its four named exports. Pure code motion: no behavior,
DOM, class-name, copy, API, error-state, or export-surface change.

**No visual surface changed** — the moved JSX/DOM structure, class names, aria
attributes, text, and prop contracts are unmoved; the original module path keeps
its public exports. The rendered-surface proof is the direct jsdom component test
`AdjustmentEditor.test.tsx` (18 passed / 0 failed before and after, no test
edit, no module mock) plus `AdjustmentPanel.test.tsx` (14 passed), which renders
the dispatcher through the panel. No visual baseline exists for this component
(`tests/visual/` is absent); no baseline, screenshot, or e2e file is touched and
no browser lane runs. The front-end gate (prompt 03) is answered "not triggered";
the visual-validation gate (prompt 04) does not fire.

## Pre-flight (measured on the clean worktree)

- Worktree `.worktrees/B-11`, branch `seam/B/B-11-adjustment-editor`, HEAD
  `5e4b1955c21baa05b15529c56e5221e3abfbaf2a` (integrated master merge of the
  B-10 checkpoint `196535baf`); `git status --porcelain` = 0 paths.
- `node scripts/quality/audit-file-size.mjs --report`: scanned 6,280 source
  files; 945 over the 400-line cap; 945 frozen entries; 0 stale; 0 violations;
  0 untracked WIP over cap; 294,933 excess lines.
- Baseline: `.file-size-baseline.json` line 135 =
  `"packages/editor/src/components/AdjustmentLayer/AdjustmentEditor.tsx": 2405`;
  `wc -l` target = 2,405; covering test = 309.
- `node scripts/quality/godsplit-plan.mjs <target>`: exit 0; "Lines: 2405 |
  imports: 23 | blocks: 24"; hazards: `LegacyAdjustmentEditor` 104-910 = 807
  lines, `HalftoneEditor` 1285-1730 = 446 lines.
- `node scripts/quality/refactor-verify.mjs --base master --target <target>
  --json`: exit 0, `{ok:true,baseCount:24,presentCount:24,missing:[],
  missingExports:[]}`.
- Covering set baseline: direct
  `./node_modules/.bin/vitest run .../AdjustmentEditor.test.tsx
  .../AdjustmentPanel.test.tsx --reporter=dot` = 2 files / 32 tests passed
  (18 + 14) / 0 failed (45.90 s) on the clean worktree; the handoff's dedicated
  target run measured 18/18 in 44.32 s.
- Covering test, standalone clean-worktree baseline: direct
  `./node_modules/.bin/vitest run .../AdjustmentEditor.test.tsx --reporter=dot`
  → 18 passed / 0 failed / 26.03 s; the covered pair measured 32/32 (18 + 14)
  in 45.90 s.
- Direct `tsc` program (derived from `package.json` `check:agent:raw` and
  reproduced with `./node_modules/.bin/tsc`, TS 6.0.3): 22 projects checked
  (20 package tsconfigs + `apps/desktop` + `tests/e2e`) / 0 failures / 0
  diagnostics in the pre-flight baseline (949 s; its last two projects overlapped
  the seam writes, so the post-split rerun is the gate recorded below).
- Environment: read-only pnpm store — every pnpm script emits the
  `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` pre-install warning but the underlying
  gate scripts still execute; worktree `node_modules` symlinked from the main
  checkout (21 links: root, `.opencode`, `apps/desktop`, `apps/website`, 17
  package trees); queue EROFS on the runtime dir. `pnpm queue:status`:
  "exclusive free; shared 0/4 slots busy; 0 waiting"; `pnpm worktree:status`:
  "worktrees: 48 total, 19 dirty, 0 unmerged, 0 stale candidate(s)", B-11 line
  `current ... 0d 0+0 524/152`. `pnpm audit:filesize` (clean tree) exited 0
  with the same 945/0-stale counts. Direct vitest + direct recursive `tsc`
  substitutions are used. No Rust seam.

## Declaration inventory (hand-completed from the planner's 24-block table)

Read each block range; this is the review decision, not a planner suggestion.

| # | kind | name | base range | base export | destination |
|---|---|---|---|---|---|
| 0 | Interface | AdjustmentEditorProps | 52-71 | yes | `adjustmentEditors/types.ts` |
| 1 | Function | BooleanRow | 73-95 | no | `adjustmentEditors/controls.tsx` (export added; one home, repo-wide only definition) |
| 2 | Function | AdjustmentEditor | 97-102 | yes | stays defined in `AdjustmentEditor.tsx` (definition shell) |
| 3 | Function | LegacyAdjustmentEditor | 104-910 | no | `adjustmentEditors/LegacyAdjustmentEditor.tsx` orchestrator + `legacy/useLegacyEditorContext.ts` + 4 `legacy/render*Cases.tsx` phases (sub-split below) |
| 4 | Function | levelsAdjustmentToParams | 916-926 | no | `adjustmentEditors/levels.tsx` (module-local) |
| 5 | Function | paramsToLevelsAdjustmentPatch | 928-938 | no | `adjustmentEditors/levels.tsx` (module-local) |
| 6 | Function | LevelsEditor | 940-1002 | no | `adjustmentEditors/levels.tsx` (export added) |
| 7 | Function | curvesPointsToCurvePoints | 1010-1018 | yes | `adjustmentEditors/curves.tsx` (export kept; re-exported by the shell) |
| 8 | Function | curvePointsToCurvesPoints | 1020-1028 | yes | `adjustmentEditors/curves.tsx` (export kept; re-exported by the shell) |
| 9 | Function | CurvesEditor | 1030-1131 | no | `adjustmentEditors/curves.tsx` (export added) |
| 10 | Function | SelectiveColorEditor | 1133-1186 | no | `adjustmentEditors/selectiveColor.tsx` (export added) |
| 11 | Function | ChannelMixerEditor | 1188-1269 | no | `adjustmentEditors/channelMixer.tsx` (export added) |
| 12 | Variable | HALFTONE_SHAPE_OPTIONS | 1271-1279 | no | `adjustmentEditors/halftone/options.ts` (export added) |
| 13 | Function | patternForShape | 1281-1283 | no | `adjustmentEditors/halftone/options.ts` (export added) |
| 14 | Function | HalftoneEditor | 1285-1730 | no | `halftone/HalftoneEditor.tsx` shell + `halftone/useHalftoneModel.ts` + `halftone/HalftoneAdvancedPhase.tsx` (sub-split below) |
| 15 | Function | ColorHalftoneEditor | 1732-1903 | no | `adjustmentEditors/halftone/ColorHalftoneEditor.tsx` (export added) |
| 16 | Function | PhotoFilterEditor | 1905-1949 | no | `adjustmentEditors/photoFilter.tsx` (export added) |
| 17 | Function | ShadowHighlightEditor | 1951-2017 | no | `adjustmentEditors/shadowHighlight.tsx` (export added) |
| 18 | Function | colorToManaged | 2019-2021 | no | `adjustmentEditors/managedColor.ts` (export added) |
| 19 | Function | managedToColor | 2023-2038 | no | `adjustmentEditors/managedColor.ts` (export added) |
| 20 | Function | DuotoneEditor | 2040-2151 | no | `adjustmentEditors/duotone.tsx` (export added) |
| 21 | Function | BlackAndWhiteEditor | 2153-2227 | no | `adjustmentEditors/blackAndWhite.tsx` (export added) |
| 22 | Function | PosterizeEditor | 2229-2246 | no | `adjustmentEditors/posterize.tsx` (export added) |
| 23 | Function | TritoneEditor | 2248-2405 | no | `adjustmentEditors/tritone.tsx` (export added) |

Comments attach to their declaration: the 912-915 LevelsAdjustment/HistogramWidget
adapter comment moves with block 4; the 1004-1009 curves unit-system comment
moves with block 7; all other comments inside case bodies move verbatim with
their case. No declaration is left in the shell except `AdjustmentEditor`
(block 2); the props type and the two exported converters are re-exported from
the shell by name.

## Sub-split A: LegacyAdjustmentEditor (base 104-910, 807 lines)

The 807-line declaration is split into an orchestrator, one runtime hook, and four
plain render functions that each own a contiguous set of base switch cases. The
case bodies are moved verbatim; the orchestrator calls them in base case order and
returns the first non-`undefined` result, then the base `default` JSX.

| base range | content | destination module |
|---|---|---|
| 104-116 | `LegacyAdjustmentEditor` signature / 11-prop destructure | `legacy/useLegacyEditorContext.ts` header (wrapper renamed to the hook; prop list verbatim) |
| 117-133 | `useCallback` handleValue, `useCallback` handleNumber, `useState('master')` hueSaturationRange | `legacy/useLegacyEditorContext.ts` body, verbatim |
| 135, 742 | switch open/close (structure) | re-emitted per phase (`switch (adjustment.kind) {` / `}`) |
| 136-302 | cases whiteBalance, splitTone, brightness, contrast, levels, curves, selectiveColor, colorBalance, exposure, temperature, saturation | `legacy/renderLuminanceCases.tsx` |
| 304-515 | cases hueSaturation (incl. the state consumer), hueRotate, sepia, grayscale, invert, opacity, blur, sharpen, tint, vibrance | `legacy/renderTonalCases.tsx` |
| 517-627 | cases channelMixer, photoFilter, shadowHighlight, halftone, gradientMap, tritone, colorHalftone, duotone, blackAndWhite, posterize, threshold, lut, dither | `legacy/renderChannelCases.tsx` |
| 629-732 | cases paletteSnap, the 4-kind spatial fallthrough group (motionBlur/mosaic/surfaceSmooth/edgeInk), bloom, rgbSplit, crt, vhs, lightShafts, lensFlare, lightLeak, caustics | `legacy/renderEffectCases.tsx` |
| 734-741 | `default:` fallback DOM "No editor for {(adjustment as Adjustment).kind}" | `LegacyAdjustmentEditor.tsx` orchestrator, JSX verbatim (reindented) |
| 744-909 | nested `LutEditor` function component | `legacy/renderChannelCases.tsx`, kept as a nested function inside the phase renderer |
| 910 | function close | wrapper |

State-lifetime decision: `hueSaturationRange` stays in
`useLegacyEditorContext`, which the orchestrator calls unconditionally; the state
is passed to the phase renderers through the context object. The phase renderers
are **plain render functions, not components**, so switching `adjustment.kind`
keeps the same React reconciliation path (same element position/type family) as
the base switch and cannot reset the range state (base hazard H1).

`LutEditor` remains a function declaration nested inside the plain render
function that handles `case 'lut'`. Because that function is called during every
Legacy render for `lut` (and for later phases), the nested function identity is
re-created on each Legacy render exactly as in the base file; its `status`/
`lutMeta` state lifetime (remount on each parent render) is unchanged (base
hazard H2). Moving it to module scope would have silently changed that lifetime,
so it is deliberately not lifted.

## Sub-split B: HalftoneEditor (base 1285-1730, 446 lines)

| base range | content | destination module |
|---|---|---|
| 1271-1283 | `HALFTONE_SHAPE_OPTIONS` + `patternForShape` (module blocks 12-13) | `halftone/options.ts` |
| 1285 | `HalftoneEditor` signature | `halftone/useHalftoneModel.ts` header (wrapper renamed to the hook) |
| 1286-1352 | `adj`, `handleSelect`, `handleValue`, derived consts (method/channel/isCmyk/isLegacy/periodPx/channelAngles/registrationOffset), `useMemo` currentPresetId, preset/shape/channel handlers, fgColor/bgColor/isMonoChannel | `halftone/useHalftoneModel.ts` body, verbatim |
| 1354-1355, 1728-1730 | `return (` / root `<div>` / closers | `halftone/HalftoneEditor.tsx` shell (recomposed) |
| 1356-1576 | S1-S5 children: legacy banner/hint, preset, method, FM dither, shape, channel, frequency, angle, threshold, intensity, softness, invert, ink/paper colors, alpha handling | `halftone/HalftoneEditor.tsx` shell, children verbatim |
| 1577-1727 | Advanced block: `{(isMonoChannel || isCmyk) && (<DisclosureSection title="Advanced" ...>...)}` with the isCmyk (black generation, TAC, preview, per-ink angle/offset, hint) and isMonoChannel (dot gain, hint) sub-blocks | `halftone/HalftoneAdvancedPhase.tsx`, rendered unconditionally by the shell |
| 1730 | function close | wrapper |

The Advanced `DisclosureSection` is rendered unconditionally by the shell (the
base gate `isMonoChannel || isCmyk` is a tautology because
`isMonoChannel = !isCmyk`); the gate expression itself is moved verbatim inside
the phase component, so the disclosure's expanded/collapsed state stays mounted
across channel changes exactly as in the base (base hazard H3). The single
`useMemo` stays in the hook called unconditionally first by the shell, with its
byte-verbatim `[adj]` dependency array (base hazard H4).

## Destination map (all files ≤400 lines; measured after the move)

| file | content | measured lines |
|---|---|---|
| `AdjustmentEditor.tsx` (target) | definition shell: props/dispatcher export surface, converter re-exports, CSS side-effect import | 15 (was 2,405) |
| `adjustmentEditors/types.ts` | `AdjustmentEditorProps` | 23 |
| `adjustmentEditors/controls.tsx` | `BooleanRow` shared row primitive | 25 |
| `adjustmentEditors/LegacyAdjustmentEditor.tsx` | Legacy orchestrator (phase calls + fallback DOM) | 32 |
| `adjustmentEditors/legacy/useLegacyEditorContext.ts` | runtime hook + `LegacyEditorContext` type | 55 |
| `adjustmentEditors/legacy/renderLuminanceCases.tsx` | phase 1 (cases 136-302) | 193 |
| `adjustmentEditors/legacy/renderTonalCases.tsx` | phase 2 (cases 304-515) | 233 |
| `adjustmentEditors/legacy/renderChannelCases.tsx` | phase 3 (cases 517-627) + nested `LutEditor` (744-909) | 322 |
| `adjustmentEditors/legacy/renderEffectCases.tsx` | phase 4 (cases 629-732) | 125 |
| `adjustmentEditors/levels.tsx` | adapters + `LevelsEditor` | 95 |
| `adjustmentEditors/curves.tsx` | curve converters + `CurvesEditor` | 133 |
| `adjustmentEditors/selectiveColor.tsx` | `SelectiveColorEditor` | 60 |
| `adjustmentEditors/channelMixer.tsx` | `ChannelMixerEditor` | 89 |
| `adjustmentEditors/photoFilter.tsx` | `PhotoFilterEditor` | 52 |
| `adjustmentEditors/shadowHighlight.tsx` | `ShadowHighlightEditor` | 71 |
| `adjustmentEditors/managedColor.ts` | `colorToManaged` + `managedToColor` | 23 |
| `adjustmentEditors/duotone.tsx` | `DuotoneEditor` | 125 |
| `adjustmentEditors/blackAndWhite.tsx` | `BlackAndWhiteEditor` | 83 |
| `adjustmentEditors/posterize.tsx` | `PosterizeEditor` | 22 |
| `adjustmentEditors/tritone.tsx` | `TritoneEditor` | 173 |
| `adjustmentEditors/halftone/options.ts` | halftone shape options + pattern helper | 12 |
| `adjustmentEditors/halftone/useHalftoneModel.ts` | Halftone runtime hook + `HalftoneEditorModel` type | 100 |
| `adjustmentEditors/halftone/HalftoneEditor.tsx` | Halftone shell (S1-S5 children verbatim + advanced phase) | 258 |
| `adjustmentEditors/halftone/HalftoneAdvancedPhase.tsx` | Advanced disclosure block | 175 |
| `adjustmentEditors/halftone/ColorHalftoneEditor.tsx` | `ColorHalftoneEditor` | 181 |

Total destination = 24 modules / 2,660 lines; plus the 15-line shell. Largest
module = 322 lines (all ≤400; none in the 400+ band). The shell is the only file
that defines the public API; internal modules are imported directly with explicit
named imports; no `export *` and no default exports.

## Planned edits (the complete allowlist)

1. `AdjustmentEditor.tsx` (target): keep `export function AdjustmentEditor`
   with the same signature/body (dispatcher, block 2); import
   `LegacyAdjustmentEditor` from the destination; keep `ImageTreatmentEditor`
   and `isImageTreatmentKind` imports; keep the single
   `import './adjustment.css'`; add explicit named re-exports for
   `AdjustmentEditorProps` (type) and the two curve converters; add a named type
   import for the local props annotation. No other line changes.
2. New `adjustmentEditors/` modules: moved declarations verbatim from the base
   ranges above; one `export` modifier added to declarations that a sibling
   module or the dispatcher needs (`BooleanRow`, `LevelsEditor`,
   `CurvesEditor`, every family editor, `colorToManaged`/`managedToColor`,
   `HALFTONE_SHAPE_OPTIONS`, `patternForShape`); the parent-first ordering of
   the base file is preserved within each module.
3. Two runtime hooks + four Legacy phase renderers + two Halftone components as
   specified in the sub-split tables; the hook wrappers are private (not
   re-exported) and the phase renderers are plain functions.
4. Relative import specifiers rebased for destination depth; `@varve/*` imports
   unchanged; no import renaming.
5. No other line changes: no renames of base declarations, no reformat outside
   biome, no behavior, no new state/effect/deps/test/snapshot, no test edit, no
   consumer edit, no package/lockfile edit, no CSS edit.
6. The shell keeps exporting exactly the base four named exports from the base
   path; the two curve converters are re-exported by name, never via `export *`.

## Hook invariants

- Hook inventory of the base file (measured by grep): `useCallback`/`useMemo`/
  `useState` call sites at 117, 124, 133 (Legacy), 747, 748, 752 (nested
  `LutEditor`), 1302 (Halftone), 1746 (ColorHalftone `useMemo`), 2255
  (Tritone `useMemo`); import at line 24. Every hook precedes the first return of
  its function; no conditional hooks exist.
- Legacy: `LegacyAdjustmentEditor` calls `useLegacyEditorContext(props)` as its
  first statement and only hook call. The hook internally keeps the base order
  `useCallback`(handleValue) → `useCallback`(handleNumber) →
  `useState('master')`; dependency arrays `[onChange]` (both) are byte-verbatim;
  the state initial value is unchanged.
- `LutEditor` keeps its three hooks inside the nested function, which is still
  re-created per Legacy render; no hook is lifted to module scope.
- Halftone: `HalftoneEditor` calls `useHalftoneModel(props)` as its first
  statement and only hook call; the hook keeps `useMemo(..., [adj])` with the
  byte-verbatim dependency array and body, and all handler closures are re-created
  per render as before.
- ColorHalftoneEditor and TritoneEditor `useMemo` calls move verbatim with their
  declarations.
- No hook moves into a conditionally mounted child; the Halftone Advanced phase
  component is rendered unconditionally (base gate is a tautology); the Shell
  dispatcher keeps the same early-return shape.
- The CSS side-effect import stays exactly once, in the target shell, at the same
  relative depth as before (only position changes: after module imports, matching
  the base's last-import position).

## Proof plan

1. `node scripts/quality/refactor-verify.mjs --base master --target <target>
   --dest <dest> --json` exits 0 with `missing: []` and
   `missingExports: []` before any test run.
2. The covering pair (`AdjustmentEditor.test.tsx` + `AdjustmentPanel.test.tsx`)
   has the same before/after count with 0 failures and no test edit.
3. The direct recursive `tsc` program (20 package tsconfigs + `apps/desktop` +
   `tests/e2e`) exits 0 with 0 diagnostics.
4. `biome check` on the changed paths is clean; `node scripts/audit-health.mjs`
   passes.
5. Partition/unit proof: every base declaration line is accounted for, and every
   moved unit is content-identical modulo whitespace/formatting (details below).
6. Ratchet: `node scripts/quality/audit-file-size.mjs --update` removes exactly
   the target entry (945 → 944), adds/grows nothing; `pnpm audit:filesize`
   exits 0 with 0 stale.
7. Stage the seam, regenerate the repo map from the staged tree, run
   `pnpm verify:commit` (exit 0), and commit only the seam files plus baseline,
   map, ledger row, and `remediation/B-11/`. No visual/e2e/browser/lockfile/
   manifest/dated-doc changes.

## Stop conditions (blockers, not bypasses)

- Any needed semantic edit (a move that does not compile without changing logic):
  stop and report.
- A missing declaration or export, or an attempt to edit the verifier: stop.
- Any destination module >400 lines, or any frozen file grown: stop.
- Covering-test count decrease, a test edit, or a snapshot update: stop.
- Hook-order/state-lifetime drift that cannot be proved identical by the
  invariants above: stop.
- An unexplained red gate (filesize/health/tsc/biome/verify:commit): stop; never
  use `--update --force`.

## Measured proof (after the move; measured from this worktree)

### Partition / unit identity

- Base blob: `git show master:packages/editor/src/components/AdjustmentLayer/AdjustmentEditor.tsx`;
  SHA-256 of the base source = `b6fec46eb4a9e6942d4d545ffbcb7b2f3f82cbb14fc20522dc38318633a7e314`.
- Line arithmetic for the 2,405 base lines: **50** import-region lines (1-50,
  replaced by per-module import blocks), **2,307** moved declaration lines in 26
  measured units, **23** non-blank structural/wrapper lines (the Legacy
  signature 104-116 whose wrapper is renamed to the runtime hook; switch
  `{`/`}` at 135/742 re-emitted per phase; `default:` 734; function closes
  910/1285; the Halftone `return (`/`<div>`/`</div>`/`);`/`}` at
  1354/1355/1728/1729/1730 recomposed into the shell), and **25** blank
  separator lines (51, 72, 96, 103, 134, 303, 516, 628, 733, 743, 911, 1003,
  1132, 1187, 1270, 1284, 1353, 1731, 1904, 1950, 2018, 2039, 2152, 2228,
  2247). 50 + 2,307 + 23 + 25 = 2,405.
- Unit proof: each moved unit was checked as a whitespace-stripped substring of
  its destination module, with the added `export` modifiers normalized, because
  the base ranges are contiguous by construction. **24 of 26 units** pass that
  check exactly. The two remaining units are `DuotoneEditor` (2040-2151 →
  `duotone.tsx`) and `TritoneEditor` (2248-2405 → `tritone.tsx`): their only
  difference is biome wrapping the over-100-character signature line
  (`function DuotoneEditor({ adjustment, onChange, onEditStart, onEditEnd }:
  AdjustmentEditorProps)`); a full diff shows no token change. No moved comment,
  JSX text, class name, aria label, or string literal was altered.
- Size accounting: 24 destination modules = 2,660 lines + 15-line shell =
  2,675 lines; the +270 lines versus the base are the per-module import blocks
  (the base's 23 import statements are redistributed and rebased per module),
  the hook/phase/component wrapper glue, and the explicit named re-exports in the
  shell. No moved logic line was added or removed.

### Formatting

- `./node_modules/.bin/biome check --write packages/editor/src/components/AdjustmentLayer/AdjustmentEditor.tsx packages/editor/src/components/AdjustmentLayer/adjustmentEditors`
  → exit 0, "Checked 25 files ... Fixed 14 files."
- `./node_modules/.bin/biome check <same paths>` → exit 0, "Checked 25 files.
  No fixes applied."
- Formatting-only effects: import organization/merging (including
  `import { type Adjustment, type ManagedColor, rgbFromTuple } from '@varve/scene'`),
  line wrapping at 100 columns, and indentation normalization of the generated
  glue lines. No moved JSX/logic was rewritten by hand.

### Gates

- `node scripts/quality/refactor-verify.mjs --base master --target
  packages/editor/src/components/AdjustmentLayer/AdjustmentEditor.tsx --dest
  packages/editor/src/components/AdjustmentLayer/adjustmentEditors --json`
  → exit 0, `{"ok":true,"baseCount":24,"presentCount":33,"missing":[],
  "missingExports":[]}`.
- Covering pair, direct vitest substitution:
  `./node_modules/.bin/vitest run
  packages/editor/src/components/AdjustmentLayer/AdjustmentEditor.test.tsx
  packages/editor/src/components/AdjustmentLayer/AdjustmentPanel.test.tsx
  --reporter=dot` → before: 2 files / 32 tests passed (18 + 14) / 0 failed /
  45.90 s; after: 2 files / 32 tests passed / 0 failed / 65.76 s. Exit 0 both
  times. The covering test file is untouched (309 lines, same sha256).
- `./node_modules/.bin/tsc -p packages/editor/tsconfig.json --noEmit --pretty
  false` → exit 0, 0 diagnostics.
- `node scripts/audit-health.mjs` → exit 0, "audit-health: ✓ health check
  passed".
- `node scripts/audit-emoji.mjs` → clean (5,779 files); `node
  scripts/audit-docs.mjs` → clean (1,325 docs, 1,056 links, 183 ADRs).
- `pnpm audit:filesize` before the ratchet → exit 0, 944 files over the cap,
  1 stale entry (the just-split target); after the ratchet see below.
- Direct recursive `tsc` program on the final post-split tree (20 package
  tsconfigs + `apps/desktop` + `tests/e2e`, run with
  `./node_modules/.bin/tsc` because the queue is EROFS) → `PACKAGES_CHECKED=20
  PACKAGES_FAILED=0 DESKTOP_EXIT=0 E2E_EXIT=0 DIAGNOSTICS=0` (22 projects
  total, exit 0).

### Ratchet

- `node scripts/quality/audit-file-size.mjs --update` → exit 0: "Wrote
  .file-size-baseline.json: 944 frozen file(s) over 400 lines. added 0, grown 0,
  removed 1 (splits/deletes/untracked-pruned). 24 untracked file(s) scanned;
  over-cap WIP is never frozen."
- `git diff .file-size-baseline.json` = 1 deletion, exactly
  `"packages/editor/src/components/AdjustmentLayer/AdjustmentEditor.tsx": 2405`;
  no entry added, no entry grown.
- `pnpm audit:filesize` after the ratchet → exit 0: "File-size budget OK: 6304
  source files scanned; 944 over 400 lines, all frozen in
  .file-size-baseline.json (tracked content)."
- `node scripts/quality/audit-file-size.mjs --report` after the ratchet: 6,304
  source files scanned; 944 over the 400-line cap; 944 frozen; 0 violations;
  0 untracked WIP over-cap files; 0 stale; excess over cap 292,928 lines (was
  294,933; the 2,005-line delta is the parent's 2,405 lines minus the 400-line
  cap it left). Largest destination module = 322 lines.

### Visual statement

No visual surface changed: the moved JSX, DOM structure, class names, aria
attributes, copy, and prop contracts are unchanged; the original module path
keeps its four named exports; `AdjustmentEditor.test.tsx` (18 passed / 0 failed)
and `AdjustmentPanel.test.tsx` (14 passed) are untouched and green before and
after; no visual baseline exists for this component, and no visual baseline,
screenshot, e2e file, or browser lane was touched or run.

### Staged checkpoint

- Staged seam = 31 paths: the 15-line target shell, the 24 destination
  modules, `.file-size-baseline.json` (one removal), `BACKLOG_LEDGER.md` (one
  new row, 11 columns, caller-generated timestamp `2026-10-29T16:28:25-07:00`),
  `docs/agents/repo-map.generated.md` (regenerated from the staged tree:
  tracked files 11,352 → 11,379; source files 6,280 → 6,304;
  `packages/editor` 2,320 → 2,344; `remediation` 51 → 54), and
  `remediation/B-11/{RESEARCH,GAP_ANALYSIS,SEAM_SPEC}.md`.
- `pnpm verify:commit` → exit 0: "Commit checkpoint: 31 staged path(s)";
  staged biome check "Checked 26 files ... No fixes applied"; "Agent map OK:
  docs/agents/repo-map.generated.md matches the committed tree (11379 files)";
  "File-size budget (staged) OK: 25 staged source file(s) at or under 400
  lines"; "audit-health: ✓ health check passed"; audit-impact-config ok; E2E
  interaction audit 500 files / 0 forced checkbox actions; secret scan clean;
  audit-contacts clean; audit-docs clean (1,325 docs, 1,056 links, 183 ADRs);
  import boundaries OK; gitleaks 0 leaks. Browser E2E/visual/native/full-suite
  certification is deferred by policy and was not run.
- Commit: one conventional `refactor(editor): split adjustment editor into
  adjustmentEditors/ modules (Batch B/B-11)` commit on
  `seam/B/B-11-adjustment-editor`; no AI-tool attribution or co-author
  trailers; branch left local and unmerged for Lead review (no push, no merge).
- Environment note: advisory path claims cannot be recorded in this worktree
  (`path-claims` runtime dir `/run/user/1000/varve-path-claims` is EROFS);
  claims are advisory and never gate commits or validation, so this does not
  block the seam. No claim from another session was found in the measured
  worktree status.
