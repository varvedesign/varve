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
  that cache is gone and those records are historical counts only. Durable-cache retrieval is active; at `2026-10-18T13:11:45Z` it had retrieved 12,235 of 32,692 non-system
  comments across 1,931 issue threads. This newer snapshot counts cached notes;
  substantive content review covers only the threads listed in the ledger. The live manifest
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
    fixture. #5983's linked 65,500×3,273 JPEG is below Varve's per-axis cap but
    has 214,381,500 pixels, above the 64 Mi-pixel pre-decode budget. A focused
    synthetic JPEG-header regression asserts rejection without downloading
    the image; all 6 focused raster-inspection tests passed. This does not
    reproduce Inkscape's later zoom crash. #5878's Powerstroke path editing
    and #5976's marker
    recoloring dialog have no direct Varve feature match. #1231's styled-stroke
    drag memory report may inform a bounded selection stress scenario. Their
    35 combined reported notes remain pending retrieval/review.
18. Current body-screening total was 35 of 6,392. The 3,633/32,692 comment
    retrieval snapshot remains unchanged and incomplete.
19. Screened #670 (dashed polygon stroke display/export parity), #721
    (multiply blend omitted from PDF after blur rasterization), #894
    (zero-length square-cap path differs from Firefox), #1063 (large Cairo
    radial-gradient artifacts), and #1351 (Simplify live-path-effect editing
    lag). #670 and #721 are useful visual output candidates; #894's expected
    SVG behavior is uncertain, #1063 is Cairo-specific, and #1351 has no Varve
    feature equivalent. Linked samples remain uninspected and all 40 reported
    notes remain pending retrieval/review.
20. Screened #651 (embedded-raster selection freezes Inkscape's XML Editor),
    #685 (overlapping text order differs between SVG canvas and PDF), #694
    (transformed/clipped/blurred masks disappear from PDF), and #712 (low-res
    masks and duplicate-mask objects disappear). #685, #694, and #712 remain
    concrete PDF parity/resolution candidates. Their 18 user comments have
    since been reviewed, but linked fixtures remain uninspected. #651 has no
    equivalent Varve feature.
21. Current body-screening total was 44 of 6,392. No new Varve defect is
    established by these body-only reports.
22. Reviewed the complete cached discussions for #670, #685, #694, #712, and
    #721. #685 was fixed upstream in MR !1299; #694 received a partial
    transform/mask fix in MR !5000; #712 is duplicate evidence for #252/#694.
    #670 traces to Cairo banded raster output; #721 is version-dependent
    background-filter behavior. Linked attachments remain uninspected. The live
    note-fetch snapshot at 2026-10-18T13:12:24Z had 12,748/32,692 user notes
    across 1,994 threads; content review is much narrower.
23. Screened bodies #6143, #6220, #6298, #6323, and #6407. They describe
    PDF transparency import, recent missing-path export, clipped-text PDF size
    and edge quality, nonzero viewBox-origin placement, and a Windows CLI-only
    failure, respectively. Linked fixtures and discussions remain pending;
    current body-screening total is 49 of 6,392.
24. Screened #204, #255, #698, #814, #952, and #5971. They cover aggregate
    image-import OOM, a dependency-specific Poppler crash, masked color shifts,
    PDF image placement, text-decoration omission, and missing print marks.
    These remain candidate classes pending comments, fixtures, or Varve output
    comparison. Current body-screening total is 55 of 6,392.
25. Screened #5451, #5527, #5661, #5808, #5893, #6031, #6132, #6243, and
    #6284. Coverage includes embedded-font PDF validity, large raster export,
    bleed boxes, missing-font text omission, nested transparency, legacy flowed
    text, cloned clipped pages, and cross-linked SVG memory use. Some map to
    existing Varve bounds or explicit font failures; linked discussions and
    output comparisons remain pending. This brought body-screening total to 64
    of 6,392.

