# ADR-0244: Native GPU rasterization of the render IR

- **Status:** Accepted (implemented in this change set; rasterization qualified,
  native presentation explicitly unverified)
- **Date:** 2026-10-16
- **Related:** ADR-0001, ADR-0003, ADR-0237, `docs/architecture/render-pipeline.md`,
  `docs/architecture/gpu-acceleration.md`,
  `docs/architecture/native-acceleration.md`,
  `docs/architecture/native-render-stage.md`,
  `docs/research/native-gpu-canvas-research-2026-10-16.md`

## Context

ADR-0001 established that the native engine emits a compact render IR and the
webview replays it; ADR-0003 kept Canvas2D authoritative and deferred a native
GPU overlay; ADR-0237 added native wgpu **compute** with truthful capability
stages and explicitly kept presentation in the webview. The result is a
codebase where "does Varve use my GPU?" has a layered answer: WebGPU/WebGL2
scene paths are opt-in experiments over a Canvas2D present surface, effect
kernels are measured but have no consumer, and `varve-accel` is compute-only.

This ADR revisits the third layer — **native scene rasterization** — because the
deferral was recorded before two facts were established:

1. Whether a native rasterizer could reproduce the Canvas2D replay exactly for a
   meaningful content set, on real hardware.
2. What moving the result into the window actually costs.

Both are now measured on the reference machine (AMD Ryzen 3 5300U / RADV
Renoir, Mesa 26.2.4, Vulkan, Wayland, 2026-10-16). The measurement is the
decision.

## Decision

**Add a native GPU rasterization stage for the render IR, in
`crates/varve-accel/src/render`, that is qualified for the content it admits and
explicitly refuses everything else — and keep the Canvas2D present surface as
the only presentation path.**

Concretely:

1. **Input is the existing IR.** `lower_frame` consumes the same
   `varve_engine::RenderItem` list the webview replay consumes. There is no
   second scene model, no second document, and no second history. The plan is a
   derived projection.
2. **Admission is explicit and total.** A frame is either fully admitted or not
   presentable. `AdmissionReport` names every rejection with a stable key. A
   partial plan is *not* a frame, because a GPU-only surface cannot composite a
   Canvas2D island without a bridge that does not exist.
3. **Rasterization is analytic where it can be and stencil-and-cover where it
   must be.** Analytic signed-distance coverage for rects (per-corner radius),
   ellipses, circles, regular polygons and stars; a signed triangle fan into the
   stencil buffer with non-zero (`IncrWrap`/`DecrWrap`) or even-odd (`Invert`)
   then a cover quad for paths, which handles concave and self-intersecting
   contours without a triangulator.
4. **The colour contract is Canvas2D's, not a "linear is better" one.** The
   target is `Rgba8Unorm` (not `-Srgb`) and the shaders emit premultiplied
   encoded-sRGB, blended with `(One, OneMinusSrcAlpha)`. Canvas2D composites
   encoded values; linearizing would change the artwork.
5. **Presentation stays in the webview.** Pixels return as straight-alpha RGBA8
   through a raw-bytes IPC body and are drawn on the existing canvas. The stage
   is therefore *native GPU rasterization*, never described as native
   presentation.
6. **Failure is classified per outcome.** `RenderError` separates `Unsupported`,
   `ShaderFailed`, `OutOfBudget`, `Timeout`, `DeviceLost`, and staged
   `Internal`. Only `DeviceLost` retires the device. `RenderHealth` pauses after
   three consecutive render-scoped failures and exposes an explicit retry.

## The measurement that drove points 5 and 6

`cargo run --release -p varve-accel --example native_render_bench`, 60 frames
per case, warm, RADV Renoir, MSAA 4x, deterministic mixed corpus:

| Size | Items | lower p50 | encode p50 | transfer p50 | straighten p50 | total p50 |
|---|---|---|---|---|---|---|
| 1600×1000 | 600 | 0.31 ms | 0.04 ms | 9.44 ms | 5.29 ms | 16.73 ms |
| 1600×1000 | 10 000 | 7.74 ms | 0.66 ms | 82.80 ms | 7.97 ms | 123.23 ms |
| 2560×1600 | 600 | 0.33 ms | 0.05 ms | 14.24 ms | 11.97 ms | 28.71 ms |
| 3200×2000 | 600 | 0.34 ms | 0.05 ms | 18.12 ms | 19.06 ms | 38.76 ms |
| 3200×2000 | 10 000 | 6.27 ms | 0.55 ms | 91.52 ms | 20.86 ms | 138.82 ms |

