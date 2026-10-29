# B-10 seam spec — ContentAwareFillDialog split into dialog/ modules

**Single concern.** Pure declaration motion of the dialog shell, state/handler
hooks, preview canvas, control sections and result placement out of
`packages/editor/src/components/ContentAwareFill/ContentAwareFillDialog.tsx`
into `packages/editor/src/components/ContentAwareFill/dialog/`. No behavior,
rendering, DOM, prop, state-transition, API or error-state change: moved lines
are byte-identical after dedent, comments and JSDoc stay verbatim, declarations
keep their names, and every hook order/dependency array is preserved. The public
export surface is unchanged: `ContentAwareFillDialog` and
`ContentAwareFillDialogProps` stay exported from the same module path
(`components/ContentAwareFill/index.ts` is untouched).

**No visual surface changed** — the dialog's JSX/DOM/class names/aria labels/
text/props are unmoved and its export path is unchanged. No jsdom spec mounts
the dialog today (measured gap; recorded in GAP_ANALYSIS.md); the rendered
surface is covered by `tests/e2e/caf/caf.spec.ts` (22 tests + 11 PNG baselines,
heavy-lease, untouched and deferred by policy). The substitute proof is the
unchanged 10-file / 102-test covering set before and after plus the
partition/byte-identity accounting below. The front-end gate (prompt 03) is
answered "not triggered" (no rendered-surface change); the visual-validation
gate (prompt 04) does not fire: no baseline edit, no browser lane.

## Pre-flight (measured on the clean worktree, branch seam/B/B-10-content-aware-fill, HEAD 6128380b3)

- `git rev-parse --short HEAD` = `6128380b3`; worktree branch
  `seam/B/B-10-content-aware-fill` created from local `master`
  (fast-forwarded f1411c4ac -> 6128380b3, the B-09 seam).
- `pnpm audit:filesize` exit 0: `File-size budget OK: 6234 source files
  scanned; 946 over 400 lines, all frozen in .file-size-baseline.json`
  (0 stale, 0 untracked WIP over-cap in this clean worktree).
- `grep -n 'ContentAwareFillDialog.tsx' .file-size-baseline.json` = single
  frozen entry 4513 (frozen_lines 4513); `wc -l` target = 4513.
- `node scripts/quality/godsplit-plan.mjs <target>` exit 0: 21 imports,
  29 blocks, lines 4513; hazard rows "sub-split required: ContentAwareFillDialog
  lines 502-4513 is 4012 lines on its own".
- `node scripts/quality/refactor-verify.mjs --base master --target <target>
  --json` exit 0 with `{"ok":true,"baseCount":29,"presentCount":29,"missing":[],"missingExports":[]}`.
- Covering set before the move (direct vitest, queue-EROFS substitution):
  10 files, `Test Files 10 passed`, `Tests 102 passed (102)`, 0 failed.
  Files: `packages/editor/src/actions/createActionHandlers.test.ts`,
  `packages/editor/src/actions/registerAll.test.ts` and the 8 sibling suites
  `packages/editor/src/components/ContentAwareFill/{expandCanvas,expandComposition,expandControls,generationRaster,maskOperations,selectionEvidence,selectionHealth,variationSession}.test.ts`.
- Direct recursive TypeScript substitution (queue EROFS):
  `packages-checked=20 packages-fail=0 desktop-exit=0 e2e-exit=0` (exit 0).
- `pnpm worktree:status` / `pnpm queue:status`: validation queue exclusive
  free; this task is the only writer in `.worktrees/B-10`; single-writer
  surfaces (baseline, repo map, ledger) are touched only by this seam.
- Consumer inventory: `packages/editor/src/Shell.tsx:33` imports
  `ContentAwareFillDialog` from `./components/ContentAwareFill`;
  `packages/editor/src/components/ContentAwareFill/index.ts` re-exports the
  component (line 2) and its props type (line 1). No other source module imports
  the target file. No spec mounts the dialog directly (gap recorded).

