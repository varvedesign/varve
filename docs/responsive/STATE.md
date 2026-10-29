# Responsive Adaptation — State

Last updated: 2026-10-29T13:00:00-07:00 | Last commit: 26e8dc5a6 (website scroll regions; header fix 59bd283a9, window geometry 738c9a943)

| # | Task | Status | Commit | Next action / Blocker |
|---|---|---|---|---|
| 01 | global viewport foundation (safe-area cover + breakpoint constants) | blocked | — | Question recorded under Blockers: how to validate env(safe-area-inset-*) without iOS/CDP inset emulation. |
| 02 | compact header containment (context bar + Share) | done | 59bd283a9 | — (spec tests/e2e/responsive/compact-header-containment.spec.ts: 2/2 pass; final matrix screenshots land in task 08 commit) |
| 03 | tables and dense data (timeline rows, layers targets) | not-started | — | Depends on 02. Reproduce before editing (timeline 16px mute/solo, duplicate 120/140px label width). |
| 04 | forms and modals (Colorize 420px floor, 2–6 column forms) | not-started | — | Depends on 02. Reproduce Colorize at 375 first. |
| 05 | grids and landing reflow | deferred | — | Deferred: no defect reproduced in bounded audit; re-open only with a screenshot. |
| 06 | 13–14in shell/window geometry | in-progress | 738c9a943 | Config committed (default 1180x720 + center + min 480x400). Blocked on harness final matrix at 1180x720/1093x614 before marking done. |
| 07 | marketing site dense tables | done | 26e8dc5a6 | — (Chromium route check: doc=viewport at 320/375/768/1366; wrapper overflow-x auto, tabindex=0, role=region) |
| 08 | documentation + committed validation harness | in-progress | — | Teammate building scripts/validate-responsive.mjs + scripts/responsive/*.mjs; Lead adds package.json validate:responsive; committed screenshots under docs/responsive/screenshots/<sha>/ after fixes land. |
| 09 | final validation and review gate | not-started | — | Blocked by 01, 03, 04 (do not start as an implementation task). |

## Environment and resume facts (measured 2026-10-29)

- Repo: /home/kevina/CodingProjects/varve, branch master. The checkout is a
  shared multi-agent tree: hundreds of unrelated modified/untracked paths exist.
  Commit path-scoped only; never revert others' work; never commit the whole
  tree. Session base commit: 6128380b3.
- Node 22.23.2, pnpm workspace. **pnpm install fails** on this host
  (ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK, read-only pnpm store); do not try
  to add dependencies. node_modules is already installed and the app runs.
- Editor dev server: `pnpm --filter @varve/desktop exec vite --port 1420
  --strictPort` (cold transform ~90s; Playwright global setup warms it).
- Playwright 1.62.1 + Chromium installed. Browser runs must use the heavy
  lease and a writable lease dir:
  `XDG_RUNTIME_DIR=/tmp node scripts/quality/heavy-lease.mjs "<label>" -- <cmd>`
- Validation harness (task 08): `pnpm validate:responsive` once package.json
  entry is added; otherwise `node scripts/validate-responsive.mjs --app editor`.
- File-size policy: CSS is NOT capped (editor.css is 7,504 lines and editable);
  .ts/.tsx/.mjs are capped at 400 lines (new spec/scripts must stay under).
- `tokens.css` is generated — never hand-edit; it is not the place for
  responsive rules.
- Screenshots live in docs/responsive/screenshots/<short-sha>/, committed with
  report.json/report.md. COMPLETION.md must NOT exist until all non-deferred
  tasks are done.

## Blockers / open questions

1. **Task 01 safe-area validation.** env(safe-area-inset-*) resolves to 0 on
   Linux/Chromium. Options: (a) inject a test-only custom-property emulation
   and assert padding math; (b) check whether installed Chromium supports
   CDP safe-area inset emulation; (c) defer device evidence to a real iOS
   checklist. Recommendation: (a)+(c). Decision owner: next session.
2. **Task 06 packaged-window placement.** The config change is validated as a
   geometry contract (viewport matrix); OS window-manager clamping needs a
   packaged Tauri run, not available here.

## Session validation receipts (append as runs complete)

- Runtime matrix probe (pre-fix): 13 fine-pointer widths + 4 coarse contexts;
  document overflow 0; D1 header clipping reproduced at 320/390.
- docs/responsive/audit-raw.md: 292 evidence rows; auditor reported no source
  edits and only docs/responsive/ untracked.
- compact-header-containment.spec.ts: 2/2 pass (chromium, workers=1, VARVE_E2E_PORT=1541, heavy lease) in 1.3m; see commit 59bd283a9.
- Marketing table routes (/about/license, /docs/performance): Chromium check at 320/375/768/1366, docScrollWidth == viewport at all 8 route/viewport pairs; .scroll-x wrapper overflow-x auto, tabindex 0, role region (evidence .tmp-resp/website-check/results.json, final screenshots via harness).
- (pending) validate:responsive final
  run; website routes run.

## Handoff (in progress — rewrite at session end)

Done: Phase 0 research (31 sources), Phase 0.5 bounded inventory, Phase 1
audit + runtime probes, Phase 2 plan + 9 task files, this ledger.
Mid-flight: task 02 CSS rule, task 06 config, task 07 page wrappers, task 08
harness teammate. Do not trust prose over git: run `git log --oneline -10` and
`git status` and compare with the table above.
Next command:

    pnpm validate:responsive --app editor

## Resumption prompt (paste into a fresh session)

Read docs/responsive/STATE.md, then run git log --oneline -15 and git status.
Do not re-read the codebase. From STATE.md, pick the first task marked
in-progress, then the first not-started whose dependencies are done. Read the
Handoff block. Continue from the exact next action listed. Update STATE.md in
the same commit as your next status change. If you must stop again, follow the
handoff protocol.