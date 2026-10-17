# Drawing tools, vector ink and stroke-quality repair — 2026-10-16

**Status:** vertical slices implemented and validated in the repository's own
test suites; browser evidence captured for the vector-ink workflow. Physical
stylus, Tauri/WebKitGTK and non-Chromium browser runs remain unverified and are
called out as such below rather than claimed.

**Branch / worktree:** `fix/drawing-tools-repair` in
`/home/kevina/CodingProjects/varve-drawing-repair` (isolated worktree; the main
checkout was dirty with other contributors' work).
**Base commit:** `284ce7594` (master moved from `b1a34f747` → `284ce7594` →
`0e7f263ab` while this work was in progress; see *Coordination*).

## 1. Scope

This pass repairs the **vector ink** half of the drawing family — Pencil and
Pen creation, their committed geometry, their appearance on the canvas, the
stabilizer, and the shared input helpers those tools use — plus the
**stroke-engine handover path** that long raster strokes depend on, and the
**coverage-paint pressure policy** shared by refine-mask, trimap and
selection-paint.

It deliberately does not re-open the raster dab engine, the compositor, the
brush library, export, or the workspace system. Those were reviewed for
interaction with these changes and left alone.

## 2. Coordination and baseline

Recorded at start: branch `master`, HEAD `b1a34f747` (advanced to `284ce7594`
before the worktree was created and to `0e7f263ab` afterwards), with
pre-existing uncommitted work from several other agents in
`apps/desktop/src-tauri/Cargo.lock`, `packages/codegen/*`,
`packages/editor/src/Shell.tsx`, `packages/editor/src/context/sceneNodeGeometry.ts`,
`packages/editor/src/editor.css`, `scripts/*`, `tests/e2e/presentation/*`,
plus untracked `packages/automation/`, `packages/scene/src/nodeResize.ts`,
`packages/codegen/src/bundle-assets.ts` and others.

None of those paths are modified by this work. All edits are confined to
`packages/editor/src/tools/{fitting,PencilTool,PenTool,brushStroke}.ts`,
`packages/editor/src/render/brushWorkerHost.ts`,
`packages/editor/src/context.tsx` (the `createShapeAt` path branch only),
`packages/editor/src/components/{Inspector/sections/BrushSection,FloatingToolbar/ToolOptionsPopover}.tsx`,
their tests, and `tests/e2e/canvas/vector-ink.spec.ts`.

**Blocking finding (not fixed here — owned elsewhere):** the base commit does
not build from a clean checkout. `packages/scene/src/index.ts` exports
`./nodeResize` and `packages/codegen/src/index.ts` exports `./bundle-assets`,
but neither file is tracked at `284ce7594`/`0e7f263ab`; both exist only as
untracked files in the main working tree. Any fresh worktree or CI checkout
fails to resolve `@varve/scene` and `@varve/codegen`. This work copied both
untracked files into its own worktree to run tests and **never staged them**.
They must be committed by their authors before this branch can integrate.

## 3. Research ledger (accessed 2026-10-16)

`storytold/*` is the reporting tracker family referenced by this work. Issue
bodies and comments were read, not titles.

| Source | Version / state when read | What it supports | Evidence limit | Fix state |
|---|---|---|---|---|
| [FigCraft #341](https://github.com/storytold/figcraft/issues/341) | Open; Windows, FigCraft 0.6.0 | "The Pen Tool is not creating direction handles." | Single report, no reproduction steps, no attached capture, no version-matched follow-up. A contributor replied "i got it" with no diagnosis. | **No fix proposed.** Treated as a symptom class only. |
| [ArtCraft #2111](https://github.com/storytold/artcraft/issues/2111) | Open; Ubuntu 26.04, GNOME Wayland | Pen moves the cursor but contact never registers in native desktop apps; works in the browser build. | The `zwp_tablet_v2` explanation is the **reporter's hypothesis**. It is not a demonstrated Varve root cause: Varve's Linux route is Tauri + system WebKitGTK, whose own pointer translation was not observed here. | No fix proposed; not reproduced. |
| [ArtCraft #2063](https://github.com/storytold/artcraft/issues/2063) | Open; Huion Kamvas Pro 24, Windows x64 | Pressure-driven width "doesn't decrease uniformly". | Descriptive only: no sample stream, no image actually attached to the body, no driver/version data. Cannot distinguish device, driver, curve or algorithm. | No fix proposed. Motivated looking for width-profile loss **in Varve**, which was independently reproduced (§5.3). |
| [PhotoCraft #6443](https://github.com/storytold/photocraft/issues/6443) | Open; 0.9.0 | Large brushes lag; a GPU-utilization spike is visible. | A utilisation spike does not identify the bottleneck or prove which brush stages are GPU-accelerated. Video attached; **not inspected** (no video-reading capability in this pass). | No fix proposed. No Varve perf claim made from it. |
| [PhotoCraft #5282](https://github.com/storytold/photocraft/issues/5282) | Open | Mixer/sampling tools behave only on release; clean/load state is ambiguous. | Not read in full in this pass; not used as a design input. | — |
| [PhotoCraft #5722](https://github.com/storytold/photocraft/issues/5722) | Open, priority high | Selection-tool context menu shows brush options; feather value does not sync; Ctrl+Z does not undo a feather number. | **A maintainer reply rejects all three as defects** against current main and Photoshop: brush-based tools intentionally open the brush picker, the options-bar feather is a tool option and not a History step. Valuable as a *negative* result — it argues against "make every context menu undoable". | Resolved as expected behaviour upstream. |
| [EffectCraft #753](https://github.com/storytold/effectcraft/issues/753) | Open; fix referenced | A tool silently does nothing when its target surface is wrong, and zoom commands act on the wrong viewer. | The report has linked commits/PR (#824, `afdb958`) that address it, so the issue text is partly stale. | **Fix merged upstream** for the zoom/focus half; the "no feedback in an unsupported view" lesson transfers. |
| [DesignCraft issues](https://github.com/storytold/designcraft/issues?q=is%3Aissue+drawing+OR+brush+OR+pen) | Open/closed mix | Filtered search returned 11 results, none about drawing-input correctness; closest transferable item: *"Tool cursors are generic system cursors (Direct Selection, Pen)"* (#438, closed) — tool cursors as a real complaint class. | Title-level survey plus the linked issue; not read in depth. | Closed upstream. |
| [LightCraft issues](https://github.com/storytold/lightcraft/issues) | 422 open | No drawing-input reports on page 1; closest transferable item: *Shift+left-click to draw straight lines with the brush* (#2082). | List-page survey only. | Not applicable. |
| FilmCraft tracker | Not inspected in this pass | — | Listed for completeness; no seed and no drawing-tool relevance identified. | — |
| [W3C Pointer Events Level 3](https://www.w3.org/TR/pointerevents3/) | Recommendation 2026-06-30 | `pointerup` carries the release position; a qualifying `pointermove` between down and up is **not** guaranteed; coalesced/predicted samples are optional and may be empty or throw. | Conformance of WebKitGTK/WebView2 not measured here. | Drives §5.6. |
| [MDN `PointerEvent.pressure`](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/pressure) | Current page | `0.5` is the spec value for a mouse with a button held and can be a default for devices without sensing; one reading proves nothing. | — | Drives §5.7. |
| [Illustrator Pen — curves](https://helpx.adobe.com/ca/illustrator/desktop/draw-shapes-and-paths/draw-shapes/draw-curves-with-the-pen-tool.html) | Official guide | Click-drag from an anchor establishes direction handles; the handle must be visible and editable after commit. | Product reference, not a compatibility contract. | Drives §5.6. |

Krita/Adobe artist reports from the brief ([R6]) were **not** re-fetched in this
pass; the one relevant conclusion (a terminal pressure drop is device-specific
and not proof that every stroke should be tapered) is already reflected in the
decision not to add artificial taper.

## 4. Method

1. Read the current files and callers rather than the historical audits; the
   audits describe intent, the code decides behaviour.
2. Build a symptom inventory from source + a probe harness before changing
   anything (each defect below has a *cause* line that names the exact
   expression).
3. Write the regression so it fails for the defect's reason, then fix.
4. Validate at three levels: unit (geometry/contracts), tool-level (what the
   tool hands `createShapeAt`), and browser (what the artwork layer shows).

## 5. Defects found, causes and repairs

All line references are to the base commit.

### 5.1 A Pencil or Pen tap committed an invisible, zero-point path

**Cause.** `PencilTool.onPointerUp` and `PenTool.commitPath` both handled the
one-contact case with `ctx.createShapeAt(point, { w: 4, h: 4 })`.
`createShapeAt` dispatches on the *active tool*, and for `pen`/`pencil`
`buildShapeWithSize` returns `{ kind: 'path', points: [] }` — a path with no
anchors. The layer appeared in the panel, the tool reported success, and
nothing was ever drawn. The tap also bypassed `commitToParent`, so it landed
outside the frame a stroke would have been parented into.

**Repair.** The tap now goes through the same path branch as a stroke, with two
coincident anchors and the captured pressure, so the ink stroke's round cap
paints a dot (`PencilTool.dotAnchors`, `PenTool.commitPath`). Both tools resolve
the containing frame first.

**Regression.** `PencilTool.test.ts` / `PenTool.test.ts` (tap case);
`tests/e2e/canvas/vector-ink.spec.ts` → "a Pencil tap leaves a visible dot on
the artwork layer" (reads the artwork layer's pixels).

### 5.2 Pencil and Pen paths had no stroke, so the renderer closed and filled them

**Cause.** In `createShapeAt`'s path branch the node was built with
`makeShapeNode(id, shape, { name, transform })`. `makeShapeNode` defaults to
`strokes: []` and an opaque teal fill, and `paintFillsAndStrokes` therefore ran
the fill pass only. `paintPathFill` calls `tracePathRing(target, ring, true)`
for every ring **including open ones**, so the renderer closed the path and
filled it: a straight stroke is a zero-area polygon (nothing rendered at all),
and a curved one became a teal fill rather than ink.

**Repair.** Ink tools (`pen`, `pencil`) now get an explicit stroke — width from
the shared Size control (`brushSettings.radius × 2`), colour from
`foregroundColor`, round cap and join — and a fully transparent fill. Other
tools that reach the same branch (the isometric-plane ellipse) keep the normal
fill behaviour.

**Regression.** `vector-ink.spec.ts` → "a straight Pencil stroke renders as a
stroke, not as a zero-area fill", which asserts ink at the drag midpoint and
**zero** ink 26 px above and below it (so a blob fails too).

### 5.3 Corner detection was inverted: straight runs fragmented, real corners rounded

**Cause.** `fitting.ts#isCorner` returned `angle < CORNER_ANGLE_THRESHOLD` for
the angle *between* the two segment directions. That angle is zero for a
straight continuation, so every collinear sample was treated as a corner (one
Bezier per sample), while a right-angle turn (angle ≈ π/2) was treated as
smooth and got symmetric handles, rounding the corner the user drew.

**Repair.** A corner is a turn *larger* than the threshold:
`acos(dot) > CORNER_ANGLE_THRESHOLD`.

**Measured.** A 41-sample straight run produced **41** anchors before the fix
and **2** after (`fitting.corners.test.ts`). A right angle previously received
a symmetric (`handleIn = −handleOut`) pair; it now splits into two independent
curves.

**Regression.** `fitting.corners.test.ts` (4 tests: smooth run not fragmented,
right angle not symmetrised, long straight run = 2 anchors, corner anchor sits
exactly on the drawn corner).

### 5.4 Variable-width strokes lost their pressure profile in simplification

**Cause.** `simplifyPoints` is pure geometric RDP and `fitPathToBeziers` splits
only on geometric error. A light–heavy–light stroke is perfectly collinear, so
RDP reduced it to its two endpoints and the fitter accepted one Bezier — every
interior pressure sample, and therefore the stroke's only feature, was
discarded. This is the transferable shape of the "line thickness doesn't
decrease uniformly" class of report.

**Repair.** Both stages take an optional pressure tolerance
(`PRESSURE_PROFILE_EPSILON = 0.02`, i.e. 2 % of nominal width):

- `simplifyPoints(points, epsilon, pressureEpsilon)` retains a sample whose
  pressure departs from the linear interpolation of the interval endpoints by
  more than the tolerance. The geometric split still happens at the geometric
  argmax whenever it exceeds `epsilon`, so the classic RDP error bound is
  unchanged; the pressure criterion only adds splits.
- `fitPathToBeziers(points, { maxError, pressureEpsilon })` refuses to collapse
  a run whose pressure profile deviates, splitting at the worst deviation
  instead.
- `PencilTool` passes both, and now also uses the same zoom-derived budget for
  the geometric fit as for simplification, so the committed error is ~2 screen
  px at any zoom instead of a fixed 2.5 world units that grew with zoom.

**Regression.** `fitting.pressure.test.ts` (peak retained; linear ramp still
collapses; geometry-only call is unchanged; no-op without pressure data) and
`PencilTool.quality.test.ts` → "keeps the pressure profile of a straight
light-heavy-light stroke" (asserts the committed anchors, not just non-empty
geometry).

### 5.5 "Stabilization Off" still smoothed, and smoothing shortened the stroke

**Cause (two defects).**

- `setStabilization` mapped strength `s` to `minCutoff = 1 + (1 − s) × 10`, so
  Off (s = 0) ran the one-euro filter at 11 Hz. At a 60 Hz sample rate that
  keeps ≈ 54 % of each new sample: the stroke lagged the pointer and the drawn
  path differed from the gesture even though the user had turned smoothing off.
  (The doc comment claimed the opposite mapping, `1 + s × 10`, so the comment
  and the code already disagreed.)
- The pointer-up sample was pushed through the filter like any other, so the
  committed endpoint was the *lagged* position. Measured on a 240 px drag at
  full strength: the stroke ended **11.6 world px** short of where the pen was
  released.

**Repair.** Strength 0 bypasses the filter entirely (and the cutoff is infinite
if it is ever consulted). The terminal sample is exempt from the stabilizer:
a lag filter may shape the interior of a stroke, but the release point is the
one position that must be exact.

**Regression.** `PencilTool.quality.test.ts` → "stabilization Off is an
identity pass-through", "ends a smoothed stroke under the released pointer"
across strengths 0/0.3/1, and "keeps the interior of the path at the drawn
positions when Off".

### 5.6 Pen direction handles existed only if a pointermove delivered them

**Cause.** Handles were computed in `onPointerMove` only. Pointer Events
guarantee that `pointerup` carries the release position; they do **not**
guarantee a qualifying `pointermove` between down and up (fast flick, coalesced
frame, busy main thread). Such a drag became a corner point — the shape of the
FigCraft #341 report.

**Repair.** The handle computation moved into `applyHandleDrag` and is called
from both `onPointerMove` and `onPointerUp`, so the geometry is identical
whether the displacement arrived in a move or in the release. A
`pointerup` at the anchor still yields a corner.

**Regression.** `PenTool.test.ts` → "creates the same handles when the drag is
only reported by pointerup" (asserts byte-identical handles to the move case);
`vector-ink.spec.ts` → the synthetic release-only sequence (labelled synthetic)
asserts ink exists off the chord.

**Also fixed:** closing by clicking a lone anchor committed a one-anchor closed
path; closing now requires two anchors.

### 5.7 Coverage-paint pressure ignored the user's setting and inflated light strokes

**Cause.** `brushStroke.ts#effectivePressure` had its own policy: it floored any
positive pressure to `0.05`, substituted `0.5` for a pen at zero and `1` for
everything else, and never consulted `pressureEnabled`. Consequences: a 0.02
pen touch deposited at 0.05 (2.5×), a user who disabled pressure still got
pressure response, and a mouse deposited at 1 or 0.5 depending on which value
the browser reports for `pressure`.

**Repair.** One policy, documented in the module:

- pressure disabled → nominal deposit;
- pen/touch with a positive reading → the reading as-is (no floor);
- pen/touch at zero → real zero **only** once observed capability has shown
  more than one distinct pressure value (`getObservedInputCapabilities`), else
  nominal (a pressureless pen must still paint);
- mouse/unknown → nominal, independent of the browser's 0-vs-0.5 default.

This tool family maps pressure to *deposit opacity*, not tip width, so its
nominal is 1 rather than the raster brush's 0.5 — a deliberate, now documented
difference rather than a drifted copy.

**Regression.** `brushStroke.test.ts` → 5 pressure-policy tests, including
"keeps a legitimately light pen sample light" and "lets a mouse deposit the
same amount whatever the browser reports".

### 5.8 `interpolateStrokeSegment` forwarded invalid coordinates and could allocate without bound

**Cause.** The non-finite guard returned `[{ x: to.x, y: to.y }]` — it
*forwarded* a NaN/Infinity destination as a valid sample. `ceil(distance /
spacing)` was allocated with no ceiling, so a malformed or absurd coordinate
(e.g. 1e9 with 1 px spacing) allocated an array of that size.

**Repair.** An invalid destination yields **no** points; an invalid origin with
a valid destination yields just the destination. Steps are capped at
`MAX_INTERPOLATED_SEGMENT_POINTS = 4096`; beyond that the *step widens* rather
than truncating, so the segment stays covered instead of leaving a silent gap.

**Regression.** `brushStroke.test.ts` → invalid-sample, bounded-allocation
(1e9 px), and malformed-spacing cases.

### 5.9 Long strokes: the replay window was truncated silently

**Cause.** `brushWorkerHost` retains confirmed points so a mid-stroke handover
can rebuild the engine at the right spacing/arc-length/jitter. Past
`REPLAY_POINT_CAP` (20 000) it stopped retaining (`replayTruncated`) but kept
dispatching to the worker. A later fallback then replayed an *incomplete*
prefix: the fresh engine's arc-length carry and jitter offset were wrong, so
the rest of the stroke was deposited at the wrong spacing — a discontinuity no
unit test of the engine can see, and one the architecture doc described as
seamless.

**Repair.** Before dispatching a batch that would cross the cap, the stroke
migrates to the main thread **while its prefix is still complete**
(`migrateToSync`), so the rebuild is exact. The worker's copy is cancelled and
its late responses are dropped by the existing sequence check. The residual
truncation path remains as a defensive guard, now warns, and is counted
(`replayTruncations`) instead of being silent. Main-thread strokes stop
retaining input at all, which also removes unbounded growth for long gestures
(`recordConfirmed` returns early once `syncOnly`).

**Regression.** `brushDispatch.test.ts` → 4 "replay window" tests: handover
produces dabs **identical** to an uninterrupted `runWholeStroke`, exactly 8
worker batches are dispatched before the handover, a stall at the boundary is
still exact, and a response that arrives after the handover is dropped
(measured via `staleResponsesDropped`) with each batch applied once.

## 6. Tool coverage map

Reachability was read from the registries (`tools/toolRegistry.ts`,
`workspace/toolbarComposition.ts`, `ToolOptionsPopover`) and the workspace
configuration. "Runtime" is what this pass actually exercised.

| Tool | Family | Target rules | Output | Undo | Mouse/pen/touch | Runtime in this pass |
|---|---|---|---|---|---|---|
| Pencil | vector ink | containing frame or active surface; ink stroke | editable `path` with pressure per anchor | one step per stroke | all three; pressure opt-in | **unit + tool + Chromium E2E** |
| Pen | vector ink | containing frame or active surface; ink stroke | editable `path`, cubic handles | one step per path | all three | **unit + tool + Chromium E2E** |
| Pen construction actions (finish/close/cancel/undo anchor) | vector ink | draft only | commits or discards the draft | one step | pointer + toolbar | unit (existing) |
| Node edit (direct selection) | vector edit | selected path | anchor/handle edits | one step per drag | all three | reviewed only (existing tests pass) |
| Paint | raster | `paintTarget` resolver | 128² RGBA tiles | one step | all three | reviewed; existing suite |
| Eraser | raster | `paintTarget` | alpha removal | one step | all three | reviewed; existing suite |
| Smudge | raster sampling | `paintTarget` | moved pigment | one step | all three | reviewed; existing suite |
| Clone / Heal / Spot Heal / Patch | raster retouch | `paintTarget`, explicit source scope | tiles | one step | all three | reviewed; existing suite |
| Dodge / Burn | raster | `paintTarget` | exposure on existing pixels | one step | all three | reviewed; existing suite |
| Refine mask / trimap edit | coverage paint | mask asset + space | coverage values | one step | pressure → opacity | **unit (regression updated)** |
| Selection paint | coverage paint | area selection | selection coverage | one step | pointer | reviewed |
| Marquee / ellipse marquee / pixel lasso / lasso | selection | analytical selection | `AreaSelection` | one step | all three | reviewed; existing suite |
| Magic wand | selection | renderer snapshot / current | `AreaSelection` | one step | pointer | reviewed; existing suite |
| Eyedropper / pixel probe | sampling | visible artwork | colour state | none (not a doc edit) | pointer | reviewed |
| Line / arrow / rect / ellipse / polygon / star / frame / panel / slice / table / text | shape construction | active surface / frame | shape or container | one step | all three | reviewed; existing suite |
| Pan / zoom / rotate / knife | navigation & edit | viewport / geometry | camera or split | knife only | all three | reviewed |

Not exercised in this pass and therefore not claimed: physical pen pressure,
palm rejection, Tauri/WebKitGTK input, PWA install-window geometry, Firefox and
WebKit visual parity, and every raster tool's runtime behaviour on real
hardware.

## 7. Policies this pass fixed in place

- **Pencil/Pen ink appearance** — stroke only, transparent fill, round cap and
  join, width = 2 × the shared Size value, colour = foreground swatch.
- **Stabilization** — 0 is exactly identity; > 0 is a one-euro lag filter; the
  terminal sample is never filtered.
- **Pressure** — raster brush: nonlinear width curve, 0.5 nominal. Coverage
  paint: deposit opacity, 1 nominal, no floor, capability-aware zero. Vector
  pencil: per-anchor pressure through simplification and fitting with a 2 %
  retention tolerance.
- **Zoom-aware fitting** — both simplification and Bezier fitting use the same
  ~2 screen-px budget, derived per gesture from `ctx.zoom`.
- **Replay window** — 20 000 retained points; crossing it migrates the stroke
  to the main thread with a complete prefix, never truncates silently.
- **Coverage interpolation** — ≤4096 points per segment; the step widens rather
  than the segment being cut.

## 8. Validation record

See the Agent Validation Report at the end of the session report. Exact
commands, results and skips are recorded there so this document stays a
description of behaviour rather than a claim of coverage.

## 9. Limits

- No physical stylus or tablet was available: pressure behaviour is verified
  with synthetic values and the repository's normalizer, not with hardware.
- The Pen handle fix was verified with a synthetic release-only pointer
  sequence. Whether a given platform actually delivers that event shape was not
  measured; the fix removes the dependency rather than claiming the platform.
- The ArtCraft #2111 (Wayland tablet protocol) path is **not** addressed. Varve
  receives WebKitGTK-translated pointer events; if the compositor never
  delivers contact, no JavaScript-side change can recover it.
- The corner/pressure fixes change committed geometry for existing documents
  only when a path is re-created; stored documents are untouched.
- The `PhotoCraft #6443` large-brush latency class is untouched by this pass.
- HEAD's missing `nodeResize.ts` / `bundle-assets.ts` block any clean checkout;
  that is a release blocker for this branch but not owned by it.

## 10. Follow-ups (not done here)

1. Commit the two missing modules so the workspace builds from a clean
   checkout.
2. Inspector/tool-option parity: the Pen exposes Size only; opacity/line style
   for vector ink is still edited through the general shape inspector.
3. A vector-ink shape needs a stroke *style* editor (dash, join, cap) rather
   than inheriting the raster Size control; the shared field was the honest
   minimum, not the destination.
4. The refine-mask/trimap brush still ignores the user's pressure **curve**
   (its pressure maps to opacity, not width). Decide whether the curve should
   apply there, and if so apply it once in the shared helper.
5. Context menus: verify each drawing tool opens its own menu (selection menu
   for selection tools, brush picker only for brush-based tools) — the
   PhotoCraft #5722 maintainer reply is the reference behaviour.
