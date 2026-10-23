# Derived-work admission defect — AI features refused on capable hosts (2026-10-22)

Status: fixed, with regression coverage. Follow-up work listed at the end.

## Symptom

Selecting an image, choosing **High quality** background removal, and pressing
Apply failed before any model loaded. The Inspector printed:

```
Request reserves 541786112 bytes, above the 400000000-byte process limit.
```

The same shape of refusal applied to every local AI path whose declared working
set exceeded 400 MB: **AI Quality** background removal always, **AI Balanced**
on large photographs, and **Generative Edit** (its reservation includes a 6 GB
native model minimum) always. Users saw a byte count with no cause and no
action.

## Arithmetic (why the numbers are exactly what they are)

The request came from `packages/engine/src/backgroundRemoval/providers/dispatch.ts`:

```
modelBytes  = 512 MiB                     = 536,870,912
frame       = 480 x 640 x 4 (RGBA)         =   1,228,800
reservation = modelBytes + frame * 4      = 541,786,112
```

`541786112` is the reported figure to the byte, and `480 x 640` is the selected
image's size in the document. The failing ceiling, `400000000`, is
`DERIVED_WORK_MEMORY_LIMITS['unknown-or-4gb']` in
`packages/platform/src/derivedWorkAdmission.ts`.

## Root cause

Commit `0112de9a8` ("feat: share byte admission across local work") moved
inference onto the process-wide derived-work ledger. Before it,
`InferenceAdmission` defaulted `maxReservedBytes` to `Infinity`. After it, the
shared gate has a fixed ceiling and nothing in production ever changed it:

- `400_000_000` for the default `unknown-or-4gb` profile;
- `600_000_000` for the `reference-8gb` profile, which was only ever selected by
  tests (`setDerivedWorkMemoryProfile` has no production caller).

Two independent mistakes compounded:

1. **The ceiling never learned how much memory the host has.** WebKitGTK — the
   engine the desktop app runs — does not expose `navigator.deviceMemory`, so
   every desktop session would have kept the placeholder even if something had
   read it.
2. **The reservation was a magic constant unrelated to the model.** 512 MiB was
   charged for a 224 MB BiRefNet Lite artifact, 128 MiB for the 179 MB IS-Net
   model (an under-reservation), and the user's explicit model choice was
   ignored.

The gate also reported the refusal as a byte count, which reached the UI because
`normalizeErrorMessage` in `BackgroundRemovalSection.tsx` did not recognise the
`insufficient-memory` / `memory-limit` codes.

## Fix

1. **Host-derived ceiling** (`packages/platform/src/hostMemory.ts`).
   `host_memory_status` (new Tauri command, reusing the measured
   `MemAvailable`/cgroup reader in `generative_resources.rs`) reports available
   bytes on desktop; a browser falls back to half of `navigator.deviceMemory`.
   The ceiling is `clamp(available - 2 GB, 400 MB, 16 GB)`. 400 MB is unchanged
   as the floor for a host that reports nothing.
2. **Boot measurement** (`initializeDerivedWorkBudget()`), awaited in
   `apps/desktop/src/main.tsx` before the first render, plus a lazy probe from
   `getDerivedWorkAdmission()` so a surface that starts earlier still converges.
   Snapshots now report `budgetSource` (`host-measured`, `host-estimated`,
   `conservative-default`, `reference-profile`, `explicit`).
3. **Honest reservations.** Background removal derives its ledger allowance from
   the catalog entry of the model that will load (weights x2, floored at
   128 MiB). The fit decision stays where it belongs: the WASM/runtime
   assessment for browser execution and the OS/cgroup preflight for native.
4. **Actionable refusals.** A capacity refusal on `ai-quality` retries the
   bundled `ai-balanced` model, mirroring the existing provider-failure
   fallback; an explicit `modelId` is honoured exactly. The UI maps the refusal
   codes to plain language, and the platform message now includes MB/GiB plus
   the provenance of the budget.

## Entry-point audit

Every registered caller of the shared ledger, and what the fix means for it:

| Entry point | Reservation source | Before | After |
|---|---|---|---|
| Background removal — Quick | none (heuristic) | worked | unchanged |
| Background removal — Auto (`ai-balanced`) | catalog weights x2 + 4x frame | refused above ~17 MP | admitted; large images on small hosts fall through to the reduced path |
| Background removal — High quality (`ai-quality`) | catalog weights x2 + 4x frame | **always refused** | admitted on measured hosts, auto-reduced on small ones |
| Background removal — Portrait (MODNet) | catalog weights x2 + 4x frame | worked on small images | unchanged behaviour, honest estimate |
| Batch background removal | same dispatch path | same failures | same fix, no separate policy |
| Generative Edit (native diffusion) | native model minimum + frame | **always refused** | admitted when the measured budget covers it; the native preflight remains authoritative |
| Content-aware Fill (LaMa) | 4x frame only | worked | unchanged |
| Object Selection (SAM2 / MobileSAM) | routed working-set estimate | refused for large sources | admitted on measured hosts; routing still degrades by its own budget |
| Text discovery (OCR) | `estimateInferenceReservation` | refused on low-headroom hosts | admitted on measured hosts; its own refusal copy already existed |
| Image enhancement, denoise, colourisation, trace | native preflight / worker reservation | unaffected by the byte ceiling | unchanged |
| Thumbnails, raster pyramid, effects, exports | derived-work estimates | unaffected by the byte ceiling | unchanged reservations; they now share the gate's single slot with AI work that previously never started, so a long AI run can delay a preview instead of hanging on a refusal |

## Regression coverage

- `packages/platform/src/hostMemory.test.ts` — budget derivation: floor, reserve
  subtraction, cap, integer safety.
- `packages/platform/src/hostMemory.probe.test.ts` — the probe itself: native
  payload, device-memory halving, unavailable host, IPC failure fallback, and a
  malformed payload that must not be trusted.
- `packages/platform/src/derivedWorkAdmission.initialization.test.ts` — the
  wiring: a measurement reaches the process singleton, happens exactly once,
  releases work that was waiting for bytes, preserves an owner-selected profile,
  and restores the lazy path after a test override.
- `packages/platform/src/derivedWorkAdmission.test.ts` — "host-derived budget"
  group: the pre-fix 541,786,112-byte reservation (512 MiB + 4x a 480x640 frame)
  is refused on the unmeasured default and admitted after measurement;
  provenance; non-byte refusal text; resident eviction when a measured budget
  drops.
- `packages/engine/src/backgroundRemoval/__tests__/admissionCapacity.test.ts` —
  ai-quality admitted on a measured budget; the post-fix reservation derived from
  the catalog model (452,925,376 bytes for the same input); capacity refusal
  retries `ai-balanced`; explicit model honoured without substitution and
  without a raw byte count.
- `packages/editor/.../bgRemovalFeatures.test.tsx` — a capacity refusal renders
  as an action, not a byte count.

## Validation performed

- Unit/component: `vitest run` on the six admission suites plus the model
  catalog, settings, and background-removal suites (all pass individually; the
  combined run's ExportDialog/worker timeouts reproduce without this change and
  pass in isolation).
- Typechecks: `@varve/platform`, `@varve/engine`, `@varve/editor`, and
  `pnpm typecheck:e2e`.
- Native: `cargo test --lib` for `host_memory_status` and
  `birefnet_preflight_uses_the_measured_native_peak`; `cargo test -p
  varve-bgremove --features ai --lib` (44 passed).
- Native inference: real runs of both models through `bgremove_bench` against
  the installed artifacts (table above) — this is the "was the model ever
  actually run" evidence, not a mock.
- Browser: `tests/e2e/canvas/bg-removal-capacity.spec.ts` under the heavy lease,
  both tests passing across repeated runs (Auto cutout 34-55 s, panel metadata
  27-38 s; the spread is host load, not behaviour). Screenshots:
  `docs/screenshots/2026-10-22-admission-fix/`.
- Website: `audit:docs` clean; website unit suite passes except
  `pages/features/realtime-collaboration.astro`, an untracked file owned by
  another session.

Recorded honestly:

- Native inference was measured on Linux/x86_64 only. Windows and macOS use the
  same measured table and preflight code, but their RSS was not re-measured.
- BiRefNet **Full** was not re-measured (973 MB artifact not installed here); its
  8.5 GB figure is retained and remains conservative.
- The browser/WASM working set for BiRefNet Lite is still the declared figure,
  not a measurement; a browser run would need a large source and a WASM peak
  capture.

## Native measurement (2026-10-22, this host)

The repo's own harness (`crates/varve-bgremove/examples/bgremove_bench.rs`) was
run against the models already installed for the desktop app, with the bundled
ONNX Runtime (`onnxruntime-libs/linux-x86_64/libonnxruntime.so`, ORT 1.27.1,
CPU EP), the arena/memory-pattern options the app uses, and the 12-image
validation corpus at `--preview-max 1024`.