## Declaration inventory (hand-completed from the planner's 29-block table)

Every top-level declaration of the target at base, its base range and its
destination. "Target" means it stays in `ContentAwareFillDialog.tsx`; all
moved declarations gain a named export in their destination module (they were
module-private at base; the verifier requires the name to exist at top level,
not that it was exported before).

| # | kind | name | base range | base export | destination |
|---|------|------|------------|-------------|-------------|
| 1 | Variable | MODEL_ID | 106-106 | no | dialog/constants.ts |
| 2 | Variable | DEFAULT_BRUSH_SIZE | 107-107 | no | dialog/constants.ts |
| 3 | Variable | MAX_BATCH_VARIATIONS | 108-108 | no | dialog/constants.ts |
| 4 | Variable | MAX_RETAINED_VARIATIONS | 109-109 | no | dialog/constants.ts |
| 5 | Variable | MAX_PREVIEW_PIXELS | 110-110 | no | dialog/constants.ts |
| 6 | Variable | MAX_VARIATION_THUMBNAIL_DIMENSION | 111-111 | no | dialog/constants.ts |
| 7 | Variable | MAX_SOURCE_PROXY_DIMENSION | 112-112 | no | dialog/constants.ts |
| 8 | Variable | MAX_SOURCE_IDENTITY_PIXELS | 113-113 | no | dialog/constants.ts |
| 9 | Variable | MAX_SOURCE_MASK_REFINEMENT_PIXELS | 114-114 | no | dialog/constants.ts |
| 10 | TypeAlias | EditableSourceMask | 116-124 | no | dialog/types.ts |
| 11 | Function | previewRasterDimensions | 126-132 | no | dialog/previewEncoding.ts |
| 12 | Function | maskCoverageDataUrl | 134-142 | no | dialog/previewEncoding.ts |
| 13 | Function | imageDataDataUrl | 144-152 | no | dialog/previewEncoding.ts |
| 14 | Function | thumbnailDimensions | 154-160 | no | dialog/previewEncoding.ts |
| 15 | Function | thumbnailDataUrlFromCanvas | 163-177 | no | dialog/previewEncoding.ts |
| 16 | Function | loadBoundedImageSource | 179-190 | no | dialog/imageLoading.ts |
| 17 | Interface | VisibleSourceOverlay | 192-201 | no | dialog/sourceOverlays.ts |
| 18 | Function | validOverlaySourceFrame | 203-211 | no | dialog/sourceOverlays.ts |
| 19 | Function | loadVisibleImageSource | 219-268 | no | dialog/imageLoading.ts |
| 20 | Function | imageSourceDims | 270-277 | no | dialog/imageLoading.ts |
| 21 | Function | visibleSourceOverlays | 279-329 | no | dialog/sourceOverlays.ts |
| 22 | Function | loadImageToImageData | 331-354 | no | dialog/imageLoading.ts |
| 23 | Function | readCurrentSourceIdentity | 357-392 | no | dialog/sourceIdentity.ts |
| 24 | Function | persistedVariationResult | 395-435 | no | dialog/persistedVariations.ts |
| 25 | Function | unloadedVariationImageData | 443-445 | no | dialog/persistedVariations.ts |
| 26 | Function | metadataOnlyVariationResult | 447-449 | no | dialog/persistedVariations.ts |
| 27 | Function | persistedVariationPreviewDataUrl | 452-493 | no | dialog/persistedVariations.ts |
| 28 | Interface | ContentAwareFillDialogProps | 495-500 | yes | stays in target (re-exported by index.ts) |
| 29 | Function | ContentAwareFillDialog | 502-4513 | yes | stays in target as thin shell |