Reading it:

**The numbers are load-sensitive and the table above is one run.** A second run
on the same machine under lighter load (13 GiB in use instead of 17 GiB)
measured 13.4 ms / 117 ms / 27.5 ms / 118 ms / 26.8 ms / 123 ms for the same
six cases in the same order — the 600-item cases improve by 20 %, the
10 000-item cases do not, which is consistent with the GPU-bound reading. Treat
the shape of the table as the finding (transport and GPU completion dominate,
command recording does not) and the absolute milliseconds as a single-machine
data point, not a budget.


- **Rasterization is nearly free.** 0.04–0.76 ms of command recording; the GPU
  work is inside `transfer`, which blocks on completion.
- **The bridge dominates.** At 1600×1000 the whole frame costs 16.7 ms, of which
  14.7 ms is getting pixels out of the device and into straight-alpha form. At
  3200×2000 (DPR 2) it is 38.8 ms, i.e. 26 fps, and that is before the browser
  uploads the bitmap to a texture.
- **Heavy frames are GPU-bound on an integrated part.** 10 000 items costs
  ~83–92 ms of GPU completion regardless of resolution, which is overdraw and
  4× MSAA on a Renoir APU, not the transport.
- **`straighten` is a real cost** (5–21 ms): the premultiplied → straight-alpha
  conversion the browser canvas APIs require.

A 15–39 ms per-frame transport is **not** an acceptable interactive path. The
earlier ADR's reasoning ("full-frame readback + IPC would not beat in-process
Canvas2D replay") is therefore upheld with numbers rather than intuition, and
the native stage is positioned where the transport is amortized: settled frames,
export, print, and any future zero-copy presentation path.

The six-case detached Canvas2D harness has since been run against the same
generated corpus on the same host. The corrected run and paired results are
recorded in [the 2026-10-17 baseline report](../perf/native-raster-baseline-2026-10-17.md).
Those separate microbenchmarks include different stage boundaries: browser
replay includes a full clear and pixel readback, while the native path uses its
own render/readback pipeline. The browser readback is not part of normal editor
replay, and native pixels are still copied to the webview. Therefore the data
do not establish a product speedup, editor frame time, or presentation quality;
the native path remains opt-in and is not promoted to default.

## Why not the alternatives

**Vello.** Researched 2026-10-16 (see the research ledger). `vello_gpu` (the
crate formerly named `vello_hybrid`) documents that **mask layers, complex
filter graphs, and certain non-isolated blend modes panic**; the classic
compute `vello` has been moved to `research/` and is self-described as
experimental with no damage concept in `RenderParams`. A design tool whose
masking system is a first-class contract cannot adopt a renderer that panics on
masks, and a second scene model would duplicate `replayStructuredScene`'s
semantics — the exact drift this repository's structured replay exists to
prevent.

**Skia (`skia-safe`).** Structurally the only rasterizer whose semantics match
browser Canvas2D, because browsers use Skia. Rejected here on cost and fit: a
~19–24 MB prebuilt C++ payload per target, a second build system with its own
toolchain requirements, and it does not address presentation — the embedding
problem is unchanged. It remains the strongest candidate if exact Canvas2D
agreement becomes the binding constraint rather than a goal.

**`lyon` + wgpu tessellation.** `lyon` is a tessellator, not a renderer: fill
rules, antialiasing, group isolation, and damage would all still be ours, at
which point it is the same design with an extra dependency and a triangulator
that cannot represent self-intersecting non-zero contours without preprocessing.
The signed-fan stencil approach used here is smaller and handles those cases
directly.

