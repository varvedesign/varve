# World-script text, vertical writing, emoji, and transparency repairs — 2026-10-15

Evidence-backed ledger for this repair cycle at base commit `e5a52de71`
(pre-cycle master). Each entry: external evidence → Varve state at the base
SHA → root cause → repair → regression coverage. Research accessed
2026-10-15; issue states may have moved since.

## Method and evidence limits

- The nine `storytold/*` trackers were read through the GitHub API and HTML
  pages on 2026-10-15. All exist; the seeded issues are real and were open
  at access time unless noted. Comment bodies for two issues could not be
  read; noted per entry.
- The 2026-10-15 corpus claims of PdfCraft (963/983 clean opens, 958 save
  round trips) are upstream results. Its baseline pins 20 known failures and
  implies — but does not pin — the 983 denominator; its fetcher pins pdf.js
  commit `5d923c96` and hashes 1,455 directory entries, which is not the
  tested denominator. None of those numbers are Varve results and none are
  copied into Varve claims or marketing.
- Varve-side "reproduction" below is code-level (read and traced at the base
  SHA), plus unit/E2E behavior where stated. Physical IME hardware paths and
  packaged native matrices were not exercised in this cycle.

## Ledger

| # | External evidence (accessed 2026-10-15) | Varve state at base `e5a52de71` | Root cause | Repair | Regression |
| --- | --- | --- | --- | --- | --- |
| 1 | DeckCraft #81: Arabic/Hebrew render as boxes in the Wasm build's canvas and exported PNG while the native CLI is fine; foto evidence cited | Varve canvas painted with only the primary font family in the font shorthand; on minimal Linux font configurations (containers, CI) a color-emoji run falls through to tofu on canvas and in exported rasters | No emoji fallback families in the Canvas2D font string; the browser never gets a second candidate that covers emoji | `withEmojiFallback` appends Apple Color Emoji / Segoe UI Emoji / Noto Color Emoji after the primary family in the shaping-measure, horizontal-replay, and vertical-replay font builders; per-glyph matching keeps text glyphs in the primary face | `shaping.test.ts` asserts the appended families order after the primary |
| 2 | PhotoCraft #5159: Arabic correct on canvas but layer names/window titles mirror word order (screenshots); LightCraft #1915: Hebrew folder names as boxes with English UI | `LayersRow` rendered the display name and the rename input as bare LTR-chrome elements; mixed-direction metadata mirrored punctuation and word order around the panel base | No bidi isolation on the metadata surface; the element inherited the document LTR base | Display span and rename input carry `dir="auto"` (first-strong base direction from the authored name); stored names are untouched | `LayersRow.test.tsx` pins `dir="auto"` on the name span for Latin and Arabic-Latin names |
| 3 | (No single external report; CSS Writing Modes + UAX #50 conformance) Vertical-mixed rendering of Western punctuation in vertical Japanese is rotated, not upright, in every conforming browser/renderer | `verticalOrientationForCluster` guessed with script/category regexes: ALL `\p{P}\p{S}` clusters stood upright (ASCII `! ( ) , - . : ?`, quotes, dashes), fullwidth digits fell to sideways, unlisted emoji defaults mishandled | No Unicode `Vertical_Orientation` data; category proxies diverge from UAX #50 on exactly the characters vertical Japanese mixes with kana | Pinned UCD 16.0.0 `VerticalOrientation.txt` compiled to a range table by `scripts/generate-vertical-orientation.mjs` (`verticalOrientationData.ts`, 872 ranges, `@missing: R` default plus the header's unassigned-default-U ranges); clusters resolve U/R/Tu/Tr with documented browser-practice layers (U+FE0F and Extended_Pictographic upright; U+FE00/U+FE01 switch Tu/Tr bases) | `verticalText.test.ts` pins table outcomes: CJK punct upright, ASCII punct/digits rotated, fullwidth digits upright, Tu/Tr fallbacks, PUA upright, mathematical alphanumerics rotated, emoji/ZWJ/flag/keycap upright, VS1/VS2 overrides |
| 4 | (JLREQ/CSS `text-combine-upright` contract; Figma ships no vertical text at all, Affinity declines it — vertical Japanese is a differentiator where faking it is the known complaint) Tate-chu-yoko rendered as each digit upright in its own full-height cell at a fixed 0.72 paint scale | `textCombineUpright` was consulted only at paint time (`verticalTextReplay.ts` scaled every flagged cluster 0.72); layout still stacked the digits vertically; no authoring UI existed | Paint-only proxy: no layout concept of a combined inline cell and no measured fit | Layout merges consecutive combined runs (same `ShapedRun`, bounded at 4 clusters) into one one-em cell emitting a single positioned glyph; paint draws the whole span horizontally scaled by `cellAdvance / measuredSpanWidth` (capped at 1). Caret stops use the ligature policy (span edges only). New combine toggle in the rich span editor, shown when the host node flows vertically | `textLayoutSnapshot.test.ts`: merged pair → one glyph, one-em column height, measured 0.8 scale for 2×10px digits in a 16px cell; unflagged digits stay per-cell; 5-cluster runs wrap at the cap; horizontal mode never combines. `RichTextSpanEditor.test.tsx`: toggle visibility is vertical-only and applies `textCombineUpright` through the character-format path |
| 5 | EffectCraft #839: transparent render silently becomes opaque (alpha=1 everywhere) | Varve's raster export already defaulted to transparency with an explicit matte policy and warnings — the contract existed but had no end-to-end regression | No automated assertion that exported PNGs actually carry alpha | `tests/e2e/export/png-alpha.spec.ts` downloads a real PNG export of an ellipse and asserts corner alpha 0 and ink alpha 255 through pngjs | The spec itself; runs in the browser E2E lane |

## Explicitly not claimed

- **PDF import fidelity.** `packages/import/src/pdf.ts` remains raw-byte
  regex extraction (literal strings, `re` rects) with honest approximation
  warnings; there is no native PDF import renderer. Building the
  mature-interpreter route is a standalone project with its own corpus work;
  nothing in this cycle improves or masks it.
- **Color-font rendering (COLR/CBDT/sbix/SVG tables).** Tables are detected
  and refused for outlining, but no Varve-controlled color-glyph rasterizer
  exists; emoji appearance rides the platform font. The fallback chain above
  makes that ride robust, not self-contained.
- **Sideways-run coalescing.** Vertical sideways (Latin/digit) runs still
  paint cluster-by-cluster in one-em cells; coherent rotated runs with
  shaped advances (CSS `sideways` metric behavior) remain open, tracked in
  the text-pipeline doc.
- **IME qualification.** Editing rides the native textarea with CSS
  writing-mode; composition start/update/end is delegated. No physical IME
  hardware claim is made; record platform-specific IME defects separately.
- **Vertical caret/selection wiring.** Engine vertical caret stops and
  selection rects exist and are unit-tested at the engine level; the editor
  editing surface still delegates pointer/caret to the textarea.

## Upstream reference values (not Varve results)

- PdfCraft README (2026-10-15): "963 of 983 pdf.js test files open and
  render cleanly, 0 crashes; 958 save round trips". Baseline
  `xtask/baselines/pdfjs.json` stores 20 failures (18 open-error, 2
  timeout); 983 − 20 = 963 is consistent but the sweep denominator is not
  pinned in the baseline. Corpus fetcher pins pdf.js
  `5d923c9600b1da6772cca2e167356b13b8a9aa9e` and 1,455 manifest entries.
- Any future Varve corpus claim must state its own denominator, manifest
  digest, selection rules, and platform/backend per the validation strategy.