| Model | Artifact | Peak RSS | Cold run (load + infer) | Provider |
|---|---:|---:|---:|---|
| IS-Net (`isnet-general-use`) | 179 MB | 1.36-1.40 GB | 3.9-4.5 s | native-cpu |
| BiRefNet Lite (`birefnet-general-lite`) | 224 MB | **432 MiB** | 18.5-35.0 s (median 23.2 s) | native-cpu |

**This exposed a second, independent cause of the same symptom.** The native
model table and the TS catalog carried `peak_memory_bytes = 7_000_000_000` for
BiRefNet Lite — a browser/WASM working-set estimate — and the native preflight
compares it against *available* memory. On a host with 6 GB free, High quality
was therefore refused before the model loaded, even though it needs ~0.45 GB.
The shared ledger fix alone would not have made High quality work on an ordinary
8 GB laptop.

Corrected:

- `crates/varve-bgremove/src/model.rs` — native peak for BiRefNet Lite is
  `450_000_000` (measured 432 MiB plus headroom); a regression test bounds it to
  400-500 MiB so the 7 GB figure cannot return.
- `packages/engine/src/inference/modelCatalog.ts` — adds
  `nativePeakMemoryBytes`, keeps `peakMemoryBytes` as the conservative browser
  figure, and exports `resolveModelPeakMemoryBytes(entry, { native })`.
- `apps/desktop/public/models/manifest.json` — records the native peak so the
  desktop build's authoritative manifest carries it.
- Settings (model manager, background-removal and colorisation tabs), the model
  download dialog, and the Inspector now show the runtime-appropriate figure
  instead of "~7 GB" on a desktop that needs half a gigabyte.
- `inference.rs`'s cache-eviction comment no longer claims the 7 GB figure.

The 2026-08-13 parity audit's 6.8 GB retained-RSS reading could not be
reproduced on the current session builder (arena disabled, one model per
process). That reading is retained in the audit as history, not as a live gate.

## Review findings folded in

An independent review of the fix raised six issues that were corrected before
merge:

1. The website implied High quality silently runs Auto when it cannot fit; the
   ~7 GB limit is enforced by the per-operation preflight (which reports the
   shortfall), while Auto substitution only follows a ledger refusal. Copy fixed.
2. The probe and boot wiring had no tests, so reverting them would have gone
   unnoticed. Added `hostMemory.probe.test.ts` and
   `derivedWorkAdmission.initialization.test.ts`.
3. `setDerivedWorkMemoryProfile` and `setHostMemoryBudget` disagreed about what
   counts as owner-configured. A selected profile is now protected, and
   `setDerivedWorkAdmissionForTest(null)` restores the lazy probe instead of
   pinning an unmeasured singleton.
4. The desktop probe reads `window.__TAURI__.core`, which depends on
   `withGlobalTauri`. Documented next to the bridge so a future hardening change
   cannot silently reintroduce the 400 MB floor.
5. Boot awaited an unbounded IPC round trip; it is now bounded to 2 s, after
   which the lazy probe completes the job.
6. A native preflight message containing the word "model" was being rewritten
   as "Model failed to load", and `queue-full` had no user-facing mapping. Both
   are handled.

## Remaining work resolved after review

- **Long AI runs no longer freeze previews.** The gate now separates *heavy*
  work (inference, exports, live effects, model downloads; `maxConcurrent` 1)
  from *speculative* preview work (thumbnails, raster-pyramid tiles, semantic
  indexing; `maxSpeculative` 2). Speculative leases still obey the same byte
  ceiling, so sharing is bounded by memory rather than by assumption. Covered by
  a new "speculative preview work" group in `derivedWorkAdmission.test.ts`.
- **Generative Edit capacity copy** no longer relays the ledger's byte wording;
  it names the action instead.
- **Native inference was measured on this machine** with the bundled ONNX
  Runtime and the user's installed models (see "Native measurement" above).

## Remaining work

- **`birefnet-general` (full) still has a ledger allowance far below its
  measured peak.** It remains gated by the native/WASM preflights rather than by
  the ledger; giving the ledger the full measured peak would refuse every host
  that can actually run it through the native path.
- **Reservations are conservative, not measured, for preview work.** Thumbnails
  and raster-pyramid tiles still reserve zero bytes (pre-existing debt recorded
  in the ONNX architecture note), so their co-residency is bounded by
  `maxSpeculative` and by the schedulers' own concurrency, not by the ledger.
  Wiring a per-tile estimate is the next step.
- **The three BiRefNet peak comments are reconciled in prose, not code.** The
  catalog and native model table agree on ~6.8-7 GB for the native path; the
  896 MB figure in the runtime-capability comment describes a different
  (browser/WASM) context and should eventually be replaced with a measured WASM
  peak rather than retained as a comment.
