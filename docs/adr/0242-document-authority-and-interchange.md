# ADR-0242: One document authority with format-specific preservation adapters

*Status: accepted — 2026-10-15*

## Context

Varve is growing connected workflows for document organization (page
reorder/insert/duplicate/delete/rotate), publishing typography (parent pages,
threaded stories, styles, wrap, a real paragraph composer), PDF
interoperability (import, print export, archival conformance), persistence
(incremental/atomic saves, recovery), and layout interchange. These workflows
span three kinds of documents: native Varve documents, original PDF documents,
and interchange payloads (IDML-class). Treating them as one lossy scene schema
would repeat defects observed in adjacent tools: inferred structure being
treated as editable content (pdfcraft #1756), structural operations silently
dropping document-level structures like page labels and outlines (pdfcraft
#2670, #2367), and protection changes disclosed on one operation but not its
siblings (pdfcraft #2168).

The full research evidence is in
[`docs/research/document-workflows-tracker-ledger-2026-10-15.md`](../research/document-workflows-tracker-ledger-2026-10-15.md);
the staged slice plan is in
[`docs/plans/document-workflows-plan-2026-10-15.md`](../plans/document-workflows-plan-2026-10-15.md).

## Decision

1. **One authority per document kind, adapters at the edges.** The canonical
   Varve document model (scene, history, save coordinator) remains the single
   writable authority for native documents. A preservation-oriented PDF
   session, when built, retains the original object graph behind an adapter
   and is never forced through the scene schema; interchange adapters
   translate to and from the native model and declare per-feature fidelity.
   No second independently writable source of truth is introduced for the
   same bytes.
2. **Separate identity axes.** Page identity (stable ID), visible page
   number/label, physical sequence, spread position, story order, paint
   order, and accessible reading order are distinct modeled concepts. Source
   object IDs (PDF object numbers, interchange element IDs) are tracked
   separately from Varve IDs with explicit cross-file remapping. Commands
   target stable identities, never thumbnail indexes.
3. **Inferred structure is never mutation ownership.** Search index, reading
   order heuristics, inferred paragraphs, and thumbnails are derived data.
   Editing commands may only target authored structure (stories, frames,
   form fields, annotations). A heuristic may propose; it may not own.
4. **Structural page operations carry document-level structures.** Combine,
   extract, split, duplicate, and reorder must remap or explicitly report the
   fate of outlines/bookmarks, page labels, named destinations, links, form
   fields and their hierarchies, optional-content groups, and structure trees
   — with the same disclosure on every operation, not a warning on one and
   silence on another.
5. **Honest output claims.** Export conformance badges come from machine-
   readable validator reports, never from process exit codes or the absence
   of errors (`scripts/validate-pdf.sh` is the canonical gate for PDF/A and
   PDF/UA; PDF/X requires tooling outside veraPDF's scope and is never
   claimed through it). Protection changes on output are disclosed on every
   affected operation. Rasterized or appearance-only outputs are labeled as
   such.
6. **Serialization choices are compatibility surface.** Structures intended
   for external readers (page labels, outlines, tagged content) are
   serialized the way mainstream independent readers expect — for example,
   page-label dictionaries as indirect objects — and verified against
   independent parsers, not only Varve's own re-import.

## Consequences

- Native documents gain an explicit page-label/section model before print
  export can emit interoperable labels; the print path's current absence of
  `/PageLabels` is a documented gap, not a hidden one.
- PDF preservation work is gated on audited library support for the Standard
  Security Handler and on object-graph-level verification; archive AES-GCM
  (a Varve container mechanism) is unrelated and must never be cited as PDF
  encryption support.
- Interchange adapters ship with a per-feature fidelity matrix and failing
  regressions for the properties we claim; unclaimed properties are reported
  as dropped rather than silently lost.
- Every derived-data consumer (search index, thumbnails, reading order)
  carries the document revision it was built from so stale results are
  discardable.
