# PhotoCraft issue review — audit area

Review of the [PhotoCraft tracker](https://github.com/storytold/photocraft/issues)
(photo editor, Rust/Tauri) as evidence for Varve. Separate from
`docs/audits/photocraft/`, which documents the PDFCraft corpus under a legacy
name; this directory is the actual `storytold/photocraft` review.

## Cutoff

| Property | Value |
|---|---|
| List retrieval | 2026-10-22T07:22:47Z -> 07:24:07Z |
| Endpoint | `GET /repos/storytold/photocraft/issues?state=all&per_page=100&sort=created&direction=asc`, Link pagination, 85 pages |
| Records | 8,475 (4,092 issues + 4,383 pull requests) |
| Issues | 4,092 unique (1,763 open / 2,329 closed), numbers 1..8480 |
| Bodies | 4,066 carry a body; 26 title-only |
| Reconciliation | 1,763 open issues + 1,166 open PRs = 2,929 = repository `open_issues_count`; search API returns 4,092 with `incomplete_results=false` |
| Labels | critical 109, high 310, medium 1,196, low 526; bug 247; regression 5; duplicate 266; multiple issues 447 |

Raw pages and the full JSONL are kept outside Git at
`/tmp/opencode/photocraft-2026-10-22/`. `issue-catalog-cutoff-2026-10-22.tsv`
is the committed per-issue catalog (number, state, priority, labels, title,
body size, comment count).

## Method and status

All 109 critical and 310 high issues are the first screening set; every issue
is catalogued and inherits a class verdict unless individually adjudicated.
Comments, attachments and linked PRs are fetched for the issues a finding
depends on. A finding is only actionable after it is verified in Varve source
or reproduced.

This pass has begun; it is **not** complete. The first implemented finding is
below, and the remainder of the corpus is a continuation queue.

## Finding 1 — non-finite numeric input makes a document unsaveable

Source: PhotoCraft #5752, #6424, #7049 (critical; 1e39 accepted by a numeric
field, stored as infinity, every later save fails).

Varve verification: `parseField` in
`packages/editor/src/components/Inspector/controls/NumberField.tsx` checked
`Number.isFinite` on the plain-number path but returned `evaluate(...)`
unguarded. The evaluator accepted a 400-digit literal or `min()` as
Infinity/NaN; the save canonicalizer rejects non-finite numbers, so the
document could never be saved again.

Implemented: `evaluate` now throws on a non-finite result and `parseField`
returns null, so the field keeps its previous value. Regressions in
`packages/scene/src/expr.test.ts` and `NumberField.test.tsx`.

Not covered yet: a document already containing a non-finite value from an
older build or a crafted file. Load-time validation/repair and a save error
that names the offending field are the next step.

## Continuation queue

1. Finish the critical/high screening and record per-issue dispositions in a
   ledger (in progress).
2. Load-time non-finite validation and an actionable save error.
3. Save-path ownership classes (#6597, #6596, #6599) against Varve's native
   write path.
4. Bounded-work classes (#6103, #6105, #6110) against render/export/retouch.
5. Interaction and lifecycle classes (#4954, #7367) against the termination
   coordinator.