Declarations that move but are not planner blocks (in-function locals promoted to
module-level type aliases; structural additions, no runtime behavior):
`DialogStatus` (in-function type alias, line 634) stays inside
`useDialogState` (not importable, not needed elsewhere); `GenerationPrepared`,
`GenerationPrelude`, `GenerationContext`, `GenerationRuntime`,
`GeneratedVariation` replace inline object/array types at lines 2252-2272,
2597-2608 and are type-only (erased at runtime).

## Sub-split: the 4,012-line component body

The component body is a single 4,012-line function; the seam therefore uses the
B-09 phase pattern: the parent keeps the same name/signature/export and calls
`useDialogRuntime`, which composes hook phases; the render body is partitioned
into top-level section components. Hook phases are contiguous statement ranges
of the base body (the base body has 171 top-level statements); the planner
hazard "sub-split required" is answered by the table below.

| phase module | base ranges (component body) | content | effects |
|--------------|------------------------------|---------|---------|
| dialog/useDialogState.ts | 508-668 | editor destructure, 16 refs, 49 useState, in-function DialogStatus | none |
| dialog/useDialogDerived.ts | 669-909 | 48 derived values + render-phase currentJobSnapshotRef assignment (897-909) | none |
| dialog/useDialogSessionLifecycle.ts | 911-1115 | invalidatePreview/resetPreviewToSource/handleEditMask/bumpMaskRevision + effects A-G (955,971,981,1042,1078,1097,1107) | A-G |
| dialog/useModelStatus.ts | 1117-1162 + 1965-2143 | model availability effects H,I + download/import/qualify handlers | H,I |
| dialog/useSourcePreviewRestore.ts | 1164-1442 | source/variation preview restore effect J | J |
| dialog/usePreviewCentering.ts | 1444-1454 | centerPreview + rAF effect K | K |
| dialog/usePreviewZoom.ts | 1456-1497 | preview dimensions, fit/custom zoom callbacks | none |
| dialog/useMaskPainting.ts | 1499-1674 + 1936-1963 | paintAt/pointer handlers/applyMaskCoverage/handleClearMask/handleInvertMask | none |
| dialog/useMaskSources.ts | 1676-1934 | pixel/object/layer/bg-removal/alpha mask source handlers | none |
| dialog/useGeneration.ts | 2145-2273 + 2558-2596 + 2843-2883 | guard prelude, job token/isCurrentJob, context setup, generation try/catch/deps | none |
| dialog/generationExpandStage.ts | 2275-2338 | expand-mode prepared region (wrapper function) | none |
| dialog/generationBoundedStage.ts | 2340-2556 | bounded-mode prepared region (wrapper function) | none |
| dialog/generationVariations.ts | 2597-2756 | generatedVariations/expandFullResolutionSource + variation loop | none |
| dialog/generationAssemble.ts | 2757-2842 | result finalization into generationRef/state | none |
| dialog/useApply.ts | 2885-3262 | handleApply (try/catch; 2923-2962 moves to applyAssets) | none |
| dialog/applyAssets.ts | 2923-2962 | makeMaskAsset + mask/context asset assembly (wrapper function) | none |
| dialog/useVariationActions.ts | 3264-3292 | handleDeleteVariation | none |
| dialog/useDialogRuntime.ts | new | composition in effect order A..K; returns DialogRuntime | none |

Effect order is preserved exactly by the composition order above: A(955),
B(971), C(981), D(1042), E(1078), F(1097), G(1107), H(1117), I(1137), J(1164),
K(1451). Effects live only in lifecycle/modelStatus/sourcePreviewRestore/
centering; every other phase has no effect. `useCallback`/`useMemo` order may
change only inside the same render as part of the same hook graph; identities and
dependency arrays are byte-identical to base.

### JSX render body -> section components (base spans, all .tsx)

The root render is `return (` at 3296; `<dialog>` 3297-4511; header child
3329-3354; body child 3356-4474 (left column 3357-4362 with 21 children, right
column 4364-4473); footer child 4476-4510. The error banner expression
4307-4311 stays inline in the shell; all other contiguous child spans become
one section component each (fragments where a span has multiple sibling
children).

