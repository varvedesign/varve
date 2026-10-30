# Task 03b verification evidence — layers reachability and target size at 1009de823

Method: repro-broker's drawer-aware dense probe (scene + measurement recipe),
re-run by the Lead on the final tree. Playwright 1.62.1 Chromium headless
against vite :1420; coarse pointer emulated with hasTouch:true/isMobile:false
(media queries verified to flip). Runs: 1180x820 fine/coarse, 1366x1024 fine,
1024x768 fine/coarse. At 1180/1366 the layers panel is docked (259.6px/288px
container); at 1024 it projects as a fixed drawer.

Raw data: results-verify.json. Screenshots: dense-<run>.png,
dense-<run>-layers.png, dense-<run>-playback-end.png.

## Verdicts

| Defect | Verdict at 1009de823 |
|---|---|
| Layers Solo/Details display:none at container <=260px (touch lost Solo at the 259.6px docked 1180 presentation) | FIXED for Solo — soloAction is display:flex, 24x24 rect, elementFromPoint hit at centre in rest and hover, fine and coarse, at 1180 and 1366. Details still yields at <=260px by design (panel header + context menu remain routes); at 1366 both are 24x24 hittable. |
| Row must not overflow after keeping Solo | FIXED — row 239.6px inside a 259.6px panel; document scrollWidth == innerWidth at all runs; layer tree shows no horizontal overflow. |
| Timeline mute/solo 16px boxes with effective 16-19x23 (below WCAG 2.5.8 24px floor) | FIXED — 24x24 token boxes; effective extents 28x26 (solo) and 26-27x26 (mute); centre hit in all five runs; row height still 28px; label still 27px and unclipped. |
| Keyframe hit region covering solo's right half | FIXED — root cause was equal z-index (1) with later DOM order for the keyframe; label now z-index 3. Centre and full box resolve to the solo button. |
| 1024x768 drawer rest: Solo/Details zero-width | UNCHANGED design — fine pointer hover-reveals them; with hover they are 24x24 and hittable. Coarse run at 1024: solo rect 24px, hit true on hover. |
| Document overflow / regression | NONE — all runs scrollWidth == innerWidth; layers proxy rows unchanged (37-39px). |

## Residual (honest)

- Layers Solo effective width on coarse at 1180 measures 20x24 (centre
  reachable). The row's last slot sits ~2.8px past the row box; fixing fully
  would need a row padding/badge trade-off. Recorded in COMPLETION/STATE as a
  carried risk; not silently claimed perfect.
- The probe is scratch in .tmp-resp-repro (gitignored); this committed JSON is
  the evidence. A compact re-runnable probe under scripts/responsive/ is a
  follow-up (400-line cap), tracked in STATE.

## Final validation on the same HEAD

- validate:responsive --app all --reuse-website-dist — PASS 152/152, 41
  screenshots (17,962,619 bytes) in screenshots/1009de823/.
- validate:safe-area — PASS 134/134, 0 skipped, 12 screenshots in
  screenshots/1009de823/safe-area/.
