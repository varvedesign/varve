# ADR-0241: Raster stroke ownership, history hashing cost, and tile content identity

- **Status:** Accepted and implemented (D1-D8). D4 was approved by the maintainer on 2026-10-16.
- **Date:** 2026-10-16
- **Related:** ADR-0198, ADR-0203, ADR-0214, `docs/architecture/persistent-history.md`,
  `docs/architecture/render-pipeline.md`,
  `docs/research/perf-cow-history-cache-ledger-2026-10-16.md`

## Context

The request was to make rendering use bounded threads and SIMD where they help,
share unchanged document structure and raster data safely, make undo cheap
without weakening durable history, and keep cached composition equivalent to a
fresh render. Before choosing mechanisms, the real paths were traced and
measured (numbers: the research ledger; machine: 4-core/8-thread Ryzen 5300U
under a load average of 8-12 from other sessions, so absolute figures are
indicative and every comparison below is an alternating same-process A/B).

What the audit established:

1. **No raster kernel runs threaded or SIMD today.** `varve-wasm` exports IR
   build, hit-test, trace and media probe only. `+simd128` is a blanket
   `RUSTFLAGS` value whose effect on emitted code has not been inspected.
   Pixel kernels live in TypeScript (`blur.ts`, compositing) and native
   `varve-effects`, which `varve-wasm` does not depend on.
2. **A committed paint stroke hashes the whole document three times.**
   `diffDocuments` hashes base and target; capture then hashes the replay
   again. `canonicalHistoryHash` expands every tile byte to a JS number and
   builds one string, then runs a pure-TypeScript SHA-256 (about 40 MB/s here).
   Measured on noise tiles: 56-111 ms at 0.25 MiB, ~1.1 s at 4 MiB per hash;
   linear at ~270 ms/MiB. Extrapolated, a fully painted 24 MP RGBA8 layer
   (~96 MiB) is on the order of 25 s per hash, and its canonical text would be
   roughly 0.7 of V8's maximum string length.
3. **Per-dab tile cloning.** `compositeDabOnNode` copied the whole tile `Map`
   and cloned every touched 128x128 tile for every dab: a 16-dab batch
   allocated 62 tile buffers for 4 distinct tiles.
4. **Tile `version` is used as content identity but is only a per-node
   mutation counter.** `RasterLayerCache`, the dirty-region diff, the IR cache
   summary and the pyramid keys all skip work when versions are equal. After
   undo + a different stroke, or a divergent branch checkout, two different
   pixel states carry the same number.
5. **Engine-node conversion is O(layer) per stroke batch.**
   `sceneNodeToEngineNode` runs `Array.from` over every tile of a raster layer
   whenever the node identity changes: ~130 ms/MiB (0.5 s at 4 MiB, 2.1 s at
   16 MiB). Not addressed by this ADR; see Open items.

## Decision

**D1 - Stroke-scoped exclusive tile ownership.** `RasterTileDraft`
(`packages/scene/src/rasterLayer.ts`) copies the tile `Map` once and clones a
given tile at most once per draft; later dabs write the draft's private copy.
`commit()` publishes an ordinary immutable node and seals the draft. Published
tiles are never written. Tile `version` advances once per dab that touches the
tile, exactly as before, so versions, history deltas and canonical hashes are
unchanged. `compositeDabOnNode` and `eraseDabOnNode` are now one-dab drafts
(one kernel, no duplicate). `PaintTool.applyBatch` uses one draft per batch.
`compositeSmudgeDabOnNode` is deliberately untouched: it reads source tiles
while writing, so in-place mutation would change its semantics.

**D2 - Cheaper history capture without changing the hash value.** The
canonical history hash **value** is unchanged and remains authoritative for
every stored revision and snapshot.
- `canonicalDocumentDigest` streams the same bytes `canonicalizeDocument`
  produces into an incremental `Sha256Stream` (no `Array.from`, no document
  string). It is verified byte-for-byte against the string path.
