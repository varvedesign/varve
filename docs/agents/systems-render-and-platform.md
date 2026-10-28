# Systems: Render and Platform

Durable rendering, platform, and asset-system detail split out of the root
`AGENTS.md` on 2026-10-28. Load this file when working on the engine,
compositor, render worker, WASM, tracing, text, thumbnails, icons, or signing.

## WebGPU + WASM program

| Area | Location |
|---|---|
| Baseline bench + goldens | `packages/engine/src/bench/`, `packages/engine/src/__goldens__/` |
| Compositor | `packages/compositor/` — Canvas2D default; opt-in experimental WebGPU and WebGL2 paths with Canvas2D fallback |
| Render worker | `packages/editor/src/render/` — OffscreenCanvas |
| WASM build | `just wasm-build` → baseline + preferred SIMD artifacts in `apps/desktop/public/wasm/` |
| Architecture docs | `docs/architecture/render-pipeline.md`, `docs/architecture/wasm-backends.md` |

## Canvas System

| Area | Location |
|---|---|
| Camera + floating origin | `packages/shared/src/viewport.ts`, `packages/editor/src/canvas/cameraState.ts` |
| Sticky snap | `packages/editor/src/tools/snapping.ts` |
| Draw hub | `CanvasArea.tsx` |
| Minimap | `components/Minimap/` |
| Collab (stub) | `PresenceIndicator`, `CollabCursorOverlay`, `useCollabPresence` |
| Perf | `canvas10k.bench.test.ts`, `SubtreeReplayCache` |

## Text Pipeline

Multilingual text rendering, shaping, BiDi layout, and export. M1–M8 complete.
See `docs/architecture/text-pipeline.md`.

## Image Trace System

Native raster-to-vector with honest web fallbacks. Canonical docs:
`docs/architecture/image-trace-system.md`, ADR-0170.

| Area | Location |
|---|---|
| Rust engine | `crates/varve-trace/` (contours, pixel_art, centerline, bezier_fit, quantize, hierarchy) |
| Native IPC | `trace_image` / `trace_image_binary` / `begin_trace_job` / `cancel_trace` + `trace:progress` (apps/desktop/src-tauri/src/lib.rs) |
| Provider chain + gating | `packages/engine/src/upscaleProviders/traceDispatch.ts` (native-first under Tauri), `rasterTrace.ts` fallback |
| Dialog/workflow | `packages/editor/src/components/Vectorize/` (presets, preview, complexity estimate, Edit Trace) |
| Insert/re-trace ops | `packages/editor/src/imageOperations.ts` (`insertTraceGroup`, `replaceTraceGroup`) |
| Provenance | `GroupNode.traceMetadata` (schema 2.16) + `packages/editor/src/logo/vectorization/metadata.ts` |
| E2E | `tests/e2e/canvas/image-trace.spec.ts` |

Key rules:
1. Desktop traces MUST prefer the native provider (chain is native-first under
   Tauri); never reorder it behind the TS fallbacks.
2. The wire options contract is camelCase (`rename_all = "camelCase"` in
   `TraceImageOptions`); snake_case keys are silently dropped.
3. Centerline is native-only: TS providers declare it unavailable instead of
   emitting filled silhouettes.
4. Traces are bounded: 128 MB bytes, 64 MPixels, 100 k paths; decode is
   dimension-pre-checked (bomb guard).
5. Trace insertion is one undo entry; re-traces replace the old group in
   place; metadata stores no raster bytes.

## Thumbnail System

Canonical doc: `docs/architecture/thumbnail-system.md`, ADR-0218.

One source of truth for every thumbnail/preview surface (Home cards, page
nav, pages panel, version history, picker). Thumbnails are a **platform
capability**: an explicit subject + source + revision + render profile +
privacy policy + deterministic cache identity.

- Contracts (`ThumbnailSourceSpec`, `ThumbnailVariant` + `THUMBNAIL_VARIANTS`,
  `ThumbnailStatus`, `ThumbnailPolicy`, `computeThumbnailIdentity`,
  `ENCRYPTED_PROJECT_PLACEHOLDER`) live in `packages/shared/src/thumbnail/`.
- Source resolution + automatic heuristic live in
  `packages/scene/src/thumbnail/resolve.ts` (pure, doc-domain).
- Rendering MUST go through `flattenSceneToEngine` (canonical canvas
  conversion) + engine `generateThumbnail`; never hand-roll a mini-renderer
  for covers. Page previews pass `localTransforms: true`.
- Cache keys are identity strings (`thumb:v2:...`), NEVER bare node/page
  ids or bare content hashes. Legacy bare-hash entries are disposable
  warm-migration fallbacks only.
