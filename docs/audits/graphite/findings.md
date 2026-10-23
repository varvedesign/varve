# Findings — Graphite corpus

Findings are grouped by the Varve mechanism they touch. Each finding keeps the
chain the brief requires: external evidence → user problem → applicable Varve
workflow and code path → observed Varve behaviour → intended outcome →
implementation decision → acceptance criteria → evidence.

Engineering status is separate from research status. A finding marked
`blocked` or `uncertain` is unfinished work, not an exclusion.

---

## F1 — Shift does not constrain object movement (implemented)

**External evidence.** Graphite #4246 ("Hold Shift to constrain dragging with
Select Tool no longer has 45° increments", open, Design) reports that
Shift-drag used to offer 45° travel and now only offers the X/Y axes; the
thread's users ask for 45° back and discuss how to expose finer angles. The
linked earlier issue #402 was closed, and the reporter states the 45° case was
lost in a later change — a regression in a documented interaction rather than
a missing feature.

**User problem.** A designer holding Shift while dragging expects the object to
travel along a clean direction. Without it, alignment work depends on snapping
or on the Inspector's numeric fields.

**Applicable Varve workflow and code path.** `SelectTool`'s move gesture.
`InteractionSession` defines `axisLock` (`'none' | 'x' | 'y'`) with
`setAxisLock()`, and `SelectTool.onDragEnd` documents "Shift also locks the
drag axis". `worldDragDelta()` in `BaseTool` however returned the raw pointer
delta, and no module ever read `axisLock` — the field had no consumer anywhere
in the codebase. The documented contract in
`docs/architecture/input-system-behavior-matrix.md` ("Constrain … Shift … while
drawing or transforming") was therefore unimplemented for movement. Drawing
tools were unaffected: `computeDragRect` already constrains to a square.

**Observed Varve behaviour (before).** A Shift-drag moved on both axes exactly
like an unconstrained drag; only snapping could align the result. Reproduced in
Chromium with the probe recorded in this audit's batch table.

**Intended outcome.** Shift constrains a move to the nearest 45° direction. A
drag within 22.5° of an axis stays on that axis; a deliberate diagonal travels
at 45° and keeps both components. An explicit `axisLock` (for example from the
tablet Constrain control) wins over the modifier. Snapping may refine the
position along the constrained direction but must never move the object off it.

**Implementation decision.** A pure module `tools/axisConstraint.ts` resolves
the constraint from the live modifier state and the interaction snapshot and
projects travel onto the snapped direction. `SelectTool` uses it for the live
preview, the drag-end reparent decision and the snap adjustment;
`PageTool` uses the same rule for page placement on the pasteboard (page
*resize* deliberately keeps the raw delta, because a directional lock would
stop the perpendicular edge from following the pointer). This gives the
existing `axisLock` field its first real consumer instead of adding a second
parallel concept.

**Second root cause found while validating (same finding).** A constraint is
only useful if the gesture survives to use it. `SelectTool.beginMoveGesture`
routed the pointer-down through the ordinary hit-selection path, where Shift
*removes* an already-selected node. Pressing Shift before the drag therefore
deselected the object and left the move with no targets — the constraint
would have been unreachable for the documented workflow ("select, then
Shift-drag"). The drag path now treats Shift as "keep this target in the move"
and leaves the toggle to the click path, which still toggles exactly as
before. Independent review flagged this as a blocker for the change; it is
fixed in the same batch.

**Acceptance criteria.**
1. Near-axis Shift-drag: perpendicular component is zero, along-axis travel
   tracks the pointer.
2. 45° Shift-drag: both components preserved, |dx − dy| < 2 px.
3. Unconstrained drag unchanged.
4. The constrained drag remains a single undo step.
5. Explicit axis lock overrides the modifier.

**Evidence.** `packages/editor/src/tools/axisConstraint.ts`,
`packages/editor/src/tools/__tests__/axisConstraint.test.ts` (10 cases),
`tests/e2e/canvas/shift-constrained-move.spec.ts` (4 Chromium cases),
`SelectTool`/`PageTool`/`ToolManager` suites (97 tests). The E2E spec draws
with the rectangle tool and must return to Select (`v`) before the gesture
under test; shape tools stay active after drawing, so without that the drag
creates squares instead of moving a selection. An earlier revision of the spec
omitted it and failed, which is why the case is now explicit.

---

## F2 — Enter does not confirm the New Design dialog (implemented)

**External evidence.** Graphite #3601 ("Enter fails to confirm in the New
Document dialog after editing values", open, Good First Issue / Paper Cut):
"hitting enter after typing the name, or the resolution, should confirm … It
currently works only if those values haven't been changed." A second user
agrees; a maintainer links a pending PR. The same complaint appears in #3605.

**User problem.** A keyboard-driven user starts the task with the keyboard
(typing a name or a size), then has to reach for the mouse to finish it. The
inconsistency — Enter works before you edit a field and stops working after —
is what makes it feel broken rather than merely unfinished.

**Applicable Varve workflow and code path.** `@varve/home`
`NewDesignDialog`. Its `handleDialogKeyDown` explicitly returned early for any
`input`, so Enter in the document-name field, the custom width/height fields,
the print bleed/DPI fields and the presentation size fields did nothing. The
dialog's Create button is the only way to confirm after typing. The dimension
fields are `@varve/ui` `NumberInput`, which commits its dirty text on Enter and
stops there — so the dialog also could not simply create on the same event
without using a stale value.

**Observed Varve behaviour (before).** Enter in the name field did not create.
Enter in a dimension field committed the number but did not create.

**Intended outcome.** Enter confirms the dialog from a text or number field.
Controls that own Enter keep it: textareas (newline), buttons, listbox options,
and the preset-name row, where Enter saves the preset being named. Enter during
an active IME composition is ignored.

**Implementation decision.** The dialog now treats Enter in a text/number field
as the submit gesture. For `NumberInput` the pending commit is flushed before
the create action is read, and the create action is read through a
latest-render ref so it uses the value the user just typed rather than the
pre-edit value. The Create button's disabled expression was extracted to a
single `createDisabled` value shared by the button and the key handler, so
Enter can never create a document the button would refuse.

**Acceptance criteria.**
1. Enter in the name field creates with the typed name.
2. Enter in a dimension field creates with the typed dimension.
3. Enter in the preset-name row saves the preset and does not create.
4. Enter during IME composition does nothing.
5. Existing pointer-driven creation paths unchanged.

**Evidence.** `packages/home/src/NewDesignDialog.tsx`, five new cases in
`packages/home/src/NewDesignDialog.test.tsx` (21 total, package suite 215).

---

## F2b — Enter in the preset search must not create the document (implemented, found in review)

**Origin.** Independent review of the F2 change.

**Problem.** `PresetPicker`'s search field is a `combobox` that consumes Enter
to select the highlighted preset and calls `preventDefault()` without stopping
propagation. F2's first revision excluded only textareas, buttons and listbox
roles, so typing a query and pressing Enter both applied the preset and created
the document — a regression against the previous "Enter does nothing in
inputs" behaviour and a violation of F2's own acceptance criterion that
controls owning Enter keep it.

**Fix.** The handler returns when the event was already default-prevented,
after the number-field branch (whose `NumberInput` also prevents default and
must still submit). Covered by a jsdom case that types into the preset search
and asserts the preset is selected without creating a document.

**Evidence.** `packages/home/src/NewDesignDialog.tsx`,
`packages/home/src/NewDesignDialog.test.tsx` (22 cases).

---

## F3 — Repeated nudges cost one undo each (decided: keep per-press entries)

**External evidence.** Graphite #2617 ("Nudges in the same direction should be
combined in history", open, Architecture / Paper Cut): five Shift+Right taps and
three Right taps should collapse so one undo returns to the start; a direction
change or any other edit starts a new point. A maintainer replies that the
cloned-document history must be refactored first, because merging steps is not
expressible in it.

**What Varve does today.** A *held* arrow key is one entry: the nudge controller
opens one transaction while a direction is held and commits when it is released.
Each discrete tap is its own entry, so N taps produce N entries.

**Decision: do not merge taps.** Per-press entries are the final behaviour. The
reasons are specific to Varve, not a preference:

1. **The undo unit is a gesture.** `context/useGestureTransaction.ts` gives
   sliders, colour pickers and keyboard stepping one entry per gesture and
   states the rule explicitly: "Deliberately not time-based: a merge window
   would also fuse two separate, intentional edits made in quick succession.
   Gesture boundaries are what the user perceives as one action." A key press is
   a complete gesture; merging a run of them needs a boundary that is not time.
2. **The remaining boundary option fights the controller's contract.**
   `planNudgeRepeat` validates each repeat against the positions the session
   *expects next*, and the controller clears its session on key release. Keeping
   a burst open therefore means either reworking that expected-position model or
   leaving a transaction open across unrelated actions.
3. **A half-working burst merge is worse than none.** Three implementations were
   attempted in this work and each failed at a different boundary — the session
   cleared on key-up, the next repeat declined because the expected position no
   longer matched, and a burst split silently into two entries. Every variant
   either lost a press or split a burst, and a user who cannot predict which
   edits share an undo can lose an intended state. It was reverted rather than
   shipped.

**What serves the underlying need instead.** The need behind #2617 is coarse
movement without a stack of undos. Varve already answers it: holding the key is
one gesture and one undo entry; Shift+Arrow moves by the large step (and the
step is configurable in Settings); and the Inspector's X/Y fields take an exact
value in one edit. The documentation now names those routes rather than implying
that repeated taps should be free.

**Prerequisite if this is ever revisited** — a scoped design task, not a fix:
a nudge-session model that survives key release with per-repeat expectations, a
transaction-boundary rule that closes on the next command while still
finalizing the deferred commit and the persistent-history capture exactly once,
and a deliberate change to the documented gesture contract above.

## F4 — Confirmed existing protections (no change needed)

| Graphite evidence | Varve mechanism | Verification |
|---|---|---|
| #699, #1043, #1635 — transform/zero-scale crashes | Inspector clamps W/H; degenerate transforms are handled without a crash; undo restores a usable shape | Chromium probe: set W and H to 0, undo twice, shape returns to 220×150 and a new rectangle can still be drawn |
| #2279 — restore prior selection after aborting a marquee | `SelectTool.onKeyDown` Escape path cancels the gesture without touching the committed selection, because object marquee selection is deferred until pointer-up | Source inspection of the documented behaviour plus the Escape branch |
| #3599 — Delete does not work with some tools | Delete is handled above the tool layer for a selected layer; the pen tool does not swallow it | Chromium probe: select a layer in the panel with the pen tool active, press Delete, layer count goes to 0 |

These are recorded as `already-handled` evidence, not as proof that the whole
Graphite finding class is absent from Varve.

---

## F6 — The public changelog hid every release summary (implemented)

**Origin.** Not a Graphite finding. Found while validating the F2 website
change: the website unit lane failed on `origin/master` before this branch
touched anything, and the failure blocked the repository's affected gate.

**User problem.** Every release's summary paragraph — the part that says what
the release changes and any migration consequence — was missing from
`varve.studio/changelog`. The 0.5.1 page never mentioned the updater behaviour
its own source text describes.

**Root cause.** `parseChangelog` ignored all lines between a version heading
and its first `###` category, which is exactly where Varve writes summaries.
Separately, `parseChangelogFile` resolved the repository root by walking two
levels up from the working directory and accepting the first readable
`CHANGELOG.md`; in a nested worktree that is the *parent* checkout, so the page
and its test could describe a different tree than the one being built.

**Fix.** Summary paragraphs become a leading `Summary` section (rendered
without a category heading, so it reads as an introduction), and root
resolution walks up but accepts only a directory containing both `CHANGELOG.md`
and `apps/website/package.json`.

**Acceptance criteria.**
1. A summary under a version heading appears in that release's parsed output.
2. The parser resolves this checkout's changelog when run from a worktree.
3. The changelog page shows the 0.5.1 summary with no new heading.
4. Existing releases and categories parse unchanged.

**Evidence.** `apps/website/src/lib/changelog.ts`,
`apps/website/src/pages/changelog.astro`,
`apps/website/src/test/changelog.test.ts` (24 cases, one new), website unit
suite 310/310, rebuilt page inspected at 1440x1200.

---

## F7 — Hidden fill stayed painted and clickable (implemented)

**External evidence.** Graphite #2554 ("Path tool click targets erroneously
include hidden 'Path' node modifications", closed): "When generating click
targets, hidden nodes such as the Path node need to be bypassed." Maintainers
confirmed it was fixed upstream. The corpus also carries #1736 ("Filled but open
shapes don't have click targets for their fill"), which turned out to be the
opposite half of the same story in Varve — see the "already handled" note below.

**User problem.** Turning a shape's fill off in the Inspector left it painted.
The user hides a fill, sees no change, and the shape still takes clicks across
its whole bounding box. Two independent mechanisms produced that:

1. **Rendering.** `buildIr` filtered invisible fills out of the stack, so an
   all-hidden stack arrived at replay as an empty array. Replay reads an empty
   or absent stack as "this node has no fill stack" and falls back to the node's
   legacy `fill` colour — painting exactly the fill the user had hidden. The
   native builder (`crates/varve-engine`) clones the stack verbatim, so the two
   renderers disagreed; the TypeScript path was the wrong one.
2. **Hit testing.** `isTransparentFill` decided whether the bounding-box
   fallback may claim a node, and it only looked at colour alpha. A fill that
   was hidden, had zero opacity, or arrived through `paintRefs` therefore kept a
   click target across the whole box even when nothing was painted.

**Observed Varve behaviour (before).** With the fill toggled off in the
Inspector, a canvas pixel read at the shape's interior was still the fill
colour (`57,208,198,255`) after a camera nudge, a zoom reset and an unrelated
edit — so it was not a stale-frame artifact. Clicking that interior selected the
shape.

**Intended outcome.** A hidden fill paints nothing and claims no target; the
outline of a shape that still has a stroke remains clickable; a visible fill
behaves as before.

**Implementation decision.** Keep invisible entries in the IR stack so "stack
exists but nothing is visible" is distinguishable from "no stack", and let
replay skip them per fill — the behaviour the native builder already had.
Replace the alpha-only transparency check with the renderer's own semantics
(`resolveNodePaints` + `fillPaintsVisibleArea`: visible, non-zero opacity, and
for solid fills a colour with alpha), so click targets follow painted pixels.

**Acceptance criteria.**
1. Hiding the last visible fill changes the canvas pixels at the shape interior.
2. The same shape no longer takes a click there.
3. Re-showing the fill restores both the pixels and the click target.
4. A fill stack with a mix of hidden and visible entries still paints only the
   visible ones.
5. The IR keeps hidden entries (native/web parity), and replay paints nothing
   for an all-hidden stack.

**Evidence.** `packages/engine/src/engine.ts` (stack mapping),
`packages/editor/src/hitTest/HitTestEngine.ts` (`paintsNoFill`),
`packages/scene/src/paint.ts` (`fillPaintsVisibleArea`); unit coverage in
`packages/engine/src/engine.test.ts`, `packages/engine/src/replay-fill.test.ts`,
`packages/editor/src/hitTest/__tests__/HitTestEngine.test.ts`,
`packages/scene/src/paint.test.ts`; browser coverage in
`tests/e2e/canvas/hidden-fill-click-target.spec.ts`, which reads a canvas pixel
as the rendering oracle and was verified to fail against the previous
behaviour (the hidden-fill click selected the shape before the fix).

**Already handled, with mechanism (checked, not assumed).** #1736 asks for a
click target inside a filled *open* path. Varve already provides one: the click
policy's bounding-box tolerance fallback accepts the interior of any node that
paints a fill. A fill-aware interior test was written first and then reverted
because the E2E passed with it disabled — it changed no user-visible behaviour.
The reverted work is recorded here so the same idea is not re-implemented.

---

## F8 — Keyboard path from "text selected" to "typing" (implemented)

**External evidence.** Graphite #3637 ("With the Text tool active and a text
layer selected, Enter should begin editing it") and the pull request that
closes it, GraphiteEditor/Graphite#4756, which maps Enter in the Text tool's
ready state to the tool's edit action and notes that Ctrl+Enter does the same in
Graphite's Select tool. Varve had no keyboard path: the only ways into a text
session were a click that creates new text, or a double-click on existing text.

**User problem.** A keyboard user who has selected a text layer has to reach for
the mouse to start typing, which is the same papercut class as F2.

**Varve-specific constraint (why plain Enter was not taken).** Varve binds Enter
and F2 to *renaming the selected layer* in the canvas input pipeline. Taking
plain Enter for text editing would remove a documented shortcut, so the text
path uses **Ctrl/Cmd+Enter** instead — the chord Graphite's own PR notes as
working in its Select tool. The Text tool runs before the rename branch, so the
modifier decides which action wins, and a browser case pins that plain Enter
still renames with the Text tool active.

**Implementation decision.** `TextTool.onKeyDown` claims Ctrl/Cmd+Enter when
exactly one text layer is selected, flushes buffered edits, closes any open
transaction, and sets the edit target — the same entry the click path uses. A
multi-selection and an already-editing target are left alone.

**Acceptance criteria.**
1. Ctrl/Cmd+Enter with the Text tool active and one text layer selected opens
   the editing surface.
2. Plain Enter still opens the rename dialog and opens no text session.
3. A multi-selection, a non-text selection, a repeat key and an already-editing
   target all decline the chord.

**Evidence.** `packages/editor/src/tools/TextTool.ts`,
`packages/editor/src/tools/__tests__/TextTool.test.ts` (7 cases),
`tests/e2e/canvas/text-tool-enter-edits.spec.ts` (2 Chromium cases).

**Operational note for future browser specs.** Tool key handlers are routed from
the *focused canvas*. Selecting a layer through the Layers panel leaves focus on
the row, so a spec that then presses a tool key observes nothing — the handler
never runs. `tests/e2e/canvas/object-marquee-selection.spec.ts` already calls
`canvas.focus()` for this reason; this spec does too. The failure mode is silent
(no error, no effect), which cost several runs here, so it is recorded rather
than rediscovered.

**Related, now implemented.** The same PR set carried the clipboard flavour that
lets other applications paste a Varve selection as vectors; that work is
recorded as F9 below.

---

## F5 — Observations that are not (yet) Varve work

- `InteractionContext.axisLock` was dead code until F1 gave it a consumer.
  Any future modifier feature should check whether an existing field is
  supposed to carry it before adding a second concept.
- `packages/editor/src/context/useHistory.ts` is an orphan duplicate of the
  history implementation in `context.tsx`: only its own test imports it, and
  its semantics differ (no nesting depth, no persistent routing, no label
  stack). It is a maintenance hazard, not a user-visible defect. Removing it
  requires checking no future path intends to adopt it; recorded here rather
  than deleted inside an unrelated batch.
- Graphite's remaining corpus is dominated by its node-graph engine
  (Graphene), GPU node buffers, web-only stack and Graphite-internal tooling.
  Those areas have no Varve counterpart; per-issue reasons are recorded in the
  ledger instead of being summarised away here.

---

## F9 — Copy offered other applications nothing they could paste (implemented)

**External evidence.** Graphite #2373 ("Copy/pasting vector and raster content
between other graphics apps") and GraphiteEditor/Graphite#4499, the open pull
request that resolves it by putting an `image/svg+xml` representation on the
clipboard beside the internal payload. The PR's discussion also records the
host limitations: the type is not broadly supported by Firefox and Safari, and
desktop wrappers need their own interception.

**User problem.** Copying artwork in Varve and pasting into Inkscape, Krita,
Illustrator or Figma produced layer *names* as text. The editable
`application/vnd.varve+json` payload means nothing to those applications, and
`text/plain` is the only other representation written. A separate "Copy as SVG"
command existed, but a user who pressed the normal copy shortcut had no way to
know that.

**Implementation decision.** An ordinary Copy now also writes `image/svg+xml`:

- The payload comes from the existing per-root exporter the "Copy as SVG"
  command uses (`exportNodeToSvg` with `background: 'transparent'`, world
  transform baked into each root, multiple roots grouped under a union
  `viewBox`). Exporting a synthetic document instead emits the white page
  backdrop and loses per-node identity, which is why that approach was
  abandoned during implementation rather than shipped.
- The flavour is optional at the writer: `writeClipboardOutcome` takes the
  source document as a trailing argument, so callers without scene context
  (tests, guides) keep the previous behaviour exactly.
- It is bounded (`CLIPBOARD_SVG_MAX_NODES`, `CLIPBOARD_SVG_MAX_BYTES`) and
  best-effort: any exporter failure, oversized selection or missing mask source
  drops the flavour and never the editable payload. The browser path keeps its
  unprefixed retry, so a host that rejects a type still gets an editable copy.
- In-app paste is unchanged: readers already prefer the Varve payload, so the
  extra representation cannot reduce fidelity.

**Acceptance criteria.**
1. Copy writes `image/svg+xml` alongside the editable payload when a source
   document is available.
2. The SVG contains the selected artwork only, uses world-space bounds, and
   carries no page backdrop.
3. Without a document the flavour is absent and behaviour is unchanged.
4. The browser `ClipboardItem` carries the same type.
5. An oversized selection drops only the flavour.

**Evidence.** `packages/editor/src/clipboardSvg.ts` (6 unit cases),
`packages/editor/src/clipboard.test.ts` (43 cases, including the native and
browser write paths), `tests/e2e/canvas/clipboard-svg-flavour.spec.ts` (copies a
rectangle in Chromium and reads the SVG back from the real clipboard; verified
to fail before the change).

**Website.** `apps/website/src/pages/features/clipboard.astro` described the
separate command as the interoperability route; it now states that an ordinary
Copy carries the SVG representation, with the size ceiling and the host's
permission/MIME dependence disclosed.

---

## F14 — SVG user-space gradients lost their geometry origin (implemented; browser verified)

**External evidence.** [Graphite #2524](https://github.com/GraphiteEditor/Graphite/issues/2524)
and its ten comments distinguish importing an actual SVG from importing a PNG
preview. The reported radial field uses numeric `userSpaceOnUse` coordinates;
the linked [gradientUnits contract](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/gradientUnits)
places that field in the referencing element's user coordinates, followed by
`gradientTransform`. Percentages instead depend on the SVG viewport.

**Varve reproduction.** A File Import fixture with a rectangle at (200,100)
and a black-to-white field from (200,140) to (400,140) read red-channel 0 at
quarter width, rather than 45–85. This was a real content-canvas measurement,
not a scene-only assertion. The original failure screenshot was read, but
Import Results obscured the rectangle; the strengthened browser check closes
that dialog and records alpha plus RGBA samples before its colour assertions.

**Cause and repair.** The element converters move intrinsic geometry offsets
into the node transform: x/y for rectangles, centres for circles/ellipses,
first point for lines, fitted centre for polygons, minimum for polylines, and
x/y for text. User-space fill matrices were left in the old space. Conversion
now carries an ephemeral `geometryOrigin`, and fill import subtracts it after
`gradientTransform`. The document model, node transforms and rendering code
are unchanged. Inverting the whole node transform would incorrectly cancel
authored element/group/viewBox transforms, and would fail for singular ones.
Paths keep their original coordinates; objectBoundingBox mapping is unchanged.

**Evidence so far.** `packages/import/src/svg-user-space-gradient.test.ts`
failed 12 of 15 cases before the repair. With the repair, it, the existing
`svg.test.ts`, and `brush-alpha-fidelity.test.ts` pass all 53 tests. Cases cover
numeric linear/radial fields, rebased primitive converters, authored affine
transforms, import scale, nested groups/root viewBox, `<use>`, singular
transforms, matrix order, and unchanged path/objectBoundingBox controls.
Real-app linear and radial pixel checks live in
`tests/e2e/import/svg-user-space-gradient.spec.ts`.

**Limits and status.** This is not a claim of general SVG fidelity. User-space
percentages still carry the existing approximation warning, and off-centre
radial focal points remain approximate. The exact issue sample also inherits
paint from a group; this separate importer boundary is source-inspected but
not repaired or verified here. #2524 therefore stays applicable work rather
than being marked wholly handled. The first browser run used the TS fallback
after a WASM-load warning; native/WASM validation is not established. The
complete affected gate and integration evidence remain pending; see `paint-batch.md`.
The implementation is committed locally as `856fdc25f`.

**Rendered follow-up.** The first repaired-parser browser run still failed both
pixel cases. Unobscured screenshots were read: the handles were centred on the
correct geometry but both shapes remained opaque black. F15 below identifies
the independent replay defect; parser-only success was not a rendered fix.

With both repairs, both real File Import cases passed. Inspected screenshots
show a left-to-right black/white rectangle and a centred white/black radial
circle, with no dialog obscuring the artwork:
[linear](../../screenshots/graphite-corpus/svg-user-space-linear-fixed.png),
[radial](../../screenshots/graphite-corpus/svg-user-space-radial-fixed.png).
Opaque content-canvas samples passed their asserted ranges. Separate samples
from the saved linear PNG are (65,65,65,255) at quarter width and
(193,193,193,255) at three-quarter width. An isolated Vite control disabling
only importer rebasing, while keeping F15, failed both pixel checks as expected;
its mutation log and both screenshots were inspected. The retained
[control](../../screenshots/graphite-corpus/svg-gradient-no-origin-linear.png)
shows the misplaced field. No production source was edited for that control.

---

## F15 — Canvas gradient coordinates were transformed twice (implemented; browser verified)

The #2524 reproduction exposed a second boundary: `replayGradient.ts` applied
`getTransform()` to already-local gradient endpoints/centres, then passed those
points to native Canvas2D constructors. Those constructors capture the current
user-space transform themselves. With translated artwork, the field was moved
again, so the shape painted its first stop (black in the fixture). It affected
linear/radial/angular/diamond fields and the shared gradient-stroke evaluator,
not just SVG import.

Five nonidentity-CTM constructor/cache tests in
`packages/engine/src/replayGradient.userSpace.test.ts` all failed before the
repair. The repair removes that extra projection; it does not reset the canvas
transform, alter the gradient matrix, or drop CTM identity from cache keys.
The new tests, existing `replay-fill.test.ts`, and parser regressions pass
**105 tests in three files**. The corrected real-app run passed all **14 cases**:
the two imported gradient pixel checks, stop selection, brush fringe, gradient
drag undo/redo, interpolation/transparency/hue, export, keyboard accessibility,
and narrow-viewport bounds. The parser-only
[failure screenshot](../../screenshots/graphite-corpus/svg-gradient-double-ctm-linear.png)
and fixed F14 screenshots were inspected. No dispatcher, scene schema, renderer
API or pixel-reuse logic changed. Commit `3b5bd3e99` is local; targeted replay
visuals at DPR 1/2/3, complete affected validation and integration are unfinished.

**Translated golden review.** The targeted replay run passed nine neighbours
but failed the translated-linear golden at all three DPRs (1,726 pixels each).
Expected/current/diff images were inspected: the golden retained the old
double-CTM field displacement. Before accepting any image, the new
`tests/e2e/canvas/gradient-translation.spec.ts` compared a live gradient with
the same artwork translated 40px, cropping back into local space. All RGBA
bytes match at DPR 1/2/3. Restoring only the old linear CTM projection through
an isolated Vite plugin makes that oracle fail with 76,538 differing channels
and maximum error 63; its inspected screenshot reproduces the old golden.
All three fixed oracle screenshots were read. Only the three Chromium/Linux
`linear-gradient-translated` goldens are updated; tolerances and the other
snapshots are unchanged. Their ordinary assertion rerun (updates disabled)
is pending. This is an intentional appearance correction backed by an
independent pixel relation, not snapshot acceptance to conceal a failure.

---

## F16 — Gradient stop selection survives pointer-up (verified, no change needed)

[Graphite #2445](https://github.com/GraphiteEditor/Graphite/issues/2445) reset
selection to the endpoint on pointer-up. Varve's `GradientEditor.selectedStop`
is persistent React state; pointer-up ends the gesture instead of replacing it.
The real picker test `tests/e2e/inspector/gradient-stop-selection.spec.ts`
passed after selecting the endpoint, selecting the start, selecting the middle,
and dragging the middle to 65%. The start/end remain at 0%/100%, and the middle
remains pressed with its position field at 65%. Its
[screenshot](../../screenshots/graphite-corpus/gradient-stop-selection.png) was read:
the green interior stop is selected and Position reads 65. The canvas itself
was still affected by F15; this verification concerns selection, not painting.
Canvas geometry handles have transient dragging state, not a persistent
selected-stop state. No production selection or history change was made.

---

## F17 — Soft brush RGB survives semitransparent edges (verified, no change needed)

[Graphite #3019](https://github.com/GraphiteEditor/Graphite/issues/3019) reports
a dark fringe around a pink soft stroke; its attached image was inspected.
The sole comment points to [#3033](https://github.com/GraphiteEditor/Graphite/pull/3033),
whose conversation explicitly identifies this fix. That is external evidence,
not a claim to have reproduced Graphite's historical engine.

Varve's `compositeDabOnNode` stores straight-alpha RGB after source-over
composition. Two unit controls inspect over 100 soft-edge pixels each at
alpha 5–75, including overlapping dabs: RGB stays within one byte of the
authored (64,160,224) rather than darkening with alpha. The real-app Airbrush
test paints white over a measured opaque (96,96,96) backdrop. It requires
visible brightening and no channel below the backdrop by more than one byte.
It passed, and the
[screenshot](../../screenshots/graphite-corpus/soft-white-brush.png) was read:
the core is lighter, edges fade smoothly, and no dark ring is visible. Saved
PNG samples over the 130×130 stroke patch span RGB 96–154, with alpha 255.
No brush production code was changed. This establishes the tested normal
soft-brush path, not every blend mode, wet-edge effect or native backend.

**Separate history warning.** The run emitted `updateDoc called outside
transaction`. Source inspection finds `PaintTool.onPointerDown` starts a
transaction and `finishStroke` commits after the worker tail, but the log has
no caller stack and does not identify the offending mutation. This probe
neither exercises Undo nor reloads persistent history. Its alpha result does
not certify brush undo/persistence; the warning remains an explicit follow-up,
not a diagnosed or repaired history defect. Gradient-handle gesture undo/redo
passed its separate existing browser test.