- `DiffOptions.baseHash` lets a caller that already holds the base document's
  digest skip hashing it. `EditorHistorySession` supplies it only when the
  `before` document is the object it recorded or verified for the head
  revision (genesis, attach-equal, captured `after`, loaded-and-verified).
- Replay verification first tries `strictlyIdentical(replayed, after)`; a
  structural match proves the stored operations recreate the captured document
  without a third hash. Anything not provably identical falls back to the hash
  comparison, so the oracle is never weakened.
- Typed-array detection is realm-independent (`isByteArray`). The previous
  `instanceof` check made a cross-realm array canonicalize as `{"0":...}`.
Result: hash passes per raster stroke 3 -> 1; digest 2.5-3.3x faster per
pass. Under scheme 1 capture remained **O(raster bytes)**; D4 removes that.

**D3 - Tile content identity is a runtime token, not the version.**
`tilePixelsIdentity(pixels)` (a `WeakMap`-assigned, process-local number) is
carried as `contentId` on engine tile records. `RasterLayerCache`,
`dirtyRegion`, `cacheContentParts` and the pyramid `l0Snapshot` compare it
(or the pixel buffer itself) in addition to `version`. `contentId` is never
persisted and never enters the canonical form. When absent, behaviour is the
previous version-only comparison.

**D4 - History hash scheme 2: tile Merkle (implemented).** The canonical history
hash of a raster document spelled every pixel out, so committing a stroke, and
every undo and redo, cost O(raster bytes) however little changed. Scheme 2 hashes
each tile's bytes once, memoizes that digest on the (immutable) buffer, and puts
`bytes:<length>:<sha256>` into the canonical text where scheme 1 put the JSON
number list. A document with no byte arrays has identical bytes, and so an
identical hash, under both schemes (pinned by test). The token is not valid
JSON, so no scheme-1 text can equal a scheme-2 text.

- `canonicalHistoryHash(doc, scheme = 2)`; `byteArrayDigest` is the memo.
- `RevisionRecord.hashScheme` and `SnapshotRecord.hashScheme` name the scheme a
  stored hash was written under; a record without the field is scheme 1. Every
  new revision and snapshot writes `2`.
- **Dual-scheme verification.** Replay verification, snapshot decode and the
  attach reconciliation hash under the scheme the record names
  (`historyHashSchemeOf`), so a history written before this change verifies
  forever and is never rewritten. A scheme-1 record relabelled as 2 (or the
  reverse) fails closed, and an unknown scheme is refused with
  `replay.unknown-hash-scheme` rather than guessed.
- **Upgrade is in place and lazy.** A scheme-1 head is attached as it was; the
  first capture on it hashes its base afresh under scheme 2 (one O(bytes) pass,
  as before), writes a scheme-2 revision, and every later capture reuses the
  recorded digest.
- **The memo's contract is immutability of published tile buffers**, which
  `RasterTileDraft` and every other tile operation already honour (they clone
  before writing). `canonicalHashScheme.test.ts` pins it for each tile
  operation. The replay-verification oracle is unchanged: it replays stored
  operations into fresh buffers and hashes those. A buffer mutated after it was
  hashed would record a stale digest that the next load's fresh hash would
  contradict, which is detected, not silent.
- Measured through the real `EditorHistorySession` (Ryzen 5300U under load
  average ~11, in-memory stores; `sessionRasterCapture.bench.ts`): a stroke on a
  94 MiB (~24 MP) layer commits in a median 21-23 ms (worst 27-45 ms) hashing
  ~0.7 MiB, where scheme 1 hashes the whole layer (one pass ~8-10 s). The
  per-undo dirty check (two whole-document hashes in `applyLoadedRevision`) drops
  from 10.4 s to 28 ms at 94 MiB and from 3.2 s to 8 ms at 16 MiB. Attach still
  costs O(raster bytes) once per document open (6-9 s at 94 MiB).

