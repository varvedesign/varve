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

Counts for the 494 cutoff-2 issues: `cluster-assessed` 254 ·
`outside-varve-scope` 165 · `implemented-validated` 50 · `candidate` 14 ·
`verified-already-correct-` 10 · `deferred` 1. 96 of those rows are
individually adjudicated (title, labels, body, and the discussion where it
changed the reading); the rest inherit a cluster verdict with a stated reason.
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
| 2 | Text that a resolved font cannot cover renders as `.notdef`/blank in PDF export with no warning | **implemented and validated** — `packages/editor/src/export/glyphCoverage.ts`; the canvas already falls back per glyph, so the defect was the silent canvas/PDF disagreement, not a blank canvas. Commit `90f1e01d6` |
| 3 | Export surfaces minify full-resolution images with browser-default smoothing | **partially confirmed, corrected.** The premise was wrong for the main export path: `paintImageFill` already asks the image cache for a bitmap at the projected draw size (`resizeQuality: 'high'`), so the canvas receives an already-minified bitmap. Measured in Chromium, `'low'` and `'high'` are identical for a 4:1 downscale of a one-pixel checkerboard; they differ (0..255 vs 95..159) for a 3px checkerboard, the scanned-text regime. `applyRasterSmoothingPolicy` is therefore kept as an *explicit* policy for the draws that really scale (group/frame compositing, `renderRaster`, thumbnails) rather than as a fix for a demonstrated visual regression, and `tests/e2e/export/raster-minification.spec.ts` guards the outcome. `/Interpolate` is deliberately not set (reader hint that also smooths upscaled artwork; no size benefit). Commit `3ed8e6a03`, corrected in the review pass |
| 4 | Blend modes over a transparent backdrop | **verified sound and pinned** — every separable mode over alpha 0, the transparent-source direction, and the opaque-white-matte contrast case. Commit `3bfe7c04b` |
| 5 | Preflight/audit reporting "clean" for artwork the user cannot see | verified at the rule level: no Varve preflight result may read as a completeness guarantee the check does not provide (ADR-0242 §6). No Varve check was found that reports a false clean for imported content, because hidden content is no longer imported (batch 9) |
| 6 | Page rotation, page count and output size surviving save/reopen/export | **verified for save/reopen** — Varve's page-rotation model is per-page width/height, and a mixed-orientation document round-trips with order and node positions intact (commit `340262b60`). Export page geometry is the native writer's contract and is covered by `tests/e2e/export/native-pdf-contract.spec.ts`, not by a browser unit test |
| 7 | Text edit identity (paragraph indices, property loss on re-edit) | already handled upstream: edits target authored node ids (ADR-0242), and the draft/target-switch paths are covered by `context/pendingEdits.ts` with `tests/e2e/save/text-draft-save.spec.ts` and `text-target-switch.spec.ts` |
| 8 | Autosave scheduling tied to repaint; failed-autosave retry suppression | deferred — `packages/editor/src/context/usePersistence.ts` belongs to another session; two writers on one file is worse than a delay |
| 9 | PDF import invents content the page does not show: invisible/clip-only text, hidden optional-content layers, encrypted files imported as blank pages, and an inline image whose `EI` is followed by a delimiter | **implemented and validated** — `/OCProperties` visibility, `Tr` render modes, `/Encrypt` refusal with a failure status, and delimiter-terminated `EI`. Commits `3bdd3e336`, `bb2f53d24`; browser evidence in `tests/e2e/import/pdf-import-integrity.spec.ts` and `docs/screenshots/pdfcraft/` |
| 10 | Vertical-writing text (`/Identity-V`, `/WMode 1`) was read as horizontal rows, and one-glyph-per-`Tj` placement became one object per character (rows 3216, 3711, 3712). Separately, a document deeper than the 256-level SVG cap imported nothing without saying so (row 3309) | **implemented and validated** — codes advance down the column, consecutive column runs merge into one `vertical-rl`/`upright` text node, and the Import Results details now show the parser's notes and wrap long detail rows. The SVG cap reports refused artwork instead of returning an empty import. Unit regressions in `packages/import/src/pdfFidelity.test.ts` and `svg.test.ts`; browser evidence in `tests/e2e/import/pdf-vertical-writing.spec.ts` and `docs/screenshots/pdfcraft/import-vertical-writing-*.png` |

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
   batches 1, 2, 3, 4, 6, 9 and 10 are `reproduced-in-varve` (unit or browser
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

1. **Vertical-writing import** (rows 3216/3711/3712): map `Identity-V` runs and
   `Tz`-upright placement into Varve's vertical text model, with a round-trip
   test. This is the largest remaining fidelity gap found in the corpus.
2. **Batch 8 (interaction)**: verify cursor ownership over chrome (rows 3001,
   3383, 3871), overlay placement with two menus (3190), and small-window
   clipping (3097, 3557, 3559). Each is a verification first; no UI change is
   assumed.
3. **Row 3409 / batch 8 save paths**: land once the owning session releases
   `usePersistence.ts` and the native save path.
4. **Row 3309**: add a bounded-depth guard to scene traversal for deeply nested
   imported groups, with a fixture that would otherwise recurse without bound.
5. **Row 3634/3504**: a per-node export deadline and a single decode-cap
   contract shared by render and export, if measurement shows they diverge.

State at handoff: branch `codex/pdfcraft-continuation-20261021`, cut from
`origin/master` at `2e8c5b018`, with the cutoff-1 batch cherry-picked onto it so
the review is reviewable without the unpushed local history. Commits: batch 9
`3bdd3e336`, batch 2 `90f1e01d6`, batch 3 `3ed8e6a03`, batch 4 `3bfe7c04b`,
batch 6 `340262b60`, refusal reporting `bb2f53d24`.

## Continuation record — batch 10 (2026-10-22)

Branch `codex/pdfcraft-batch7`, worktree `.worktrees/pdfcraft-b7`, cut from
`origin/master` at `a2d6a2276`. The batch closes the vertical-writing gap
(rows 3216 critical, 3711 medium, 3712 high) and resolves row 3309 critical
by verification plus a disclosure fix.

**What changed**

- `packages/import/src/pdf/encoding.ts` reads the writing mode from the
  `/Encoding` name (`/Identity-V`, `*-V`) or an embedded CMap's `/WMode 1`,
  and exposes the downward advance from `/W2` with the `/DW2` default
  (`[880 -1000]`, one em) bounded to ten ems.
- `contentInterpreter.ts` advances the text matrix down the column for a
  vertical font: per-code advances, `TJ` adjustments, UTF-16 strings, and
  character spacing. Word spaces are still only inserted for horizontal runs,
  because a gap inside a column is letter spacing.
- Each run carries its display-space displacement (`advanceX/advanceY`), so a
  `/Rotate` page does not turn "down the column" into a fixed axis.
- `index.ts` merges consecutive vertical runs that continue the same column
  (same font and size, next run starts where the previous pen stopped, same
  direction) into one `vertical-rl` / `mixed` text node. The node is centred
  on the PDF's vertical baseline (0.475 em displacement, 1.2 line-height
  column). Neighbouring columns stay separate nodes.
