# Performance, copy-on-write, history and cache ledger (2026-10-16)

Research and failure ledger behind ADR-0241. Dated: the tracker state below was
read on 2026-10-15/16 and will drift. Source audits, secondhand reports and
runtime reproductions are kept distinct.

## Scope and method

Question: where does Varve actually spend time and memory between a paint
stroke, the render IR, the retained raster surface and persistent history, and
which claimed mechanisms (threads, SIMD, copy-on-write, "instant" undo, cached
composition) are present in the code that runs?

Method: read source and docs, measure the production functions with the repo's
bench config, then A/B each change in one process with alternating order.
Machine: AMD Ryzen 3 5300U (4 cores / 8 threads), 23 GB RAM of which 2-4 GB
free, load average 8-12 from other sessions, Node 22.23, Rust 1.97.1, wasm32
target installed, `wasm-opt` and an engine WASM artifact **not** present.
Absolute numbers are therefore indicative; ratios from alternating runs are
the reliable part.

## What exists, verified in source

| Claim in the brief or docs | Finding | Evidence |
|---|---|---|
| WASM engine has CPU raster kernels | **False.** Exports are `build_ir_json`, `hit_test_json`, trace and media probe. IR boundary is JSON strings. | `crates/varve-wasm/src/lib.rs`, `packages/engine/src/wasmLoader.ts` |
| `+simd128` build vectorizes real work | **Unproven.** Blanket `RUSTFLAGS`; no instruction inspection exists. Emscripten documents `-msimd128` as enabling LLVM auto-vectorization, with no runtime feature-detect story. | `justfile:49`, R3 |
| `varve-wasm` consumes `varve-effects` | **False.** Only `apps/desktop/src-tauri` and `varve-accel` depend on it. `AGENTS.md` layout table is stale on this line. | `cargo tree -p varve-wasm`, `crates/varve-wasm/Cargo.toml` |
| Threads | Only `varve-trace` uses rayon (native, `default = ["rayon"]`); rayon also appears in `cargo tree -p varve-wasm` through `varve-trace`, with no threaded execution in the WASM build. No `SharedArrayBuffer`/COOP/COEP use in render. Vite dev server has an opt-in isolation block. | `rg` over crates/packages/apps, `cargo tree -i rayon` |
| `useHistory.ts` drives undo | **Dead code.** Only its test calls `useHistory()`. Production undo is `context.tsx` refs plus `usePersistentHistory`/`EditorHistorySession`. ADR-0198's `useHistory.ts:13-30` citation is stale. | `rg 'useHistory\('` |
| Undo is whole-document clones | **No.** Stacks hold `Document` references (50 deep); structural sharing applies. | `context.tsx:3564`, `useHistory.ts` |

## Measurements

All with real production functions; noise tiles unless stated.

### History capture cost (before)

`packages/history/src/__benchmarks__/rasterCapture.bench.ts`, two vitest
projects (node, jsdom) agreed.

| Raster | `canonicalHistoryHash` | `diffDocuments` (2 hashes) | `captureRasterTileDeltas` |
|---|---|---|---|
| 0.25 MiB | 56-111 ms | 113-128 ms | 5-12 ms |
| 1 MiB | 229-244 ms | 410-812 ms | 7-10 ms |
| 4 MiB | 1.08-1.1 s | 1.8-2.4 s | 7-13 ms |

Linear in raster bytes (~270 ms/MiB). One commit also ran a third hash on the
replayed document. Split of one 4 MiB hash (14.3 MB of canonical text):
serialization 757 ms (69%), UTF-8 encode 17 ms, pure-TS SHA-256 344 ms
(~42-48 MB/s). Node's native SHA-256 on the same buffer: ~1.1 GB/s.

### After D2 (same bench, alternating A/B in one process)

| Raster | legacy two-stage digest | streaming digest | ratio |
|---|---|---|---|
| 1 MiB noise | 121 ms | 41 ms | 2.9x |
| 4 MiB noise | 474 ms | 158 ms | 3.0x |
| 8 MiB noise | 1153 ms | 467 ms | 2.5x |
| 4 MiB 75% zero | 473 ms | 143 ms | 3.3x |

(The "legacy" column already uses the rewritten SHA core, which is no faster
than the old one: 32-48 MB/s old and new under load. An 8-round unrolled core
reached ~1.4x; not adopted.) The streaming digest is 86% SHA by time, so the
remaining cost is bytes hashed, not serialization.

Pass count per captured raster stroke: **3 -> 1** (`editorHistorySession.hashEconomy.test.ts`,
which fails 3-vs-1 against the previous session code).

### Stroke tile allocation (D1)

16-dab batch straddling four tiles:

| Path | Tile buffers allocated | Allocated |
|---|---|---|
| per-dab (previous) | 62 | 3.88 MiB |
| draft | 4 (= distinct tiles touched, asserted) | 0.25 MiB |

Latency, per-dab / draft for one 16-dab batch: 4.59 / 4.07 ms (4 tiles),
5.12 / 17.78 ms (64 tiles; the draft figure is a load outlier), 15.2 / 12.97 ms
(256 tiles) - within noise. Sustained 1000 dabs delivered 8 per event,
alternating: 211 -> 186 ms (4 tiles), 939 -> 980 ms (64 tiles). **No latency
improvement is claimed**; the dab kernel dominates a 64 KiB copy.

### Engine-node conversion (fixed 2026-10-16, ADR-0241 D5)

`sceneNodeToEngineNode` on a raster layer, every call after the node identity
changes (each stroke batch publishes a new node). Measured **before** the fix:

| Raster | Median |
|---|---|
| 0.25 MiB | 37.7 ms |
| 4 MiB | 499.9 ms |
| 16 MiB | 2121.6 ms |

~130 ms/MiB; each tile became a 65,536-element number array. The pixels now
cross by reference, so this term is gone. Isolated mechanism measurement of the
same conversion (`Array.from` per tile vs a reference, plain Node, 4 cores at
load 18-21): 21.4 ms / 81.9 ms / 327.7 ms / 1039.7 ms for 4 / 16 / 64 / 200
tiles, versus ~0 ms. The same change had to fix the IR cache estimate in the
same commit, because the inflated accounting refused ordinary raster layers as
`oversized_entry` and re-ran both costs every frame; full numbers in
`docs/perf/2026-10-16-raster-tile-transport.md`.

## Failure ledger

Format: source / date -> bounded finding -> Varve evidence -> decision ->
regression -> result.

### Seeds

| Source | Evidence type | Finding | Varve evidence | Decision | Regression | Result |
|---|---|---|---|---|---|---|
| PhotoCraft #4531 (closed via #4725, 2026-10-13) | Source audit + tile-count estimate | Conversion un-shares copy-on-write tiles; +96/192/384 MiB estimated for a 24 MP uniform layer | Tile writers (`tiles.set` sites in scene/engine/editor) store one `Uint8ClampedArray` per key; no site that stores one record under several keys was found. `rasterColor` mode/depth conversion was **not** audited | Regression class noted; sharing is by tile-record identity | `rasterTileDraft.test.ts` pins that untouched tiles stay shared by reference | Draft path verified (unit); conversion not audited |
| PdfCraft #1812 (open, 2026-10-13) | Source audit only | Optimizing one image mutates a soft mask shared by others | Raster-mask edits get fresh immutable asset ids (persistent-history.md, 2026-09-05), so editing one user of a mask does not rewrite another; not independently tested here | No change | `rasterTileDraft.test.ts` sibling-layer test covers the tile-ownership analogue only | Analogue verified (unit); mask case not tested |
| LightCraft #1522 (closed via #1777, 2026-10-15) | Static review, no magnitude | Deferred cache writes spawn detached threads outside the LRU budget | Not audited. `apps/desktop/src-tauri/src/lib.rs` has four `std::thread::spawn` sites (lines 687, 729, 830, 5844) that were not reviewed; AGENTS.md states thumbnails run through a concurrency-1 scheduler (not verified here) | None here | - | Not audited |
| EffectCraft #1468 (open) | Secondhand; its own docs say an edit drops every composition RAM preview | May be intended behaviour | Out of scope (different product) | None | - | Not established |
| EffectCraft #1492 (open) | Written user repro, no logs | Unrelated layer edit discards a whole effect's cache | Analogue checked: Varve invalidates per node by document diff (`computeInvalidationPlan`), structural edits wipe | Dependency graph left as is | - | Not reproduced here |
| DesignCraft #718 (closed via #796) | Source audit | Composition key omits grid/visibility/section dependencies | Varve's raster key omitted *tile content* (count + version sum); fixed. Layout-dependency keys not audited here | Raster key fixed (D3) | `subtreeIrCache.test.ts` | Verified (unit); layout deps open |
| DesignCraft #728 (closed via #814) | Source audit | Failed-image cache retains source bytes without budget | `ImageCache` bounds are entry+byte limited for successes; negative-cache bound not re-audited | None | - | Open question |
| DeckCraft #415 (closed via #483) | Source audit, allocator-reuse conditional | Pointer/document-local ids as cache identities | Direct analogue found: tile `version` and node-id-only surface keys | D3 | `rasterLayerCache.test.ts`, `dirtyRegion.test.ts`, `tileKey.test.ts` | Verified (unit) |

### Other relevant tracker hits (titles and first result pages only)

figcraft #440 (undo entry per scrub frame, closed), designcraft #716 (undo
snapshot pairs old document with post-command selection, open),
designcraft #742 (history not rolled back by panic guard, closed), photocraft
#6345 (large floating-selection drag lag, open; reports whole-region copies per
frame and a tile-based fix), deckcraft #402 (conversion outside the memory
budget, closed), lightcraft #1764 (concurrent large renders exhaust device
memory then retire the GPU, open), lightcraft #1525 (unbounded UI events,
open). Of these, #6345 matches the Varve conversion cost above in shape (a
whole-layer copy per change) and is the closest external corroboration; #716's
pairing defect is not present on the paths read: `beginTransaction` and the
`updateDoc` fallback snapshot document and selection from the same state
(`context.tsx` 3378-3379, 3502-3504). Other undo push sites were not audited.

