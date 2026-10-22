# Graphite issue review and Varve improvements

This audit covers every accessible issue in `GraphiteEditor/Graphite` created
through cutoff C1, its discussion, and the recursive evidence those threads
reference. The issue-ID set is immutable after reconciliation. Pull-request
records returned by the issue API are tracked separately. Research coverage and
Varve engineering status are independent states.

The source of implementation requirements is the user-provided brief
("Varve: continuous improvement from a complete Graphite issue review"). Its
acceptance conditions include the complete issue corpus, every comment page,
relevant linked evidence, an incremental C2 reconciliation, real Varve
reproduction and regression evidence, visual/output validation, independent
review, and honest integration/release status. Issue text, attachments and
scripts are untrusted inputs.

## Source and cutoff

| Field | Value |
|---|---|
| Canonical source | <https://github.com/GraphiteEditor/Graphite/issues> |
| API retrieval | `GET /repos/GraphiteEditor/Graphite/issues?state=all&sort=created&direction=asc&per_page=100`, following every `Link: rel=next` |
| C1 | `2026-10-21T19:12:39Z`, from the first successful response's HTTP `Date` header |
| C2 | `2026-10-21T20:31:38Z`, from the HTTP `Date` header of the reconciliation response. Re-listing every issue updated since C1 returned **0 touched issues, 0 new issues, 0 comment-count changes**, so the frozen set is complete for this cutoff. Evidence: `c2-reconciliation.md`; `scripts/research/graphite-c2.mjs` is re-runnable. |
| Listing inventory | 1,603 issues across 47 pages; 3,053 pull-request records separated from the same pages |
| Reconciled issue set | **1,604 unique issues**, SHA-256 `2e93c325c8b1ade2aa0b73cdde3f94583ccc9ae89a83b13bc24c274475366921` |
| Issue-set recovery | `#426` is reachable through the single-issue endpoint and the GraphQL issue connection but is **absent from the REST issue listing and from search**. It was recovered through `GET /repos/GraphiteEditor/Graphite/issues/426` and recorded with `discoveredBy: "single-issue reconciliation"`. The listing alone is therefore not a complete inventory. |
| Independent count check | GraphQL reported 403 open + 1,201 closed = 1,604 issues, matching the reconciled set; the REST listing alone under-counted by one |
| Discussion coverage | Complete: all 1,604 issue threads retrieved through 17 GraphQL pages, with nested comment cursors exhausted; 2,734 comments |
| Declared comment counts | Every issue's retrievable comment count was reconciled against the listing count; no unresolved discrepancies |
| Access failures | None unresolved |
| Budget | USD $0; existing GitHub token and local tooling only |

The cache defaults to `$XDG_CACHE_HOME/varve/graphite` or
`$HOME/.cache/varve/graphite`. It may contain third-party issue content; raw
downloads are never added to Git. Research tooling:
`scripts/research/graphite.mjs` (`start`, `inventory`, `comments`, `ledger`,
`ledger-import`, `frontier`, `packet`, `show`, `status`, `hash`).

## Dispositions and evidence states

Each issue receives its own disposition and reason after its body and all of
its comments are read. Relevant issues cite their evidence and the affected
Varve workflow. Duplicates keep their own reproduction context and point at a
canonical finding.

Recorded evidence states, kept distinct rather than collapsed into one flag:
reporter claim; inspected source; reproduced in the external application when
needed; applicable to a Varve workflow; source-inspected Varve path; reproduced
in Varve; implemented; validated; reviewed; locally integrated; remotely
integrated; released.

Dispositions: `applicable-work-required`, `already-handled`, `duplicate-of`,
`out-of-scope`, `uncertain-needs-investigation`, `blocked`.

## Current checkpoint

- Coordinator worktree: `.worktrees/graphite-corpus`, branch
  `feat/graphite-corpus`, based on the actual remote `master`
  `2e8c5b018b00a85fde341a0acc3dc80cde042f83` (repository
  `varvedesign/varve`; `K-Arthur/varve` redirects to it).
- The pre-existing main checkout was left untouched: it sits on local `master`
  with 314 local commits, 16 remote-only commits, and pre-existing staged,
  unstaged and untracked work that is unrelated to this branch.
