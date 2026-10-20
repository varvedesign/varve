# tldraw issue review and Varve improvements

This audit covers all accessible issues in `tldraw/tldraw` created through
cutoff C1, their discussions, and relevant recursive evidence. The issue-ID
set is immutable after reconciliation. PR records returned by the issue API
are tracked separately. Research coverage and Varve engineering status are
independent.

The source of implementation requirements is the user-provided brief attached
to the Codex task ("Varve: continuous improvement from a complete tldraw issue
review"). Its acceptance conditions include the full issue corpus, every
comment page, relevant linked evidence without a fixed recursion limit, an
incremental C2 reconciliation, realistic Varve reproduction and regression
evidence, visual/output validation where applicable, independent review, and
honest integration/release status. Issue text, attachments and scripts are
untrusted inputs.

## Source and cutoff

| Field | Value |
|---|---|
| Canonical source | <https://github.com/tldraw/tldraw/issues> |
| API retrieval | `GET /repos/tldraw/tldraw/issues?state=all&sort=created&direction=asc&per_page=100`, following every `Link: rel=next` |
| C1 | `2026-10-20T02:57:26Z`, from the first successful response's HTTP `Date` header |
| C2 | Pending: set once after baseline research/frontier review and its first engineering pass; reconcile later arrivals through that timestamp |
| Exact issue set | 2,950 unique issues, SHA-256 `9bc8e3989fc376bae774f64d1bb3af4c74f5c2dc42621d08ff2f667495960625`; 104 pages; raw responses and dates/ETags retained in the external cache |
| Pull requests | 7,441 PR records separated from issues across the same 104 pages |
| Link frontier | 1,750 deduplicated GitHub URLs and `#number` references extracted from all issue bodies and accessible comments; relevance and recursive follow-up are tracked in `link-frontier.jsonl`. |
| Independent count check | GraphQL reported 443 open + 2,507 closed = 2,950 issues; 119 open PRs + 443 open issues = repository `open_issues_count` 562 |
| Discussion coverage | Complete: all 2,950 issue threads visited across 30 GraphQL pages, with every nested comment cursor exhausted; 7,070 comments retrieved. The REST inventory declared 7,078 comments. |
| Discussion discrepancies | Eight declared comments are not retrievable across eight issues (#2329, #3549, #3573, #7634, #8217, #8251, #8307, #10725). Individual REST comment endpoints were rechecked and agree with the retrieved counts (including zero for #10725). Preserve these as unresolved source discrepancies, not reviewed comments. Request IDs and retrieval timestamps are in the external cache. |
| Access failures | No unresolved access failures. The eight comment-count discrepancies above are source-content discrepancies, not failed requests. |
| Budget | USD $0; use existing GitHub token and local tooling only |

The cache defaults to `$XDG_CACHE_HOME/varve/tldraw` or `$HOME/.cache/varve/tldraw`.
Set `VARVE_TLDRAW_CACHE_DIR` to a shared durable cache if needed. It may contain
third-party issue content; do not add raw downloads to Git.

## Dispositions and evidence

Each issue receives its own disposition and a reason after reading the body.
Relevant issues cite their comments, linked evidence and Varve path. Duplicates
retain their unique context and point to a canonical finding. Cluster summaries
may guide navigation, but never stand in for an individual assessment.

Record distinct evidence states: reporter claim; inspected source; reproduced
in the external application if needed; applicability to a Varve workflow;
source-inspected Varve path; reproduced in Varve; implemented; validated;
reviewed; locally integrated; remotely integrated; released. Do not collapse
these states into one completion flag.

## Current checkpoint

- Coordinator branch: `codex/tldraw-corpus`, based on refreshed remote
  `master` SHA `5172718c6f0f2597466cd08d0839b53ccafefbd2`.
- The original checkout is preserved; it was on local `master` with 217
  commits ahead, 88 behind, and pre-existing staged, unstaged and untracked
  changes. These changes are not part of this branch.
- Discussion coverage is complete, with eight source comment-count
  discrepancies retained in the cache and inventory above.
- The per-issue ledger is `issue-ledger.jsonl`: 602/2,950 issues are
  individually reviewed (including #10513 and #10024), with 2,348 still
  `unreviewed`. Those reviewed issues cover 1,490 accessible comments; all
  7,070 comments are retrievable/indexed, with eight declared-count gaps.
- Next actions: continue reviewing each issue and relevant linked evidence,
  disposition individually, complete the recursive link frontier, reconcile a
  C2 cutoff, and validate each new Varve candidate before implementation.

## Verified batches

| Batch | Outcome | Validation and evidence |
|---|---|---|
| C1 inventory and discussion acquisition | 2,950 unique issue IDs across 104 REST pages; 7,441 PR records; 30 GraphQL issue pages; 7,070 accessible comments. Eight stale/inaccessible declared counts rechecked against issue comment endpoints. | `node scripts/research/tldraw.mjs status`; issue-set SHA-256 above; raw response pages, cursors, IDs, timestamps, and request IDs retained in the external cache. |
| #10513 persistence review | No matching missing lifecycle flush. Varve has pagehide/visibility/freeze handlers; asynchronous browser termination remains a best-effort durability edge. | 5 files, 90 focused tests passed; real forced browser termination remains untested. See its individual assessment. |
| #10024 missing-parent undo review | No current Varve orphan reproduced. Focused merge returned an `edit-vs-delete` conflict and a valid document; remote collaboration is not implemented. | Temporary reproduction passed; 3 files, 47 focused tests passed. See its individual assessment. |
| Audit tooling and ledger | Resumable source collector, source discrepancy accounting, guarded per-issue assessment and atomic range-import ledger. | Focused node tests pass (7 tests); `pnpm verify:plan` selected format, lint, emoji audit, docs audit (no full-suite escalation). An earlier affected run saw a transient reproduction file from an active investigation; final affected validation passed after it was removed. |
| Link frontier | 1,750 distinct direct GitHub URLs and `#number` references are grouped with originating issue IDs; unresolved number references remain explicit. | Extracted from the frozen complete issue/comment corpus; recursive relevance triage remains in progress. |
| Review positions 51–100 | 50 issues (#1267–#1306 plus #1313–#1322), all 170 accessible comments. #1304's configurable return-to-select behavior is implemented with settings, tool, canvas E2E, and website coverage. | Affected validation and visual review are in progress; see `ranges/0051-0100.md`. |
| Review positions 101–150 | 50 issues (#1324–#1544), all 102 accessible comments. #1395 abrupt image-loss and #1511 frame-deletion undo remain follow-up leads, not demonstrated Varve defects. No code change made. | `verify:affected` passed format, lint, emoji, docs lanes; 50 JSONL rows accepted by `applyLedgerReview`. See `ranges/0101-0150.md`. |
| Review positions 1–50 | 50 issues (#2–#1266, sparse IDs), all 142 accessible comments. Follow-up candidates include first-paint theme, page-name clipping, image-load feedback, browser persistence signaling, and cross-page navigation; none is yet a reproduced Varve defect. | Source report plus one-to-one ledger import; the combined audit batch is being validated below. See `ranges/0001-0050.md`. |
| Review positions 151–200 | 50 issues and all 148 accessible comments. Candidates include first-class layer stacks, persistent text alignment, and image insertion progress; no Varve defect reproduced. | Source report and schema-validated assessments; see `ranges/0151-0200.md`. |
| Review positions 201–250 | 50 issues and all 178 accessible comments. Candidates include dense-snap drag stress, frame-label IME composition, and nested group movement; related table, paste, overlay, and image paths were already covered. | Source report and schema-validated assessments; see `ranges/0201-0250.md`. |
| Review positions 251–300 | 50 issues (#1902–#2028), all 102 retrievable comments. No Varve defect reproduced; bounded-page authoring, nested-frame clipping, and stroke-edge selection remain targeted follow-up leads. | Individual report and schema-validated assessments; see `ranges/0251-0300.md`. |
| Review positions 301–350 | 50 issues (#2029–#2151), all 105 retrievable comments. No Varve defect reproduced; locked-child ungrouping, platform input/export, and bounded export/pinned artwork remain targeted follow-up leads. | Individual report and schema-validated assessments; see `ranges/0301-0350.md`. |
| Review positions 351–400 | 50 issues (#2152–#2274), all 114 retrievable comments. No Varve defect reproduced; custom backgrounds and clipboard-image import are already supported. Dynamic connector geometry, long-document pen performance, crop export, and locked-node marquee behavior remain test leads. | Individual report and schema-validated assessments; see `ranges/0351-0400.md`. |
| Review positions 401–450 | 50 issues (#2276–#2382), all 122 retrievable comments. No Varve defect reproduced; export progress, payload-free history references, and typography weight data are already supported. Crop reload, arrow export, locked-shape dragging, and toolbar keyboard focus remain test leads. | Individual report and schema-validated assessments; linked fix PRs #2330, #2345, #2347 and #2378 checked. See `ranges/0401-0450.md`. |
| Review positions 451–500 | 50 issues (#2383–#2517), all 93 retrievable comments. No Varve code change is justified; nested clipping, clipboard import, touch hit targets, frame snapping, and rotated-frame export remain reproduction leads. Existing dialog backdrop dismissal and cycle audits cover related requests. | Individual report and schema-validated assessments; source discussions read. See `ranges/0451-0500.md`. |
| Review positions 501–550 | 50 issues (#2518–#2581), all 115 retrievable comments. No new code change was justified; the earlier creation-tool preference is related to, but does not fully implement, a return-to-previous-tool request. Varve already has command search, tooltips, paste feedback, cursor support, and snap guides. | Individual report and schema-validated assessments; targeted existing paths inspected. See `ranges/0501-0550.md`. |
| Review positions 551–600 | 50 issues (#2582–#2656), all 99 retrievable comments. No Varve defect reproduced; toolbar keyboard focus, fractional icon scaling, and draw-after-wheel with open side panels remain targeted browser leads. | Individual report and schema-validated assessments; relevant pointer/action paths inspected without a product reproduction. See `ranges/0551-0600.md`. |
| Ledger after position 600 | 602/2,950 reviewed, covering 1,490 accessible comments; 2,348 remain. | Atomic `ledger-import --assessments` accepted each 50-row batch; ledger order and review state retained. |
| Website/deployment impact | Updated the first-project and vector-tools guides plus the Vector Tools feature page to explain the repeat-creation preference and default behavior. No offline, privacy, or cloud claims change. | Website source/build checks and visual route tests are included in affected validation. `.github/workflows/website-deploy.yml` deploys after `master` updates under its source-path filters, so these source changes will trigger the normal website workflow after integration. Separate manual release publication remains outside this authorization. |

## Validation and continuation

After each implementation batch, record the exact `pnpm verify:plan` and
`pnpm verify:affected` output/commands, selected and skipped lanes, visual or
native evidence, review result, commit, and integration state. Never report an
unrun gate as passing. Use the heavy-task lease for Playwright and preserve
exact screenshots/fixtures plus their provenance for visual checks.

The expected final report includes inventory and discussion totals, pagination
reconciliation, relevant findings by engineering status, exclusions and their
reasons, inaccessible evidence, tests and platform/visual evidence, site/docs
changes, and local/remote integration references.