| section module | base span | notes |
|----------------|-----------|-------|
| dialog/sections/DialogHeader.tsx | 3329-3354 | header row + close button |
| dialog/sections/ModeSection.tsx | 3358-3397 | mode selector |
| dialog/sections/PromptSection.tsx | 3399-3446 | prompt/negative prompt (conditional expression) |
| dialog/sections/ProviderBadge.tsx | 3448-3471 | provider badge + resource hint (fragment) |
| dialog/sections/DiffusionModelSection.tsx | 3473-3552 | diffusion model state (conditional) |
| dialog/sections/DiffusionRefinementSection.tsx | 3554-3635 | diffusion refinement controls (conditional) |
| dialog/sections/MaskSourceSection.tsx | 3637-3867 | mask source pickers |
| dialog/sections/ExpandSection.tsx | 3869-4046 | expand controls (conditional) |
| dialog/sections/QualitySection.tsx | 4048-4072 | quality selector |
| dialog/sections/ModelDownloadSection.tsx | 4074-4113 | download/import/qualify states (fragment) |
| dialog/sections/MaskControlsSection.tsx | 4115-4185 | brush + refinement controls (fragment) |
| dialog/sections/VariationSettingsSection.tsx | 4187-4223 | variation count/seed |
| dialog/sections/MaskStateSection.tsx | 4225-4260 | show-mask/edit-mask/clear (fragment) |
| dialog/sections/GenerateSection.tsx | 4262-4305 | generate/cancel block |
| dialog/sections/VariationsFieldset.tsx | 4313-4361 | result variations fieldset (conditional) |
| dialog/sections/PreviewToolbar.tsx | 4365-4432 | preview toolbar |
| dialog/sections/PreviewViewport.tsx | 4434-4472 | preview/mask canvas viewport |
| dialog/sections/DialogFooter.tsx | 4476-4510 | footer info + apply/cancel |

## Destination map (every file <= 400 lines; planned sizes)