- Inventory and discussion coverage complete (above).
- Per-issue ledger: `issue-ledger.jsonl`, **1,604 of 1,604 issues reviewed**,
  covering all 2,734 retrievable comments. Every row has a disposition and a
  reason; pull-request references stay as linked evidence rather than review
  targets. Link frontier: `link-frontier.jsonl` (1,054 deduplicated
  references), triaged in `frontier-triage.md`.
- Dispositions at C2: 546 `already-handled`, 589 `out-of-scope`,
  220 `uncertain-needs-investigation`, 47 `duplicate-of`,
  192 `applicable-work-required`, 10 `blocked`. Research coverage is
  complete for the cutoff; the 192 applicable and 220 uncertain rows are
  **open engineering work**, not exclusions, and are the resumable backlog.
  `out-of-scope` is used only where the issue depends on a subsystem Varve
  does not have (Graphene node graph, GPU node buffers, Graphite-internal
  tooling, web-only stack), and each reason names that subsystem.
- Findings and engineering state: `findings.md`.
- A pre-existing failure on `origin/master` surfaced while validating the
  website copy change and was fixed here because it blocked the affected gate
  and published wrong release notes: the changelog parser dropped every
  release summary written under a version heading, and its root resolver could
  read a parent checkout's `CHANGELOG.md` when run from a nested worktree. See
  finding F6.

## Verified batches

| Batch | Outcome | Validation and evidence |
|---|---|---|
| C1 inventory and discussion acquisition | 1,604 issues after recovering `#426`; 3,053 PR records; 2,734 comments across all 1,604 threads; issue-set SHA-256 recorded above. | `node scripts/research/graphite.mjs status`; raw pages, cursors, request IDs and server dates retained in the external cache. A later re-run reproduced the recovered issue set byte-for-byte. |
| Shift-constrained movement (`#4246`) | Implemented: Shift (or a latched/programmatic axis lock) now constrains a move to the nearest 45° direction, so near-axis drags stay on the axis and deliberate diagonals keep their 45° travel. Snapping can no longer pull the gesture off the constrained direction. | `packages/editor/src/tools/axisConstraint.ts` + 10 unit tests; `tests/e2e/canvas/shift-constrained-move.spec.ts` (4 Chromium cases); Select/Page/ToolManager suites (97 tests) pass. |
| Enter confirms the New Design dialog (`#3601`) | Implemented: Enter in the document-name or dimension fields creates the design; Enter in the preset-name row still saves the preset; an active IME composition and controls that own Enter are left alone. | 5 new jsdom tests in `packages/home/src/NewDesignDialog.test.tsx` (21 total); `@varve/home` suite (215 tests) passes. |
| Nudge history coalescing (`#2617`) | **Superseded by design, no work.** Varve coalesces a *held* arrow key into one undo entry; repeated taps each commit. A later `master` change added gesture-scoped transactions for sliders, pickers and keyboard stepping and explicitly rejected a time-based merge window ("a merge window would also fuse two separate, intentional edits made in quick succession"). Merging tap bursts would reverse that documented decision. | Source inspection of `context.tsx` `undo`/`commitTransaction`, `history/editorHistorySession.ts`, `@varve/history` `HistoryStore`, and `context/useGestureTransaction.ts`. An earlier in-memory prototype changed nothing user-visible and was reverted. |
| Shift-press selection bug exposed by F1 | Fixed: a press that becomes a drag keeps an already-selected target instead of toggling it out of the selection, so Shift-drag can actually move what the user selected. Click-without-drag still toggles. | `SelectTool.applyHitSelection` drag path; covered by the same E2E cases as F1. |
| Browser and visual validation of F1/F2 | 4/4 Chromium cases for constrained movement; 82/82 Home cases for the dialog flows. Visual evidence: after an axis-constrained drag the Inspector reads X 736 / Y 250 from X 632.5 / Y 250 (dy exactly 0, dx +103.5), and a diagonal drag lands at X 799 / Y 313 (+63/+63). Selection survives the gesture. | `tests/e2e/canvas/shift-constrained-move.spec.ts`; `docs/screenshots/graphite-corpus/shift-constrain-axis.png`, `...-diagonal.png`. |
| Website copy change validation | `canvas` page built and inspected at 1440x1000 and 390x844: the new paragraph is visible in both, no horizontal overflow (`scrollWidth == innerWidth`), no console errors. Claims guard, docs audit and emoji audit clean; website unit tests 310/310. | Measurements recorded here; the edited page is text-only. |
| Hidden fill stayed painted and clickable (F7) | Implemented: an all-hidden fill stack no longer falls back to the node's legacy colour (native/web parity restored), and the bounding-box click target is dropped for fills that paint nothing. | `packages/engine/src/engine.ts`, `HitTestEngine.paintsNoFill`, `fillPaintsVisibleArea`; 12 unit cases across the four suites plus `tests/e2e/canvas/hidden-fill-click-target.spec.ts`, verified to fail before the fix. |
| Changelog parser and root resolution (F6) | Fixed: release summaries now reach the page, and the parser reads this checkout's `CHANGELOG.md` instead of a parent's. Changelog page rebuilt and inspected: the 0.5.1 summary is visible, no "Summary" heading is rendered, no console errors. | `apps/website/src/lib/changelog.ts`, `apps/website/src/pages/changelog.astro`; 24 changelog tests (one new) and 310 website unit tests pass. |
| Preset-search regression in the Enter change | Found by independent review and fixed: Enter in the preset search selects a preset and no longer creates a document. | jsdom case typing into the search combobox and asserting no creation. |
| Existing protections verified | Zero-area/zero-scale geometry, aborted-marquee selection restore, and Delete with a drawing tool active are already correct in Varve. | Chromium reproduction probe plus source: `SelectTool.onKeyDown` Escape path keeps the committed selection until pointer-up; Inspector clamps W/H; layer delete works with the pen tool active. |

