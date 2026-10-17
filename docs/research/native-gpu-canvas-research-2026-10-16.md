# Native GPU canvas: external research ledger (2026-10-16)

Research gate for ADR-0244 and `docs/architecture/native-render-stage.md`.
This is the consolidated ledger. Raw, unedited working notes (including full
issue-comment extracts and the raw upstream API survey) are not committed; every
claim below is traced to the URL it came from, and anything that could not be
verified is marked as such rather than smoothed over.

Two questions drove the research:

1. **What actually goes wrong when a creative application adds a native GPU
   canvas?** — answered from the eight assigned trackers.
2. **What can be built in 2026 on this stack?** — answered from wgpu 30, Vello,
   Tauri/wry, GTK/WebKitGTK, WebView2, WKWebView, and MDN/BCD.

---

## 1. Access log

| Source | Result |
|---|---|
| `storytold/{figcraft, artcraft, lightcraft, filmcraft, pdfcraft, designcraft, effectcraft, photocraft}` | Read via the authenticated GitHub CLI. **Not enumerated exhaustively**: ~8 350 issues exist across the eight trackers; 11 seeds were read in full (body + all comments) and roughly 130 further issues were reached by symptom-class search and by following references from the seeds. Issues no seed and no search term touched are unread. |
| Assigned seeds | All 11 read in full: effectcraft #1605, #613, PR #1571; lightcraft #1948; photocraft #6345, #6339; designcraft #1053; figcraft #573; artcraft #2379; filmcraft #2094; pdfcraft #2695. |
| Attachment images | **Not fetched or inspected.** Where a ledger row mentions a screenshot it is the reporter's description, not an observation. |
| Referenced sibling repos (`craft-libs`, `vectorcraft`, `wordcraft`, …) | Not inspected. Several bot comments point there; the pointers were recorded, not followed. |
| `wgpu` 30.0.1, `wgpu-types`, `wgpu-hal`, `wgpu-core` | Read from the published crate sources, not from memory. API facts below are quoted from those sources. |
| Tauri 2.12.2 / wry 0.57.0 | Read from the local cargo registry. |
| WebKit preference/CMake defaults | Read from `WebKit/WebKit@main`: `UnifiedWebPreferences.yaml`, `WebKitFeatures.cmake`, `OptionsGTK.cmake`, `OptionsCommon.cmake`, `OptionsWPE.cmake`. |
| MDN + browser-compat-data | `GPUCanvasContext.configure`, `GPUDevice.lost`, BCD `main`. |
| WebKitGTK 2.54 release highlights | Fetched. |
| `tauri#15213`, `tauri#9220`, `tauri#8246`, `tauri discussions#11944`, WebView2Feedback discussion 4019 | Fetched and read in full. |
| GitHub code search for `WEBGPU_BY_DEFAULT` | **401, requires authentication.** Could not enumerate every place that define might be set. The WebKitGTK conclusion rests on three independent negatives, stated below. |
| Arch/CachyOS WebKitGTK PKGBUILD | **Not inspected**, so a distro build passing `-DENABLE_WEBGPU=ON` cannot be ruled out. Even then `WebGPUEnabled` would still default to `false` without `WEBGPU_BY_DEFAULT`. |
| Anything compiled | Only the Varve-side code. The upstream API shapes quoted below were read, not built. |

---

## 2. Ledger — external failure classes

Format: `source → symptom → confirmed vs suspected → relevance to Varve →
mitigation → regression → evidence quality`. Duplicates are consolidated, and
each class carries its independent-report count.

### 2.1 A recoverable GPU error permanently disables acceleration — 6 independent reports, 3 apps

| | |
|---|---|
| **Sources** | lightcraft #1948; lightcraft #1764; photocraft #6563; photocraft #6564; photocraft #6577; effectcraft #1116 |
| **Symptom** | One error arrives on a generic callback, sets a process-lifetime flag meaning "never use the GPU again", and every subsequent refresh silently renders on the CPU for the rest of the session. |
| **Confirmed vs suspected** | **Confirmed by code reading in two cases**: `photocraft#6564` — "`DeviceHealth::watch` treats *every* uncaptured wgpu error as a permanent fault"; `lightcraft#1764` — a validation error on a buffer the OOM had already invalidated is promoted to fatal. |
| **Triggers seen** | A 60 s readback timeout (`#1948`); a layer texture that did not fit (`#6563`); a surface reconfigure that timed out during a resize (`#1116`); moderate VRAM pressure from concurrent renders (`#1764`). Four different triggers, one consequence. |
| **Relevance to Varve** | Direct. `varve-accel` had `AccelError::Execution` mapping to `UnavailableReason::InitFailed`, and the effect engine held one engine handle that was dropped on any error. |
| **Mitigation (implemented)** | `RenderError` separates `Unsupported` / `ShaderFailed` / `OutOfBudget` / `Timeout` / `DeviceLost` / staged `Internal`; `is_device_fatal()` is true only for `DeviceLost`; `RenderHealth` pauses after 3 consecutive render-scoped failures with an explicit `retry()`. A readback timeout destroys the staging buffer to cancel the pending map and drops the target — the device stays usable. |
| **Regression** | `a_devices_loss_is_fatal_while_a_timeout_is_not`, `health_pauses_after_bounded_render_scoped_failures_and_retries_explicitly`, `an_unsupported_frame_is_refused_without_touching_the_device` (device-level: renders a supported frame afterwards). |
| **Evidence quality** | **High.** Two maintainer-confirmed root causes with file:line pointers, one shipped fix in the same area, six independent configurations across three applications. |