- `ImportResults` now shows the parser's capability notes when details are
  expanded (96 px of dead notes before: the vertical note, page rotation,
  crop-box use and outside-page counts were generated but never displayed),
  and the file row wraps so warnings and notes use the dialog's width instead
  of being squeezed into three side-by-side slivers.
- `svg.ts` discloses artwork refused by the 256-level nesting ceiling. Before,
  a 300-level SVG imported zero nodes with no warning.

**Evidence**

- Fail-first: with the four PDF importer files reverted, the two new
  vertical-writing unit tests fail (`8` runs / `3` columns expected, horizontal
  runs received); they pass with the change. The SVG disclosure test fails
  against the previous `svg.ts` because the warning list was empty.
- `packages/import` suite 425 tests pass; `svg.test.ts` 31 pass; focused
  `pdfFidelity.test.ts` 26 pass; `ImportResults.test.tsx` 15 pass.
- Website copy checked in the built production page at 1440x1000 and 390x844:
  the PDF section names vertical import, the Import Results note sentence is
  present, there is no horizontal overflow at 1440/390/320, and the mobile
  single-column layout is readable
  (`docs/screenshots/pdfcraft/import-file-formats-pdf-desktop.png`,
  `import-file-formats-pdf-mobile.png`,
  `import-typography-vertical-desktop.png`,
  `import-typography-vertical-mobile.png`).
