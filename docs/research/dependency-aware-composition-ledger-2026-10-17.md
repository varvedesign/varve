# Dependency-aware composition: evidence ledger — 2026-10-17

Access date: 2026-10-17. External issue reports describe other products and are
used as regression seeds, not as evidence that Varve has the same defect. The
Varve entries below are source observations until a runtime or pixel oracle is
recorded.

## Current Varve evidence

Checkout `0024e633bfdf040af4e190e1aa5df0dd86f36fa3` (`master`; 118 commits
ahead and 6 behind `origin/master` at inspection). The shared worktree already
had 40 modified/untracked paths, none in the primary composition files. The
recorded toolchain reports Node 22.23.0, pnpm 11.9.0, and Rust 1.97.1; project
instructions document Node 26. A Playwright MCP process was already active, so
no process was stopped.

| Observation | Evidence class | Consequence |
|---|---|---|
| `SubtreeReplayCache` stores keys and timestamps only; the Canvas2D backend clears and replays `RenderItem`s. No production caller supplies reusable pixels from this cache. | Source-confirmed; no runtime reproduction needed for this limitation. | A key hit cannot be described as saved composition work. Retaining pixels needs a drawable artifact and an authoritative fallback. |
| `SubtreeIrCache` reuses engine IR items in `renderPipeline.ts`; it does not skip Canvas2D replay or group effect composition. | Implemented behavior, source-verified. | Report IR build savings separately from avoided raster/effect/composition work. |
| `RasterLayerCache` retains actual tile-backed layer surfaces, but receives caller identity and its current admission protects the just-built surface during eviction. A requested surface larger than its budget can remain resident. | Source-confirmed budget edge; cross-document alias is a source-level risk, not yet reproduced. | Reject oversized retention before allocation; audit document/session ownership and cleanup before broadening reuse. |
| `expandReplayList` computes ancestor/mask/subtree `appendIds` but passed the original candidate IDs to the helper that builds appended IR. A direct regression existed and failed before the fix. | Source-confirmed and unit-reproduced; visible app impact still needs an eligible workflow. | Build IR for the expanded dependency set, then prove an actual partial-redraw path exercises it. |
| `sceneNeedsStructuralCompositing` disables worker rendering and dirty pruning for scenes with clips, masks, flattening groups, and related structural behavior. | Source-verified safety guard. | Preserve this fallback until a cached path passes the same-state fresh-frame oracle. |
| Backdrop cache is cleared at each engine replay. Its key does not identify the sampled backdrop pixels or paint prefix. | Source-verified correctness boundary. | Do not extend lifetime based on geometry/radius or a TTL alone. |
| The canvas feature page says `SubtreeReplayCache` optimizes repeated rendering, although the implementation does not retain or composite pixels. | Source-confirmed copy mismatch. | Correct the claim to match actual IR reuse until pixel reuse is implemented and measured. |

References: [ADR-0193](../adr/0193-shared-canvas-rendering.md),
[render pipeline](../architecture/render-pipeline.md),
[2026-09-21 responsiveness remediation](../perf/2026-09-21-canvas-responsiveness-remediation.md),
[`dirtyReplay.ts`](../../packages/editor/src/canvas/dirtyReplay.ts),
[`rasterLayerCache.ts`](../../packages/engine/src/rasterLayerCache.ts),
[`tileCache.ts`](../../packages/compositor/src/canvas2d/tileCache.ts), and
[`canvas.astro`](../../apps/website/src/pages/features/canvas.astro).

## External failures and transferable checks

