# Image enhancement system

Varve presents image restoration and super-resolution as one user workflow:
`Image → Enhance…`. Internally, the operations remain distinct so a model is
never selected by a marketing label or architecture family alone.

```text
Enhance dialog (presets + Auto / Recommended + manual operations)
    ↓
RestorationRequest
    ↓
planRestoration (task + capability validation, no model load)
    ├── denoise → SCUNet through the shared native/worker provider chain
    ├── deblur → NAFNet-GoPro-width64 (validated, shipped)
    ├── compression restoration → unavailable (no model passed the corpus)
    └── upscale → Real-ESRGAN or bounded CPU/pixel-art scaling
    ↓
runRestoration (lazy dispatch, cancellation, stage timings)
    ↓
materialized image result → one document mutation / one undo entry
```

## Current capabilities

The canonical capability inventory is `packages/engine/src/restoration.ts`.
The shipped AI capabilities are:

- `scunet`: real-world RGB denoising, Apache-2.0, ONNX. Padding must be a
  multiple of 64 (the conversion's baked attention reshape crashes
  otherwise — corrected 2026-08-13; the manifest previously claimed 8).
- `nafnet-deblur-gopro`: NAFNet-GoPro-width64 deblurring, MIT, ONNX fp16
  (138 MB single file, dynamic shape, BGR boundary swap). Reproducible
  conversion + parity evidence in `tools/nafnet-export/`; artifact hosted
  on the `varve-models-v1` GitHub release with a pinned SHA-256.
- `upscale-realesr-general`: Real-ESRGAN general x4 super-resolution, ONNX,
  using the worker's 256px core / 32px padding tile provider.
- `upscale-realesrgan-anime`: experimental optional anime-oriented x4 artifact.
  Its SHA-256 and RGB/4x tensor contract are checked, and a synthetic
  single-threaded browser-WASM smoke passed. Conversion provenance and
  converted-artifact distribution review remain pending; the artist-quality
  corpus gate is not passed. A 320×320 tile measured 1.459 GB RSS and 112.8 s
  on one x86_64 host. The 1.6 GB model admission estimate includes headroom;
  whole-output allocation is additional. The UI keeps this mode unavailable
  until the pending reviews and corpus tests are complete, and never silently
  substitutes the general checkpoint.

JPEG artifact removal is represented as a user operation but is rejected by
both planner (`planRestoration` throws `unsupported-operation`) and dispatch
(`dispatchRestorationTask` throws even if the planner is bypassed): no model
passed Varve's design-content corpus (SCUNet destroys 1px line patterns and
harms UI screenshots; the only NAFNet checkpoint trained with JPEG was
rejected on state-dict provenance). SCUNet is never advertised as a
JPEG-specific model. A new checkpoint must provide task provenance,
licensing, hashes, conversion details, and Varve corpus evidence before it
is added.

**Candidate:** FBCNN (Jiang et al., ICCV 2021, Apache-2.0) is the leading
candidate for future JPEG artifact removal. It is a flexible blind CNN that
predicts the JPEG quality factor and embeds it into the reconstructor for
configurable restoration strength (~6.7 MB, pixel-domain, no DCT access
needed). OpenVINO model zoo has a pre-exported version. To enable it:
1. Convert to ONNX with verified SHA-256 (tools/fbcnn-export/).
2. Run the design-content corpus (tests/fixtures/restore-corpus/) and
   measure PSNR on JPEG-degraded fixtures.
3. Verify it does not destroy 1px lines, text edges, or UI screenshots.
4. Only then add a `compression-restoration` capability with
   `status: 'available'` and enable the UI option.

Scale semantics:
the Real-ESRGAN model is fixed 4×. A request for 2×/3× via AI is served as
**AI 4× → high-quality lanczos3 downsample** to the exact target size
(`restorationPipeline.ts`, `enhancementPipeline.ts`). This honest pipeline is
documented in the dialog's output hint and avoids claiming variable-scale
super-resolution.

## Execution and compatibility

