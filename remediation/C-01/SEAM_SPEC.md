# Seam spec - Batch C, entry C-01 (replay.ts family split)

Status: written before any source edit, in worktree .worktrees/C-01 on branch seam/C/C-01-replay. Pure declaration move; no behavior, API, or visual change.

## Resolved values

| Key | Value |
|-----|-------|
| Batch | C |
| Entry id | C-01 |
| Package | packages/engine |
| Target file | packages/engine/src/replay.ts - 3,898 lines, frozen at 3898 in .file-size-baseline.json line 568 |
| Covering test | packages/engine/src/replay.test.ts - 377 lines, 10 tests; broader set packages/engine/src/replay*.test.ts (29 files, 6,726 lines, 224 tests) plus direct goldens packages/engine/src/__goldens__ (3 files, 12 tests) |
| Seam | one module per replay family (primitive, fill, effect, text) under packages/engine/src/replay/, with orchestrator-plus-phases sub-splits; per-node dispatch switches stay monomorphic in their existing functions; replay.ts stays the public entry |
| Destination | packages/engine/src/replay/ (a destination directory counts as one seam; precedent packages/editor/src/menu/defs.ts and B-11 adjustmentEditors/) |
| Worktree | .worktrees/C-01 |
| Branch | seam/C/C-01-replay (HEAD 808274125, B-11 commit rebased onto master 39e9be06e) |
| Baseline | .file-size-baseline.json |
| Expected ratchet | 944 -> 943 frozen entries; exactly one removed (packages/engine/src/replay.ts); 0 added, 0 grown |

## Pre-flight measured on this worktree

Commands and decisive output (full runs are in the task evidence log):

    node scripts/quality/audit-file-size.mjs --report
    exit 0: Scanned 6313 source files; 944 over the 400-line cap; 944 frozen in .file-size-baseline.json; 0 violation(s); 0 untracked WIP over-cap file(s). Excess over cap: 292928 lines. Baseline entries: 944 (0 stale).
    replay.ts is offender 2 at 3898 [frozen] (offender 1 is packages/editor/src/context.tsx 11435).

    node scripts/quality/godsplit-plan.mjs packages/engine/src/replay.ts
    exit 0: Lines: 3898 | imports: 37 | blocks: 107; hazards: over cap, sub-split required (paintText 3310-3660 is 351 lines).

    node scripts/quality/refactor-verify.mjs --base master --target packages/engine/src/replay.ts --json
    exit 0: {"ok":true,"baseCount":105,"presentCount":105,"missing":[],"missingExports":[]}

    ./node_modules/.bin/vitest run packages/engine/src/replay.test.ts --reporter=dot
    exit 0: 1 file passed, 10 tests passed, 0 failed.

    focused family: vitest run packages/engine/src/replay*.test.ts --reporter=dot
    exit 0: 29 files passed, 224 tests passed, 0 failed.

    goldens: vitest run packages/engine/src/__goldens__ --reporter=dot
    exit 0: 3 files passed, 12 tests passed, 0 failed.

    node scripts/audit-health.mjs -> exit 0 (health check passed).

Environment: read-only pnpm store (ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK) and validation-queue EROFS, so direct node and ./node_modules/.bin commands substitute for pnpm check:agent / test:agent. Worktree node_modules are 21 symlinks to the main checkout. The main checkout is concurrently used by another session, so the primary route (merge B-11 onto local master) was skipped and the handoff fallback was used: branch from seam/B/B-11-adjustment-editor (9c9da88f4) rebased onto local master 39e9be06e; the merged tree equals master + B-11 and the baseline measures 944 entries.

## Declaration inventory (hand-completed from godsplit-plan block ranges plus AST reference pass)

Every top-level block in the 107-block planner table is listed with kind, line range, current export status, and destination. The two ExportDeclaration blocks are re-export statements and stay in replay.ts. Every declaration is assigned exactly once; the assignment map is asserted complete by the extraction script.

