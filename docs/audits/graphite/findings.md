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

## F3 — Repeated nudges cost one undo each (blocked)

**External evidence.** Graphite #2617 ("Nudges in the same direction should be
combined in history", open, Architecture / Paper Cut): five Shift+Right taps
and three Right taps should collapse so one undo returns to the start; a
direction change or any other edit starts a new point. A maintainer replies
that the cloned-document history must be refactored first, because merging
steps is not expressible in it — an explicit warning that this needs history
identity, not a hack.

**User problem.** Correcting an over-nudge costs as many undos as key presses,
and every extra press consumes history depth.

**Applicable Varve workflow and code path.** `CanvasNudgeController` and the
editor's history. A *held* arrow key is already one entry: the controller opens
one transaction while any direction is held and commits when all are released.
Each discrete tap is its own transaction, so N taps produce N entries.

**Observed Varve behaviour (before).** Three ArrowRight taps produce three
history steps.

**Investigation.** Undo in Varve does not read the in-memory snapshot stack
whenever persistent history is attached; `undo()` routes to
`persistentHistory.undo()`, which walks the revision store
(`EditorHistorySession` over an `@varve/history` `HistoryStore`). That store is
an **append-only** operation log plus revision DAG whose transaction captures
are validated by replaying them and comparing hashes. It exposes no
amend/coalesce operation, and fabricating one by rewriting a head revision
would break the replay-hash invariant that makes recovery trustworthy.

A prototype that merged entries in the snapshot stack was written and reverted:
with persistent history attached it changed nothing user-visible, which is the
only behaviour that matters.

**Intended outcome (not yet delivered).** Same-direction nudges inside a short
idle window become one durable revision; a direction change, any other edit, or
an undo closes the burst.

**Blocker.** A durable-history capability: an explicit, invariant-preserving
"extend the current revision" operation in `@varve/history` plus session
support in `EditorHistorySession`, and a matching rule for the snapshot-stack
fallback. This is a foundational history change and needs its own design and
migration review (ADR-0019 territory), not a drive-by edit.

**Status.** `blocked`. No user-visible change shipped. The finding stays open.

---

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
