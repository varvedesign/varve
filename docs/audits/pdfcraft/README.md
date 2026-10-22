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
| **Cutoff 2 — inventory** | `2026-10-21T19:31:27Z` → `2026-10-21T19:32:05Z`, same endpoint and Link pagination, 40 pages |
| **Cutoff 2 — discussions** | `2026-10-21T19:32:41Z`; the repository-wide comments endpoint returned 5,990 comments, which covers issue *and* pull-request threads (cutoff 1 had crawled issue threads only) |
| Cutoff 2 records | 3,903 (1,790 issues + 2,113 pull requests) |
| Cutoff 2 reconciliation | 1,044 open issues + 843 open PRs = 1,887 = the repository's reported `open_issues_count`; 0 duplicate numbers, 0 failed requests, 0 cutoff-1 issues missing |
| Cutoff 2 delta | **494 new issues** (401 open, 93 closed, numbers 2,981–3,905; 493 with bodies, 487 with comments), 184 cutoff-1 issues closed since, 338 cutoff-1 issues updated since |

Cutoff-2 rows are in [`issue-ledger-cutoff2.tsv`](issue-ledger-cutoff2.tsv) with a
`cutoff2` marker; cutoff-1 rows are never rewritten. Machine-readable totals:
[`issue-ledger-cutoff2.summary.json`](issue-ledger-cutoff2.summary.json).

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

Counts for the 494 cutoff-2 issues: `cluster-assessed` 252 ·
`outside-varve-scope` 164 · `implemented-validated` 50 · `candidate` 10 ·
`verified-already-correct-` 17 · `deferred` 1. The rows named in the batch
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
| 2 | Text that a resolved font cannot cover renders as `.notdef`/blank in PDF export with no warning | **implemented and validated** — `packages/editor/src/export/glyphCoverage.ts`; the canvas already falls back per glyph, so the defect was the silent canvas/PDF disagreement, not a blank canvas. Commit `90f1e01d6`. Extended: the desktop app runs WebKitGTK, not Chromium, so the "canvas falls back per glyph" premise was measured there too — Playwright's WebKit GTK lane renders a CJK run set in an authored Latin-subset family by falling back per glyph, so the canvas is correct on the engine the app embeds and the defect is the PDF writer's, as recorded |
| 3 | Export surfaces minify full-resolution images with browser-default smoothing | **partially confirmed, corrected.** The premise was wrong for the main export path: `paintImageFill` already asks the image cache for a bitmap at the projected draw size (`resizeQuality: 'high'`), so the canvas receives an already-minified bitmap. Measured in Chromium, `'low'` and `'high'` are identical for a 4:1 downscale of a one-pixel checkerboard; they differ (0..255 vs 95..159) for a 3px checkerboard, the scanned-text regime. `applyRasterSmoothingPolicy` is therefore kept as an *explicit* policy for the draws that really scale (group/frame compositing, `renderRaster`, thumbnails) rather than as a fix for a demonstrated visual regression, and `tests/e2e/export/raster-minification.spec.ts` guards the outcome. `/Interpolate` is deliberately not set (reader hint that also smooths upscaled artwork; no size benefit). Commit `3ed8e6a03`, corrected in the review pass |
| 4 | Blend modes over a transparent backdrop | **verified sound and pinned** — every separable mode over alpha 0, the transparent-source direction, and the opaque-white-matte contrast case. Commit `3bfe7c04b` |
| 5 | Preflight/audit reporting "clean" for artwork the user cannot see | verified at the rule level: no Varve preflight result may read as a completeness guarantee the check does not provide (ADR-0242 §6). No Varve check was found that reports a false clean for imported content, because hidden content is no longer imported (batch 9) |
| 6 | Page rotation, page count and output size surviving save/reopen/export | **verified for save/reopen** — Varve's page-rotation model is per-page width/height, and a mixed-orientation document round-trips with order and node positions intact (commit `340262b60`). Export page geometry is the native writer's contract and is covered by `tests/e2e/export/native-pdf-contract.spec.ts`, not by a browser unit test |
| 7 | Text edit identity (paragraph indices, property loss on re-edit) | already handled upstream: edits target authored node ids (ADR-0242), and the draft/target-switch paths are covered by `context/pendingEdits.ts` with `tests/e2e/save/text-draft-save.spec.ts` and `text-target-switch.spec.ts` |
| 8 | Interaction classes: cursor over chrome following the canvas, a second menu open on the first, a panel clipped in a small window | **verified absent and pinned** — `tests/e2e/ui/chrome-ownership.spec.ts`: the hand-tool cursor does not leak onto the menubar, opening a second menu leaves exactly one, and at 1024x600 the inspector has no horizontal overflow and the Export tab stays reachable through the "More inspector tabs" menu. No UI change was needed |
| 8b | Autosave scheduling tied to repaint; failed-autosave retry suppression | deferred — `packages/editor/src/context/usePersistence.ts` belongs to another session; two writers on one file is worse than a delay |
| 10 | Vertical writing (`Identity-V`) imported as one horizontal line, so a CJK column became the wrong document | **implemented and validated** — `/WMode 1` (name or embedded CMap) is detected and the run becomes a `vertical-rl` text node; unit tests cover detection and the browser test asserts the rendered ink is a column. Per-glyph `/W2` metrics and one-glyph-per-`Tj` column merging follow in batch 11. Commit `codex/pdfcraft-remainder-20261022` |
| 11 | Vertical import refinement: per-glyph `/W2` metrics, one-glyph-per-`Tj` placement arriving as one layer per character, and parser notes that were generated but never shown | **implemented and validated** — `/W2` advances with a bounded `/DW2` fallback, consecutive vertical runs merge into one editable column, Import Results shows the parser's notes and wraps long detail rows, and deeply nested SVG now names the artwork it refused (row 3309). Unit and browser regressions extend batch 10's fixture; evidence in `docs/screenshots/pdfcraft/import-vertical-writing-*.png` |
| 9 | PDF import invents content the page does not show: invisible/clip-only text, hidden optional-content layers, encrypted files imported as blank pages, and an inline image whose `EI` is followed by a delimiter | **implemented and validated** — `/OCProperties` visibility, `Tr` render modes, `/Encrypt` refusal with a failure status, and delimiter-terminated `EI`. Commits `3bdd3e336`, `bb2f53d24`; browser evidence in `tests/e2e/import/pdf-import-integrity.spec.ts` and `docs/screenshots/pdfcraft/` |