- Scheduling: `ThumbnailScheduler` (concurrency 1, priority, dedupe by key,
  cancellation, stale-job guards). Background thumbnail work must never
  compete with canvas interaction.
- Persistence: `Platform.setThumbnailPreference` (FileEntry metadata, not
  document JSON) + `get/put/delete/evictThumbnail` keyed by identity.
- Generation is editor-owned (save path); Home only loads/displays.
- Encrypted projects: only the content-free placeholder may be stored;
  `clearProjectPreviewData` on the save path; Home forces the placeholder
  for encrypted records.
- UX entry points: File menu "Set File Thumbnail…", canvas context menu
  (Use Selection/Frame as File Thumbnail), page context menu (Use Page as
  File Thumbnail), command palette, `ThumbnailPickerDialog`.
- Legacy `renderThumbnail` (engine `thumbnail.ts`) is deprecated; do not
  add callers.
- Layers 28×28 node previews are a documented simplified node profile (not
  document covers).

## Packages and crates — what each contains

### crates/ (Rust)
| Crate | Status | Contents |
|---|---|---|
| `varve-core` | **Built** | Geometry primitives, `Shape` enum, `SceneNode`, `hit_test()` |
| `varve-engine` | **Built** | `build_render_ir()` — scene → `Vec<RenderItem>` |
| `varve-layout` | Implemented, unwired | Taffy-backed flex/grid/container-query layout with unit tests; no crate depends on it yet — the wired implementation is `@varve/layout` (TS) |
| `varve-sync` | **Built** | SQLite DocumentStore + Tauri IPC |
| `varve-trace` | **Built** | Raster-to-vector tracing: silhouette/centerline/pixel-art modes, Oklab quantization, Bézier fitting, hole pairing, cancellation (`docs/architecture/image-trace-system.md`) |
| `varve-print` | **Built** | lopdf-based PDF export, CMYK/PDF-X, font outlining, ICC profiles, print backends |
| `varve-upscale` | **Built** | Native image upscaling — bicubic CPU + optional ONNX super-resolution |
| `varve-bgremove` | **Built** | Background removal: heuristic non-AI methods + optional ONNX matting |
| `varve-media` | **Built** | Animated-image frame decoding (GIF/APNG/WebP) under allocation bounds; consumed by the desktop app and `varve-wasm` (`docs/architecture/animated-image-media-system.md`) |
| `varve-effects` | **Built** | Native live-effects kernels — deterministic RGBA ports of `packages/engine/src/liveEffects/`; consumed by the desktop `apply_effect` IPC and `varve-wasm` |
| `varve-colour` | **Built** | Colour science: ICC transforms (tintbox), analytical conversion, WASM bindings |
| `varve-bridge` | **Built** | TS wire-format → `varve-core` `SceneNode` conversion (Tauri IPC + WASM) |
| `varve-accel` | **Built** | Native acceleration: capability model, `wgpu` device discovery + bounded self-test, offscreen GPU effect/resample kernels (ADR-0237) |
| `varve-wasm` | **Built** | wasm-bindgen glue for `varve-engine` (web IR build + hit test) |

### packages/ (TypeScript)
| Package | Status | Contents |
|---|---|---|
| `@varve/engine` | **Built** | Engine facade (stub/native/wasm), IR types, `replayIr`, geometry helpers |
| `@varve/scene` | **Built** | Immutable Document model, nodes, ops, master pages, spreads |
| `@varve/ui` | **Built** | Design tokens, icons (Lucide/Phosphor), APG components |
| `@varve/editor` | **Built** | Shell (CSS Grid), EditorProvider, CanvasArea, LayersPanel, InspectorPanel, shortcuts |
| `@varve/codegen` | **Built** | SVG, React, Flutter, SwiftUI code export |
| `@varve/prototype` | **Built** | Prototype engine: triggers, actions, animation, transitions, navigation |
| `@varve/shared` | **Built** | Ordering, debounce, easing, units |
| `@varve/import` | **Built** | SVG/Figma REST JSON/PDF/PSD/AI/EPS/Sketch import parsers |
| `@varve/platform` | **Built** | Platform abstraction (Tauri/web/memory) |
| `@varve/ai` | **Built** | Auto-trace controller and assist orchestrator (on-device + cloud) |
| `@varve/collab` | **Built** | CRDT awareness and reconnect over the varve-sync SQLite core |
| `@varve/compositor` | **Built** | Pluggable render compositor: Canvas2D default; opt-in experimental WebGPU and WebGL2 paths with Canvas2D fallback |
| `@varve/crash` | **Built** | Privacy-first crash reporting and recovery core |
| `@varve/help` | **Built** | Help system documentation and browser |
| `@varve/home` | **Built** | Home/Start surface: recent files, projects, templates, file management |
| `@varve/layout` | **Built** | CSS-native flex/grid layout IR: `computeFlexLayout`, `computeGridLayout`, `reflowLayoutChildren`, `resizeNodeGeometry`, `checkLayoutCycle` (pure, DOM-free; mirroring the `varve-layout` crate) |
| `@varve/print` | **Built** | TS facade for the `varve-print` crate: font outlining, CMYK, PDF/X |
| `@varve/tokens` | **Built** | DTCG design-token engine: parsing, validation, serialization, semantic diff, merge |
| `@varve/history` | **Built** | Persistent revision history: operation log, revision DAG, snapshots, recovery |
| `@varve/cli` | **Built** | Headless tooling: canonicalize, validate, semantic diff, merge driver, review bundles |

