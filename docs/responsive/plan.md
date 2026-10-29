# Responsive adaptation — plan (Phase 2)

Derived from docs/responsive/research-2026-10-29.md,
docs/responsive/inventory.md and docs/responsive/audit.md. Each task is
independently executable by a fresh session; the ledger that says where we are
is docs/responsive/STATE.md.

## Ordering and dependencies

1 → 2 (header/nav containment; 2 needs no new tokens)
2 → 3 (table/dense-data strategies reuse the containment rules)
2 → 4 (forms/modals reuse the compact containment)
1 + 6 → 9 (final validation depends on foundation + the 13in shell)
7 is independent (marketing site).
8 (harness/docs) is independent and must be re-run after every task.

## Status legend
not-started / in-progress / blocked / done / deferred — see STATE.md rows for
the authoritative status. Task files state their own rollback commit when done.

## Working rules for this campaign

- Additive changes first: new selectors/rules, new spec files; avoid rewriting
  shared blocks while another task is mid-flight.
- A responsive assertion relied on manually must be re-runnable: either the
  repo e2e matrix/spec, or scripts/validate-responsive.mjs. Do not rely on a
  one-off session script.
- Visual evidence is committed under docs/responsive/screenshots/<sha>/, with
  the harness report, not just viewed in-session.
- Every commit must leave main shippable: no half-applied responsive state on
  any supported viewport (desktop, 13in band, tablet, phone).
- File-size policy: CSS is out of the 400-line cap; .ts/.tsx/.mjs are in it.
  New spec/script files must stay <=400 lines.
- Do not touch docs/screenshots/, packages/editor/src/editor.css hunks owned by
  other concurrent sessions: re-read immediately before editing, and commit
  path-scoped.

## Validation protocol (per task)

- Widths: 320, 375, 390, 768, 1024, 1180, 1366, 1440, 1536 CSS px; 13–14in
  both orientations: 820x1180, 1024x1366, 1180x820, 1366x768, 1366x1024,
  1280x800, 1512x982.
- Input modes: fine pointer (desktop Chromium) for every change; coarse
  pointer (hasTouch) for any touch-visible rule; keyboard for focus changes.
- States: default, side panel open, densest table/form, menu open.
- Assertions: no page-level horizontal overflow; no clipped critical action
  unless it lives in a real scroller; desktop layout byte-identical at 1440
  for chrome that is not intended to change.
- Evidence: screenshots at the widths the task lists, committed; plus the
  harness report.json/report.md for the full matrix.

## Task files

| # | File | Purpose | Status |
|---|---|---|---|
| 01 | tasks/01-global-viewport-foundation.md | safe-area/cover meta + breakpoint constants; shared foundation | blocked (validation method) |
| 02 | tasks/02-compact-header-containment.md | fix D1: context bar/Share clipping at 320–899 | done (59bd283a9) |
| 03 | tasks/03-tables-and-dense-data.md | timeline/layers dense-data targets and fixed columns | not-started |
| 04 | tasks/04-forms-and-modals.md | fixed dialog floors (Colorize 420px), 2–6 column forms | not-started |
| 05 | tasks/05-grids-and-reflows.md | Home/site grid ladders; deferred unless a defect is reproduced | deferred |
| 06 | tasks/06-thirteen-inch-shell.md | Tauri window bounds + 13–14in coverage (D6/D7) | done (738c9a943, validated 7d81006e6) |
| 07 | tasks/07-marketing-site.md | site tables, routes, nav breakpoint review (D5) | done (26e8dc5a6) |
| 08 | tasks/08-docs-and-validation-harness.md | harness + committed screenshots + docs | done (7d81006e6 + artifact commit) |
| 09 | tasks/09-final-validation-and-review.md | full matrix, desktop-equivalence diff, review gate | not-started |
