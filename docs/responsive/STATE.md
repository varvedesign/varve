# Responsive Adaptation — State

Last updated: 2026-10-29T18:05:00-07:00 | Last commit: 39e9be06e (final evidence commit is the next commit on master)

| # | Task | Status | Commit | Next action / Blocker |
|---|---|---|---|---|
| 01a | safe-area foundation (viewport-fit=cover + shell inset + CDP validation harness) | done | 95f2b82a0 (+coverage 811d3519b) | — `validate:safe-area` 134/134, 0 skipped; 12 screenshots in screenshots/39e9be06e/safe-area/; review blocker fixed; site + editor covered. |
| 01b | breakpoint constants (JS literals) | deferred | — | No user-visible defect; no session window left. Module split specified in tasks/01b-breakpoint-constants.md; start there when a spare session exists. |
| 02 | compact header containment | done | 59bd283a9 | — (regression spec 2/2 pass; context bar scrolls, Share on-screen at 320–899) |
| 03a | timeline dense data (single label authority, hit targets, docked controls) | done | b7ec4c832 + ad39db84a + 39e9be06e | — verified independently by repro-broker: label 120px/13px/27px in a 28px row, solo+mute centres hit their own buttons, panel scroll locked, playback controls scroller reachable. Residual: mute/solo effective boxes 16-19x23 (see 03b). Evidence: screenshots/39e9be06e/timeline/. |
| 03b | layers/inspector dense targets + mute/solo target size | deferred | — | Reproduced: at container <=260px (incl. 1180 docked) layers solo/details are display:none for both pointer types, so touch loses solo; disclosure/eye/lock are 24x24 elsewhere; timeline mute/solo effective hit boxes 16-19x23 (centres reachable, below the 24px floor). Recipe + numbers in audit.md D3 and .tmp-resp-repro (gitignored); fix per-panel container query and re-measure. |
| 04a | Colorize dialog phone fit | done | bf3ef53bc | — NO DEFECT: cited dialog CSS was dead (zero consumers); real inspector section overflow-free and hittable at 375/320. Removed the 9 dead rules. Evidence: screenshots/bf3ef53bc/colorize/. |
| 04b | remaining dialog 2-column grids | deferred | — | Dead-floor defect was 04a; real dialog grids (ContentAwareFill etc.) were not reproduced at phone width; split per family when reproduced (task file has the list). |
| 05 | grids and landing reflow | deferred | — | No defect reproduced in the bounded audit; re-open only with a screenshot. |
| 06 | 13–14in shell/window geometry | done | 738c9a943 | — (Tauri default 1180x720 + center + min 480x400; harness PASS at 1180x720 and 1093x614) |
| 07 | marketing site dense tables | done | 26e8dc5a6 | — (license/perf tables in .scroll-x regions; 20/20 route-viewport checks pass) |
| 08 | documentation + committed validation harness | done | 7d81006e6 | — (pnpm validate:responsive; carried finding R1: orchestrator split) |
| 09 | final validation and review gate | done | 39e9be06e | — final matrix 152/152 + safe-area 134/134 committed; audits clean; see COMPLETION.md |

## Campaign commits (oldest → newest, this campaign)

| Commit | Summary |
|---|---|
| e5e9dba40 | Phase 0–2.2 docs (research, inventory, audit, plan, task files, ledger) |
| 59bd283a9 | D1 compact header containment + regression spec |
| 738c9a943 | D6 13–14in Tauri window geometry |
| 26e8dc5a6 | D5 marketing dense-table scroll regions |
| 7d81006e6 | D7 validation harness (`pnpm validate:responsive`) |
| e1ef848df | first matrix evidence set + review |
| eb09422e5 | split tasks 01/03/04 into session-sized units; safe-area decision |
| 0957d2db6 | D2 safe-area foundation (meta + shell inset + fixed overlays + site) |
| 95f2b82a0 | 01a review blocker fix + extended safe-area harness (tablet/exit-focus/env0) |
| 4c79f66dd | 01a evidence (124 safe-area + 152 matrix screenshots) |
| b7ec4c832 | 03a timeline: one label authority, keyframe overlap fix |
| bf3ef53bc | 04a dead Colorize CSS removal |
| 811d3519b | 01a coverage-gap closure (exact tablet deltas, both-orientation exit-focus, skipped accounting) |
| ad39db84a | 03a follow-up: docked playback-controls scroller (superseded by 39e9be06e) |
| 39e9be06e | 03a follow-up 2: keep select shrink under the playback scroller (FINAL HEAD) |

## Decisions

1. **Safe-area validation (task 01 blocker) — resolved with CDP emulation.**
   Playwright 1.62.1 / Chromium 151 supports
   `Emulation.setSafeAreaInsetsOverride` with nested `{ insets: {top,bottom,left,right} }`
   (flat shape rejected). A standalone computed-style probe proved real env()
   resolution; real-device evidence remains the manual checklist in
   docs/responsive/device-checklist.md. Both cdp-scout and the Lead reproduced
   the method independently.