Two sub-lessons that are easy to miss and are implemented separately:

- An error *derived* from an earlier recoverable failure must not be promoted
  (`lightcraft#1764`).
- A device retired for a **non-loss** reason must still be polled so its pooled
  buffers are freed — a reviewer caught exactly that regression in
  `lightcraft#1984`. In this implementation, `device_is_lost()` gates the poll,
  and nothing else does.

### 2.2 A fixed wall-clock timeout is read as device loss — 1 report, high confidence

| | |
|---|---|
| **Source** | lightcraft #1948 (2026-10-15), fix PR lightcraft #1973 (**open, unmerged**) |
| **Symptom** | A 400 MP export exceeds `READBACK_TIMEOUT = 60 s`; `finish_and_read` calls `fail(FailKind::Fatal, …)`; the GPU is off for the rest of the process. The reporter's own sentence is the lesson: *"The device was not lost; the job was just slow."* |
| **Confirmed vs suspected** | Reporter-confirmed by code reading, with a reproduction script and before/after timings (86.7 s GPU-then-CPU vs CPU-only). |
| **Relevance to Varve** | `crates/varve-accel/src/discovery.rs` had a 30 s `READBACK_TIMEOUT` whose expiry mapped to `UnavailableReason::InitFailed`. |
| **Mitigation (implemented)** | `FRAME_READBACK_TIMEOUT` expiry produces `RenderError::Timeout` (stage `Readback`), which is explicitly **not** device-fatal and degrades one frame. The PR's design is adopted: per-render fallback, explicit submission accounting, and a separate "device lost is fatal" path. |
| **Regression** | `a_devices_loss_is_fatal_while_a_timeout_is_not`; the timeout path itself needs a slow-job injection and is **not yet covered by an automated test**. |
| **Evidence quality** | Single report, but with a full reproduction, timings, and a file:line cause. Low prevalence, high confidence. |

