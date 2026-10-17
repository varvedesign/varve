# Native Render Stage

Status: current-state documentation (2026-10-16). Companion to ADR-0244,
[render-pipeline.md](render-pipeline.md), [gpu-acceleration.md](gpu-acceleration.md),
[native-acceleration.md](native-acceleration.md), and the external research
ledger at [`../research/native-gpu-canvas-research-2026-10-16.md`](../research/native-gpu-canvas-research-2026-10-16.md).

`crates/varve-accel/src/render` rasterizes the render IR on the GPU. It is a
**rasterizer**, not a presentation path: its output reaches the window through
the existing Canvas2D present surface. Everything below is written to keep that
distinction from eroding, because "the GPU drew it" and "the GPU put it on
screen" are different claims and only the first one is true here.

---

## 1. Where it sits in the pipeline

```text
pointer / keyboard / async update
        │
        ▼
canonical Document  ──►  history / undo            (unchanged, single owner)
        │
        ▼
flattenSceneToEngine + build_render_ir             (unchanged, shared)
        │
        ├──────────────► replayIr / replayStructuredScene  ──► Canvas2D present surface
        │                 (authoritative, always available)
        │
        └──────────────► lower_frame ──► NativePlan ──► wgpu raster ──► RGBA8
                          (admission)                    │
                                                         ▼
                                              straight-alpha bytes
                                                         │
                                                         ▼
                                        drawn on the same Canvas2D surface
```

The native stage never mutates the document, history, selection, camera, or any
editor cache. `NativePlan` is a derived projection with an explicit admission
verdict; nothing downstream can observe it except the rasterizer and the
diagnostics.

## 2. Contract

### 2.1 Input

The same `varve_engine::RenderItem` list the webview replay consumes, plus a
view transform (`[a, b, c, d, e, f]`, camera premultiplied by display scale) and
a device-pixel size. There is no second scene model.

Two IR shapes are read as the replay reads them:

- `fills` is authoritative when present; a fill whose `visible` is `false` is
  skipped, and the legacy singular `fill` is used only when the stack is absent.
  This mirrors `paintFillsAndStrokes` in `replay.ts`.
- Item alpha is `item.opacity * fill.opacity`, folded into the paint's alpha.

### 2.2 Admission

`lower_frame` returns a `NativePlan` whose `AdmissionReport` names every
rejection with a stable key. **A partial plan is not presentable.**
`NativePlan::is_presentable()` is the only thing a caller should branch on.

| Reject reason | Meaning |
|---|---|
| `unsupported-primitive` | `text`, `table`, `rasterLayer` |
| `unsupported-paint` | anything but exactly one visible solid RGB fill |
| `unsupported-stroke` | any visible stroke; also `line`/`arrow`, which the replay renders through a default stroke |
| `unsupported-blend` | item or fill blend mode other than `normal` |
| `unsupported-effects` | content effects or nondestructive adjustment filters |
| `unsupported-corner-smoothing` | reserved; squircle corners are not lowered |
| `empty-geometry` | zero area, non-finite coordinates, or zero alpha |
| `too-many-vertices` | ring vertex count above `MAX_SHAPE_VERTICES` (24) |
| `non-finite-transform` | non-finite node or view transform |
| `out-of-budget` | frame above `MAX_PLAN_ITEMS` / `MAX_PLAN_VERTICES` |

`out-of-budget` is a *render-scoped* refusal, never a device fault.

### 2.3 Coverage matrix

Evidence classes: **unit** (`cargo test -p varve-accel --lib`), **device**
(real-adapter GPU test in `tests/native_raster_gpu.rs`), **bench** (the
`native_render_bench` example), **unverified**.

