# WASM raster-kernel integration — execution plan (2026-10-17)

The attached implementation brief is the acceptance source of truth. This
plan records a dependency-ordered execution map and evidence; it does not
reduce the requested end-to-end scope.

## Starting point and boundary

- Starting revision: `58b4c2b62f9e5c28595e8240fc851627fe6f2921`, verified from
  `origin/master` on 2026-10-17. Work is isolated on
  `codex/wasm-raster-kernel` because the shared local `master` is 124 commits
  ahead, 7 behind, and has unrelated staged, unstaged, and untracked work.
- `crates/varve-effects` already has ten Rust ports and TS/Rust fixture
  comparisons. `cargo check --locked --target wasm32-unknown-unknown -p
  varve-effects` passes at baseline.
- `crates/varve-wasm` currently does not depend on or export those kernels.
  `packages/engine/src/liveEffects/effectPreviewWorker.ts` directly invokes the
  TS provider; the async provider dispatcher has no product call site. Normal
  Canvas2D effect replay remains synchronous and authoritative.
- The Adjustment inspector's worker preview is already isolated, cancellable
  at the owner level, stale-identity guarded, byte-admitted before capture,
  and caps source dimensions at 256×256. It is the first low-risk browser
  integration seam; it is a reduced preview, not the document render.
- Baseline Chromium E2E for `tests/e2e/effects/live-effect-kernel-preview.spec.ts`
  passed on the existing TS worker. Screenshots were captured for light, dark,
  and high-contrast themes. The dark capture is visually legible at the existing
  compact preview size. This is browser-only evidence.

## Contract for the first vertical slice

Add a lazy, non-threaded Rust/WASM provider for bounded live-effect preview
jobs. The wire contract reuses `EffectDispatchRequest`: one camelCase JSON
request and one exact-size RGBA byte buffer per operation. Initial input is
8-bit straight-alpha sRGB as used by the existing TS `ImageData` kernels; the
kernel's existing per-effect alpha/color arithmetic remains unchanged. No
wide-gamut/HDR, arbitrary-size, export, document mutation, or multi-threaded
claim is implied. A WASM result replaces only the derived inspector preview;
normal replay and export remain authoritative on their current path.

The browser worker tries the versioned WASM capability and falls back to the TS
reference on an unavailable/corrupt/mismatched module or a provider error.
Invalid requests, cancellation, and stale results must remain distinct from a
backend failure; cancellation must release worker-held memory and permit the
next ordinary preview. The backend that actually produced pixels must be
observable to tests/diagnostics.

## Slices and acceptance

1. **Evidence and baseline.** Review the issue ledger and primary platform
   sources; preserve baseline TS screenshots and runtime. Reproduce any
   export-alpha or MIME concern in a real browser before deciding whether it
   belongs in this feature. **Complete:** Chromium reproduced opaque pixels in
   background-free PNG and false-positive AVIF support with a PNG blob; both
   are fixed and covered by browser pixel/MIME regressions.
2. **Versioned binary boundary.** Export the current Rust kernels through a
   coarse binary WASM call; validate ABI, kind, dimensions, exact byte length,
   output length, ownership, and failure typing. Build baseline and SIMD
   artifacts; do not require threads or COOP/COEP.
3. **Worker route.** Lazily load the module inside the existing effect preview
   worker, identify the actual provider, keep CPU fallback, enforce existing
   byte admission, and terminate/recover an in-flight worker on cancellation.
4. **User workflow and fidelity.** Exercise a real Adjustment Layer preview,
   verify the selected pixels are unchanged until normal document commands,
   inspect every supported effect against the TS reference, including
   transparent/low-alpha and branch-threshold cases, and visually compare
   before/after captures at the same viewport and theme.
5. **Measure and document.** Measure cold module initialization, warm kernel,
   round-trip preview latency, and byte growth at the actual 112×72 sample and
   256×256 source cap; also record a larger synthetic stress case only when
   admitted safely. Report no acceleration claim if overhead outweighs the
   kernel benefit. Update canonical Rust/WASM/effect docs and user-facing
   website performance guidance to describe exactly which preview path uses
   WASM and what stays on software replay.
6. **Review and integrate.** Run the affected planner/checks, feature E2E and
   visual inspection, an independent read-only code review, then commit
   coherent slices. Recheck remote `master` and CI before any merge. Do not
   rewrite history or mix the shared tree's 124 outgoing commits into this
   branch.