- Real File > Import run (Chromium, 1440x1000, TypeScript renderer fallback):
  three columns import as three layers, the Inspector reads Writing mode
  "Vertical, right to left" and Vertical orientation "Mixed", and the canvas
  paints 縦書きの試験 (x=500), 隣の列の文章 (x=470, one glyph per `Tj`) and
  離れた列 (x=300) top-to-bottom with no overlap
  (`docs/screenshots/pdfcraft/import-vertical-writing-canvas.png`). The Import
  Results capture shows the wrapped warning list and the note
  "8 vertical text run(s) were imported as 3 vertical column(s)"
  (`import-vertical-writing-results.png`).
- Row 3309 verification: SVG nesting capped at 256 (`svg/shared.ts`), Figma
  source/native at 256, PDF page tree at 32; `validateDocument` and
  `findParentCycle` walk iteratively with visited/depth bounds; PdfCraft's
  name-tree prune edits PDF structures Varve does not rewrite. The cap is now
  disclosed, and the new tests pin both the refusal and a 250-level import.

**Validation (batch 10)**

```text
Changed scope: packages/import (PDF importer, SVG parser + tests); packages/editor ImportResults + test; tests/e2e/import; website file-formats and typography docs + marketing test; PDFCraft audit records and screenshots.
Validation plan: pnpm verify:plan selected 46 lanes with no full-suite escalation (format/lint, emoji/docs/claims/radius/spacing/sizing audits, E2E TypeScript, every package typecheck and unit lane, website unit/E2E, import and export browser domains).
Commands actually run: pnpm verify:affected; pnpm typecheck:e2e; pnpm audit:docs; pnpm audit:emoji; lease-wrapped npx playwright test tests/e2e/import/pdf-vertical-writing.spec.ts; production website screenshots at 1440x1000 and 390x844.
Passed: all 46 planned lanes (2703s), including the 8,782-test editor unit lane, import 425, desktop, website unit 311, website E2E 690 across both site bases, e2e:import and e2e:export; focused pdfFidelity 26, svg 31, ImportResults 15; E2E TypeScript; docs/emoji audits; no horizontal overflow at 1440/390/320.
Skipped as unrelated: Rust workspace tests and native desktop GUI lanes (no Rust or native surface changed); the planner did not escalate.
Escalations: none. Full suite run: no.
```
The two new PDF regressions were also run against the previous importer
files and failed there (8 horizontal runs instead of 3 columns); the SVG
disclosure regression fails without the warning.

**Limitations of this batch**

- Automatic tate-chu-yoko compaction is not inferred from a PDF. The glyphs
  and digits are preserved in one editable string; applying
  `textCombineUpright` remains an authoring decision.
- Page `/Rotate` is applied to positions, as it already was for horizontal
  text, so on a rotated page a vertical column is placed correctly but its
  glyph orientation is not rotated with the page. That general text-rotation
  gap is unchanged by this batch and is not claimed as solved.
- Imported text colour, font family and glyph outlines are still not carried;
  the importer reports substitution. Unchanged by this batch.

**Remaining queue (unchanged, not closed)**

1. Batch 8 interaction verification: cursor ownership over chrome (3001,
   3383, 3871), two overlapping menus (3190), small-window clipping (3097,
   3557, 3559).
2. Row 3409 / batch 8 save paths: still owned by the session working in
   `usePersistence.ts` and the native save path in the shared checkout.
3. Row 3504: shared decode-cap contract, test queued.
4. Row 3634: per-node export deadline, queued pending measurement.
5. Follow-on queue: issues created after cutoff 2
   (`2026-10-21T19:32:41Z`) are recorded separately and are not part of this
   coverage claim.