`runRestoration` composes stages and reuses one shared restoration core
(`restorationProviders/`): a single native→worker provider chain, one
tiled orchestrator with task-aware tile policy, and model adapters that
own channel order (NAFNet is BGR-trained; SCUNet RGB) and padding. The
legacy `dispatchDenoise` API remains as a compatibility wrapper, and
`upscaleSelectedImage` callers keep working; `operation` is optional and
activates the unified planner when present.

Native and worker SCUNet preprocessing are intentionally equivalent: both
repeat edge pixels to the next graph-safe multiple of 64, then crop the
top-left output back to the source dimensions. Native inference must not use
resampling for this padding because it changes thin lines and alpha edges.

Deblur tiling is adaptive (single-shot up to 1280 px, then 1280/256):
NAFNet's global receptive field makes small tiles visibly seamed
(34 dB tiled-vs-whole at 768/128 on a 1536 px image vs 60 dB single-shot).
Deblur has its own user-controllable strength (Light 0.3 / Medium 0.5 /
Strong 0.7 / Maximum 0.9) exposed as a segmented control when the
operation is Deblur or Deblur-Upscale. For backward compatibility, the
pipeline falls back to the denoise-mapped value when `deblur.strength` is
not set.

Large restoration jobs do not preprocess a full-frame model tensor before
choosing the tile path, and weighted tile recomposition accumulates results as
tiles complete instead of retaining every padded tile buffer. Model-specific
adapters still apply their own graph alignment (SCUNet 64, NAFNet 16) after
any bounded dimension reduction.

Preview is honest: a focused crop of up to 512 px on the long edge is enhanced
with the *same* preprocessing, model, and postprocessing as the final job. The
crop **keeps the source aspect ratio** — it is fitted inside the budget rather
than clamped to it on each axis, which used to turn any oversized source into a
square window that matched neither the photo's framing nor the requested output.
The left side is the untouched source crop and the right side is the actual
requested output; the
source is not independently upscaled with a classical filter, which previously
made CPU previews look identical on some images. The split slider clips the
enhanced output from the right, is keyboard-accessible (← →, Shift+← →,
Home/End), and the divider sits on exactly the clip boundary it reveals — the
clip inset and the handle are both derived from one split value, so they cannot
drift apart away from 50%.
An **Inspect region** control chooses which part of the image to preview
(centre by default): a compact `Select` on the hint line under the stage, with
a **navigator** beside it showing the whole source and the computed window
drawn over it. The control's description names the region and the source pixels
it covers (for example *Center · 144 x 256 px of 476 x 848 px*, or *Whole
image* when the source already fits the budget).

The navigator is why the control reads at all. A bounded crop keeps the source
aspect ratio, so at Fit every region is the same size and shape as the whole —
without a picture of the source and a window on it, a crop is indistinguishable
from the full image and moving the region looks like nothing happened.
Re-cropping the comparison is a visible choice, not a silent one. The dialog
defaults CPU upscale to Lanczos-3 “Quality” so
edge contrast remains inspectable; Catmull–Rom “Balanced” remains available
when smoother photographic resampling is preferred. Pixel-art previews use
nearest-style display treatment.
AI preview generation is explicit because model work is expensive and can
otherwise compete with an apply job. Changing preview inputs cancels and
invalidates the previous request, so stale output cannot overwrite the current
settings. No browser-bilinear comparison is used.

### Preview viewport contract

`UpscalePreviewPanel` owns the comparison viewport with the same contract
Effect Studio uses, so the two surfaces read identically:

- **Before / After / Compare** are explicit view modes rather than a single
  always-on split. Selecting After reveals the processed half across the whole
  stage and drops the divider; Compare restores it.
- The view selection is the *user's intent* and is deliberately kept separate
  from what currently has pixels. After and Compare stay selectable while a
  preview is generating or has failed, so the pending, generating, or failed
  notice is reachable instead of being hidden behind a disabled control. Only
  a missing source image disables Before.
- Before a processed result exists the panel renders a text notice — never an
  `<img>` carrying the "Enhanced" label. A dimmed placeholder presented as
  processed output is the specific failure this rule prevents.