| Source and status at access | Reported failure / confidence | Varve decision and acceptance check |
|---|---|---|
| [EffectCraft #1492](https://github.com/storytold/effectcraft/issues/1492), open; Windows 11 report, 2026-10-14. | A user says an unrelated layer move discards completed cache work. Symptom is user-reported; mechanism is undiagnosed. | Warm a costly product, edit an independent object, prove the product remains reusable while affected output refreshes. |
| [EffectCraft #595](https://github.com/storytold/effectcraft/issues/595), open when reviewed; 0.7.0, CachyOS/Wayland, 24-thread Ryzen 5900X, RTX 3090. | Playhead stalls despite work being prefetched farther ahead; cached playback still stutters. PR [#645](https://github.com/storytold/effectcraft/pull/645) fixed the 1/3-resolution indicator only. PR [#793](https://github.com/storytold/effectcraft/pull/793) changed nearest-playhead priority/retention; a later comment still reports a timing-dependent stall under build load. Root cause for the remaining stall is unresolved. | Prioritize visible/current work, measure queue delay and presentation separately from cache occupancy, and test under load. |
| [PhotoCraft #6808](https://github.com/storytold/photocraft/issues/6808) and [PR #6809](https://github.com/storytold/photocraft/pull/6809), issue and PR open at review. | Developer source analysis says Free Transform/Warp moves a mask/fill coordinate frame while old cached fill pixels remain. High confidence in the described code path; real in-app artwork validation was not established. | Transform and warp masked imports, then compare with an uncached composition and inspect old/new bounds. |
| [EffectCraft #1253](https://github.com/storytold/effectcraft/issues/1253), open at review. | Source-only report: persistent frame keys may omit browser virtual-media identity, so same-path replacement could hit stale data before version-aware sync. No runtime reproduction was supplied. | A future persistent key must include resolved asset identity; for in-memory caches, replace/relink equal-name/equal-size assets and compare all consumers. |
| [Penpot #4119](https://github.com/penpot/penpot/issues/4119), open at review. | Intermittent old board state on hover/zoom and reports of previous text in PNG export. Cache explanation is a reporter hypothesis, not maintainer-confirmed root cause. | Check overlay/view freshness and immediate export against a pinned document/resource snapshot; do not infer the cause from visual symptoms alone. |
| [Penpot #11302](https://github.com/penpot/penpot/issues/11302), closed as completed; [PR #11337](https://github.com/penpot/penpot/pull/11337) is the linked completion. | Rotated large text leaves fragments at other zooms. The issue is intermittent; the exact released fix was not source-audited in this review. | Warm multiple scales, transform/reset/undo, revisit zooms; inspect magnified text, thin strokes, and tile edges. |
| [LightCraft #1058](https://github.com/storytold/lightcraft/issues/1058), proposal, no implementation linked at review. | Proposes separate cache producer versions to avoid unrelated global version churn. This is proposal evidence, not a confirmed user defect. | Keep cache producer identity scoped, but never let version granularity replace complete input dependencies. |
| EffectCraft #1268, cited in the supplied brief. | The primary GitHub page timed out in the current research pass; the supplied brief says a 0.9.2 user reported about 11 GB of disk cache for a 12-second project and could not find the suggested control. Current status and details are unverified here. | Treat as a prompt-supplied budget/UI regression seed only; do not cite it as independently refreshed evidence. Do not add disk persistence by default. |

## Primary architecture references

- [Chromium paint architecture](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/platform/graphics/paint/README.md): paint chunks and shared properties offer a more useful reuse boundary than a page-sized bitmap; invalidation and compositor updates are separate decisions.
- [WebRender picture caching](https://doc.servo.org/webrender/picture/index.html): tile validity follows primitives, clips, image keys, opacity bindings, and transforms; missing residency returns to invalidation/rebuild.
- [W3C compositing and blending](https://www.w3.org/TR/compositing-1/): isolation, group opacity, clips/masks, order, filters, blend modes, and backdrop all affect equivalence.
- [Skia image-filter bounds](https://api.skia.org/classSkImageFilter.html): map damage forward and required source bounds backward; conservative bounds may cost work but underestimates leave stale pixels.
- [Fabric object caching](https://fabricjs.com/docs/fabric-object-caching/): dirty flags and scale-cache tradeoffs are explicit; a transient coarse preview requires later refinement.
- [Mozilla bug 1771561](https://bugzilla.mozilla.org/show_bug.cgi?id=1771561): a fixed historical zero-sized backdrop-filter/dirty-tile interaction is a degenerate-bounds regression seed, not evidence of a Varve defect.

## Implementation and validation update — 2026-10-17

The bounded live-editor slice now has a retained drawable group-source canvas
in `packages/editor/src/render/retainedGroupSurfaceCache.ts`. It is keyed from
the document, group/child/IR object identities and order, world transform and
bounds, color/workspace/page state, and exact backing dimensions. It admits
only direct visible shape leaves with solid/gradient fills, excluding masks,
external image/pattern resources, text, per-item effects/filters, visible group
effects, proofing, warp, and master occurrences. Visible-effect groups remain
on fresh composition so later in-place effect stages cannot mutate a retained
source canvas. Export and thumbnail paths remain fresh.
The retained cap is 32 MiB total and 8 MiB per canvas; active-document changes
or closing a document retire its surfaces.

Two source-audit defects are corrected: `expandReplayList` now builds appended
IR from its expanded dependency IDs, and `RasterLayerCache.acquire` declines an
RGBA surface larger than its entire configured budget before allocating it.
Focused unit tests pass for those paths and cache key identity, drawable hits,
LRU eviction, document retirement, diagnostic bypass, and oversized refusal.

The real-editor Chromium case draws a twelve-shape group, warms it, edits an
independent shape, and asserts that retained hits/avoided shape leaves increase.
It disables the cache, forces a fresh full composition, and verifies an exact
full-canvas pixel-hash match. Seven replay-stage samples measured 0.3 ms median
warm versus 1.0 ms median cache-bypassed in that run. Captures:
[`cached`](../screenshots/dependency-aware-composition/cached.png) and
[`cache-bypassed`](../screenshots/dependency-aware-composition/cache-bypassed.png).
The matching methodology, raw samples, exact command, and limitations are in
[`docs/perf/dependency-aware-composition-2026-10-17.md`](../perf/dependency-aware-composition-2026-10-17.md).

Independent code review found a canvas-aliasing hazard: the existing effect
pipeline mutates group surfaces in place. Retention now excludes groups with
any visible group effect, and the re-review found no stale-pixel/key collision
path inside that admitted boundary. Review also identified delayed release when
the last document closes; a final-session close event now retires and zeroes
that document's retained surfaces immediately, covered by a cache release test.

This remains a narrow product validation: the fixture is drawn through the
editor, not a real imported/customer document. No native WebView, export or
thumbnail differential, delayed-resource race, multi-scale rotation sweep, or
long-session memory-pressure soak was run. The current validation planner also
escalated to a full gate because the shared checkout contains unrelated
workspace/toolchain and validation-infrastructure changes; those unrelated
files were preserved and not included in this task's source changes.

## Implementation order and acceptance

1. Fix dependency IR construction and hard-budget admission, with direct regressions and a real editor scenario where the partial path is eligible.
2. Establish a same-backend, independent fresh-composition reference and profile a real, rights-cleared Varve fixture before choosing a retained group boundary.
3. Retain only a demonstrated expensive source composition whose dependency set and backdrop boundary can be proven. Keep structural, unknown-resource, and destination-dependent cases on authoritative replay.
4. Measure disabled/cold/warm/affected-edit/independent-edit/eviction paths with cache-stage counters, pixels, queue and frame timing, and retained/transient memory.
5. Update architecture/support/marketing wording only to behavior established by code and evidence; keep export and thumbnail paths on fresh authoritative composition unless their snapshot contract is separately proved.
