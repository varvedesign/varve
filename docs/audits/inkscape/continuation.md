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
    Subsequently, #1–#1200 was fully manually screened (entry 34), and
    #1201–#2400 received its full-description sweep (entry 36). Discussion
    review remains partial for both ranges.
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
    or attachments were reviewed. At this checkpoint, bodies #3601–#3900
    remained pending full review; those segments were later completed in
    entries 30 and 35. The overall count at this checkpoint was 2,540 unique
    bodies of 6,392. Body-only candidate reports cover multipage PDF masks, clones and
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
35. Individually read all 147 available nonempty descriptions in IID
    3601–3750. Missing cache bodies: #3650, #3661, and #3704. No body in this
    slice had been previously screened; no comments or attachments were
    reviewed. The total is 4,163 of 6,392. Candidate reports include clone
    and ID-reference integrity, multipage PDF export, filter/marker preview
    lifecycle, and CLI versus GUI export behavior. These are historical
    reports and do not establish current Varve defects.
36. Completed the full-description sweep of IID 1201–2400: 1,165 descriptions
    were fully read, 32 IDs were excluded because already reviewed, and two
    descriptions were unavailable in cache (#1489, #1503). Two cached bodies
    were empty (#1289, #1595) and are counted as screened. #2207's 99,250-
    character build/test transcript was only partially inspected because tool
    output truncated repeated middle sections; it remains explicitly partial.
    No comments, attachments, or linked merge requests were reviewed in this
    sweep. The total is 5,328 of 6,392 bodies fully screened, plus one partial.
    High-signal report categories include save-time text/attribute loss,
    clipboard/import fidelity, batch-export overwrite safety, zoom/export
    rendering differences, PDF text positioning, startup stalls from stale
    remote recents, and snapping stalls. These historical reports are
    investigation leads, not verified Varve defects.
37. Fully read the cached descriptions for linked-evidence issues #504 and
    #2107, whose ledger body-screening fields had still been pending. #504
    describes a 100%-CPU open/preview hang with a style-heavy SVG in Inkscape
    1.0 beta; its linked SVG was not opened. #2107 reports canvas lag and
    occasional crashes while Document Properties is open on Linux/GTK. This
    brings full body screening to 5,330 of 6,392, plus partial #2207.
38. Individually read all 85 pending descriptions with IIDs 6393–6482. The
    three previously screened IDs were #6398, #6407, and #6477; all 85
    remaining bodies were present and nonempty. No discussion comments or
    attachments were reviewed. The total is 5,415 of 6,392 bodies fully
    screened, plus partial #2207. Candidate categories include save/reopen
    persistence for page clipping and alignment defaults, text styling,
    transform and gradient fidelity, raster-import extension detection, and
    page-relative duplication. These are issue leads, not verified Varve
    defects.

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
- For the IID 1201–2400 ledger update (`229ab02d4`), `pnpm verify:plan`
  selected touched-file format/lint, emoji and docs audits, `typecheck:e2e`,
  and the targeted PDF export E2E. Touched format/lint, `audit:emoji`, and
  `audit:docs` passed; `typecheck:e2e` again failed because
  `packages/scene/src/index.ts` exports missing `./nodeResize`, so the
  dependent browser test did not start. No full suite was selected. The
  commit checkpoint also passed staged Biome, emoji, health, impact-config,
  E2E-interaction, secret, contacts, and docs audits.
- For the #504/#2107 correction and IID 6393–6482 sweep (`036eddae4`),
  `pnpm verify:plan` selected the same six lanes. Touched-file format/lint,
  `audit:emoji`, and `audit:docs` passed; `typecheck:e2e` failed after 148s
  on the same absent `./nodeResize` module, so the dependent browser E2E did
  not start. No full suite was selected. The staged commit checkpoint passed
  Biome, emoji, health, impact-config, E2E-interaction, secret, contacts, and
  docs audits.
- For the exact-ID IID 5479–5790 reconciliation and #5304 body update,
  `pnpm verify:plan` selected touched format/lint, emoji and docs audits,
  `typecheck:e2e`, and the targeted PDF export E2E. After formatting the
  summary JSON with Biome, format, lint, `audit:emoji`, and `audit:docs` passed.
  `typecheck:e2e` failed after 80.6s on the existing missing
  `packages/scene/src/nodeResize` module; the dependent browser E2E did not
  start. No full-suite escalation was selected.
- For the PDF pattern row-orientation regression, the focused lease-wrapped
  Rust test first failed on an incorrect negative-height expectation. Rendering
  the captured PDF with `pdftoppm -r 1152` showed the existing positive-height
  transform preserved the asymmetric tile's red/green top row and blue/white
  bottom row. The test expectation was corrected to this visually verified
  behavior. The corrected focused test passed; the orientation screenshot is
  `/tmp/varve-inkscape-pattern-orientation-green.png`.

39. Reconciled the Inkscape body sweep for IID 5479–5790 against exact retained
    ranges and the durable issue cache. Fully read 300 available descriptions
    in #5479–5481, #5483–5526, #5528–5538, #5540–5545, #5547–5577,
    #5579–5586, #5588–5623, #5625–5660, #5662–5673, #5675–5695,
    #5697–5716, #5718–5781, and #5783–5790. Also fully read #5304.
    #5294's 126,637-character body remains partial. IIDs #5546, #5578,
    #5587, #5674, and #5717 had no ledger/cache body. The #4801–5478 counts
    reported earlier conflicted and could not be reconstructed at
    that checkpoint. A fresh exact-ID pass later recovered #4801–5150; the
    remaining #5151–5478 bodies were still uncredited. No discussions or
    attachments were read.
    Body screening now records 5,716 fully screened, 2 partial, and 674 pending.
40. Re-read pending bodies in IID 4801–5150 with exact IDs: 347 full descriptions
    in #4801–4833, #4835–4923, #4925–5090, and #5092–5150. #4924 was already
    screened; #4834 and #5091 are absent from the ledger/cache. No descriptions
    in the slice were empty or cache-missing; discussions and attachments were
    not reviewed. High-signal body-only leads include batch PNG layer flattening
    versus preview (#5092), stale export order/preview state (#5106/#5147), PDF
    import/CLI export crashes (#5098/#5099), undo/redo crash under reverse mask
    (#5120), and text coordinate loss after hide/show (#5137/#5102). These
    reports do not establish current Varve defects. Body totals are now 6,063
    fully screened, 2 partial, and 327 pending.
41. Investigated Inkscape #5480's mirrored pattern-export report. GitLab reports
    zero comments, while its four screenshots redirect to sign-in. Varve's PDF
    raster-tile path preserved an asymmetric 2×2 source tile in a 1152-dpi
    Poppler render, so no matching raster-orientation defect was reproduced.
    Vector-origin pattern and blur variants remain untested; a focused test now
    guards the verified transform.

42. Re-read pending bodies in IID 5151–5478 with exact IDs: 321 full available
    descriptions in #5151–5292, #5297–5303, #5305–5417, #5419–5450, and
    #5452–5478. #5293, #5295, #5296, and #5418 are absent from the ledger/cache;
    #5294 remains partial, while #5304 and #5451 were already screened. The
    #5316 cached report itself ends abruptly at a literal `<a`; #5400 and #5467
    are template-only reports. No discussions or attachments were reviewed.
    Body totals are now 6,384 fully screened, 2 partial, and 6 pending.

43. High-signal body-only leads in IID 5151–5478 include external-SVG/clone
    copy crashes (#5282), recursive defs import on pattern paste (#5351), SVG
    ID collision affecting `<use>` (#5317), broken-link repair substituting a
    same-basename image (#5432), duplicated clipPaths on PDF import (#5345),
    portal printing at the wrong physical size (#5335), stale boolean-LPE
    rendering after save/reopen (#5305), and a Save As callback recursion
    freeze (#5376). These are screening candidates: linked fixtures, notes,
    current fix status, and matching Varve workflows still need review.

44. Added a focused asymmetric raster-pattern PDF orientation regression test
    and visually verified the captured Poppler render. Focused
    `varve-print` tests (170) and clippy passed. The planner-selected desktop
    Rust check stopped during archive creation with `No space left on device`;
    its generated Cargo.lock edit was restored. `verify:affected` still stops
    at the unrelated E2E typecheck failure caused by missing
    `packages/scene/src/nodeResize`; browser E2E did not start. `cargo fmt
    --check` reports only two pre-existing differences at lines 348 and 420 of
    `crates/varve-print/src/lib.rs`.

45. Read the six remaining pending issue descriptions: #5887, #5910, #5924,
    #5939, #5956, and #5960. #5956's cached description is empty. All 6,392
    ledger rows are now accounted for: 6,390 fully screened descriptions,
    including empty descriptions, 2 partial bodies (#2207 and #5294), and zero
    pending bodies. Discussion, recursive linked-evidence, engineering, and
    visual coverage remain separate and incomplete.

46. Reviewed discussions and linked history for #5887, #5910, #5924, #5939,
    #5956, and #5960, plus the linked #4702 clone export report. #5887's
    selection SVG bounds fix is in merged MRs !7358/!7359; #5924 remains an
    oversized-viewBox report with its attached reproducer uninspected. #5910
    and #4702 document the selection-only clone-source tradeoff and merged
    MR !6138. #5960's variable-font report was addressed by merged MR !7516;
    Varve currently rasterizes variable-axis text for PDF, preserving visible
    appearance while losing vector/searchable text. #5956 has no body or user
    comments. #5939 has no human comments; merged MR !7506 implements SVG
    `feDropShadow`, with duplicate reports #5638/#5902. Varve now imports the
    single-primitive case as an editable drop shadow while reporting the
    unrepresented filter clip and blur-unit difference; visual validation is
    pending. The in-app browser rejected a `data:` SVG preview under its URL
    policy, so no alternate browser route was used; the earlier PDF visual
    check does not validate this SVG importer. Marketing pages were checked
    for SVG-import/filter claims and none need revision; the public File
    Formats guide now describes the supported primitive and reported limits.
    Cross-app complaint review found
    Illustrator reports of missing custom SVG shadows and displaced exported
    shadows, plus Affinity feedback about non-editable/rasterized effects;
    these are version-specific reports, not verified current behavior. Their
    transferable lesson is to preserve editable geometry and label filter
    approximations. These are bounded issue follow-ups, not complete discussion
    coverage across the corpus.

47. Updated the public File Formats guide to name the single-object
    `feDropShadow` import subset and its filter-region/blur limitations. The
    local Astro page was visually inspected in the browser; `astro check` and
    the static build passed (126 routes). The final `verify:affected` run
    stopped at `audit:radius` on 10 pre-existing declarations in unrelated
    presentation/inspector styles. Website E2E stayed queued behind another
    session's active JavaScript test lease; only this session's waiting E2E
    request was cancelled. Focused importer suites passed (39 tests) with a
    temporary test config that read the shared scene package from the main
    checkout. The standard verifier and commit checkpoint still cannot pass
    while this worktree lacks the exported `packages/scene/src/nodeResize.ts`;
    the file was not copied or modified. The importer screenshot was not
    completed because the in-app browser policy rejected the SVG data URL.

48. Read all cached notes/history for #2229 (16), #2378 (12), and #2069 (10).
    #2229's SVG 1.1 fallback text-loss regression was fixed upstream in 2021;
    Varve's codec/writer review found no current analogue. #2378 concerns
    arbitrary attributes on SVG2 auto-flow tspans under SVG 1.1 fallback;
    Varve's normalized TextNode does not preserve arbitrary XML attributes,
    but current docs make no generic XML round-trip promise. #2069's later
    history shows the tradeoff between silent overwrite and auto-suffix copy
    clutter; Varve desktop folder exports currently replace existing paths.
    Findings and ledger record a candidate batch-level keep-both/skip/replace
    choice. No #2069 implementation has started yet.

49. A read-only `review-agent` pass of the #5939 slice found that filters
    attached to `<g>` bypassed `applyStylesToNode` without a warning. Added
    explicit unsupported reporting for filters attached to `<g>`, root `<svg>`,
    and `<use>`; drawable-node filters retain the supported subset. The same
    review found that a filename/content mismatch skipped the SVG parser and
    could hide filter fidelity details in preflight, so detected SVGs now still
    parse with mismatch diagnostics and have a regression case. The latest
    `verify:affected` run passed touched-file format/lint and emoji audit, then
    stopped at the 10 unrelated `audit:radius` declarations before docs audit,
    typechecks, or tests. A direct focused test invocation was started without
    the required heavy-task lease and stopped as this session's process. The
    corrected lease-wrapped importer run passed 76 tests across 4 files using a
    temporary read-only scene alias after the other session released its test
    lease. The latest Astro build passed `astro check` with zero diagnostics
    and built 126 static pages. The importer behavior remains visually
    unverified; the current docs page was checked at desktop (1280px) and
    mobile (375px) widths with no horizontal overflow, and the copy wraps
    within the existing layout. No files from other contributors were changed.

50. Reconciled ledger rows for #4702, #5887, #5910, #5924, #5956, and #5960
    with the discussion and linked-history review recorded in item 46. The
    summary now counts 55 issue threads whose ledger discussion state is
    reviewed. #5924 retains an explicit partial linked-evidence state because
    its attached reproducer is still uninspected; this distinction is not
    included in the broad body-screening count.

51. Final validation for the current uncommitted #5939/docs slice: `pnpm
    verify:plan` selected 21 lanes with no full-suite escalation. `pnpm
    verify:affected` passed touched-file format/lint and emoji audit, then
    stopped at `audit:radius` on the same 10 unrelated presentation/inspector
    declarations; no downstream affected lanes ran. `pnpm audit:docs` passed
    (1,169 docs, 867 links, 182 ADRs). The lease-wrapped focused importer tests
    passed 76 tests across 4 files using a temporary read-only scene alias to
    the main checkout because this worktree still lacks
    `packages/scene/src/nodeResize.ts`. The website build passed Astro check
    with zero diagnostics and built 126 pages. The public File Formats page
    was inspected at 1280px desktop and 375px mobile; both had no horizontal
    overflow. No commit or merge was made: the previous commit checkpoint
    failed on the same missing scene export, the SVG importer has no real-app
    visual evidence, and #2069 remains a researched candidate rather than an
    implementation.

52. A second-pass review checked SVG `primitiveUnits` against the W3C Filter
    Effects specification: the default is `userSpaceOnUse`, while
    `objectBoundingBox` lengths are target-relative. The importer now declines
    that latter case rather than applying offsets at the wrong scale, with
    regressions for default, explicit user-space, and object-bounding-box
    declarations. Updated the architecture table and public File Formats guide
    to state that subset. After the copy change, inspected the page in the
    existing in-app browser at 1280×720 and 375×812 (dark theme); the text wraps
    cleanly and the document width remained 1265/1280 and 360/375 respectively.
    The browser viewport was restored and the tab remains open. No landing-page
    marketing claim needs change.

    Added `tests/e2e/import/svg-filter-visual.spec.ts` to exercise File → Import,
    the fidelity report, editable Layer Effects, and desktop/mobile screenshots.
    Its first heavy-lease wait reached the configured 600-second deadline before
    launch while another session's editor package test (PID 696193) remained
    alive. Re-queued with a 1,800-second wait; the run is still waiting and has
    not launched. `pnpm typecheck:e2e` fails before reaching the spec because
    this worktree lacks `packages/scene/src/nodeResize.ts`. The file exists
    untracked in the main checkout and has not been copied or changed. A
    temporary resolver in `apps/desktop/vite.config.ts` points the eventual
    browser run at that existing file read-only; remove this local bridge when
    the run completes. The importer screenshot is therefore still unverified.
    The latest focused Biome check and `pnpm audit:docs` passed. The latest
    `pnpm verify:affected` still stops at the same ten unrelated radius audit
    entries before typechecks or test lanes.

53. Reconfirmed the user-corrected scope is Inkscape. `pnpm verify:plan` selects 22
    affected lanes with no full-suite escalation. A fresh
    `pnpm verify:affected` invocation showed touched-file format and lint pass
    and began the emoji audit, but its terminal output was not retained, so its
    overall result is unverified. A direct `pnpm audit:radius` completed with
    exit 1 on the same 10 pre-existing declarations in Presentation and
    SpecPanel CSS. `pnpm audit:docs` passed (1,169 docs, 867 links, 182 ADRs
    indexed). A direct Biome check does not process Markdown files, so it was
    not counted as Markdown formatting validation. The importer visual E2E remains queued in heavy-lease
    session 53853 behind the still-live editor-package test process PID 696193;
    neither process has been interrupted. No source or documentation changes
    were made in this checkpoint.

54. Continued the Inkscape discussion-history review in bounded IID batches.
    For #1–100, 93 pending issues with cached notes were read individually:
    2,119 records (839 user comments and 1,280 system events); missing caches
    were #43, #48, #61, #67, #68, and #79. For #1201–1300, 79 pending issues
    with cached notes were read: 924 records (372 user comments and 552 system
    events); 18 pending issues had zero reported notes and no cache. For
    #2401–2500, 91 pending issues were reviewed: 1,164 records (554 user
    comments and 610 system events); nine note caches were missing. Previously
    reviewed IDs were excluded from these counts. These batches add 1,765
    non-system comments to the reviewed discussion set. Source reports are
    candidate workflow comparisons only, not verified Varve defects. Notable
    leads include keyboard focus and shortcut routing (#94, #1201, #1269–1270),
    unintended control changes from wheel scrolling (#31), object/metadata
    preservation (#1224), memory growth in selection workflows (#1231), and
    clipboard/tool behavior (#1276, #1296). Their source resolution state and
    version caveats are recorded in `findings.md`. Discussion retrieval is
    still incomplete; reconcile per-issue cache counts before claiming full
    coverage.

    Separately, the omitted `feDropShadow.stdDeviation` value was corrected
    from zero to the W3C-defined default of two, with a regression test. The
    latest `pnpm verify:affected` passed touched-file format/lint and emoji
    audit, then failed at `audit:radius` on ten unrelated pre-existing CSS
    declarations. The SVG importer visual E2E is still queued behind another
    live test process; no process was interrupted.

55. Reviewed and reconciled three more discussion ranges. IID 101–200 had 83
    pending cached threads read (1,370 notes: 604 user comments, 766 system
    events); nine caches were missing, while #112 and #155 were already
    reviewed. IID 1301–1400 had 93 cached threads read (1,330 notes: 588 user
    comments, 742 system events); seven zero-note caches were absent. IID
    2501–2600 had 84 cached threads read (1,103 notes: 521 user comments, 582
    system events); 16 caches were missing. #2550 remains partial: all 21
    cached entries were read, but the issue list reports 10 user comments and
    the cache contains only eight. The ledger now marks 259 new threads fully
    reviewed and records #2550 separately. The summary reports 577 fully
    reviewed threads total. Candidate failures, partial fixes, and their
    version caveats are in `findings.md`; none is presented as a verified
    Varve defect.

    At the latest notes-manifest snapshot (`2026-10-18T17:00:36Z`), retrieval
    had 28,983 of 32,692 expected non-system comments across 4,955 issue
    threads (65,875 total notes); 18 per-issue note-count mismatches remain
    and are recorded in `issue-ledger.summary.json`. The manifest is live and
    supersedes this checkpoint as retrieval continues.

    `pnpm verify:plan` selected 22 affected lanes and no full-suite escalation;
    `pnpm audit:docs` passed with 1,169 docs, 867 links, and 182 indexed ADRs;
    `git diff --check HEAD` passed. The real-editor SVG import visual test
    remains queued in session 53853 behind a separate session's live editor
    Vitest PID 696193. Both processes and the Astro dev server PID 634900 are
    still live; none was stopped or interacted with. The temporary resolver
    in `apps/desktop/vite.config.ts` is local-only and must be removed after
    visual validation. No commit or merge has occurred.

56. Added two more read-only Inkscape discussion reviews. IID 201–300 covered
    80 cached pending threads (1,061 records: 531 user comments and 530 system
    events); 15 pending issues had no cache. IID 1401–1500 covered 84 pending
    threads (1,171 records: 515 user comments and 656 system events); two
    already-reviewed threads bring the batch total to 1,229 records. Thirteen
    pending issues had no cache and IID #1489 is absent from ledger/cache.
    Both sets are recorded in the ledger; its discussion count is now 741
    fully reviewed threads, with #2550 still partial. High-signal reports
    include large-font-set picker freezes (#1465, later marked fixed by MR
    !8228 but not independently verified), rotated-image print omissions
    (#1478), office clipboard format mismatch (#1467), PDF text-position
    editing problems (#297), and SVG text-coordinate shifts (#234). Details
    and version caveats are in `findings.md`; these are competitor reports,
    not Varve defects.

    A read-only code review of the #5939 SVG drop-shadow importer found no
    actionable code findings. The reviewer also confirmed that parser and
    validation tests cover the supported subset and unsupported cases, while
    the real-editor rendering remains unverified because the E2E lease wait
    expired before browser launch.
    The current `pnpm verify:plan` selects 22 lanes with no full-suite
    escalation. `pnpm verify:affected` passed touched format, lint, and emoji,
    then failed at the same 10 pre-existing radius-audit declarations in
    Presentation and SpecPanel CSS; later lanes were not run. The direct docs
    audit passed (1,169 docs, 867 links, 182 ADRs). `git diff --check HEAD`
    passed. The visual E2E lease session 53853 expired after 1,800 seconds
    waiting behind another session's editor Vitest PID 696193; Chromium never
    launched. Research and ledger updates were committed as `e6dba8c69`; the
    #5939 importer code and application docs remain staged/unstaged for their
    own verified change. The website server, other sessions, and ChatGPT Linux
    app remain open; no process was stopped.

    After the optional-effects null guard, the final read-only code review
    reported no new findings. `pnpm typecheck:e2e` and
    `pnpm --filter @varve/import typecheck` passed with a temporary symlink to
    the existing main-checkout `nodeResize.ts`; the symlink was removed after
    typechecking and restored only for the queued importer Vitest run. The
    first import typecheck caught the optional `SceneNode.effects` access and
    failed; the code now defaults missing effects to an empty array. A fresh
    `pnpm verify:plan` still selects 22 lanes with no full-suite escalation.
    The latest `pnpm verify:affected` passes touched format/lint and emoji,
    then fails on the same unrelated radius-audit declarations; no downstream
    lanes execute. Focused importer Vitest is queued behind PID 696193 with a
    one-hour lease timeout.

    A staged code-commit attempt ran the repository's normal commit checkpoint;
    Biome, emoji, health, impact-config, E2E-interaction, secret, contacts,
    docs, import-boundary checks passed, then its `typecheck:e2e` command hit
    the hook's 120-second timeout while shared Vitest workers were active
    (about 3,083 MiB available at launch). The hook correctly blocked the
    commit; it was not bypassed. Retry after shared test load clears.

## Next operation

Implement and validate the Inkscape #2069 desktop export collision choice, then
investigate #1551 sequential export state and #5960 variable-font PDF fidelity.
Continue linked-evidence and cached discussion review while keeping research
coverage separate from engineering status. #5939 visual validation is complete
for the Chromium TypeScript-renderer path; native Tauri remains unverified.
Reconcile all 32,692 reported non-system comments before claiming broad discussion
coverage. Keep system notes for linked events and state history. Do not mark an
issue reviewed based only on its title, labels, or downloaded body.

57. A fresh visual E2E attempt acquired the heavy-test lease and started
    Chromium, but global setup timed out waiting for the editor's New button;
    therefore the import path and screenshots were not reached. Vite's startup
    log reported unresolved `./bundle-assets` imports from the main checkout's
    untracked codegen source, in addition to the pre-existing scene export
    bridge. Added a second temporary resolver for that main-checkout source
    and queued a retry through the same lease. It is waiting behind another
    session's three-import E2E run (PID 957377); no process was stopped. The
    website server and ChatGPT Linux app remain open.


58. The #5939 real-editor Playwright flow now passes (1 test) after three test
    harness corrections: the Import Results dialog has two Close controls,
    Escape while the Inspector owns focus does not deselect the canvas object,
    and the Zoom label is shared with the Zoom tool. The test focuses the canvas
    before Escape, asserts the selection dimension overlay is gone, and sets the
    zoom through `#status-zoom`. The final run captured and visually inspected
    the import report, editable Layer Effects panel, and full-window desktop
    light (1280x720), mobile light (390x844), and mobile dark (390x844) states.
    The shadow is visible and centered in all artwork screenshots without
    clipping; the app layout remains legible at both widths. WASM did not load,
    so the browser used the TypeScript fallback renderer; native Tauri rendering
    is still unverified. Vite emitted only its expected WASM fallback warning.

    `pnpm verify:plan` selected 37 lanes and no full-suite escalation.
    `pnpm verify:affected` passed touched format/lint, emoji/docs audits, and
    `typecheck:e2e`, then failed in the `@varve/desktop` TypeScript lane. A
    temporary symlink to the main checkout's untracked `bundle-assets.ts`
    removed the three missing-module diagnostics and the dependent implicit-any
    diagnostic; the only remaining error is the unchanged cast at
    `packages/editor/src/collab/CollabSurfaces.tsx:450` (readonly `Affine`
    assigned to mutable `number[]`). This file is outside the task diff; no later
    affected lanes ran. No full suite was selected.

    The 1501-1600 discussion sweep reviewed 578 user comments across 85 cached
    threads (1,305 total records); 81 newly reviewed threads were added to the
    ledger, with 14 no-comment threads still pending and #1503 absent. Strong
    follow-up leads are #1551 sequential export state leakage, #1523 bounded
    pattern/PDF memory, #1526 mask-transform fidelity, and #1584 opacity print
    boundaries. Findings preserve the historical-version and reproduction
    caveats. The website page and app remain open; no other process was stopped.
