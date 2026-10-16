# Raster tile transport and IR cache accounting (2026-10-16)

Dated record. Machine: AMD Ryzen 3 5300U (4 cores / 8 threads), 22 GB RAM,
load average 18-21 from other concurrent sessions during this work, Node 22.23,
Rust 1.97.1. Absolute times on this box are indicative; each comparison was run
alternately in one process and the mechanisms are memory-bandwidth bound rather
than scheduler bound, so the ratios and the cache-budget arithmetic (which is
exact) are the reliable parts.

Companion: `docs/research/perf-cow-history-cache-ledger-2026-10-16.md` (sources,
tracker evidence), `docs/adr/0241-raster-stroke-ownership-history-hashing-tile-identity.md`
(decisions D1-D5, D4 being the hash scheme that makes history capture O(touched tiles)).

## What was wrong

A raster layer's `RenderItem` carried its tile pixels as a boxed `number[]`, and
the per-node IR cache (`SubtreeIrCache`) measured a candidate entry with
`JSON.stringify(item)` and charged the result to a 50 MiB soft budget
(`memoryBudget.ts`; 10-25 MiB on constrained devices). Three costs followed from
that one shape, all of them whole-layer and all of them inside the frame:

1. `sceneNodeToEngineNode` ran `Array.from(tile.pixels)` per tile. A paint batch
   publishes a new node, so this ran on every batch — and on every cache miss.
2. `SubtreeIrCache.set` walked every tile byte through `JSON.stringify` to price
   an entry it then usually refused.
3. Because the price was inflated, entries above a threshold were logged
   `oversized_entry` and dropped, so the layer was never cached: **every frame
   became a miss** and paid (1) and (2) again, in full, forever.

`RasterLayerCache` and `replayIr` then converted the `number[]` straight back to
a `Uint8ClampedArray` (`new Uint8ClampedArray(tile.pixels)`), so the document's
bytes made a lossless round trip through a boxed array 8x their size on every
frame.

## Measurements

Raw output: `/tmp/opencode/sliceB/measure.mjs` (plain Node, no test runner, so it
does not compete with other sessions). Tile = 128x128 RGBA = 65,536 bytes, the
real tile size. Three states, because one of them is a trap that the change had
to avoid:

| State | `pixels` | estimate formula |
|---|---|---|
| A | `number[]` | previous (walks everything) |
| B | `Uint8ClampedArray` | previous (walks everything) |
| C | `Uint8ClampedArray` | current (tile payload collapsed, charged a reference) |

`Array.from` per tile, previous conversion vs a reference:

| Tiles | Pixels | A/B `Array.from` | C reference |
|---|---|---|---|
| 4 | 0.25 MiB | 21.4 ms | ~0.0 ms |
| 16 | 1.00 MiB | 81.9 ms | ~0.0 ms |
| 64 | 4.00 MiB | 327.7 ms | ~0.0 ms |
| 200 | 12.50 MiB | 1039.7 ms | ~0.1 ms |

The real function measured ~130 ms/MiB in the research ledger; this isolated
mechanism measures ~65-83 ms/MiB. The isolated number excludes the surrounding
node conversion, so the ledger figure is the one to quote for the end-to-end
path.

Entry estimate and the cache decision it drives (soft budget 50 MiB):

| Tiles | A: `number[]` + old | B: typed + old | C: typed + current |
|---|---|---|---|
| 4 | 1.79 MiB - cacheable | 5.70 MiB - cacheable | 1.0 KiB - cacheable |
| 16 | 7.14 MiB - cacheable | 22.80 MiB - cacheable | 2.9 KiB - cacheable |
| 64 | 28.57 MiB - cacheable | **91.21 MiB - REFUSED** | 10.6 KiB - cacheable |
| 200 | **89.27 MiB - REFUSED** | **285.03 MiB - REFUSED** | 32.6 KiB - cacheable |

Cost of computing that estimate:

| Tiles | A | B | C |
|---|---|---|---|
| 4 | 76.2 ms | 86.5 ms | ~0.0 ms |
| 16 | 278.0 ms | 336.2 ms | ~0.0 ms |
| 64 | 1143.1 ms | 1371.4 ms | ~0.1 ms |
| 200 | 2413.3 ms | 4266.8 ms | ~0.2 ms |

State B is the reason both halves are one change. `JSON.stringify` renders a
typed array as an index-keyed object (`{"0":12,"1":34,...}`, roughly 10
characters per element) rather than a bare number list, so handing the IR the
document's buffer while leaving the estimate alone would have moved the refusal
threshold from ~120 tiles down to ~64 and made the accounting *worse*. State C
is the shipped behaviour.

## What the numbers mean

- Previous behaviour, 4 MiB layer (64 tiles), on a cache miss: ~0.33 s of
  conversion plus ~1.14 s of estimate = **~1.47 s of main-thread work to price
  an entry it did keep**.
