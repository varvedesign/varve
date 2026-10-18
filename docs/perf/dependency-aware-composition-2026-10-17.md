# Dependency-aware composition cache — 2026-10-17

## Scope

The retained-surface path is a bounded first slice in the live editor. It caches
the source canvas of an isolated group when its children are visible shape
leaves with resolved IR and solid/gradient fills, and no masks, per-item effects
or filters, visible group effects, active proofing, warp, or master placement.
Groups with visible effects recompose on the fresh path. Export and thumbnail
renderers do not read this cache. Other scenes use existing replay.

The cache is keyed by active document, immutable group/child/IR object identity,
child order, workspace/page/color state, world transform and bounds, and exact
raster scale/dimensions. It owns real HTML/Offscreen canvases, caps one surface
at 8 MiB and total residency according to the render memory preset (8 MiB low,
32 MiB balanced, 64 MiB high), and evicts least-recently-used entries. Runtime
quality multipliers can reduce the cap; 4 GiB and 2 GiB device-memory profiles
cap it at 8 MiB and 4 MiB, respectively. A cap reduction immediately evicts
least-recently-used entries.
Switching between still-open documents preserves their independently keyed
surfaces under the shared LRU budget; closing a document retires its surfaces.
An entry too large for its cap is replayed but not retained.
Metadata residency is also bounded: at most 512 entries are retained, and a
dependency key above 16,384 UTF-16 code units is rejected before it is joined
or stored. These caps bound key-string storage to roughly 16 MiB at the entry
limit; per-entry document-owner strings add at most another 16 MiB under the
same key limit. Map/entry/canvas object overhead is additional and is not
included in the reported RGBA byte budget. Groups exceeding the key cap use
fresh replay.

## Browser comparison

The reproducible regression is the
`reuses an independent isolated group and matches a cache-bypassed composition`
case in `tests/e2e/canvas/visual-compositing.spec.ts`. It draws twelve
rectangles in a 4×3 grid through the editor, groups them at 70% opacity, warms the
retained source canvas, edits a separate top-level rectangle, and then compares
the rendered canvas against a redraw with the cache disabled. The test asserts
that the independent edit increases both cache hits and avoided shape-leaf
work, and that the fresh full-canvas pixel hash equals the cached result after
the independent edit.

Command:

```sh
node scripts/quality/heavy-lease.mjs "e2e: retained group composition parity and reuse" -- \
  npx playwright test tests/e2e/canvas/visual-compositing.spec.ts \
  --project=chromium --workers=1 --reporter=list \
  --grep "reuses an independent isolated group"
```

One run passed in Chromium. Seven forced full-frame `replayMs` samples per
state, with the same document and camera, were:

| State | Samples (ms) | Median |
|---|---|---:|
| Warm retained group | 0.3, 0.3, 0.3, 0.2, 0.3, 0.2, 0.2 | 0.3 |
| Cache bypassed | 1.5, 1.0, 2.0, 1.5, 1.3, 1.4, 1.1 | 1.4 |

These are quantized browser replay-stage timings for a controlled twelve-shape
fixture, not total frame or presentation latency and not a promise for other
documents/devices. The fixture is created through the editor's real drawing
workflow but is not an imported customer design. The test's full content-canvas
hash was identical with retention enabled and disabled. Captures are retained
at [`cached.png`](../screenshots/dependency-aware-composition/cached.png) and
[`cache-bypassed.png`](../screenshots/dependency-aware-composition/cache-bypassed.png);
they were also opened and visually inspected at full viewport size.

### Detailed-diagnostics overhead

The 2026-10-18 controlled rerun samples forced replay of the same warm
twelve-shape group with detailed cache diagnostics enabled before and after a
seven-sample disabled interval. The detailed-on median combines the two
seven-sample runs; the disabled median uses seven samples:

| Mode | Samples (ms) | Median |
|---|---|---:|
| Detailed diagnostics on | 0.5, 0.4, 0.5, 0.4, 0.5, 0.4, 1.0; then 0.4, 0.3, 0.4, 0.7, 0.4, 0.3, 0.2 | 0.4 |
| Detailed diagnostics off | 0.3, 0.4, 0.3, 0.3, 0.4, 0.4, 0.2 | 0.3 |

These browser replay-stage values are quantized at roughly 0.1 ms. The observed
0.1 ms median difference is too small to establish a meaningful overhead or
regression budget; this is a measurement with no presentation-latency claim.
Detailed collection remains opt-in and bounded.
In this rerun, retained replay samples were 0.4, 0.4, 0.7, 0.4, 0.4, 0.4,
0.2 ms (median 0.4); cache-bypassed samples were 1.1, 1.2, 1.6, 1.8, 1.7,
1.4, 1.8 ms (median 1.6). These reinforce the controlled fixture's direction
of benefit, while remaining stage timings from one browser session.

## Imported Varve fixture comparison

The `keeps a real poster fixture group fresh across an independent edit` case
opens the repository-owned `scripts/screenshots/fixtures/poster.varve` through
the editor's file input with the low memory preference active. It groups three
overlapping curved bands, sets group opacity to 70%, warms retained composition,
asserts the reported retained-surface cap is at most 8 MiB, then changes the opacity of the
separate multiply-blended Disc layer. The test asserts that the group still
hits after that independent edit, that the full canvas changes, and that the
cached pixels exactly match a forced full redraw after disabling the cache. It
then edits the grouped teal band, asserts the changed dependency misses the old
retained surface, and compares the child-edited cached result with another
cache-bypassed full redraw. It attaches before/after canvas captures to the
Playwright result. It also exports the selected teal band as PNG before and
immediately after changing that same band's opacity. The export dimensions
remain stable while decoded RGBA pixels change, exercising the actual Export
inspector path against the latest edited document state.

