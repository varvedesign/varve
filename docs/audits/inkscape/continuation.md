# Continuation record

Last updated: 2026-10-18.

## Goal and scope

Review the Inkscape issue corpus and recursively investigate relevant evidence
to make verified improvements in Varve. The target is Inkscape's main vector
editor issue tracker (`gitlab.com/inkscape/inkscape`). User correction on
2026-10-18 confirms Inkscape as the target. Keep the baseline on
Inkscape’s canonical tracker.

## Cutoffs

- Cutoff A creation timestamp: `2026-10-17T10:03:35Z`.
- Initial GitLab API count and crawl: 6,390 issues (2,112 opened; 4,278
  closed). Durable rehydration exposed two accessible issues with pre-cutoff
  creation dates (#6482 and #6483) absent from that paginated snapshot. The
  ledger now includes both; corrected baseline: 6,392 unique IIDs.
- Full list/body crawl: completed across 64 pages from `2026-10-17T10:05:41Z`
  through `2026-10-17T10:08:41Z` UTC. Page 64 had 90 rows; all page totals
  reported 6,390. Creation dates spanned 2018-11-19 through 2026-10-16.
- Original raw cache `/tmp/inkscape-corpus-2026-10-17/` is no longer present.
  Its combined issue NDJSON SHA-256 was
  `f1e9f6be7cc3eaa8a7381b510bf89cad23858717e84dd6468126d81a80720d43`.
  Rehydrate source responses under
  `~/.cache/varve/inkscape-corpus-2026-10-17/` with
  `python3 scripts/research/inkscape/fetch_issues.py`; this preserves the
  frozen ledger ID set and records later issues separately.
- The initial list reported 32,680 notes across 5,667 issues; the corrected
  expected total is 32,692 across 5,669 issues after adding #6482 and #6483.
  Discussion notes
  are being re-fetched through GitLab GraphQL `Issue.notes` connections. The
  previous temporary cache snapshot at `2026-10-17T10:24:25Z` recorded 921
  issue threads and 14,364 total note records (6,216 non-system comments), but
  that cache is gone and those records are historical counts only. Durable-cache retrieval is active; at `2026-10-18T11:46:06Z` it had reconciled
  3,633 of 32,692 non-system comments across 319 issue threads. The live manifest
  is authoritative between checkpoints. The fetcher is resumable and
  persists notes per IID in the external cache. Seven aliases per request
  succeeded below the observed complexity limit; eight scored 201 and failed
  the API's 200 ceiling. `user_notes_count` counts non-system comments; the
  GraphQL connection also returns system notes.
- Cutoff B: pending; take only after completing the baseline engineering pass,
  then record later arrivals separately.

## Repository/worktree

- Varve repository: `varvedesign/varve`; actual remote still points at the
  previous `K-Arthur/varve` URL, which GitHub resolves to the current project.
- Task worktree: `.worktrees/inkscape-corpus`, branch `feat/inkscape-corpus`,
  created from local `master` at `0241f1a63`.
- Local `master` is 143 commits ahead and 7 behind `origin/master`, with
  extensive uncommitted work owned by other sessions. Do not alter, stage, or
  commit that work. No remote integration or deployment has occurred.
- Do not stop other agents, their browser/app sessions, or their validation
  processes. The earlier queued browser run was this agent's own and was
  cancelled before acquiring the shared heavy-task lease.

## Completed

1. Read the supplied brief and project instructions.
2. Corrected source identity: GitHub mirror has no issues; official tracker is
   GitLab. Confirmed the tracker with GitLab's public API and reconciled the
   open/closed totals at cutoff setup.
3. Created this isolated worktree and source-boundary record.
4. Durable rehydration recovered all 64 issue-list pages and 6,392 unique
   baseline bodies, with zero missing or duplicate baseline IDs. It exposed
   two pre-cutoff items omitted by the initial crawl; #6482 and #6483 are now
   included in the ledger. The initial 6,390-row count and checksum remain
   historical.
5. Built a one-row-per-issue ledger with source metadata and explicit pending
   screening, thread, evidence, engineering and visual status. Added resumable
   issue-body and GraphQL discussion fetchers.
6. Screened issue bodies #6398 (save-time memory growth), #6380 (PDF text loss),
   #6477 (extension path rewriting), linked #1313, and #5782 (PDF partial export). Varve uses embedded,
   content-addressed image assets and strips repeated per-fill payloads, so
   #6398 is only an adjacent memory-risk hypothesis pending measurement. The
   #6380 PDF attachment returned HTTP 403; #6398's attached archive warns it
   can lock up the system and was not downloaded or executed.
7. Screened body #2800, a second historical Inkscape report of memory retained
   per save with a linked PNG. The reported archive was not downloaded. Current
   body-screening total was 9 of 6,392 before the next two screens. #5782 discussion review found a
   singular-transform trigger and linked #691; Varve source inspection suggests
   subtree rasterization contains it, but an actual export check remains pending.
8. Reviewed all 39 notes on #203, including 14 user comments, and MR 2907:
   Inkscape's minimal filtered-clip crash was confirmed fixed, while the larger
   original document remained untested. Varve routes effects and masks through
   a canvas raster PDF fallback; no same-cause Varve failure is established.
9. Screened #1739's body: a masked image inside an SVG pattern reportedly
   caused high memory use, missing fill, and a crash with a zero-byte PDF.
   Both comments and linked reports #1018 and Inbox #9599 were reviewed; the
   original sample remains pending. Varve has a bounded tile-count path, but
   an equivalent nested-SVG-mask pipeline has not been established.
10. Body-screening total was 11 of 6,392 at this checkpoint. The website review found no
   PDF capability claim that these source reports justify changing; recheck
   after export validation.
11. Reviewed #260 and #543. Varve already has atomic native file replacement
    and a bounded raster-export policy with scale-down warnings. Their issue
    groups need separate crash/power-loss and native UI visual verification;
    neither currently proves a new Varve defect.
12. Screened #86, #112, #155, #252, #328, #481, #529, #1573, #4717, #4924,
    #5539, #5624 and #5696. Threads confirm several duplicate or historically
    fixed Cairo failures, while filtered bleed and mask-resolution fidelity
    remain candidates for real Varve PDF output checks. #1018 is queued as
    related evidence; post-cutoff Inbox #9599 is tracked separately.
13. Added a Rust regression for over-budget raster-pattern expansion. Source
    review found tile pixels were converted and embedded before applying the
    existing 100,000-instance cap; move the cap ahead of that allocation and
    verify neighboring solid artwork remains in the PDF.
14. Screened #1018's body. Its reported Cairo pattern surface scaled with zoom,
    causing multi-gigabyte RAM use and a black canvas; individual notes remain
    pending. Varve's pattern renderer uses decoded tiles and bounded instances,
    without the same zoom-scaled Cairo surface path.
15. Current body-screening total is 27 of 6,392. Discussion and linked-source
    retrieval remain in progress.

## Next operation

Continue reconciling all 32,692 reported non-system comments, then screen the
remaining bodies and discussions for high-impact candidate failure classes. Keep system notes for
linked events and state history. Do not mark an issue reviewed based only on
its title, labels, or downloaded body.
