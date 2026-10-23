# VectorCraft issue-corpus review

Scope, source inventory, and retrieval record for the review of
[`storytold/vectorcraft`](https://github.com/storytold/vectorcraft)'s issue
history and its relevance to Varve.

This directory is the durable audit area for the corpus. It is deliberately
outside `docs/plans/` because it records evidence and dispositions, not a plan.

## Identity and remotes (verified at execution time, 2026-10-21)

| Item | Value |
|---|---|
| Source project | `storytold/vectorcraft` (default branch `main`, `19c7d61f`) |
| Source description | "VectorCraft: An open-source, vector art tool written by scratch in pure Rust" |
| Varve (brief) | `varvedesign/varve` → resolves to default branch `master`, `2e8c5b018` |
| Varve (previous URL) | `K-Arthur/varve` → same repository, `master`, `2e8c5b018` |
| Local baseline | `origin/master` = `2e8c5b018b00a85fde341a0acc3dc80cde042f83` |
| Task worktree | `.worktrees/vectorcraft-corpus`, branch `feat/vectorcraft-corpus` |

`varvedesign/varve` and the previous `K-Arthur/varve` URL are the same
repository; no redirect ambiguity remained. The main checkout was 314 commits
ahead / 16 behind `origin/master` with 43 dirty entries owned by other work, so
this review runs in an isolated worktree based on `origin/master` and touches
nothing in the main checkout.

## Cutoffs

- **Cutoff A (frozen baseline):** crawl window
  `2026-10-21T19:30:05Z` – `2026-10-21T19:31:11Z`.
  The frozen issue-ID set is every issue in `issue-ledger.jsonl`. Do not move
  cutoff A.
- **Cutoff B (incremental reconciliation):** `2026-10-21T20:41:01Z`.
  Four new issues (#3465, #3467, #3470, #3471) and two upstream status changes
  (#3446, #2523) are recorded in `issue-ledger-cutoff-b.jsonl`. Issues created
  after cutoff B belong to the follow-on queue and must not move the
  completion boundary.

## Inventory and reconciliation

| Measure | Count |
|---|---|
| Issues (`state=all`, pull requests excluded) | **1,237** |
| — open / closed | 531 / 706 |
| Pull-request records (retained as linked evidence, not issues) | 2,221 |
| Issue comments | 4,964 |
| Issues with an empty body | 7 |
| Issue creation range | 2026-10-03T19:26:58Z – 2026-10-21T19:09:11Z |

Retrieval method and completeness accounting:

- `GET /repos/storytold/vectorcraft/issues?state=all&per_page=100&page=N`
  (`sort=created&direction=asc`), 35 pages. Every page was fetched; pagination
  ended on a 58-record page. `per_page` was never raised as a substitute for
  following pages.
- Records with `pull_request != null` were split out (2,221 PR records) and are
  **not** counted as issues. They remain available as linked evidence.
- `GET /repos/storytold/vectorcraft/issues/comments`, 50 pages, 4,964 records.
- Independent reconciliation: the search index reports 1,237 issue records
  (`incomplete_results: false`) and 2,221 PR records. The paginated listing
  matched both totals exactly, so no page, cursor, or duplicate gap was found.
  The repository's `open_issues_count` (773) is not an issue count — it is open
  issues plus open pull requests — and was not used as evidence.
- All requests were authenticated (`gh`, `repo` scope). No rate-limit response,
  5xx, or truncated body occurred; no request was retried. A failed request was
  treated as a failure, never as an empty result.

Raw artifacts are intentionally outside Git:

| Artifact | Location | Digest |
|---|---|---|
| Issue pages (35) | `/tmp/opencode/vectorcraft/raw/issues-p*.json` | aggregate SHA-256 `59eb7225874acf08886b85c940d09cd9cf0443676f91030caa7d736f45702ef2` (19,429,090 bytes) |
| Comment pages (50) | `/tmp/opencode/vectorcraft/raw/comments/` | not digested (review-time cache) |
| Compact index | `/tmp/opencode/vectorcraft/index.json` | derived from the pages |

These are reproducible from the public API; they are not part of the repository
because they contain third-party issue text and attachments we have no
redistribution rights to.

**2026-10-23 retrieval note.** The `/tmp` cache was lost when the tmpfs was
cleared (the path no longer existed). The frozen ledger rows in Git are the
authoritative inventory; the builder index was reconstructed from their
title/state/labels/comment-count fields, so dispositions can be regenerated
without inventing data. The original aggregate page digest above can no longer
be re-verified from this machine, and no claim is made that a fresh API crawl
would reproduce the historical bytes — issues may have been edited since
cutoff A. Full threads read after the loss were fetched per issue with
`gh api repos/storytold/vectorcraft/issues/<n>/comments`.

## Method

1. Read every issue title (all 1,237) and classified each onto a Varve
   subsystem or an exclusion reason (`issue-ledger.jsonl`).
2. Read the full thread — body plus every comment — for each issue whose
   mechanism was going to drive a change, and for the highest-severity
   safety/integrity classes.
3. Inspect the corresponding Varve source before accepting any external claim;
   reproduce in Varve where the mechanism is reachable without private data.
4. Record research depth and engineering status separately. A reviewed issue
   is not an implemented one.
5. Link every change to an issue ID in the commit message and in
   `findings.md`.

## Status vocabulary

| Disposition | Meaning |
|---|---|
| `outside-varve-scope` | No Varve subsystem serves it; `disposition_reason` names the concrete exclusion (unsupported format, VectorCraft packaging, host automation surface, ...). Exclusions are title-level unless the row also records a thread review. |
| `screened-relevant` | Title maps onto a Varve subsystem and needs a deeper thread review plus a Varve reproduction. **Open work.** |
| `applicable-requires-work` | Mechanism inspected in the source and confirmed relevant; not yet implemented. |
| `verified-existing` | Varve already behaves correctly; verification evidence named in the row. |
| `implemented-pending-integration` | Implemented and locally validated; integration state tracked in `continuation.md`. |
| `integrated-verified` | Merged and verified on the integrated candidate. |

Each row carries `review.depth`: `title` for a title/label classification, or
`thread` when the body and every comment were read. Depth is regenerated from
the review record, so a reviewed row no longer reports title-only depth. The
live defect queue (`screened-defects.jsonl`) is filtered to rows that are still
`screened-relevant`; it was 455 rows at screening time and is 451 after four
findings were integrated or verified.

## Coverage and limits

- **Titles:** 1,237 / 1,237 reviewed.
- **Full threads:** the subset listed in `findings.md`; the rest are title-level
  dispositions. This is an explicit, recorded gap — `screened-relevant` rows
  are not a verdict.
- **Attachments:** screenshots and recordings were not downloaded. Where a
  thread depended on an attachment, that dependency is noted rather than
  guessed at.
- **Non-English reports:** translated when they carried a mechanism; the
  original text stays at the source URL.
- **Upstream fixes:** a closed status or a linked PR is treated as evidence of
  intent, not proof that a shipped build behaves correctly. Varve changes are
  driven by the described mechanism, and verified here.

## Related

- `findings.md` — evidence chains and outcomes per finding.
- `continuation.md` — current state, blockers, and the exact next operation.
- `issue-ledger.jsonl` — one record per issue with disposition and, where
  reviewed, the Varve mapping.
- `issue-ledger.summary.json` — machine-readable totals.