- **Fit / 100% / 200%** are explicit zoom modes plus a **Center** action. Fit
  is the bounded review area and never touches the document or canvas camera;
  100% is one CSS pixel per encoded preview pixel and 200% doubles it. Zoom is
  display-only and never changes the pixels the pipeline produced.
- **Fit is measured against the stage, not assumed.** The stage has a definite
  height and a `ResizeObserver` reports its box, so Fit scales on both axes
  from what is actually available and the bitmap keeps its true aspect at every
  window size. Nothing clamps one axis after the fact — a height-only clamp is
  what used to squash any source on a window shorter than about 966 px.
  The stage is drawn as a recessed well so an aspect that does not fill it
  reads as letterboxing rather than as unused dialog. The stage's height is
  whatever the preview column has left after its toolbar and footer
  (`flex: 1 1 0`, floor `10rem`), and the column is bounded by the dialog — see
  the next bullet — so it never resolves from the bitmap and the fit
  measurement keeps its definite box.
- **The workbench is bounded, so the preview is never cut off.** The dialog has
  a definite window-derived height and its shared body is a one-row grid whose
  row is exactly the visible body height, so the preview column (stage, hint,
  navigator, Inspect region) is always entirely on screen. When the settings do
  not fit, the **settings column is the one scroller** and the preview stays put
  — a setting can be changed and its effect watched in the same glance. Edge
  shadows appear only over content that is actually hidden. At full-HD nothing
  scrolls at all. Below 860 px wide or 520 px tall two bounded panes no longer
  fit, so they stack and the shared body becomes the single scroller (the stage
  takes a definite `clamp(14rem, 55vh, 32rem)` height there). The earlier
  content-derived height let the preview grow to the settings column's height
  and slide under the dialog footer on any window shorter than the settings
  (hint and Inspect region unreachable at 1918×729).
- **Geometry does not move while a preview regenerates.** The stage's reference
  size comes from the preview *region* and scale, never from whether the pixels
  have arrived (the earlier whole-source fallback resized the stage twice per
  change and re-centred a zoomed pan). A queued request reports "Generating
  preview…" from the moment its inputs change — through the 250 ms debounce too
  — so the pending notice never claims "No processed preview yet" for a preview
  that was requested, not failed. "Generating preview…" is a badge over the
  stage, not a row beneath it, so it costs the stage no height.
- **Inspect region** sits on the hint line under the stage, beside a navigator
  of the whole source with the computed window over it, rather than occupying
  its own row above the stage — where it read as an unexplained keypad and cost
  a screen-line of modal height.
- At 100% and 200% the stage keeps its size and the bitmap pans *inside* it
  (drag, wheel, scrollbars, or arrow keys once focused); a surface smaller than
  the stage is centred, and Center restores the origin. Dragging pans in Before
  and After (`usePanOnDrag`, so the grab cursor is honest); while comparing,
  drag stays reserved for the before/after split, which is the established
  Enhance gesture, and the wheel, scrollbars and keys pan instead. A change to a
  setting that does not alter the geometry leaves the pan where it was.
- A failed preview sets a visible error with **Retry preview** rather than
  logging to the console and leaving a stale frame.

An explicit `Denoise → None` is a no-op. It is different from an omitted
strength (legacy callers keep the medium default) and from a selected light,
medium, or strong stage. The planner removes the no-op stage before model
readiness or execution, so choosing None cannot silently load SCUNet.

The shared `estimateRestorationMemory()` contract is used for admission and
the dialog's resource warning. It includes the decoded source, current and
next frame buffers, fixed-scale AI intermediate output, resize staging, and
declared runtime peaks for all models in the request. It is intentionally a
conservative upper bound because model sessions may remain cached; it is not
presented as an exact allocator measurement.

Each completed stage records the provider that actually won fallback
resolution (for example native, worker, or direct CPU) alongside its selected
model id. The aggregate provider field remains for compatibility, but callers
that need provenance should read the stage records.

