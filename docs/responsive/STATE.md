# Responsive Adaptation — State

Last updated: 2026-10-29T13:11:02-07:00 | Last commit: 7d81006e6 (this commit adds committed screenshots + final ledger)

| # | Task | Status | Commit | Next action / Blocker |
|---|---|---|---|---|
| 01 | global viewport foundation (safe-area cover + breakpoint constants) | blocked | — | Question recorded under Blockers: choose the env(safe-area-inset-*) validation method before editing. |
| 02 | compact header containment (context bar + Share) | done | 59bd283a9 | — (regression spec 2/2 pass; context bar now scrolls, Share stays on-screen at 320–899) |
| 03 | tables and dense data (timeline rows, layers targets) | not-started | — | Depends on 02 (done). Reproduce at 1024x768 / 1180x820 / 1366x1024 with Layers+Timeline open before editing. |
| 04 | forms and modals (Colorize 420px floor, 2–6 column forms) | not-started | — | Depends on 02 (done). Reproduce Colorize at 375x812 first. |
| 05 | grids and landing reflow | deferred | — | Deferred: no defect reproduced in the bounded audit; re-open only with a screenshot. |
| 06 | 13–14in shell/window geometry | done | 738c9a943 | — (Tauri default 1180x720 + center + min 480x400; harness PASS at 1180x720 and 1093x614, commit 7d81006e6) |
| 07 | marketing site dense tables | done | 26e8dc5a6 | — (license/perf tables in .scroll-x regions; 20/20 site route-viewport checks pass) |
| 08 | documentation + committed validation harness | done | 7d81006e6 | — (pnpm validate:responsive; 41 screenshots + report in docs/responsive/screenshots/7d81006e6/; carried finding R1: split the harness orchestrator next) |
| 09 | final validation and review gate | not-started | — | Blocked by 01, 03, 04. Do not start as an implementation task. |

## Campaign commits (oldest → newest)

| Commit | Summary |
|---|---|
| e5e9dba40 | docs: Phase 0 research, Phase 0.5 inventory, Phase 1 audit + raw evidence, plan, 9 task files, this ledger, docs index |
| 59bd283a9 | fix(editor): compact header containment + regression spec |
| 45c35c2c5 | docs: task 02 done with e2e receipt |
| 738c9a943 | fix(desktop): Tauri window geometry for 13–14in devices |
| 26e8dc5a6 | fix(website): license/performance tables got scroll regions |
| 19f177102 | docs: task 07 done with route-check receipt |
| 7d81006e6 | feat(validation): re-runnable responsive matrix harness + pnpm validate:responsive |
| (this commit) | test(responsive): committed screenshots, review record, final ledger |

## Environment and resume facts (measured 2026-10-29)

