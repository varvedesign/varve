# Responsive Adaptation — State

Last updated: 2026-10-29T16:22:00-07:00 | Last commit: eb09422e5 (code checkpoint for 01a is the next commit on master)

| # | Task | Status | Commit | Next action / Blocker |
|---|---|---|---|---|
| 01a | safe-area foundation (viewport-fit=cover + shell inset + validation harness) | in-progress | — (code commit this session) | Implementation landed: viewport-fit=cover, one shell inset, fixed-overlay geometry, site header/footer/container/nav, `pnpm validate:safe-area` (66/66 smoke pass; 6 screenshots in .tmp-resp-safe-area). Next: full matrix + committed screenshots/<code-sha>/ evidence, then mark done. |
| 01b | breakpoint constants (JS literals) | not-started | — | No dependency; no user-visible payoff. Run only from a spare session. |
| 02 | compact header containment | done | 59bd283a9 | — (regression spec 2/2 pass; context bar scrolls, Share on-screen at 320–899) |
| 03a | timeline dense-data targets + duplicate label column authority | not-started | — | Depends on 01a. Reproduce at 1024x768 / 1180x820 / 1366x1024 with Layers + Timeline open (fine + coarse) before editing. |
| 03b | layers/inspector targets and dense grids | not-started | — | Depends on 02 (done), serially after 03a (both touch editor panel CSS). Reproduce before editing; close with evidence if no defect. |
| 04a | Colorize dialog phone fit | not-started | — | Depends on 02. Reproduce at 375x812 and 320x640 through the real UI first. |
| 04b | remaining dialog grid collapse | not-started | — | Depends on 04a; split per dialog family at start. Defer with a recorded reason if the session window is consumed by 04a. |
| 05 | grids and landing reflow | deferred | — | Deferred: no defect reproduced in the bounded audit; re-open only with a screenshot. |
| 06 | 13–14in shell/window geometry | done | 738c9a943 | — (Tauri default 1180x720 + center + min 480x400; harness PASS at 1180x720 and 1093x614, 7d81006e6) |
| 07 | marketing site dense tables | done | 26e8dc5a6 | — (license/perf tables in .scroll-x regions; 20/20 route-viewport checks pass) |
| 08 | documentation + committed validation harness | done | 7d81006e6 | — (pnpm validate:responsive; 41 screenshots + report in docs/responsive/screenshots/7d81006e6/; carried finding R1) |
| 09 | final validation and review gate | not-started | — | Blocked by 01a, 03a, 03b, 04a. Do not start as an implementation task. |

## Task split history (2026-10-29)

Original task files 01/03/04 were too broad for one session (their own size
checks said so). They are kept as original audit context and were split into:

- 01 → 01a (safe-area foundation; this session) + 01b (breakpoint constants).
- 03 → 03a (timeline) + 03b (layers/inspector).
- 04 → 04a (Colorize dialog) + 04b (remaining dialog grids, split per family).

## Decisions

1. **Task 01 safe-area validation method (was the only blocker) — RESOLVED.**
   Installed Playwright 1.62.1 Chromium is 151.0.7922.34 and supports
   `Emulation.setSafeAreaInsetsOverride` with the nested shape
   `{ insets: { top, bottom, left, right } }`; flat params are rejected. A
   computed-style probe on a standalone page resolved env() padding to
   47/34/11/12 px, so task 01a can be validated by emulation on this host.
   Real iOS evidence remains a manual checklist (docs/responsive/device-checklist.md).
   Rejected alternatives: test-only custom-property refactor (unnecessary and
   would migrate production CSS for testability), deferral (leaves the fix
   unvalidated).
2. **Harness edit policy (carried).** scripts/validate-responsive.mjs and
   scripts/responsive/capture.mjs are at the 400-line cap with review finding
   R1 open. New assertions therefore go into a NEW small script
   (scripts/responsive/safe-area.mjs, package script validate:safe-area) rather
   than editing the capped orchestrator. The orchestrator split remains the
   first action of the next change that must touch it.

## Blockers / open questions

1. **Task 06 packaged-window placement.** Config geometry is validated, but OS
   window-manager clamping needs a packaged Tauri run (not available here).
2. **Review finding R1.** Harness orchestrator functions exceed the 50-line
   ceiling; split (validate-responsive.mjs phases into modules) at the start of
   the next harness change. Recorded in docs/responsive/review-2026-10-29.md.

## Validation receipts (previous session, 2026-10-29)

- `pnpm typecheck:e2e` — pass (run before and after the spec change).
- compact-header-containment.spec.ts — 2/2 pass (1.3m, chromium, workers=1,
  VARVE_E2E_PORT=1541, heavy lease).
- a11y/responsive-panels + responsive/compact-drawers — 13/13 pass (7.6m).
- `validate:responsive --app all` — PASS 152/152 checks; 16 editor viewports
  incl. 1180x720, 1093x614; 20 website route-viewport pairs; 41 PNGs; report at
  docs/responsive/screenshots/7d81006e6/.
- Marketing table routes on built dist — 8/8 route-viewport pairs at
  320/375/768/1366: document scroll width == viewport; .scroll-x rows expose
  overflow-x auto, tabindex 0, role region.
- Desktop equivalence (1440x900, same browser/protocol before vs after):
  791/1,296,000 px differ (0.061%), header text antialiasing only; DOM
  geometry identical.
- Audits: audit:docs clean; audit:emoji clean; audit:filesize 0 violations;
  audit:sizing ratchet unchanged; biome 0 errors on changed files.

## Handoff (mid-session checkpoint, 2026-10-29 15:59)

**Done.** Phase 0–2.5 and tasks 02/06/07/08 (previous session). This session:
resolved the task 01 safe-area validation blocker and split the over-broad
tasks 01/03/04 into session-sized 01a/01b/03a/03b/04a/04b; updated plan and
this ledger. No production code changed in this checkpoint, so main remains
shippable.

**Mid-flight.** Nothing in code. The docs split commit is on master; the next
executable unit is 01a.

**Known-broken.** Nothing introduced. Carried pre-existing items: O1–O8 in
audit.md and D2/D3/D4/D8/D9 for the split tasks.

**Literal next action.** Implement tasks/01a-safe-area-foundation.md: add
viewport-fit=cover to both meta tags, the one .editor-shell inset padding, the
viewport-relative fixed geometry corrections (drawers/FAB/exit-focus/toasts,
--menubar-total-height static definitions), and the site header/footer/container
insets; add scripts/responsive/safe-area.mjs + validate:safe-area and
docs/responsive/device-checklist.md. Then run the new safe-area script, the full
matrix with `--app all --reuse-website-dist` (XDG_RUNTIME_DIR=/tmp under the
heavy lease), commit a fresh screenshots/<sha>/ set, mark 01a done, and continue
with 03a → 03b → 04a (→ 04b if the window allows) → 09. Do not create
COMPLETION.md before 03a/03b/04a/(04b) and 09 are done or explicitly deferred.

## Resumption prompt (paste into a fresh session)

Read docs/responsive/STATE.md, then run git log --oneline -15 and git status.
Do not re-read the codebase. From STATE.md, pick the first task marked
in-progress, then the first not-started whose dependencies are done. Read the
Handoff block. Continue from the exact next action listed. Update STATE.md in
the same commit as your next status change. If you must stop again, follow the
handoff protocol.