| Content | Native path | Status | Evidence |
|---|---|---|---|
| Rect, incl. per-corner radius (clamped to half the shorter side) | Analytic SDF coverage | Qualified | unit + device |
| Ellipse, circle | Analytic SDF coverage (first-order distance correction) | Qualified | unit + device |
| Regular polygon (≤ 24 sides) | Analytic half-plane max, convex | Qualified | unit + device |
| Star (≤ 12 points) | Analytic winding SDF, non-convex | Qualified | unit + device |
| Path fill, `nonzero` | Signed fan into stencil (`IncrWrap`/`DecrWrap`) + cover | Qualified; concave and self-intersecting verified | unit + device |
| Path fill, `evenodd` | Signed fan into stencil (`Invert`) + cover | Qualified | unit + device |
| Path `holes` | Additional fan contours | Qualified | unit + device |
| Bézier path points | Adaptive flattening driven by the IR `tolerance`; handles are relative offsets | Qualified | unit |
| Solid paint, item + fill opacity | Premultiplied `(One, OneMinusSrcAlpha)` over encoded sRGB | Qualified | unit + device |
| Paint order, mixed shapes and fills in one frame | Single render pass, ops in input order | Qualified | unit + device |
| Affine transform, camera, DPR, rotation/skew | Composed on the CPU; AA margin derived from the max column scale | Qualified | unit + device |
| Target reuse across frames | Full clear every frame; no incremental path exists | Qualified | device (`a_reused_target_never_shows_the_previous_frame`) |
| Gradients, stacked fills | — | Refused (`unsupported-paint`) | unit |
| Strokes, dashes, caps, joins, arrowheads | — | Refused (`unsupported-stroke`) | unit + device |
| Text, tables, raster layers | — | Refused (`unsupported-primitive`) | unit + device |
| Images, patterns | — | Refused (`unsupported-paint`) | unit |
| Blend modes, group isolation, masks, effects, filters | — | Refused | unit |
| `Primitive::Path.contours` | Compound path fills, including holes and nested islands | **Contract closed; native lowering qualified**: engine IR and IPC preserve `contours`; shared path helpers resolve rings/fill rules for native admission. Serialization, bridge, and GPU hole/island regressions cover the path. This is raster evidence only; it does not prove on-screen native presentation. | engine + bridge unit tests; GPU device test |
| Native presentation (any platform) | — | **Not implemented, not claimed** | — |

Diagnostics at runtime carry the same information: `AdmissionReport.reasons`,
`RenderHealth`, `FailureStage`, `sample_count`, and the three timing fields.

## 3. Rasterization design

### 3.1 One render pass per frame

Analytic shapes and stencil path fills share one render pass, in paint order.
The stencil buffer is cleared once at the start; each path's cover pass resets
its own samples to zero via `pass_op: Zero`, so paths do not need a render pass
each. Every sample a fan leaves non-zero lies inside that path's cover quad, so
the reset is total.

### 3.2 Analytic coverage

Each shape is one instanced quad covering its local bounds expanded by ~1.5
device pixels. Coverage comes from a signed distance evaluated in the item's
**local** space, with the local coordinate interpolated rather than
reconstructed, so `fwidth(distance)` is exactly one device pixel regardless of
rotation, skew, or non-uniform scale.

Two authoring constraints in `shaders/shape.wgsl` are load-bearing and commented
at the top of the file:

- **No runtime-indexed vector component writes** (`v[i] = ...`). Naga lowers
  those to HLSL that FXC rejects (X3550 + X3511), and wgpu 30's DX12 backend
  defaults to FXC. Six independent reports across three applications document
  this class; see the research ledger.
- **No divergent control flow before a derivative.** Loops have a constant trip
  count and every selection is a `select`, so all invocations in a quad execute
  identically and `fwidth` is well defined.

There is no workgroup shared memory anywhere in the stage, so the "two
invocations writing different components of one shared vector" hazard cannot
arise.

### 3.3 Stencil-and-cover for paths

For each contour, the signed fan `{v0, vi, vi+1}` for `i` in `1..n-2` is drawn
into the stencil buffer with colour writes disabled. The signed sum of those
triangles equals the winding number at every sample, which is exact for convex,
concave, and self-intersecting contours without a triangulator. Non-zero uses
`IncrementWrap`/`DecrementWrap` (which cancel correctly and wrap at 256 — a
documented bound, not a silent failure); even-odd uses `Invert`. A cover quad
over the contour bounds paints where the stencil is non-zero and resets those
samples.

Face orientation is deliberately irrelevant: a globally flipped facing flips the
sign of every winding number, and `!= 0` is sign-invariant. The pipeline states
`front_face` explicitly anyway so a reader does not have to re-derive it.

### 3.4 Colour, alpha, and precision

| Boundary | Contract |
|---|---|
| IR colour | `EngineColor::Rgb` with 0–255 **encoded sRGB** channels and 0–255 alpha |
| Shader input | straight (non-premultiplied) 0–1 encoded sRGB |
| Target format | `Rgba8Unorm` — deliberately **not** `-Srgb`, so hardware blending operates on encoded values exactly like Canvas2D |
| Shader output | premultiplied encoded sRGB |
| Blend | `(One, OneMinusSrcAlpha)` for colour and alpha |
| Readback | premultiplied → **straight** alpha, because `ImageData`/`putImageData`/`createImageBitmap` are all defined on straight alpha |
| Intermediate precision | `f32` in shaders, 8-bit storage; no extended-range intermediates |

The encoded-space decision is the one that matters: linearizing would change
every blend and gradient relative to the Canvas2D reference. The
un-premultiply step is measured and reported as `straighten_ms` rather than
hidden inside the readback number.