- Repo: /home/kevina/CodingProjects/varve, branch master. The checkout is a
  shared multi-agent tree: hundreds of unrelated modified/untracked paths exist.
  Commit path-scoped only; never revert others' work; never commit the whole
  tree. The campaign's own paths are docs/responsive/**, scripts/
  validate-responsive.mjs, scripts/responsive/**, tests/e2e/responsive/
  compact-header-containment.spec.ts, packages/editor/src/editor.css (one
  compact-tier block), apps/website/src/pages/about/license.astro,
  apps/website/src/pages/docs/performance.astro, apps/desktop/src-tauri/
  tauri.conf.json, package.json (one script entry).
- Node 22.23.2, pnpm workspace. **pnpm install fails** on this host
  (ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK, read-only store); do not add
  dependencies. node_modules is installed and the app runs.
- Editor dev server: `pnpm --filter @varve/desktop exec vite --port 1420
  --strictPort` (cold transform ~90s). A live server on 1420 is reused by the
  harness; it spawns its own only when 1420 is dead and kills only its child.
- Playwright 1.62.1 + Chromium installed. Browser/leased runs in this sandbox:
  `XDG_RUNTIME_DIR=/tmp node scripts/quality/heavy-lease.mjs "<label>" -- <cmd>`
- Harness: `pnpm validate:responsive --app all --reuse-website-dist` (wraps
  the heavy lease). In this sandbox prepend XDG_RUNTIME_DIR=/tmp. Without
  --reuse-website-dist it runs `astro build` first (~14s) and serves dist.
- File-size policy: CSS is NOT capped (editor.css is 7,504 lines and editable);
  .ts/.tsx/.mjs are capped at 400 lines. The two harness modules sit at exactly
  400 (a 4-line COMPLEXITY marker pushed them to 403/404 and was rejected by
  audit:filesize:staged; see review R1).
- `tokens.css` is generated — never hand-edit.
- Screenshots: docs/responsive/screenshots/<short-sha>/ (committed with
  report.json/report.md). COMPLETION.md must NOT exist until all non-deferred
  tasks are done.

## Blockers / open questions

1. **Task 01 safe-area validation.** env(safe-area-inset-*) resolves to 0 on
   Linux/Chromium. Options: (a) inject a test-only custom-property emulation
   and assert padding math; (b) check whether the installed Chromium supports
   CDP safe-area inset emulation; (c) defer device evidence to a real iOS
   checklist. Recommendation: (a)+(c). Decision owner: next session.
2. **Task 06 packaged-window placement.** Config geometry is validated, but OS
   window-manager clamping needs a packaged Tauri run (not available here).
3. **Review finding R1.** Harness orchestrator functions exceed the 50-line
   ceiling; split (validate-responsive.mjs phases into modules) at the start of
   the next harness change. Recorded in docs/responsive/review-2026-10-29.md.

## Validation receipts (2026-10-29, committed tree)

- `pnpm typecheck:e2e` — pass (run before and after the spec change).
- compact-header-containment.spec.ts — 2/2 pass (1.3m, chromium, workers=1,
  VARVE_E2E_PORT=1541, heavy lease).
- a11y/responsive-panels + responsive/compact-drawers — 13/13 pass (7.6m).
- `validate:responsive --app all` — PASS 152/152 checks; 16 editor viewports
  incl. 1180x720, 1093x614; 20 website route-viewport pairs; 41 PNGs
  (18,108,301 bytes); report at docs/responsive/screenshots/7d81006e6/.
- Marketing table routes on built dist — 8/8 route-viewport pairs at
  320/375/768/1366: document scroll width == viewport; .scroll-x rows expose
  overflow-x auto, tabindex 0, role region.
- Desktop equivalence (1440x900, same browser/protocol before vs after):
  791/1,296,000 px differ (0.061%), header text antialiasing only; DOM
  geometry identical (menubar 91, header row 45, tabs y=92, status y=873).
- Audits: `pnpm audit:docs` clean (1,325 docs / 1,056 links / 183 ADRs);
  `audit:emoji` clean; `audit:filesize` 0 violations (4 untracked over-cap WIP
  files belong to other sessions); `audit:sizing` ratchet unchanged;
  `audit:radius` 0 legacy consumers; biome 0 errors on changed files (infos
  only in the new harness scripts).

## Handoff (end of 2026-10-29 session)

**Done.** Phase 0 research (31 sources), Phase 0.5 bounded inventory (5,337
files enumerated, 20 scored), Phase 1 audit (292 raw evidence rows + runtime
probes), Phase 2 plan + 9 task files, this ledger, a re-runnable harness with
committed evidence, and three fixes: D1 compact header containment
(59bd283a9), D6 13–14in window geometry (738c9a943), D5 marketing dense tables
(26e8dc5a6).

**Mid-flight.** Nothing: every code change is committed and shippable on all
supported widths. The only open technical debt is review finding R1 (harness
function split) and the blocked task 01 decision.

**Known-broken.** Nothing introduced by this campaign. Carried pre-existing
items: O1–O8 in docs/responsive/audit.md (dock chrome at 200% text, dual resize
handles, stale navigator baseline, layers bulk-bar, short-rail clipping,
inspector value ellipsis) and D2/D3/D4/D8/D9 for tasks 01/03/04.

**Literal next action.** Read docs/responsive/tasks/03-tables-and-dense-data.md,
open docs/responsive/STATE.md, then reproduce the timeline/layers target
geometry at 1024x768, 1180x820 and 1366x1024 (fine + coarse pointer) with
Layers and Timeline open. If you prefer a smaller first step, decide task 01's
safe-area validation method and land the viewport-fit=cover + inset padding
changes. Re-run `XDG_RUNTIME_DIR=/tmp pnpm validate:responsive --app all
--reuse-website-dist` after any change and commit a fresh screenshots/<sha>/
directory; do not create COMPLETION.md before 01/03/04 are done.

## Resumption prompt (paste into a fresh session)

Read docs/responsive/STATE.md, then run git log --oneline -15 and git status.
Do not re-read the codebase. From STATE.md, pick the first task marked
in-progress, then the first not-started whose dependencies are done. Read the
Handoff block. Continue from the exact next action listed. Update STATE.md in
the same commit as your next status change. If you must stop again, follow the
handoff protocol.