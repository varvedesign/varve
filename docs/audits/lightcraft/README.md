# Lightcraft issue review — Varve audit area

Durable record for reviewing the
[storytold/lightcraft issue tracker](https://github.com/storytold/lightcraft/issues)
as evidence for hardening Varve. Lightcraft is an open-source, non-destructive
photo editor written in Rust; the tracker mixes photo-library/DAM work, RAW
decoding, and editor-wide machinery (export, masking, settings, undo,
small-screen layout, text handling). Only the last group transfers to Varve.

| File | Contents |
|---|---|
| `README.md` | This file: scope, cutoffs, method, status vocabulary, how to resume |
| `findings.md` | Failure classes, their Varve verdicts, the implementation log, evidence limits |
| `issue-ledger.jsonl` | Frozen cutoff-A issue records and screening dispositions |
| `link-frontier.jsonl` | Recursive evidence edges and their review dispositions |
| `continuation.md` | Where the work stopped and the exact next operation |

## Scope resolution

The brief names the lightcraft issue tracker and project, and asks for the PRs
as well. The repository resolves to `storytold/lightcraft` (default branch
`main`), which is the project's only tracker. Its PR numbers share the issue
number space, so the issue endpoint returns both: **2 521 records = 981 issues
+ 1 540 pull requests**. PRs are retained as linked evidence rather than
counted as issues.

Varve's boundary is a design suite (vector/layout/typography/illustration, a
Photo workspace over document objects, print/PDF and code export), with no
photo library, catalog, RAW decoder, camera-profile database, face index, or
lens-profile database. Exclusions name that boundary; they never mean "not a
real bug in lightcraft".

## Cutoff A (frozen)

| Field | Value |
|---|---|
| Issue-creation cutoff | `2026-10-22T04:36:59Z` (newest issue in the inventory) |
| Crawl start/end (UTC) | `2026-10-22T05:36:48Z` – `2026-10-22T05:37:08Z` |
| Enumeration | REST `/repos/storytold/lightcraft/issues?state=all&sort=created&direction=asc`, `per_page=100`; all 26 pages followed |
| Records / unique ids | 2 521 / 2 521 (zero duplicates) |
| Issues / PRs | 981 / 1 540 (931 PRs merged) |
| Issue states | 537 closed, 444 open |
| Created range | `2026-10-03T17:07:06Z` – `2026-10-22T04:36:59Z` |
| Search reconciliation | `search/issues?q=repo:storytold/lightcraft+type:issue` → `total_count=981`, `incomplete_results=false`; `type:pr` → `1 540` |
| Discussions | 4 315 comment records fetched over 2 028 request threads (793 issues carry comments; the rest of the fetched threads are PRs) |
| Raw cache | `/tmp/opencode/lightcraft/cache/` (outside Git). `issues.jsonl` SHA-256 `f4a771f6e70e8be6fc18b08ee5fa1e51c315c309948bdb19c1fb1cd343cf2072`; `comments.jsonl` `84adaccbfe9361289009ae0cdd9c26ab6fd325e914221c7ffec77002a9e078fe`; `pulls.jsonl` `bc928d367552c0d890ebc7b1c021fa7f5ddc0192e27bb64be3592f5b05a31ed7` |

Review depth at cutoff A: **22 threads** (body plus every fetched comment),
**954 full bodies**, **5 title-only** records (empty or unreadable body).
Dispositions: **848 out-of-scope**, **82 screened-for-varve**, **18
already-handled**, **28 uncertain**, **5 implemented**. The 28 uncertain
records are listed in `findings.md` §6; they need a Varve reproduction before a
defect can be claimed.


The issue list and the comment fetch are not one atomic snapshot: the comment
pass ran after the issue rows were read, so a comment added in between is newer
than its issue row. That is recorded rather than papered over. Issues created
after the cutoff belong to a follow-on queue; they do not move the boundary.

## Method

1. Enumerate **all** records with `state=all`, following every page, and
   separate pull-request records from issues. Reconcile the unique-id count and
   the open/closed split against the search API before trusting the inventory.
2. Screen every issue title, then read bodies in family batches. Record the
   reading depth per issue — "screened from the title" is never presented as
   "thread reviewed".
3. Classify each issue into one failure family, then decide relevance against
   Varve's product boundary.
4. For every applicable class, verify the mechanism in Varve source before
   designing anything. A class Varve already handles is recorded with the file
   that proves it; a contradicted claim is corrected explicitly.
5. Implement the smallest coherent change with a test that fails without it,
   run the affected validation, review the diff, commit, and integrate.

## Status vocabulary

Research status and engineering status are separate fields in the ledger.

| Research | Meaning |
|---|---|
| `thread` | Issue body plus its full comment thread read |
| `body` | Title plus full body read |
| `title` | Title only (empty body or family-level screening) |

| Engineering | Meaning |
|---|---|
| `already-handled` | Verified in Varve source; the verifying file is named |
| `implemented` | A change in this branch with regression coverage |
| `screened-for-varve` | The class reaches a Varve subsystem; queued, no failure claimed |
| `out-of-scope` | Outside the product boundary, with the reason recorded |
| `uncertain` | Needs a reproduction or a decision that is not available |

`duplicate_of` names the canonical issue when a record repeats an established
finding. A duplicate keeps its own reproduction conditions and is never counted
as independent evidence.

`screened-for-varve` is a queue position, not a finding. Nothing is reported as
fixed because an issue is closed upstream, and nothing is reported as a Varve
defect from an upstream report alone.
