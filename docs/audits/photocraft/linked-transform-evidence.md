# Linked transform evidence: PhotoCraft #2784, #3610, #5665, and #5667

Reviewed 2026-10-18 against the cutoff-B issue records and linked PR
discussions. The 1:09 source video for #2784 was opened and visually inspected.
Its on-screen narration confirms two symptoms, while leaving their exact
initiating commands and operation state unclear.

## What the linked reports establish

- [#3610](https://github.com/storytold/photocraft/issues/3610) reports that a
  Free Transform preview disappears while the canvas is panned with Space.
  [PR #3843](https://github.com/storytold/photocraft/pull/3843) explains that
  hand-pan suppresses transient overlays, including the overlay carrying the
  transformed pixels. It keeps that preview visible during pan and adds a
  regression using real key and pointer events.
- [#5665](https://github.com/storytold/photocraft/issues/5665) reports a
  placed image or existing layer reverting when the user switches tools or
  layers during Free Transform. [#5667](https://github.com/storytold/photocraft/issues/5667)
  reports a dropped image being applied at its original position and size when
  the user chooses New Layer during Free Transform.
- [PR #5859](https://github.com/storytold/photocraft/pull/5859) added
  interaction tests for these paths. Review found that the initial placed-file
  fixture was not a real placed layer, the New Layer test did not click the
  button, and history order was not asserted. Correcting those tests exposed a
  separate history-order defect. The PR was merged with the corrected tests
  and history fix.
- [PR #6186](https://github.com/storytold/photocraft/pull/6186), open at
  cutoff B, traces the original reports to asynchronous desktop jobs: a tool
  or layer switch sees the transform still open while its commit runs in the
  background, mistakes that state for a refused commit, and cancels the job.
  The resulting rollback can remove the placed image. The PR includes tests
  with background jobs enabled; it notes the inline tests had missed this
  behavior.

These reports expose two separate failure classes: transient preview
visibility during camera movement, and committing or ordering a pending
transform when a user changes tools, layers, or history steps. Their fixes and
test histories should not be conflated.

## Varve comparison

Varve's external file-drop path in `packages/editor/src/CanvasArea.tsx`
decodes files, verifies that the import still belongs to the same document
session, and commits prepared nodes before a later object transform can begin.
Dropping an image onto a compatible shape intentionally creates a clipping
mask; the target receives an accent outline during the drag, and
`tests/e2e/canvas/tools.spec.ts` exercises that behavior through browser drag
events.

Object movement in `packages/editor/src/tools/SelectTool.ts` previews node
positions and commits them on pointer-up. Leaving the tool during an active
move aborts that uncommitted gesture. `FloatingTransformTool` is a distinct
selected-pixel operation: it commits a floating raster on pointer-up or Enter
and cancels only that temporary raster on deactivation. These Varve contracts
do not establish the same placed-image/background-job failure reported by
PhotoCraft.

The #2784 video says the reporter made a cut selection, the two images swapped
positions without an intended reason, and then the selection disappeared. It
does not show enough of the initiating command, selection type, or destination
to map the report to Varve’s clipboard, object-transform, or pixel-transform
contracts. Keep #2784 `unclear` pending an operation-level reproduction; the
linked PhotoCraft defects are not evidence of a Varve defect. No website claim
promises these transform behaviors, so no marketing copy change is indicated.