- Previous behaviour, 12.5 MiB layer (200 tiles): the entry is refused, so every
  frame repeats it — **~1.04 s conversion + ~2.41 s estimate per frame**, and the
  layer never gets IR reuse at all.
- Current behaviour: conversion is a reference (`~0`), the estimate is O(tiles)
  and O(1) per tile (`~0`), and entries are ~96 bytes per tile so any realistic
  layer is cacheable. The per-frame cost of an unchanged raster layer becomes
  the hash-loop lookup it always should have been.

The threshold in the research ledger ("above roughly 7 MiB") was estimated from
a hand-computed JSON size. The measured refusal point for the previous code is
between 16 and 64 tiles, i.e. between 1 MiB and 4 MiB of pixels; the measured
refusal point for state B is 4 MiB. The measured value is the one to use.

## What is covered by tests

- `packages/editor/src/canvas/subtreeIrCache.test.ts` - tile payloads do not
  scale the estimate with pixel count, cost is bounded, a 4 MiB layer is stored
  rather than refused, and a frozen-history control computes the **previous**
  formula over the same item and asserts it exceeds the budget (so the reason
  for the change stays reproducible in the suite rather than only in prose).
- `packages/editor/src/render/sceneToEngine.rasterIdentity.test.ts` - the
  conversion hands over the same buffer object (`toBe`), including for a small
  odd-sized payload.
- `packages/engine/src/rasterLayerCache.test.ts` - a typed-array payload uploads
  byte-identically to the `number[]` payload, the document buffer is not
  modified by an upload, and a short/odd payload writes its own bytes without
  reading past its end.
- `packages/editor/src/canvas/__benchmarks__/rasterIrCost.bench.ts` - the table
  above, reproducible through the bench config.

## Regression evidence against the previous behaviour

Each new test was run against the previous behaviour, restored temporarily by a
script that always puts the working tree back:

| Reverted change | Result |
|---|---|
| `sceneToEngine` copies with `Array.from` | **Test fails as intended**: `new sceneToEngine.rasterIdentity.test.ts` -> `expected [ Array(65536) ] to be Uint8ClampedArray[ 10, 10, 10, ... ]`. Verified 2026-10-16. |
| `estimateItemBytes` walks tile pixels again | **Not verified by a reverted-tree test run.** Two attempts were killed by load (the second hit a 900 s timeout with vitest still transforming). The behaviour is instead pinned inside the committed suite by the control test, which computes the previous formula over the same 4 MiB item and asserts it exceeds the 50 MiB budget while the current code stores that item. |

Both reverted-tree attempts ran on a machine at load average 17-23 (4 cores), so
the unverified row is a tooling limit here, not a pass.


## Why the wire boundary is safe

Passing the document's buffer into the IR is only safe if nothing serialises it:

- **Native/WASM IR build.** `createEngine` wraps every native and WASM engine in
  `withStubFallback`, whose `buildIr` routes any scene containing a
  `rasterLayer` node with `rasterLayerData` to the pure-TypeScript engine, so
  tile payloads never reach `build_ir_json`/`JSON.stringify` on that path. That
  guard predates this change and is what kept the `number[]` payload working
  there; it now also keeps a typed array away from the Rust deserializer.
- **Worker transport.** The IR crosses to the render worker by structured clone,
  where a typed array copies as bytes instead of as a boxed JS array. Nothing
  transfers it, so the document's buffer stays attached to its owner.
- **Persistence.** `RasterTileIR` is a render-time type; the document stores
  `RasterTile` with its own `Uint8ClampedArray` and its own base64 codec
  (`serializeTiles`/`deserializeTiles`), neither of which this change touches.
  The portable document schema and every stored hash are unchanged.
- **Cache keys.** `estimateItemBytes` is the only place that stringifies an IR
  item, and it now collapses tile payloads instead of walking them;
  `cacheContentParts` hashes tiles through `rasterLayerVersionSummary`, which
  reads keys, versions and content identities and never touches pixels.

Known residual: `Engine.hitTest` is *not* behind the raster guard, so a future
caller passing a raster-bearing scene to the WASM/native engine would
`JSON.stringify` typed arrays as index-keyed objects and fail the Rust
deserializer, falling back to the stub (correct, but wasteful). No production
caller does this today — the editor hit-tests through the TypeScript
`HitTestEngine` — and it is recorded in ADR-0241's open items rather than
silently left.

## Not measured / not claimed

- No end-to-end stroke-to-frame latency measurement in the running app is
  included here; the numbers above are the mechanisms (allocation, serialisation
  and cache admission), which is where the whole-layer cost was.
- All times come from one 4-core laptop under heavy concurrent load. No claim is
  made about other hardware.
- The estimate is an accounting model, not a measurement of V8's resident set.
  It is used only to decide eviction and admission, and its input is now
  O(tiles) with no dependence on pixel bytes.
