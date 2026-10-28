# SEAM_SPEC - Batch A / A-06 product screenshot pipeline

**Status:** seam plan accepted 2026-10-28 (single seam, one worktree, one
commit). Implementation starts only after this document, [RESEARCH.md](RESEARCH.md)
and [GAP_ANALYSIS.md](GAP_ANALYSIS.md) exist; it runs only in
`.worktrees/A-06` on branch `seam/A/A-06-product-capture`.

## Seam hypothesis

- **Entry:** Batch A / A-06 (remediation rank #10).
- **Target:** `scripts/screenshots/product.mjs` - 2,767 lines, frozen at
  2,767 in `.file-size-baseline.json` (baseline line 881).
- **Single concern:** the marketing screenshot capture pipeline, split along its
  three data/flow concerns: scene data, capture runner, manifest sync. All three
  live in one new destination directory.
- **Single extraction destination:** `scripts/screenshots/product/` (one
  destination directory = one seam; precedents: `packages/editor/src/menu/defs.ts`
  -> `menu/defs/`, A-04 `IntelligencePanel.tsx` -> `panels/intelligence/`,
  A-05 `types.ts` -> `types/`).
- **Target after seam:** `scripts/screenshots/product.mjs` stays the executable
  entry point (same path, shebang and command) and becomes a ~80-line
  orchestrator: CLI mode dispatch, directory creation, source-scene argument
  validation, then `runCapture()` and the run summary. No declaration is
  defined in the entry after the seam except `captured`, `skipped`, `untouched`
  (run summary) and the imported modules.
- **Public API:** unchanged. `pnpm screenshots:product` and
  `node scripts/screenshots/product.mjs` behave identically; output paths, the
  manifest schema, the review directory contract and every CLI flag are
  unchanged. No base declaration was exported, so no consumer import changes.

## Declaration inventory (72 top-level declarations)

Measured with
`node scripts/quality/godsplit-plan.mjs scripts/screenshots/product.mjs`
(86 blocks = 72 declarations + 14 non-declaration blocks) and full-range AST
mapping; every base declaration is assigned to exactly one destination module.

| # | declaration | kind | base lines | destination |
|---|-------------|------|-----------|-------------|
| 1 | `ROOT` | const | 54 | `product/config.mjs` |
| 2 | `args` | const | 109 | `product/config.mjs` |
| 3 | `reviewFlag` | const | 110 | `product/config.mjs` |
| 4 | `reviewDir` | const | 111 | `product/config.mjs` |
| 5 | `sourceScenesFlag` | const | 115 | `product/config.mjs` |
| 6 | `sourceScenesArg` | const | 116 | `product/config.mjs` |
| 7 | `sourceScenesDir` | const | 120 | `product/config.mjs` |
| 8 | `CANONICAL_DIR` | const | 121 | `product/config.mjs` |
| 9 | `OUT_DIR` | const | 122 | `product/config.mjs` |
| 10 | `PUBLIC_DIR` | const | 123 | `product/config.mjs` |
| 11 | `MANIFEST_PATH` | const | 124 | `product/config.mjs` |
| 12 | `DEBUG_DIR` | const | 133 | `product/config.mjs` |
| 13 | `PORT` | const | 134 | `product/config.mjs` |
| 14 | `BASE` | const | 135 | `product/config.mjs` |
| 15 | `OUTPUT_DIRS` | const | 137 | `product/config.mjs` |
| 16 | `OUTPUT_MANIFEST` | const | 138 | `product/config.mjs` |
| 17 | `scenesFlag` | const | 144 | `product/config.mjs` |
| 18 | `onlyScenes` | const | 145-150 | `product/config.mjs` |
| 19 | `strict` | const | 151 | `product/config.mjs` |
| 20 | `loadVariantModule` | function | 62-76 | `product/variants.mjs` |
| 21 | `skipVariantWrite` | function | 78-80 | `product/variants.mjs` |
| 22 | `openVariantSupport` | function | 82-107 | `product/variants.mjs` |
| 23 | `sha256Hex` | function | 157-159 | `product/provenance.mjs` |
| 24 | `computeSourceIdentity` | function | 169-171 | `product/provenance.mjs` |
| 25 | `playwrightVersion` | function | 173-183 | `product/provenance.mjs` |
| 26 | `writeFileAtomicSync` | function | 189-193 | `product/provenance.mjs` |
| 27 | `manifestBytesAtStart` | const | 195 | `product/provenance.mjs` |
| 28 | `manifestDigestAtStart` | const | 196 | `product/provenance.mjs` |
| 29 | `pngSize` | function | 267-269 | `product/provenance.mjs` |
| 30 | `serverCleanup` | const | 275 | `product/server.mjs` |
| 31 | `startServer` | function | 277-332 | `product/server.mjs` |
| 32 | `probe` | function | 334-344 | `product/server.mjs` |
| 33 | `stopServer` | function | 353-355 | `product/server.mjs` |
| 34 | `SEED_FIRST_RUN_STATE` | const | 370-391 | `product/editor.mjs` |
| 35 | `openDemoDocument` | function | 404-445 | `product/editor.mjs` |
| 36 | `waitForFonts` | function | 460-486 | `product/settle.mjs` |
| 37 | `importImage` | function | 495-513 | `product/editor.mjs` |
| 38 | `selectImageNode` | function | 516-521 | `product/editor.mjs` |
| 39 | `fitContent` | function | 530-543 | `product/editor.mjs` |
| 40 | `currentZoom` | function | 546-551 | `product/editor.mjs` |
| 41 | `selectLayer` | function | 554-574 | `product/editor.mjs` |
| 42 | `activatePageTool` | function | 577-591 | `product/editor.mjs` |
| 43 | `openCleanEditor` | function | 593-671 | `product/editor.mjs` |
| 44 | `openImageToolsTab` | function | 674-681 | `product/editor.mjs` |
| 45 | `expandSection` | function | 688-701 | `product/editor.mjs` |
| 46 | `waitForInferenceResult` | function | 704-716 | `product/editor.mjs` |
| 47 | `parkMouse` | function | 718-721 | `product/settle.mjs` |
| 48 | `waitForStableCanvas` | function | 733-753 | `product/settle.mjs` |
| 49 | `settle` | function | 756-764 | `product/settle.mjs` |
| 50 | `clipFromLocator` | function | 775-810 | `product/settle.mjs` |
| 51 | `SCENES` | const | 816-2072 | `product/scenes/index.mjs` (aggregated from 4 modules) |
| 52 | `sourceScenePath` | function | 2112-2121 | `product/scenes/index.mjs` |
| 53 | `freshSourceSceneCapture` | function | 2123-2126 | `product/scenes/index.mjs` |
| 54 | `manifest` | const | 2128 | `product/state.mjs` |
| 55 | `runId` | const | 2129 | `product/state.mjs` |
| 56 | `sourceIdentity` | const | 2130 | `product/state.mjs` |
| 57 | `sceneKind` | function | 2139-2148 | `product/manifest-sync.mjs` |
| 58 | `kindFromGeometry` | function | 2155-2160 | `product/manifest-sync.mjs` |
| 59 | `failures` | let | 2162 | `product/state.mjs` (with `recordFailure()`) |
| 60 | `ranThisRun` | let | 2163 | `product/runner.mjs` |
| 61 | `capturedThisRun` | let | 2164 | `product/runner.mjs` |
| 62 | `optedOut` | let | 2165 | `product/runner.mjs` |
| 63 | `skippedThisRun` | const | 2166 | `product/runner.mjs` |
| 64 | `normalizeManifest` | function | 2186-2341 | `product/manifest-sync.mjs` |
| 65 | `GPU_ARGS` | const | 2360-2365 | `product/browser-session.mjs` |
| 66 | `browser` | const -> let | 2366 | `product/runner.mjs` |
| 67 | `server` | const -> let | 2367 | `product/runner.mjs` |
| 68 | `warmUp` | function | 2377-2391 | `product/browser-session.mjs` |
| 69 | `variantSupport` | const -> let | 2394 | `product/runner.mjs` |
| 70 | `captured` | const | 2759 | entry `product.mjs` |
| 71 | `skipped` | const | 2760 | entry `product.mjs` |
| 72 | `untouched` | const | 2761-2763 | entry `product.mjs` |

Every `SCENES` entry (31 objects, base lines 817-2071) is assigned by
contiguous range and keeps its order: `foundations.mjs` (817-1139, 12
entries), `type-and-color.mjs` (1140-1441, 8), `effects.mjs` (1442-1762, 6),
`features.mjs` (1763-2071, 5). Entries are contiguous (each starts the line
after the previous ends), so no scene byte or comment is left behind.

## Destination map (expected sizes; measured at closeout)

| module | declared concern | expected lines |
|---|---|---|
| `scripts/screenshots/product.mjs` (entry) | CLI mode dispatch + run summary | ~85 |
| `product/config.mjs` | argv parsing, paths, review-dir safety | ~55 |
| `product/provenance.mjs` | hashing, source identity, atomic write, manifest-at-start, PNG size | ~60 |
| `product/variants.mjs` | optional WebP/AVIF encoder bridge | ~60 |
| `product/state.mjs` | manifest snapshot, run id, source identity, failures counter | ~15 |
| `product/server.mjs` | Vite dev server start/probe/stop | ~95 |
| `product/browser-session.mjs` | Chromium launch args + dev-server warm-up | ~50 |
| `product/editor.mjs` | editor setup and interaction helpers | ~330 |
| `product/settle.mjs` | font/canvas/stability waits + crop measurement | ~140 |
| `product/manifest-sync.mjs` | reviewed promotion, normalize, scene kind derivation | ~285 |
| `product/runner.mjs` | capture loop, browser/server/variant lifecycle, tallies | ~390 |
| `product/scenes/index.mjs` | scene-data aggregation, source-scene resolution/validation | ~70 |
| `product/scenes/foundations.mjs` | workspace/presentation/tablet/vector/typography scenes | ~340 |
| `product/scenes/type-and-color.mjs` | typography panel, layout, layers, motion, color scenes | ~320 |
| `product/scenes/effects.mjs` | gradient, enhance, export, vectorize, effects, background-removal scenes | ~340 |
| `product/scenes/features.mjs` | depth, image-tools, workspaces, print scenes | ~330 |

All modules target 350-400 lines where natural and stay under the hard cap; the
sub-split of `SCENES` is required because the base declaration is 1,257 lines
(planner hazard). The entry stays far below the cap.

## Applied edge cases

- **Capture side effects stay out of module evaluation (critical).** Base lines
  2366-2367 and 2394 are top-level `await` launches. They become assignments
  inside `runCapture()`, called by the entry after the `--sync-reviewed` and
  `--normalize` dispatches, so importing the split entry for a metadata-only
  mode starts no browser and no dev server.
- **Mode dispatch order is preserved.** `--sync-reviewed` (base 198-261) becomes
  `syncReviewedPromotion()` in `manifest-sync.mjs`, called by the entry inside
  the same `if` guard at the same position. `--normalize` remains an entry
  dispatch (base 2343) that calls the moved `normalizeManifest();` the function
  still calls `process.exit(...)` itself. `mkdir` calls (base 263-264) and the
  source-scene argument validation (base 2089-2110, now
  `assertSourceScenesFlags()`) stay in the entry at their original positions.
- **Module evaluation order.** Entry imports `config` first (argv parse,
  review-dir safety - identical to base 109-139), then `manifest-sync` (which
  pulls `provenance` -> the manifest-at-start read, base 195-196, then
  `state` -> manifest snapshot/runId/sourceIdentity, base 2128-2130), then the
  scene data and the runner. State evaluation moves earlier relative to the
  reviewed-promotion block; both paths already parse the manifest and compute
  the source identity (the promotion block does both), so no new failure mode is
  introduced. This is recorded as the only ordering shift.
- **Relative specifiers rebased, not renamed.** All `.`-relative imports gain
  one `../` level; `ROOT` gains one `..`; the dynamic variant import becomes
  `../variants.mjs`. `import.meta.url` still resolves the repository root.
- **Shared mutable counter.** `failures` moves to `state.mjs` as
  `export let failures`; the seven increment sites become
  `recordFailure()` calls (A-06 plumbing, behavior identical: same counter, same
  exit code, same log values). All other run counters stay module-local in
  `runner.mjs` and are read live by the entry's summary.
- **No duplicate helpers.** Each helper keeps one home; consumers import it.
  No helper is copied. New cross-module imports are the module boundary, not a
  new public API; nothing outside `scripts/screenshots/product/` imports these
  modules except the entry.
- **Covering-test fixture wiring.** `capture-safety.test.mjs` copies an explicit
  source list into a sandbox and runs the sandboxed entry with
  `--sync-reviewed`. The fixture gains a recursive copy of
  `scripts/screenshots/product/` (one line plus a `cpSync` import). No
  assertion, test name, or test count changes: **15/15 before and after**.
- **No behavior change.** Comments move verbatim; no declaration is renamed; no
  flag, output path, manifest field, log line, or exit code changes. The only
  textual edits inside moved code are (a) added `export` keywords required by
  the module boundary, (b) the two path-depth rebases, (c) `const` -> `let`
  for the three deferred capture singletons, (d) `failures++` ->
  `recordFailure()`, and (e) the `warmUp(browser)` parameter that replaces the
  base closure over the module-level browser.

## Proof plan

1. `node scripts/quality/refactor-verify.mjs --base master --target
   scripts/screenshots/product.mjs --dest scripts/screenshots/product/ --json`
   exits 0 with `missing: []`, baseCount 72, before tests.
2. Static reference audit: per new module, every referenced identifier is a
   local declaration, an import, or a known JS/Node/browser global; every
   relative specifier resolves on disk; `node --check` exits 0 for every file;
   a module-load smoke test imports every new module (no capture side effects).
3. Covering test: `node --test scripts/screenshots/capture-safety.test.mjs`
   15/15 before and 15/15 after, 0 failures.
4. Consumer gate: the same recursive tsc program as `check:agent:raw` over
   `packages/*`, `apps/desktop`, `tests/e2e` exits 0 (scripts are outside the
   tsconfig projects, so this proves no collateral breakage).
5. `pnpm exec biome check --write` then `biome check` on every changed file;
   `node scripts/audit-health.mjs` if applicable (no hub files are touched).
6. Baseline ratchet: exactly one removed entry (958 -> 957), 0 added, 0 grown,
   0 lowered; `pnpm audit:filesize` exit 0.
7. Staged checkpoint: stage the exact seam paths, regenerate
   `pnpm agent:map` from the staged tree, `pnpm verify:commit`.
8. One ledger row; one commit on `seam/A/A-06-product-capture`; no merge, no
   push without Lead authorization; `NEXT_PROMPT.md` regenerated for A-07.

## No visual surface changed

The seam moves tooling code only. It renders no UI, changes no capture logic,
and produces the same screenshots and manifest bytes for the same inputs. Proof:
the capture pipeline's covering test passes 15/15 before and 15/15 after, and
the capture loop body moves byte-identically into `product/runner.mjs`.
**No visual surface changed; visual validation is not triggered.**

## Verification record (measured after the split, before the commit)

- **Modules:** 15 files under `scripts/screenshots/product/` plus the 77-line
  entry. Measured line counts: `config` 61, `provenance` 60, `variants` 52,
  `state` 16, `server` 93, `browser-session` 50, `settle` 143, `editor` 330,
  `manifest-sync` 300, `runner` 398, `scenes/index` 81,
  `scenes/foundations` 329, `scenes/type-and-color` 315, `scenes/effects` 337,
  `scenes/features` 326. Every module is at or under 400; the entry is 77.
  Total moved content 2,968 lines (base 2,767 + module-boundary imports/exports).
- **Declaration preservation:** `node scripts/quality/refactor-verify.mjs
  --base master --target scripts/screenshots/product.mjs --dest
  scripts/screenshots/product/ --json` -> exit 0,
  `{ok: true, baseCount: 72, presentCount: 80, missing: [], missingExports: []}`.
  The eight extras are the four run helpers introduced by the split
  (`syncReviewedPromotion`, `assertSourceScenesFlags`, `recordFailure`,
  `runCapture`) and the four scene-data arrays.
- **Declaration-text identity (independent check):** AST-printed comparison of
  all 86 non-import base statements against the destination tree -> 73
  byte-identical, 12 planned edits (base lines 54 ROOT depth, 62 variant
  specifier, 198 promotion wrapper, 816 SCENES split, 2089 source-scene wrapper,
  2186 normalizeManifest `failures++` -> `recordFailure()`, 2366/2367
  const -> let, 2377 `warmUp(browser)` parameter, 2393 warm-up call argument,
  2394 const -> let, 2396 capture-loop `failures++` -> `recordFailure()`,
  2754 summary `failures++` -> `recordFailure()`), 0 unexplained. No moved
  logic was reformatted beyond the two file-path rebases and the allowlist.
- **Comments:** all 283 unique comments in the base file are present verbatim in
  the destination tree (0 missing).
- **Static reference audit:** 0 unused imports and 0 genuinely unbound
  references across all 16 files. Remaining analyzer noise is `import.meta`,
  object-method names (`run`, `verify`), `WeakMap`, and the pre-existing
  `warning` reference below.
- **Syntax / module load:** `node --check` exit 0 on every changed JS file; a
  module-load smoke of `product/runner.mjs` exports the expected bindings and
  starts no browser/server (capture side effects are inside `runCapture()`).
- **Covering test:** `node --test scripts/screenshots/capture-safety.test.mjs`
  -> 15/15 pass before and 15/15 after, 0 failures. The fixture copy was changed
  from an explicit seven-file list to a recursive copy of
  `scripts/screenshots` plus `scripts/quality/heavy-lease.mjs`, which also
  shrinks the test from 522 to 518 lines (frozen entry lowered, never grown).
- **Consumer gate:** the same recursive tsc program as `check:agent:raw`
  (`packages/*`, `apps/desktop`, `tests/e2e`) exits 0 before and after the
  split. `scripts/**` is outside every tsconfig project, so this proves no
  collateral breakage rather than type-checking the moved code.
- **Lint:** `biome check --write` then `biome check` exit 0 on all 17 changed
  files.
- **Baseline ratchet:** `audit-file-size.mjs --update` -> 958 -> **957**
  frozen; added 0, grown 0, removed exactly
  `scripts/screenshots/product.mjs`; the frozen covering test lowered 522 ->
  518. `pnpm audit:filesize` exit 0.
- **Ordering shift (only one):** `product/state.mjs` (manifest snapshot,
  `runId`, `sourceIdentity`) evaluates at import time before the
  reviewed-promotion call instead of at base line 2128. The promotion path
  already parses the same manifest and computes the same source identity, so the
  values and failure modes are unchanged; this is recorded rather than hidden.
- **Pre-existing residual (not introduced, not fixed):** the `vectorize` scene
  body references `warning` without a declaration (base line 1630; still
  undeclared at the checkpoint). The reference is preserved verbatim; fixing it
  would be a behavior change outside this seam.
