# Responsive adaptation — completion record

Date: 2026-10-29. Validated code HEAD: 8adaf3377 (session-2 revalidation;
first-gate HEAD 1009de823). Live ledger: docs/responsive/STATE.md.
Second-session verification: docs/responsive/verification-2026-10-29-session-2.md.

## Outcome

The campaign adapted the Varve editor shell, Home surface and marketing site for
320px phones, tablets, 13–14in laptops (both orientations) and desktop, without
a desktop/Tauri visual change. Seven user-visible defect families are fixed with
committed evidence; four tasks are explicitly deferred with reasons, and the
session-2 close-out resolved the two carried infrastructure findings (R1 harness
split, runnable dense-data probe) and corrected stale claims.

| Fixed | Commit | Evidence |
|---|---|---|
| D1 compact header: context tools/Share clipped at 320–899 | 59bd283a9 | e2e 2/2 + matrix screenshots |
| D6 13–14in Tauri window geometry (1180x720 default, 480x400 min, centered) | 738c9a943 | harness at 1180x720 and 1093x614 |
| D5 marketing license/performance tables expose real scroll regions | 26e8dc5a6 | 8/8 route-viewport checks |
| D2 safe-area foundation (viewport-fit=cover, shell inset, fixed-overlay geometry, site chrome, CDP harness) | 95f2b82a0 (+coverage 811d3519b) | validate:safe-area 134/134, 10 PNG |
| D3 timeline dense data (single label authority, no row overflow, solo/mute centres reachable, docked playback controls scrollable) | b7ec4c832, ad39db84a, 39e9be06e | re-verified 121/121 by validate:dense at 8adaf3377 |
| D3 layers/action reachability (Solo/Details no longer hidden at the 259.6px docked presentation; timeline mute/solo are real 24px targets, effective 26–28px) | b8ae12951, 358d9ae2c, 1009de823 | drawer-aware probe + committed dense evidence |
| D4 Colorize "420px dialog floor" — dead CSS, no defect; 9 dead rules removed | bf3ef53bc | reproduction + screenshots/bf3ef53bc/colorize/ |
| R1 harness modules at the 400-line cap (review finding) | 757e304be + 8adaf3377 | matrix 152/152 after refactor; modules 146–287 lines |
| Dense-data verification probe was scratch (carried open item 6) | 441bf1127 | validate:dense PASS 121/121, re-runnable |

## Validation at the final commit (session 2)

- validate:responsive --app all --reuse-website-dist — PASS 152/152 checks,
  0 failed, 41 PNGs (18,029,601 bytes) in docs/responsive/screenshots/8adaf3377/
  (16 editor viewports incl. 1093x614, 1180x720, 1180x820, 1366x1024, 1024x1366,
  1440x900, 1512x982, 1536x864, layers-open frames; 20 site route-viewport
  pairs). Report.json/report.md committed.
- validate:safe-area — PASS 134/134, 0 failed, 0 skipped, 10 PNGs (12 files incl.
  reports): portrait/landscape phones, forced tablet >=900 standard and mirrored
  (exact inset deltas, inspector floor), distraction-free exit-focus in both
  orientations, env()=0 desktop baseline, served site build.
- validate:dense — PASS 121/121, 0 failed, 10 PNGs (12 files): 1180x820 and
  1366x1024 docked + 1024x768 drawer, fine and coarse pointer; label 120x27 in
  a 28px row, mute 26–27x26, solo 28x26, no keyframe overlap, transport scroller
  reachable, document scrollWidth == innerWidth in all runs.
- Evidence total: 67 files / 20,252,844 bytes under screenshots/8adaf3377/.
- Desktop equivalence vs 1009de823: editor 20/21 byte-identical
  (desktop-1536x864 AE 0.33%); website 18/20 byte-identical
  (product-375x800 AE 0.17%, home-1366x900 AE 0.019%) — all within the <0.6%
  animated-region tolerance; report geometry matches, so no layout delta.
- Independent read-only auditor: task rows vs git PASS (all 9 first-gate done
  rows cite real ancestor commits touching expected paths), evidence dirs
  non-empty, audits clean (audit:docs, audit:emoji, audit:filesize; biome exit 0
  on the campaign-touched set). Its stale-claim findings were corrected in this
  record set (safe-area screenshot count, desktop-equivalence ratio, tasks/09
  header, STATE last-commit line).
- STATE accuracy: every done row has a commit in git log; deferred rows have
  reasons; no in-progress rows.

## Deferred (honest, with reasons)

| Task | Reason |
|---|---|
| 01b breakpoint constants | Session-2 recon: 5 files / 10 matchMedia sites (899) + 1 numeric comparison; 4 of 5 involved files are frozen >400 lines, so the extraction is line-neutral churn; --bp-* tokens are generated and unconsumed. No user-visible defect. |
| 04b remaining dialog grids | Session-2 recon corrected the drifted citations: only ContentAwareFill is a real dialog and its 2-col grids sit in a fixed 260px rail at every viewport (not viewport-dependent). The real phone defect is the dialog shell at <=480px, tracked in tasks/04b as the follow-up. |
| 05 grids and landing reflow | No defect reproduced by the 152 matrix checks or the review; re-open only with a screenshot. |
| 10 notch-safe floating overlays | No JS reads env(safe-area-inset-*); FloatingPortal clamps to the layout viewport + 8px and SpotlightOverlay left/right placements are unclamped. Implementation recipe (10a product geometry, 10b CDP harness probe) is in tasks/10; deferred for session budget, not evidence. |

## Known limitations / risks carried forward

- Real iOS/iPadOS, Android, screen-reader and physical-touch evidence is still a
  manual checklist: docs/responsive/device-checklist.md is unchecked. The CDP
  harness proves the CSS contract, not OS values.
- Packaged Tauri window-manager clamping was not exercised (config geometry was).
- Landscape-notch overlay geometry is not yet fixed (task 10).
- Layers Solo effective hit box on coarse pointers at the 1180 docked
  presentation measures 20x24 (centre reachable; fine-pointer layouts 24x24).
- ContentAwareFill dialog shell at <=480px is a real phone defect found during
  the 04b recon; it needs its own task.
- Prior-session items O1–O8 in audit.md remain open and are out of this
  campaign's changed files.

## Recovery

The repository is shippable at every campaign commit. To resume, read
docs/responsive/STATE.md (Handoff block) and pick the first deferred task with a
concrete next action (task 10 first). Rollback for each fix is recorded next to
its task; all production changes are CSS/meta/configuration only (no schema,
data or dependency changes), so reverting a commit restores the previous
behavior without migration.
