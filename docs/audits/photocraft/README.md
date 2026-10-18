# Photocraft issue review

Status: active, incomplete. This is a durable source inventory and engineering
ledger, not a claim that the Photocraft issue archive has been fully reviewed.

## Source identity and scope

The requested source is [`storytold/photocraft`](https://github.com/storytold/photocraft/issues).
It is distinct from `storytold/pdfcraft`: GitHub returned different repository
IDs (1398080271 and 1398086162) and both repositories were created on
2026-09-30. The task's seed links point to `pdfcraft`; they are preserved as a
separate comparison source and are not counted as Photocraft issue coverage.

The first frozen source cutoff is **2026-10-17 10:08:14 UTC** (crawl began
10:07:24 UTC). The GitHub REST issues endpoint was requested with `state=all`
and every pagination link was followed. The raw response cache is kept outside
the repository at `/tmp/codex/photocraft-2026-10-17/` and is intentionally not
committed. SHA-256 of `issues.pages.json`:
`11b6e1600b50e6df21e8205e3f1fd9d12fb847af9639d8e00292524a3b3ed590`.
The compacted issue rows have SHA-256
`44e678bcdfc5f44e8188ae1f81d1c59d5f94984ccdcf6ea4a8fcf84a110f34ab`.
All 3,275 issue comment endpoints were then fetched with authenticated REST
pagination from 10:29:00–10:31:14 UTC. There were no failed requests; one issue
had a count mismatch because #6400 gained a comment after cutoff A. Per-issue
retrieval times, page counts, count-at-A, post-cutoff comment URLs, and hashes
of the normalized discussion caches are recorded in the inventory. Raw
responses are outside the repository at
`/home/kevina/.cache/codex/photocraft-2026-10-17/comments/`; retrieval is not
the same as human review, and every body/discussion remains marked unreviewed
until assessed.

The frozen inventory contains 6,958 unique records across 70 pages: 3,275
issues (1,553 open, including 12 reopened; 1,722 closed) and 3,683 pull
requests. Issue records report 4,900 comments in aggregate. These counts are
for the response snapshot, not an atomic database snapshot. Pull requests are
retained in raw cache and separated from the issue-only machine-readable
inventory. The issue inventory stores body hashes and source metadata, not
third-party issue text. Every issue body, comment page, and linked artifact is
still marked unreviewed unless explicitly listed in a finding below.
Pull requests have a separate machine-readable inventory so they are not
counted as issues; their descriptions and discussions also remain unreviewed
unless explicitly listed.

The second full crawl completed 2026-10-17 10:33:10 UTC (interval
10:32:24–10:33:10 UTC), again following all 70 `state=all` pages. It contained
6,964 unique records: 3,278 issues (1,556 open, 1,722 closed) and 3,686 PRs.
Compared with cutoff A, it found three new issues (#6962, #6964, #6965), three
new PR records, no removed issues, and two existing issue deltas: #6400 gained
one comment at 10:18:44 UTC; #6392's body hash changed even though GitHub kept
the same `updated_at`. All five changed/new issue discussions were refetched
and count-matched. Per-page retrieval times and ETags, plus the comparison,
are recorded in [the reconciliation summary](reconciliation-2026-10-17.json)
and [the issue delta ledger](issue-deltas-cutoff-b-2026-10-17.jsonl). This is a
page-by-page observation, not an atomic point-in-time snapshot.

## Current implementation batch

- [Findings and decisions](findings.md)
- [Continuation record](continuation.md)
- [Frozen issue inventory](issue-inventory-2026-10-17.jsonl)
- [Frozen pull-request inventory](pr-inventory-2026-10-17.jsonl)
- [Cutoff-B reconciliation](reconciliation-2026-10-17.json)
- [Cutoff-B issue deltas](issue-deltas-cutoff-b-2026-10-17.jsonl)
- [Cutoff-B pull-request inventory](pr-inventory-cutoff-b-2026-10-17.jsonl)
- [Cutoff-B pull-request deltas](pr-deltas-cutoff-b-2026-10-17.jsonl)

The first applicable defect is non-finite numeric data crossing document and
inspector boundaries. Photocraft #6862 reports a JSON number (`1e39`) parsed as
`f32` infinity, after which the affected file cannot be saved. Its two comments
were read; the contributor points to still-open PR #6863. Related reports #5752
and #6424 have had their full discussions read. This is an external report, not proof
of Varve behavior; the Varve regression was separately reproduced and is being
fixed in the current branch.

## Website decision

The issue batch changes file-integrity and numeric-entry behavior, not a
released capability claim or user-facing marketing promise. Website source was
reviewed for affected claims; no copy or asset edit is justified before the
change is released. Revisit the site at release and update troubleshooting if
this error becomes a documented support path.
