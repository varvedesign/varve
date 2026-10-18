# Text pipeline architecture

**Status:** migration in progress — audit baseline recorded 2026-08-13; shaping, BiDi, snapshot foundations, and the canonical paragraph layout pipeline landed

Varve’s text system keeps source text in logical Unicode order. Paragraphs and
rich-text runs are document data; visual ordering, glyph clusters, line boxes,
caret stops, and selection fragments are derived layout data.

## Current pipeline

```text
TextNode.text / TextNode.richText / TextStory
  → sceneNodeToEngineNode
  → text render IR
  → replay-time layout selection
      ├─ TextLayoutSnapshot → positioned cluster replay (plain text when shaping is available)
      ├─ Canvas measureText → transient approximate snapshot → cluster replay (browser fallback)
      ├─ rich-span snapshot → positioned cluster replay (Canvas2D measurement fallback)
      ├─ legacy rich layout fallback (advanced paragraph controls)
      └─ Rust rustybuzz command (native desktop outline conversion; PDF is separate)
  → SVG/PDF/codegen-specific consumers
```

This is a transitional architecture. The browser’s shaping is not exposed
enough to serve as Varve’s authoritative glyph, cluster, caret, or export data.
The exact findings and code references are in
[the 2026-08-13 Unicode text audit](../audits/unicode-text-shaping-audit-2026-08-13.md).

## Editing surface and inspector cost

The native textarea preserves the full transformed text bounds for caret,
selection, input and IME behavior. Its body portal clips painting and hit
testing to the canvas viewport, so an off-canvas line cannot intercept the
inspector. The floating formatting toolbar remains a separate overlay.
This does not replace the pending shaped-glyph caret geometry work.

### Buffered input must be drainable from outside the surface

