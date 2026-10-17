# WASM Backend Architecture

**Updated:** 2026-07-08

## Purpose

Share Rust scene computation (`varve-core`, `varve-engine`, `varve-layout`, `varve-trace`) with the web target via wasm-pack, behind the same `@varve/engine` facade as Tauri native IPC.

Desktop keeps the **native wedge** (ADR-0001): document state in unbounded native memory; WASM is for browser deployment and optional worker acceleration.

## Crate Matrix

| Crate | WASM build | Notes |
|---|---|---|
| `varve-core` | Yes | Geometry, scene, hit_test |
| `varve-engine` | Yes | `build_render_ir` |
| `varve-layout` | Yes | Flex/grid layout parity |
| `varve-trace` | Yes | Auto-trace (Potrace-class) |
| `varve-wasm` | Yes | wasm-bindgen glue crate |
| `varve-sync` | No | SQLite |
| `varve-bgremove` | No | Native ORT; browser uses onnxruntime-web |

## Feature Variants

| Artifact | Flags | Use when |
|---|---|---|
| `varve_wasm_simd_bg.wasm` | `+simd128`, wasm-opt -O3 | **Preferred** — SIMD-capable browsers |
| `varve_wasm_bg.wasm` | baseline, wasm-opt -O3 | Fallback when SIMD artifact absent |
| `varve_engine_threads.wasm` | `+atomics,+bulk-memory` | Not buildable on stable (needs nightly `-Z build-std`); WebKitGTK 2.52 has no `SharedArrayBuffer` even with COOP/COEP (deferred) |

**Threading reality check (2026-07-11):** nothing in this repo uses `SharedArrayBuffer`,
`rayon`, or `wasm-bindgen-rayon` today — the `simd128` variant above is single-threaded
lane parallelism and needs neither shared memory nor cross-origin isolation. Tauri's
`apps/desktop/src-tauri/tauri.conf.json` currently sets `"csp": null` (no COOP/COEP
equivalent configured), which is fine while nothing requests threading — but whoever
picks up `varve_engine_threads.wasm` needs to verify Tauri's webview shell actually
satisfies `SharedArrayBuffer` availability before relying on it; the COOP/COEP mental
model is browser-tab-shaped and doesn't necessarily map 1:1 onto a Tauri webview.

Runtime selection (updated 2026-10-16): `wasmArtifactCandidates()` returns
`['simd','baseline']` only after the engine validated a `v128` module
(`WebAssembly.validate` on a 74-byte probe), otherwise `['baseline']` alone —
the SIMD binary is never fetched, instantiated or reported on an engine that
cannot run it. `getWasmEngineAttribution()` reports which artifact actually
loaded, its version, the candidate that was skipped, and the bounded
stage/reason of each failed attempt (`head` / `glue` / `instantiate`).
`setWasmArtifactPreference('baseline')` forces the baseline artifact for A/B.
`prewarmWasmEngine()` instantiates during idle via `requestIdleCallback`.
Diagnostics: Settings > Performance > Platform capability report, and
`window.__varvePerf.renderPath()` under `?perf=1`.

**What the SIMD artifact does not do (verified 2026-10-16):** `varve-wasm`
exports only IR build, hit test, contour trace and media probe, with a JSON
string boundary for IR and hit test. It contains no raster pixel kernels, and
`varve-effects` is not a dependency of `varve-wasm`. The CPU raster kernels
(blur, compositing) are TypeScript. rayon appears in the WASM dependency tree
through `varve-trace` but nothing runs threaded there. (The native desktop
effect kernels are different: they take bounded row-band threads, see
`live-effects-system.md` and ADR-0241 D6.)

**The SIMD artifact is vectorized but not measurably faster (verified
2026-10-16):** `just verify-wasm-simd` disassembles the shipped binaries —
baseline 0 vector instructions, SIMD 6,126, colour 0 — so `+simd128` did
produce real `v128` code. `just bench-wasm` then runs both on the exported work
with interleaved A/B and byte-equality checks: IR JSON and trace output are
identical, and latency is 0.97x-1.08x across 200/600/2000 nodes (i.e. no gain;
the serde JSON boundary dominates). No SIMD acceleration is claimed for canvas
rendering, and no SIMD colour artifact is built. Full numbers, method and limits:
`docs/perf/2026-10-16-wasm-simd-capability.md`.

## API Boundary

Coarse scene-level calls only (avoid per-node WASM transitions):

- `build_ir(nodes_json: string) -> Uint8Array`
- `hit_test(nodes_json: string, x: f64, y: f64) -> i32`

## Offline Asset Policy

- WASM modules ship in app bundle (`apps/desktop/public/wasm/`). `ci.yml` runs `just wasm-build-all` (base + SIMD) and passes artifacts to E2E. **`build.yml`** (the actual release-packaging workflow) previously built no WASM at all — the gitignored output directory was simply empty on a clean checkout, so every packaged release silently shipped with the JS-only engine. Fixed 2026-07-11: `build.yml` now has a `build-wasm` job (`wasm-build-all`, once on Linux) whose artifact every OS's release job downloads before `pnpm build`.
- ONNX models use `manifest.json` with SHA-256 verification via `ModelLoader`. No `.onnx` binaries are committed yet (`bundled: false`); users download explicitly from settings (ADR-0005).
- `varve-layout` / `varve-trace` WASM bindings remain deferred stubs.

## Build

```bash
just wasm-build          # baseline + preferred SIMD engine artifact
cargo test --target wasm32-unknown-unknown --workspace
```

## Failure Handling

| Failure | Fallback |
|---|---|
| Module load error | TS `stubEngine()` |
| Version mismatch | Refuse load; prompt re-install |
| OOM / memory growth cap | Reduce scene; stub engine |
| Worker init failure | Main-thread stub |
