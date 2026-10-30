# Responsive Adaptation — State

Last updated: 2026-10-29T18:50:00-07:00 | Last commit: a0ff6f78a (session-2 evidence + close-out; code HEAD 8adaf3377)

| # | Task | Status | Commit | Next action / Blocker |
|---|---|---|---|---|
| 01a | safe-area foundation (viewport-fit=cover + shell inset + CDP validation harness) | done | 95f2b82a0 (+coverage 811d3519b) | — validate:safe-area 134/134, 0 skipped; 10 PNG (12 files incl. reports) in screenshots/8adaf3377/safe-area/; re-run clean in session 2. |
| 01b | breakpoint constants (JS matchMedia literals) | deferred | — | Session-2 recon: 5 files / 10 matchMedia sites (899) + 1 numeric comparison; 4 of 5 involved files frozen >400 lines; --bp-* tokens generated + unconsumed; no user-visible defect. Details in tasks/01b. |
| 02 | compact header containment | done | 59bd283a9 | — regression spec 2/2; context bar scrolls, Share on-screen at 320–899; matrix re-run clean at 8adaf3377. |
| 03a | timeline dense data (single label authority, hit targets, docked controls) | done | b7ec4c832 + ad39db84a + 39e9be06e | — re-verified by the new committed probe at 8adaf3377 (121/121). |
| 03b | layers/action reachability + timeline target size | done | b8ae12951 + 358d9ae2c + 1009de823 | — probe re-run at 8adaf3377: panel 259.6/288/273.9/320, label 120x27, mute 26–27x26, solo 28x26, doc no overflow; coarse-1180 Solo residual 20x24 documented. |
| 04a | Colorize dialog phone fit | done | bf3ef53bc | — no defect; dead CSS removed. |
| 04b | remaining dialog 2-column grids | deferred | — | Session-2 recon: citations drifted; only ContentAwareFill is a real dialog and its grids sit in a fixed 260px rail at every viewport. Real follow-up = CAF dialog shell at <=480px (recipe in tasks/04b). |
| 05 | grids and landing reflow | deferred | — | No defect reproduced by 152 matrix checks or review; re-open only with a screenshot. |
| 06 | 13–14in shell/window geometry | done | 738c9a943 | — Tauri 1180x720 / min 480x400 / centered; harness PASS at 1180x720 and 1093x614. |
| 07 | marketing site dense tables | done | 26e8dc5a6 | — license/perf tables in .scroll-x regions; 20/20 route-viewport pairs PASS at 8adaf3377. |
| 08 | documentation + committed validation harness | done | 7d81006e6 + 757e304be/8adaf3377 (R1) + 441bf1127 (dense) | — validate:responsive/safe-area/dense all committed and re-runnable. |
| 09 | final validation and review gate | done | 1009de823 (first gate) + session-2 re-gate at 8adaf3377 | — matrix 152/152, safe-area 134/134, dense 121/121; evidence under screenshots/8adaf3377/. |
| 10 | notch-safe floating overlay geometry | deferred | — | Implementation recipe in tasks/10-notch-overlay-geometry.md (10a product geometry + 10b CDP harness probe). No JS reads env(safe-area-inset-*). |
| 11 | dense-data re-runnable probe (open item 6) | done | 441bf1127 | — `pnpm validate:dense`; PASS 121/121 at 8adaf3377, evidence in screenshots/8adaf3377/dense/. |
| 12 | R1 harness function/module split (review finding) | done | 757e304be + 8adaf3377 | — validate-responsive 287, capture 207, server 146, editorProbe 201 lines; full matrix green. |

## Campaign commits (oldest → newest)

| Commit | Summary |
|---|---|
| e5e9dba40 | Phase 0–2.2 docs (research, inventory, audit, plan, task files, ledger) |
| 59bd283a9 | D1 compact header containment + regression spec |
| 738c9a943 | D6 13–14in Tauri window geometry |
| 26e8dc5a6 | D5 marketing dense-table scroll regions |
| 7d81006e6 | D7 validation harness (validate:responsive) |
| e1ef848df | first matrix evidence set + review |
| eb09422e5 | split tasks 01/03/04 into session-sized units; safe-area decision |
| 0957d2db6 | D2 safe-area foundation (meta + shell inset + fixed overlays + site) |
| 95f2b82a0 | 01a review blocker fix + extended safe-area harness |
| 4c79f66dd | 01a evidence (124 safe-area + 152 matrix screenshots) |
| b7ec4c832 | 03a timeline: one label authority, keyframe overlap fix |
| bf3ef53bc | 04a dead Colorize CSS removal |
| 811d3519b | 01a coverage-gap closure |
| ad39db84a | 03a follow-up: docked playback-controls scroller |
| 39e9be06e | 03a follow-up 2: keep select shrink under the playback scroller |
| 4a8f9cf79 | chore: report skipped checks in safe-area harness summary |
| b8ae12951 | 03b first pass: layers fallback threshold + 24px timeline targets |
| 358d9ae2c | 03b follow-up: details yield at 260, solo at 220; unclip label box |
| 1009de823 | 03b follow-up 2: label stacks above keyframe hit regions (first-gate code HEAD) |
| 92bafa377 | first-gate final matrix + completion record |
| 999823d15 | first-gate evidence commit (03b) |
| 757e304be | R1: harness server lifecycle + editor probes extracted into modules |
| 441bf1127 | dense-data probe (replaces scratch .tmp-resp-repro) + validate:dense |
| 8adaf3377 | R1 follow-up: ROOT resolution fix after the move (FINAL CODE HEAD) |

## Decisions