### 3.5 Limits

Texture extents are preflighted against `max_texture_dimension_2d`; zero-sized
frames are refused. `MAX_PLAN_ITEMS` and `MAX_PLAN_VERTICES` bound the plan.
There is no unbounded allocation path and no growth with session length: the
target is cached by size, and the staging buffer is destroyed on a timed-out
readback rather than reused.

## 4. Lifecycle, failure, and recovery

```text
        create()                 ┌──────────────┐
  ───────────────────────────►   │   healthy    │ ◄── success clears the streak
                                 └──────┬───────┘
              render-scoped failure    │     device-loss signal
                    ┌──────────────────┴──────────────┐
                    ▼                                 ▼
            ┌───────────────┐                 ┌───────────────┐
            │   degraded    │  3 consecutive  │    paused     │
            │ (still draws) │ ───────────────►│  (device is   │
            └───────────────┘                 │   gone)       │
                    ▲                         └───────┬───────┘
                    └── retry() / new content         │
                                                      ▼
                                            retry() drops the stage;
                                            the next request re-creates it
```

| State | Trigger | Behaviour |
|---|---|---|
| healthy | — | Frames are submitted |
| degraded | `Unsupported`, `ShaderFailed`, `OutOfBudget`, `Timeout`, `Internal` | Still submits; the streak is counted and reported |
| paused | 3 consecutive render-scoped failures, or any `DeviceLost` | `is_available()` is false; `paused_reason` names the last failure |
| replaced | `native_raster_retry` after a loss | The stage is dropped, not reset; the next request creates a fresh device and bumps the generation |

Rules that are enforced in code, not by convention:

- **Only `DeviceLost` is device-fatal.** A readback timeout is explicitly not:
  the staging buffer is destroyed to cancel the pending map, the target is
  dropped, and the next frame builds a fresh one.
- **A lost device is never polled.** `device_is_lost()` is checked before
  submission, after submission, and before the readback poll.
- **Shader and pipeline creation is error-scoped.** A WGSL module this backend's
  compiler rejects becomes `ShaderFailed` carrying the compiler's message. This
  was observed working during development: the first version of `shape.wgsl`
  used `active` as an identifier, WGSL reserves it, and the stage reported
  `varve-native-shape failed validation: ... name 'active' is a reserved
  keyword` instead of panicking or retiring the device.
- **A device retired for a non-loss reason is still polled**, so pooled buffers
  are released.

## 5. Diagnostics

`native_raster_status` (never creates a device) returns
`NativeRasterDiagnostics`: availability, device name, backend, driver, sample
count, stencil format, `RenderHealth`, the last admission report, the last
error with its `FailureStage`, and the last frame's draw calls and three timing
fields.

Everything is local and non-identifying: no file paths, no document content, no
device identifiers beyond the adapter name and driver string that `wgpu` already
reports. `describeAdmission` produces a fixed-vocabulary summary; a unit test
asserts it cannot contain a path separator.

## 6. Tests

| Layer | Where | Count | Notes |
|---|---|---|---|
| Lowering and policy | `crates/varve-accel/src/render/mod.rs` (`mod tests`) | 46 | Geometry, admission, paint order, opacity, winding, health policy, record layout |
| Real device | `crates/varve-accel/tests/native_raster_gpu.rs` | 13 | Actual pixels on the hardware adapter |
| Frontend policy | `packages/editor/src/render/nativeRasterClient.test.ts` | 14 | Admission gates, framing decode, straight-alpha contract |
| Benchmark | `crates/varve-accel/examples/native_render_bench.rs` | — | Attributable cost per stage |

**GPU tests fail loudly when no adapter is present.** `VARVE_REQUIRE_GPU=1`
turns an absent adapter into a failure with the reason; without it the test
prints the exact reason and skips. A GPU suite that silently skips turns a
broken backend into a green gate.

Two regressions worth naming, because both were found by tests rather than
review:

- The cover quad's index offset was taken from the *vertex* count instead of the
  index buffer. That is correct for a triangle and wrong for every larger
  contour, and it silently painted only the last fan triangle of a quad. Pinned
  by an assertion in `a_closed_path_becomes_a_fan_plus_one_cover_quad` and by
  `a_path_fill_covers_its_interior` on the device.
- The viewport bind group was set once per frame, so a shape run followed by a
  path fill drew with the shape group bound to a pipeline that expected the
  viewport group. Found by the benchmark's mixed corpus; pinned by
  `shapes_and_path_fills_composite_in_one_frame`.

## 7. Measured cost