Typing is coalesced: `TextEditOverlay.scheduleTextUpdate` holds native input
for ~100 ms before it reaches the document, because replaying a large document
on every keystroke is the regression
[photocraft #2616](https://github.com/storytold/pdfcraft/issues/2616)
describes. Coalescing is therefore deliberate, and it creates a window in
which the textarea shows characters the document does not have yet.

Any consumer that observes or persists the model on the user's behalf must
close that window first. `context/pendingEdits.ts` owns the contract: a
buffering surface registers a `PendingEditSource` (identity, `hasPending`,
`flush`) while it can hold work, and `flushPendingEdits()` drains every
pending source inside a `flushSync` so the editor's async-authoritative state
reflects the flush before the caller reads it. Today the save engine
(`context/usePersistence.ts#runSave`) and the termination coordinator
(`lifecycle/coordinator.ts` — `run`, `shouldWarnOnUnload`,
`bestEffortFlush`) are drains; a new surface that buffers a model write must
register one, and a new consumer that persists or reports the model must
drain.

The rules that follow:

1. A save, close, quit, or unload decision made inside the coalescing window
   must include the buffered characters.
2. A drain publishes text; it does not end the editing session, drop the
   selection, or change undo granularity (the burst transaction is settled,
   exactly as a formatting handoff already does).
3. An active IME composition remains open, but its currently visible textarea
   value is included in a save snapshot. The drain does not end native
   composition or close the burst underneath it; `compositionend` avoids
   publishing the same value twice and then settles the typing transaction.
4. Draining is idempotent and cheap when nothing is pending, so observation
   points may call it unconditionally.

Evidence: [photocraft #811](https://github.com/storytold/pdfcraft/issues/811)
(save and close ignore typing in an open paragraph) and
[#166](https://github.com/storytold/pdfcraft/issues/166) (save omits the
focused field's text) — the same defect in a sibling Tauri document editor.
Regression coverage: `tests/e2e/save/text-draft-save.spec.ts`,
`components/TextEditOverlay.test.tsx`,
`lifecycle/__tests__/coordinator.test.ts`, `context/pendingEdits.test.ts`.

The glyph inspector segments a paragraph once, derives each label from its
existing grapheme, and memoizes the option arrays. Closed shared Select
controls do not construct their option elements. This avoids quadratic
whole-paragraph segmentation and unnecessary option allocation when selecting
or editing long text. The [September 12 frontend evidence](../audits/font-frontend-evidence-2026-09-12.md)
records the real long-text interaction, clipping hit-test and validation limits.

## Target pipeline

```text
logical source string
  → paragraph boundaries
  → UTF-16 / scalar / grapheme index map
  → UAX #9 paragraph resolution
  → script, language, style, and font itemization
  → cluster-aware font fallback
  → HarfBuzz-compatible shaping
  → UAX #14 line breaking
  → line-level visual run ordering
  → TextLayoutSnapshot
      ├─ positioned glyph runs and metrics
      ├─ logical ↔ visual source maps
      ├─ legal caret stops and hit testing
      ├─ selection fragments
      ├─ layout/ink/object bounds
      └─ diagnostics and cache identity
  → canvas/WebGPU fallback renderer
  → editor, masks, raster export, SVG, PDF, and codegen
```

The snapshot is derived, revisioned, and bounded in memory. It must never be
serialized as authoritative document content. A document edit, font revision,
feature/variation change, frame geometry change, or relevant layout-policy
change invalidates the appropriate paragraph/story scope.

## Non-negotiable invariants

1. Serialized text remains logical Unicode order and is never reversed for RTL.
2. Source ranges remain UTF-16-compatible at persistence/DOM boundaries, while
   scalar, grapheme, shaping-cluster, glyph, and visual-caret units are explicit.
3. Complex scripts are shaped by a standards-based OpenType engine; one source
   character is not assumed to equal one glyph.
4. Rich formatting belongs to logical source ranges, never to visual glyph
   positions.
5. Rendering, bounds, caret placement, hit testing, selection, masks, and
   exports consume the same derived layout wherever practical.
6. Canvas2D may remain a rasterization backend, and WebGPU may fall back to it
   for text, but neither API is the layout authority.
7. Missing fonts and unsupported export semantics are reported explicitly;
   they are not silently presented as equivalent output.

## Backend strategy

The legacy `textOutlines` adapter reads embedding diagnostics from opentype.js's
`tables.os2` metadata. It preserves the base restriction when no-subsetting is
set, reports bitmap-only separately, and treats malformed modern flags as
unknown. These flags do not establish source-license permission, and the
adapter's warnings are not yet a shared export enforcement policy. Its tests
use the checked-in licensed Geist artifact; synthetic flag variants are
created only in memory. See the [diagnostic repair evidence](../audits/font-outlining-policy-evidence-2026-09-10.md).

* Native desktop shaping uses the existing `rustybuzz` implementation over
  validated font bytes. The editor's desktop text-to-outlines command now
  reaches it through `createNativeShapingBackend`; the adapter carries exact
  artifact/face identity, UTF-16 feature ranges, numeric feature values, and
  variation coordinates, then normalizes native units back to the shared
  `ShapingBackendResult`. If the command is unavailable, the local HarfBuzz WASM
  adapter is an explicit fallback and emits a diagnostic rather than silently
  changing the source.
* Web/WASM shaping uses the existing `harfbuzzjs` dependency behind the same
  request/result contract when font bytes are available. The WASM adapter
  always runs `buffer.guessSegmentProperties()` before applying explicit
  direction/script/language overrides — a direction-only request must not
  silently shape with the default script, which drops all Arabic/Indic GSUB
  features (fixed 2026-08-13, covered by `shapingOracle.test.ts`).
* Structural shaping invariants are verified against system Noto fonts by
  `shapingOracle.test.ts` (skipped when the fonts are absent; never
  redistributed): Arabic joining forms differ per position, harakat are
  zero-advance GPOS-positioned marks, RTL output is visual-order with
  monotone clusters, Devanagari conjuncts reduce glyph counts, and Thai
  marks stay attached to their clusters. Lam-alef is asserted
  font-independently: modern Noto Arabic does not ligate it, and both
  shaped and ligated output are valid.
* Canvas2D measurement is a bounded fallback for environments without a font
  byte source. It is marked approximate and cannot satisfy glyph-level parity
  or PDF text requirements.
* UAX #9 resolution is provided through the maintained `bidi-js` adapter in
  `unicode/bidiUax9.ts`; the public paragraph API retains logical UTF-16
  offsets while exposing resolved visual indices and mirrored-character data.

The backend contract currently lives in `packages/engine/src/shapingBackend.ts`.
It normalizes native font units to the requested size and uses UTF-16 source
cluster offsets. The HarfBuzz WASM adapter is lazy and owns one module instance
per backend; font bytes are supplied per request and are not transferred every
frame. Plain-text replay now consumes a derived snapshot when a pre-shaped IR
result is present, or derives a transient Canvas2D-measured snapshot when the
target exposes `measureText`. The transient fallback is deliberately not
cached because replay does not own a font-face revision token; late font
loading must be allowed to change its measurement.

The live browser canvas still paints complete source runs through the browser's
native shaping implementation. When the selected family has an inspectable
local CSS source, Varve creates a process-local `FontFace` descriptor alias so
whole-run feature values and custom variation axes reach that browser shaper;
the generated family is never persisted. Some Canvas2D implementations expose
neither `fontFeatureSettings` nor `fontVariationSettings`, and Chromium can
ignore those descriptors on `fillText` even after the alias is ready. In that
case `canvasOpenTypeRenderer.ts` parses the exact local source and draws real
glyph paths with the authored feature map and axes. If the source cannot be
parsed, `canvasSvgTextRenderer.ts` uses the browser's native SVG shaper and
embeds the same local source bytes in a bounded, process-local image. Both
paths preserve the complete logical run and notify replay for an authoritative
redraw; a loading or failed source keeps the normal Canvas2D result as an
explicit fallback. Catalog search and hover never fetch a remote font.

Canvas2D still has no portable API for drawing an arbitrary glyph ID or
applying a UTF-16-ranged feature map, so the byte-backed backend is used for
exact outline conversion rather than pretending that browser `fillText`
exposed the same glyph stream. Native PDF currently has a character-oriented
writer; the editor preflight rasterizes path text, complex/non-Latin text, rich
runs, ligature-sensitive strings, feature/axis/range settings, tracking, and
manual cluster edits through the live renderer. This is an intentional
appearance guarantee with an explicit loss of PDF text searchability for those
nodes.

The legacy Canvas measurement bridge now consumes the resolved visual BiDi run
order from `analyzeParagraph`; it no longer reverses an entire RTL paragraph as
a proxy for UAX-9 ordering. Glyph advances remain approximate until a font-byte
shaping backend is selected, but the run-order contract is shared.

The derived snapshot contract lives in
`packages/engine/src/textLayoutSnapshot.ts`. It retains the logical source and
Unicode index map while carrying line boxes, positioned glyphs, caret stops,
selection rectangles, diagnostics, and an identity suitable for bounded LRU
caching. `replay.ts` uses it for plain text; callers that own shaping and font
revisions should continue to use the bounded shaping/snapshot caches outside
the paint hot path. Rich-text, path text, and advanced legacy spacing/list
cases retain explicit fallbacks until they can be itemized into the same
snapshot without losing behavior.

Rich text has a matching logical source index in
`packages/scene/src/richTextIndex.ts`. It derives paragraph separators and
run-local UTF-16 ranges without changing stored run order; formatting remains
attached to logical ranges. `richTextLayout.ts` now itemizes those logical
paragraph/run ranges and routes supported measured spans through the same
snapshot renderer; advanced paragraph controls retain a documented fallback.
Canonical scene operations in `packages/scene/src/richTextOps.ts` now also
remove selected properties and replace text at grapheme-safe paragraph ranges,
with adjacent equivalent runs normalized after each transaction.

`characterFormatValue` reports mixed values across a logical selection, and the
existing rich-span inspector uses that state for its bold/italic controls while
keeping formatting changes property-specific.

## Artistic text and outline conversion

Point text and area text share one logical `TextNode`; resizing a frame changes
wrapping, while a font-size edit changes type metrics and an object transform
changes placement. Path text consumes shaped cluster advances and positions each
cluster along the canonical curve. It deliberately does not bend glyph
outlines. Detaching a deleted or missing path returns the node to ordinary text
so a stale path cannot make the artwork disappear.

Per-cluster offsets, rotation, scale, baseline movement, and pair spacing are
stored against grapheme/source indices. Required script clusters and likely
active standard Latin ligatures are not split by the direct-manipulation path;
the user must explicitly disable optional `liga` before editing inside a
sequence such as `fi` or `ffi`. Source edits invalidate these derived
adjustments, and a reset removes only the authored adjustment map.

Arc/bend/wave-style deformation remains a bounded, non-destructive effect. The
operation order is source text → shaping/layout → cluster adjustments →
deformation → appearance. The live warp must be expanded before outline
conversion; the conversion command refuses to bake a different geometry by
accident. Exact monochrome text-to-outlines uses the shaped glyph stream and
records source ranges, face identity, feature values, and variation axes on the
resulting group. Corrupt, missing, collection-face, and colour-font inputs are
reported and leave the editable source untouched.

## Canonical paragraph layout

`packages/engine/src/text/` implements the paragraph-aware layout stage that
the snapshot pipeline is built on:

* `paragraphs.ts` — `splitParagraphs` splits a logical string at U+000A with
  document offsets; `itemizeParagraph` runs UAX #9 (bidi-js) per paragraph and
  retains per-code-unit embedding `levels` for line-local reordering, mirrored
  punctuation, and script-itemized shaping runs (`scriptedRuns`). Common and
  inherited characters (digits, combining marks, emoji) are absorbed into the
  surrounding run so a grapheme is never split by itemization.
* `lineBreak.ts` — `segmentBreakUnits` produces word-level break units via
  `Intl.Segmenter` (CJK per-ideograph, Thai dictionary segmentation where the
  runtime provides it). Units never split an extended grapheme cluster; NBSP is
  whitespace but explicitly non-breaking (`isBreakable`); over-long words are
  re-broken at grapheme boundaries.
* `lineBreakClasses.ts` / `lineBreakProhibition.ts` — the UAX #14 stage.
  `lineBreakClasses.ts` is the read side of
  `scripts/generate-line-break-data.mjs`, which compiles the pinned UCD 16.0.0
  `LineBreak.txt`, `EastAsianWidth.txt`, `UnicodeData.txt` and `emoji-data.txt`
  into range tables (`lineBreakClassesData.ts`). It exposes the raw class, the
  LB1 resolution (`AI`/`SG`/`XX`/`SA` → `AL`, `CJ` → `NS`), `$EastAsian`,
  `[\p{Extended_Pictographic}&\p{Cn}]`, and `resolveLineBreakClasses`, which
  applies LB9 (a combining mark or ZWJ joins its base and later rules ignore
  it) and LB10 (a mark with no base is an ordinary `AL`).
  `lineBreakProhibition.ts` implements UAX #14 §6's prohibition rules and
  answers one question — `isProhibitedBreak(sequence, index)`. The official
  `LineBreakTest-16.0.0.txt` oracle is committed beside the table (3 MB) and
  `text/lineBreakProhibition.test.ts` asserts UAX14-C1's second subcondition
  position by position: **no break opportunity is produced at any of the
  24,799 positions the rules call a non-break.** The first subcondition — that
  *every* allowed break opportunity is produced — is deliberately not claimed:
  word segmentation still decides where Latin breaks may fall, so this stage
  prohibits at least as much as UAX #14 requires and never less. That tailoring
  is disclosed here as UAX14-C1 asks.
* `textLayoutSnapshot.ts` → `buildLayoutUnits` → `mergeUnbreakableUnits` — the
  prohibition stage. Neighbouring units that UAX #14 forbids separating are
  folded into one unit before wrapping, so the greedy fill cannot place a break
  at a reserved position. This gives JLREQ's line-start prohibition (行頭禁則)
  and line-end prohibition (行末禁則) as push-out (追い出し): a line never
  begins with `。` `、` `」` `）` `！` `？` `・` `ー` or a small kana, and never
  ends with `「` `（` `『` `【` `〈`. The offending character migrates to the next
  line together with the character it belongs to. **Hanging punctuation
  (ぶら下げ) is deliberately not implemented**; push-out is a JLREQ-recognised
  alternative, not a silent degradation.
  *Vertical writing* obeys the same rules: `layoutVerticalParagraphLines` fills
  a column cluster by cluster and applies prohibition by retreating the trailing
  cluster group that must not be separated, so a column does not end with `「`
  and the next does not begin with `。` either. When every boundary in the
  column is prohibited the incoming cluster joins the whole column and the
  column overhangs, bounded by `INDIVISIBLE_OVERHANG_LIMIT` times the measure.
  The same pass keeps numbers (`1,234.56`, `$7,890` — LB25), bracketed suffixes
  (`person(s)` — LB30), Hangul syllable blocks (LB26/LB27), Brahmic
  orthographic syllables (LB28a) and emoji modifier sequences (LB30b) intact.
  Three deliberate properties, each measured rather than assumed:
  1. **A unit wider than the measure is split at grapheme boundaries**
     (`splitOverMeasureUnits`), because otherwise a run with no legal break
     anywhere produced a single line: twelve non-starters measured 120 px in a
     40 px box, and a thousand would measure 10 000 px. The split is bounded by
     what the rules may cost:
     - a **line-edge** rule may push a group one grapheme past the measure, so
       `1234。` keeps its full stop off a line start and a long run of `ー`/`…`/`。`
       wraps into lines of at most measure + one grapheme;
     - a **token-internal** rule never exceeds the measure, so `abcd` in a 25 px
       box still splits `ab`/`cd` exactly as it did before this pass existed.
     A token wider than the measure with no arrangement that fits — `$7,890`
     (60 px) in a 50 px box — is therefore broken near its end rather than
     overflowing; where the measure allows, LB25 keeps it whole.
  2. **Dictionary-segmented `SA` scripts** keep their segmentation boundaries
     breakable. LB1's `SA` → `AL` plus LB28 would otherwise hold an entire
     Thai, Lao or Khmer sentence together (measured: a 39-code-point Thai
     sentence collapsed from 7 lines into 2 runs of ~140 px under a 70 px
     measure).
  3. **An unsatisfiable configuration breaks a rule.** When a single character
     fills a column and two prohibited neighbours must stay together, no
     arrangement inside the measure satisfies every rule — `あああ。」` at a
     one-cell measure is the example, and the engine takes the emergency break
     (UAX #14 §3) rather than growing the column without limit. The tests use
     the measures where the rules *can* be satisfied.

## Vertical writing and tate-chu-yoko

Mixed orientation is classified from pinned Unicode data, not script
guesses. `packages/shared/src/verticalOrientationData.ts` compiles the UCD
`Vertical_Orientation` table (16.0.0, regenerated by
`scripts/generate-vertical-orientation.mjs`) into sorted ranges with the
data file's `@missing: R` default plus the header's unassigned-default-U
blocks, so private-use CJK and future CJK planes resolve upright.
`verticalOrientationForCluster` applies two documented browser-practice
layers on top of the table: clusters containing U+FE0F and
Extended_Pictographic bases stay upright (platform emoji fonts supply
upright color glyphs), and U+FE00/U+FE01 switch the orientation of Tu/Tr
bases, which are the characters with typographic vertical forms.

Tate-chu-yoko (`textCombineUpright` on a rich run) is a layout-level
concept: consecutive combined clusters in one shaped run merge into a
single one-em cell (bounded at four clusters), the cell emits one
positioned glyph covering the merged source range, and the painter draws
the whole span horizontally scaled by the measured ratio of the cell to
the span's shaped width — never a fixed shrink factor. Caret stops keep
the ligature policy: stops at the span edges, none inside. The rich span
editor exposes a combine toggle when the host node flows vertically.
Sideways clusters (rotated Latin, digits, Western punctuation) flow at
their shaped horizontal advances — the CSS `sideways` metric contract —
and paint as coherent rotated runs, one draw per consecutive same-format
group, so rotated words keep their kerning and natural rhythm. Canvas
font shorthands append the platform color-emoji families after the
primary family (`withEmojiFallback`), so emoji resolve through an explicit
candidate instead of tofu on minimal Linux font configurations while text
glyphs keep the primary face.

Known open items: vertical caret stops and selection rects are
engine-tested but the editing surface still delegates pointer/caret to the
native textarea; color-font tables are detected but not rendered by a
Varve-controlled rasterizer; Hanging punctuation (ぶら下げ) is not implemented
— line-start prohibition is realised by push-out, so `。` and `、` move to the
next line rather than overhanging the measure; ruby (ルビ) and emphasis marks
(圏点) have no layout path, and no document schema carries them, so there is
nothing to flatten silently today — a document that acquires them needs a
capability warning rather than silent loss. See
[the October 2026 repairs ledger](../audits/world-script-text-repairs-2026-10-15.md)
for the evidence behind each repair and the explicit not-claimed list.

## Research references (checked 2026-09-13)

The implementation choices above are grounded in the [OpenType feature
registry](https://learn.microsoft.com/en-us/typography/opentype/spec/featurelist),
[HarfBuzz shaping API](https://harfbuzz.github.io/harfbuzz-hb-shape.html),
[HarfBuzz cluster guidance](https://harfbuzz.github.io/clusters.html),
[Unicode grapheme rules](https://www.unicode.org/reports/tr29/),
[Unicode bidirectional algorithm](https://www.unicode.org/reports/tr9/),
[Unicode line breaking](https://www.unicode.org/reports/tr14/tr14-53.html)
(revision 53, Unicode 16.0.0 — matched to the pinned data rather than the
latest revision),
[CSS Fonts 4](https://www.w3.org/TR/css-fonts-4/),
[SVG 2 text](https://www.w3.org/TR/SVG2/text.html), and the
[WHATWG Canvas 2D specification](https://html.spec.whatwg.org/multipage/canvas.html).
The installed bindings are `harfbuzzjs` 1.6.0, `rustybuzz` 0.20.1,
`ttf-parser` 0.25.1, and `opentype.js` 2.0.0. These sources establish the
contract; they do not imply that Canvas2D or the native PDF writer exposes all
of the same capabilities.

## Related decisions

* [ADR-0186 — text composition engine](../adr/0186-text-composition-engine.md)
* [ADR-0187 — persisted versus derived text ranges](../adr/0187-persisted-vs-derived-text-ranges.md)
* [ADR-0188 — incremental reflow](../adr/0188-incremental-reflow.md)
* [Unicode text audit](../audits/unicode-text-shaping-audit-2026-08-13.md)

The implementation is intentionally staged. The audit and index foundation
must land before replacing live shaping or renderer paths, so every later
consumer can use the same source-boundary contract.
