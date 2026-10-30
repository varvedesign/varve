# Task 03a final verification evidence — timeline dense data at 39e9be06e

Method: repro-broker's drawer-aware dense probe (independent agent), re-run by
the Lead on the final tree because the original verification session was
interrupted. Probe: `.tmp-resp-repro/probe-verify-final.mjs` (gitignored
scratch; derived from probe-verify3.mjs with the evidence path updated).
Playwright 1.62.1 Chromium headless against vite :1420; coarse pointer emulated
with hasTouch:true/isMobile:false (media queries verified to flip).

Runs: 1180x820 fine, 1366x1024 fine, 1024x768 fine, 1180x820 coarse,
1024x768 coarse. 1024x768 uses the fixed-drawer panel projection, so the
timeline is full-width; 1180/1366 use the docked 320px timeline.

Raw/compact data: results-verify.json, post-fix.json, pre-fix-reference.json
(numbers from the 0957d2db6 pre-fix run). Screenshots: dense-<run>.png,
dense-<run>-layers.png, dense-<run>-playback-end.png.

## Verdicts

| Defect (reproduced) | Verdict at 39e9be06e |
|---|---|
| duplicate 120/140 label-column authority | FIXED — CSSOM has exactly one width rule (TimelinePanel.css, 120px); computed 120px in all runs |
| label 37.9-38.2px in a 28px row, painting over the next row / 7px x-clip | FIXED — label 27px vs row 28px, font-size 13px, content not clipped; scrollWidth:clientWidth 119:119 (1180/1366), 120:119 (1024, pre-existing right border) |
| 0%-keyframe dot covers the solo button centre | FIXED — elementFromPoint at the solo centre (and mute centre) returns its own button in all five runs; keyframe/solo rect overlap false everywhere |
| docked 320px timeline clips 48-50px with no scroller (wrong container identified on re-measurement) | FIXED — tracks do not overflow (320/320 docked, 1024/1024); the playback-controls row owns the overflow: overflowX auto, clientWidth 320, scrollWidth 440/443, scrollLeft 0->120/123 reachable, right-end readout visible after scrolling (`*-playback-end.png`) |
| select-inflation regression from the first scroller attempt (ad39db84a) | FIXED in 39e9be06e — the two .varve-select controls keep shrinking; row no longer 1058-1060px |
| panel programmatic scroll could shift the label column | FIXED — panel clientWidth == scrollWidth (320/320, 1024/1024); scrollLeft=120 reads back 0; computed overflow-x resolves to hidden |
| mute/solo 16x16 boxes below the 24px target floor | NOT FIXED (carried) — centre reachable; effective extents 16-19x23. Residual queued with task 03b. |
| layers proxy (CSS untouched) | UNCHANGED — row heights and 24x24 disclosure boxes identical to the b7ec4c832 verification |
| document overflow | NONE — scrollWidth == innerWidth at all five runs; timeline rows stay 28px |

## Reproduce

```
XDG_RUNTIME_DIR=/tmp pnpm --filter @varve/desktop exec vite --port 1420 --strictPort   # warm server
XDG_RUNTIME_DIR=/tmp node scripts/quality/heavy-lease.mjs "03a verify" -- node .tmp-resp-repro/probe-verify-final.mjs
```

The probe script and pre-fix reference JSON are preserved in
`pre-fix-reference.json` here; the probe itself is gitignored scratch, but its
measurement recipe is the same as `docs/responsive/audit.md` D3 plus the
"Probe" block in `screenshots/b7ec4c832/timeline/EVIDENCE-timeline.md`.
