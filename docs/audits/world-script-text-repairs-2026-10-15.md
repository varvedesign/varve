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
| 6 | (CSS Writing Modes `sideways` metric contract; vertical audit 2026-09-08 decision 3: "sideways rotates coherent horizontal runs while retaining horizontal shaping metrics") Rotated Latin in vertical text painted cluster-by-cluster in one-em cells | Each sideways cluster drew its own `fillText` after rotate, destroying kerning and spacing every character a full em apart | No run-level concept in the vertical painter; layout had no sideways advance model | Layout flows sideways cells at their shaped horizontal advances; the painters coalesce consecutive sideways cells of a run into one rotated draw (groups break at upright cells, combined cells, format boundaries in rich text, and source non-contiguity). Stroke painter sets its font per run instead of per line | `textLayoutSnapshot.test.ts` pins sideways advances (10px cell for a 10px-advance glyph, 26px mixed column); `replay.test.ts` pins one coalesced `fillText("AB")` per sideways run, per-cluster splits around an upright cell, and unchanged lone-cluster strokes |
| 7 | (Brief §13 "Varve-native, SVG, font and combined-feature fixtures" lane) No Varve-native robustness corpus existed; the only text E2Es were single-string visual checks | One-off specs exercised one multilingual string each; no manifest, no digest, no per-input machine-readable results | No corpus harness | `tests/e2e/fixtures/text-corpus/manifest.json` (14 entries: Latin/combining, Greek/Cyrillic, Arabic/Hebrew bidi with isolates and mirroring, Devanagari conjuncts, Thai breaking, Japanese horizontal + vertical + tate-chu-yoko, regional CJK, emoji ZWJ/flag/keycap, NBSP/ZWSP) driven by `tests/e2e/canvas/text-corpus.spec.ts` through real application entry points (`loadDocument` → `createTextNodeAt` → `updateNode` → live compositor raster → `serializeDocument` → reopen → exact source equality), writing `reports/text-corpus/results.json` with the manifest SHA-256 digest and explicit attempted/completed/failed counts | The spec fails on any non-completed entry; the report is the reproducible evidence artifact |
| 8 | (JLREQ §3.1.7/§3.1.8 行頭禁則・行末禁則; UAX #14 rev 53 = Unicode 16.0.0) A Japanese line could begin with `。` `、` `」` `！` `？` `ー` or a small kana, and could end with `「` or `（` | `segmentBreakUnits` glued *all* punctuation to the preceding word, so an opening bracket could end a line while a closing one could not start it; `canBreakBefore` was dead code and `wrapLines` never consulted `isBreakable`, so no "must not break here" concept existed at all | No line-break class data and no prohibition rules; Japanese breaking rested entirely on `Intl.Segmenter` word boundaries, which is not a typesetting model | Pinned UCD 16.0.0 `LineBreak.txt` + `EastAsianWidth.txt` + `UnicodeData.txt` + `emoji-data.txt` compiled by `scripts/generate-line-break-data.mjs` into `text/lineBreakClassesData.ts` (3,589 ranges); `text/lineBreakProhibition.ts` implements the UAX #14 §6 prohibition rules with LB1/LB9/LB10 resolution; `buildLayoutUnits` merges units that must not be separated so the greedy fill cannot place a break at a reserved position (push-out, 追い出し). Also keeps `1,234.56` / `$7,890` (LB25), `person(s)` (LB30), Hangul blocks (LB26/27), Brahmic syllables (LB28a) and emoji modifier runs (LB30b) intact | `text/lineBreakProhibition.test.ts` commits the official 3 MB `LineBreakTest-16.0.0.txt` oracle and asserts UAX14-C1's second subcondition position by position: **0 of 24,799 prohibited positions allowed — 100.00% soundness across 35,717 positions**. `textLayoutSnapshot.kinsoku.test.ts` pins all 37 line-start-prohibited and 11 line-end-prohibited characters across five measures, offset and caret preservation, the push-out property stated positively (the line holding a bracket also holds what follows it), the bounded-overhang bound for runs with no legal break, and the preserved behaviours (Latin words, over-long word split, over-long CJK, numbers, brackets, Thai/Lao/Khmer measure containment). Vertical writing carries the same invariant on the shapes that strand a bracket, across three measures. Measured load-bearing coverage: disabling the merge fails **34 of the file's 65 cases** — 18 line-start members (the non-`\p{P}` ones: iteration marks and small kana), all 11 line-end members, and the push-out assertion. `lineBreakProhibition.test.ts` proves `isLineEdgeProhibitedBreak` is a subset of `isProhibitedBreak` over the whole oracle, which is what licenses the edge-only folds inside an over-measure split |
| 9 | (Brief §7 "implement missing required paths or preserve their source/appearance with an explicit capability warning rather than flatten silently"; JLREQ §3.3 ruby) Ruby/furigana is authored with no way to learn it will not be drawn | Ruby is fully authored — `RichText.ruby` in the schema, range rebasing in `comicWorkflow.ts`, an "Add ruby" / "Clear ruby" Inspector row — but **no code in `packages/engine` reads it**, so a reading is invisible on canvas, in thumbnails and in every export, with nothing said | `LayoutTextInput`/`LayoutParagraphInput` carry only `text`, `paragraph` and pre-shaped `runs`; the canonical snapshot has no annotation input, so positioning ruby needs a shaping pass for the annotation text that the contract does not currently accept | `TypographySection` now derives the stored annotation count and shows a `role="status"` capability warning stating that the readings are stored but never rendered | `TypographySection.test.tsx`: silent when there is no ruby; warns for one reading with the announcement role and the "never rendered" wording; counts across multiple selected nodes. Rendering itself stays unimplemented and is listed under "Explicitly not claimed" |

### Tailoring findings worth carrying forward

- **South East Asian scripts need the UAX #14 §8 tailoring.** LB1 resolves the
  `SA` class (Thai, Lao, Khmer, Myanmar) to `AL` for implementations without
  dictionary analysis, and LB28 then holds an entire `SA` run together. Applied
  naively on top of Varve's `Intl.Segmenter` word boundaries, a 39-code-point
  Thai sentence collapsed from 7 lines into 2 runs of roughly 140px under a
  70px measure. The merge pass now leaves dictionary-segmented boundaries
  breakable, and `textLayoutSnapshot.kinsoku.test.ts` pins measure containment
  for Thai, Lao and Khmer. The same tailoring had to be applied a second time in
  `mergeEmergencyPieces`, where its absence reintroduced the identical 70px
  overflow — the strengthened tests caught it. Any future rule work must re-run
  those tests.
- **A word-internal prohibition must yield to the emergency split; a line-edge
  prohibition must not.** Regrouping all prohibited pairs inside an over-long
  word rebuilds the original unit, so the word stops wrapping (`epsilon`
  occupies one 70px line at a 60px measure). Regrouping none of them lets an
  over-long `1234。` strand its full stop at a line start. `mergeEmergencyPieces`
  therefore regroups only line-edge rules, via `isLineEdgeProhibitedBreak`, whose
  subset relation to `isProhibitedBreak` is proven over the whole oracle.
- **Indivisible runs overhang rather than break.** `$7,890` is glued by LB25 and
  is 60px at this metric; in a 50px box it is kept whole and the line overhangs.
  There is no layout that both fits and preserves the token, so prohibition wins
  over the measure. `textLayoutSnapshot.kinsoku.test.ts` pins this explicitly.
- **Differential evidence.** Before finalising, every line-breaking case in the
  corpus was laid out through both the new module and `git show HEAD:` of it
  (copied in as a baseline, then removed), at measures 40/70/110/160/240. Texts
  with no prohibition opportunity were byte-identical; the only texts that
  moved were the ones whose diff is documented above. Reproduce with
  `git show <base>:packages/engine/src/textLayoutSnapshot.ts`, the cases in
  the note above, and the widths listed.

### Independent review outcomes

An independent review of the first version of this change (commit `95f41c133`)
found two defects the author's own tests had missed, both of which had been
described in documentation as working:

1. **Vertical writing had no prohibition at all.** `layoutText` dispatches to
   `layoutVerticalText`, whose column fill was purely advance-based; the
   `it.each` protection never reached it. The vertical test added in that commit
   was also **vacuous** — its input contained neither `「` nor `、`, and with the
   test's own metric the column boundaries happened to fall where no assertion
   could be falsified. Vertical Japanese is the JLREQ case this work exists for,
   so this was the most serious finding. Fixed: the column fill now applies
   prohibition by retreating the trailing unbreakable cluster group, and the
   test uses an input that deliberately places `「` at a column end and `。`
   `、` `」` at column starts across four measures.
2. **A merged run could exceed the measure**, contradicting the documentation's
   absolute claim. Re-measured rather than argued about: `$7,890` at 50px, and
   `1234。` emergency-split into a line starting with `。`. Fixed as described
   above, with the documentation corrected to state the real property
   ("prohibition never splits a pair the rules keep together; an indivisible run
   overhangs") instead of the overstated one.

A second review of the integrated result then found two further defects, both
**confirmed by execution** rather than argument, and both in the first fix:

1. **Vertical columns still began with a closing bracket.** The retreat never
   examined the column's first boundary, so when every boundary was prohibited
   it flushed and stranded the incoming cluster: `あああ。」` at a two-cell
   measure produced a column reading just `」`. Fixed by letting the incoming
   cluster join the whole column, bounded by the overhang limit.
2. **A run with no legal break at all produced one unbounded line.** Twelve
   `ー` measured 120px in a 40px box and never wrapped — the previous fix
   bounded merged *tokens* but not runs. Fixed by splitting over-measure units
   after the merge, with the per-rule cost bound above; the same probe then
   produced three lines of at most 40px.

It also found that an emergency split could still end a line with an initial
quote (`“`, `‘`) because the edge predicate only knew `OP` and `GL`; that case
now returns through LB19, and the subset proof over the oracle covers it. A
fourth finding — the class table being rebuilt per over-measure split — is
fixed by threading one lazily built table per paragraph through both passes;
measured on 10 000 characters the refactor is *faster* than the state it
replaced (latin 83.5ms vs 118.9ms, japanese 98.1ms vs 170.1ms).

The review also flagged three lower-severity issues, all now corrected: the
generator's module docstring described a compact derived fixture the script no
longer emits (it writes the full 3 MB oracle) and omitted the `emoji-data.txt`
download from its usage block; the line-start `it.each` cases for `\p{P}`
characters would pass without the new code because `segmentBreakUnits` already
glues them, and the test now asserts the positive push-out property
(`に（参照）`) as well; and an unused `resolveClass` helper plus a stale
`prohibitedBreakBefore` reference in a docstring.

## Explicitly not claimed

- **PDF import fidelity.** `packages/import/src/pdf.ts` remains raw-byte
  regex extraction (literal strings, `re` rects) with honest approximation
  warnings; there is no native PDF import renderer. Building the
  mature-interpreter route is a standalone project with its own corpus work;
  nothing in this cycle improves or masks it. The pdf.js-derived 983-file
  corpus was not reproduced: no Varve PDF renderer exists to point it at,
  and counting directory entries would manufacture a denominator.
- **Color-font rendering (COLR/CBDT/sbix/SVG tables).** Tables are detected
  and refused for outlining, but no Varve-controlled color-glyph rasterizer
  exists; emoji appearance rides the platform font. The fallback chain above
  makes that ride robust, not self-contained.
- **IME qualification.** Editing rides the native textarea with CSS
  writing-mode; composition start/update/end is delegated. No physical IME
  hardware claim is made; record platform-specific IME defects separately.
- **Vertical caret/selection wiring.** Engine vertical caret stops and
  selection rects exist and are unit-tested at the engine level; the editor
  editing surface still delegates pointer/caret to the textarea.
- **Corpus harness limits a review found and this cycle did not fix.** The
  harness's per-entry checks are narrower than its header claims, and each gap
  is now recorded rather than implied: the ink threshold is an absolute dark-
  pixel count over the whole canvas rather than a before/after delta inside the
  node's box, and the board fill is theme-dependent (dark theme's board is
  itself "ink"), so the threshold could be satisfied without the entry painting
  — the spec pins no theme; `nodeText` and `locateTextNode` pick *the first*
  text node with slightly different predicates, which agree only because the
  pristine document has no text node, an invariant nothing asserts; and the
  writing-mode and rich-text options the spec applies are never verified after
  reopen, so a codec that dropped them would still report `completed`. The
  vacuity guard — manifest non-empty, `attempted === manifestEntries`, digest
  equal to the manifest on disk — is now asserted.
- **Corpus coverage limits.** The Varve-native corpus covers the browser
  (Chromium) application path only — it does not exercise packaged desktop
  builds, native shaping, or the PDF import/export lanes, and its
  `results.json` states its own denominators. Physical IME, native Windows/
  macOS matrices, and a PDF-interpreter corpus remain unqualified.
- **Ruby and emphasis marks are not laid out or drawn (diagnosed, warned, not
  fixed).** Ruby is authored end to end — schema, range rebasing, Inspector
  controls — and consumed by nothing in `packages/engine`, so a reading never
  appears on canvas, in a thumbnail or in an export. This cycle makes that
  visible with an Inspector capability warning (entry 9) and does not implement
  rendering: doing so needs a shaping pass for the annotation text, a
  positioned-run kind in the snapshot, paint in the horizontal and vertical
  replays, and export handling. Emphasis marks (圏点) have no schema, UI or
  layout path at all, so there is nothing to flatten silently today — but any
  document that acquires them needs the same treatment.
- **Hanging punctuation (ぶら下げ).** Line-start prohibition is realised by
  push-out (追い出し): `。` and `、` move to the next line with the character
  before them. JLREQ documents hanging as an aesthetic alternative, not a
  requirement, and a hung character would be painted outside a text frame's box
  or clipped away. A line may still overhang where the rules leave no
  alternative — bounded to one grapheme past the measure on a line edge, and to
  twice the measure for an unbreakable vertical column — and that bound is
  pinned by tests rather than left implicit.
- **No native or packaged-build validation of the line-break stage.** The
  conformance result is a pure-data result over the committed oracle plus the
  browser-path layout tests. The Rust/`rustybuzz` shaping backend and packaged
  desktop builds were not exercised, and no independent renderer was used as an
  oracle for line breaking.
- **`SA` combining marks are approximated.** LB1 resolves `SA` to `CM` only for
  General_Category `Mn`/`Mc`; `lineBreakClasses.ts` resolves the whole `SA`
  class to `AL`, because `RawLineBreakClassOf` does not carry General_Category.
  The segmentation keeps `SA` marks inside a grapheme, so no break opportunity
  is created before one — but this is a documented approximation, not the
  literal LB1 rule, and it is the reason the `SA` tailoring above exists.

## Capability matrix

What is actually demonstrated, per workflow. "Verified here" means the check was
re-run on the base SHA of this cycle's line-break work and passed; "carried"
means the ledger entry above names the regression that covers it and it was not
re-run this cycle. Nothing below is inferred from an exported type, a
successfully initialised dependency, or a past audit.

| Workflow | Where it runs | Status | Evidence / limit |
| --- | --- | --- | --- |
| Latin extended + combining marks | canvas layout, save/reopen | Verified here | corpus entry `latin-combining`; `textLayoutSnapshot.test.ts` |
| Greek, Cyrillic | canvas layout, save/reopen | Verified here | corpus entry `greek-cyrillic`; shaping tests |
| Arabic / Persian bidi (digits, punctuation, URLs, diacritics) | canvas layout, save/reopen | Verified here | corpus entries `arabic-mixed`, `bidi-mirroring`; `unicode/bidiConformance.test.ts`. Contextual joining rides the Canvas2D measurement bridge — **the `harfbuzzjs`/`rustybuzz` backends were not exercised this cycle** |
| Hebrew + isolates and mirroring | canvas layout, save/reopen | Verified here | corpus entry `hebrew-isolates` |
| Devanagari + conjuncts | canvas layout, save/reopen | Verified here | corpus entry `devanagari-conjuncts`; glyph form depends on the resolved platform font and was not visually reviewed by a language-competent reader |
| Thai / Lao / Khmer line breaking | dictionary segmentation + prohibition | Verified here | corpus entry `thai-breaking`; measure-containment test in `textLayoutSnapshot.kinsoku.test.ts`. No native-speaker review of break quality |
| Japanese horizontal | canvas layout, save/reopen | Verified here | corpus entry `japanese-horizontal` |
| Japanese vertical (`vertical-rl`, mixed) | canvas layout | Carried (entry 3) + Verified here (entry 8) | pinned UAX #50 orientation table; `verticalText.test.ts`; column-level prohibition in `textLayoutSnapshot.kinsoku.test.ts` |
| Tate-chu-yoko | layout + authoring control | Carried (entry 4) | merged combined cell with measured fit; `RichTextSpanEditor.test.tsx` |
| Line-start / line-end prohibition (行頭禁則・行末禁則) | paragraph layout, horizontal **and** vertical | Verified here | 100.00% soundness vs the committed UAX #14 oracle; 37 + 11 characters pinned across five measures horizontally and across four measures in vertical columns; the edge predicate used inside an emergency split is proven a subset of the full rules |
| Hanging punctuation (ぶら下げ) | — | **Not implemented** | push-out used instead; see "Explicitly not claimed" |
| Ruby / furigana | authored only | **Diagnosed defect, warning only** | schema + UI + rebasing exist; nothing renders; entry 9 |
| Emphasis marks (圏点) | — | **Absent** | no schema, UI or layout path |
| Regional CJK glyph forms | platform font | **Unverified** | coverage is testable, glyph-form suitability is not; no language-competent review |
| Emoji sequences (ZWJ, flags, keycaps, modifiers) | source preservation + platform font | Verified here (source) / carried (paint) | corpus entry `emoji-sequences`; `withEmojiFallback` (entry 1). **No Varve-controlled COLR/CBDT/sbix/SVG rasterizer** |
| Varve-native text corpus (14 entries, browser path) | headless Chromium via real app entry points | Verified here | 14/14 completed, 0 failed, source preserved; `reports/text-corpus/run-706581-1447/results.json` |
| PNG export transparency | node raster export | Carried (entry 5) | `tests/e2e/export/png-alpha.spec.ts`; `pngjs` resolution from `packages/engine` confirmed. The E2E itself was not re-run this cycle |
| PDF import | web app | **Not a renderer** | raw-byte regex extraction with approximation warnings |
| PDF / SVG export of authored text | export lanes | Not validated this cycle | outside this slice's scope |
| Packaged native builds, physical IME | — | Not qualified | see "Explicitly not claimed" |

### Verification status of the ledger entries above

| Entry | Re-run this cycle | Result |
| --- | --- | --- |
| 1 (emoji fallback families) | `shaping.test.ts` | 120 tests across entries 1/3/4/6 passed |
| 2 (bidi isolation on metadata) | `LayersRow.test.tsx` | passed (56 tests across entries 2/4) |
| 3 (UAX #50 orientation) | `verticalText.test.ts` | passed |
| 4 (tate-chu-yoko) | `textLayoutSnapshot.test.ts`, `RichTextSpanEditor.test.tsx` | passed |
| 5 (PNG alpha) | dependency resolution only | `pngjs@7.0.0` resolves from `packages/engine` exactly as the spec resolves it; the E2E was not re-run |
| 6 (sideways run coalescing) | `replay.test.ts`, `textLayoutSnapshot.test.ts` | passed |
| 7 (Varve-native corpus) | **re-run, passed** | `reports/text-corpus/run-706581-1447/results.json`: 14 attempted / 14 completed / 0 failed, `textPreserved: true` for every entry, manifest digest `6cdbfbf6e9f68ad34b9a16439dbfcfedfc50a8b8cb20f7f6d3583d74a0285dd`, 5.2 min wall clock. Reaching it took four attempts: two lease wait deadlines (600 s, 1800 s) with another agent's Playwright lane holding the shared lease, one run that obtained the lease after ~32 min and died in `tests/e2e/global-setup.ts:99` waiting 180 s for `.editor-shell` (the cold-Vite-boot budget the config documents as ~100 s, exceeded at load average ~35), then a success. The run's own path carries the run id, which is the isolation fix below working |
| 8 (UAX #14 prohibition) | `textLayoutSnapshot.kinsoku.test.ts`, `text/lineBreakProhibition.test.ts` | 100.00% oracle soundness; all prohibition and preserved-behaviour tests passed |
| 9 (ruby capability warning) | `TypographySection.test.tsx` | 17 tests passed including the three new ones |
| — (integrated sweep) | `vitest run packages/engine/src packages/editor/src packages/scene/src packages/codegen/src packages/shared/src` on `7bd367cc4` | **19,366 passed, 5 failed, 16 skipped across 1,693 files.** No failure is in text or layout scope. Three are another agent's *uncommitted* colour-proofing work (`packages/editor/src/render/proofProvider.ts` and its test are modified in the working tree, `__dbg__/dbg.test.ts` is untracked; the area's last commit is `88c811adb`). Two are pre-existing timing benches that do not reference the text pipeline at all (`selectionRefinement.bench.test.ts` 14,646 µs against a 10,000 µs budget, `mockupWarp.bench.test.ts` 1,403.8 ms against 1,400 ms) — they ran alongside 1,692 other files at load average ~25, and the text benches pass 16/16 in isolation |

### Concurrent-writer isolation

`tests/e2e/canvas/text-corpus.spec.ts` wrote a fixed
`reports/text-corpus/results.json`. `playwright.config.ts` derives
`VARVE_E2E_OUTPUT_DIR` from PID and port specifically so "a concurrent agent's
`playwright-report` is never clobbered", and a fixed path defeated that: two
corpus runs, or a corpus run and any other lane writing the same name, would
overwrite each other's evidence. The spec now writes
`reports/text-corpus/<VARVE_E2E_OUTPUT_DIR>/results.json` and logs the exact
path, so a run's artifact is both isolated and findable. The successful run
above wrote to `run-706581-1447/` — the PID and port — while other agents held
the same repository, which is the fix demonstrated rather than asserted.

## Upstream reference values (not Varve results)

- PdfCraft README (2026-10-15): "963 of 983 pdf.js test files open and
  render cleanly, 0 crashes; 958 save round trips". Baseline
  `xtask/baselines/pdfjs.json` stores 20 failures (18 open-error, 2
  timeout); 983 − 20 = 963 is consistent but the sweep denominator is not
  pinned in the baseline. Corpus fetcher pins pdf.js
  `5d923c9600b1da6772cca2e167356b13b8a9aa9e` and 1,455 manifest entries.
- Any future Varve corpus claim must state its own denominator, manifest
  digest, selection rules, and platform/backend per the validation strategy.
