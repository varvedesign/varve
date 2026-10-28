# Enhance and Vectorize modal preview review

**Date:** 2026-10-26
**Scope:** `Enhance image` and `Vectorize image` modals — preview reliability,
preview controls, and dialog composition.
**Evidence limit:** external examples below are interaction/composition
evidence, not usability proof and not a source of reusable assets.

## Research record

Conducted 2026-10-26. Community scouting used public previews and live
interfaces only; no Figma sign-in, MCP, plugin installation, token collection,
or purchase was involved.

| Source | What was actually inspected | Observation carried into this work |
| --- | --- | --- |
| [Effect Studio](../architecture/effect-studio.md) (first party) | Live implementation plus committed captures under `docs/screenshots/effect-studio-ux-review-2026-09-29/` | The preview viewport contract: explicit Before/After/Compare, Fit/100%/200% + Center, one display transform on both sides, preview pinned while settings scroll. This is the authority for both modals. |
| [Vectorizer.AI](https://vectorizer.ai/) (live page) | Fetched live interface markup and visible control structure | Comparison and zoom treated as the primary surface; refinement controls kept separate from inspection controls; the preview is free and complete before any commit. |
| [SVGtrace](https://svgtrace.com/) (live page) | Fetched live interface and public editor demonstration | Preview ownership matters more than control count: the editor demonstrates a result first, then exposes tuning. |
| [Darkroom — by Sam Sky](https://www.figma.com/community/plugin/1615249349303484684/darkroom-by-s4msky) | Community page loaded; feature list read | Before/after comparison, zoom, and per-control reset called out as core, not optional extras. |
| [Free Vectorizer (Image Tracer)](https://www.figma.com/community/plugin/1526280907441235581/free-vectorizer-image-tracer) | Community page loaded; feature list read | Explicit preview plus honest "not supported" messaging for out-of-scope inputs. |

**Research limitation:** the two Figma Community preview *images* could not be
rendered by the available fetch tooling, so their pixels were not inspected.
The pages themselves loaded and their published descriptions were read; the
live interfaces above stand in for visual evidence. This is disclosed rather
than treated as a completed image review.

**Not transferred:** external branding, assets, proprietary terminology, cloud
processing, or any quality claim from a third party.

## Direction presented and approved

Three routes were offered against Varve's existing system (typography, theme
tokens, density, and shared controls unchanged):

1. **Preview-first workbench** — large pinned preview beside grouped settings
   with a fixed action footer; shared inspection vocabulary.
2. **Studio-style three-zone layout** — preview, compact preset browser,
   focused settings.
3. **Guided refinement** — persistent preview with Prepare → Refine → Review.

**Route 1 was selected** (approved 2026-10-26 by instruction to proceed with
the recommendation). Routes 2 and 3 were not implemented.

## Defects found and fixed

### 1. Before/after divider did not sit on the boundary it revealed

`UpscaleDialog` clipped the enhanced layer with `inset(0 0 0 ${100 - split}%)`
while the divider was positioned at `split%`. The two only agree at 50%, so
away from centre the handle pointed at one place and the pixels revealed at
another. Both now derive from a single `split` value.

Guard: `tests/e2e/canvas/upscale-dialog-visual.spec.ts` reads the divider's
computed `left` *and* the overlay's computed `clip-path`, converts both to
percentages, and asserts each is within 1% of `aria-valuenow`.

### 2. Vectorize preview fitted on width only and never re-measured

`drawPreview` scaled Fit from `canvas.clientWidth` alone, so a portrait source
overflowed the stage vertically and the overflow was clipped away — the preview
appeared not to work. The stage was also never re-measured after a reflow.

Fixed by `previewDisplayScale()`, which takes both axes, plus a `ResizeObserver`
feeding the measured stage box to every draw. Covered by unit tests in
`packages/editor/src/logo/vectorization/vectorization.test.ts` for portrait fit,
landscape fit, fallbacks, literal zoom ratios, and degenerate input.

### 3. Preview controls overlapped the preview stage

`.vectorize__preview-controls` and `.vectorize__preview` were both assigned
`grid-area: preview`, so they occupied the same grid cell. The zoom radios sat
underneath the canvas and were unclickable.

Two changes: every grid area now names exactly one child (the loose warnings
and diagnostics were grouped into `vectorize__feedback`), and the dialog got an
explicit workbench width. The media query keyed off the *viewport* while the
modal stayed at its default ~32rem, so a two-column grid was being squeezed
into a narrow modal and both tracks overflowed; grid children now opt into
`min-width: 0` and the diagnostics readout uses `auto-fit` so it reflows instead
of pushing past its track.

### 4. Failed and pending previews were invisible or misleading

Preview failures were `console.error` only. When no processed output existed
the panel painted the *source* under an "Enhanced" label at reduced opacity,
so a placeholder could be read as a result.

The panel now separates intent from renderability: the result sides stay
selectable so the generating/failed notice is reachable, the empty state is
text rather than a labelled image, and a failure raises a visible alert with
**Retry preview**.

While fixing this, two live regions were found announcing the same "Generating
preview…" event. Consolidated to one.

## Follow-up review — 2026-10-27

Second-round screenshots of both modals showed the first pass had been
validated against one fixture — the square favicon at one window size — so the
things that actually vary (aspect, window height, modal scroll) were never
exercised. Three defects that exposed, plus errors I introduced:

### The preview crop was square whatever the source

`upscalePreviewRegion` clamped width and height to the preview budget
*independently*, so any source larger than the budget on both axes previewed as
a **square** window. A 476 × 848 photo showed a centred 256 × 256 crop while
the dialog promised 952 × 1696 — the preview could not be judged for framing or
aspect at all. The crop is now fitted inside the budget preserving the source
aspect, and `computeUpscalePreview` derives its crop from the same function, so
the region and the rendered pixels cannot disagree.

### Fit squashed any source on a short window

The stage set an explicit fitted size and then clamped it with
`max-height: min(58vh, 560px)`. Below about 966 px of window height (any
768 px laptop, Playwright's 720 px default) the height clamped while the width
did not, stretching the comparison. The stage now has a definite height, a
`ResizeObserver` reports its box, and Fit scales on both axes from that
measurement with no post-hoc clamp. The stage is drawn as a recessed well so an
aspect that does not fill it reads as letterboxing, not as unused dialog.

### The Vectorize dialog scrolled as a whole

The grid carried its own `max-height` inside an already-bounded dialog body, so
the body had room to scroll. Focusing the first control then scrolled the
**Trace type** row off the top of the modal and clipped settings at both ends —
the "several items out of view and require scrolling" in the report. The dialog
now has an explicit height, its body is `overflow: hidden`, only the settings
column scrolls, and that column is edged so it reads as a panel.

### Preview controls

- The 3×3 inspect picker was eighteen-pixel unlabelled cells crammed onto the
  end of the toolbar — a mystery widget that silently re-crops the comparison.
  It now has its own labelled row, is built from the shared `SegmentedControl`
  so it takes one tab stop with arrow-key movement, uses 32 px square cells,
  and carries a caption naming the region and its source pixels.
- My scoped cell rule outranked `:has(input:checked)` and left **no cell
  selected** — nine unlabelled squares with nothing chosen. The scoped
  selectors are now held deliberately *below* the shared component's
  checked-state rule, so selection comes from `@varve/ui` instead of being
  restated locally (and the same mistake cannot recur).
- The "Enhanced" label was gated on `view === 'after'`, so it never appeared in
  Compare, where both sides are on screen.

### Validation finding: the drift budget hid structural change

`RASTER_DRIFT_BUDGET` (5000 px) let two stale Enhance baselines pass after the
controls had changed underneath them; only force-regenerating and *looking*
caught it. A screenshot assertion is not a substitute for reviewing the
screenshot.

### Third round — 2026-10-27: scroll and the inspect control

Both complaints were measured before anything changed.

**"Scroll issues still exist."** The settings column needed 641px and had 609,
while 139px of window sat unused below a `46rem`-capped modal. It was a height
cap, not a content problem. The dialog is now `height: min-content` with
`max-height: calc(100dvh - 3rem)`, the settings column is `overflow: visible`
and never owns a scrollbar, and the body is the single scroller only when the
window is genuinely too short. Re-measured at 1919 x 1014 and 1280 x 800:
`scrollHeight == clientHeight` for settings and body at both, modal inside the
window at both.

**"Inspect region shows the full image."** The crop was correct — the baseline
was `144x256`, not `476x848` — and the pixels did change per region, but nothing
showed it: a bounded crop keeps the source aspect, so at Fit every region is the
same size and shape as the whole. Added a **navigator** (the whole source with
the computed window drawn over it) beside a compact `Select` under the stage,
with the caption as the Select's description. Verified on a four-quadrant
portrait source: the center crop shows all four quadrants, and after choosing
Top left it shows only the teal one.

Also in this round:

- The 3x3 keypad became a `Select` on the hint line. It had been 32px squares
  in their own row above the stage — an unexplained widget costing a
  screen-line of modal height.
- The label was uppercased and letter-spaced, so "INSPECT REGION" wrapped to
  two lines inside the row; it is sentence case and `nowrap` now.
- "Generating preview…" was rendered twice, in the stage overlay *and* the
  status row. The overlay no longer repeats it, and the status row is the
  single live region. A shared empty `@varve/ui` announcer also carries
  `role="status"`, so the unit test asserts on the panel's own region instead
  of counting roles across the whole tree.
- `comparisonNote` was dropped from the hint: it repeated the crop the caption
  states and pushed the hint to four lines.

### Fourth round — 2026-10-27 (later): the scroll claim measured the wrong element

The third round recorded `scrollHeight == clientHeight` for "settings and
body" and called the scroll fixed. **That measurement was wrong.** The element
recorded as "body" was `.upscale-dialog__body`, the grid *inside* the shared
`.varve-dialog__body`. That grid is auto-height — its box grows with its
content — so its `scrollHeight` equals its `clientHeight` **no matter what
scrolls**. Asserting on it passes unconditionally. The real scroller is the
shared wrapper, and it was scrolling.

Reproduced against the user's actual state, which no earlier measurement had
used: **Auto / Recommended on a noisy source**, the configuration a real photo
produces. It adds the analysis block, the Mode and Denoise groups, the output
summary, the model-missing notice and the memory warning — **889 px of
settings against 874 px available**, so the shared body scrolled by **44 px**
and the memory warning was cut at the footer line. Every prior measurement had
picked Upscale mode or a clean fixture, neither of which shows the Denoise row
or the warnings. The dialog would have been 12 px short even with zero outer
margins, so no amount of re-padding the modal could have closed it.

Five changes, none of them removing information:

1. Settings `gap` and group-separator padding `space-2` → `space-1`; the
   border line does the visual separation, so the whitespace around it can be
   halved.
2. The shared body's padding is scoped to `space-3 space-4` for this dialog
   (the Effect Studio already scopes its own) — 29 px → 21 px.
3. The model-missing notice and its Download action share one row instead of
   stacking (55 px → 35 px).
4. The dialog margin `2rem` → `1.5rem`.
5. The shared body gets `flex: 1 1 auto`. This was found by an assertion, not
   an eyeball: with a definite dialog height, a content-sized body stopped
   short whenever the content was shorter than the window, leaving the footer
   floating above a strip of empty background (`footerBottom 962` against
   `dialog bottom 1002`). The body now grows into the surplus and still
   shrinks — `min-height: 0` from the base rule — when the window clamps the
   dialog, which is when its `overflow-y` becomes the single scroll.

The stage was also fixed at `min(58vh, 560px)`, leaving ~140 px of the preview
column unused while settings overflowed. It is now `flex: 1 1 0` with that
value as its **floor**: it grows into the space the settings column leaves
(**560 → 691 px** at 1919×1014) while its height still resolves from the
column — never from the bitmap — so the Fit measurement keeps its definite box,
and no configuration gets a smaller stage than before. The zoomed variant
keeps `flex: 0 0 auto` so 100%/200% still grow with the bitmap and pan.

**Honest boundary:** settings + chrome + margins ≈ 953 px, so the modal shows
everything **without any scroll at ≥ ~974 px of window height** (a full-HD
browser gives 1014 ✓). Below that the shared body is the single scroller —
title, footer and the scrollbar-free settings column still hold — because 889 px
of settings cannot physically fit in a 671 px body, and the alternative is
deleting content. The aspect spec now asserts on the shared wrapper, so this
class of false pass cannot recur.

### Validation record (current)

- `tests/e2e/canvas/tmp-diagnose.spec.ts` (temporary, deleted after the run):
  Auto + Denoise + both warnings, measuring the **shared** body. 1919×1014 —
  `shared scroll 842 == client 842` (was 918 vs 874, over by 44), settings
  `821 == 821`, dialog `overflow-y: hidden`, header and footer flush
  (`footerBottom 1002 == dialog bottom 1002`), last setting 53 px clear of the
  footer, stage 691 px ≥ its 560 px floor, dialog inside the window.
  1280×800 — dialog clamped to 776 with chrome flush, settings still never its
  own scroller, shared body scrolls (826 vs 671) as the documented fallback.
  Both passed; both screenshots read.
- Permanent specs, `--update-snapshots=changed`, `--workers=1`: **33/33
  passed** across `image-modal-aspect` (16: 5 aspects × 2 windows, now
  asserting on the shared wrapper), `image-trace` (9, including "dialog fits
  its content"), `upscale-dialog-visual` (8). Four baselines regenerated —
  default, dark, high-contrast, pixel-art — and all four **read**; the
  pixel-art one verified against a 200 % crop of its settings column
  (Custom settings / Upscale / Pixel art / EPX) after the downscaled full-size
  read proved unreliable.
- Full `pnpm verify:affected --staged` result: recorded in the commit message
  for this change.

## Follow-up 2026-10-28: short windows and the components under the modals

The 2026-10-26 pass was verified at 1919×1014 and 1280×800 and shipped the
settings column as `overflow: visible`. At the window sizes people actually
have (1918×729, 1120×776) the same modals were still broken, and most of the
cause sat below the modals, in shared components.

| Symptom | Cause | Fix |
| --- | --- | --- |
| Enhance: hint, Inspect region and the Original/Enhanced labels under the footer; preview scrolls away with the settings | Preview column as tall as the settings column; shared body the only scroller | Bounded two-pane workbench: one-row grid whose row is the visible body height, settings column the one scroller when it genuinely cannot fit |
| Enhance at 200%: stage grew to 1033px, controls off screen; 100% hugged the left edge | `height: auto` zoomed viewport; `display: block` start-aligned | Fixed-size stage, auto-margin centring, `usePanOnDrag` |
| Every setting change flashed "No processed preview yet", resized the stage four times, re-centred a zoomed pan | Flag raised only when the debounce fired; geometry derived from whether pixels had arrived; status was a row that took stage height | "Generating" from the moment the request is queued; geometry from region and scale; status is a badge over the stage |
| Vectorize: Apply left the modal open on "Select an image layer…"; Cancel never closed it; Apply sat in a scrolling column | Apply selects the new group; Cancel only reset the preview; actions inline | `onApplied` / `onCancel`; action row portaled into the sticky footer |
| File Thumbnail: Apply/Cancel below the fold | Action row was the last child of the scrolling body | Dialog `footer` prop |
| **Switchers stretched across the whole dialog** (1090px track under four segments) | `.varve-segmented` is `inline-flex` with `width: auto`; a flex-column or grid parent blockifies and stretches it. Enhance had hidden this with a local patch | `width: fit-content; max-width: 100%; flex-wrap: wrap` on the base rule; the local patch removed. Runtime scan: 3 stretched switchers before (all Vectorize), 0 after, across the inspector, 6 dialogs, 17 Settings sections and Home |
| Vectorize settings scrolled at 776px | Stacked slider ≈ 63px × 6, and the range input is a fixed 24px | `Slider density="compact"`: label beside the range, one row. Fits at 1120×776 and 1918×900 |
| Settings dialog: nav had its own scrollbar, contradicting the dialog's own "only the content scrolls" contract (17 rows × ~34px want ~610px; the nav is never taller than ~570px, so this held at *every* window height, not just short ones); Appearance and Export scrolled by 16–34px of spacing | Fixed row height plus a gap that cannot shrink; card padding | Nav rows are flexible (`flex: 0 1 36px`, min 26px, no gap) so they fit whatever height the nav has with no clipped row and no dead space; short-window (`max-height: 800px`) card padding, declared *after* the base rule (an earlier copy silently never applied) |
| Settings: "Canvas background" and "Autosave interval (min)" pushed their control 20–40px right of every other control; swatch drawn as a tall oval and sitting on a different baseline from Reset; number field shorter than the selects | `.settings-field-row__label` used `min-width`, so a label wider than the column grew its own row's column; swatch 20×24; swatch and button were inline content in a block | Label column is a real column (`flex: 0 0`, wraps); swatch row is a flex row; swatch is square; number field matches select height and starts on the control edge |
| Enhance: rows cramped on a tall window with the bottom half of the column empty | I had applied one tight rhythm at every height | Rhythm tiers by window height (compact under 815px, comfortable, roomy from 1000px); Inspect-region label centred on its trigger |
| Enhance: a Quality toggle that regenerated an identical preview; a disabled Denoise row under Upscale | The dialog always sends explicit strengths, so the engine's policy default is never consulted except for compression clean-up (no model installed) | Not offered when inert (also returns ~170px) |
| Slider focus-ring / forced-colors lint warnings | High-specificity focus rule declared before the base and forced-colors rules | Reordered; cascade unchanged (asserted by `modal-viewports.spec.ts`) |

**Decisions left for the owner**

1. **Apply closes the Vectorize dialog.** `image-trace.spec.ts` carried the
   comment "it stays open after Apply for tweaks"; that flow could not work
   (the selection moves to the new group). Keeping the dialog open would need
   the source node pinned at open time — a feature, not a fix.
2. **Vectorize Cancel now closes the dialog.** The old "cancel a finished
   preview" gesture is gone from the modal (the Logo panel keeps it). There is
   no Stop control for a long-running preview short of closing.
3. **Quality policy is hidden, not repaired.** Making Faithful/Balanced do what
   the label says changes restoration output and belongs with the model-quality
   work, not here.
4. **Some overflow is unavoidable on very short windows.** Enhance in Auto fits
   with no scrolling at 1280×720 and 1919×1014 (screenshots read); below that,
   and in the stacked fallback under 520px tall, the settings column is the
   single inner scroller and the preview does not move. The spare height on a
   tall window is left as space under the last group rather than stretched
   between groups.

**Not covered.** The sweep reached the dialogs with a menu entry point. Effect
Studio, Batch Remove Background, HDR merge, Palette preview and Auto Arrange were
not opened, and the product-screenshot script's Vectorize scenario was edited
but not run.

**Evidence.** `tests/e2e/canvas/modal-viewports.spec.ts` (short-window
contract, switchers, nested scrollers, pan, Apply/Cancel, Settings nav) plus the
existing `image-modal-aspect`, `image-trace`, `image-enhancement`,
`upscale-dialog-visual` and `settings-dialog` specs. Five baselines were
regenerated and read (four Enhance, one Settings narrow).
