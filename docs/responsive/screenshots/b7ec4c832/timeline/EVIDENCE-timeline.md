# Task 03a verification — timeline dense-data fixes at b7ec4c832

Independent post-fix re-measurement by repro-broker (read-only for source). Measured HEAD b7ec4c832 "fix(editor): give the timeline one label-column authority and unclipped dense rows (task 03a)" (parent 4c79f66dd). Dev server: vite :1420 (left running, harness reuses it). Browser: Playwright 1.62.1 Chromium headless. Viewports: 1180x820, 1366x1024, 1024x768 fine + 1180x820, 1024x768 coarse (hasTouch:true, isMobile:false). Methodology identical to the pre-fix reproduction; probe `.tmp-resp-repro/probe-verify2.mjs`, raw JSON `results-verify.json` (this dir), pre-fix reference `pre-fix-reference.json` (HEAD 0957d2db6 run).

## Fix under test (b7ec4c832)

- editor.css legacy `.timeline-track-row` / `.timeline-track-row__label` (140px, centred row, font-size/gap) deleted; TimelinePanel.css now owns the 120px column.
- `.timeline-track-row__label` gained `position:relative; z-index:1` so 0%-keyframe dots no longer cover the solo button centre.
- `.timeline-panel__tracks` gained `overflow-x:auto` (was hidden) for the docked 320px case.
- `.timeline-track-row` gained the background transition previously supplied by editor.css.

## Verdicts

| defect (as reproduced at 0957d2db6) | verdict | measured evidence at b7ec4c832 |
|---|---|---|
| duplicate label-column authority: 120px vs 140px | **FIXED** | CSSOM has exactly one width rule for `.timeline-track-row__label`: TimelinePanel.css sheet #128 `width:120px` (the legacy editor.css 140px rule no longer exists). Live computed width = 120px in all 5 runs. |
| label box 37.9-38.2px tall inside the 28px row, painting over the next track | **FIXED** | label rect height 27px vs row 28px in all runs (was 37.9-38.2). label scrollHeight == clientHeight, `contentClippedY=false`, so the two lines are NOT clipped after the fix. Horizontal label scrollWidth/clientWidth 119/119 at 1180/1366 (was 126/119, 7px clip); 120/119 at 1024 (1px = right border, pre-existing). |
| 0%-keyframe dot covers the solo button centre | **FIXED** | elementFromPoint at solo centre returns the solo button in all 5 runs (was keyframe button); effective solo hit extent 16x23; geometric rect overlap keyframe-vs-solo now false in all runs. |
| docked 320px timeline clips 48-50px of content with no way to scroll it | **NOT FIXED — fix targeted the wrong container** | `.timeline-panel__tracks` now has computed overflow-x:auto, but its content FITS: scrollWidth/clientWidth = 320/320 at 1180x820 and 1366x1024, 1024/1024 at 1024x768, so scrollLeft is not reachable (maxScrollWidth 0). The actual overflow is `.timeline-playback-controls`: 368/320 at 1180x820 and 370/320 at 1366x1024, while `.timeline-panel` keeps `overflow-x:hidden` (368/320, 370/320). The right-hand time readout/controls are still clipped in dense-1180x820-fine.png and dense-1366x1024-fine.png. |
| mute/solo controls below the 24x24 target floor (16x16 box) | **NOT FIXED (was out of scope for this commit)** | element boxes still 16x16; mute effective 18x23, solo effective 16x23, still below WCAG 2.5.8 24px. Unchanged from the pre-fix run. |
| layers proxy (untouched CSS) | **UNCHANGED** | disclosure/lock/eye control boxes identical 24x24 and same hit results; solo/details still display:none at 1180 container 259.6<=260; 1024 drawer behaviour unchanged. Row height only differs where the focused-row details launcher renders (see notes). |

## Per-run post-fix numbers