**D5 - Tile pixels cross into the IR by reference, and the IR cache does not
charge what it does not own.** `RasterTileIR.pixels` accepts the document's
`Uint8ClampedArray` and `sceneNodeToEngineNode` passes the buffer itself;
`replayIr` and `RasterLayerCache` read it through `ArrayLike<number>` instead of
copying it into a fresh `Uint8ClampedArray`. This removes a lossless round trip
through a boxed array 8x the size of the pixels. Reading the buffer is safe
because published tiles are immutable (D1) and nothing in the IR path writes to
them; an upload must never transfer the `ArrayBuffer`, which would detach the
document's storage.

`SubtreeIrCache.estimateItemBytes` charges such a tile
`TILE_REFERENCE_BYTES` (the grid key, the record and the pointer) instead of
walking its payload, because those bytes belong to the document. Both halves are
required together: `JSON.stringify` renders a typed array as an index-keyed
object (~10 characters per element) rather than a bare number list, so the
transport change alone would have *raised* the entry estimate and lowered the
cache's admission threshold. Measured (64 tiles, 4 MiB of pixels, 50 MiB
budget): previous `number[]` + previous accounting = 28.6 MiB and ~1.14 s to
compute; typed array + previous accounting = 91.2 MiB and **refused**; typed
array + current accounting = 10.6 KiB and ~0 ms. Refusal was not a warning: a
refused entry is never stored, so the layer paid the whole-layer conversion and
the whole-stringify again on every frame. See
`docs/perf/2026-10-16-raster-tile-transport.md`.

**D6 - Bounded row-band threads in the native effect kernels (implemented).**
The only raster compute that can use more than one core today is the native
desktop path: `apply_live_effect_binary` runs `varve-effects` on one blocking
thread per request, at up to 8192x4096. The kernels compute every output pixel
from read-only input with fixed-order arithmetic, so disjoint bands of output
rows can run on different threads without changing a byte.

- `varve_effects::parallel::Execution` is the policy. `bounded()` (what
  `apply_effect` uses) takes at most 4 threads, caller included, never the last
  free core (a two-core machine runs scalar), no thread for less than 128 Ki
  output bytes per band, and `VARVE_EFFECT_THREADS` can lower it. `scalar()` is
  the same code as one band and stays selectable (`apply_effect_with`).
  `std::thread::scope` only: no pool, no `unsafe`, nothing outlives the call.
- Parallel stages: gaussian blur (both passes and the sRGB conversions), box
  downsample and bilinear upsample, bloom (bright pass, streak, combine,
  composite), light shafts (occlusion, ray march, scatter blur, composite), RGB
  split, CRT (main pass, glow blur, glow blend), light leak, and the caustics
  wave field.
- **Deliberately serial.** Dither and VHS are not banded (error diffusion carries
  state across pixels; VHS and lens flare cost ~0.1 s at 4 MP). The caustics
  composite stays serial because it resamples `out` while writing it, so a pixel
  can read one an earlier pixel already replaced; that order is part of the
  output and the output must not change.
- **Correctness oracle.** `tests/parallel_parity.rs` pins FNV-1a checksums of
  29 cases (every effect, border modes, quality tiers, degenerate 1xN / Nx1 /
  2-row / 3-row images) generated from the pre-parallel kernels, and asserts the
  scalar path, 2/3/4 forced bands, and the default policy reproduce them. The
  TypeScript-fixture agreement tests now also run under scalar, 2 and 4 forced
  bands, so the parallel output is held to the TS reference bytes themselves.
- Measured (`cargo run --release -p varve-effects --example effect_cost 2048`,
  4 MP, 4 threads, machine load average 6-8, single runs): light shafts 4.26 s ->
  1.64 s at export quality (2.6x), CRT 0.70 -> 0.21 s (3.4x), bloom 1.24 -> 0.58 s
  (2.1x), light leak 0.60 -> 0.20 s (3.0x), RGB split 0.23 -> 0.12 s (2.0x),
  caustics 1.32 -> 0.75 s (1.8x); dither, VHS, lens flare, palette snap ~1.0x. Every
  output byte-identical to the scalar path.