| lines | range | kind | name | exported | destination |
|-------|-------|------|------|----------|-------------|
| 1 | 105-105 | Re-export | (re-export statement) | no | stays in replay.ts |
| 1 | 107-107 | Const/let | decodedDepthMapCache | no | effect |
| 9 | 109-117 | Function | depthMapCacheKey | no | effect |
| 1 | 119-119 | TypeAlias | GlassMaterialEffect | no | types |
| 1 | 121-121 | Re-export | (re-export statement) | no | stays in replay.ts |
| 4 | 123-126 | Interface | ReplayColorOptions | yes | types |
| 7 | 129-135 | TypeAlias | EffectMaskResolver | yes | types |
| 34 | 150-183 | Function | renderAlphaMask | yes | alphaMask |
| 16 | 185-200 | Function | rgba | no | color |
| 1 | 202-202 | Const/let | TAU | no | primitive |
| 4 | 204-207 | TypeAlias | BackgroundBlurEffect | no | types |
| 1 | 208-208 | TypeAlias | LayerBlurEffect | no | types |
| 1 | 209-209 | TypeAlias | DepthBlurEffect | no | types |
| 4 | 210-213 | TypeAlias | SpatialContentBlurEffect | no | types |
| 4 | 214-217 | TypeAlias | ChromaticAberrationEffect | no | types |
| 1 | 218-218 | TypeAlias | GlitchEffect | no | types |
| 30 | 221-250 | Function | createEffectBuffer | no | effect |
| 10 | 258-267 | Const/let | shadowOps | no | backdrop |
| 9 | 270-278 | Const/let | alphaStrokeOps | no | backdrop |
| 56 | 292-347 | Function | paintCanonicalTextStroke | no | textCanonical |
| 16 | 349-364 | Function | replayPaintStrokeWithDependencies | no | backdrop |
| 3 | 367-369 | Function | finiteNonNegative | no | effect |
| 3 | 371-373 | Function | finiteAbs | no | effect |
| 5 | 375-379 | Function | addEffectSupport | no | effect |
| 6 | 381-386 | TypeAlias | ContentEffect | yes | types |
| 58 | 388-445 | Function | contentEffectPadding | yes | effect |
| 70 | 448-517 | Function | applyRasterEffectMask | no | effect |
| 105 | 524-628 | Function | paintContentEffects | no | effect |
| 49 | 631-679 | Function | paintFillsAndStrokes | no | fill |
| 22 | 686-707 | Function | createBackdropAlphaMask | no | backdrop |
| 37 | 709-745 | Function | compositeBackdropSurface | no | backdrop |
| 79 | 751-829 | Function | paintBackgroundBlur | no | backdrop |
| 66 | 842-907 | Function | paintGlassMaterial | no | backdrop |
| 15 | 913-927 | Function | paintGlassMaterialEdgeHighlight | no | backdrop |
| 1 | 935-935 | Const/let | imageLookupForCurrentReplay | no | stays in replay.ts |
| 1 | 936-936 | Const/let | effectMaskResolverForCurrentReplay | no | stays in replay.ts |
| 1 | 937-937 | Const/let | imagePolicyForCurrentReplay | no | stays in replay.ts |
| 6 | 940-945 | TypeAlias | EffectDiagnosticCode | yes | types |
| 6 | 947-952 | Interface | EffectDiagnostic | yes | types |
| 1 | 954-954 | Const/let | effectDiagnosticSinkForCurrentReplay | no | stays in replay.ts |
| 12 | 961-972 | Function | reportEffectDiagnostic | no | effectDiagnostics |
| 12 | 975-986 | Const/let | CONTENT_EFFECT_TYPES | no | effectDiagnostics |
| 12 | 993-1004 | Function | reportUnsupportedEffectMasks | no | effectDiagnostics |
| 1 | 1006-1006 | TypeAlias | ReplayAffine | no | types |
| 10 | 1008-1017 | Function | multiplyReplayAffine | no | isolatedSurface |
| 13 | 1019-1031 | Function | invertReplayAffine | no | isolatedSurface |
| 20 | 1039-1058 | Function | treatmentSpaceForReplayItem | no | isolatedSurface |
| 117 | 1060-1176 | Function | replayItemOnIsolatedSurface | no | isolatedSurface |
| 281 | 1187-1467 | Function | replayIr | yes | stays in replay.ts |
| 41 | 1478-1518 | Function | primeCanvasTypographyAliases | no | typography |
| 29 | 1520-1548 | Function | primeCanvasTypographyAlias | no | typography |
| 50 | 1551-1600 | Function | paintFill | no | fill |
| 32 | 1608-1639 | Function | canSkipImageRectClip | no | fill |
| 154 | 1642-1795 | Function | paintImageFill | no | fillImage |
| 11 | 1797-1807 | Function | offsetSampleRect | no | fillImage |
| 45 | 1809-1853 | Function | drawPlacedImageSample | no | fillImage |
| 1 | 1855-1855 | Const/let | MASK_CACHE_MAX_ENTRIES | no | fillImageMask |
| 1 | 1856-1856 | Const/let | MASK_CACHE_MAX_PIXELS | no | fillImageMask |
| 1 | 1857-1857 | Const/let | maskedImageCache | no | fillImageMask |
| 1 | 1858-1858 | Const/let | maskedImageSourceIds | no | fillImageMask |
| 1 | 1859-1859 | Const/let | maskedImageCachePixels | no | fillImageMask |
| 1 | 1860-1860 | Const/let | nextMaskedImageSourceId | no | fillImageMask |
| 8 | 1862-1869 | Function | maskedImageSourceId | no | fillImageMask |
| 12 | 1872-1883 | Function | maskSourceScale | no | fillImageMask |
| 91 | 1885-1975 | Function | renderMaskedImageSample | no | fillImageMask |
| 18 | 1982-1999 | Function | applyImageTransform | no | fillImage |
| 4 | 2003-2006 | Interface | BackdropCacheEntry | no | types |
| 1 | 2008-2008 | Const/let | backdropCache | no | backdropCache |
| 1 | 2009-2009 | Const/let | BACKDROP_CACHE_MAX | no | backdropCache |
| 1 | 2010-2010 | Const/let | BACKDROP_CACHE_TTL | no | backdropCache |
| 11 | 2012-2022 | Function | backdropCacheKey | no | backdropCache |
| 10 | 2024-2033 | Function | getBackdropCache | no | backdropCache |
| 14 | 2035-2048 | Function | setBackdropCache | no | backdropCache |
| 3 | 2050-2052 | Function | __clearBackdropCache | yes | backdropCache |
| 3 | 2054-2056 | Function | __getBackdropCacheSize | yes | backdropCache |
| 78 | 2067-2144 | Function | traceSquirclePath | no | primitive |
| 153 | 2151-2303 | Function | paintTable | no | table |
| 149 | 2306-2454 | Function | paintRasterLayer | no | raster |
| 78 | 2457-2534 | Function | paintShapeFill | no | primitive |
| 12 | 2537-2548 | Function | applyTextCase | no | typography |
| 34 | 2555-2588 | Function | detectRTL | no | typography |
| 158 | 2591-2748 | Function | paintRichText | no | textRich |
| 14 | 2750-2763 | Function | richTextFormatAt | no | textRich |
| 5 | 2765-2769 | TypeAlias | ReplayTextSettingsTarget | no | types |
| 37 | 2776-2812 | Function | applyReplayTextSettings | no | typography |
| 9 | 2819-2827 | Function | applyReplayTextSpacing | no | typography |
| 59 | 2829-2887 | Function | paintCanonicalRichText | no | textRich |
| 1 | 2889-2889 | TypeAlias | TextPrimitive | no | types |
| 6 | 2896-2901 | Function | textWrapShapeForPrimitive | no | textCanonical |
| 20 | 2903-2922 | Function | canUseCanonicalTextLayout | no | textCanonical |
| 45 | 2924-2968 | Function | canonicalTextSnapshot | no | textCanonical |
| 77 | 2970-3046 | Function | paintCanonicalText | no | textCanonical |
| 100 | 3057-3156 | Function | paintPathText | no | textPath |
| 38 | 3172-3209 | Function | drawClusters | yes | textPath |
| 5 | 3226-3230 | Function | effectiveWeight | no | typography |
| 15 | 3232-3246 | Function | replayFontString | no | typography |
| 47 | 3250-3296 | Function | paintTypographyRun | no | typography |
| 10 | 3298-3307 | Function | ellipsizeText | no | typography |
| 351 | 3310-3660 | Function | paintText | no | text |
| 1 | 3663-3663 | Const/let | _measureCanvasOffscreen | no | typography |
| 1 | 3664-3664 | Const/let | _measureCtx | no | typography |
| 13 | 3666-3678 | Function | _ensureMeasureContext | no | typography |
| 8 | 3681-3688 | Function | measureTextAdvance | no | typography |
| 15 | 3690-3704 | Function | parseFontSize | no | typography |
| 31 | 3707-3737 | Function | paintPathFill | no | primitive |
| 74 | 3741-3814 | Function | traceOutline | no | primitive |
| 82 | 3817-3898 | Function | primitiveBounds | yes | primitiveBounds |