The inverse case matters too: `effectcraft#1590` shows a **real** external
watchdog (Chrome's GPU process) killing a device that was merely compiling, with
a standalone reproduction — synchronous pipeline creation → lost at 60.1 s;
async → 43.6 s, no loss. That is why every pipeline in this stage is created once
at init, and why creation is error-scoped.

### 2.3 Partial surfaces show stale or uninitialised pixels — 5 independent reports

Three distinct mechanisms, one user-visible result.

| Mechanism | Source | What happened |
|---|---|---|
| Staleness keyed on too little | photocraft #2422 | A resident mask texture captures its default pixel **once** at creation; tiles the surface does not store are never updated. Inverting the mask flips the default without touching them, so the canvas shows a staircase of blocks at the old value — while the saved PNG is correct. |
| A damage rectangle is not a sufficient description of a partial upload | photocraft #6418 | On AMD + Vulkan a partial upload corrupts one 256-byte block at the **origin of mip 5**, outside the damaged area, deterministic 6/6, clean on DX12 on the same card. |
| A recycled surface is sampled before it is written | photocraft #6790; effectcraft PR #1571 | Solid red rectangles in brush previews on Intel Iris Xe/DX12 — "whatever that GPU memory last held". The PR describes the ordering variant: without a UAV barrier after `STORAGE_WRITE_ONLY`, two dispatches writing one storage texture can overlap. |
| **Relevance to Varve** | Direct: this is the repository's "never show pixels no fresh frame will replace" rule, encountered by other projects. |
| **Mitigation (implemented)** | The native target is cached by size but **fully cleared every frame**, and there is no incremental redraw path in the stage at all — so no provenance question can arise. A timed-out readback destroys the staging buffer rather than reusing it. |
| **Regression** | `a_reused_target_never_shows_the_previous_frame` (device-level): a full-frame render followed by a small one must leave the first frame's region transparent, not stale. |
| **Evidence quality** | High for existence (5 reports, 2 applications), medium for the individual mechanisms — one is inferred rather than logged. |

### 2.4 Device loss with no presentation path: the last frame stands for the current document — 3 apps

| | |
|---|---|
| **Sources** | designcraft #90; photocraft #478; effectcraft #225 (fixed by effectcraft #237) |
| **Symptom** | After the device that presents the UI dies, the document is fine — edits apply, exports are byte-correct — but the screen keeps showing the pre-loss image or goes blank with no way out. `photocraft#478`: *"Switching the document compositor to CPU does not by itself restore the GPU-backed egui browser presentation surface."* |
| **The trap in the one shipped fix** | In `effectcraft#225` the app's own status message about the loss was drawn **in the lost canvas**, so the user saw nothing at all. The fix covers the canvas with an HTML notice naming the reason, offering Save Project and Reload, and the reload path flushes pending changes first. |
| **Relevance to Varve** | Direct, and already structurally handled: the present surface is Canvas2D for life (the 2026-07-13 invert), so a GPU-side failure cannot blank the canvas. What was *not* handled is the honesty half — a paused native stage must be visible in diagnostics rather than silently absent. |
| **Mitigation (implemented)** | `RenderHealth.paused` plus `paused_reason`, surfaced by `native_raster_status`; `native_raster_retry` is the explicit recovery. Nothing the stage reports is drawn by the stage. |
| **Evidence quality** | Medium. Three applications, three independent reporting efforts — but all three used deliberate fault injection (`device.destroy()`), and every reporter says so. **No report in this corpus shows a physical driver loss producing this exact symptom on the native desktop path**, which is the configuration that matters most. |

### 2.5 Shader compiler selection is a runtime dependency — 6 machines, 3 mechanisms

| Mechanism | Source | Detail |
|---|---|---|
| FXC rejects valid HLSL that naga emits | effectcraft #613 | Writing a vector component through a **runtime** index (`o[k] = …` in a loop) makes FXC unroll every surrounding loop and give up (X3550 + X3511). All 224 kernels compiled through FXC as wgpu does: **12 fail**; all 12 compile with DXC. Reproduced on five discrete GPUs plus WARP. `effectcraft` PR #1571 fixes it and is **open, unmerged, and in conflict**. |
| The default DX12 compiler loads a DLL by name from `PATH` | lightcraft #471 → #484 (merged); photocraft #712 → #817 (merged) | wgpu's `Dx12Compiler::Auto` loads whichever `dxcompiler.dll` the Windows search order finds first — a Windows SDK, a browser folder, an audio plug-in. An older copy warns that the DXIL is unsigned, wgpu-hal treats a non-empty DXC error blob as a compile error, and the device is lost. Two independent teams shipped the same fix. |
| Slow pipeline construction exceeds an external watchdog | effectcraft #1590 | 224 synchronous `createComputePipeline` calls keep Chrome's GPU process at ~1 core past its watchdog; the process is killed as `RESULT_CODE_HUNG`. `createComputePipelineAsync` completes with no loss. |
| **Relevance to Varve** | The first mechanism applies directly: `varve-accel` builds wgpu **without** the `gles` feature and does not override `Dx12BackendOptions`, so `Dx12Compiler::Fxc` is wgpu 30's default and **the DX12 path uses FXC**. The second does not apply today (no DXC is loaded), and the third is avoided because every pipeline here is created once at init. |
| **Mitigation (implemented)** | No runtime-indexed vector component writes in either WGSL file, stated as a load-bearing authoring constraint at the top of `shape.wgsl`. Shader module and pipeline creation run inside a `Validation` error scope, so a rejection becomes `ShaderFailed` with the compiler's message. Pipelines are created once in `from_compute`, never in the frame loop. |
| **Regression** | The error-scoping path was observed working during development: `shape.wgsl` initially used `active` as an identifier, WGSL reserves it, and the stage reported `varve-native-shape failed validation: … name 'active' is a reserved keyword` instead of panicking. **Not yet covered by an automated test** — a deliberate-bad-WGSL test is an open item. |
| **Evidence quality** | Very high for FXC and for the foreign-DLL class (two merged fixes, six machines, a bisect to one source line, a minimal reproducer). High for the watchdog mechanism, low for its prevalence. |

### 2.6 Small backend differences at discontinuities become whole-pixel differences — 6 reports, 4 vendors

| | |
|---|---|
| **Source** | effectcraft #1605 (the systematic sweep); corroborated by effectcraft #405, effectcraft #211, photocraft #3053, photocraft #1848, filmcraft #720 |
| **Symptom** | On Intel UHD/Vulkan, 16 of 212 GPU/CPU comparison tests fail. Ten sit just over a 1e-3 tolerance at 0.0012–0.0035 and look like ordinary `f32` variation. The three large ones are all at a **discontinuity**: posterize at level 4 gives 112/255 vs 83/255 (adjacent quantisation steps); a LUT lookup lands on a distant entry (0.0980 vs 0.5843); a hard-edged mask goes to alpha 0.9914 vs 0.0. |
| **Reporter's own framing** | *"I cannot tell which side is correct, only that the two disagree."* |
| **Relevance to Varve** | Direct, and it changes how parity must be tested: a whole-image average error or a single absolute-max tolerance is the wrong instrument. The near-tolerance population and the discontinuity population need different assertions. |
| **Mitigation** | The stage's parity claims are per-class and exact where exactness is expected: solid fills are asserted with **exact equality** on the encoded channel values, not a tolerance, because the contract is "same encoded value" rather than "close". Antialiased edges are asserted by coverage presence and count, not by magnitude. Gradients, thresholds, and LUTs are not admitted at all, so the class cannot arise yet. |
| **Evidence quality** | High for the mechanism (four one-effect fixes across three applications and four vendors, one of them merged after a maintainer confirmed the test fails on main); low for prevalence — one systematic sweep. |

### 2.7 Workgroup-memory hazards present as precision failures — 2 reports, root-caused

| | |
|---|---|
| **Source** | lightcraft #479 |
| **Symptom** | Two GPU denoise equivalence tests fail on Apple M5/Metal with relative errors **0.77–0.84** against a 2e-4 limit; independently reproduced on M1/Metal with errors "around 1e37 or infinity". |
| **Root cause** | A convolution shader declares its shared tile as `array<vec4<f32>>` and **different invocations write different components of the same shared vector**. Changing to independently written scalars brought the max relative error to ≈1.1e-6; restoring the original brought the failure back. |
| **Relevance to Varve** | The failure presents as a large *difference*, not as corruption, and values around 1e37 pass a "difference is too large" framing. |
| **Mitigation** | The native stage uses **no workgroup shared memory at all** — it is entirely vertex/fragment, so the hazard cannot arise. Recorded as an authoring constraint. |
| **Evidence quality** | Strong: reproduced twice on two Apple silicon generations, root-caused, and the fix validated by reverting it. One application. |

The sibling claim in `effectcraft` PR #1571 — a missing UAV barrier after
`STORAGE_WRITE_ONLY` in wgpu-hal's DX12 backend — is the author's, attributed to
upstream issues that were **not opened**. It is recorded as a lead, not a
finding.

### 2.8 Present-rate and swapchain behaviour produce visible defects that are not canvas defects — 3 sub-classes

| Sub-class | Source | Detail |
|---|---|---|
| VRR brightness flicker | lightcraft #2025, #326; pdfcraft #2147, #2418; photocraft #5736 | An app that draws only on change swings the present rate between almost nothing and the full refresh rate, and the panel's brightness follows. Two fingerprints recur: turning G-SYNC off stops it, and **screen recordings do not show it** (capture pins the present rate). |
| Intel-iGPU windowed flicker | filmcraft #1305 (the diagnostic specimen: DX12 ✗, Vulkan ✗, GL ✓, windowed-only, no discrete GPU so VRR is ruled out by the reporter); figcraft #349; artcraft #1983; photocraft #5408 | A distinct class from VRR — the backend makes the difference. |
| Swapchain frame-queue latency | photocraft #5070 (PR, open, `status:decision`) | `desired_maximum_frame_latency: Some(2)` queues two frames; on X11 with a discrete GPU that is ~16 ms of extra cursor lag, bringing input-to-cursor-display to 3–4 frames at 60 Hz. |
| **Relevance to Varve** | **None today**, because the native stage does not present: there is no swapchain, no present mode, and no frame queue. Recorded because it becomes live the moment native presentation is attempted, and because "flicker" in a tracker is not one defect. |
| **Evidence quality** | High for VRR (≥7 occurrences, a mechanism statement, a controlled toggle, and a fingerprinted diagnostic). Medium–high for the Intel class. Medium for the latency class (one diagnostic report, unmerged PR). |

### 2.9 `Surface::configure` is a distinct failure surface — 3 applications

`effectcraft#1116` (Hyprland + NVIDIA; reproduced on headless sway),
`artcraft#2087` (hybrid Intel + AMD), `pdfcraft#519` (2015 Intel HD with no
D3D12 UMD; **maintainer-confirmed and fixed**, with the note that the OpenGL
fallback added in the previous release never got a chance to run because wgpu
panics on the configure failure before the app starts).

Mechanism, per `effectcraft#1116`: `configure_surface` waits for the device to go
idle and returns `GpuWaitTimeout` when another thread is submitting at the same
time. **Relevance to Varve:** the native stage creates **no surface**, so this
entire class is structurally absent. It becomes relevant to native presentation,
and the mitigation is to keep presentation and computation health separate — a
reconfigure failure must never retire the compute context.

### 2.10 Budget, residency, and preflight — 6 reports, 4 applications

`lightcraft#1764` (~17 GB of requests against 4 GB), `photocraft#6563` (526
validation errors in 4 ms from unchecked per-page texture allocation with
post-hoc eviction), `photocraft#1154` (a buffer above `max_buffer_size`),
`photocraft#5986` and `pdfcraft#2383` (device limits above the adapter's on a
Raspberry Pi 5 V3D 7.1), `effectcraft#879`/`#1184` (frames in flight).

Two mitigations that were *tried and measured*, worth noting as method:
`photocraft#4515`'s author proposed sizing scratch textures to the damage,
measured it, found no change, and **retitled the issue to the unexplained
observation** rather than shipping the unmeasured fix. `effectcraft#1520` shows
the second-order cost of checking health only at frame boundaries: frame 0 was
declined 20.4 s into an export, 10 s after the GPU had retired.

**Relevance to Varve:** preflight extents against `max_texture_dimension_2d`,
bound the plan by item and vertex counts, and check health at the unit of work.
Implemented; the "check health before each unit" half is satisfied because the
stage is a single unit per frame.

### 2.11 Teardown races the driver — 1 report

`lightcraft#620`: "a GPU render still running on a worker thread segfaults in the
NVIDIA Vulkan driver", with a paired fix PR. Title-only; no log or hardware
detail read.

**Relevance to Varve:** the desktop command layer runs the whole
lower-and-rasterize sequence inside one `spawn_blocking` closure holding the
state lock, so a request cannot be torn down mid-submission; the stage is dropped
between requests, never during one.

### 2.12 Device-loss evidence classification

| Claim | Where |
|---|---|
| The native stage cannot panic on a lost device's `poll`, because it checks `device_is_lost()` before every poll | `lightcraft#1984` (open PR): wgpu 30 routes `poll` on a lost device to `handle_error_fatal` (panics), and a destructor that polls during unwinding aborts. |
| There is no `Drop` that polls | This implementation. |

---

## 3. Unrelated or insufficient findings

Recorded deliberately. Carrying these forward would have inflated the ledger with
items that are not GPU-canvas defects.

| Source | Why it is not carried |
|---|---|
| designcraft #1053 (seed) | **Not a GPU defect.** Root cause found and fixed: `native_menu.rs` drains `MenuEvent::receiver()` once per frame with no `set_event_handler` calling `request_repaint`, so a mouse-chosen command waits for the next input event — measured at 8, 12, 15 s and "more than 90 s", then 0.4 s after any input. A frame-scheduling defect, not a repaint/present defect. Worth recording because a reader could easily mistake it for one. |
| figcraft #573 (seed) | Pure UI layout: overlapping/clipped submenu icons and labels. The reporter labelled the body "(AI WRITTEN)". No GPU content. |
| artcraft #2379 (seed) | **Tracker misplacement, as the brief warned.** Body in full: "In photocraft exporting to WebP, once clicked i freezes." Zero comments, no version, no OS, no steps, no log. A search of the PhotoCraft tracker found no corresponding issue. One line with no repro is not prevalence evidence. |
| filmcraft #2094 (seed) | The isolation matrix is genuinely good method (Lumetri "shadows" alone reproduces it: 0.072 % blue-dominant pixels; every other variable 0.0 %), but the reporter labels the mechanism "a guess, not confirmed", there are zero comments, and **nothing establishes whether the effect ran on the GPU at all**. Carried as method, not as a GPU finding. |
| pdfcraft #2695 (seed) | **Not a GPU defect.** Confirmed root cause: a `_NSTouchBarFinderObservation` KVO teardown crash at window close, with a crashing stack that has no PdfCraft frame on it. Fixed on main; verified 7/10 crashes before → 0/10 after. Carried only for its test method — run the real termination path ten times per build and count non-zero exits. |
| figcraft #553, #541; designcraft #612 and the winit mixed-DPI drag reports | UI scaling and a winit windowing defect, not canvas rendering. |
| photocraft #5696 (DDS import blank) | Decoder defect, not a canvas defect, despite the word "blank". |
| effectcraft #232 (golden-hash mismatch) | Root cause: platform `libm` differences under exact-bit hashing. Not GPU, not a regression. |
| effectcraft #1484, effectcraft #1487, artcraft #1983 (as a report) | Bot-relayed Discord tickets with no version, no GPU, no log. They establish that a symptom occurs and very little else. |
| artcraft #2327 | NVIDIA 580 + Wayland tearing. No logs, and the reporter's attempted workarounds are at the wrong layer for a wgpu app. |
| pdfcraft #413 | Fetched but not read in enough depth to classify, and it did not reappear in any search. Deliberately not carried rather than guessed at. |
| Any `ticket-craft[bot]` "possibly related" comment | Automated triage links, not independent observations. Not counted. |
| Any report disclosing AI assistance | The disclosure is recorded; the **evidence** (repro steps, versions, logs, measurements) was weighed instead of the author's identity. Several issues in this corpus carry such disclosures, including two seeds. |

---

## 4. Prevalence assessment

Independent = a different reporter on a different machine or configuration.
Maintainer splits of one investigation are one observation; a PR and its own
issue are one; bot links are none.

| Class | Independent reports | Independent apps | Confidence |
|---|---:|---:|---|
| Recoverable error → permanent GPU fault | 6 | 3 | **High** — two maintainer-confirmed root causes, one shipped fix in the same area |
| Fixed timeout → device loss | 1 | 1 | Low prevalence, **high** confidence |
| Stale / uninitialised pixels on a partial surface | 5 | 2 | High for existence, medium for individual mechanisms |
| Device loss with no presentation path | 3 | 3 | Medium — all three used deliberate fault injection |
| Shader compiler selection | 6 machines / 2 apps (FXC); 5 / 3 (foreign DLL); 3 / 1 (watchdog) | 3 | **Very high** for the first two, high for the third |
| Precision at discontinuities | 6 for the mechanism, 1 systematic sweep | 3 | High for the mechanism, low for prevalence |
| Workgroup-memory hazard | 2 | 1 | Medium–high |
| Present-rate / swapchain defects | ≥7 VRR, ≥5 Intel-iGPU, 2 latency | ≥4 | High for VRR, medium–high for the rest |
| `Surface::configure` | 3 | 3 | High |
| Budget / residency / preflight | 6 | 4 | High |
| Teardown races the driver | 1 | 1 | Low |

**Overall.** The strongest signal is 2.1: six independent reports across three
applications where a recoverable error permanently disabled acceleration, with
two maintainer-confirmed root causes. That is treated here as established fact,
not as a hypothesis to test. The second strongest is 2.5: three separate
mechanisms that all make a GPU backend fail to start on a machine where the code
is fine, six machines for the first alone, and two independent teams shipping
the same fix.

Two honest limits. First, **the reports cluster in a very short window**
(2026-10-07 to 2026-10-17); 10 of the 11 seeds were created on 2026-10-15 alone,
within a ten-hour span, which is consistent with a release cycle rather than a
longitudinal record. Second, **a large fraction of the low-detail reports are
bot-relayed Discord tickets** with no version and no follow-up; where they are
counted, the confidence is marked accordingly.

---

## 5. Upstream findings

### 5.1 wgpu 30.0.1 — verified API facts

Read from the published crate sources. Several differ from what a reader would
write from memory of wgpu ≤ 29, and all of them affected this implementation.

| Fact | Value | Source |
|---|---|---|
| Version in the lockfile | `wgpu 30.0.1`, `wgpu-core 30.0.1`, `wgpu-hal 30.0.1`, `wgpu-types 30.0.1` | `apps/desktop/src-tauri/Cargo.lock` |
| wgpu 30.0.1 MSRV | **1.87** | crate `Cargo.toml` |
| Workspace MSRV declaration | `1.82` | `/Cargo.toml` |
| `SurfaceConfiguration` | generic over the view-formats type; has a **new `color_space: SurfaceColorSpace` field** | `wgpu-types/src/surface.rs` |
| Surface errors | **`SurfaceError` does not exist.** `Surface::get_current_texture()` returns `CurrentSurfaceTexture` with `Success`/`Suboptimal`/`Timeout`/`Occluded`/`Outdated`/`Lost`/`Validation` | `src/api/surface_texture.rs` |
| Present | `SurfaceTexture::present()` → **`Queue::present(surface_texture)`** | `src/api/queue.rs` |
| Poll | `Device::poll(PollType) -> Result<PollStatus, PollError>`; `PollError::Timeout` | `wgpu-types/src/lib.rs` |
| Device loss | `Device::set_device_lost_callback(impl Fn(DeviceLostReason, String) + Send + 'static)` | `src/api/device.rs` |
| Error scopes | `Device::push_error_scope(ErrorFilter) -> ErrorScopeGuard`, `guard.pop()` is async | `src/api/device.rs` |
| Vertex buffers | `VertexState::buffers: &[Option<VertexBufferLayout>]` | `src/api/render_pipeline.rs` |
| Pipeline layouts | `bind_group_layouts: &[Option<&BindGroupLayout>]`, `immediate_size: u32` | `src/api/render_pipeline.rs` |
| Colour attachment | `RenderPassColorAttachment` has `depth_slice: Option<u32>` | `src/api/render_pass.rs` |
| Buffer mapping | `get_mapped_range_mut()` returns `Result<_, MapRangeError>` | `src/api/buffer.rs` |
| Copy | `TexelCopyTextureInfo` / `TexelCopyBufferInfo` | `src/api/command_encoder.rs` |
| Copy row alignment | `COPY_BYTES_PER_ROW_ALIGNMENT` | used by the readback |
| MSAA capability | `TextureFormatFeatureFlags::MULTISAMPLE_X4` / `MULTISAMPLE_RESOLVE` | `wgpu-types/src/texture/format.rs` |
| **DX12 compiler default** | `Dx12Compiler::Fxc` — "doesn't require any additional .dlls to be shipped" | `wgpu-types/src/backend.rs` |
| Compositor handoff targets | `SurfaceTargetUnsafe::{CoreAnimationLayer, CompositionVisual, SurfaceHandle, SwapChainPanel}` — **no Linux equivalent** | `src/api/surface.rs` |
| Wayland surface creation | wgpu-hal accepts `Rwh::Wayland` and passes the `wl_surface` pointer straight to `vkCreateWaylandSurfaceKHR`, so a `wl_subsurface` is technically acceptable | `wgpu-hal/src/vulkan/instance.rs` |

**MSRV discrepancy, stated plainly.** The workspace declares
`rust-version = "1.82"` while its own pinned dependency declares 1.87. With the
installed rustc 1.97 the build succeeds, and because the workspace uses
`resolver = "2"` (not MSRV-aware) the mismatch is currently dormant — but
`rust-version = "1.82"` is not a true statement about the workspace as locked.
Recorded here rather than silently changed, because changing it is a
workspace-wide decision outside this ADR's scope.

### 5.2 Vello and alternatives (2026-10-16)

| Name | Version | License | Backends | Text | AA / path quality | Damage | Build size | Maturity | Fit |
|---|---|---|---|---|---|---|---|---|---|
| `vello` (classic compute) | 0.11.0 (2026-10-02) | Apache-2.0 OR MIT | wgpu, needs compute | peniko/kurbo/parley/glifo; glyph caching still open | analytic, multiple `AaConfig`; known conflation artifacts | **None** — `RenderParams` has no damage concept | pure Rust + WGSL | Self-described alpha; **moved to `research/`** | Rejected: alpha + no damage + compute requirement |
| `vello_gpu` (ex-`vello_hybrid`) | 0.3.0 (2026-10-02) | Apache-2.0 OR MIT | wgpu (no compute) + WebGL2 | `glyph_run`; caching experimental | Sparse Strips | Not documented | pure Rust | "less mature than Vello CPU"; ~9.6 k downloads | **Rejected: mask layers, complex filter graphs, and certain non-isolated blend modes panic.** A design tool with first-class masking cannot ship on that |
| `vello_cpu` | 0.3.0 (2026-10-02) | Apache-2.0 OR MIT | CPU + SIMD | same stack | `u8` vs `f32` pipeline | Not documented | pure Rust | Linebender's own "most mature" | A plausible CPU replacement for the Canvas2D replay; does not answer "natively GPU" |
| `skia-safe` / `skia-bindings` | 0.153.3 (2026-09-04) | MIT (bindings) | Vulkan, Metal, GL, D3D12 | full SkParagraph | reference-quality; **the only rasterizer whose semantics match Canvas2D** | region/clip machinery | **19–24 MB prebuilt per target**, downloaded at build time; needs glibc ≥ 2.31 or a full LLVM/Ninja build | maintained, frequent releases | Strongest if exact Canvas2D agreement becomes binding. Rejected here on payload, second build system, and because it does not address presentation |
| `tiny-skia` | 0.12.0 | BSD-3-Clause | CPU | no shaping | good AA | — | small | slow cadence | Not a GPU story |
| `lyon` | 1.0.19 | MIT OR Apache-2.0 | **tessellation only** | none | AA is the caller's problem | — | small | stable | Rejected: a tessellator, not a renderer; fill rules, AA, isolation, and damage would all still be ours |
| raw wgpu + signed-fan stencil | wgpu 30.0.1 | — | Vulkan/Metal/DX12 | must be added | ours | **Yes** — full control | pure Rust | — | **Chosen** |

`pathfinder` was checked and excluded: last release 2019-07-06, repository field
pointing at a fork. It is not a 2026 option.

### 5.3 Native embedding, per platform

**Tauri 2 (2.12.2) gives no composited-native-surface API.** `tauri#15213`
("[feat] Tauri + WGPU", open, 1 comment) — a maintainer points at the `unstable`
feature as the prerequisite and at a third-party example as proof that raw wgpu
on the window already works; an HTML-element API is not planned.
`tauri#9220` (closed **not planned**) — the wgpu surface and the GTK/WebKit
compositor fight over the same surface, producing flicker; the maintainer's
explanation is that Tauri must use GTK for webviews. `tauri#8246` — the same
maintainer's own suggestion is the workaround: a `gtk::Fixed` with webviews on
top of a `gtk::GLArea`, "the only problem here is that you will do the drawing
yourself". `discussions#11944` (unanswered, last activity 2026-09-03) — the
community state of the art: macOS solved by a third-party plugin, Windows solved
by a different third-party implementation with its own child HWND, and **Linux
reported unsolvable for the overlay goal** (that conclusion is about Steam
overlay injection into a CEF app, so it is strong evidence about overlays and
weak evidence about the GTK-widget-sibling approach).

Verified in the local registry: `Window::default_vbox()` and `gtk_window()` are
**not** feature-gated; `Window::add_child` **is** (`all(desktop, feature =
"unstable")`). wry 0.57.0 packs the webview into that `gtk::Box` and calls
`CreateCoreWebView2Controller` (child-HWND hosting, not the composition
controller) on Windows.

| Platform | Status 2026 | Strongest objection |
|---|---|---|
| Linux / Wayland | No proven route. wgpu 30 has no Linux compositor-handoff target; WebKitGTK compiles no WebGPU; a `wl_subsurface` handed to Vulkan is technically acceptable but input region, z-order, and frame-callback pacing are unverified and there is no published precedent inside a GTK3/Tauri app | The one cheap experiment (a `gtk::Overlay` + `gtk::GLArea` spike) is unrun, and wgpu would additionally need the `gles` feature plus a way to adopt an existing EGL context, which was not verified |
| Linux / X11 | A child X11 window under a GTK window is possible but the maintainer calls it "a bit hacky" | It does not help the primary Wayland session |
| Windows / WebView2 | A third-party implementation ships: own child HWND, sized after the window is real, click-through, transparent clear, present at vsync. Verified on Windows 11; Windows 10 unconfirmed | wry uses the child-HWND hosting model, and WebView2 creates no D3D device in the application process, so a swapchain cannot be shared with webview content |
| macOS / WKWebView | Two independent shipped implementations. The recipe: transparent webview, a `CAMetalLayer` at `zPosition = -1000`, sibling `CALayer`s at `zPosition = 1000`, because a `CAMetalLayer` used as a view's backing layer ignores `NSView` z-ordering | Transparent-window and bundled-build behaviour has open reports; App Store/notarization impact **not verified** |

**Conclusion recorded in ADR-0244:** native presentation is a platform problem
that is unsolved on the primary development platform, with three named spikes
that would settle it. It is not claimed, and no browser rendering or compute
acceleration is renamed to cover for it.

### 5.4 Browser WebGPU reality

| Engine | `navigator.gpu` | Notes |
|---|---|---|
| Chrome desktop | **144** (was 113 with `partial_implementation`) | 144 adds "Linux (Intel Gen12+ GPUs only)". Earlier entries: ChromeOS, macOS, Windows only. |
| Edge / WebView2 | mirrors Chrome | |
| Firefox desktop | **141**, partial | Windows since 141; macOS Apple-silicon since 145/147; **"Does not support Linux"** |
| Safari | **26** | |
| **WebKitGTK** | **No BCD entry at all**, and no WebGPU in the port | See below |
| OffscreenCanvas WebGPU | Chrome 144 / Firefox 141 / Safari 26 | WebGL2 workers are broadly available; WebGPU workers are not |

**WebKitGTK does not ship WebGPU**, in 2.52 (Varve's pinned version) or 2.54.
Three independent negatives: `ENABLE_WEBGPU` is `PRIVATE OFF` in
`WebKitFeatures.cmake`; a case-insensitive search for `webgpu` in
`OptionsGTK.cmake`, `OptionsCommon.cmake`, and `OptionsWPE.cmake` returns zero
matches; and WebGPU is absent from the 2.54 shipped-features list. The preference
`WebGPUEnabled` defaults to `false` unless the build defines
`WEBGPU_BY_DEFAULT`, and it is force-disabled in Lockdown Mode. Caveat: GitHub
code search for that define returned 401, so a distro build is not ruled out —
but even then the preference would still default to false.

`GPUCanvasContext.configure()`: `alphaMode` `"opaque"` (default) or
`"premultiplied"`; `colorSpace` `"srgb"` (default) or `"display-p3"`;
`format` required (`bgra8unorm`, `rgba8unorm`, `rgba16float`); `toneMapping`
`"standard"` or `"extended"`; and **calling it clears the canvas to transparent
black**, so it is not a per-frame call.

`GPUDevice.lost`: `requestDevice()` can resolve to an already-lost device; many
loss causes are transient and a new device should be requested unless the loss
was caused by `destroy()`; **all resources from the old device must be
re-created**; and a `GPUAdapter` whose physical GPU is unplugged "will always
return already-lost devices".

Damage under WebGPU: `setScissorRect` exists, but there is no damage-rect
concept and no `DontCare` load op (`loadOp` is `"load"` or `"clear"`;
`TRANSIENT_ATTACHMENT` forbids loading and is rejected by `configure()`). The
workable incremental strategy is a persistent offscreen scene texture updated by
damage and then loaded/scissored into the swapchain — which reduces draw work but
does not remove the need to produce and present a fresh image every frame. This
is a real capability difference from native wgpu, which has `LoadOp::DontCare`
and `StoreOp::Discard` behind an explicit unsafe token.

---

## 6. What this research changed in the implementation

| Finding | Change |
|---|---|
| 2.1 recoverable errors → permanent fault | `RenderError` classification, `RenderHealth` with bounded retry and explicit reset |
| 2.2 timeout read as loss | `Timeout` is a distinct, non-fatal variant; the staging buffer is destroyed to cancel the pending map |
| 2.3 stale pixels on partial surfaces | Every frame clears colour and stencil; no incremental path exists; a device-level regression test pins it |
| 2.5a FXC rejects runtime-indexed vector writes | Authoring constraint stated at the top of `shape.wgsl`; no dynamic vector lane writes anywhere |
| 2.5c slow pipeline creation | All pipelines created once at init, inside a validation error scope |
| 2.6 tolerance at discontinuities | Exact-equality assertions for solid fills; no gradients/thresholds admitted |
| 2.7 shared-vector component writes | No workgroup shared memory in the stage at all |
| 2.10 preflight | Extent preflight against `max_texture_dimension_2d`; plan bounded by item and vertex counts |
| 2.12 `poll` on a lost device panics | `device_is_lost()` checked before submission, after submission, and before the poll; no polling `Drop` |
| 5.3 no Linux compositor handoff | Native presentation recorded as blocked with three named spikes, not attempted |

## 7. What was NOT verified

- Attachment images for any issue.
- The full WebKitGTK API reference, so "no embedder-facing native GPU child
  surface API exists" is **not found**, not proven absent.
- Whether a distro WebKitGTK build enables WebGPU.
- Whether `gtk::Overlay` + `gtk::GLArea` works above a `WebKitWebView` **on
  Wayland**. This is the single cheapest experiment that would move the Linux
  presentation question, and it is unrun.
- Whether wgpu 30 can adopt a `GtkGLArea`'s EGL context.
- macOS App Store / notarization impact of a `CAMetalLayer` sibling view.
- Chromium-on-Linux WebGPU flag requirements before Chrome 144.
- Whether WebGPU guarantees swapchain texture contents persist between presents
  (so the damage strategy above is described conservatively).
- Whether `effectcraft` PR #1571 passes CI (`mergeable_state: "dirty"`), and the
  two upstream wgpu-hal issues it cites.
- Any release artifact containing a given merged fix; "fixed on main" claims are
  the maintainers' own words in the threads.