## Limitations (unresolved)

These are honest gaps, not completions:

1. **Cutoff 2 is the final corpus boundary for this pass.** 494 new issues and
   184 closures were adjudicated through `2026-10-21T19:32:41Z`. The tracker
   grows by roughly 170 records a day; anything created after cutoff 2 is a
   follow-on queue, not part of this coverage claim.
2. **Attachments not retrieved.** Body references point at screenshots,
   recordings and reproduction files. Bodies, labels, states and discussion
   text were read; a claim that exists only inside an image was not assessed.
3. **No PDFCraft runtime reproduction.** No PDFCraft build was installed:
   every PDFCraft-side statement is *reported* or *code-anchored*, never
   reproduced here. Varve-side statements marked `audit` were read from source;
   batches 1, 2, 3, 4, 6 and 9 are `reproduced-in-varve` (unit or browser
   evidence).
4. **Priority is skewed.** Most issues carry no priority label, so adjudication
   could not be restricted to a labelled high-severity set. Cutoff 2 read every
   title and label, and adjudicated individually every row whose title stated a
   mechanism in a class Varve has.
5. **Native/platform surfaces unverified.** No Tauri desktop build was run, so
   print-to-device, WebKitGTK rendering, the native PDF writer's `/Interpolate`
   decision and platform-specific pointer behaviour are source-inspected only.
6. **Vertical writing is a recorded gap.** Identity-V (`-v`) text is imported
   as horizontal runs (rows 3216, 3711, 3712). Varve authors vertical text, so
   this is a real import limitation, not an exclusion; it is queued rather than
   implemented.
7. **Two candidates are deferred, not closed.** The native atomic-save close
   error path (`3409`) and autosave scheduling (`batch 8`) live in files owned
   by another session in the shared checkout.

## Continuation record

Cutoff 2 is taken and reconciled; batches 1–6 and 9 are complete or recorded
with reasons. What remains, in priority order:

1. ~~Vertical-writing import (rows 3216/3711/3712)~~ — landed as batches 10
   and 11. `/W2` metrics and one-glyph-per-`Tj` column merging are
   implemented; `Tz`-upright placement inside a vertical run remains open.
2. **Batch 8 (interaction)**: verify cursor ownership over chrome (rows 3001,
   3383, 3871), overlay placement with two menus (3190), and small-window
   clipping (3097, 3557, 3559). Each is a verification first; no UI change is
   assumed.
3. **Row 3409 / batch 8 save paths**: land once the owning session releases
   `usePersistence.ts` and the native save path.
4. **Row 3309**: the decoder was measured on a 5,000-level nested-group document
   and returns `ok` without throwing — `normalizeDocument` walks nodes flatly, so
   the reported stack overflow is not reachable at the decode boundary. What is
   still unmeasured is a render/bbox traversal at that depth; if a bound is added
   it belongs there, driven by a measured failure rather than a guess. The
   reachable import paths are bounded (SVG/Figma 256, PDF page tree 32) and the
   SVG ceiling now names refused artwork instead of importing nothing silently.
5. **Row 3634/3504**: a per-node export deadline and a single decode-cap
   contract shared by render and export, if measurement shows they diverge.

State at handoff: branch `codex/pdfcraft-continuation-20261021`, cut from
`origin/master` at `2e8c5b018`, with the cutoff-1 batch cherry-picked onto it so
the review is reviewable without the unpushed local history. Commits: batch 9
`3bdd3e336`, batch 2 `90f1e01d6`, batch 3 `3ed8e6a03`, batch 4 `3bfe7c04b`,
batch 6 `340262b60`, refusal reporting `bb2f53d24`.

## Continuation record — batch 11 (2026-10-22)

