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
   belongs in this feature.
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
- [ ] Select module packaging after measuring baseline artifact size.
- [ ] Implement and validate the versioned browser WASM route.
- [ ] Reproduce or exclude the source-only export concerns.
- [ ] Measure end-to-end latency/memory and inspect post-change visuals.
- [ ] Update canonical docs/site content, independent review, scoped commits,
  and remote integration status.