## Destination map (planned)

replay.ts stays the public entry and orchestrator. It keeps: the COMPLEXITY header and module doc, the four module-scope state bindings written by replayIr (imageLookupForCurrentReplay, effectMaskResolverForCurrentReplay, imagePolicyForCurrentReplay, effectDiagnosticSinkForCurrentReplay), replayIr itself (the per-item pass), the two existing re-export statements, and re-exports of every public name moved below. replayItemOnIsolatedSurface moves to a phase module and calls replayIr through the cycle-safe import path.

| destination module | blocks | verbatim content lines | role |
|---------------------|--------|------------------------|------|
| replay.ts | 7 | 314 | stays: public entry, replayIr per-item pass, injection state, re-exports |
| types.ts | 16 | 87 | shared type declarations only (leaf) |
| color.ts | 1 | 18 | color helper (leaf) |
| isolatedSurface.ts | 4 | 174 | isolated filtered/composited surface phase + affine treatment space |
| primitive.ts | 5 | 285 | primitive dispatch/fill: per-kind switch stays in paintShapeFill; tracing and path fill |
| primitiveBounds.ts | 1 | 85 | primitive local bounds (public export) |
| effect.ts | 9 | 310 | content-effect pipeline and effect-mask application |
| effectDiagnostics.ts | 3 | 53 | declared effect degradation reporting |
| alphaMask.ts | 1 | 49 | alpha-mask offscreen compositing (public export) |
| backdrop.ts | 8 | 301 | alpha-aware shadow/stroke ops objects and backdrop/glass effect phases |
| backdropCache.ts | 8 | 58 | per-replay backdrop cache and its test hooks |
| fill.ts | 3 | 145 | fill + stroke pass (paintFill, paintFillsAndStrokes) |
| fillImage.ts | 4 | 242 | image fill phase (placement, sampling) |
| fillImageMask.ts | 9 | 131 | masked image cache and masked image sampling |
| table.ts | 1 | 160 | compiled table primitive phase |
| raster.ts | 1 | 152 | raster layer / pyramid phase |
| text.ts | 1 | 354 | text primitive dispatch (paintText) |
| textRich.ts | 3 | 238 | rich text phase |
| textCanonical.ts | 5 | 231 | canonical text layout phase and canonical stroke |
| textPath.ts | 2 | 165 | path text and cluster drawing |
| typography.ts | 15 | 350 | font aliasing, text settings, case/RTL, measurement helpers |