2. **Harness placement.** The old matrix orchestrator is at the 400-line cap
   with review finding R1 open, so the safe-area assertions live in new
   modules (scripts/responsive/safe-area/*, 32-385 lines each) and a new
   `pnpm validate:safe-area` script; the matrix orchestrator was not edited.
3. **Colorize 04a.** The cited 420px floor was dead CSS, so the task closes
   no-defect and deletes the dead rules rather than adding a capped floor
   nothing consumes.
4. **Review-driven coverage.** Tablet launcher inset terms are proven by exact
   with-insets-vs-cleared deltas (not floor checks), and exit-focus is measured
   in both orientations; the harness reports skipped checks separately.

## Validation receipts (final, 2026-10-29)

- `pnpm validate:responsive --app all --reuse-website-dist` on 39e9be06e —
  PASS 152/152 checks, 41 screenshots (18,014,312 bytes) in
  docs/responsive/screenshots/39e9be06e/. Includes 1180x820, 1366x1024,
  1024x1366, 1366x768, 1280x800, 1440x900, 1512x982, 1536x864 and the
  layers-open frame at every viewport.
- `pnpm validate:safe-area` — PASS 134/134, 0 failed, 0 skipped; 12
  screenshots in screenshots/39e9be06e/safe-area/ (portrait + landscape phones,
  forced tablet >=900 standard/mirrored with exact inset deltas, exit-focus
  both orientations, env()=0 desktop baseline, served site build).
- Desktop equivalence vs 7d81006e6: 16/16 editor viewports within 1px shell
  registration (uniform capture offset, no layout delta); website 18/20
  screenshots byte-identical, 2 differ only in animated regions (<0.6% AE).
- Independent review: cdp-scout round 1 (tablet >=900 cascade blocker + missing
  coverage) and round 2 (two vacuity gaps) — all fixed and re-verified;
  repro-broker verified tasks 03a/04a with committed evidence.
- Audits: audit:docs, audit:emoji, audit:filesize, biome clean on the changed
  set; agent map regenerated each commit.

## Open items / carried risks

1. **Packaged Tauri window-manager clamping** (task 06 config geometry is
   validated; needs a packaged run).
2. **Real iOS/device evidence** — docs/responsive/device-checklist.md is still
   unchecked; no iOS/iPadOS/Android/screen-reader run.
3. **Timeline mute/solo target size** — effective 16-19x23 (centres reachable,
   below 24x24 WCAG 2.5.8); queue with task 03b.
4. **Task 03b layers <=260px solo/details loss** — deferred fix.
5. **Transient overlays** — spotlight tooltip and floating-layer portals are
   JS-positioned and can sit under a landscape notch.
6. **R1** — `scripts/validate-responsive.mjs` orchestrator function split is
   still queued (its two modules sit at the 400-line cap).
7. Prior-session items O1–O8 in audit.md remain open/out of scope.

## Handoff (final, 2026-10-29)

**Done.** Whole campaign Phase 0–6: research, bounded inventory, audit, task
splits, implementation, committed visual validation, independent reviews,
completion record. Fixed D1/D2/D5/D6 and D3-timeline; D4 was dead CSS and was
removed. The final tree is shippable on desktop, 13–14in, tablet and phone.

**Mid-flight.** Nothing: every code and evidence change is committed on
master; the final evidence commit (this file, COMPLETION.md, screenshots
39e9be06e + timeline/colorize evidence) immediately follows this HEAD.

**Known-broken.** Nothing introduced. The known limitations are listed above
(real-device evidence, muted residual target size, 03b/04b/01b/05 deferrals);
none of them breaks a supported layout.

**Environment facts for the next session.** Repo
/home/kevina/CodingProjects/varve on master. This checkout is shared by
multiple agents: commit path-scoped only, never revert others' uncommitted
paths, regenerate docs/agents/repo-map.generated.md before committing (the
pre-commit hook enforces it). pnpm commands work but may print a read-only
store warning; node_modules is installed. The editor dev server can be started
with `XDG_RUNTIME_DIR=/tmp pnpm --filter @varve/desktop exec vite --port 1420
--strictPort`; validation runs are heavy-lease wrapped and screenshots are
written to docs/responsive/screenshots/<short-sha>/. CSS is not capped; .mjs
files are capped at 400 lines. The old matrix orchestrator is at the cap (R1).

**Literal next action.** Read docs/responsive/tasks/03b-layers-inspector-targets.md
and docs/responsive/STATE.md, then reproduce the 1180x820 docked layers
solo/details display:none at container <=260px (recipe in audit.md D3 and
.tmp-resp-repro, gitignored), fix the container query per panel, re-measure the
mute/solo effective extents (target 24x24 without changing row height), and
commit with screenshots. If no defect reproduces at the real device width,
close 03b with the measurement instead. Only then pick 01b/04b.

## Resumption prompt (paste into a fresh session)

Read docs/responsive/STATE.md and docs/responsive/COMPLETION.md, then run
git log --oneline -20 and git status. Do not re-read the codebase. Pick the
first deferred task with a concrete next action (03b first), follow the task
file's Scope/Change/Validation/Rollback and its Size check, and update
STATE.md in the same commit as any status change. If you must stop, follow the
handoff protocol: update the ledger, leave the repo shippable, and record the
literal next command.
