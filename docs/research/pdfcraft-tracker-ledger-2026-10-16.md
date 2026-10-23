# PDFCraft tracker ledger — 2026-10-16

Research inputs for Varve hardening, mined from a sibling project's defect
tracker. Source tracker:
[storytold/pdfcraft](https://github.com/storytold/pdfcraft/issues) — a Rust +
Tauri PDF reader/editor ("written from scratch in pure Rust") that shares
Varve's architectural family: Tauri shell, native engine, canvas compositor
with GPU and CPU paths, layered document model, undo/history, text engine,
export/import interchange.

Issues were read through the GitHub REST API (authenticated `gh`) on
2026-10-17T04:41:02Z→05:00:00Z UTC. The full set was captured with bodies and
labels (**1,296 issues** across open/duplicate/rejected/historical reports,
plus 1,682 pull requests retained as linked evidence), and every one of the 883
issues carrying comments had its discussion fetched (1,717 comments).

**Cutoff 2** re-crawled the whole tracker on 2026-10-21T19:31:27Z→19:32:41Z:
3,903 records (1,790 issues, 2,113 pull requests), 494 new issues, 184
closures, and 5,990 comments including pull-request threads. Its findings and
the decisions they changed are in the [Cutoff 2](#cutoff-2--2026-10-21) section
at the end of this document.
Inventory, coverage accounting, cluster verdicts and the machine-readable
per-issue ledger live in [`docs/audits/pdfcraft/`](../audits/pdfcraft/README.md)
(`issue-ledger.tsv`).

**Evidence levels below**: *report* (user claim only), *code-anchored* (the
reporter cites source), *reproduced* (an executable/minimal repro accompanies
it), *audit* (source-inspected here), *reproduced-in-varve* (observed here),
*fixed* (implemented here with tests). No PDFCraft build was installed, so no
PDFCraft-side item is more than *code-anchored* here.

## Tracker-shape observations

These hold across the whole backlog and are independent of any single issue.

1. **Missing glyph coverage is the largest transferable family, and it is an
   asymmetry the maintainers already fixed once.** Reports of tofu boxes /
   blank text for Chinese, Korean, Hebrew, Thai and Telugu arrive from the UI
   (`#826`, `#381`, `#500`, `#1047`, `#499`, `#688`, `#728`, `#984`, `#1256`,
   `#1444`), from document content without an embedded font (`#234`, `#2800`),
   from text entry (`#2918`, `#1821`), from Cyrillic standard-14 substitution
   (`#2908`), from a fallback face that has no glyph for the character it was
   chosen for (`#2440`), and from a rejected embedded font program (`#2946`).
   Their own fix history shows the shape: the same "boxes in canvas and
   exported PNG" class was fixed **for emoji only** and documented as such
   (Varve's analogue is `packages/engine/src/canvasFontAliases.ts`), leaving
   every other script on the same code path.
2. **Minification quality recurs as "one surface is quality-aware, its sibling
   is not".** `#2393` measures nearest-neighbour shrinkage of scans against a
   Lanczos reference (mean absolute difference 4.17 at 61 dpi vs Poppler);
   `#1700` reports Type 3 image-mask glyphs "pixels are picked, not averaged";
   `#2196` reports scans that blur on every zoom; `#350`, `#730`, `#1649`
   report blurry text rendering; `#2177` is an audit of resample-dimension
   overflow. Five separate reporters, one mechanism.
3. **Silent partial results recur across save, audit and export.** A full save
   that makes pages unreadable while reporting success (`#2366`), an unreadable
   `/Kids` entry that drops everything after it with no warning (`#2660`), a
   full rewrite that fails its own reopen check and still replaces the file
   (`#1698`), an image export that drops masks it cannot decode (`#1814`), a
   document-creation path that drops an embedded ICC profile (`#666`), a
   flatten that removes a comment without drawing it (`#1317`), and an audit
   that reports "clean" for text hidden under a white rectangle (`#2385`). The
   common failure is *a result presented as complete when part of it is
   missing*.
4. **Edit-by-index is a distinct data-loss class.** `#2516` (paragraph numbers
   shift after an edit, so the next edit by number rewrites a different
   paragraph), `#2517` (paragraphs separated by a blank line are one paragraph;
   editing the first deletes the second), `#2564` (a bulleted item's second row
   groups with the next items; editing deletes them), `#1756` (an inferred
   `text_paragraphs` group wipes a watermark when edited), `#1680` (two table
   cells merge into one paragraph). Three are labelled `priority: critical`.
5. **Their own corpus method is worth copying.** `#2458` is a 350-file
   real-world run that checks open, text-vs-`pdftotext`, page-1 render
   vs-`pdftoppm`, save and extract round trips **through independent readers**
   (`qpdf`, `pypdf`). Varve's equivalent discipline is
   `scripts/validate-pdf.sh` plus independent-reader verification.
6. **The tracker's severity labels do not identify the transferable set.** 985
   of 1,296 issues carry no priority label, and 115 are labelled `duplicate` or
   `multiple issues`; the unit of transfer is the failure class, not the issue
   or its label.

## Ledger

| Source | Status / evidence | Bounded failure | Transferable lesson for Varve | Decision |
|---|---|---|---|---|
| pdfcraft #2426, #2485, #524 | open, *reproduced* | Accented text is skipped on extraction and arrives as `?` after OCR copy; letters are dropped | A PDF string is a sequence of character *codes*: the bytes mean nothing until the font encoding resolves them | **Varve finding confirmed (same class).** The importer decoded the file as UTF-8 text and read `(…)` bodies literally: no escape handling, no `/ToUnicode`, no `/Differences`, no hex strings, no UTF-16BE BOM. **Fixed** in `packages/import/src/pdf/encoding.ts` (batch 1) with fixtures for octal escapes, `/WinAnsiEncoding`, hex + BOM and a `/ToUnicode` CMap |
| pdfcraft #2456 | open, *code-anchored* | "After an inline image, a byte above 0x7F followed by a later `EI` hides the rest of the page (nothing drawn, no text)" | Inline image data is opaque: it can contain anything, including byte sequences that look like operators | **Varve finding confirmed (same class).** The old scanner regex-matched `BT…ET` across the whole file, so it could match inside image data. **Fixed** in `batch 1`: the tokenizer skips `BI … ID <data> EI` as opaque bytes (`packages/import/src/pdf/content.ts`), with a regression test whose image body contains `(injected) Tj ET` and a `0xFF` byte |
| pdfcraft #2919, #2660, #2722 | open, *reproduced* | A multipage PDF shows one page; one unreadable `/Kids` or `/Contents` entry silently drops every following page (3 of 6 shown, no warning) | Page membership, order and count come from the page tree; a page that cannot be read is a *reported* outcome, not an empty page | **Varve finding confirmed (same class).** The importer merged every page's text into one page, with no page-tree walk at all. **Fixed** in batch 1: `/Kids` order, inherited `/MediaBox`/`/Rotate`/`/Resources`, crop box where it differs, one Varve page per PDF page (bounded at 50, the remainder named), and undecodable content streams counted and reported |
| pdfcraft #2516, #2517, #2564, #1756, #1680 | open, 3 × *priority: critical*, *reproduced* | Editing a paragraph *by index* rewrites a different paragraph, or deletes the neighbouring one, after an earlier edit shifts the numbering | Inferred grouping is not mutation ownership: an edit must target an authored identity, never a heuristic index | Rule adopted as an architectural invariant; **correction (cutoff 3): the
`docs/adr/0242-document-authority-and-interchange.md` cited by this record does
not exist in the repository at this revision.** The invariant is enforced in
code and tests (`packages/editor/src/context/pendingEdits.ts`,
`tests/e2e/save/text-target-switch.spec.ts`), and the broken citation is
recorded in [`../audits/pdfcraft/CLOSURE.md`](../audits/pdfcraft/CLOSURE.md). **Varve verification queued (batch 7)**: confirm every text command resolves authored ids rather than paragraph ordinals |
| pdfcraft #2474, #2800, #2908, #2440, #2946, #826 family | open, *reproduced* (CJK on Arch Linux with Noto installed; #2946 byte-swapped `post` table) | Text whose resolved face lacks the script renders as `.notdef` boxes or blank; a rejected font program silently falls back | A glyph the face cannot cover must not be painted as `.notdef`, and must be *reported* where the user decides | **Varve finding confirmed (same class), *audit*.** `packages/engine/src/replay.ts` builds the canvas font shorthand with **emoji-only** fallbacks (`replayFontString` + `withEmojiFallback`); `packages/engine/src/canvasFontAliases.ts` documents that exact "boxes in canvas and exported PNG" class and its emoji-only fix. `fontResolver.findMissingGlyphs` and its `missing-glyph` status exist but are consumed only by the font browser; `exportService.collectMissingFontWarnings` is family-level only; `crates/varve-print/src/shaper.rs` computes `missing_glyph_indices` and is dead code on the export path, while `lib.rs:3224-3253` substitutes a **filled rectangle** for a run it cannot encode. **Batch 2** |
| pdfcraft #2393, #1700, #2196, #350, #730, #1649 | open, *reproduced* (with measured numbers) | Images drawn smaller than their resolution are sampled by picking pixels instead of averaging, so scanned text gets ragged stems that vanish at fit-to-window zoom | A minifying draw must be quality-aware on **every** surface, not only the interactive one | **Varve finding confirmed (partial), *audit*.** Interactive rendering is quality-aware on both implementations (`imageSmoothingQuality:'high'` on the Canvas2D compositor and the render worker, plus at-size `createImageBitmap(… resizeQuality:'high')` decode through `adaptiveResidency`/`warpReplay`). The export family is not: `exportNodeAsRaster` (`packages/editor/src/components/SpecPanel/export.ts`) never sets smoothing and passes no image policy, `packages/engine/src/raster.ts` has the same default, and `crates/varve-print/src/lib.rs` embeds full-resolution RGBA with no `/Interpolate`. Varve already owns the correct kernels (`packages/engine/src/exportPipeline/resample.ts` — area ≤50 %, lanczos2/3). **Batch 3** |
| pdfcraft #2970 | open, *reproduced* (a regression against their own 0.7.1) | A separable blend mode over an area where nothing has been drawn yet blends with white paper: `Screen` green comes out white, `Difference` comes out magenta | A transparent backdrop is not white: blend over alpha 0 must yield the source colour | **Already correct in Varve, *audit*.** `packages/engine/src/blendModes.ts:371` short-circuits `if (ba === 0) return [source…]` for exactly this case; `replayIr` fills nothing (`packages/engine/src/replay.ts`), raster export starts transparent (`SpecPanel/export.ts:469-483`) and discloses the white matte it adds for opaque formats, the raster-PDF fallback preserves `/SMask` (`rasterPdf.ts`), any non-normal blend forces the raster path before the native writer, and `crates/varve-print` emits opacity `ExtGState` but never `/BM`. The one near-white backdrop is the intended pasteboard, deliberately authoritative and documented in `packages/editor/src/render/sceneCompositing.ts`. **Pinning tests queued (batch 4)** |
| pdfcraft #2366, #1698, #2367, #2365 | open, *reproduced* | A full save reports success while making pages unreadable; a rewrite that fails its own reopen check still replaces the file; outlines, page labels and Info fields are dropped | "Saved" must mean *reopened and verified*; a save-path change proves itself with a reopen test | Already a Varve rule (`docs/plans/document-workflows-plan-2026-10-15.md`: every save-path change adds a reopen test). **Not verified here**: save truthfulness is being edited by another session in the shared checkout (`packages/editor/src/persistence/saveTruthfulness.ts`, uncommitted). Recorded as *context*, not as evidence that the class is closed |
| pdfcraft #2663, #815, #1803 | open, *code-anchored* | Autosave runs only when the window repaints, so an idle window never writes the recovery snapshot; a fresh unsaved document is skipped; a failed autosave suppresses retries for that generation | Recovery cadence must be owned by a timer and a data-generation change, not by rendering | **Deferred, not dismissed.** `packages/editor/src/context/usePersistence.ts` carries another session's uncommitted edits; two writers on one file were judged worse than a delay (see the audit-area continuation record) |
| pdfcraft #2658 | open, *reproduced* | Read-only files are overwritten without warning; Finder tags/xattrs are dropped; hard links break; a dangling symlink is replaced | Filename and metadata fidelity are part of the save contract | **Already covered, *audit*.** `docs/architecture/filesystem-boundary.md:82-103`: app-generated temp names, no `to_string_lossy()` on the target, host-native atomic replace, a `READ_ONLY` failure category; residual xattr/hard-link edges are recorded there |
| pdfcraft #2385, #2786, #2787, #2662 | open, *reproduced* | An audit reports `count: 0` and exit 0 for text hidden under a thick stroke, a black highlight annotation or a **white** filled rectangle, while the text stays extractable; a cover in a second content stream or a filled annotation is likewise reported clean | A "clean" result must be scoped to what was actually checked; a false clean is worse than no check | **Varve verification in progress (batch 5).** The rule recorded regardless of the outcome: no Varve preflight result may read as a completeness guarantee the check does not provide |
| pdfcraft #2674, #2651, #1103, #1855 | open, *reproduced* | A page rotation is not persisted after a reported-successful operation; printing always uses A4 regardless of the document's page size | A per-page property must survive the round trip, and the output medium must not silently replace it | **Varve verification in progress (batch 6).** Note `#2651` cannot transfer literally: Varve has no device-printing workflow (`printPdf`/`listPrinters` have no caller), so the class lands on *export* page geometry and labels |
| pdfcraft #2637, #1852 | open, *reproduced* | Overlapping context menus on a small image make the previous menu unusable; a preferences dialog is clipped in a small window with no scrollbars | Overlay placement and small-window layout are correctness, not polish | Queued (batch 8 candidate). Varve has a documented popover contract (`docs/architecture/popover-system.md`) and responsive panels, so this is a verification against that contract before any UI change |
| pdfcraft #2916, #2918, #2470, #2695 | open, *reproduced* | The app refuses to launch on a specific GPU ("Fatal Error: HW capability"); text entry rejects Japanese because of a Windows-1252 restriction; the app crashes on close | Capability must degrade per stage, and a termination path must survive its own finalization errors | Queued candidates: ADR-0237 already defines staged accelerator capability (discovered → runtime-loadable → device-usable → execution-verified) — verify a mid-session failure does not collapse the stage; `#2918` is already answered in Varve by outlined export for non-WinAnsi runs |
| pdfcraft #2458 | open, *reproduced* | A 350-file real-world corpus run against one release, checking open, text, render, save and extract round trips with independent readers | Self-verification through the authoring app is not verification | Adopted as method: Varve's PDF claims are checked through independent readers (`scripts/validate-pdf.sh`, `qpdf`), and batch 1's fixtures are byte-exact rather than round-tripped through Varve |
| pdfcraft #2380, #2447, #2448, #2659, #2874, #2818, #2956 | open (closed: #2380), *code-anchored* | Redaction removes the operator but leaves the data reachable: earlier revisions, Info/XMP, annotation replies (`/IRT`), structure-tree references; Sanitize keeps link URLs; removing security accepts the user password alone when permissions allow everything | Removal must be verified at the object-graph level, and a protection change must be disclosed on every path that makes it | **Outside Varve's scope, with a reason.** Varve has no redaction, sanitize or PDF Standard Security Handler surface (`packages/editor/src/archive` AES-GCM is a container mechanism). If one is ever added, ADR-0242 §6 already requires uniform disclosure wherever an output path changes protection |
| pdfcraft #2566, #2569, #2571, #2572, #2574, #2942, #2759 | open, *reproduced* | XFA dynamic forms: instruction page drawn over every page, growable fields clipped instead of paginating, glyphs missing from subsets drawn as `?`, script failures, signature reported INVALID | A field hierarchy and a form script engine are whole subsystems | **Outside Varve's scope.** Varve has no AcroForm/XFA model and none is planned; the two mechanism-bearing reports inside this cluster (#2571 glyph fallback, #2894 measurement with the wrong font metrics) are routed to batches 2 and the measurement-parity check |
| pdfcraft #2684, #2873, #2922, #2430, #2536, #2472, #2850, #2830, #2676, #2692, #2563 | open, *reproduced* | Crashes and failures sending a document to a print queue; printers missing; print capabilities unparsable on specific drivers | Device printing is a platform capability with a long tail | **Outside Varve's scope today, verified:** there is no device-printing workflow to break — `Platform.printPdf` and `listPrinters` are implemented and *uncalled* (`packages/platform/src/tauri.ts:814`). Recorded so that a future print-to-device surface starts from this backlog rather than from scratch |
| pdfcraft #2806, #526 | open/closed, *reproduced* | Export to Word drops text after a web address and drops text colour | Office interchange has its own fidelity contract | **Outside Varve's scope.** No `.docx` reader or writer. Varve's interchange claims are limited to SVG/PSD/Sketch/Figma/PDF import and its own formats |
| pdfcraft #2413, #2457, #2488, #1821 | open/closed, *reproduced* | OCR text layers: a line edit reports nothing, `Tz`-condensed text loses repeated letters, the browser build offers OCR it cannot run | A text layer is not a text model; and an offered capability must be runnable where it is offered | **Outside Varve's scope for OCR** (no OCR surface). Two parts *do* transfer and are recorded: `#2457`'s letter-dropping is a heuristic-dedup defect Varve's tokenizer cannot produce (batch 1 tokenizes `Tz` arithmetic instead of deduplicating), and `#2488`'s "offered but non-functional in the browser build" is the same product-truth rule Varve applies to its `/try/` demo (`docs/architecture/browser-demo.md`) |

## Cutoff 2 — 2026-10-21

The tracker was re-crawled through the same listing endpoint with Link
pagination at `2026-10-21T19:31:27Z`–`19:32:41Z`: 3,903 records (1,790 issues,
2,113 pull requests), reconciled exactly against the repository's
`open_issues_count` (1,044 open issues + 843 open PRs = 1,887). **494 issues
were created after cutoff 1** (2,981–3,905), 184 cutoff-1 issues closed, and
338 were updated. The repository-wide comments endpoint returned 5,990
comments, which also covers pull-request threads — the cutoff-1 gap.

Per-issue rows: [`../audits/pdfcraft/issue-ledger-cutoff2.tsv`](../audits/pdfcraft/issue-ledger-cutoff2.tsv).

### What the new issues added

| Family | New evidence | What it changed here |
|---|---|---|
| Glyph coverage (largest family again: ~50 new reports) | 2981 Thai, 3127 Korean, 3167 Bengali, 3196 Hebrew fallback missing from a *shipped build*, 3202 Polish diacritics, 3258 Cyrillic, 3389/3505 CJK tofu, 3601 U+2002 falling back to a box, 3604 Greek invisible, 3707 Japanese kana, 3845 characters vanishing after edit | Confirmed the class is still open in a sibling app and sharpened the Varve finding: the canvas falls back per glyph, the PDF writer outlines the authored face, and the registry-derived catalog carried an empty `unicodeRanges` list so the existing `missing-glyph` status could never fire. Batch 2 reads the coverage of the exact embedded binaries and reports the gap. |
| Minification quality | 2984, 3250 ("over-sharpened"), 3267, 3351, 3461, 3687, 3872 | Batch 3: export now applies the compositor's `imageSmoothingQuality: 'high'` policy. The "over-sharpened" report is what made `/Interpolate` a deliberate *non*-change: a reader hint that smooths upscaled artwork would trade one artefact for another and does not shrink the file. |
| Hidden / non-painting content | 2986 (CAD layers drawn), 3029 (OCR layer leaves `3 Tr` set), 3109, 3115, 3211/3213/3214, 3429, 3644 | Batch 9: `/OCProperties /D` visibility and `Tr` render modes are honoured on import, with counts and layer names in Import Results. |
| Encrypted documents | 3450, 3904 (RC4 R=3, no password prompt) | Batch 9 refuses `/Encrypt` with an explanation. The refusal exposed a reporting defect — "imported with fidelity changes" for a file whose pages were never read — fixed by an explicit `failure` field on `ImportResult`. |
| Inline-image termination | 3107, 3108, 3578, 3579 | Varve already skipped image data as opaque bytes; batch 9 additionally terminates at `EI` followed by a delimiter, which is how a real producer ends the image. |
| Mixed orientation | 3884 (orientation-changing pages crash the renderer) | Batch 6 verified Varve's model: per-page width/height, with a round-trip test covering three orientations in one document. |
| Text identity | 3496 (save mid-edit reported success), 3577, 3744 | Already handled upstream by authored-id targeting and the pending-edit flush; verified, not re-implemented. |
| Vertical writing | 3216 (`Identity-V` measured horizontally), 3711 (tate-chu-yoko digits), 3712 (upright glyph placement), 3713 (character spacing) | **Recorded as a real Varve import gap**, not an exclusion: Varve authors vertical text, but the PDF importer maps every run horizontally. Queued as the next fidelity batch. |

### Decisions that are deliberately *not* implementations

- **`/Interpolate` is not set on PDF images.** It is a reader hint that also
  smooths upscaled artwork (pixel art), and it does not reduce file size. The
  PDF contract is now stated in `docs/architecture/export-resolution.md`:
  full-resolution data is embedded and the reader resamples.
- **Glyph coverage is reported, not repaired.** Substituting a face would change
  the document's appearance without being asked; the warning names the
  characters, the font and the number of objects so the user can decide.
- **Closures are not proof.** The 184 cutoff-1 closures were checked against the
  cluster map; the closed classes are redaction, printing, forms, signature and
  Office interchange — all still outside Varve's scope.

### Correction: export minification (batch 3)

The cutoff-1 audit claimed the export family minified with the browser default.
That was true of the canvas setting and wrong about the outcome: image fills are
decoded at the projected draw size with `resizeQuality: 'high'` before the
canvas ever draws them, so an exported scan was already area-averaged. Measured
in Chromium on 2026-10-21, `imageSmoothingQuality: 'low'` and `'high'` produce
identical output for a 4:1 downscale of a one-pixel checkerboard, and differ
only for detail near the destination pixel scale (a 3px checkerboard aliases to
0..255 under `'low'` and stays within 95..159 under `'high'`).

The policy is now explicit on every surface that really scales, and the browser
test asserts the outcome (no pure black/white in a minified export) rather than
which mechanism produced it. The lesson recorded for future audits: "the code
does not set property X" is not evidence that the *outcome* differs — measure
the output before writing a fix.

## Cutoff 3 — 2026-10-23 (closure pass)

The tracker was re-crawled at `2026-10-23T07:52:52Z`–`07:54:25Z` with the same
listing endpoint and Link pagination: **4,208 records** (1,951 issues, 2,257
pull requests), reconciled exactly against `open_issues_count`
(1,103 open issues + 725 open pull requests = 1,828). The repository-wide
comments endpoint returned 6,761 comments, covering issue and pull-request
threads. **161 issues were created after cutoff 2** (3,909–4,210); 838
cutoff-2-era issues were closed and 361 updated.

Per-issue rows: [`../audits/pdfcraft/issue-ledger-cutoff3.tsv`](../audits/pdfcraft/issue-ledger-cutoff3.tsv).
Resolutions of the frozen non-terminal rows: [`../audits/pdfcraft/resolutions.tsv`](../audits/pdfcraft/resolutions.tsv).
Closure report: [`../audits/pdfcraft/CLOSURE.md`](../audits/pdfcraft/CLOSURE.md).

### What the new issues added

| Family | New evidence | Decision |
|---|---|---|
| Panic containment (3914, 3919, 3920, 3925) | a UI panic closes the whole app; worker panics leave progress stuck | **Implemented** for the browser surfaces: a real-browser fault injection proves the canvas, layers and inspector fail independently, and a failed or over-budget export reaches a terminal report. A native Rust panic remains outside the DOM boundary (recorded). |
| Document ownership (3916, 3917, 3918, 3923) | a reload switches the document under a dialog; a recovery sidecar names the next save path; typed comment text is not in the unsaved set | **Implemented/verified**: document replacement clears the old selection and destination, recovery identity is provenance-only (`recordedFileId`/`recordedFilePath`), and `TerminationCoordinator` flushes pending edits before deriving dirty state. |
| Text-edit overlay (4056, 4175, 4176, 4199) | the edit overlay escapes the viewport; an aligned box edits left-aligned; undo re-lays a paragraph | **Implemented**: the overlay is clipped at 1024×600 while scrolling/zooming and now mirrors `node.textAlign`. The alignment regression fails with computed `start` without the fix. |
| Small-window rows (4028, 4118, 3949) | right-sidebar icons overlap and the page is cropped at 1366×768 / split screen | **Implemented**: inspector tabs do not overlap at 1024×600, 1280×720 or 1440×900, every tab stays reachable, and the canvas dock stays inside the viewport. Attachments inspected. |
| Glyph coverage (3913, 3977, 3991, 4014, 4030–4032, 4038, 4085, 4156, 4192) | the largest family again (CJK, Hebrew, Greek, Czech, Vietnamese, CAD drawings) | Batch 2 still holds: the export report names the characters the embedded face cannot draw, and the canvas falls back per glyph. The 4030 attachment (a technical drawing with a missing "M") was inspected and matches the class. |
| Key material (3928, 4000) | keys and passwords never zeroized; `RandomState` used for keys | **Implemented** for the copy Varve controls: the archive key is a non-extractable `CryptoKey` and the encoded password buffer is wiped after import. JavaScript strings cannot be zeroized (recorded). Varve writes no PDF encryption. |
| Export bound (3634, 3919) | no per-node deadline; a pathological node holds the batch | **Implemented**: a per-node budget (default five minutes) fails the node with a name and never writes it; cancellation remains cancellation; the batch continues. |
| Printer, forms, signature, redaction, OCR, Office, PDF-structure rows | the same clusters as cutoffs 1–2 | Outside Varve's scope with the existing cluster reasons; no new surface was added. |
| Accessibility tagging (4079–4080, 4103–4105) | set `Summary`/`Scope`/artifact roles | Outside scope: Varve writes PDFs but does not edit PDF structure or claim tagged output. |

### What this changed in the closure method

Cutoff 1/2 rows are frozen. A later pass appends a resolution with the previous
disposition, the new disposition and evidence; `pnpm audit:pdfcraft-closure`
then builds the latest-disposition-per-issue view and fails on a non-terminal
row without a `blocked:` reason or a verified row without a code/test path.
That is what lets the historical census and the closure claim coexist without
rewriting history.
