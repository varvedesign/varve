# PPTX interoperability — feasibility and fidelity assessment (2026-10-16)

Status: assessment accepted as the replacement for the blanket PPTX deferral.
The prior position ("deferred until its own feasibility and fidelity
assessment") is superseded by the phased plan below. Nothing in this document
claims Varve already reads or writes `.pptx`; the implementation cell is
explicitly not started.

## 1. Question

Can Varve — local-first, Tauri 2 desktop plus the same facade on web — open,
edit, save, and re-open `.pptx` presentations honestly, without pretending
that a slide-screenshot ZIP is PowerPoint support, and without shipping a
dependency whose licensing or maintenance would endanger the offline story?

## 2. Format ground truth (primary sources)

- OPC packaging: ECMA-376 Part 2 defines the ZIP package, content types, and
  relationship parts. A `.pptx` is a ZIP with `[Content_Types].xml`,
  `_rels/.rels`, `ppt/presentation.xml` (slide-ID list, slide size in EMU),
  per-slide parts, and their `_rels` files. Slide order comes from
  `p:sldIdLst` resolved through relationships, never from ZIP entry order.
- PresentationML/DrawingML: slides are `p:sp` shape trees with
  `p:txBody` rich paragraphs; geometry is DrawingML (`a:prstGeom`,
  `a:custGeom`); positions are EMUs (914400 per inch, 12700 per point).
- Master/layout/placeholder inheritance: slides reference layouts by
  relationship; layouts reference masters; placeholder inheritance keys on
  placeholder type and index, not display names.
- Transitions and timing: `p:transition` (with `spd` defaulting when the
  attribute is absent — the exact mechanism behind other tools' 0.5 s
  durations snapping to 1 s) and `p:timing` trees for builds.
- Morph is a Microsoft extension (MS-PPTX); its correspondence metadata and
  the `!!` naming convention are extension behavior, not base ECMA-376.

## 3. Implementation options considered

| Option | Verdict | Reason |
| --- | --- | --- |
| Wrap a full JS suite (e.g. an OOXML office library) | Rejected | None of the maintained options are importers and writers with a per-feature disclosure story; they are large, browser-hostile or license-uncertain, and encourage silent pass-through of unsupported parts. |
| Rust crate (e.g. `pptx-rs`) | Rejected for import | Write-oriented only; web/WASM parity would need a second path anyway. |
| Hand-rolled OPC reader/writer over `fflate` + a small XML parser | Selected | The package format is ZIP + XML Varve already handles; `fflate` is an existing dependency; both web and desktop share one TypeScript implementation behind `@varve/import` and the presentation export adapter; per-part disclosure is a design constraint rather than an afterthought. |

Dependency policy: no new runtime dependency beyond what `@varve/import`
already uses. XML is parsed by a hardened pull parser (no entity expansion,
bounded depth, bounded element counts) or by DOMParser in the webview with
the same bounds enforced before parse. Both paths must share one validation
module so the bounds cannot drift.

## 4. Per-feature fidelity matrix (target, not status)

Legend: import → editable in Varve → preserved on save → exported; "target"
means verified by opening output in PowerPoint and LibreOffice Impress. Every
cell below is **unimplemented** today; the matrix is the contract the
implementation will be graded against, with a shipped disclosure report per
file listing every part class that was dropped, retained opaquely, or
converted.

| Feature | Import | Editable | On save | Export | Notes |
| --- | --- | --- | --- | --- | --- |
| Slide order, size, hidden/skipped | Yes (via `sldIdLst`) | Yes | Yes | Yes | Order from relationships only. |
| Text boxes, rich runs, lists | Yes | Yes | Yes | Yes | Paragraph-level mapping to Varve text nodes; runs preserved as rich text. |
| Placeholder type/idx inheritance | Resolve | Yes | Best effort | Layout+idx | Master/layout inheritance resolved through one resolver. |
| Masters/layouts/themes | Resolve to Varve layout sources/themes | Yes | Yes | Yes | Theme = variable set + text styles; template-vs-theme kept distinct in the UI. |
| Preset geometry, transforms, groups | Yes | Yes | Yes | Yes | Adjustment handles bounded to Varve's parametric set; unknown presets retained as paths. |
| Images, crops | Yes | Yes | Yes | Yes | Crop interpolation already exists for Morph; reuse. |
| Notes | Yes | Yes | Yes | Yes | Round-trips in authoring saves; audience-sanitized copy strips notes, comments, hidden slides. |
| Transitions incl. fractional durations | Yes | Yes | Yes | Yes | Absent `spd` must not round durations (the cross-tool defect class). |
| Builds/timing trees | Subset | Yes | Yes | Subset | Click/with/after-previous plus delays map to Varve builds; exotic triggers disclosed. |
| Morph extension | Read metadata | No editing | Preserve when untouched | Explicit | Qualified object Morph is Varve-native; extension metadata retained for untouched slides only. |
| Tables | Appearance fallback | No | Retained or re-emitted | Yes (from Varve tables) | Never silently omitted. |
| Charts, SmartArt, OLE, equations | Retained opaque part | No | Preserved only while untouched | No | Editing a slide may invalidate an opaque part's pairing; disclosed per part. |
| Media (audio/video) | Poster + retained part | Playback deferred | Preserved when untouched | No | varve-media decodes animated images; A/V playback is a separate capability cell. |
| Embedded fonts, macros, encrypted parts | Detected | No | Never executed | No | Macros and OLE are never executed; encryption is rejected with an explicit message, never bypassed. |

## 5. Security and reliability boundaries

Untrusted input throughout: bounded compressed and uncompressed sizes, entry
counts, XML depth, relationship counts, and expanded shape counts before any
parse; no symlink or traversal escapes out of the package root; no entity
expansion; no automatic fetch of external media or links; encrypted and
corrupt packages rejected with distinct, actionable messages. Editing a
signed package invalidates signatures — the save flow discloses that instead
of implying trust continuity. Conversions are transactional; the original
file is untouched until an explicit save completes.

## 6. Verification plan

- Real encoded files both directions: Varve → PPTX → PowerPoint/Impress →
  reopen; external decks (PowerPoint, Impress, Keynote producers) → Varve →
  PPTX → target. A file opening without a repair prompt is necessary but not
  sufficient; rendered output and package relationships are inspected.
- LibreOffice Impress is the automatable lane in CI; PowerPoint and Keynote
  verification is a manual qualification cell and stays labeled unverified
  until someone with access runs it. No access means unverified — never a
  claim.
- No byte-identical reserialization claim. The save contract is semantic:
  disclosed outcomes per part class, retained provenance for untouched
  opaque parts, and a failing (not silently degraded) result when an edit
  invalidates a retained pairing.

## 7. Phased plan

1. **Reader spike (1 slice):** OPC validation bounds, slide list via
   relationships, text/shape/image slides, notes, hidden flags; disclosure
   report for everything else. Fixture corpus committed with hashes.
2. **Writer (1 slice):** minimal valid package (presentation.xml, one master
   + layouts, slides with text/shape/image, notes parts); verified in
   Impress and, when available, PowerPoint.
3. **Fidelity expansion (2–3 slices):** placeholder/theme/layout mapping,
   transitions and fractional timing, sections, tables appearance fallback,
   opaque-part retention with provenance.
4. **Qualification (ongoing):** compatibility corpus runs, sanitized
   audience-copy export, security fuzzing of the parser bounds.

Phases 1–2 are the preconditions for calling anything "PPTX support" in
product or marketing copy; until they land and verify, the website and docs
must continue to say Varve does not read or write `.pptx`.
