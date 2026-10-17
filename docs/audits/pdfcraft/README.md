# PDFCraft tracker review — audit area

Research and traceability record for the review of the
[PDFCraft issue tracker](https://github.com/storytold/pdfcraft/issues) and the
Varve work derived from it. Companion prose ledger:
[`docs/research/pdfcraft-tracker-ledger-2026-10-16.md`](../../research/pdfcraft-tracker-ledger-2026-10-16.md).

PDFCraft is an unrelated open-source PDF reader/editor written in Rust. Its
tracker is **evidence about a class of failure**, never proof that Varve has the
same defect. Every row below that claims Varve behaviour cites Varve code.

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

Pull requests returned by the issue endpoints were separated from issues.
1,682 PRs were retained as linked evidence; their own discussions (1,113 PRs
with comments, 1,550 comments) were **not** crawled — see Limitations.

## Method

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
| text-edit | 33 | Edits must target authored identity, not inferred grouping (ADR-0242); reproducible cases are adjudicated individually |
| interchange | 32 | No Office interchange surface |
| ocr | 28 | No OCR surface |
| pdf-structure | 23 | No PDF structure-editing surface (Varve writes PDFs; it does not rewrite one) |
| page-geometry | 22 | Page size, rotation, order and count must survive save/reopen/export — verified in the page-geometry job |
| security | 16 | No PDF Standard Security Handler support; `packages/editor/src/archive` AES-GCM is a container mechanism |
| lifecycle-crash | 12 | Graceful capability degradation and termination-path error handling are the transferable classes |
| redaction | 10 | No redaction or sanitize surface; ADR-0242 §6 records the disclosure rule that would apply if one were added |
| fonts-glyphs | 104 | Missing-glyph fallback and substitution parity are the transferable class (batch 2) |
| interaction | 92 | Overlapping overlays and small-window overflow are the transferable classes; both queued, neither assumed |
| other | 613 | No transferable mechanism identified in the report text |

## Batches and status

| Batch | Finding | Status |
|---|---|---|
| 1 | PDF import cannot read a real PDF; mirrored geometry; dropped encodings; merged pages; unreported omissions | **implemented and validated** — `packages/import/src/pdf/`, commit `21f059e8d` |
| 2 | Text that a resolved font cannot cover renders as `.notdef`/blank on canvas, raster export and PDF export with no warning | candidate, verified class-present |
| 3 | Export surfaces minify full-resolution images with browser-default smoothing, and the PDF writer embeds full-resolution data with no `/Interpolate` | candidate, verified partially-present |
| 4 | Blend modes over a transparent backdrop | verified sound; pinning tests queued |
| 5 | Preflight/audit reporting "clean" for artwork the user cannot see | verification in progress |
| 6 | Page rotation, page count and output size surviving save/reopen/export | verification in progress |
| 7 | Text edit identity (paragraph indices, property loss on re-edit) | candidate |
| 8 | Autosave scheduling tied to repaint; failed-autosave retry suppression | deferred — `packages/editor/src/context/usePersistence.ts` is being edited by another session; two writers on one file is worse than a delay |

## Limitations (unresolved)

These are honest gaps, not completions:

1. **Second cutoff not taken.** The tracker grows by roughly 170 records a day.
   Completion requires a reconciliation pass at a later cutoff for issues
   created or materially changed after `2026-10-17T04:41:58Z`. They are not
   covered by this record.
2. **Pull-request discussions not crawled.** 1,113 PRs have comments; only PRs
   referenced by an issue were considered. A fix described in a PR thread is
   therefore evidence this record has not read.
3. **Attachments not retrieved.** 431 body references point at screenshots,
   recordings and reproduction files. Bodies were read as text, so a claim that
   exists only in an image was not assessed.
4. **No PDFCraft runtime reproduction.** No PDFCraft build was installed:
   every PDFCraft-side statement is *reported* or *code-anchored*, never
   reproduced here. Varve-side statements marked `audit` were read from source;
   only batch 1 is `reproduced-in-varve`.
5. **Priority is skewed.** 985 of 1,296 issues carry no priority label, so
   adjudication could not be restricted to a labelled high-severity set; the
   second-pass title scan (69 issues) covers the mechanism-bearing subset but
   not every unlabelled body.
6. **In-flight work is not evidence.** `packages/editor/src/persistence/saveTruthfulness.ts`,
   `packages/scene/src/nodeResize.ts` and other uncommitted files in the shared
   checkout belong to another session. They are referenced as context for
   *which* classes are already being handled, never as proof that a class is
   closed; nothing was marked verified on their strength.
7. **Native/platform surfaces unverified.** No Tauri desktop build was run, so
   print-to-device, WebKitGTK rendering and native export paths are
   source-inspected only.

## Continuation record

Next operations, in order:

1. Take **cutoff 2** (`state=all` reconciliation against the frozen ID set) and
   adjudicate only new or materially changed issues; add them to the ledger
   with a `cutoff2` marker rather than mutating cutoff-1 rows.
2. Land batch 2 (glyph coverage / fallback) after the measurement-parity
   verification returns; the acceptance criteria are in the research ledger.
3. Land batch 3 (export minification quality and `/Interpolate`).
4. Add the batch-4 pinning tests for blend-over-transparent.
5. Close out batches 5–8 or record them as unresolved with reasons.
6. Re-run the affected validation, then `pnpm verify:push` for anything leaving
   the machine.

State at handoff: branch `master`, batch 1 committed as `21f059e8d`; the shared
checkout also carries another session's uncommitted work, which this review did
not touch, stage, or revert.