**A native child surface instead of a rasterizer.** This is the *presentation*
question and is orthogonal. Researched 2026-10-16: wgpu 30 exposes
`SurfaceTargetUnsafe::CoreAnimationLayer` (macOS) and `CompositionVisual` /
`SurfaceHandle` / `SwapChainPanel` (Windows) — the compositor-handoff hooks —
and **nothing equivalent on Linux**. Tauri 2 has no composited-native-surface
API (`tauri#15213`, open, maintainers pointing at the unstable multi-webview
feature); the direct-window route is closed as not planned because the wgpu
surface and the GTK/WebKit compositor fight over the same surface
(`tauri#9220`); and the community overlay thread
(`tauri discussions#11944`) reports the Linux/Wayland case unsolved as of
2026-09. On the primary development platform, WebKitGTK does not compile in
WebGPU at all (`ENABLE_WEBGPU` is `PRIVATE OFF` and no GTK/WPE option enables
it), so the browser GPU path is unavailable there too. The ADR records this as a
**platform limitation with a named spike**, not as a design preference:

- **Linux:** the `gtk::Overlay` + `gtk::GLArea` spike ran on native Wayland.
  It proves GL pixels below a transparent `WebKitWebView` with OS-level
  captures; the exact result, including a partial-damage frame-clock mismatch,
  is in [`wayland-glayer-spike-2026-10-16.md`](../audits/wayland-glayer-spike-2026-10-16.md).
  Its synthetic input does not prove real-pointer DOM clicks, and the spike
  excludes `tauri-runtime-wry`, so it does not establish Tauri integration.
  `wl_subsurface` to wgpu-Vulkan remains unrun; input region, z-order, and
  frame-callback pacing are unverified.
- **macOS:** a `CAMetalLayer` at `zPosition = -1000` with a transparent webview,
  per the two independent shipped implementations found in the research.
- **Windows:** an owned child HWND with its own swapchain, per the
  Steam-overlay invariants (size after the window is real, click-through,
  transparent clear, present at vsync).

The GLArea spike establishes a Wayland compositing mechanism, but no
application-integrated native presenter has been implemented or measured.
Native on-screen presentation therefore remains unverified as a Varve product
capability and must not be claimed. The macOS and Windows experiments above,
and the Wayland Vulkan subsurface experiment, remain unrun.

## Consequences

**Positive**

- The render IR has a second, independent consumer. A backend that agrees with
  Canvas2D on the admitted set is evidence about the IR contract itself.
- Shader and pipeline creation is error-scoped, so a backend whose compiler
  rejects this WGSL degrades with a named reason instead of a panic or a
  process-wide "GPU is off" — the dominant failure class in the external
  research (six independent reports across three applications).
- The stage is a real, tested capability: 46 unit tests, 13 real-device GPU
  tests, and a benchmark that runs on any machine with a hardware adapter.

**Negative / accepted**

- A second rasterizer must be kept pixel-consistent with the Canvas2D replay for
  everything it admits. The admission list is the contract that keeps that
  bounded, and it must not grow without parity evidence.
- The content set is narrow: text, strokes, gradients, images, patterns, blend
  modes, effects, filters, and corner smoothing are all refused with named
  reasons. In practice most real documents are not admitted yet, so the stage is
  not a drop-in renderer.
- Two `RenderItem` shapes disagree: the Rust `Primitive::Path` has no
  `contours` field that the TypeScript type has. The native stage therefore
  handles `holes` but not the newer compound-contour field, and a document using
  it would render differently. **This is an open contract gap**, tracked below.

## Open items

1. **Text.** The largest coverage gap. The planned approach is to carry the
   existing shaped runs (`TextShaping`) into the native render plan and
   rasterize glyph outlines through the same stencil-and-cover path, sharing one
   glyph atlas keyed by font identity, glyph id, and size bucket. Duplicating
   `resolveTextGeometry` in Rust is explicitly rejected: it is the drift the
   canonical-layout contract exists to prevent.
2. **Strokes.** Polyline offsetting with joins, caps, and dashes, admitted only
   when the IR's stroke parameters are in the supported set.
3. **`contours` on `Primitive::Path`.** **Closed 2026-10-16** (`0024e633b`):
   the field flows through `Shape::Path` / `IpcShape` / `Primitive::Path`, the
   replay's ring and fill-rule resolution is mirrored by shared helpers in
   `varve-core` (`compound_path_rings` / `compound_path_fill_rule`), hit
   testing, native admission, and PDF path emission all resolve rings through
   them, and a real-device GPU test renders a contours hole-and-island frame.
   Holes-only documents serialize byte-identically as before; admission may
   now treat a contours-carrying document as presentable.