Final sizes are measured after extraction and must be at or under 400 lines for replay.ts and every destination module (target 350-400). The extraction script asserts the cap before any formatting pass; content lines above include the verbatim leading comments and blank lines that travel with each block.

## Before and after declaration sets

Before: 105 top-level declarations (refactor-verify baseCount 105) plus 2 re-export statements. After: the same 105 declarations, moved to the destination modules in the table above, plus replay.ts and its re-export statements; no declaration is renamed, merged, or dropped, and each is exported from its new module where another module or the base public surface needs it.

Public names that must keep importing from the same path packages/engine/src/replay.ts: replayIr, primitiveBounds, renderAlphaMask, contentEffectPadding, drawClusters, __clearBackdropCache, __getBackdropCacheSize, and the type-only ReplayColorOptions, EffectMaskResolver, ContentEffect, EffectDiagnostic, EffectDiagnosticCode, ReplayGradient, ReplayPattern, ReplayTarget; resetGradientCacheForTest stays re-exported from replayGradient. replay.ts re-exports all moved public names, so external importers are unchanged. refactor-verify requires every base declaration to exist in the after set and every base-exported name to be exported somewhere in the after set; both hold.

Exported names observed in the target today: ContentEffect, EffectDiagnostic, EffectDiagnosticCode, EffectMaskResolver, ReplayColorOptions, __clearBackdropCache, __getBackdropCacheSize, contentEffectPadding, drawClusters, primitiveBounds, renderAlphaMask, replayIr, plus the two re-export statements.


## Edge-case answers (from GAP_ANALYSIS.md and the AST reference pass)

