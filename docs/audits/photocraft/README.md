# Photocraft corpus review — Varve audit area

Durable record for the review of [storytold/pdfcraft's issue
tracker](https://github.com/storytold/pdfcraft/issues) as evidence for
hardening Varve.

| File | Contents |
|---|---|
| `README.md` | This file: scope, method, cutoffs, status vocabulary, how to resume |
| `findings.md` | Failure classes, their Varve verdicts, the implementation log, evidence limitations |
| `issue-ledger.jsonl` | Frozen cutoff A issue records and screening dispositions |
| `issue-ledger-follow-on-b.jsonl` | Cutoff B new issue inventory; items remain queued until screened |
| `issue-ledger-follow-on-b.summary.json` | Cutoff B inventory counts and review coverage |
| `issue-ledger.summary.json` | Counts for frozen cutoff A |
| `continuation.md` | Where the work stopped and the exact next operation |

## Cutoffs

| Cutoff | Window (UTC) | Issue count | Notes |
|---|---|---|---|
| **Cutoff A (frozen)** | `2026-10-17T04:41:35Z` → `2026-10-17T04:42:17Z` | 1 296 issues (827 open / 469 closed) + 1 682 PRs | Full enumeration, reconciled against the search totals |
| **Cutoff B (frozen)** | `2026-10-18T12:28:21Z` → `2026-10-18T12:28:46Z` | 1 454 issues (936 open / 518 closed) + 1 795 PRs | Reconciled by pagination and issue search totals; 158 new issues queued separately; 40 existing issues changed state |

Issues created after cutoff A are recorded in the cutoff B follow-on ledger; they do not
change the frozen A ledger. Cutoff B is the current source-reconciliation boundary,
but its 158 new issues remain unscreened and are not counted as reviewed. Later
arrivals go into a subsequent queue rather than moving either frozen boundary.

## Method

1. Enumerate **all** issues with `state=all`, following every pagination
   cursor, and separate pull-request records from issues. Reconcile the
   unique-id count and the open/closed split against the search API before
   trusting the inventory.
2. Read every issue body; read threads where a finding depends on the
   follow-up discussion. Record the reading depth per issue — "screened from
   the body" is never presented as "thread reviewed".
3. Classify each issue into a failure family, then decide relevance against
   Varve's product boundary. Exclusions name the boundary; they never mean
   "not a real bug in the source product".
4. For every applicable class, verify the mechanism against Varve source
   before designing anything. A class that Varve already handles is recorded
   with the file that proves it — and when an earlier claim is contradicted,
   the correction is recorded explicitly.
5. Implement the smallest coherent change, with a test that would fail
   without it, run the affected validation, review the diff, then commit.

## Status vocabulary

Research status and engineering status are separate fields in the ledger.

| Research | Meaning |
|---|---|
| `thread` | Issue body plus its full comment thread read |
| `body` | Title plus full body read |
| `title-and-body` | Individually screened residue (no rule matched) |
| `title` | Title only (empty body) |

| Engineering | Meaning |
|---|---|
| `already-handled` | Verified in Varve source; the verifying file is named |
| `implemented` | A change in this branch with regression coverage |
| `screened-for-varve` | The class reaches a Varve subsystem; queued, no failure claimed |
| `out-of-scope` | Outside the product boundary, with the reason recorded |
| `blocked` | Needs a capability, runtime or decision that is not available |

`screened-for-varve` is a queue position, not a finding. Nothing is reported
as fixed because an issue is closed, and nothing is reported as a Varve defect
because a sibling product had one.

## Resuming

Read `continuation.md` first. It names the frozen baseline, the open queue,
the last verified state, and the exact next operation. Do not re-crawl the
baseline to "refresh" it — re-query for post-cutoff arrivals instead.