Branch `codex/pdfcraft-batch7`, worktree `.worktrees/pdfcraft-b7`, cut from
`origin/master` at `13e97dde3` (which already contained batch 10's vertical
writing fix). This batch is the refinement batch 10 deferred, plus two
honesty fixes found while validating it.

**What changed**

- `/W2` per-glyph vertical metrics are read from the descendant CIDFont, with
  the documented `/DW2` one-em default and a ten-em ceiling against hostile
  values. Batch 10 advanced every vertical glyph one em and disclosed that;
  the disclosure is no longer needed because the published metric is used.
- Consecutive vertical runs merge into one editable column when they share the
  font and size, start where the previous pen stopped (quarter-em tolerance),
  and keep the same direction. One-glyph-per-`Tj` placement no longer produces
  one layer per character. A run that starts a new column stays separate.
- Runs carry their display-space displacement (`advanceX/advanceY`), so
  continuity is measured in display space rather than assuming an unrotated
  page.
- Import Results now shows the parser's capability notes when details are
  expanded. The notes (vertical columns, page rotation applied, crop box used,
  outside-page runs) were generated but never displayed. The file row now
  wraps with full-basis detail rows instead of squeezing capabilities,
  warnings and notes into three side-by-side slivers.
- An SVG nested deeper than the 256-level parser ceiling now names the refused
  artwork. Before, it imported zero nodes and reported no warning.

**Evidence**

- `packages/import/src/pdfFidelity.test.ts`: 29 tests, including the merged
  one-glyph column, a neighbouring column that stays separate, and a fixture
  where a published half-em `/W2` advance is what joins two runs (the same
  file without `/W2` leaves them apart).
- `tests/e2e/import/pdf-vertical-text.spec.ts`: two real File > Import runs.
  The first keeps batch 10's column-vs-line ink assertion. The second imports
  two columns, one written as a single `Tj` and one as six `Tj` operators,
  asserts 2 layers (not 7) and reads Writing mode from the Inspector. It also
  asserts the Import Results note "7 vertical text run(s) were imported as 2
  vertical column(s)".
- `packages/import/src/svg.test.ts`: 31 tests; the new disclosure regression
  fails without the warning and a 250-level document still imports.
- Visual: `docs/screenshots/pdfcraft/import-vertical-writing-canvas.png`
  shows 縦書きの試験, 隣の列の文章 (one glyph per operator) and 離れた列 as three
  top-to-bottom columns with no overlap; the editor capture shows the
  Inspector reading Vertical, right to left and Mixed; the results capture
  shows the wrapped details and the column note.

**Validation (batch 11)**

```text
Changed scope: packages/import PDF/SVG parsers and tests; packages/editor ImportResults and test; tests/e2e/import; website file-formats and typography docs plus the marketing test; PDFCraft audit records and screenshots.
Validation plan: pnpm verify:plan selected 27 lanes with no full-suite escalation (format/lint, emoji/docs/claims/radius/spacing/sizing audits, E2E TypeScript, affected package typechecks and unit lanes, website unit/E2E, import and export browser domains).
Commands actually run: pnpm verify:affected; pnpm typecheck:e2e; pnpm audit:docs; pnpm audit:emoji; lease-wrapped npx playwright test tests/e2e/import/pdf-vertical-text.spec.ts; production website captures at 1440x1000 and 390x844.
Passed: all 27 planned lanes (2681s): editor unit 8,825 passed (2 skipped), import 430, desktop 90, website unit 312, website E2E 694 across both bases, import browser domain 12, export browser domain 16, focused vertical browser test 2; focused pdfFidelity 29, svg 31, ImportResults 15; E2E TypeScript; docs/emoji audits; no horizontal overflow at 1440/390/320.
Skipped as unrelated: Rust workspace and native desktop GUI lanes (no Rust or native surface changed); the planner did not escalate.
Escalations: none. Full suite run: no.
```
This run was executed on the batch-11 tree after rebasing onto the batch-10
commit `13e97dde3`.

**Limitations of this batch**

- Automatic tate-chu-yoko compaction and `Tz`-upright placement are not
  inferred from a PDF. Glyphs and digits are preserved in one editable string;
  applying `textCombineUpright` or adjusting orientation remains an authoring
  decision.
- Page `/Rotate` is applied to positions, as for horizontal text, so on a
  rotated page a vertical column is placed correctly but its glyphs are not
  rotated with the page. That general text-rotation gap is unchanged.
- Imported text colour, font family and glyph outlines are still not carried;
  the importer reports substitution.

**Remaining queue (not closed by this batch)**

1. Row 3409 and the autosave scheduling work (batch 8b) stay with the session
   that owns `usePersistence.ts` and the native save path.
2. Row 3504: shared decode-cap contract, test queued.
3. Row 3634: per-node export deadline, queued pending measurement.
4. Issues created after cutoff 2 (`2026-10-21T19:32:41Z`) are a follow-on
   queue and are not part of this coverage claim.
Batch 8's interaction classes were verified and pinned separately
(`tests/e2e/ui/chrome-ownership.spec.ts`), so that queue item is closed.