Command:

```sh
node scripts/quality/heavy-lease.mjs "e2e: real poster retained-group parity after independent edit" -- \
  npx playwright test tests/e2e/canvas/visual-compositing.spec.ts \
  --project=chromium --workers=1 --reporter=list \
  --grep "real poster fixture group"
```

The expanded test passed in Chromium (33.6 seconds for the test; 58.4 seconds
including runner startup and lease wait on the first expanded run, and 42.6
seconds on the visual-artifact run; the low-preference rerun passed in 39.3
seconds; the selected-child export freshness rerun passed in 25.7 seconds,
51.7 seconds including runner startup). This is a richer imported Varve fixture
with paths, transparency, text, gradients, and a multiply blend; it is still a
repository-owned sample, not a customer file. The
visually inspected output pair is [`cached`](../screenshots/dependency-aware-composition/poster-grouped-child-cached.png)
and [`cache-bypassed`](../screenshots/dependency-aware-composition/poster-grouped-child-bypassed.png).
No timing claim was taken from these runs. The twelve-shape controlled fixture
above remains the only timing comparison.

On 2026-10-18, the same case passed again on the committed browser harness
(1.1 minutes for the test). This Linux browser session logged that the WASM
engine could not load and used the pure-TypeScript fallback; the result proves
cached/fresh parity for that Canvas2D fallback session, not WASM or native
WebView parity. The two captures from that run had identical SHA-256
`c0175bdfc147b38b99ddb83b4954437d90e267a29daf62c0c14c78897edff6ed`. The
fallback wrapped the poster's small annual-label line differently from the
previously reviewed capture, so the tracked reference images were left intact.

The 2026-10-18 run also opened a new document, returned to `poster.varve`, and
verified that the still-open document received another retained-group hit.
After the switch, its cached canvas matched an authoritative full redraw with
the cache disabled at the restored view. The focused cache unit test confirms
that closing one document releases only that document's entries. This checks
selective in-memory reuse across open tabs; it does not claim cross-window or
native WebView coverage.

The same imported-fixture case now changes from its baseline zoom to a higher
zoom that creates a distinct retained source surface, then rotates the camera
without changing that world-space source. At both states it records retained
hits and checks the cached content-canvas hash against a forced authoritative
redraw with retention disabled. The Linux Chromium run passed in 3.0 minutes
for the test (3.9 minutes including runner startup), using the pure-TypeScript
fallback because the WASM engine could not load. The inspected screenshots are
[`alternate zoom`](../screenshots/dependency-aware-composition/poster-grouped-zoom-retained.png)
and [`alternate rotation`](../screenshots/dependency-aware-composition/poster-grouped-rotated-retained.png).
This is one alternate-zoom and one rotation parity check on the Canvas2D
fallback, not a broad zoom/DPR/rotation matrix or native WebView validation.

## Budget and current limits

Unit coverage verifies LRU and metadata-entry eviction, overlong-key refusal,
document retirement, diagnostic bypass, single-surface refusal, and hard
raster-byte-budget adherence. The raster-layer cache
also now declines a backing canvas whose RGBA dimensions cannot fit its budget
before allocating it. This is not a full memory-pressure soak: browser/GPU
residency and transient effect allocations were not measured.

## Opt-in diagnostic detail

With `?perf=1`, inspect
`window.__varvePerf.compositionCache.diagnostics().detailed`. The bounded
snapshot keeps at most 32 recent fallback/identity-miss records, each with a
group-to-child path capped at 32 nodes and 128 UTF-16 code units per ID,
including size-rejection records that include the attempted group's context.
It keeps at most 128 group identity/key fingerprints for distinguishing
untracked, nonresident, and changed-key misses. These compact two-word
fingerprints are diagnostic labels only; collisions remain possible and can
mislabel a reason, while cache hits still compare the complete key. A group is
considered previously resident only after a successful admission or a hit, so
rejected allocations do not produce a false `nonresident-miss` label.

Each record gives the reason and dependency path; unsupported boundaries
include masks, proofing, warp, master/instance occurrences, group effects,
unsupported child kinds, unresolved child IR, and child effects, filters, or
fills. It also reports average key-build, cache-lookup, and source-composition
times, plus current quality generation (DPR and raster scale), backing
dimensions, and Canvas2D producer. That generation describes raster quality
inputs, not an OS/device generation; this retained product is a 2D canvas
rather than a GPU resource. Detailed timers and path collection are off unless
diagnostics are enabled. The report does not measure total frame presentation,
temporary effect memory, GPU residency, or asynchronous stale-job rejection.
The 2026-10-18 controlled comparison above found a 0.1 ms median difference
with timing resolution around 0.1 ms. That is too small to set a meaningful
overhead budget and is not a presentation-latency measurement.

No customer design, standalone SVG/photo asset, native WebView, whole-document
cache-versus-export parity, thumbnail freshness, font/image completion race,
rotated scale sweep, or long-session pressure run was completed. The selected
child PNG check proves that one immediate export reflects that edited node; it
does not cover export while resources are resolving or concurrent edits during
encoding. The cache deliberately excludes the relevant external-resource
cases; those remain on fresh replay. These tests do not establish broad
responsiveness gains or validate every dependency family in the supplied brief.