26. At this checkpoint, #1–#1200 and #1201–#2400 had received full-text
    triage plus manual review of selected high-signal bodies and cached
    discussions; neither range was counted as fully manually screened.
    Subsequently, #1–#1200 was fully manually screened (entry 34).
    #1201–#2400 remains partially reviewed. Selected reports add
    document-integrity, explicit export-error, stroked-text PDF, clip-path,
    filter/mask, and pattern-memory regression categories.
27. Individually screened 1,190 available issue bodies in #2401–#3600. Eight
    bodies (#2443, #2580, #2806, #2880, #2946, #3011, #3452, #3558) were not
    present in the local cache; two other bodies in the range were already
    screened. No notes were cached in this range, so discussion review remains
    pending. Current ledger coverage is 1,293 unique bodies of 6,392, with 44
    target discussion threads content-reviewed. Strong candidates include
    #2704/#3239 clipped blend and masked-filter PDF, #2828 large masked-scene
    memory, #3115 relinking data integrity, #3214 multipage resource omission,
    and #3596 empty export failure. These are test categories, not established
    Varve defects.

28. Individually screened 375 available bodies in IID 6001–6392. Ten were
    already screened (#6031, #6132, #6143, #6220, #6242, #6243, #6284,
    #6298, #6323, #6380); seven issue bodies were unavailable (#6025, #6038,
    #6039, #6172, #6203, #6215, #6232). No discussions or attachments were
    reviewed. Combined with four additional body screens and the #1668 thread
    read directly in the cache, the ledger now records 1,672 of 6,392 bodies
    and 45 target discussion threads reviewed. Current candidates include
    PDF mask/pattern fidelity, PDF links and non-ASCII URLs, viewBox scaling,
    HSL serialization, turbulence seams, and raster edge bleed. They remain
    unconfirmed Varve test categories.

29. Individually screened 868 available bodies in IID 3901–4800; the
    30 unavailable descriptions were #4083, #4153, #4178, #4181–#4185,
    #4205–#4214, #4290, #4294, #4332, #4344, #4414–#4416, #4529–#4532,
    and #4743. Two bodies (#3975 and #4717) were already screened. No notes
    or attachments were reviewed. Bodies #3601–#3900 remain pending full review; excerpt-based checks in that
    segment are not counted. The overall count is 2,540 unique bodies of
    6,392. Body-only candidate reports cover multipage PDF masks, clones and
    bleed, page geometry, linked-image data integrity, document mutation, and
    export cancellation/crashes; no matching Varve defect is established.
30. Individually screened all 149 available nonempty bodies in IID 3751–3900;
    #3771 was unavailable. None was previously counted. No notes or linked
    attachments were reviewed. The ledger now records 2,689 of 6,392 bodies.
    Body-only candidates include malformed paint-server crash handling
    (#3786), PDF-imported control characters breaking downstream XML tools
    (#3822), text loss in optimized SVG save (#3840), PDF page selection and
    text orientation (#3885/#3886), and text-style serialization (#3899).
    These are historical reports with version/platform-specific caveats; no
    matching Varve defect has been reproduced.
31. Individually screened 38 previously unreviewed bodies in IID 601–640;
    #602 and #613 were already counted. No discussions or attachments were
    reviewed. The total is 2,727 of 6,392. Candidates include PDF ligature and
    SVG text-direction fidelity, undo and page-frame restoration, clipboard
    isolation for shared path effects, SVG mask and layer-visibility
    inheritance, and document metadata persistence. Most reports describe
    older Inkscape versions; they define test categories rather than verified
    Varve defects.
32. Individually screened 34 newly available bodies in IID 641–680. The
    unavailable descriptions were #643, #644 and #652; #651, #670 and #678
    were already counted. No discussions or attachments were reviewed. The
    total is now 2,761 of 6,392. Reports include pointer-release transactions,
    clone and text-copy isolation, stroke-aware geometry entry, error handling
    in CLI selection, large-raster tracing, undo/cancel behavior, and SVG
    filter or mask fidelity. These remain body-only, mostly historical test
    categories.
33. Individually screened 198 available nonempty bodies in IID 5791–6000.
    Eleven already-screened IIDs were excluded (#5808, #5878, #5887, #5893,
    #5910, #5924, #5939, #5960, #5971, #5976 and #5983); #5956 has an empty
    description. No notes or linked attachments were reviewed. The ledger now
    records 2,959 of 6,392 bodies. High-impact report categories include
    clipboard focus and object integrity, large-document tree-operation
    stalls, LPE load/undo crashes, geometry hit-testing, and import-versus-open
    fidelity differences.
34. Completed individual full-description screening of IID 1–1200: 1,057
    bodies were newly read, 116 already-reviewed IDs were excluded, and 27
    descriptions were unavailable (#133, #146, #184–#187, #499, #532–#537,
    #561, #566, #643–#644, #652, #776, #778, #899–#903, #931, #1004). The
    total is 4,016 of 6,392 bodies. No notes or attachments were reviewed in
    this sweep. Candidate categories include export-option fidelity,
    SVG/text/filter interoperability, save/undo integrity, copy isolation,
    and viewport/redraw correctness; these reports do not establish matching
    Varve defects.

## Validation checkpoint: 2026-10-18

- Latest `pnpm verify:affected` selected `format:touched`, `lint:touched`,
  `audit:emoji`, `audit:docs`, `typecheck:e2e`, and the exact PDF export E2E;
  the first four passed after formatting the generated summary JSON. Typecheck
  failed on the pre-existing `packages/scene/src/index.ts` export of absent
  `./nodeResize`, so the dependent browser E2E did not start.
- After adding the targeted #5983 raster-header regression, the selected
  `format:touched`, `lint:touched`, `audit:emoji`, and `audit:docs` lanes passed
  again. `typecheck:e2e` failed on the same missing module before the focused
  import unit test could run. The commit hook then ran
  `pnpm exec vitest run --maxWorkers=1 packages/import/src/rasterInspection.test.ts`:
  all 6 tests passed, including the new 65,500×3,273 header rejection. The
  PDF UI E2E lease wait expired at its 600s deadline while another session's
  Vitest suite remained active; it did not launch Chromium or produce a UI
  screenshot. The PDF E2E commit is blocked by the same pre-existing
  `typecheck:e2e` failure. Do not reclaim the active lease.
- `node scripts/quality/heavy-lease.mjs 'Inkscape PDF pattern export regressions' -- cargo test --manifest-path crates/varve-print/Cargo.toml pattern` passed: 12 tests, including alpha embedding, PDF/X behavior, and the new tile-cap sibling-preservation regression.
- A fresh lease-wrapped run of `export_pdf_caps_pattern_tile_expansion_without_dropping_neighbor_content` passed (1 test); its generated PDF was rendered with `pdftoppm` and visually inspected. The PDF and PNG were written under `/tmp`, not the repository.
- Read-only review of the feature diff and pending E2E test found no
  actionable defects. The UI regression remains unstaged and uncommitted because
  the repository's commit hook requires `typecheck:e2e`, which fails on the
  pre-existing missing `nodeResize` module in committed `master`.
- `cargo fmt --manifest-path crates/varve-print/Cargo.toml -- --check` reports
  two formatting differences at existing lines 348 and 420 in `lib.rs`; neither
  overlaps commit `9718be550`'s diff. The added code has no reported formatter
  changes.
- Native PDF manifest parser unit test passed earlier in this worktree.
  `pnpm verify:affected` on the feature branch and an isolated worktree at
  committed local `master` both reached `typecheck:e2e` and failed because
  `packages/scene/src/index.ts` exports the absent `./nodeResize` module. The
  lease-wrapped E2E attempt reached its 600-second wait deadline without
  launching Chromium. No source was copied from the other active worktree to
  mask this blocker.
- Website impact review found no supported PDF claim or user guidance that the
  current change needs to alter. Marketing site source remains unchanged; no
  website visual run was needed because no marketing source changed.

## Next operation

Continue the manual description review of the remaining body ranges and reconcile all 32,692 reported non-system comments, then screen the remaining discussions for high-impact candidate failure classes. Keep
system notes for linked events and state history. Do not mark an issue reviewed
based only on its title, labels, or downloaded body.