### Coverage gaps (stated, not hidden)

- Only the **first result page** of each tracker search was readable (20-25 of
  42-569 results). Bodies were read for the eight seeds and six follow-ups
  only; the rest is title-level.
- Linked-PR and release status were often not visible; "closed" was not taken
  to mean "fixed in a released build".
- No tracker issue states a Varve-relevant runtime magnitude that was
  independently reproduced.

## Defects found in Varve

1. **Realm-dependent canonical form** (fixed). `canonify` used `instanceof`
   for typed arrays; a cross-realm array canonicalized as `{"0":...}`, so a
   cold-loaded snapshot failed `snapshot canonical hash mismatch` in the jsdom
   test environment while the in-memory document hashed fine. Reproduced
   against `HEAD` code (identical mismatch hashes), so independent of D2.
2. **Version-as-identity** (fixed at unit level): `RasterLayerCache`,
   `changedRasterTileBounds`, `rasterLayerVersionSummary`, `l0Snapshot`.
   Six regressions fail on the previous code (plus the new identity module's own test). **Not reproduced end to end**
   in the editor UI (branch switch in the History panel); the reachable
   scenario is derived from the code path, not observed.
3. **Whole-document hash x3 per commit** (reduced to x1, still O(bytes)).
4. **Per-dab tile cloning** (fixed; allocation, not latency).
5. **Engine-node conversion O(layer) per batch** (fixed, ADR-0241 D5). Tile
   pixels cross into the IR by reference, and the IR cache no longer charges
   bytes it does not own, so raster layers above a few MiB are cached instead of
   being refused and re-converted forever.

## References revalidated (R1-R7)

- R1 `Arc::make_mut` clones the inner value when other strong references
  exist; `Arc<Vec<T>>` is whole-buffer clone-on-write. Applies to any Rust
  port of the tile store: tile-granular `Arc` is required.
- R2 Rayon: `num_threads` defaults to `RAYON_NUM_THREADS` or logical CPUs;
  `build_global` can run once; no nested-pool guidance on that page.
- R3 Emscripten: `-msimd128` enables SIMD and LLVM auto-vectorization; no
  binary-selection or runtime-detection guidance on that page.
- R4 MDN SharedArrayBuffer: requires a secure, cross-origin-isolated context;
  `postMessage` throws for SABs otherwise.
- R5 MDN transferables: ArrayBuffer transfer detaches the sender
  (`byteLength` 0); `ImageBitmap` and `OffscreenCanvas` are transferable.
- R6 not re-fetched this session (atomics reference).
- R7 Krita performance settings: RAM limit, swap file, undo swap, CPU limit,
  frame clone limit; no defaults stated on that page.

## Not done (and why)

Threaded/SIMD raster kernel, cached-composition dependency graph beyond the
raster key, and Playwright coverage of the paint/undo flow are not implemented or
not run in this change; see ADR-0241 "Open items". The WASM toolchain needed to
build and verify a SIMD artifact is not present locally, and a threaded
`wasm32-unknown-unknown` build needs a nightly `-Z build-std`, so "threads in the
WASM engine" is not reachable from the pinned stable toolchain at all.

Undo-to-first-correct-frame latency in the running app is still not measured
here. The measurements above are mechanism-level (allocation volume, hash
passes, cache admission), not the end-to-end interaction.