- **No SIMD claim.** `unsafe_code` is denied workspace-wide and `std::simd` is
  unstable, so there is no explicit SIMD here, and whether LLVM auto-vectorized
  any f64 loop was not inspected. Nothing in this ADR is evidence of SIMD
  acceleration. The WASM engine route stays blocked as described under Open
  items.

**D7 - Capability probes are validated modules, and artifact selection is
evidence-based (implemented).** The editor already had two probe modules for
"WASM SIMD" and "threads", but both were structurally invalid: the SIMD module
applied `i8x16.splat` to a `v128` and the threads module declared a five-byte
memory section with four bytes of payload. `WebAssembly.validate` therefore
returned `false` on every engine, and the capability report answered "no SIMD /
threads unavailable" even on hardware that supports both. They now live in
`@varve/engine` as `WASM_SIMD_PROBE` / `WASM_THREADS_PROBE`, are pinned by a
test that validates them against the real engine, and are the single source of
truth used by the capability report, the render-path diagnostics and the loader.

`wasmArtifactCandidates()` returns `['simd','baseline']` only when the engine
validated a `v128` module; otherwise the loader never fetches, instantiates or
reports the SIMD artifact. `getWasmEngineAttribution()` records the artifact
that actually loaded, its self-reported version, the candidate that was skipped
and the bounded stage/reason of every failed attempt (`head`, `glue`,
`instantiate`). A `setWasmArtifactPreference('baseline')` seam exists for A/B.
`threadsUsable` requires all three of: the engine accepts shared memory + an
atomic instruction, a `SharedArrayBuffer` can actually be constructed, and
`crossOriginIsolated` is true - because a threaded build needs all three and
WebKitGTK 2.52 has no shared buffer even with correct COOP/COEP headers.

**D8 - The SIMD artifact is verified, measured, and not claimed as an
acceleration (implemented).** `just wasm-build-*` labels one artifact
`varve_wasm_simd`, which is a build flag, not evidence. `just verify-wasm-simd`
disassembles the shipped binaries and fails if a claimed SIMD artifact contains
no `v128` instructions (or if a baseline artifact contains any); it exits
`UNVERIFIED` when `llvm-objdump` is missing rather than passing. Measured on a
local build (engine 0.5.0): baseline 1,136,808 bytes / 0 vector instructions,
SIMD 1,146,397 bytes / 6,126 vector instructions, colour 526,600 bytes / 0.
So the SIMD artifact is genuinely vectorized and the colour artifact is
correctly baseline-only.

`just bench-wasm` then runs both artifacts on their exported work with
interleaved A/B and asserts byte equality. IR JSON is identical at 200, 600 and
2000 nodes, hit-test indices agree, and contour-trace output is identical at
768x768. The measured latency is indistinguishable: IR build p50 4.68 vs
4.49 ms (200 nodes), 6.98 vs 7.07 ms (600), 24.91 vs 23.09 ms (2000) - 0.99x to
1.08x, i.e. inside the noise of a loaded shared machine - and trace is ~1.0x.
The exported path is dominated by the serde JSON boundary, so no SIMD
acceleration is claimed for canvas rendering, and no SIMD colour artifact is
added (it would be a label with no vector work behind it). The native
row-band kernels from D6 are the measured parallel path: re-run at 1024x1024 on
the same machine, bounded execution is 1.13x-2.51x faster than scalar across
the ten effects (Bloom 2.01x, LightShafts 2.51x, RGB split 2.30x at export
quality) with byte-identical output.



## Alternatives considered