## Explicitly deferred until evidence supports a second slice

- Asynchronous full-canvas, Effect Studio, or export routing: current filter
  replay applies backdrops, masks, and order synchronously; this needs a
  separately measured scheduler/fresh-frame design.
- Threaded WASM: the public GitHub Pages host lacks cross-origin isolation,
  and Safari reports show worker/thread failures can occur for small inputs.
- Arbitrary high-resolution or 48 MP processing, HDR/wide-gamut input,
  replacing the TS reference, changing effect math, or changing existing
  document/history schemas.
- Broad raster/export changes unless a browser reproduction confirms a
  user-visible bug directly touched by the accepted workflow.

## Progress

- [x] Read the user-supplied brief before continuing.
- [x] Verify remote repository target and isolate from unrelated shared work.
- [x] Map current Rust kernels, WASM boundary, async worker, and authoritative
  renderer.
- [x] Gather the targeted upstream issue and platform evidence in
  [`wasm-raster-kernel-evidence-2026-10-17.md`](../research/wasm-raster-kernel-evidence-2026-10-17.md).
- [x] Baseline Rust/WASM target compile for `varve-effects`.
- [x] Baseline adjustment-preview browser E2E and three-theme screenshots.
- [x] Measure the baseline raw WASM module (1,565,551 bytes) before adding
  kernels; build output currently produces baseline/SIMD modules of 1,279,844 /
  1,290,936 bytes.
- [x] Add the versioned browser ABI and owned in-place kernel entry point; the
  request is capped at 64 KiB, 16,384 px per axis, and 4,194,304 pixels.
- [x] Implement the lazy worker provider, actual-provider reporting, CPU
  fallback, admission bounds, and worker termination on active cancellation.
- [x] Compare all 20 Rust fixture cases to the live TS kernels. The 18
  non-bloom cases are byte-exact after fixing Bayer dither with
  `paletteMode: "none"`. Current Bloom differs from TS by up to 5/7 bytes
  despite frozen fixture bounds of 3; Bloom is kept on TS. Palette Snap is
  also kept on TS because WASM was slower at the 256×256 cap.
- [x] Record warm direct-kernel diagnostics for the 112×72 sample and 256×256
  cap. On Node 22, VHS was 3.9/24.6 ms WASM vs 18.0/46.7 ms TS, and RGB Split
  was 2.6/14.3 ms vs 6.9/32.7 ms. Cold module init was about 33 ms. These
  timings exclude browser worker messaging, capture, and UI, so they do not
  support a general speed claim.
- [x] Complete and visually inspect the final WASM/CPU fallback browser E2E in
  light, dark, and high-contrast themes. The fallback and WASM samples are
  visually equivalent within observed screenshot rasterization noise.
- [x] Reproduce and fix the source-only export concerns (PNG alpha and AVIF
  MIME mismatch reproduced and covered in Chromium).
- [x] Update canonical effect architecture docs and public performance guidance;
  the feature marketing page remains unchanged because this bounded inspector
  sample has no measured general performance benefit to advertise.
- [x] Independent review caught that a cold/stalled WASM fetch could consume the
  entire five-second worker response deadline before TS fallback. Add a 1.5s
  load deadline, abort its pending fetch, and let the current preview use the
  TS reference; a later preview may retry. Add an abort regression and document
  the budget. Independent review confirmed the retry path.
- [ ] Rerun affected checks, create scoped reviewable commit, pass the required
  outgoing/full-gate checks, and complete remote PR/review/merge integration.

### Validation status (2026-10-18, resumed after timeout fix)

- The current `pnpm verify:plan` compares the complete four-commit branch
  against `origin/master`: 20 files, affecting `@varve/website`, `@varve/editor`,
  `@varve/engine`, `varve-effects`, and `varve-wasm`. It selects 55 lanes and
  explicitly reports `FULL-SUITE ESCALATION: YES` for the cross-package
  Rust/WASM contract. Run triage for the selected Tiers 0–4 closure, then
  complete the exact-SHA full gate required by this escalation before merge.
- The `pnpm verify:push --dry-run --since origin/master` checkpoint is ready
  for four outgoing commits. It identifies local blocking lanes for the
  affected JS/Rust packages, audits, Cargo formatting, website checks, and
  model checks; hosted certification additionally covers the full workspace,
  browser, visual, benchmark, and WASM lanes.
