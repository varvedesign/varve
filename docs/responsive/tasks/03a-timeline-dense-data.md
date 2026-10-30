# Task 03a — Timeline dense-data targets

Status: done | Depends on: 02 (done), 01a (done) | Rollback: revert b7ec4c832 (CSS-only; restores the 140px legacy authority, 37.9px label overflow, keyframe-over-solo overlap and the hidden docked-clip scroller)
Split from: tasks/03-tables-and-dense-data.md on 2026-10-29T15:59:01-07:00

## Scope
- packages/editor/src/timeline/TimelinePanel.css (row/control targets only)
- timeline row components under packages/editor/src/timeline/ (only if a target
  cannot be enlarged in CSS)
- packages/editor/src/editor.css: the duplicate timeline label-width authority
  (audit-raw: TimelinePanel.css ~382 declares 120px, editor.css ~5542 declares
  140px); remove one so one file owns the column

## Failure mode
Audit-raw I/F: timeline rows are 28px with 16px mute/solo buttons and the label
column has two competing widths (120px vs 140px). The panel is a fixed 200px
tall at every viewport. The 24/28/32/40px control ladder only reaches 44px on
coarse pointers, so fine-pointer rows are WCAG 2.2 SC 2.5.8 marginal at 16px
targets. Reproduce before editing.

## Change
Reproduce first (screenshots at 1024x768, 1180x820, 1366x1024 with Layers and
Timeline open, fine + coarse pointer), then fix only reproduced defects:
- raise row action hit areas to the documented 24x24 SC 2.5.8 floor (44px on
  coarse pointers) with a pseudo-element or padding redistribution, WITHOUT
  changing the visual row height;
- delete the losing label-width authority so one file owns the column and the
  measured width is identical from both roles.
Keep the compact density ladder; do not raise every row to 44px on fine
pointers. If the reproduction shows no defect, record that evidence and close
with no code change.

## Validation
- Fine + coarse Chromium at 320, 390, 768, 1024, 1180, 1366, 1440.
- elementFromPoint hit test for every row action/checkbox at coarse pointer;
  WCAG 2.2 SC 2.5.8 24x24 floor plus 8px spacing where used.
- Timeline label column measured identical from both sources after the fix.
- Screenshots committed: timeline-1024x768, timeline-1180x820,
  timeline-1366x1024 (plus coarse-pointer variants) under
  docs/responsive/screenshots/<sha>/.

## Verification (final, 2026-10-29, HEAD 39e9be06e)

Independent agent reproduction + Lead re-run; full numbers and screenshots in
docs/responsive/screenshots/39e9be06e/timeline/ (EVIDENCE-timeline.md,
post-fix.json, results-verify.json, pre-fix-reference.json, 15 PNGs incl.
playback-end frames); intermediate rounds in screenshots/b7ec4c832/timeline/.
Five runs: 1180x820 / 1366x1024 / 1024x768 fine + 1180x820 / 1024x768 coarse.

- Label: one width rule only (TimelinePanel.css 120px; legacy editor.css 140px
  rule deleted); computed 120px, font-size 13px, label 27px inside the 28px
  row, not clipped (was 37.9-38.2px painting over the next row with 7px x-clip).
- Solo/mute: centre elementFromPoint hits the button in all five runs (was
  covered by the 0% keyframe dot at 1024/1180/1366 fine + 1024 coarse);
  keyframe/solo rect overlap false everywhere.
- Docked playback controls: .timeline-playback-controls owns a real horizontal
  scroller (clientWidth 320, scrollWidth 440/443 at 1180x820 / 1366x1024;
  scrollLeft 0->120/123 reachable; right-end time readout visible in
  *-playback-end.png). The first attempt (ad39db84a) inflated the row via
  select flex-shrink and was corrected in 39e9be06e.
- Panel/tracks: .timeline-panel is non-overflowing and scroll-locked
  (overflow-x resolves hidden; setting scrollLeft leaves it at 0); tracks
  overflow-x reverted to hidden and content fits (320/320 docked, 1024/1024).
- Regression check: rows stay 28px; layers proxy unchanged (row heights and
  24x24 disclosure boxes identical); document scrollWidth == innerWidth.
- Carried residual: mute/solo effective hit extents 16-19x23 (centres
  reachable, below the 24x24 SC 2.5.8 floor) — queued with task 03b; not
  silently claimed as fixed.

## Rollback
Revert 39e9be06e, ad39db84a then b7ec4c832 (CSS-only; restores the legacy
140px authority, the 37.9px label overflow, keyframe-over-solo overlay and the
clipped docked playback row). bf3ef53bc (dead Colorize CSS) is unrelated.

## Size check
Fits one session (one panel + one duplicate width). Layers/inspector targets are
split out to task 03b.