4. **Canvas2D comparison.** A gated browser harness and six matching corpus
   files have been measured on the native benchmark host. The results are
   useful as harness data, not a promotion comparison: the detached browser
   benchmark includes readback absent from regular editor replay, and native
   output is not directly presented in the window.
5. **MSAA cost.** **Closed 2026-10-17** (`cfed37e6a`). Forced sample counts
   are supported end to end (`create_with_sample_count`; an unsupported count
   is a named error, never a silent fallback), and the 1× path was fixed — it
   previously panicked because the pass always resolved; at 1× the readback
   texture is the render target, no MSAA attachment is allocated, and a
   device test pins both coverage paths there. Findings on RADV Renoir:
   **2× is unsupported on this adapter** (1× and 4× only, so the "try 2×
   next" plan is dead here), and 1× saves roughly 10–35 % of frame time
   depending on case, with the quality cost concentrated on stencil-path
   edges — analytic SDF shapes keep their in-shader antialiasing at any
   sample count. An adaptive per-frame policy remains future work; it needs
   per-sample-count pipeline caching.
6. **Native presentation spike** per platform. **Spike A is run**
   (`311791fed`; evidence:
   `docs/audits/wayland-glayer-spike-2026-10-16.md`): a `gtk::GLArea`
   composites below a transparent WebKitGTK 2.54.1 webview on native Wayland
   with HTML chrome above, so the compositing question is answered yes — with
   a frame-clock discipline caveat (GTK damage can redraw only the webview's
   rect, so an integration must keep the native layer and webview recomposites
   on one frame clock) and synthetic-input evidence classified inconclusive
   (no abort on any click path across three runs on two backends; DOM-level
   click delivery unproven; real-pointer and wry-integrated checks remain).
   The remaining Linux work is an integration spike, not a mechanism search.
   **Spike B (`wl_subsurface` → Vulkan) is still unrun**; spike A lowers its
   priority because the GLArea route already delivers composited-below
   presentation at the widget level, and the next cheapest wgpu question is
   whether wgpu's GL backend can target a GLArea context. **Spike C (macOS
   `CAMetalLayer`) and Windows child-HWND presentation remain unverified** —
   no Apple hardware on the reference host.

## Threaded WASM (companion capability, 2026-10-17)

The companion demand — threaded WASM execution — is delivered and gated by
the same evidence rules:

- **Artifact**: `just wasm-build-threads` builds `varve_wasm_threads`
  (wasm-bindgen-rayon 1.3 on nightly with `CARGO_UNSTABLE_BUILD_STD`; the
  precompiled wasm32 std lacks atomics — reproduced on stable as
  `--shared-memory is disallowed by std ...`). Output directory is separate,
  so the simd/baseline variants can never be overwritten; their ABI is
  unchanged (`threads` is feature-gated).
- **Execution**: a dedicated pool worker (`tracePoolWorker.ts`) owns module
  init, `initThreadPool`, and every synchronous call, so the main thread
  never blocks on atomics or pool joins. The required lane
  (`tests/e2e/canvas/threaded-trace-pool.spec.ts`) fails unless the pool
  initializes under genuine cross-origin isolation and the worker probe
  observes ≥ 2 distinct rayon workers. Measured on the reference host:
  threads 2, verifiedWorkers 2, `crossOriginIsolated: true`
  (`reports/threaded-wasm/`), and the same raster traced through the pool
  and the unshared path is **byte-identical**.
- **Measurement correction**: response headers injected on route-fulfilled
  pages do not confer cross-origin isolation — the recorded probe evidence
  (`reports/inference-platform/facts-4633.json`) shows
  `crossOriginIsolated: false` through every earlier "isolated" probe run.
  The lane now uses the dev server's real `VARVE_CROSS_ORIGIN_ISOLATION=1`
  headers, the same headers a deployment must send.
- **Not claimed**: inference threading stays pinned at 1 (ORT #26858 closed
  stale, unfixed); the GitHub Pages demo has neither isolation nor the
  threaded artifact; the web path engages only where an isolated deployment
  ships the optional artifact (`docs/performance.astro` documents this).