- The existing three-theme screenshot captures show the WASM sample and the
  unavailable-WASM CPU fallback with matching preview presentation in light,
  dark, and high-contrast themes. They were captured before the cold-load
  deadline correction. Re-run the browser case added with that correction and
  inspect its fresh captures before treating the final timeout path as visually
  verified.
- The latest `pnpm verify:affected` passed touched format/lint, docs and emoji
  audits, the E2E TypeScript check, all affected package typechecks, and direct
  `wasmEffectsLoader` (2/2) and `wasmLoader` (6/6) tests.
- Its engine package lane reported 449 passed and 11 skipped, with three
  time-bound failures while another worktree was running a local full gate:
  selection refinement (18.24s vs 10s), mockup mesh at 1024 px (2.09s vs
  1.4s), and a 512×512 diffusion-frame test (43.66s vs 30s). Isolated retries
  later passed selection refinement (5.55s) and both mockup-warp cases
  (199.8/624.7/3205.1 ms for 512/1024/2048 px). Shaping also passed (3/3).
- A later capped-worker batch still overlapped other browser/native builds and
  missed selection and diffusion timing ceilings, while mockup warp passed.
  With the shared queue clear, the final one-file-at-a-time retries passed:
  selection refinement in 8.16s; diffusion-frame restoration in 10.62s with
  all 10 tests passing.
- A subsequent full affected run with `VARVE_TEST_WORKERS=4` passed format,
  lint, docs/emoji audits, E2E typecheck, every selected package typecheck, and
  the direct loader tests. The engine lane reported 450 passed and 11 skipped;
  shaping (594ms vs 500ms) and 2048px mesh warp (5561ms vs 4800ms) exceeded
  timing ceilings while other worktree E2Es and tests were active. Selection
  and diffusion passed in this run. Shaping and mockup warp also passed in
  earlier isolated retries. The downstream lanes and targeted timeout browser
  test remain pending because the affected runner stops on the failed engine
  lane.
- A combined retry including the diffusion-frame case waited behind other
  agents' heavy-task leases for 600 seconds and never started. No other task or
  lease was interrupted. The affected runner still must be repeated for the
  complete selected closure; the targeted timeout E2E and post-timeout visual
  captures also remain outstanding.
- In the next validation window, isolated lease runs passed shaping (3/3,
  185ms), mockup warp (2/2; 2048px mesh 1.52s), and diffusion-frame (10/10;
  512×512 restoration 15.9s). Two subsequent full affected attempts again
  showed only time-bound engine failures during concurrent worktree builds,
  browser runs, Rust compilation, and Python tests. The one-worker attempt had
  450 passed and 11 skipped, with shaping at 662ms and diffusion-frame over
  30s. The four-worker attempt had 448 passed and 11 skipped, with shaping at
  660ms, selection refinement at 18.6s, diffusion-frame over 30s, and 2048px
  mesh warp at 4.93s. Each observed timing case passed when rerun alone through
  the heavy-task lease. The later package lanes and timeout browser case have
  not yet run in a complete passing affected closure.
- A third `VARVE_TEST_WORKERS=4 pnpm verify:affected` attempt passed format/lint,
  both docs/emoji audits, all selected typechecks (including the website Astro
  check), and both direct loader test files. Its engine lane had 451 passed and
  11 skipped; only selection refinement exceeded its limit (11.56s vs 10s)
  while other worktrees ran simultaneous typechecks and tests. That case has
  passed isolated retries in under 10 seconds. Downstream package and timeout
  browser lanes remain outstanding because the affected runner stops on the
  engine failure.
- A manually queued batch covering the remaining planned package test
  directories reached its 600-second lease deadline while another worktree's
  affected editor package suite still owned the repository lease. It never
  started and did not interrupt or reclaim that suite; downstream tests and the
  timeout browser scenario remain outstanding.
- A fresh read-only inspection confirmed that the unrelated editor-package
  test lease (PID 696193, child Vitest PID 696564) is still active. Do not stop
  or reclaim it. The ChatGPT Linux app (PID 3068) is also still active. The
  timeout E2E, remaining affected closure, current planner's triage, exact-SHA
  full gate, push/PR review, and merge are not yet complete.