| file | content | planned lines |
|------|---------|---------------|
| ContentAwareFillDialog.tsx (parent) | props interface, signature, runtime call/destructure, guard, root shell + section tags + inline error banner | ~110 |
| dialog/constants.ts | 9 module constants | ~12 |
| dialog/types.ts | EditableSourceMask | ~14 |
| dialog/previewEncoding.ts | preview/thumbnail encoders | ~70 |
| dialog/imageLoading.ts | bounded/visible source loading + dims | ~110 |
| dialog/sourceOverlays.ts | VisibleSourceOverlay + overlay helpers | ~80 |
| dialog/sourceIdentity.ts | readCurrentSourceIdentity | ~45 |
| dialog/persistedVariations.ts | persisted variation rehydrate/encode | ~100 |
| dialog/generationTypes.ts | GenerationRuntime/Prelude/Prepared/Context/GeneratedVariation | ~100 |
| dialog/useDialogState.ts | state/ref cluster | ~215 |
| dialog/useDialogDerived.ts | derived values | ~280 |
| dialog/useDialogSessionLifecycle.ts | callbacks + effects A-G | ~245 |
| dialog/useModelStatus.ts | effects H,I + model handlers | ~270 |
| dialog/useSourcePreviewRestore.ts | effect J | ~320 |
| dialog/usePreviewCentering.ts | centerPreview + effect K | ~30 |
| dialog/usePreviewZoom.ts | zoom | ~55 |
| dialog/useMaskPainting.ts | mask paint handlers | ~230 |
| dialog/useMaskSources.ts | mask source handlers | ~290 |
| dialog/useGeneration.ts | generation orchestration | ~290 |
| dialog/generationExpandStage.ts | expand prepared region | ~100 |
| dialog/generationBoundedStage.ts | bounded prepared region | ~260 |
| dialog/generationVariations.ts | variation loop | ~195 |
| dialog/generationAssemble.ts | result finalization | ~140 |
| dialog/useApply.ts | handleApply | ~380 |
| dialog/applyAssets.ts | mask/context asset assembly | ~75 |
| dialog/useVariationActions.ts | delete variation | ~50 |
| dialog/useDialogRuntime.ts | hook composition | ~50 |
| dialog/sections/*.tsx (18) | base JSX spans above | 40-285 each |

Contingency: if a generated module lands over 400 lines after formatting, split
it further inside `dialog/` (still one seam) — candidates: `useMaskSources`
(split object-selection handler), `useApply` (already pre-split via
applyAssets), `useSourcePreviewRestore` (split the persisted-variation restore
half), `MaskSourceSection` (split object-selection block). No new module may
exceed 400 lines.

## Planned edits (the complete allowlist)

1. Parent: keep lines 495-500 (props) and 502-507 (signature) verbatim; body
   becomes: runtime call, destructure of the 8 shell values
   (`dialogRef, backdropPressRef, isProcessing, adjustZoom, selectFitZoom,
   selectOneToOneZoom, status, errorMessage`), the guard line 3294 verbatim,
   root <dialog> 3297-3328 verbatim (attribute code untouched), section tags in
   place of the section spans, inline error banner 4307-4311 verbatim, footer
   tag, closers. The CSS side-effect import (base line 104) stays exactly once,
   in the parent.
2. Destination helper/hook/section modules: base ranges moved verbatim (only
   leading-indent dedent); header import block with specifiers rebased one level
   deeper, named value/type imports only (no `export *`, no default exports; a
   moved declaration gets an `export` modifier so its one home is named); each
   hook wrapper adds only: signature with a precise params type, one destructure
   of the params, and one return object of its declared names; each section adds
   only: controller prop, one destructure, fragment/return wrapper.
3. `useGeneration`: inline expand block 2275-2338 and bounded block 2340-2556
   are replaced where they stood by helper calls plus destructuring assignment
   to the 10 base `let` declarations (declaration lines 2246-2272 verbatim);
   2597-2756 replaced by `const generatedVariations = await
   runVariationBatch(...)`; 2757-2842 replaced by `await
   assembleGenerationResult(...)`; catch 2843-2851 and dependency array
   2852-2883 verbatim.
4. `useApply`: 2923-2962 replaced by one destructuring call to
   `createGenerativeMaskAssets(...)` at the same position; all other lines
   verbatim.
5. Type-only additions: `GenerationPrepared`, `GenerationPrelude`,
   `GenerationContext`, `GenerationRuntime`, `GeneratedVariation`, and the
   return/param types of extracted wrappers. No runtime code is added.
6. No other line changes: no renames, no reformat outside biome, no behavior,
   no new state/effect/test/snapshot, no test edit.

## Hook invariants

- `useDialogRuntime` call order (one render, unconditional): state, derived,
  lifecycle (A-G), modelStatus (H,I), sourcePreviewRestore (J), centering (K),
  zoom, maskPainting, maskSources, generation, apply, variationActions.
- The render-phase assignment `currentJobSnapshotRef.current = ...` (base
  897-909) stays in `useDialogDerived`; it still runs on every render before
  effects J/generation read the snapshot.
- useState/useRef creation order and count are unchanged; every useCallback/
  useMemo dependency array is moved byte-verbatim (including 2852-2883 and
  2884, 3291).
- The shell guard `if (!isOpen && !dialogRef.current?.open) return null;`
  stays after the single unconditional runtime call.
- No effect is added, removed, reordered or reconditioned.
- Module-scope singletons/constants: the 9 constants get exactly one home
  (`dialog/constants.ts`); the CSS side-effect import appears once, in the
  parent.

## Proof plan

1. `refactor-verify` exit 0 before tests: `{ok:true, baseCount:29,
   presentCount:29, missing:[], missingExports:[]}`; rerun after biome format.
2. Covering set 102/102 before and after, same 10 files, 0 failures; sha256 of
   every covering spec unchanged (no test/snapshot edit).
3. Direct recursive tsc substitution exit 0 (20 packages + desktop + e2e);
   `biome check` clean on all changed files; `node scripts/audit-health.mjs`
   exit 0.
4. Partition/byte-identity accounting: every base line 1-4513 classified
   exactly once as (a) moved verbatim after dedent into exactly one destination
   module, (b) shell line kept verbatim in the parent, or (c) structural glue
   in the allowlist; per-module whitespace-stripped token stream equals the
   concatenation of its assigned base ranges; measured counts recorded below.
5. Ratchet 946 -> 945: baseline diff removes exactly the target entry, 0 added,
   0 grown; `pnpm audit:filesize` exit 0; target absent from `--report`.
6. Stage seam + baseline + remediation docs, `pnpm agent:map`, ledger row,
   `pnpm verify:commit` exit 0; one commit on
   `seam/B/B-10-content-aware-fill`; no merge/push.
7. Visual: no baseline file changed, `caf.spec.ts` + 11 PNGs untouched;
   statement above.

## Stop conditions (blockers, not bypasses)

- Any moved range that would need a semantic edit to compile (a rename, a
  changed condition, a changed reference) is out of scope: stop and record.
- Any declaration missing from `refactor-verify` output, any exported name that
  cannot survive at its new home, or a verifier exit 1/2: fix the cut, never the
  verifier.
- Any destination module over 400 lines after formatting, or any frozen file
  grown: stop; do not use `--update --force` and do not hand-edit the baseline.
- Any covering test count decrease, failure or test-file edit: stop.
- Any hook-order/dependency-array drift that cannot be proven by the byte
  identity check: stop.
- tsc/health/biome red that cannot be explained by a missed import rebase: stop.

## Measured proof (after the move; filled from this worktree)

### Partition / byte identity

- Base blob: `git show HEAD:packages/editor/src/components/ContentAwareFill/ContentAwareFillDialog.tsx | sha256sum`
  = `8f690a2ffccc2a831be79b40d7c2d120e1d3d6c415a82edcfd3a19d3066a951a`.
- Line arithmetic: 4,513 base lines = **4,315 moved declaration lines in
  52 ranges** (component body, helpers, JSX sections) + **104 rewritten
  import-region lines** (1-104: the parent import block is replaced by the new
  imports; the CSS side-effect import appears exactly once in the parent) +
  **94 shell/structural lines** (props interface 495-500, signature 502-507,
  guard 3294, root `<dialog>` attributes 3297-3328, inline error banner
  4307-4311, `</dialog>`/closers 4511-4513, and the base blank separators
  dropped at module boundaries). 4,315 + 104 + 94 = 4,513; no line is both moved
  and kept.
- Unit proof: 1,162 units checked, **0 missing**. Units = every top-level helper
  declaration (106-493), the component-body statements and their non-JSX
  descendants (except the transformed `handleGenerate`/`handleApply`
  wrappers, whose inner statements are checked individually), all 18 section
  spans, and the shell units (props interface, signature, `<dialog>`
  attributes, error banner). Comparison is whitespace-insensitive and ignores
  punctuation-only artifacts of formatting; top-level declarations are allowed
  the planned `export ` modifier. 16 of 18 section spans are exact canonical
  substrings of their section component; 2 of 18 (DiffusionModelSection,
  ExpandSection) are token-multiset-identical because biome reordered
  whitespace-only JSX separator expressions (`{' '}`) around adjacent text
  without changing the rendered character sequence (the measured hint text is
  identical). Each of the 18 section components appears exactly once in the
  parent; no duplicate section render, no duplicated CSS import.
- Moved ranges: 52 ranges over 4,315 lines; 42 destination modules created
  (24 top-level `.ts` + 18 section `.tsx`); the parent drops from 4,513 to
  **112 lines** (measured `wc -l`).

### Formatting

- `pnpm exec biome check --write --unsafe` on the parent plus
  `dialog/`, then `pnpm exec biome check` on the same 43 files: "Checked 43
  files ... No fixes applied" (clean).
- Formatting-only effects: import ordering, single-line reflow of moved
  signatures/returns, trailing commas in wrapped parameter lists, and two
  whitespace-only JSX separator reorderings (see above). No semantic token
  changed; the covering set and the identity proof were re-run after the final
  formatting pass.

### Gates

- `refactor-verify --base master --target .../ContentAwareFillDialog.tsx
  --dest .../dialog --json` (final, after biome):
  `{"ok":true,"baseCount":29,"presentCount":85,"missing":[],"missingExports":[]}`,
  exit 0 (the planned structural declarations raise presentCount above the base
  29; every base declaration and export is preserved).
- Covering set, direct vitest (queue-EROFS substitution): **10 files / 102
  passed / 0 failed both before and after** (measured `Test Files 10 passed
  (10)`, `Tests 102 passed (102)`); no covering spec was edited (aggregate
  sha256 of the 10 specs `eebf3c46bc3e9f208f0c66b63754d62bd8c97b48e0516792d4d5f3cc1c9ba604`
  unchanged; `git status` shows no test path).
- Direct TypeScript substitute: `packages/editor` `tsc -p tsconfig.json
  --noEmit` exit 0; full recursive check (20 package tsconfigs +
  `apps/desktop` + `tests/e2e`) **20/20 packages pass, 0 fail,
  desktop-exit=0, e2e-exit=0** (fails-only output, 0 diagnostics).
- `node scripts/audit-health.mjs`: "audit-health: health check passed"
  (hub caps/complexity/cycles; the dialog component is no longer a
  component-complexity offender).
- Staged-only checkpoint: `node scripts/quality/generate-agent-map.mjs
  --staged` -> "Agent map OK ... (11286 files)"; `pnpm verify:commit` exit 0
  (49 staged paths; biome --staged, emoji, agent map, staged file size
  "43 staged source file(s) at or under 400 lines", staged health,
  impact-config, e2e-interactions, secrets, contacts, docs, import boundaries,
  gitleaks --staged all clean).
- No visual baseline file, screenshot, e2e spec, lockfile, manifest, dated doc
  or campaign-plan file changed.

### Ratchet

- `node scripts/quality/audit-file-size.mjs --update` (no `--force`):
  "Wrote .file-size-baseline.json: **945 frozen file(s)** over 400 lines.
  added 0, grown 0, removed 1 (splits/deletes/untracked-pruned)."
- `git diff -- .file-size-baseline.json` removes exactly
  `"packages/editor/src/components/ContentAwareFill/ContentAwareFillDialog.tsx": 4513`
  and nothing else; 946 -> **945** frozen entries.
- `pnpm audit:filesize` exit 0: "File-size budget OK: 6276 source files
  scanned; 945 over 400 lines, all frozen". `--report`: 945 frozen / 0
  violations / 0 untracked WIP over-cap / 0 stale; excess over cap **294,933
  lines** (299,046 -> 294,933; the delta is exactly 4,113 = 4,513 - 400).
  Every destination module is at or under 400 lines (largest
  `generationPrepare.ts` 381; then `generationRun.ts` 372,
  `useApply.ts` 371, `useDialogDerived.ts` 343,
  `useSourcePreviewRestore.ts` 336, `useMaskSources.ts` 278; total
  destination 5,753 lines over 42 files); the parent is 112 lines.

### Visual statement

No visual surface changed: the dialog's JSX, DOM structure, class names, aria
attributes, copy/props and export path are unchanged; no visual baseline or e2e
file was modified and no browser lane ran.