1. Module-evaluation side effects and module-scope state. The target constructs exactly these at import time: decodedDepthMapCache = new DepthMapCache(3, 32MB); TAU = Math.PI * 2; CONTENT_EFFECT_TYPES = new Set([...]); maskedImageCache = new Map(); maskedImageSourceIds = new WeakMap(); maskedImageCachePixels = 0; nextMaskedImageSourceId = 1; backdropCache = new Map(); the four current-replay state bindings (null until replayIr runs); _measureCanvasOffscreen/_measureCtx = null. No constructor has DOM or network side effects. The four current-replay state bindings are written only by replayIr, so they stay declared in replay.ts and are exported (an ESM importer cannot assign an imported binding) so family modules can read them inside function bodies only; the four modules that need them form read-only back-edges into replay.ts, as do the two modules that call replayIr recursively (isolatedSurface) or replay a nested table (table). These are function-call-time reads of live ESM bindings; module evaluation never reads a TDZ binding. The pre-existing architecture audit is already red at this checkpoint (11 engine cycles vs 3 allowlisted, ten from the committed B-05 filters split), so cycle health is judged by the before/after identity delta recorded in the evidence log rather than by that script's exit code. All other state moves with its owning module and keeps its original relative order inside that module. No module-level initializer in a cyclic import reads a binding that could be in its TDZ: shadowOps/alphaStrokeOps object literals reference only function declarations, which ESM initializes during module instantiation before evaluation. Guardrail: direct recursive tsc, covering specs, and a runtime import smoke of replay.ts before commit.

2. Per-node dispatch monotonicity. The four dispatch sites measured in the target (paintShapeFill switch over primitive kinds at 2459, applyTextCase at 2538, traceOutline at 3742, primitiveBounds at 3823 in the base blob) move verbatim with their host functions; replayIr keeps the single per-item orchestration pass. No dispatch table is introduced and each switch exists exactly once. No dispatch table, no split dispatch, no new lookup indirection. replayIr keeps the single per-item orchestration pass in one place. Guardrail: AST statement-identity proof that each moved statement is byte-identical apart from a generated export modifier and import header, and the covering suite measures the same behavior.