1. Safe-area validation resolved with CDP emulation (Playwright 1.62.1 / Chromium 151, Emulation.setSafeAreaInsetsOverride); real-device evidence remains the manual checklist.
2. Harness placement: old matrix orchestrator at the 400-line cap with R1 open, so safe-area assertions live in new modules and a new validate:safe-area script.
3. Colorize 04a: the cited 420px floor was dead CSS, so the task closes no-defect and deletes the dead rules.
4. Review-driven coverage: tablet launcher insets proven by exact with-insets-vs-cleared deltas; exit-focus measured in both orientations; skipped checks reported separately.
5. Layers fallback belongs to the documented 180px minimum (220px container), not every rail under 260px; Details yields at 260px (panel header + context menu remain).
6. Session-2: completion claims were re-audited against git and corrected where stale (safe-area screenshot count, desktop-equivalence ratio, tasks/09 header). Docs now match the committed evidence.
7. Session-2: 04b and 01b are re-deferred after bounded recon; their citations were drifted and the cited failures are not viewport-dependent or frozen-file-trapped. Notch overlays are deferred with a concrete two-commit recipe (tasks/10).
8. Session-2: evidence is anchored to code HEAD 8adaf3377; product code is unchanged since 1009de823 (only harness scripts and docs changed), and the re-run matches the prior geometry within animated-region tolerance.

## Validation receipts (final, 2026-10-29 session 2)

- `validate:responsive --app all --reuse-website-dist` on 8adaf3377 — PASS
  152/152 checks, 0 failed, 41 PNGs (18,029,601 bytes) in
  screenshots/8adaf3377/ (16 editor viewports incl. 1093x614, 1180x720,
  1180x820, 1366x1024, 1024x1366, 1440x900, 1512x982, 1536x864 + layers-open
  frames; 20 site route-viewport pairs).
- `validate:safe-area` — PASS 134/134, 0 failed, 0 skipped, 10 PNGs (12 files)
  in screenshots/8adaf3377/safe-area/.
- `validate:dense` — PASS 121/121, 0 failed, 10 PNGs (12 files) in
  screenshots/8adaf3377/dense/.
- Desktop equivalence vs 1009de823: editor 20/21 byte-identical (desktop-1536x864
  AE 0.33%); website 18/20 byte-identical (product-375x800 AE 0.17%,
  home-1366x900 AE 0.019%) — all within the <0.6% animated-region tolerance.
- Drift checks on a3796c0ba (assertions only): matrix 152/152, safe-area
  134/134, dense 121/121.
- Audits: audit:docs, audit:emoji, audit:filesize clean; biome exit 0 on the
  campaign-touched set.
- Independent auditor (read-only) re-checked task rows vs git, evidence dirs and
  audits: PASS except the stale doc counts, fixed in this commit.

## Open items / carried risks

1. Notch-safe floating overlays — deferred; recipe in tasks/10 (previously
   carried risk #4).
2. Real iOS/Android/screen-reader evidence — docs/responsive/device-checklist.md
   still unchecked; CDP proves the CSS contract, not OS values.
3. Packaged Tauri window-manager clamping — config geometry validated, packaged
   run still needed.
4. Layers Solo coarse effective hit box is 20x24 at the 259.6px docked
   presentation (centre reachable; fine-pointer layouts 24x24).
5. ContentAwareFill dialog shell at <=480px — real phone defect found during the
   04b recon, out of the 04b grid-collapse scope; needs its own task.
6. 01b breakpoint constants — maintainability only; split shape recorded in
   tasks/01b.
7. Prior-session items O1–O8 in audit.md remain open/out of scope.

## Handoff (final, 2026-10-29 session 2)

**Done.** Session 2 independently re-ran all three harnesses, closed R1 and the
dense-data probe, fixed the R1 ROOT follow-up, corrected stale completion
claims, and committed fresh evidence under screenshots/8adaf3377/. Campaign
state: 11 done, 4 deferred (01b, 04b, 05, 10 — each with a recorded
reason), 0 in-progress. Code HEAD 8adaf3377; product code unchanged since
1009de823.

**Mid-flight.** Nothing.

**Known-broken.** Nothing. Known limitations are the open items above; none
breaks a supported layout.

**Environment facts.** Repo /home/kevina/CodingProjects/varve on master. Main
checkout shared with another session: commit path-scoped only and never stage
its untracked files (see git status). `XDG_RUNTIME_DIR=/tmp` is required for
heavy-lease runs here (validation-queue path is EROFS); pnpm pre-scripts print a
read-only-store warning but direct node entrypoints work. Regenerate the agent
map (`node scripts/quality/generate-agent-map.mjs --write`) before any commit
that adds/removes tracked files. Editor dev server:
`XDG_RUNTIME_DIR=/tmp pnpm --filter @varve/desktop exec vite --port 1420 --strictPort`.

**Literal next action.** Tackle task 10 (notch overlays): implement 10a
(root env() bridge + safeAreaInsets in overlayGeometry.ts + SpotlightOverlay
clamp, with unit tests), then 10b (safe-area harness overlay checks under
LANDSCAPE_INSETS), re-run validate:safe-area and commit screenshots/<sha>/.

## Resumption prompt (paste into a fresh session)

Read docs/responsive/STATE.md, docs/responsive/COMPLETION.md and
docs/responsive/verification-2026-10-29-session-2.md, then run
git log --oneline -15 and git status. Do not re-read the codebase. Pick the
first deferred task with a concrete next action (10 notch overlays, then 04b
CAF shell / 01b), or the carried open items above. Follow the task file's
Scope/Change/Validation/Rollback and Size check, re-run
validate:responsive/safe-area/dense after any change, commit fresh
screenshots/<sha>/, and update this ledger in the same commit as any status
change.
