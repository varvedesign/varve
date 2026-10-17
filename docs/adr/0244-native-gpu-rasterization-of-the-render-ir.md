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

**What was not measured, and is therefore not claimed:** the Canvas2D baseline
for the same corpus on the same machine. Without it there is no speedup claim in
either direction, and the native path is not promoted to default. This is
recorded as an open item rather than papered over.

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

- **Linux:** a `gtk::Overlay` + `gtk::GLArea` spike (wry ships
  `examples/gtk_opengl.rs`, which is not X11-gated) to establish whether a
  native surface composites above or below a `WebKitWebView` on Wayland, and
  whether input routing survives. A `wl_subsurface` handed to wgpu-Vulkan is the
  fallback experiment; wgpu-hal passes the `wl_surface` pointer through
  unchanged, so a sub-surface is technically acceptable, but input region,
  z-order, and frame-callback pacing are unverified.
- **macOS:** a `CAMetalLayer` at `zPosition = -1000` with a transparent webview,
  per the two independent shipped implementations found in the research.
- **Windows:** an owned child HWND with its own swapchain, per the
  Steam-overlay invariants (size after the window is real, click-through,
  transparent clear, present at vsync).

Until one of those is implemented **and measured**, native presentation is
unverified and must not be claimed.

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
3. **`contours` on `Primitive::Path`.** Extend the Rust IR type and the bridge,
   then lower it.
4. **Canvas2D baseline.** Measure the same corpus on the same machine so a
   promotion decision has both numbers.
5. **MSAA cost.** 4× MSAA on an integrated GPU is expensive for heavy frames.
   A sample-count-1 variant with analytic path coverage, or 2×, is the first
   performance experiment.
6. **Native presentation spike** per platform, above.