- **Faster SHA only.** An 8-round unrolled core measured ~1.4x under load;
  WebCrypto has no incremental API and is async; a WASM SHA needs the asset
  pipeline that is not present locally. None changes the O(bytes) term.
- **Hash memo keyed by `Document` identity.** Wrong silently if any code
  mutates a published tile in place; the session-private identity-guarded
  reuse in D2 has a narrow, verifiable lifetime instead.
- **Make `version` globally unique.** The version is part of the canonical
  document and the persisted raster delta; rewriting it changes hashes.
- **Memoize `Array.from(tile.pixels)` per tile.** Trades CPU for a 4-8x
  resident-memory multiple of every tile on a 4 GB target.

## Consequences

- Paint batches allocate one buffer per touched tile instead of one per dab
  per tile. No latency win was demonstrated on this machine (the dab kernel
  dominates; sustained 1000-dab stroke: -12% at 4 tiles, +4% at 64 tiles,
  within noise). The benefit is allocation volume and GC pressure.
- Capture does a third of the hashing and each pass is ~3x cheaper; large
  raster documents no longer build a document-sized string. Under scheme 2 a
  stroke costs the tiles it touched, not the layer (D4).
- A divergent-branch checkout or undo-then-different-stroke can no longer be
  mistaken for "tile unchanged" by the retained raster surface, the partial
  redraw region, the IR cache, or the pyramid.
- Unchanged tiles keep their identity across conversions, so retained
  surfaces still skip them.

## Migration impact

D1-D3 and D5 change no persisted field, schema, or hash value. D4 adds the
optional `hashScheme` field to revision and snapshot records and changes the
hash value of every **raster-bearing** document written from now on. Existing
records are neither rewritten nor re-verified differently (they are scheme 1 by
absence); a history is a mix of schemes after its first new revision. Documents
with no byte arrays are unaffected.

**Downgrade is not supported for raster-bearing histories.** A build that
predates D4 verifies every revision under scheme 1 and would report a scheme-2
revision of a raster document as a hash mismatch (recovery would then rewind to
the last scheme-1 revision). The revisions are not deleted, but the affected
history is only readable by a build that knows `hashScheme`.

## Compatibility impact

- `RasterTileIR.contentId` is optional; consumers fall back to version-only
  comparison when it is absent.
- `RasterTileIR.pixels` is now `number[] | Uint8ClampedArray | Uint8Array`
  (D5). Consumers must read it through `ArrayLike<number>`, must treat it as
  read-only, and must never transfer its `ArrayBuffer` — that would detach the
  document's own storage. A `number[]` payload is still accepted, so out-of-tree
  producers keep working.
- `@varve/history` exports `strictlyIdentical`; `@varve/scene` exports
  `canonicalDocumentDigest`, `Sha256Stream`, `isByteArray`, `RasterTileDraft`,
  `beginRasterTileDraft`; `@varve/engine` exports `tilePixelsIdentity` and the
  `RasterTileIR` type.
- A cross-realm typed array now canonicalizes as an array (it previously
  produced an index-keyed object, which no realm-consistent document can have
  persisted).

## Security considerations

`contentId` is a process-local counter; it carries no content, is not
persisted, and is not an integrity mechanism (SHA-256 content hashes remain
that). `strictlyIdentical` is one-sided: `true` implies equal canonical bytes,
`false` only means "not proven".

## Open items

- Engine-node conversion cost is **resolved for tile pixels** by D5. What
  remains is the per-node work around it (node records, resolution of styles,
  warps and separation bands), which is not O(raster bytes).
- Document open still costs O(raster bytes) once: attach hashes every tile,
  builds the genesis snapshot (codec text plus the tile-store manifest) and the
  tile store verifies each blob it is given. Persisting the digests with the
  document would remove the hash pass; it is a file-format change and is not
  proposed here.
