# Photocraft issue review

Status: active, incomplete. Issue bodies and discussion pages are retrieved for
the frozen cutoffs; full content review, relevance classification, recursive
linked-evidence review, pull-request discussion review, and Varve engineering
remain in progress.

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
`/home/kevina/.cache/codex/photocraft-2026-10-17/comments/`.

The frozen inventory contains 6,958 unique records across 70 pages: 3,275
issues (1,553 open, including 12 reopened; 1,722 closed) and 3,683 pull
requests. Issue records report 4,900 comments in aggregate. These counts are
for the response snapshot, not an atomic database snapshot. Pull requests are
retained in raw cache and separated from the issue-only machine-readable
inventory. The issue inventory stores body hashes and source metadata, not
third-party issue text. All 3,275 cutoff-A issue bodies and comment pages were
retrieved and cached, but that is not the same as content review. The ledger's
`body_review` and `discussion_review` fields use `complete` only after that
issue's body and comments were read. Relevance classification, Varve-side
verification, and recursive link review are tracked separately. At this
checkpoint, source reading covers all 3,275 cutoff-A issues: #181–#1100 (426
issues, 496 comments), #1101–#2199 (491 issues,
899 comments), #2203–#3298 (502 issues, 776 comments), #5002–#6000 (490
issues, 672 comments), #3301–#5000 (775 issues, 1,208 comments at cutoff),
#6004–#6960 (512 issues, 786 comments), and prefix #1–#180 (79 issues, 101
comments). One issue overlaps the original 17 verified records. The row count
includes 13 previously completed records in other slices. During the live
reread of #3301–#5000, three later comments were also read; they arrived after
the frozen cutoff and are not included in the 1,208 cutoff count. All 3,275
cutoff-A issue bodies and discussions have now been read. This does not mean
every issue has a finished Varve relevance disposition; that work remains
incomplete.

In the upper range, #6962's cutoff-B issue body was absent from the delta/cache
and was recovered from the live page; its later Oct 18 comment was excluded.
All five cutoff-B issue deltas have also been read. Their full issue bodies
were absent from the compact B cache and were recovered from live GitHub; exact
historical body bytes are therefore unavailable. Post-B comments/closures were
excluded. Relevance classification and recursive linked evidence remain in
progress; the source-body pass is complete.
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

The highest-priority applicable defect found so far is non-finite numeric data crossing document and
inspector boundaries. Photocraft #6862 reports a JSON number (`1e39`) parsed as
`f32` infinity, after which the affected file cannot be saved. Its two comments
were read; the contributor points to still-open PR #6863. Related reports #5752
and #6424 have had their full discussions read. This is an external report, not proof
of Varve behavior; the Varve regression was separately reproduced and is being
fixed in the current branch.

## Website decision

The issue batch changes file-integrity and numeric-entry behavior, not a
released capability claim or user-facing marketing promise. The browser-demo
guide was updated to accurately describe the save/recovery result when browser
storage is full or unavailable. No landing-page capability claim or marketing
asset needed a change.

## Cross-app failure reports checked

These reports help identify user-visible failure modes, but do not establish
that Varve shares the defect. We use them as regression classes and verify
Varve's own contract before making changes.

- **A crash during save can leave a truncated file.** An Inkscape issue records
  an incomplete, unusable document after a save-time crash and explicitly asks
  for write-then-replace atomic saving ([Inkscape #260](https://gitlab.com/inkscape/inkscape/-/issues/260)).
  This aligns with the current Photocraft durability leads (#4968 and #6600–#6605);
  atomic-save edge cases are under direct Varve review.
- **A save that never finishes or creates a zero-byte export traps users in
  uncertainty.** A Photopea report describes a stuck saving banner, repeated
  zero-byte files, a very large canvas, and fear of closing because hours of
  work may be lost ([Photopea #5941](https://github.com/photopea/photopea/issues/5941)).
  A separate report was resolved by clarifying that the user had selected an
  empty folder ([Photopea #6512](https://github.com/photopea/photopea/issues/6512));
  visible output validation and useful error messages matter as much as the
  encoder itself.
- **Recovery policy can surprise even when autosave exists.** Photopea's
  discussion describes a project that had been saved before, then accumulated
  unsaved work that did not restore after a browser-session loss
  ([Photopea discussion #6270](https://github.com/photopea/photopea/discussions/6270)).
  Krita's manual explains that a normal close removes its autosave and that
  unsaved work then cannot be recovered ([Krita autosave guide](https://docs.krita.org/en/user_manual/autosave.html)).
  Varve's recovery and close flows should be evaluated against the concrete
  distinction between a never-saved document and new edits to a previously
  saved document.

These examples support internal reliability work and QA cases. They do not
justify changing Varve's public marketing claims before an improvement ships;
the current website review found no matching claim that needs correction.

## 2026-10-18 disposition checkpoint

The inventory now records a row-level Varve disposition for 2,820 of the
3,275 cutoff-A issue rows: 119 candidates, 1 fixed item, 142 analogues, 354
partial matches, 20 already-covered behaviors, 62 trackers, 20 adjacent
QA/design leads, and 2,102 reports with no Varve match established. The
remaining 455 rows stay explicitly `unassessed`; they are not treated as
irrelevant. The 3,275 bodies and cutoff-A discussions have been read, but this
does not complete the relevance pass, linked-PR frontier, or PR inventory
review.

Disposition records add a concise rationale and distinguish the PhotoCraft
issue state from Varve's engineering status. A PhotoCraft issue marked closed
is not evidence that Varve has a matching fix. Cutoff-B deltas retain the
separate limitations recorded above.