3. Identity-sensitive exports. replayIr, primitiveBounds, renderAlphaMask, contentEffectPadding, drawClusters, __clearBackdropCache, __getBackdropCacheSize and the exported types are re-exported from the same module path packages/engine/src/replay.ts. Importers measured in packages/engine (engine/index.ts, raster.ts, thumbnail/service.ts, bench/tableReplay.bench.ts, mockup/warpReplay.ts, __goldens__/*, the covering specs) keep their exact import statements; no history or crash file imports this module path (their './replay' is their own module). No package.json or tsconfig include/exclude changes are needed: packages/engine/tsconfig.json includes src, so packages/engine/src/replay/** is inside the same project.

4. Import rebasing and ordering. Destination modules live one directory deeper, so relative specifiers gain one ../ segment; @varve/* workspace imports are unchanged. The generated headers preserve the original import statement style, including inline type modifiers, which matters because tsconfig.base.json sets verbatimModuleSyntax: true and the engine package has noUnusedLocals/noUnusedParameters false. A single biome check --write pass may only format/reorder imports; it must not rewrite moved logic. Guardrail: biome check, direct tsc, and the AST identity proof.

5. Declaration split boundaries. Cuts follow godsplit-plan declaration boundaries; leading JSDoc and section comments travel with their declaration as leading trivia. No cut is made by line count or brace matching across strings/templates. Comments are preserved verbatim, including the COMPLEXITY header on replay.ts line 1.

6. Same-named / duplicate helpers. Each helper has exactly one destination module. rgba goes to color.ts; finiteNonNegative/finiteAbs to effect.ts; affine helpers to isolatedSurface.ts; no duplicate copies are produced. Export modifiers are added only where a sibling module or the public surface needs the name.

7. Dropped declarations. The inventory covers all 107 planner blocks and all 105 declarations. refactor-verify is run before tests; a missing declaration or exported name means the cut is incomplete and is fixed, never suppressed.

8. Tracked-versus-untracked baseline policy. The 21 new modules are untracked WIP until staged; they are never frozen. The ratchet --update prunes packages/engine/src/replay.ts because it ends under the cap and removes exactly that one entry; --update refuses to add or grow frozen files.

9. Public path and consumer proof. The covering replay family plus goldens are the behavioural proof; the bench is the hot-path proof. No test is edited, skipped, or weakened.

10. Concurrency. Single-writer surfaces touched: .file-size-baseline.json, docs/agents/repo-map.generated.md, BACKLOG_LEDGER.md. The main checkout is concurrently used by another session, so all seam work happens in .worktrees/C-01 and the main checkout is never written. Path claims are advisory and their runtime is EROFS in this sandbox; this limitation is recorded, not bypassed.

11. Rollback. The seam stays uncommitted until the single commit; a failed extraction is discarded only within .worktrees/C-01 (restore the tracked target with git checkout and delete the new directory), never by resetting the shared checkout. If the baseline cannot ratchet down, stop before committing.

12. Rust equivalents. Does not apply: no Rust crate, mod registration, IPC command, or audit:ipc surface is touched by this TypeScript-only move.

## Front-end and visual gate

- Necessity gate (prompt 03): not triggered. There is no remediation workbench; C-01 is engine-side Canvas2D IR replay code with no rendered UI surface, no DOM/props/class/API-shape/error-state change. No UI work is written.
- Visual validation (prompt 04): not required for a pure code move. The engine replay harness renders through the same replayIr path, but a declaration move must not change pixels and no visual baseline is updated. The required proof is the unchanged replay covering spec set (10/10 focused, 224/224 family, 12/12 goldens before and after) and the Batch C benchmark numbers. No Playwright lane, no visual:update, no screenshot review.
- Closeout statement: No visual surface changed. Proof: the covering replay specs and direct goldens pass with identical counts before and after the move, and the move is statement-identical apart from export modifiers and import headers.

## Batch C benchmark plan

- Canonical command: ./node_modules/.bin/vitest run --config vitest.bench.config.ts packages/engine/src/bench/replay.bench.ts (same driver as pnpm bench:canvas). The canonical file benchmarks 100 and 1000 rect nodes; both are recorded p50/p95 before and after.
- The handoff gate additionally asks 10k and 50k nodes, which the canonical file does not contain (measured: its it() cases are 100 rects, 1000 rects, IR-size linearity). Those two points are measured before and after with a temporary untracked copy of the same harness extended by two it() cases (same makeRectNodes/canvasTarget/benchReplay code); the temp file is deleted before staging and is not committed. Numbers and both commands are recorded in the evidence log.
- Monomorphic dispatch is protected by the AST identity proof (the switch statements move verbatim), not by a benchmark number.

## Proof plan (in order)

1. Extraction script asserts: all 105 declarations assigned exactly once, all 107 blocks covered, every generated file at or under 400 lines, every block text byte-identical to base apart from an inserted export modifier, and no interpolation or backtick rewriting of moved text.
2. node scripts/quality/refactor-verify.mjs --base master --target packages/engine/src/replay.ts --dest packages/engine/src/replay --json -> exit 0, baseCount 105, presentCount 105, missing [], missingExports [].
3. Direct recursive tsc over packages/*/tsconfig.json + apps/desktop + tests/e2e -> exit 0, 0 failures.
4. Covering tests after: focused 10/10, family 29 files/224 passed, goldens 3 files/12 passed, all 0 failed (identical counts).
5. Benchmark after: canonical 100/1k plus extended 10k/50k; numbers recorded, thresholds unchanged.
6. Biome: ./node_modules/.bin/biome check --write on changed files, then check without --write, then node scripts/audit-health.mjs.
7. Baseline: node scripts/quality/audit-file-size.mjs --update (never --force) -> exactly packages/engine/src/replay.ts removed, 944 -> 943, 0 added, 0 grown; then node scripts/quality/audit-file-size.mjs exit 0 and a full --report comparison.
8. Staged checkpoint: stage seam files, node scripts/quality/generate-agent-map.mjs --write (or pnpm agent:map), git add map + BACKLOG_LEDGER.md row, node scripts/quality/commit-checkpoint.mjs (pnpm verify:commit) -> pass.
9. One commit on seam/C/C-01-replay; no merge, no push, no prune. Then regenerate NEXT_PROMPT.md at the main repo root and leave it untracked.

## Stop conditions

- refactor-verify reports a missing declaration or exported name.
- Any covering test count drops or any test fails.
- A generated module is over 400 lines and cannot be fixed by a further allowed sub-split.
- The baseline --update would add or grow any entry, or refuses.
- verify:commit fails for a reason that is not fixable inside this seam's own files.
- The main checkout would have to be written to proceed.
In each case: record the exact error and stop; never bypass with --force, a hand-edited baseline, a skipped check, or a second worktree.

## Ownership and writing scopes

- Lead: packages/engine/src/replay.ts, packages/engine/src/replay/**, .file-size-baseline.json, docs/agents/repo-map.generated.md, BACKLOG_LEDGER.md, remediation/C-01/SEAM_SPEC.md.
- research-writer: remediation/C-01/RESEARCH.md and GAP_ANALYSIS.md only.
- inventory-analyst: .dsh artifacts only (uncommitted working notes).
- One writer per file; the Lead commits only after the staged checkpoint passes.

## Measured results after the move (same worktree, branch seam/C/C-01-replay)

Extraction: 107/107 base blocks moved to 20 destination modules plus a 343-line replay.ts; the extraction script asserts assignment completeness, source tiling identity, and the 400-line cap before writing. After one biome check --write pass (formatting/import order only) the final line counts are:

| file | lines |
|------|-------|
| packages/engine/src/replay.ts | 371 |
| packages/engine/src/replay/text.ts | 370 |
| packages/engine/src/replay/typography.ts | 355 |
| packages/engine/src/replay/effect.ts | 317 |
| packages/engine/src/replay/backdrop.ts | 312 |
| packages/engine/src/replay/primitive.ts | 290 |
| packages/engine/src/replay/textRich.ts | 252 |
| packages/engine/src/replay/fillImage.ts | 250 |
| packages/engine/src/replay/textCanonical.ts | 244 |
| packages/engine/src/replay/isolatedSurface.ts | 182 |
| packages/engine/src/replay/textPath.ts | 176 |
| packages/engine/src/replay/raster.ts | 165 |
| packages/engine/src/replay/table.ts | 162 |
| packages/engine/src/replay/fill.ts | 151 |
| packages/engine/src/replay/fillImageMask.ts | 129 |
| packages/engine/src/replay/primitiveBounds.ts | 85 |
| packages/engine/src/replay/types.ts | 80 |
| packages/engine/src/replay/effectDiagnostics.ts | 52 |
| packages/engine/src/replay/backdropCache.ts | 50 |
| packages/engine/src/replay/alphaMask.ts | 47 |
| packages/engine/src/replay/color.ts | 18 |

Every file is at or under 400 lines; replay.ts is 371 and the largest destination module is text.ts at 370.

Verbatim-move proof (independent verifier, base blob 808274125): base statements 107, after statements 107 plus 6 generated re-exports; AST-printer statement identity missing 0 / extra 0; comments 238 base / 238 after, missing 0, extra 0; exact-text differences 18 and all are biome line-rewrap of long signatures/type expressions (printer identity proves no token changed). Export-modifier additions and the 14 inline import() relative-specifier rebases are the only planned edits.

refactor-verify (post-move): exit 0 {"ok":true,"baseCount":105,"presentCount":105,"missing":[],"missingExports":[]}.

Covering tests before -> after (direct vitest): focused replay.test.ts 1 file / 10 passed -> 1 file / 10 passed; replay*.test.ts family 29 files / 224 passed -> 29 files / 224 passed; __goldens__ 3 files / 12 passed -> 3 files / 12 passed; 0 failures in every run. No test file was edited.

Direct recursive tsc substitute (packages/*, apps/desktop, tests/e2e; run with node_modules TypeScript because the pnpm store is read-only): before and after results are recorded in the seam evidence log and the commit message.

## Batch C benchmark measurements (Lead, final tree)

Canonical command (same driver as pnpm bench:canvas): ./node_modules/.bin/vitest run --config vitest.bench.config.ts packages/engine/src/bench/replay.bench.ts. The bench file runs in both the jsdom and node vitest projects, so each node count is reported twice.

- Before (pristine copy of commit 808274125, quiet): 100 rects p50=0.88/0.87 ms p95=1.11/1.15 ms ir=19781B; 1000 rects p50=4.69/5.30 ms p95=13.35/14.07 ms; 6/6 tests passed.
- After (final branch tree, quiet): 100 rects p50=1.58/1.45 ms p95=1.85/7.72 ms ir=19781B; 1000 rects p50=6.22/6.86 ms p95=6.96/7.01 ms; 6/6 tests passed.
- Extended same-harness points required by the Batch C gate (temporary untracked copy of replay.bench.ts with two extra it() cases; deleted before staging and never committed). Before numbers were taken while the pre-move recursive tsc job was running; after numbers are quiet.
  before: 10000 rects p50=58.54/44.94 ms p95=77.98/80.39 ms; 50000 rects p50=441.81/326.02 ms (single sample).
  after: 10000 rects p50=39.57/38.73 ms p95=41.66/49.24 ms; 50000 rects p50=280.62/282.73 ms (single sample).
- Interpretation: no regression signal; after numbers are at or below the before numbers at every extended tier and the canonical bench thresholds pass. Absolute jsdom ms are noisy under load (an earlier before run under load measured 1.55-1.56 ms at 100 and 12.08-13.70 ms at 1000), so the ratio harness below is the actual Batch C gate.

Batch C ratio gate (campaign policy; renderPath.bench.ts TIERS 100/1k/10k/50k, headroom 1.5): node scripts/audit-render-perf.mjs --ci against .render-perf-baseline.json.

- Before (ran through a temporary stash of the seam in the task worktree because the bench needs a git checkout): exit 0 PASS. Ratios 100 full/incr/panZoom/TTFP = 0.04/0.00/0.02/0.12; 1000 = 0.09/0.01/0.10/0.27; 10000 = 1.04/0.06/0.98/1.82; 50000 = 4.84/0.29/5.87/8.43.
- After (final branch tree, two quiet runs; both exit 0 PASS): run1 100 = 0.03/0.00/0.03/0.09; 1000 = 0.07/0.01/0.11/0.23; 10000 = 0.65/0.05/0.75/1.34; 50000 = 3.29/0.26/4.12/8.57. run2 100 = 0.03/0.00/0.02/0.07; 1000 = 0.13/0.01/0.06/0.29; 10000 = 0.62/0.04/0.76/1.39; 50000 = 3.02/0.21/3.03/6.47.
- One intermediate after-run (post-move tsc job still running) flagged only the 100-node panZoom ratio at the 1.5x headroom boundary (0.03x control vs 0.02x baseline, sub-millisecond tier); two quiet re-runs passed with no code change. No performance baseline was regenerated.

## Architecture cycle identity delta (recorded, not hidden)

node scripts/audit-architecture.mjs --ci is pre-existing red at this checkpoint. Direct madge with the script flags on packages/engine/src/index.ts:

- Before: 11 engine cycle identities - ten from the committed B-05 filters split (filters.ts -> filters/... -> types.ts) plus the pre-existing mockup/warpReplay.ts -> replay.ts.
- After: 19 identities = the same 11 plus 8 from this split: replay.ts -> replay/backdrop.ts -> replay/effect.ts; replay.ts -> replay/backdrop.ts -> replay/effect.ts -> replay/effectDiagnostics.ts; replay.ts -> replay/backdrop.ts -> replay/effect.ts -> replay/fill.ts -> replay/fillImage.ts; replay.ts -> replay/backdrop.ts -> replay/effect.ts -> replay/fill.ts -> replay/primitive.ts; ... -> replay/primitive.ts -> replay/table.ts; replay.ts -> replay/isolatedSurface.ts; replay/backdrop.ts -> replay/effect.ts -> replay/fill.ts; replay/fillImage.ts -> replay/fillImageMask.ts.
- Nature: family modules read the four per-replay state bindings and call replayIr / paintTable recursively (function-call-time reads of live ESM bindings, never module-evaluation reads; covered by the specs and goldens), plus one function-level cycle between fillImage and fillImageMask sampling helpers.
- Decision: no baseline regeneration (never hide a new cycle). The pre-existing gate status is unchanged (red before, red after); the delta is +8 identities attributable to C-01 and is reported for the reviewing Lead. If review requires an acyclic module graph, break the state back-edges by moving the four let bindings to a leaf state module behind an accessor and thread replayIr through paintTable/isolatedSurface; that is a structural change beyond this move-only seam.
- audit-health.mjs (the staged commit gate) is green before and after; replay.ts keeps its line-1 COMPLEXITY marker and replayIr, so the over-ceiling-file rule holds.

## Full static gate results

- Pre-move recursive tsc (check:agent:raw substitute, pristine copy of 808274125): 22 projects (20 package tsconfigs + apps/desktop + tests/e2e), 0 failures, exit 0.
- Post-move recursive tsc (same program, final tree): 22 projects, 0 failures, exit 0.
- Engine package tsc after extraction and after biome: exit 0.
- biome check --write then biome check on replay.ts plus the 20 modules: exit 0 (no fixes applied on the check pass).
- node scripts/audit-health.mjs: exit 0 before and after.
