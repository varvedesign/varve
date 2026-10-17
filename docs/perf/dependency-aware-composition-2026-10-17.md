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
at 8 MiB and total residency at 32 MiB, and evicts least-recently-used entries.
Changing or closing the active document retires its retained group surfaces. An
entry too large for its cap is replayed but not retained.

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

## Budget and current limits

Unit coverage verifies LRU eviction, document retirement, diagnostic bypass,
single-surface refusal, and hard byte-budget adherence. The raster-layer cache
also now declines a backing canvas whose RGBA dimensions cannot fit its budget
before allocating it. This is not a full memory-pressure soak: browser/GPU
residency and transient effect allocations were not measured.

No real imported SVG/photo design, native WebView, export parity, thumbnail
freshness, font/image completion race, rotated scale sweep, or long-session
pressure run was completed. The cache deliberately excludes the relevant
external-resource cases; those remain on fresh replay. The current test does
not establish broad responsiveness gains or validate every dependency family
in the supplied brief.