See ADR-0244 §"The measurement that drove points 5 and 6" for the full table.
Summary on the reference machine (AMD Ryzen 3 5300U, RADV Renoir, Mesa 26.2.4,
Vulkan, Wayland, MSAA 4×, warm, 60 frames per case):

- Rasterization itself: **0.04–0.76 ms** of command recording.
- Lowering: 0.31 ms at 600 items, ~7 ms at 10 000.
- Transport (GPU sync + row copy + un-premultiply): **14.7 ms at 1600×1000**,
  30 ms at 2560×1600, 39 ms at 3200×2000.
- Heavy frames are GPU-bound: ~83–92 ms of completion at 10 000 items on this
  integrated part, independent of resolution.

The updated six-case comparison is recorded in
[native-raster-baseline-2026-10-17.md](../perf/native-raster-baseline-2026-10-17.md).
It measures detached Canvas2D replay plus clear/readback beside native render
and readback, in separate runs. The browser readback is absent from normal
editor replay, and native pixels are still copied to the webview. These numbers
do not establish editor frame time, compositor presentation, or a product
speedup in either direction.

## 8. Reproducing

```bash
# Unit tests (no device needed)
cargo test -p varve-accel --lib

# Real-device GPU tests; fails rather than skips when no adapter is present
VARVE_REQUIRE_GPU=1 cargo test -p varve-accel --test native_raster_gpu -- --test-threads=1

# Attributable cost
cargo run --release -p varve-accel --example native_render_bench

# Frontend policy
npx vitest run --project jsdom packages/editor/src/render/nativeRasterClient.test.ts
```

`VARVE_BENCH_FRAMES` (default 60) and `VARVE_BENCH_DEVICE` (preferred adapter id)
adjust the benchmark.

The Canvas2D baseline harness is opt-in and reports replay, a full clear, and
full-frame pixel readback on a detached canvas; it does not measure compositor
presentation or editor frame time. Emit all six datasets and run the same frame count:

```bash
cargo run --release -p varve-accel --example native_render_bench -- \
  --emit-corpus /tmp/varve-baseline
VARVE_BENCH_FRAMES=60 cargo run --release -p varve-accel --example native_render_bench
VARVE_CANVAS2D_BASELINE=/tmp/varve-baseline VARVE_BASELINE_FRAMES=60 \
  node scripts/quality/heavy-lease.mjs 'e2e: Canvas2D native-raster baseline' -- \
  npx playwright test tests/e2e/perf/canvas2d-native-baseline.spec.ts \
    --config playwright.inference-probe.config.ts --project=chromium --workers=1
```

These are separate single runs. Record machine load and toolchain alongside
both outputs. The Canvas2D timing does not establish what the compositor will
present, so this microbenchmark alone cannot support a speedup claim.

## 9. Rollback

The stage is additive and opt-in:

- Nothing in the editor depends on it. Removing the `native_raster_frame`
  command, the `NativeRasterState` management entry, and the
  `nativeRasterClient` re-export from `canvasRenderAdapter.ts` returns the
  application to its previous behaviour with no data migration, because the
  stage never wrote to the document or to any cache the editor reads.
- A paused or unavailable stage is the steady state on a machine without a
  hardware adapter, and it is already handled: the authoritative replay draws.
- Documents are unaffected by design. The stage cannot save, and no export path
  reads its output.

## 10. Known limitations

1. **Text is not rendered natively.** The largest coverage gap; see ADR-0244
   open item 1 for the planned approach and the rejected alternative.
2. **Strokes are not rendered natively.** Refused, never dropped.
3. **Compound contours are now lowered.** The Rust IR carries `contours` and
   the shared path helpers preserve compound fill semantics through admission;
   the compatibility and regression coverage are recorded in the
   `feat(ir): carry compound-path contours through the Rust IR and native
   admission` change.
4. **No application-integrated native presenter.** The GTK `Overlay` +
   `GLArea` mechanism has passed a Wayland compositing spike, but real-pointer
   DOM input and the Tauri/Wry parent-chain behavior remain unverified. No
   native presenter is integrated on any platform; see ADR-0244 and the
   [Wayland spike evidence](../audits/wayland-glayer-spike-2026-10-16.md).
5. **MSAA 4× is expensive on integrated GPUs** for heavy frames.
6. **No presentation-level Canvas2D comparison exists.** The opt-in
   same-corpus microbenchmarks are recorded in
   [the baseline report](../perf/native-raster-baseline-2026-10-17.md), but the
   detached canvas readback is not the editor's normal replay path and native
   output is not presented directly. No product speedup claim is supported.
7. **`Primitive::Path` requires at least 2 points** and contours below 3
   flattened points are refused rather than drawn as a degenerate sliver.