- Threaded/SIMD **raster kernel** in the web/WASM engine: still absent, and
  now precisely scoped. The WASM surface exports IR build, hit-test, contour
  trace and media probe only; there is no pixel kernel to vectorize
  (D8 measures the first three). A threaded `wasm32-unknown-unknown` build
  needs nightly `-Z build-std`, and WebKitGTK 2.52 has no `SharedArrayBuffer`
  even with correct COOP/COEP (WebKit GLib ports only started setting
  `JSC_useSharedArrayBuffer` for isolated origins in September 2026, after
  2.52), so the shipping web fallback must stay single-threaded regardless.
  The engine artifacts are generated by `just wasm-build` and gitignored, not
  committed; the local build inspected here is from the same source tree.
  The measured candidate remains the TypeScript separable blur for radius > 32
  px (`packages/engine/src/blur.ts`), which would need a new WASM pixel crate
  with bit-exact parity tests against the TS reference before it could be
  wired. See `docs/perf/2026-10-16-wasm-simd-capability.md`.
- `Engine.hitTest` was **not** behind `withStubFallback`'s
  `requiresRasterFallback` guard. Closed: raster-bearing scenes now route to the
  stub for hit testing too (`engine.ts`, with a positive and a negative
  regression). No production caller reached it — the editor hit-tests through
  the TypeScript `HitTestEngine` — so the guard removes a trap rather than
  fixing an observed failure.
- A raster layer whose **tiles** were unchanged but whose placement or
  appearance changed contributed no dirty rects at all
  (`dirtyRegion.ts`). Alone it escalated to a full redraw; beside any other
  changed node it produced a partial frame that neither repainted the layer at
  its new position nor cleared the old one — a multi-select drag of a painted
  layer with any other object is the obvious trigger. Closed: the tight
  per-tile path (tile keys are grid coordinates in the layer's own space, so it
  is only meaningful under an unchanged placement) now requires
  `rasterPlacementUnchanged`, and everything else uses the transform-aware
  generic path, which contributes old *and* new world bounds. Two regressions:
  a moved layer must contribute bounds covering both positions (fails with
  "expected 'full' to be 'partial'" without the fix), and a re-published layer
  with identical tile records is bounded to its own area instead of escalating.
