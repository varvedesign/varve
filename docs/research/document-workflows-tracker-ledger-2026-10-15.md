# Document-workflow tracker research ledger — 2026-10-15

Research inputs for the connected document-organization, publishing-typography,
PDF-preservation, and interchange work. Inspected trackers:
[figcraft](https://github.com/storytold/figcraft/issues),
[pdfcraft](https://github.com/storytold/pdfcraft/issues),
[deckcraft](https://github.com/storytold/deckcraft/issues) — all three exist and
are public; issues were read via the GitHub API on 2026-10-15 (pdfcraft showed
activity through 2026-10-16 UTC). Evidence levels used below: *report*,
*proposal*, *audit* (source-inspected, not runtime-reproduced), *reproduced*
(reporter supplied an executable or minimal repro), *fixed* (closed with a
merged repair).

## Seed validation, including negatives

The preparation-pass seeds were revalidated against the live trackers. Two do
not hold and must not be cited:

- **deckcraft #1092 does not exist** (GitHub API returns 404 for the issue on
  an existing repository). The live successor for the same-style
  paragraph-spacing concern is deckcraft #788.
- **deckcraft #449 exists but is unrelated** — a closed video seek-drain PR
  issue, not paragraph spacing. The live pagination-drift evidence is
  deckcraft #780.

All five pdfcraft seeds exist and are open: #2667, #1756, #2168, #2696, #1763.

## Ledger

| Source | Status | Bounded failure | Transferable lesson for Varve | Decision |
|---|---|---|---|---|
| pdfcraft #2667 | open, *reproduced* | Text extraction reverses Hebrew/Arabic word order on lines containing numbers or punctuation; MuPDF returns logical order on the same file | Extraction, rendering, and editing need separate BiDi tests; logical-order integrity is independent of shaping correctness | Plan: dedicated logical-order extraction corpus (RTL + digits + punctuation) when the extraction path is built. Not yet implemented in Varve (PDF import is limited) |
| pdfcraft #1756 | open, *reproduced* | Inferred `text_paragraphs` groups a heading with unrelated body lines; a subsequent `text_edit` wipes them and deletes a watermark. A second reporter shows single-line edits also remove a rotated overlapping watermark | Inferred grouping is not mutation ownership: edits must target authored structure, never a heuristic guess | Adopted as a design rule in ADR-0242: commands target stable authored identities; inferred layout is derived data |
| pdfcraft #2168 | open, *proposal* (code-anchored) | Combine warns that output loses protection, but Extract and Split silently write unencrypted output; Remove Security applies with only a toast | Protection changes must be disclosed on every operation that changes them, consistently, not just on one operation | Plan: any Varve export/assembly path that emits unprotected output from protected input must present the same explicit disclosure (ADR-0242 §6). Not yet applicable: Varve has no PDF Standard Security Handler support (archive AES-GCM is a different mechanism) |
| pdfcraft #2696 | open, *report* | Dotted form-field names rejected on input, and display truncates at the last period while the saved file keeps the full name | Partial vs fully qualified field names are different views over one hierarchy; the delimiter must not be repurposed as an input ban | Plan: if Varve grows form support, field hierarchy inspection must show full names and partial names without conflating them |
| pdfcraft #1763 (+ merged PR #1959) | *reproduced* → *fixed* 2026-10-15 | App-written `/PageLabels` used direct label dictionaries; downstream tools that only accept indirect references (as Acrobat writes) silently fell back to physical numbering — visible-in-app was not interoperable | A structure being present and even spec-valid is not the same as interoperable; serializer choices (direct vs indirect objects) are compatibility surface | Adopted now in `scripts/validate-pdf.sh` philosophy: verify through independent readers, not the authoring app. Varve's print path does not yet emit `/PageLabels` (see plan) |
| pdfcraft #2670 (item 1) | open, *reproduced* | `page_extract`/split/combine drop `/PageLabels` entirely; pages labelled i…A-1 come out unlabelled | Structural page operations must carry label/outline metadata through, or users lose numbering on every extract | Design requirement recorded in ADR-0242 §4 for Varve's future combine/extract/split |
| pdfcraft #2367 | open, *reproduced* | A full save wrote `/Outlines null` and `/PageLabels null` even though both were recoverable from the source | Full-save paths must preserve or explicitly report every dropped document-level structure | Same as above; also motivates the "retained-feature report" requirement for assembly operations |
| pdfcraft #2165 | open, *code-anchored* | Save/Save As both write incrementally; deleted pages, removed images, old form values remain readable in earlier revisions of the "saved" file | Incremental append is not sanitization; a compact rewrite must exist and be separately explained | Plan: Varve save architecture already distinguishes save destinations (docs/architecture/save-destinations.md); any PDF incremental path must pair with a disclosed compact rewrite |
| pdfcraft #2364 | open, *reproduced* | Incremental saves on files with bytes before `%PDF-` wrote absolute xref offsets while `/Prev` stayed header-relative; qpdf then reports a broken xref | Edge-case byte layouts need round-trip tests through independent parsers before a save path is called done | Noted for the PDF persistence slice |
| pdfcraft #389 / #2380 | #389 open *reproduced*; #2380 closed security report | Redaction removes the draw operator but leaves the original image XObject reachable; Sanitize left link URLs in structure trees and Info/XMP | Removal claims must be checked at the object-graph level, not the operator level | Design rule for any future redaction/sanitize feature |
| figcraft #410 | open, *report* | Replace-all leaves later text matches unchanged when the replacement contains the search string | Rescan-after-each-edit replace loops or skips; plan-once + descending-offset application avoids the class | **Resolved in Varve 2026-10-15**: the planner already computed edits once against a frozen snapshot; five adversarial regressions added to `findReplaceSafety.test.ts` (adjacent growing matches, replacement containing the needle, `$&` templates, prefix replacements, multi-target) to keep refactors from reintroducing it |
| figcraft #278 | closed, *report with short repro* | Editing a text layer silently rolled the document back to the previous text-session state; undo could not recover it | Per-tool-session caching of document state is dangerous; one authoritative document revision per edit | Existing Varve risk noted: find/replace commit revalidates against live revision (`applyReplacementPlan`); keep that contract |
| figcraft #604 | open, *report* | The app cannot reopen files it saved minutes earlier ("cannot open files in its own format") | Every save format needs a reopen gate in the same release | Applies to Varve native format work (plan §7) |
| figcraft #466 | open, *reproduced* | `.fig` import drops `leadingTrim` on every text layer; box heights are trimmed but the flag is discarded, so layout sits offset | Import fidelity: preserved data must drive layout, or round-trip is a silent downgrade | Plan: interchange matrix must pair each imported property with a live consumer |
| figcraft #195 | open, *audit* | Browser-local documents have no durable recovery or save route | Local-first apps need browser persistence parity or an honest disclosure | Varve's lifecycle system already treats web persistence as a contract; keep it |
| deckcraft #780 | open, *reproduced* (fixture + SSIM) | Empty lines inside a paragraph are sized by the paragraph's first run instead of the break/endParaRPr mark; text drifts up to 173 pt from PowerPoint's own export | Line metrics for empty lines must come from the mark that ends them, or cross-app pagination drifts compounding | Plan: parity test in the text pipeline for empty-line height derivation before publishing interchange claims |
| deckcraft #788 | open, *report* | Same-style list spacing renders smaller than PowerPoint's, so images overlay text | Same-style paragraph spacing differences accumulate into visible pagination drift — same family as #780 | Same as above |
| deckcraft #411 | open, *audit* (source-anchored) | PPTX import discards paragraph-local `defRPr` defaults; runs read only their own `rPr` | Paragraph-level defaults are part of the style model; dropping them changes appearance with no error | Plan: interchange import must model paragraph-default inheritance explicitly |
| deckcraft #234 | open, *reproduced* | `a:biLevel` image recolor unsupported; a logo over a same-color rectangle becomes invisible | Placed-image effects are content, not decoration: dropping them can hide artwork entirely | Plan: interchange matrix entry for image recoloring (matches the prompt's "placed-image recoloring" requirement) |
| deckcraft #81 | open, *reproduced* | Default browser build exports Arabic/Hebrew as missing-glyph boxes while native CLI renders correctly | Font availability differs per platform; export claims must be per-build truthful | Varve rule (AGENTS.md): cross-platform or not done; web/native export parity tests required |
| deckcraft #807 | open, *report* | Theme browse applies only the theme, not the template's master + layouts; slides are not remapped | Master/layout systems are structural, not cosmetic | Plan: Varve parent-page work must keep assignment/topology semantics separate from style application |

## Independent primary-source checks (accessed 2026-10-15)

- veraPDF CLI documentation (docs.verapdf.org/cli/validation/): built-in
  standards are selected with `-f`/`--flavour`; `--profile` takes a custom
  profile file; report formats are text/raw/html/json with XML default;
  compliance is read from the report's `isCompliant` attribute; the shipped
  scope covers PDF/A and PDF/UA — **no PDF/X**. This grounded the repair of
  `scripts/validate-pdf.sh`, which previously passed standard names through
  `--profile`, requested a nonexistent `mrr` format, advertised PDF/X
  profiles the validator cannot honour, and printed success from the process
  exit code alone (Varve finding R4; fixed in the same commit series).
- qpdf documentation (per the R2 seeds) documents that document-level data
  (outlines, page labels, form fields) needs explicit handling during page
  selection; a wrapper around page-copy alone does not provide those
  guarantees. Cited as a design constraint for Varve assembly operations
  rather than a library endorsement.
- The [R1]–[R9] references in the originating task remain to be
  re-validated slice-by-slice as each area is implemented; they were not all
  re-fetched this pass.

## Evidence limitations

- Tracker reading was API/page-based; attachments and long comment threads
  beyond the top comments were not exhaustively read.
- No pdfcraft/deckcraft/figcraft scenario was runtime-reproduced against
  those applications by this audit; evidence levels are as reported above.
- The two negative seed results (deckcraft #1092/#449) mean any plan that
  cites them must cite #788/#780 instead.
