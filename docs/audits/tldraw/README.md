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
- A topic-selected initial pass found candidate durability/history issues;
  it does not count toward full-corpus completion. The per-issue ledger is
  `issue-ledger.jsonl`; #10513 and #10024 have full individual assessments, and
  the other 2,948 issues remain `unreviewed`.
- Next actions: review every issue body and accessible comment, including
  relevant linked evidence; disposition individually; validate candidate Varve
  changes before implementation.

## Verified batches

| Batch | Outcome | Validation and evidence |
|---|---|---|
| C1 inventory and discussion acquisition | 2,950 unique issue IDs across 104 REST pages; 7,441 PR records; 30 GraphQL issue pages; 7,070 accessible comments. Eight stale/inaccessible declared counts rechecked against issue comment endpoints. | `node scripts/research/tldraw.mjs status`; issue-set SHA-256 above; raw response pages, cursors, IDs, timestamps, and request IDs retained in the external cache. |
| #10513 persistence review | No matching missing lifecycle flush. Varve has pagehide/visibility/freeze handlers; asynchronous browser termination remains a best-effort durability edge. | 5 files, 90 focused tests passed; real forced browser termination remains untested. See its individual assessment. |
| #10024 missing-parent undo review | No current Varve orphan reproduced. Focused merge returned an `edit-vs-delete` conflict and a valid document; remote collaboration is not implemented. | Temporary reproduction passed; 3 files, 47 focused tests passed. See its individual assessment. |
| Audit tooling and ledger | Resumable source collector, source discrepancy accounting, and guarded per-issue assessment ledger. | `pnpm verify:plan` selected format, lint, emoji audit, docs audit (no full-suite escalation). Initial affected run was interrupted by an unrelated transient test file from an active investigation; rerun after it was removed. |

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
