# Document workflows implementation plan — 2026-10-15

Plan for the connected document-organization, publishing-typography,
PDF-preservation, persistence, and interchange work requested in the
2026-10-15 master task. Research evidence:
[`docs/research/document-workflows-tracker-ledger-2026-10-15.md`](../research/document-workflows-tracker-ledger-2026-10-15.md).
Authority decision: [ADR-0242](../adr/0242-document-authority-and-interchange.md).

## Audit baseline (what exists today, verified against source 2026-10-15)

- **Find/replace** (`packages/editor/src/findReplace/`): a single planner
  computes edits once against a frozen `SearchSpec` + revision, applies per
  target in descending offset order, and revalidates each original range at
  commit (`replace.ts`). Unicode-normalization projections with
  original-offset mapping exist (`projection.ts`); locked/hidden targets stay
  findable but are never edited; story targets edit authoritative story
  content once. Gaps: no incremental/workerized indexing for large documents
  (`searchWorkerHost.ts` exists but scheduling scope is limited), and the
  self-containing-replacement contract was untested until this plan's first
  slice.
- **PDF validation** (`scripts/validate-pdf.sh`): was misusing veraPDF's CLI
  (`--profile` instead of `--flavour`, nonexistent `--format mrr`), claimed
  PDF/X profiles outside veraPDF's scope, and printed success from the
  process exit alone. Repaired 2026-10-15 (below).
- **Print path** (`crates/varve-print/`): outlines exist (`outline.rs`);
  **no `/PageLabels` emission** and no scene model for page labels/sections —
  any interop claim about labels is currently vacuous rather than wrong.
- **Persistence**: save architecture distinguishes saved/recoverable/
  download-only output (`docs/architecture/save-destinations.md`) with
  revision-aware serialized saves; no PDF incremental revision path exists,
  so the pdfcraft #2165/#2364 failure class is structurally absent today.
- **Encryption**: `packages/editor/src/archive/` provides AES-GCM for Varve
  archives. That is a container mechanism, not PDF Standard Security Handler
  support; encrypted-PDF open/save is absent and must not be claimed.
- **Interchange**: Figma REST JSON import exists; no IDML-class layout
  interchange import or export.

## Slices

Status vocabulary: **done** (implemented + validated this pass), **planned**
(design agreed, not implemented), **gated** (blocked on a prerequisite).

1. **done — Honest PDF/A·UA conformance gate.** `scripts/validate-pdf.sh`
   selects standards with `--flavour`, derives the verdict from the report's
   `isCompliant` attribute, fails closed on missing/unreadable reports,
   refuses PDF/X with an explicit scope explanation, and archives the report
   plus an input-hash summary under `reports/pdf-validation/`. Behavior tests
   with a stubbed validator pin the false-green fix (noncompliant report with
   exit 0 fails; empty/garbage reports fail closed). Grounded in the official
   CLI docs, accessed 2026-10-15. Answers pdfcraft #1763's lesson (visible
   in-app is not interoperable) at the tooling level.
2. **done — Replace-all self-overlap regressions.** Five adversarial cases
   pinned in `findReplaceSafety.test.ts`: adjacent growing matches,
   replacement containing the needle, `$&` re-inserting the match,
   replacement starting with the needle, multi-target edits. Answers the
   figcraft #410 class.
3. **planned — Page-label model through to print export.** Scene gains a
   page-label/section model (style, prefix, start-at, per-section ranges);
   print export emits `/PageLabels` with label dictionaries as indirect
   objects (pdfcraft #1763/#1959 interop root cause) and structural future
   operations preserve them (pdfcraft #2670/#2367). Requires scene schema
   addition + migration + editor UI + varve-print emission + a round-trip
   test through an independent parser.
4. **planned — Reading-order selection and extraction tests.** Logical-order
   BiDi corpus (RTL lines with digits/punctuation, per pdfcraft #2667) for
   selection, copy, and find highlights; workerized incremental search
   indexing with revision-stamped results for large documents.
5. **planned — Combine/extract/split with retained-feature reports.** Only
   after slice 3; must follow ADR-0242 §4 (explicit fate for every
   document-level structure, uniform disclosure) and include missing-
   destination policy (no silent retargeting).
6. **planned — Empty-line metrics parity.** Pin the deckcraft #780/#788
   class in the text pipeline: empty-line height derives from the ending
   mark's properties, with a cross-format parity test before any
   interchange claims.
7. **planned — Native format reopen gate + published schema.** Per
   figcraft #604: every save-path change adds a reopen test in the same
   change; the native-format specification work (units, IDs, migrations)
   lands with the interchange slice.
8. **gated — PDF Standard Security Handler support.** Requires audited
   library qualification (revisions 2–6, RC4/AES-128/AES-256) and an
   enforcement story at the executor, not just disabled buttons. The
   disclosure requirements of pdfcraft #2168 apply to every output path that
   changes protection, uniformly.
9. **planned — Knuth–Plass composer.** Integrates at the paragraph-
   composition boundary once the authoritative layout snapshot contract
   (single versioned layout result consumed by screen, selection, PDF) is in
   place, so greedy and optimized composition cannot coexist as two
   authorities.

## Validation requirements carried by the plan

- Every slice that changes a file format or save path adds a reopen test in
  the same change (figcraft #604 rule).
- Every interop claim (page labels, tagged text, PDF/A) is verified through
  an independent reader/parser, never only Varve's own re-import.
- Editor-facing changes run a lease-wrapped Playwright pass with inspected
  screenshots; the find/replace UX is covered this pass (see the Agent
  Validation Report in the session record).
- Documentation drift is checked with `pnpm audit:docs` whenever these
  documents change.