- **Undo before persistent history has caught up.** **Closed** (2026-10-17).
  Persistent history attaches asynchronously after a document opens and records
  each commit asynchronously after that. Painting and pressing Ctrl+Z inside
  that window left a wrong history: a stray step (labelled "Delete" when the
  restore removed the painted layer), Redo disabled, and, separately, strokes
  painted before attach missing from history altogether. The earlier suspicion
  (a late attach, not a capture race) was right, and there were two defects,
  both reproduced deterministically through the real `EditorProvider` with a
  history store whose `listBranches` or `commitRevision` is held open:
  1. `commitTransaction` captured a transaction only when the session was
     already attached. A gesture committed earlier was left to the document
     watcher, which skips every render of an open transaction and whose commit
     render changes no document, so a multi-render gesture (a stroke) was never
     recorded. Genesis and the layer creation were listed; the stroke was not.
     Now captured at commit whether or not history is attached: the capture
     queue holds it behind attach and the watcher is told to skip the commit.
  2. `undo`/`redo` routed to history only when the session reported a revision
     to move to. While the session was not attached, or attached with its first
     capture still uncommitted (it sits at genesis and reports nothing to undo),
     the editor stepped from its local stack and told history nothing. The
     document watcher then recorded the restored document as a new forward edit
     on top of the pre-undo head, which discarded the redo path. Now such a
     step is replayed into history instead: `noteLocalNavigation` keeps the
     watcher quiet and queues the same undo or redo behind the captures history
     still owes, so the lineage ends where the editor does and a later edit
     branches from the right head. Undo still restores at once; it does not
     wait for history. If the replayed step lands on a different document than
     the editor shows, history, the hash-verified record, wins unless the user
     has already edited on top of the local result; that is logged.
  Regressions: `historyAttachWindow.test.tsx` drives the real `EditorProvider`
  over a history store whose `listBranches` or `commitRevision` is held open and
  covers an undo before attach, a multi-render gesture committed before attach,
  and an undo while the first capture is in flight; each also runs
  `validateHistory` over the store. All three failed before the change (the
  gesture was absent from history; the undo left an extra step and no redo). With
  only the commit-time capture reverted, the first two fail; with only the
  replay reverted, the first and third fail. `usePersistentHistory.test.tsx`
  covers the replay, the disagreement rule and the idle no-op.
  `tests/e2e/canvas/undo-before-history-attached.spec.ts` repeats the first case
  in a real browser with the history database's open held until the test
  releases it: it passes with the fix and, with only the replay removed, fails at
  its Redo assertion (Redo stays disabled), which is the reported symptom.
  Not covered: a Ctrl+Z pressed while history is attached and idle but with
  nothing to undo still falls back to the local stack and is recorded as an edit
  (the mutation paths that bypass capture); and a second local step is replayed
  on the assumption that local and recorded steps correspond one to one, which
  the disagreement check detects but cannot repair if the user has edited since.
  Observed, not root-caused: in gated browser runs the editor's local-stack undo
  of one or two raster strokes did not always restore the exact pre-stroke
  pixels (an empty layer remained after one stroke; in one run only the later of
  two strokes remained). It behaved the same with the replay removed, so the
  history bridge is not the cause. A candidate is the stale-frame defect that
  `tests/e2e/paint/stroke-undo-responsiveness.spec.ts` documents at its first
  assertion: a committed stroke whose worker bitmap lacks the stroke is
  presented as current. That spec's first test failed 5 of 5 with this change
  and 5 of 5 with `context.tsx`, `usePersistentHistory.ts` and `types.ts` at the
  previous commit, with the same message, so this change neither caused nor
  cured it. Whether the pixels seen after a local undo are that defect was not
  established: a `?perf=1` diagnostic run was inconclusive because that mode
  draws debug overlays onto the content canvas, and the one forced full redraw
  it compared differed from the frame on screen by at most one colour level over
  a few hundred antialiased pixels, which is not a stale frame. The spec
  therefore does not compare the canvas between Ctrl+Z and attach; after attach
  it asserts the canvas equals the undone head exactly, and whether that
  exercised the disagreement correction or the local step was already exact was
  not recorded.
- `RasterLayerCache` keys surfaces by node id alone and
  `resetRasterLayerCache` has no production caller; a retired document's surfaces
  are only reclaimed by LRU eviction inside the 128 MiB budget. Identity
  comparison (D3) keeps this correct across documents; it is a bounded resource
  retention, not a correctness hazard.
- Not audited here: `liquifyRenderCache` and `frequencySeparationRenderCache`
  keyed on `rasterTileMapRevision`, which folded in only tile keys and
  `version`. **Closed**: the revision now also mixes each tile's pixel-buffer
  identity, so the aliasing case D3 fixed elsewhere can no longer return warped
  or separation tiles derived from another revision's pixels. A regression pins
  that two different buffers at the same version produce different revisions
  (`expected '1:3v04gu' not to be '1:3v04gu'` without the fix) while a re-read
  of the same buffers still hits.
- `canonical.ts`'s `payloadToAssetId` map is last-writer-wins by insertion
  order. If two assets share a `dataUrl` and a fill still holds that raw data
  URL as `src`, the substituted id — and therefore the persisted hash — depends
  on map insertion order, while `strictlyIdentical` compares key sets and would
  call the two documents identical. Unreachable case found; making the map
  order-independent would change persisted hashes for such documents, so it
  needs the same explicit decision as D4.

## Rejected shortcuts

- Counting a cache-hit counter, a worker count or `+simd128` as evidence of
  acceleration.
- Re-timing a stack pop and calling undo instant.
- Loosening the replay oracle to make capture faster.
