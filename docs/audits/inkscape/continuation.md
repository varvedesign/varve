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
    existing 100,000-instance cap; commit `9718be550` moves the guard before
    source-pixel scanning/conversion and verifies neighboring solid artwork
    remains in the PDF. Follow-up `a081b64b6` moves the advisory warning after
    the PDF/X-1a transparency rejection so rejected fills do not emit a second,
    irrelevant tile-count warning. The focused test and all 12 pattern tests
    passed before the follow-up; the focused test is queued for a fresh PDF
    render and visual inspection.
14. Screened #1018's body. Its reported Cairo pattern surface scaled with zoom,
    causing multi-gigabyte RAM use and a black canvas; individual notes remain
    pending. Varve's pattern renderer uses decoded tiles and bounded instances,
    without the same zoom-scaled Cairo surface path.
15. Screened #6242, #2190 and #3580. Varve emits PDF 1.4 (standard) and 1.6
    (PDF/X-4), so #6242's PDF 2.0 version trigger is not shared; #2190's
    historical mixed-font failure remains a useful cross-viewer test category.
    Varve's 6,400% zoom ceiling and raster surface budgets cover the scale of
    #3580's 15,000% bad-allocation report. Discussions remain pending.
16. Current body-screening total was 30 of 6,392. Discussion and linked-source
    retrieval remain in progress.
17. Screened #3975, #5983, #5878, #1231 and #5976. #3975/#3580 describe
    Cairo failures at extreme zoom; Varve's zoom and raster budgets reduce the
    same unbounded allocation class, but need a synthetic near-limit blur
    fixture. #5983's 65,000-pixel JPEG is below Varve's 65,535 per-axis cap,
    making a bounded synthetic import/zoom test worthwhile; its external image
    was not downloaded. #5878's Powerstroke path editing and #5976's marker
    recoloring dialog have no direct Varve feature match. #1231's styled-stroke
    drag memory report may inform a bounded selection stress scenario. Their
    35 combined reported notes remain pending retrieval/review.
18. Current body-screening total is 35 of 6,392. The 3,633/32,692 comment
    retrieval snapshot remains unchanged and incomplete.

## Validation checkpoint: 2026-10-18

- `pnpm audit:docs` and `pnpm audit:emoji` passed after the documentation edits.
- `node scripts/quality/heavy-lease.mjs 'Inkscape PDF pattern export regressions' -- cargo test --manifest-path crates/varve-print/Cargo.toml pattern` passed: 12 tests, including alpha embedding, PDF/X behavior, and the new tile-cap sibling-preservation regression.
- A fresh lease-wrapped run of `export_pdf_caps_pattern_tile_expansion_without_dropping_neighbor_content` passed (1 test); its generated PDF was rendered with `pdftoppm` and visually inspected. The PDF and PNG were written under `/tmp`, not the repository.
- Read-only review of the committed code diff and pending E2E test found no actionable defects. The E2E test itself remains unrun because of the missing `nodeResize` module described below.
- `cargo fmt --manifest-path crates/varve-print/Cargo.toml -- --check` reports
  two formatting differences at existing lines 348 and 420 in `lib.rs`; neither
  overlaps commit `9718be550`'s diff. The added code has no reported formatter
  changes.
- Native PDF manifest parser unit test passed earlier in this worktree.
  `pnpm verify:affected` reached `typecheck:e2e` and failed because
  `packages/scene/src/index.ts` exports the absent `./nodeResize` module. The
  E2E test and desktop UI screenshot are therefore not yet validated. No source
  was copied from the other active worktree to mask this blocker.
- Website impact review found no supported PDF claim or user guidance that the
  current change needs to alter. Marketing site source remains unchanged; no
  website visual run was needed because no marketing source changed.

## Next operation

Continue reconciling all 32,692 reported non-system comments, then screen the
remaining bodies and discussions for high-impact candidate failure classes. Keep system notes for
linked events and state history. Do not mark an issue reviewed based only on
its title, labels, or downloaded body.