### apps/
| App | Status | Contents |
|---|---|---|
| `apps/desktop` | **Built** | Tauri 2 app with Vite+React frontend; `build:try` produces the public browser demo at `/try/` |
| `apps/website` | **Built** | Astro 7 static marketing site, GitHub Pages deploy (see `docs/release/website.md`) |
| `apps/web` | **Scaffold (removed from workspace)** | `@varve/web` — Next.js 15 editor scaffold behind the WASM engine. Removed from `pnpm-workspace.yaml` on 2026-07-12; task 0.9 deferred indefinitely. Only a placeholder `package.json` remains — not a shippable application. |

## Application Icon (cross-platform)

| Asset | Source | Generator | Location |
|---|---|---|---|
| Master art (1024x1024) | `packages/ui/src/icons/varve-app-icon.svg` | — | `apps/desktop/build-icons.sh` (source) |
| Mark-only (no background) | `packages/ui/src/icons/varve-icon.svg` | — | `apps/desktop/public/icons/favicon.svg` |
| Tauri PNGs + .icns + .ico | `varve-app-icon.svg` | `just generate-icons` | `apps/desktop/src-tauri/icons/` |
| Linux hicolor ladder (11 sizes) | `varve-app-icon.svg` | `just generate-icons` | `apps/desktop/src-tauri/icons/hicolor/` (as `dev.varve.desktop.*`) |
| Web/PWA favicons | `varve-icon.svg` + `varve-app-icon.svg` | `just generate-icons` | `apps/desktop/public/icons/` |

### Wayland icon fix
On Wayland, `tauri dev` does not install desktop entries — the compositor
shows a generic fallback icon. The `pretauri:dev` hook runs
`apps/desktop/scripts/install-dev-icons.sh` automatically on Linux:
```bash
just install-dev-icons
```

## Release signing (code-signing pipeline)

Varve's release pipeline verifies signing when configured. Platform signing is
optional unless `RELEASE_EXPECT_SIGNED=true`; unsigned installers may be
published when the policy allows them, and the manifest and download page must
label them truthfully. Canonical docs: `docs/release/README.md` and
`docs/release/signing-decision-record.md`
(strategy + current prices), `docs/release/code-signing-setup.md` (human
acquisition checklist), `docs/release/signing-rotation-runbook.md` and
`docs/release/signing-incident-runbook.md` (procedures).

Rules that must not be violated:
- Signedness in `release-manifest.json` derives ONLY from post-build
  verification reports (`verify-windows-signature.ps1` /
  `verify-macos-signature.sh`), never from secret presence. `signing-policy.mjs`
  encodes the fail-closed policy; `verify-release-trust.mjs` enforces it before
  checksums/attestation/draft.
- When `RELEASE_EXPECT_SIGNED=true`, missing or invalid Windows Authenticode
  and macOS Developer ID/notarization/stapling evidence fail in
  `signing-preflight` BEFORE the platform build starts. With that expectation
  unset, an unsigned release is permitted only when its artifacts and website
  labels say they are unsigned. Updater-feed signatures are a separate trust
  layer and do not mean an installer is platform-signed.
- Windows signing uses Azure Artifact Signing via Tauri `signCommand`
  (artifact-signing-cli 0.11.0). The auth chain is a client secret — OIDC is
  not supported by that tool; do not invent a replacement wrapper without
  re-checking official docs.
- macOS uses Developer ID Application (never Apple Development/Distribution);
  the identity string is matched exactly.
- Tauri updater keys are separate from all platform-signing material; updater
  signatures never imply Authenticode or Apple notarization.
