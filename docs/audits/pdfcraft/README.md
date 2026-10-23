# PDFCraft tracker review — audit area

Research and traceability record for the review of the
[PDFCraft issue tracker](https://github.com/storytold/pdfcraft/issues) and the
Varve work derived from it. Companion prose ledger:
[`docs/research/pdfcraft-tracker-ledger-2026-10-16.md`](../../research/pdfcraft-tracker-ledger-2026-10-16.md).

PDFCraft is an unrelated open-source PDF reader/editor written in Rust. Its
tracker is **evidence about a class of failure**, never proof that Varve has the
same defect. Claims of Varve correctness require code/test evidence; current
provenance gaps are reported by the completion gate.

**Current status: cutoff-3 closure is incomplete.** The terminal labels below
are provisional annotations, not a completed investigation. The current
checkpoint, evidence limits and integration blockers are in
[`CLOSURE.md`](CLOSURE.md). The completion gate now fails when recorded review
coverage is incomplete, even if every disposition label is terminal.

## Source inventory

| Property | Value |
|---|---|
| Source | `storytold/pdfcraft` issues (public, no authentication beyond a read token) |
| Retrieval method | GitHub REST `GET /repos/storytold/pdfcraft/issues?state=all&per_page=100&sort=created&direction=asc&page=N`, all 30 pages, no search endpoint used |
| **Cutoff 1 — inventory** | `2026-10-17T04:41:02Z` → `2026-10-17T04:41:58Z` (page-level `Link`-following; no `per_page` shortcut) |
| **Cutoff 1 — discussions** | `2026-10-17T05:00:00Z` (all 883 issues with comments; 1,717 comments) |
| Records retrieved | 2,978 (1,296 issues + 1,682 pull requests) |
| Issue numbers | 8 … 2978, unique, no gaps in the returned set and no duplicate numbers |
| State split | 827 open / 469 closed issues |
| Bodies | 1,279 of 1,296 issues carry a body; 17 are body-less (`205, 398, 488, 644, 744, 746, 985, 1157, 1161, 1190, 1387, 1579, 1859, 2160, 2390, 2403, 2788`) |
| Labels | `priority: critical` 24, `high` 73, `medium` 149, `low` 65, none 985; `multiple issues` 66, `bug` 62, `duplicate` 49, `enhancement` 42, `needs info` 41, `regression` 1 |
| Reconciliation | 827 open issues + 583 open PRs = 1,410, which equals the repository's reported `open_issues_count` — the inventory is complete for the cutoff, not merely the highest issue number |
| Growth | the tracker was created 2026-09-30 and grew to 2,978 records in 17 days, so a second cutoff is required for completion (see Limitations) |
| **Cutoff 2 — inventory** | `2026-10-21T19:31:27Z` → `2026-10-21T19:32:05Z`, same endpoint and Link pagination, 40 pages |
| **Cutoff 2 — discussions** | `2026-10-21T19:32:41Z`; the repository-wide comments endpoint returned 5,990 comments, which covers issue *and* pull-request threads (cutoff 1 had crawled issue threads only) |
| Cutoff 2 records | 3,903 (1,790 issues + 2,113 pull requests) |
| Cutoff 2 reconciliation | 1,044 open issues + 843 open PRs = 1,887 = the repository's reported `open_issues_count`; 0 duplicate numbers, 0 failed requests, 0 cutoff-1 issues missing |
| Cutoff 2 delta | **494 new issues** (401 open, 93 closed, numbers 2,981–3,905; 493 with bodies, 487 with comments), 184 cutoff-1 issues closed since, 338 cutoff-1 issues updated since |

Cutoff-2 rows are in [`issue-ledger-cutoff2.tsv`](issue-ledger-cutoff2.tsv) with a
`cutoff2` marker; cutoff-1 rows are never rewritten. Machine-readable totals:
[`issue-ledger-cutoff2.summary.json`](issue-ledger-cutoff2.summary.json).

**Cutoff 3 — closure pass.** The tracker was re-crawled at
`2026-10-23T07:52:52Z` → `07:54:25Z` (43 pages, Link pagination; the
repository-wide comments endpoint returned 6,761 comments, covering issue and
pull-request threads). 4,208 records: **1,951 issues** and 2,257 pull requests.
Reconciliation is exact: 1,103 open issues + 725 open pull requests = **1,828**,
which equals the repository's reported `open_issues_count`; zero duplicate
issue numbers, zero failed requests, zero cutoff-1/2 issues missing.

| Cutoff 3 delta | Value |
|---|---|
| Issues created after cutoff 2 | **161** (numbers 3,909–4,210; 151 open, 160 with bodies, 157 with discussion) |
| Cutoff-2-era issues closed in the snapshot (not closures since cutoff 2) | 838 |
| Cutoff-2-era issues updated since | 200 |
| Frozen issue ID set | 1,951 (SHA-256 in [`cutoff3.summary.json`](cutoff3.summary.json)) |

Cutoff-3 rows are in [`issue-ledger-cutoff3.tsv`](issue-ledger-cutoff3.tsv).
Cutoff 3 is the **final corpus boundary**: anything created later is a follow-on
queue, not an endlessly expanding review boundary. Closure has not occurred.
The frozen cutoff-1/2 rows are never rewritten; a later pass proposes resolutions
a row by appending to [`resolutions.tsv`](resolutions.tsv), and closure is a
property of the **latest disposition per issue**, checked by
`pnpm audit:pdfcraft-closure` (a manual, reproducible gate; it is not wired into
CI). [`CLOSURE.md`](CLOSURE.md) holds the closure
draft, the declared disposition census, remaining review inventory, and bounded
native/visual evidence. The 448-issue review inventory covers new and updated
reports plus proposed resolutions. Eighteen source adjudications are recorded in
[`source-adjudications.tsv`](source-adjudications.tsv) and `CLOSURE.md`; candidates
remain open. The other 430 reviews are uncertified. Reading a report is not a
runtime pass; partially adjudicated reports are not counted complete.

| Latest declared disposition (not certified) | Count | Non-terminal labels |
|---|---:|---:|
| cluster-assessed | 1,446 | |
| outside-varve-scope | 317 | |
| implemented-validated | 115 | |
| verified-already-correct- | 66 | |
| candidate / deferred | **7 / 0** | **7** |

Pull requests returned by the issue endpoints were separated from issues.
1,682 PRs were retained as linked evidence; their own discussions (1,113 PRs
with comments, 1,550 comments) were **not** crawled — see Limitations.

## Method

The method below describes the historical review. It is not evidence that all
cutoff-3 discussions and attachments were inspected; that acceptance remains
open. Downloading comments does not constitute reading/adjudicating them.

1. Every issue in the frozen set was read from its title, body and labels.
2. Every critical/high issue (97) and every issue whose title states a
   mechanism from a class under review (69 more) was adjudicated individually:
   its claim was compared with the PDF specification, with the PDFCraft fix
   where one exists, and with Varve's actual code path.
3. The remaining issues inherit a **cluster verdict** — one stated reason per
   cluster (below), so no row is "excluded" without a reason.
4. Only findings verified against Varve source (file and line read) are
   recorded as actionable. A class is not "applicable" because PDFCraft has it.

Evidence levels used in the research ledger: **report** (user claim only),
**code-anchored** (the reporter cites source), **reproduced** (an executable or
minimal repro accompanies the report), **audit** (source-inspected here, not
runtime-reproduced), **reproduced-in-varve** (observed here), **fixed**
(implemented here with tests).

## Machine-readable ledger

`issue-ledger.tsv` carries one row per issue in the frozen set:

```
number  state  priority  labels  cluster  disposition  reason
```

Dispositions:

| Disposition | Meaning |
|---|---|
| `implemented-validated` | Work landed in this repository in the referenced batch, with tests |
| `verified-already-correct-` | The class was verified present **and** sound in Varve, with code evidence |
| `candidate` | Relevant, verified, queued — with the specific class it belongs to |
| `deferred` | Relevant but blocked on a prerequisite, stated in the reason |
| `outside-varve-scope` | Varve has no such surface; the reason names it |
| `duplicate-of` | Labelled duplicate; the edited title names the canonical issue |
| `cluster-assessed` | No transferable mechanism found at cluster level; the reason carries the cluster verdict |

Counts at cutoff 1: `cluster-assessed` 1,156 · `candidate` 75 ·
`outside-varve-scope` 47 · `implemented-validated` 8 ·
`verified-already-correct-` 6 · `deferred` 4. 166 rows are individually
adjudicated; the rest inherit a cluster verdict.

Counts for the 494 cutoff-2 issues, read from the authoritative TSV:
`cluster-assessed` 252 · `outside-varve-scope` 164 · `implemented-validated`
50 · `candidate` 9 · `verified-already-correct-` 19 · `deferred` 0. The frozen
`issue-ledger-cutoff2.summary.json` records 10/1/17 for the last three; that
discrepancy is recorded in [`CLOSURE.md`](CLOSURE.md) §1 and the TSV wins. The rows named in the batch
table were individually adjudicated (title, labels, body, and the discussion
where it changed the reading); the rest inherit a cluster verdict with a
stated reason.
The 184 cutoff-1 closures were checked against the cluster map: none changed a
Varve disposition, because the closed classes are redaction, printing, forms,
signature and Office interchange, all of which remain outside Varve's scope.

## Cluster verdicts

| Cluster | Issues | Verdict |
|---|---|---|
| forms | 52 | No Varve form model and none planned. The text-metric and glyph-coverage mechanisms *inside* these reports are routed to their own adjudicated rows (`2894` measurement with the wrong font metrics, `2571` missing glyph fallback) |
| digital-signature | 48 | No signature or certificate surface |
| printer | 48 | No device-printing workflow: `Platform.printPdf` and `listPrinters` are implemented but have **no caller** in the editor (`packages/platform/src/tauri.ts:814`, declared at `platform.ts:353`); the print surface is PDF/X export. Output-geometry honesty is tracked separately |
| render | 48 | Blend-over-transparent verified sound; minification quality and derived-cache invalidation are the transferable classes |
| build-release | 39 | Their packaging and release tooling; Varve's own pipeline has its own gates |
| image | 38 | EXIF orientation is applied on import (`packages/import/src/import.ts:81`); minification quality and silent mask drops are the transferable classes |
| save-io | 35 | Varve's save architecture is documented (`docs/architecture/filesystem-boundary.md`, `save-destinations.md`); the "reported success while the file is broken" class is covered by in-flight save-truthfulness work (see Limitations) |
| text-edit | 33 | Edits must target authored identity, not inferred grouping (the authored-identity rule); reproducible cases are adjudicated individually |
| interchange | 32 | No Office interchange surface |
| ocr | 28 | No OCR surface |
| pdf-structure | 23 | No PDF structure-editing surface (Varve writes PDFs; it does not rewrite one) |
| page-geometry | 22 | Page size, rotation, order and count must survive save/reopen/export — verified in the page-geometry job |
| security | 16 | No PDF Standard Security Handler support; `packages/editor/src/archive` AES-GCM is a container mechanism |
| lifecycle-crash | 12 | Graceful capability degradation and termination-path error handling are the transferable classes |
| redaction | 10 | No redaction or sanitize surface; the disclosure rule in CLOSURE.md records the disclosure rule that would apply if one were added |
| fonts-glyphs | 104 | Missing-glyph fallback and substitution parity are the transferable class (batch 2) |
| interaction | 92 | Overlapping overlays and small-window overflow are the transferable classes; both queued, neither assumed |
| other | 613 | No transferable mechanism identified in the report text |

## Batches and status

| Batch | Finding | Status |
|---|---|---|
| 1 | PDF import cannot read a real PDF; mirrored geometry; dropped encodings; merged pages; unreported omissions | **implemented and validated** — `packages/import/src/pdf/`, commit `21f059e8d` |
| 2 | Text that a resolved font cannot cover renders as `.notdef`/blank in PDF export with no warning | **implemented and validated** — `packages/editor/src/export/glyphCoverage.ts`; the canvas already falls back per glyph, so the defect was the silent canvas/PDF disagreement, not a blank canvas. Commit `90f1e01d6`. Extended: the desktop app runs WebKitGTK, not Chromium, so the "canvas falls back per glyph" premise was measured there too — Playwright's WebKit GTK lane renders a CJK run set in an authored Latin-subset family by falling back per glyph, so the canvas is correct on the engine the app embeds and the defect is the PDF writer's, as recorded |
| 3 | Export surfaces minify full-resolution images with browser-default smoothing | **partially confirmed, corrected.** The premise was wrong for the main export path: `paintImageFill` already asks the image cache for a bitmap at the projected draw size (`resizeQuality: 'high'`), so the canvas receives an already-minified bitmap. Measured in Chromium, `'low'` and `'high'` are identical for a 4:1 downscale of a one-pixel checkerboard; they differ (0..255 vs 95..159) for a 3px checkerboard, the scanned-text regime. `applyRasterSmoothingPolicy` is therefore kept as an *explicit* policy for the draws that really scale (group/frame compositing, `renderRaster`, thumbnails) rather than as a fix for a demonstrated visual regression, and `tests/e2e/export/raster-minification.spec.ts` guards the outcome. `/Interpolate` is deliberately not set (reader hint that also smooths upscaled artwork; no size benefit). Commit `3ed8e6a03`, corrected in the review pass |
| 4 | Blend modes over a transparent backdrop | **verified sound and pinned** — every separable mode over alpha 0, the transparent-source direction, and the opaque-white-matte contrast case. Commit `3bfe7c04b` |
| 5 | Preflight/audit reporting "clean" for artwork the user cannot see | verified at the rule level: no Varve preflight result may read as a completeness guarantee the check does not provide (the disclosure rule in CLOSURE.md). No Varve check was found that reports a false clean for imported content, because hidden content is no longer imported (batch 9) |
| 6 | Page rotation, page count and output size surviving save/reopen/export | **verified for save/reopen** — Varve's page-rotation model is per-page width/height, and a mixed-orientation document round-trips with order and node positions intact (commit `340262b60`). Export page geometry is the native writer's contract and is covered by `tests/e2e/export/native-pdf-contract.spec.ts`, not by a browser unit test |
| 7 | Text edit identity (paragraph indices, property loss on re-edit) | already handled upstream: edits target authored node ids (the authored-identity rule), and the draft/target-switch paths are covered by `context/pendingEdits.ts` with `tests/e2e/save/text-draft-save.spec.ts` and `text-target-switch.spec.ts` |
| 8 | Interaction classes: cursor over chrome following the canvas, a second menu open on the first, a panel clipped in a small window | **verified absent and pinned** — `tests/e2e/ui/chrome-ownership.spec.ts`: the hand-tool cursor does not leak onto the menubar, opening a second menu leaves exactly one, at 1024x600 the inspector has no horizontal overflow and the Export tab stays reachable through the "More inspector tabs" menu, and the Settings dialog fits or scrolls instead of clipping. No UI change was needed |
| 8b | Autosave scheduling tied to repaint; failed-autosave retry suppression | deferred — `packages/editor/src/context/usePersistence.ts` belongs to another session; two writers on one file is worse than a delay |
| 10 | Vertical writing (`Identity-V`) imported as one horizontal line, so a CJK column became the wrong document | **implemented and validated** — `/WMode 1` (name or embedded CMap) is detected and the run becomes a `vertical-rl` text node; unit tests cover detection and the browser test asserts the rendered ink is a column. Per-glyph `/W2` metrics and one-glyph-per-`Tj` column merging follow in batch 11. Commit `codex/pdfcraft-remainder-20261022` |
| 11 | Vertical import refinement: per-glyph `/W2` metrics, one-glyph-per-`Tj` placement arriving as one layer per character, and parser notes that were generated but never shown | **implemented and validated** — `/W2` advances with a bounded `/DW2` fallback, consecutive vertical runs merge into one editable column, Import Results shows the parser's notes and wraps long detail rows, and deeply nested SVG now names the artwork it refused (row 3309). Unit and browser regressions extend batch 10's fixture; evidence in `docs/screenshots/pdfcraft/import-vertical-writing-*.png` |
| 9 | PDF import invents content the page does not show: invisible/clip-only text, hidden optional-content layers, encrypted files imported as blank pages, and an inline image whose `EI` is followed by a delimiter | **implemented and validated** — `/OCProperties` visibility, `Tr` render modes, `/Encrypt` refusal with a failure status, and delimiter-terminated `EI`. Commits `3bdd3e336`, `bb2f53d24`; browser evidence in `tests/e2e/import/pdf-import-integrity.spec.ts` and `docs/screenshots/pdfcraft/` |

## Open acceptance and limitations

These include unfinished acceptance, not just release-environment limitations:

1. **The tracker keeps moving.** Cutoff 3 is final for this review. A later
   issue is follow-on work, not missing coverage of this claim.
2. **Cluster-level rows are not individually re-read.** Every row has a
   disposition, but 1,446 rows inherit a cluster verdict whose stated reason
   purports to cover the mechanism. All new and materially changed reports
   still require body/discussion/attachment adjudication; label counts alone
   do not establish this.
3. **PDFCraft was never built or run here.** Every PDFCraft-side statement is
   *reported* or *code-anchored*, never reproduced. Actual attachment reading
   was limited to 4030, 4028 and 4118 stills and one frame at 2s of 4056's
   recording. This is not complete attachment coverage.
4. **Priority remains skewed.** Most issues carry no priority label, so the
   corpus was read by title, labels and mechanism, not by severity.
5. **Native evidence is bounded by the machine.** The desktop GUI, WebKitGTK
   and the native PDF/X writer were exercised only as far as recorded in
   [`CLOSURE.md`](CLOSURE.md). No full desktop GUI journey or independent PDF/X
   conformance validation completed. Poppler readability and version markers
   are not PDF/X conformance. qpdf was unavailable; veraPDF needs an actual
   availability check.
6. **Platform-specific claims stay unverified where the platform is absent.**
   Windows launch/GPU behaviour, macOS text scaling and Wayland pen hardware
   have no reproducible Varve case in this environment; they are recorded as
   platform gaps, not as passes.
7. **Key zeroization is language-bounded.** The archive key is a
   non-extractable `CryptoKey` and the encoded password buffer is wiped; an
   immutable JavaScript password string cannot be zeroized.

## Continuation record

The corpus is not closed. Remaining acceptance includes:

1. A per-node export budget exists (default five minutes) and is covered by
   `packages/editor/src/exportService.nodeBudget.test.ts` for mocked waits.
   Cancellation of underlying rendering and a real pathological export have
   not been proven. The temporary kernel timing is not full-export evidence.
2. Vertical-writing refinement beyond batches 10–11 (automatic
   tate-chu-yoko, `Tz`-upright placement) remains authoring work, not import
   fidelity debt that blocks closure.
3. Complete native/browser/website verification, source adjudication,
   independent review, affected/full-escalation checks and exact-candidate CI.

Current branch: `codex/pdfcraft-closure-20261023`, cut from `origin/master` at
`6eebb9581`. No successful publication or merge is confirmed. Preserve this
worktree until validated integration is confirmed on `origin/master`.