| run | label W | label H / row H | label scrollW/clientW | label content clipped? | solo box / centre hit / effective | mute box / centre hit / effective | tracks overflow-x / sw:cw / scrollable | panel sw/cw | playback-controls sw/cw |
|---|---|---|---|---|---|---|---|---|---|
| 1180x820-fine | 120 | 27 / 28 | 119/119 | false | 16x16 / Y / 16x23 | 16x16 / Y / 18x23 | auto / 320:320 / no (fits) | 368/320 ovx hidden | 368/320 |
| 1366x1024-fine | 120 | 27 / 28 | 119/119 | false | 16x16 / Y / 16x23 | 16x16 / Y / 18x23 | auto / 320:320 / no (fits) | 370/320 ovx hidden | 370/320 |
| 1024x768-fine | 120 | 27 / 28 | 120/119 | false | 16x16 / Y / 16x23 | 16x16 / Y / 19x23 | auto / 1024:1024 / no (fits) | 1024/1024 | 1024/1024 |
| 1180x820-coarse | 120 | 27 / 28 | 119/119 | false | 16x16 / Y / 16x23 | 16x16 / Y / 18x23 | auto / 320:320 / no (fits) | 368/320 ovx hidden | 368/320 |
| 1024x768-coarse | 120 | 27 / 28 | 120/119 | false | 16x16 / Y / 16x23 | 16x16 / Y / 19x23 | auto / 1024:1024 / no (fits) | 1024/1024 | 1024/1024 |

Timeline row height remains 28px; label column 120px; keyframe dots at 0% render 14x8 at the track's left edge (no solo overlap). Overflow probe also records `.timeline-ruler` sw/cw 5028/5000 inside its own hidden-overflow box (pre-existing, unchanged) and `.timeline-panel__zoom-controls` 85/80 (unchanged).

## Layers proxy before -> after (same probes)

| run | row H pre -> post | disclosure | lock (hover) | notes |
|---|---|---|---|---|
| 1180x820-fine | 37.3 -> 37.3 | 24x24 hit Y | 24x24 hit Y | solo+details display:none at container<=260 both runs |
| 1366x1024-fine | 37.7 -> 39.2 | 24x24 hit Y | 24x24 hit Y | post run had the focused-row details launcher rendered (24px) -> row 1.5px taller; pre run row unfocused. CSS untouched; state difference, not a fix side-effect. |
| 1024x768-fine | 37.0 -> 38.5 | 24x24 hit Y | 24x24 hit Y | same focused-row details launcher state difference (drawer mode) |
| 1180x820-coarse | 37.3 -> 37.3 | 24x24 hit Y | 24x24 hit Y | unchanged |
| 1024x768-coarse | 37.0 -> 37.0 | 24x24 hit Y | 24x24 hit Y | unchanged |

## Anything the fix worsened / follow-ups

- **Visual type-size change:** deleting the editor.css label rule also deleted its `font-size: var(--font-size-xs)` (13px), so the label now inherits the panel's 15px (`--font-size-sm`). Measured: label still fits (no clipping, ellipsis intact), but the node name/property render larger than the pre-fix screenshots — confirm this is intended.
- **Hidden-overflow panel is programmatically scrollable:** `.timeline-panel` (overflow-x:hidden) still has 48-50px of hidden scroll range; `scrollLeft` can be set. A focus-driven browser auto-scroll could shift the whole panel including the label column sideways. Pre-existing but now easier to trigger with focusable right-edge controls; consider wrapping/fixing `.timeline-playback-controls` and leaving the panel overflow hidden.
- **The tracks scroller is inert at tested widths:** overflow-x:auto on `.timeline-panel__tracks` never engages because the rows already fit; no scrollbar/regression observed, but the 48-50px clipping symptom is unchanged.
- No row-overlap regression: rows stay 28px, hover/selected/muted backgrounds preserved (transition moved into TimelinePanel.css).

## Screenshots (this directory)

- dense-1180x820-fine.png, dense-1366x1024-fine.png, dense-1024x768-fine.png, dense-1180x820-coarse.png, dense-1024x768-coarse.png (timeline state; docked 320px runs show the still-clipped right-hand controls)
- dense-<run>-layers.png for the same 5 runs (layers drawer/rail with hover targets; 1024 runs show the drawer).

## Artifacts

- this directory: EVIDENCE-timeline.md, post-fix.json (compact, includes verdict object), pre-fix-reference.json (before numbers from 0957d2db6), results-verify.json (raw probe payload), 10 PNG screenshots.
- scratch: `.tmp-resp-repro/probe-verify2.mjs` (probe), `.tmp-resp-repro/verify-extract.mjs` + `.tmp-resp-repro/make-artifacts.mjs` (report generation), `.tmp-resp-repro/essentials-dense2.json` (pre-fix compact).

## Limitations

- Coarse pointer is emulated by Playwright hasTouch on headless Chromium (media flips verifiably to pointerCoarse/hoverNone); not a real touch device.
- Dev-server CSS injection order is what was measured; no production build was run in this pass.
- The 1024x768 runs project the side panels as fixed drawers (as measured pre-fix); the timeline is docked full-width there, so no horizontal clipping case exists at 1024.