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
unless explicitly listed. Linked discussion review currently includes the
single-instance PRs #2358 and #3755 for #1540; transform PRs #3843, #5859, and
#6186 for issues #2784, #3610, #5665, and #5667; and numeric-boundary fixes
#4182 and #4202 for issues #4181 and #4201. This review found an
external transient-preview loss while panning, an async commit cancellation,
and a history-order defect; it did not establish the same defects in Varve.
Issue #2784 remains unclear after video inspection: the cut selection disappears
after two images swap positions, but the initiating command and operation state
are not identified. The linked transform evidence and Varve comparison are recorded in
[the transform evidence note](linked-transform-evidence.md).

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

The latest completed code batch fixes multi-selection resize visibility and
locking in [F-019](findings.md#f-019--multi-selection-needs-visible-member-outlines-and-working-resize-handles).
The active follow-up [F-020](findings.md#f-020--native-title-bar-strategy-must-match-desktop-window-decorations)
aligns Tauri's build-time decorations with Varve's native Windows/macOS chrome
strategy, based on the #6962/#2687 system-title-bar reports. Windows target
build and native visual validation are still pending; related independent
GPU, mixed-DPI, and taskbar reports are not claimed fixed. See the
[linked window-chrome evidence](linked-window-chrome-evidence.md).

- [Findings and decisions](findings.md)
- [Continuation record](continuation.md)
- [Frozen issue inventory](issue-inventory-2026-10-17.jsonl)
- [Frozen pull-request inventory](pr-inventory-2026-10-17.jsonl)
- [Cutoff-B reconciliation](reconciliation-2026-10-17.json)
- [Cutoff-B issue deltas](issue-deltas-cutoff-b-2026-10-17.jsonl)
- [Cutoff-B pull-request inventory](pr-inventory-cutoff-b-2026-10-17.jsonl)
- [Cutoff-B pull-request deltas](pr-deltas-cutoff-b-2026-10-17.jsonl)

The highest-priority Varve data-integrity defect found so far is non-finite
numeric data crossing document and inspector boundaries. PhotoCraft #6862
reports `1e39` parsed as `f32` infinity, after which the affected file cannot
be saved. Its two comments and linked PR #6863's full body/timeline were read;
that exact failure is only analogous because Varve stores these document fields
as `f64`. Varve's separate JavaScript non-finite decode and expression-overflow
failures were independently reproduced and are being fixed in the current
branch. Related reports #5752 and #6424 have had their full discussions read.

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

## 2026-10-19 disposition checkpoint

All 3,275 cutoff-A issue rows now have an explicit Varve disposition or an
explicit unresolved decision: 215 candidates, 2 fixed items, 200 analogues,
453 partial matches, 34 already-covered behaviors, 80 trackers, 79 adjacent
QA/design leads, 2,207 reports with no Varve match established, 1 out-of-scope
issue with no corresponding feature, and 4 issues
that remain `unclear`. Those four are not completed dispositions; each has a
specific reason the available source evidence does not yet support a confident
Varve scope decision. The earlier 455-row unassessed gap now has per-issue
Varve evidence paths, reviewed-discussion links, and a retained rationale.
Nineteen issues in that range received independent overlapping reviews; the
alternate labels are retained in the row-level ledger, and conflicts affecting
scope were manually resolved. Thirteen of the 17 previously unclear issues
were resolved after their linked evidence and Varve paths were inspected.

The status counts distinguish source comparison from engineering completion.
The 215 candidates still require Varve reproduction or a product decision;
the 453 partial matches and 79 adjacent leads are not automatically defects.
The issue source pass and row-level Varve comparison do not complete the
recursive link frontier or review of the source repository's PR discussions.

The 2026-10-19 comparison classified PhotoCraft #3804 as an adjacent design
lead: Varve has no operation that bakes effects while preserving layer masks,
so the report does not establish a defect in an equivalent workflow. #3806 is
no-match because Varve has no OpenRaster import or save route; its destructive
in-place `.ora` conversion path is absent. These are scope decisions, not
claims that the PhotoCraft data-loss reports are harmless. #6599 also has no
matching silent same-folder document export in Varve: the Inspector's quick
export is for one object, and desktop output uses an explicit native save
dialog. The current [export documentation](../../architecture/code-export-system.md)
and [public export guide](../../../apps/website/src/pages/docs/tools/export.astro)
already describe this flow, so no marketing copy change is needed.

PhotoCraft #6740 is covered by Varve's paint-target lock guard. The layer lock
control changes only the `locked` property, while the paint target resolver
refuses a locked raster layer; focused tests passed for both the resolver and
the `PaintTool` pointer path (59 tests total). Unlocking does not rename the
layer in this flow. No product or marketing change is indicated.

The native save paths for #6596 and #6597 are covered by Varve's external-file
hash check and open-session destination ownership guard. The focused editor
regression passes 11 tests, including refusing a write when the native file
changed after open and refusing Save, Save As, or Save a Copy when another
open tab owns the destination. No public claim or website change is implicated.

Disposition records add a concise rationale and distinguish the PhotoCraft
issue state from Varve's engineering status. A PhotoCraft issue marked closed
is not evidence that Varve has a matching fix. Cutoff-B deltas retain the
separate limitations recorded above. Issue #2826 exposed a practical Linux
input conflict: Cinnamon can capture Alt-click before Clone Stamp receives it.
Varve now accepts Ctrl- or Command-click as an alternate clone-source gesture;
the focused unit tests and real-browser pointer regression pass, with a
target-safety screenshot retained under `evidence/`. Issue #1918's pending-crop
leak is fixed by cancelling Crop mode on active document/session change. The
full crop pointer spec passes 14/14 in Chromium, including the New-tab
regression; its screenshot was inspected at
`evidence/crop-cleared-on-new-tab.png`. PhotoCraft's merged PR #1957 and
Krita's official crop manual were checked as comparative evidence; the manual leaves
cross-image reuse of transient crop state unspecified. Issues #3076 and
#3093 were separately checked against Varve's history and gradient workflows; #3076
has no matching history-pixel brush operation, while #3093 is an adjacent
canvas-gradient lock bypass now covered by a passing real-pointer regression.
The lock-mid-drag screenshot is retained under `evidence/`.

PhotoCraft #1015 was separately compared with Varve's renderer and raster
performance records. Varve does not have the reported GPU-to-whole-document-
CPU fallback, but its accepted paint-raster LOD milestone remains unimplemented
despite the measured 2048² frame-budget trigger. The source's transform stalls
also motivate profiling Varve's bounded synchronous Transform Pixels path; no
stall has yet been reproduced at its admitted size. PR #1427, #4218, #5590,
and #6800 were reviewed as separate mitigations and performance evidence. The
marketing site makes no large-document performance promise to revise.

PhotoCraft #1101's NaN adjustment save/load case is covered by Varve's existing
adjustment normalization. A new `DocumentCodec.encode` → decode regression
confirms the invalid value becomes a finite default and the document reopens;
the issue is counted as covered, not as a newly fixed Varve defect.

PhotoCraft #478's controlled GPU-loss report maps to an existing Varve path:
the visible surface remains Canvas2D and lifecycle callbacks request an
authoritative redraw after loss. Focused simulated-loss and lifecycle tests
pass. A browser test that destroys the actual device and compares pixels is
not yet present; no Varve defect was established by source tracing.

PhotoCraft #1540 maps to Varve's existing `.varve`/`.strata` file associations.
Single-instance forwarding is implemented for Windows and Linux and uses the
current document-tab intake path. The focused native test build was stopped at
about 826 MB free on the root filesystem; packaged Linux visual validation and
Windows file-association validation remain pending, so the issue stays a
partial match. Tauri's single-instance plugin requires Linux session D-Bus
access; Varve does not publish a Flatpak package today.