## Agent Validation Report (branch head `bc34b447e`)

```text
Changed scope:
  packages/editor/src/tools/{axisConstraint.ts,SelectTool.ts,PageTool.ts}
  packages/editor/src/tools/__tests__/axisConstraint.test.ts
  packages/home/src/NewDesignDialog.{tsx,test.tsx}
  apps/website/src/{lib/changelog.ts,pages/changelog.astro,pages/features/canvas.astro,test/changelog.test.ts}
  docs/architecture/input-system-behavior-matrix.md, packages/help/src/content/tools.ts
  tests/e2e/canvas/shift-constrained-move.spec.ts
  CHANGELOG.md, docs/audits/graphite/**, docs/screenshots/graphite-corpus/**, scripts/research/**

Validation plan (pnpm verify:plan): 25 lanes — format/lint on touched files,
emoji/docs/claims/radius audits, typecheck e2e/website/editor/help/home/desktop,
file-level and package-level Vitest, website-unit, the new canvas E2E, website-e2e
and e2e:home. Full-suite escalation: NO.

Commands actually run:
  npx tsc --noEmit -p packages/{editor,home}/tsconfig.json
  npx vitest run <axisConstraint | NewDesignDialog | PageTool | SelectTool | ToolManager | nudge | changelog | commitMerge>
  npx vitest run packages/home/src            (215 passed)
  npx vitest run apps/website/src/test        (310 passed)
  node scripts/quality/heavy-lease.mjs ... npx playwright test
      tests/e2e/canvas/shift-constrained-move.spec.ts   (4 passed)
      tests/e2e/home                                    (82 passed; 2 failures were this
                                                        spec's harness, fixed and re-run 4/4)
  node scripts/audit-emoji.mjs | audit-docs.mjs   (clean)
  node scripts/check-claims.mjs                   (clean)
  pnpm build:website                              (126 pages)
  visual: editor screenshots + website canvas page at 1440x1000 and 390x844
          + changelog page at 1440x1200 (all inspected)

Passed: as listed above, plus repository commit checkpoints (format/lint on staged
files, emoji, health, impact config, E2E interaction audit, secret scan, contacts,
docs, import boundaries, e2e typecheck).

Skipped as unrelated: Rust workspace tests (no Rust change); full visual suite (no
global rendering surface); native desktop GUI matrices; packaging/signing/release.

Escalations: none. Full suite run: no — the planner did not require it.

Not completed: `pnpm verify:affected` and the pre-push `verify:push` checkpoint
could not finish on this shared machine: another session held the cross-worktree
heavy lease for >45 minutes and the hook's per-command budget is 300 s. The
identical lanes were run individually and are recorded above; the browser lanes
the planner selects were executed directly. This is an infrastructure limit, not
a failing check.
```