Alpha is carried separately by both restoration paths, and pixel-art
scaling stays on its specialized algorithm path rather than entering photo
restoration. The `restorationAuto` heuristic adds a conservative
pixel-art hint (≤128 px short edge, ≤32 colours) that surfaces as
“consider Pixel Art mode” without overriding the resolution recommendation.

The default output is a new derived image layer. Replace-source remains
atomic and undoable. The existing persisted derived-output metadata is kept
for compatibility; it must not be described as re-editable non-destructive
restoration until the document model can replay the operation across model
revisions.

The frontend exposes reviewed presets for Auto, fast CPU preview, photo cleanup
and AI upscale, illustration/anime, pixel art, denoise-only, deblur-only, and
Deblur + Upscale. Presets set processing controls only; output behavior is
preserved. Any manual processing change marks the selection as Custom, and the
primary action label follows the concrete operation (`Denoise image`, `Deblur
and upscale`, `Upscale with AI`, and so on). This keeps the operation menu,
visible controls, and commit action synchronized.

## Model management and supply chain

Model downloads continue to use the verified manifest and existing model
loader. Models are task-specific and lazy: selecting Denoise requests
SCUNet, selecting Deblur requests the NAFNet checkpoint, and selecting CPU
Upscale requests nothing. A split model is not ready until both its ONNX
graph and declared external-weights sidecar are present; the graph checksum
is verified before it is handed to the runtime. The Enhance dialog waits for
this asynchronous readiness check before enabling Apply, and an explicit
Denoise → None skips model readiness entirely. Large weights are not
committed to Git — the 138 MB deblur artifact ships as a release asset
with a pinned hash.

The standalone Real-ESRGAN web worker uses the same single-threaded WASM
runtime policy as the shared inference worker. ORT's pthread pool could leave
Chromium/headless session creation pending; the worker already provides
isolation, so forcing one WASM thread avoids that deadlock while preserving
the local model path.

## Auto / Recommended mode

`packages/engine/src/restorationAuto.ts` runs a cheap classical analysis
(Laplacian-MAD noise, Laplacian-variance blur, 8px-grid blockiness,
resolution) and proposes an operation in human terms with an internal,
uncalibrated signal score. No neural classifier gates which neural model
loads. Below 96 px
short edge, noise/blur signals are suppressed (only resolution matters) to
avoid flagging icons as noisy. A compression-restoration suggestion is
never silently substituted: the dialog explains the operation is
unavailable and offers the closest validated operation instead. Limited
palette on small images surfaces a pixel-art hint. The UI presents only a
qualitative signal label, not that internal score as a probability.

Progress and errors in the Enhance dialog are stage-aware (`Denoise` →
`Upscale` etc. with ✓/•) and typed (`model-not-installed` offers Download,
`hash-mismatch` Re-download, `dimension-limit`/`tensor-allocation` suggest a
smaller scale, `stale-result` explains source changed). Cancellation and
stale-job protection (revision check before commit) are enforced so a
preview cannot clobber an in-flight Apply.

## Validation policy

Fast validation covers planner contracts, mocked providers, alpha/dimension
goldens, cancellation, preview bounds, tile-blend regressions, and editor
behavior. Real-model quality and performance belong to the opt-in
corpus/benchmark lane: `scripts/bench/restore-reference/` (deterministic
degradation corpus, TS-exact ORT runners, contact sheets) and
`tools/nafnet-export/` (conversion + parity gate). Measured results live in
[`docs/quality/image-enhancement-benchmark.md`](../quality/image-enhancement-benchmark.md);
deblur quality claims are anchored to that run, not to academic numbers.

See also:

- [`docs/architecture/onnx-inference-architecture.md`](onnx-inference-architecture.md)
- [`docs/testing/real-image-validation-corpus.md`](../testing/real-image-validation-corpus.md)
- [`docs/quality/validation-strategy.md`](../quality/validation-strategy.md)
- [`docs/audits/image-modals-preview-review-2026-10-26.md`](../audits/image-modals-preview-review-2026-10-26.md)
  — preview reliability defects fixed in the Enhance/Vectorize modals and the
  research record behind the preview-first composition.
