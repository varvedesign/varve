# Preliminary Inkscape findings

This page records evidence reviewed so far. A body-screened report is not a
confirmed Varve defect. Discussion review and linked implementation history
remain pending unless stated otherwise in the issue ledger.

## Screening update: issues #3751–3900

The full descriptions for all 149 available nonempty issue bodies in this
interval were read; #3771 was unavailable. This is body screening only: no
discussion notes, linked files, or upstream fixes were checked for this batch.
The following reports are useful regression-test prompts, not verified Varve
defects:

- [#3786](https://gitlab.com/inkscape/inkscape/-/issues/3786) reports a
  segmentation fault when a paint-server URL has a missing closing parenthesis.
  The report is from Inkscape 1.2.1/Arch in 2022 and was not reproduced. It is
  a malformed-SVG robustness case for parser/import paths.
- [#3797](https://gitlab.com/inkscape/inkscape/-/issues/3797) and
  [#3798](https://gitlab.com/inkscape/inkscape/-/issues/3798) describe recursive
  filter application leading to unbounded load-time CPU and memory use. Both
  are old 1.2.1-era reports; sample files and discussion history were not
  reviewed. They motivate bounded resource evaluation only if Varve exercises
  an equivalent recursive filter graph.
- [#3822](https://gitlab.com/inkscape/inkscape/-/issues/3822) reports PDF
  import placing U+000C in generated SVG, after which extension tools fail XML
  parsing. The report includes a specific import-to-extension sequence but is
  Windows/Inkscape 1.2-era and remains unconfirmed here. This is a document
  integrity and downstream-validation case.
- [#3840](https://gitlab.com/inkscape/inkscape/-/issues/3840) reports
  optimized SVG save dropping text objects using `inline-size`. The original
  file reportedly opens before save; the report is Fedora/Inkscape 1.2.1 and
  its attachments were not inspected. It is a useful lossless-serialization
  regression category.
- [#3885](https://gitlab.com/inkscape/inkscape/-/issues/3885) reports the
  Poppler/Cairo PDF importer ignoring the requested page and loading page 1.
  [#3886](https://gitlab.com/inkscape/inkscape/-/issues/3886) reports flipped
  text from the internal PDF importer where another importer and browser
  render the pattern upright. Importer mode, requested page, and text
  orientation are distinct PDF fidelity checks; the linked examples and
  discussion were not inspected.
- [#3899](https://gitlab.com/inkscape/inkscape/-/issues/3899) reports
  keyboard-applied bold/italic text being saved or copied with the wrong font
  size, while panel-applied formatting survives. It is an old Ubuntu 20.04 /
  Inkscape 1.1.2 report; use as a text style round-trip case, not evidence of a
  current Varve problem.

## Screening update: issues #601–640

Thirty-eight new full-description reads in this interval produced several
useful test prompts. #602 and #613 were already counted. No discussion notes,
attachments, or upstream fixes were inspected for this batch, and none of the
reports below establishes a Varve defect:

- [#593](https://gitlab.com/inkscape/inkscape/-/issues/593) and
  [#616](https://gitlab.com/inkscape/inkscape/-/issues/616) describe PDF import
  replacing ligature text with missing or replacement characters for some
  source PDFs/fonts. The reports are historical and linked files were not
  retrieved. They motivate targeted glyph-map coverage without assuming every
  PDF text run can be preserved as editable text.
- [#594](https://gitlab.com/inkscape/inkscape/-/issues/594) and
  [#595](https://gitlab.com/inkscape/inkscape/-/issues/595) report RTL alignment
  and Persian ZWNJ shaping differences. These are old-version reports; their
  fixtures were not inspected. They are international text layout and shaping
  regression categories.
- [#608](https://gitlab.com/inkscape/inkscape/-/issues/608) says changing an
  Offset LPE's units from 5 mm to inches changes the amount to 5 inches rather
  than preserving the physical value. If Varve exposes unitful parameters,
  conversions should preserve the represented quantity; the report is not a
  direct match to a verified Varve feature.
- [#610](https://gitlab.com/inkscape/inkscape/-/issues/610) reports undo after
  editing B-spline/spiro paths dropping curve metadata until additional undo
  and redo steps. This is a useful history-round-trip test for geometry that
  stores more than its visible control points.
- [#623](https://gitlab.com/inkscape/inkscape/-/issues/623) reports paste
  operations on a path effect modifying its source and other copies, suggesting
  shared mutable state. [#626](https://gitlab.com/inkscape/inkscape/-/issues/626)
  separately reports a crash when copying a path with Attach Path LPE. Both
  are historical and their sample files were not opened; test independent
  copies and invalid linked references if a comparable Varve path-effect
  workflow is exercised.
- [#635](https://gitlab.com/inkscape/inkscape/-/issues/635) reports SVG mask
  content rendering differently from GIMP, and [#636](https://gitlab.com/inkscape/inkscape/-/issues/636)
  says moving an object out of a hidden layer can leave inherited `display:none`
  in place. The external mask fixture was not opened; the layer report's
  behavior should be compared against SVG/CSS inheritance rules before
  treating it as a defect.
- [#639](https://gitlab.com/inkscape/inkscape/-/issues/639) reports a document
  license choice disappearing on save/reopen. It is a small but concrete
  metadata persistence test, subject to checking the format's intended storage.

## Screening update: issues #641–680

Thirty-four previously uncounted bodies were read in this interval. #643,
#644, and #652 were unavailable; #651, #670, and #678 were already screened.
Discussion history, sample files, and linked fixes remain pending. These
reports suggest test categories only:

- [#641](https://gitlab.com/inkscape/inkscape/-/issues/641) reports a resize
  drag ending over the palette changing fill color unexpectedly and interrupting
  undo. Test that pointer release outside the canvas cannot trigger another
  action and that one gesture remains one undoable transaction.
- [#642](https://gitlab.com/inkscape/inkscape/-/issues/642) describes copied
  SVG2 text with broken position/editing, where editing the duplicate can alter
  the source. [#658](https://gitlab.com/inkscape/inkscape/-/issues/658) reports
  copied content inheriting the wrong opacity from a partially transparent
  layer. Together these are copy isolation and inherited-style round-trip
  checks; the old report files were not inspected.
- [#646](https://gitlab.com/inkscape/inkscape/-/issues/646) reports numeric
  width/height entry producing incorrect geometry when thick strokes are not
  scaled. This is a useful constraint test for whether the interface reports
  path bounds or painted bounds; the original example was not opened.
- [#647](https://gitlab.com/inkscape/inkscape/-/issues/647) reports clone
  stroke-width changes when scaling the original and an unexpected style change
  on the source. It motivates checking clone style isolation, but the source
  file and discussion were not inspected.
- [#650](https://gitlab.com/inkscape/inkscape/-/issues/650) describes a mixed
  text selection showing one font and an averaged size, then failing to apply
  the displayed font. This is a mixed-value inspector-state test, not evidence
  of a Varve failure.
- [#654](https://gitlab.com/inkscape/inkscape/-/issues/654) reports a crash
  when combining CLI selection with verbs; [#656](https://gitlab.com/inkscape/inkscape/-/issues/656)
  reports a Trace Bitmap crash on a large raster without clear size bounds.
  Both are historical CLI/import robustness prompts; no reproducer was run.
- [#667](https://gitlab.com/inkscape/inkscape/-/issues/667) reports spraying or
  cloning an Attach Path effect breaking shared references. [#669](https://gitlab.com/inkscape/inkscape/-/issues/669)
  reports Path Outset deleting some valid generated paths. Their age and
  feature-specific behavior require an exact equivalent before prioritizing
  implementation work.

## Screening update: issues #5791–6000

One hundred ninety-eight available, nonempty descriptions were read in this
range. Eleven previously screened bodies were excluded and #5956 has no body.
No issue discussions or linked attachments were reviewed; the following are
body-only examples that may inform focused tests:

- [#5988](https://gitlab.com/inkscape/inkscape/-/issues/5988) reports
  ungrouping thousands of objects freezing all windows for 5–10 minutes at
  full CPU use. The issue body references a sample and Sysprof profile, neither
  of which was opened. This supports measuring large-tree operations with a
  bounded, generated document rather than assuming Varve shares the same cost.
- [#5989](https://gitlab.com/inkscape/inkscape/-/issues/5989) reports Cmd+C/V
  in toolbar numeric fields routing to the drawing on macOS. This is a
  focus/shortcut integration case; the environment-specific report was not
  reproduced.
- [#5991](https://gitlab.com/inkscape/inkscape/-/issues/5991) reports a crash
  loading an older SVG with Rotate Copies LPE. [#5995](https://gitlab.com/inkscape/inkscape/-/issues/5995)
  reports selection or spraying crashing in nearest-time hit testing for
  scaled ellipses. Their source files and histories were not reviewed; they
  suggest load-time effect migration and degenerate/curved hit-test coverage.
- [#5999](https://gitlab.com/inkscape/inkscape/-/issues/5999) reports the same
  SVG importing with incorrect fills while opening it directly works, on
  macOS 26. This is a useful distinction between document-open and import
  paths, though the unusually specific environment needs confirmation.
- [#5982](https://gitlab.com/inkscape/inkscape/-/issues/5982) reports
  self-dropping a group in the Objects panel crashing in `fillBetweenMany` /
  `toLayer`; #5814 describes a similar failure class. These are explicit
  invalid-reparenting guards to test where Varve exposes drag-and-drop tree
  operations.
- [#5948](https://gitlab.com/inkscape/inkscape/-/issues/5948) reports a
  regression in creating a gradient fading to transparency. The cause/fix
  history remains pending, so it should be compared against the intended
  gradient defaults before treating it as a product gap.

## Candidate: large raster save memory

Inkscape [#6398](https://gitlab.com/inkscape/inkscape/-/issues/6398) reports
RAM doubling and possible OOM crashes while saving 100+ linked 4K JPEGs. The
reporter says autosave is unaffected and warns that the attached 400-image ZIP
can lock up a system. The sample ZIP was not downloaded or executed.

Varve currently embeds assets in `Document.assets`, assigns the same content a
shared asset ID, and strips duplicate per-fill image payloads during
serialization. This makes the linked-image failure mechanism a poor direct
match. Varve still produces a full JSON serialization at save time, so a
transient peak with many *distinct* large assets remains a hypothesis to
measure. No Varve memory failure has been reproduced. Review the issue thread,
then use generated image data to compare repeated identical placements with
distinct assets and measure encode/save/reopen memory before deciding whether
an implementation change is warranted.

A second older Inkscape report, [#2800](https://gitlab.com/inkscape/inkscape/-/issues/2800),
also reports about 14.8 MiB retained per save with one linked large PNG,
contrasting 1.1 with 1.0.2. That report's 7z attachment was not downloaded;
discussion and resolution history remain pending. This strengthens the
recurrence signal for save-time memory complaints, but still does not show a
Varve defect.

## Candidate: PDF text fidelity

Inkscape [#6380](https://gitlab.com/inkscape/inkscape/-/issues/6380) reports
that its internal PDF import changes “information” to “informaton”. The
reported PDF upload returned HTTP 403 in this review; the source PDF and
comment thread have not been inspected. Varve's bounded PDF parser already
resolves text through `/ToUnicode` or declared font encoding and reports
unmapped characters instead of inventing text. Compare this exact fixture if
it becomes accessible; until then, do not change decoding based on the title
or report alone.

## Candidate: large PDF exports with omitted artwork

Inkscape [#5782](https://gitlab.com/inkscape/inkscape/-/issues/5782) reports
that a 100 × 70 cm document at 300 ppi exported without 16 embedded images and
9 captions on macOS and Windows. The thread narrows the trigger to an empty text
object with a singular transform (zero determinant): hiding, deleting, or
reordering it changed the export. Inkscape linked the report to [#691](https://gitlab.com/inkscape/inkscape/-/issues/691),
an older PDF-export failure involving non-invertible matrices. A maintainer
reported that #691 was fixed in Inkscape 1.0.1, but #5782 was still assigned to
1.4.3 and was closed as a duplicate without evidence of a #5782-specific fix.
The associated merge request is not identified in the public links.

The 29 MB attached SVG and 11 MB PDF were not downloaded or inspected. The
reporter also noted incomplete testing on 1.5-dev; later comments identified
missing-font and long-URI diagnostics, so those do not establish a separate
image-loss cause.

Varve's current PDF path sends any subtree containing text or a non-identity
linear transform through whole-subtree rasterization. A singular text node
therefore stays in the same raster replay as its image and shape siblings and
does not reach the native PDF writer as a singular text matrix. Source review
found no equivalent “bad object aborts later siblings” path, but a focused
real-export regression and independent-renderer inspection are still needed
before marking the workflow handled.

**Separate Varve gap found during this investigation:** the native PDF and
PDF/X bridge previously ignored malformed supplied image-manifest JSON and
continued without those image resources. Because the print engine uses a
checkerboard when image data is missing, this could return a successful PDF
with placeholder content. This is not the cause of #5782 and the change below
does not fix Inkscape's singular-transform failure. Varve now returns a clear
error for an invalid supplied manifest on all four native PDF/PDF/X command
paths. The parser consumes the owned JSON string so its base64 buffer can be
released immediately after decoding. A Rust regression test covers the
ordinary PDF command; the UI error is covered by a desktop-bridge E2E test.
The Rust parser regression passes. The desktop error-state E2E is pending: its
typecheck fails on committed `master` because
`packages/scene/src/index.ts` exports absent `./nodeResize`. An uncommitted
copy exists in the shared root worktree, so it was not copied into this
isolated validation tree. This does not validate or resolve the separate
#5782 visual-export report.

Comparable first-hand reports include [Illustrator users reporting missing
artwork after PDF export](https://community.adobe.com/questions-652/adobe-illustrator-2025-images-not-exporting-as-pdf-815385)
and a separate [Illustrator report about missing PDF
items](https://community.adobe.com/questions-652/items-missing-from-pdf-when-exporting-from-illustrator-782411).
Those reports include conflicting viewer behavior and unconfirmed theories;
they support checking actual PDF resources and more than one renderer, not a
claim that Varve or Inkscape shares their causes. Affinity's [PDF text editing
discussion](https://forum.affinity.serif.com/index.php?/topic/199661-editing-pdf-text-layout-go-crazy-v24-22024/)
also documents how missing embedded fonts and substitution can change editable
text layout while page-image passthrough preserves appearance but loses text
editability.

**Website impact:** no copy change is justified. The fix changes an error path,
not advertised PDF behavior or the scope of supported PDF content. Recheck the
file-format and print-export pages after validation.

## Candidate: crashes during filter/clip PDF export

Inkscape [#203](https://gitlab.com/inkscape/inkscape/-/issues/203) documents a
confirmed crash while exporting filtered content with a clip path. Maintainers
traced the issue to PDF export rasterizing filtered clip paths even though SVG
clip geometry should ignore filters. The fix
[MR 2907](https://gitlab.com/inkscape/inkscape/-/merge_requests/2907), later
cherry-picked in [MR 2923](https://gitlab.com/inkscape/inkscape/-/merge_requests/2923),
stopped rasterizing those clip paths. The reporter confirmed the minimal
reproducer no longer crashed; the larger original document remained unverified
because it exceeded the reporter's available memory. Related reports #481 and
#1573 were duplicate variants.

Varve sends PDF subtrees with effects or masks through a live canvas raster
fallback, so this is a relevant workflow to exercise. The Inkscape report does
not establish that Varve shares Inkscape's Cairo failure, and no equivalent
Varve crash has been reproduced. Keep the targeted export regression pending
until a real document with a filtered clipped raster is exported and inspected.

Inkscape [#1739](https://gitlab.com/inkscape/inkscape/-/issues/1739) separately
reports memory growth, crashes, or a missing fill for masked images inside SVG
patterns. Its small embedded-image sample shows reported peak memory growing
from roughly 104 MB at a 10×10 pattern to 1.3 GB at 128×128; a 150×150 case
crashed and produced a zero-byte PDF. Its two comments and linked reports were
reviewed; the original sample and attachments have not been downloaded.
Varve's print pipeline expands supported image tiles into PDF content and caps
the estimated tile count, but does not implement SVG masks nested inside
arbitrary SVG patterns. The reported workaround converts the pattern to an
object, which can change paint order.

Inkscape [#1018](https://gitlab.com/inkscape/inkscape/-/issues/1018) reports
multi-gigabyte memory growth and a black canvas when zooming into image-based
patterns. Its description attributes the growth to a Cairo-renderer pattern
surface that scales with the zoomed pattern tile, even when only a small part
of the tile is visible. The issue body includes a summary of four comments but
those individual notes have not been retrieved. Varve's interactive renderer
uses a decoded image tile with bounded repeated instances; it does not allocate
a Cairo-style tile bitmap proportional to zoom. This is a related resource
class, not evidence of the same renderer defect. The still-open Inkscape Inbox
[#9599](https://gitlab.com/inkscape/inbox/-/issues/9599) reports 30–40 GB RAM
use for high-resolution images used as patterns and remains linked evidence.

Other Inkscape issues describe crashes for patterns on both fill and stroke
([#4924](https://gitlab.com/inkscape/inkscape/-/work_items/4924)), a patterned
fill that leaves an unreadable PDF ([#5539](https://gitlab.com/inkscape/inkscape/-/work_items/5539)),
swatch `gradientTransform` export failures ([#5624](https://gitlab.com/inkscape/inkscape/-/work_items/5624)),
and missing corner markers after the CapyPDF merge
([#5696](https://gitlab.com/inkscape/inkscape/-/work_items/5696)). These are
currently body-only reports; discussion retrieval has not reached them. Their
specific Cairo/vector-marker failure paths are not implemented by Varve's PDF
exporter. Varve expands supported raster image tiles directly and enforces a
100,000-tile ceiling. A regression has been added to exercise that ceiling and
check that omitting an over-budget pattern preserves neighboring solid
artwork. A Poppler render of the over-budget regression was visually inspected:
the pattern is omitted and neighboring artwork remains visible. An independent
rendered-PDF check of alpha-tile appearance remains desirable.

Additional discussion review found a useful split between transferable and
product-specific failures:

- [#86](https://gitlab.com/inkscape/inkscape/-/issues/86) reports clipped
  pattern PDF OOM and missing output. A later user said it no longer reproduced
  on current Inkscape master; no specific fix for this issue was confirmed.
- [#155](https://gitlab.com/inkscape/inkscape/-/issues/155) reports filtered
  artwork clipped at the page edge instead of extending into PDF bleed. Varve's
  filtered-PDF and PDF/X-with-bleed path still needs a real output comparison.
- [#252](https://gitlab.com/inkscape/inkscape/-/issues/252) reports masked
  artwork reduced to low-resolution raster output. MR 5000 improves some mask
  cases but explicitly does not resolve all mask-export fidelity. Varve also
  rasterizes masks for PDF; a detailed fixture needs visual inspection.
- [#4717](https://gitlab.com/inkscape/inkscape/-/issues/4717) reports a Cairo
  crash for a large mixed image/vector SVG. Varve applies decoded-image and
  raster-surface budgets, but the exact failure mechanism is not shared.
- [#529](https://gitlab.com/inkscape/inkscape/-/issues/529) was a historical
  filter export issue that the reporter confirmed fixed. [#112](https://gitlab.com/inkscape/inkscape/-/issues/112)
  concerns saving a georeferenced PDF imported from QGIS, a geospatial round-trip
  outside Varve's current print contract. [#481](https://gitlab.com/inkscape/inkscape/-/issues/481)
  and [#1573](https://gitlab.com/inkscape/inkscape/-/issues/1573) duplicate the
  filtered-clip failure in #203. [#328](https://gitlab.com/inkscape/inkscape/-/issues/328)
  has conflicting reproduction reports and no stable mechanism.

None of these source reports alone proves a Varve defect. The bleed and mask
fidelity cases remain the clearest candidates for real PDF visual tests; the
others map to existing bounds or to features Varve does not claim to support.

These reports reinforce the need to test export completion, output validity,
and visual content on complex documents. They do not justify claims of shared
causes, and they do not currently justify marketing copy changes.

## Existing protections: interrupted saves and oversized raster output

Inkscape [#260](https://gitlab.com/inkscape/inkscape/-/issues/260) is an
unconfirmed historical report that a crash during save could truncate the
original file. Its sole user comment links an inbox request for atomic export.
Varve's native filesystem bridge already writes a sibling temporary file,
flushes it, then replaces the target; the existing regression
`atomic_write_replaces_content_without_leaving_staging_files` covers the
successful replacement path. This source report does not establish a Varve
data-loss defect. Crash/power-loss injection and browser-download semantics
remain separate validation questions, not claims covered by that unit test.

Inkscape [#543](https://gitlab.com/inkscape/inkscape/-/issues/543) records a
blank or corrupted PNG near Cairo's 32,767-pixel axis limit, with later reports
of zero-byte exports and a proposed alert. Varve already bounds raster
surfaces to 16,384 pixels per axis and 33,554,432 pixels per surface, fits
oversized export requests while preserving aspect ratio, and displays a
warning that names the requested and fitted dimensions. Existing
`rasterSurface.test.ts` cases cover area and axis constraints; export tests
assert the scale-down warning. This is a directly relevant failure class with
an existing defensive behavior, not a new Varve defect. The 16K/32M policy is
an application allocation budget, not a claim about the maximum size supported
by every browser or image format.

Neither finding currently requires a code or marketing change. Recheck the
save and raster-export pathways against updated reports before closing their
broader issue groups.

## Screened adjacent reports: zoom, import bounds, and editing cost

Inkscape [#3975](https://gitlab.com/inkscape/inkscape/-/issues/3975) reports
a Cairo crash when zooming to the corner of a 32,768-pixel blurred rectangle;
the report explicitly relates it to [#3580](https://gitlab.com/inkscape/inkscape/-/issues/3580).
Varve caps interactive zoom at 6,400% and raster surfaces at 16,384 pixels
per side / 33,554,432 pixels per surface, which limits the same unbounded
surface-growth class. Those limits do not prove that a large blurred object
renders correctly near Varve's own ceilings. A generated, bounded blur fixture
at the zoom/raster boundary is still a useful regression candidate; do not use
the reported Cairo trace as evidence of a shared renderer bug.

Inkscape [#5983](https://gitlab.com/inkscape/inkscape/-/issues/5983) reports a
black display and crash while zooming around a linked JPEG 65,000 pixels wide
in Inkscape 1.4.2 on macOS. The linked
[Wikimedia image](https://commons.wikimedia.org/wiki/File:Panorama_of_Sydney_from_Lavender_Bay_%281875%29.jpg)
is 65,500 × 3,273 pixels (214,381,500 total) and 73.2 MB encoded. Varve's
65,535-pixel axis limit alone would accept that width, but the image is far
above Varve's 64 Mi-pixel decoded-area budget and is rejected by the header
gate before decode. A focused regression test now uses a synthetic JPEG header
with those exact dimensions to assert the rejection. This establishes a safe
import boundary for the linked file's dimensions; it does not reproduce or
explain Inkscape's black-canvas zoom crash. The original image was not
downloaded, and the two issue notes remain pending review.

Inkscape [#1231](https://gitlab.com/inkscape/inkscape/-/issues/1231) reports
rapid memory growth while dragging roughly 200 rectangles after applying a
Fill and Stroke style with a visible stroke; the default fill-only style and
`stroke:none` reportedly avoid it. This is an old Windows/Inkscape 1.1-dev
editing path, not a PDF or file-size issue. Varve's canvas has different
selection and stroke rendering code, so it is a reasonable bounded stress
scenario if the comment history identifies a transferable trigger. Its 15
reported notes have not been retrieved yet.

Inkscape [#5878](https://gitlab.com/inkscape/inkscape/-/issues/5878) reports
memory exhaustion while manipulating a path with the Powerstroke live path
effect and `CubicBezierJohan` smoothing. The backtrace enters path dash
generation and outline/bounding-box work. Varve has no equivalent live-path-
effect editing pipeline, so this is not a direct feature match. It can still
inform a general stress test only if a Varve workflow reaches similarly
unbounded outline generation; no such path has been established.

Inkscape [#5976](https://gitlab.com/inkscape/inkscape/-/issues/5976) reports
that resetting color in the Recolor Marker dialog crashes Inkscape. The body
contains a long repeated Windows stack trace and one reported note. Varve has
path endpoint arrowheads but no equivalent marker recoloring dialog or SVG
marker workflow, so no direct implementation or marketing change follows from
this report. The discussion remains pending, and the large body was screened
without executing or rendering its embedded media.

## Screened rendering and export edge cases

Inkscape [#721](https://gitlab.com/inkscape/inkscape/-/issues/721) reports
that a blue multiply-blended circle was missing its blend result in PDF after
a green blur was rasterized. The report compares Inkscape 0.92.4 and 1.0-alpha
and includes two linked SVG samples that were not downloaded. Varve's standard
PDF path uses the live compositor raster fallback for unsupported effects,
which makes overlapping blend-plus-blur output a focused visual test. The old
Cairo-specific cause is not established as shared, and no Varve defect has
been reproduced.

Inkscape [#670](https://gitlab.com/inkscape/inkscape/-/issues/670) reports
dashed polygon strokes differing between on-screen display and PNG output in
Inkscape 0.92.4 on Windows, with a minimal SVG linked. This is a useful
canvas/export parity scenario for Varve's dashed-stroke renderer, but the issue
is historical and its linked sample has not been checked against current
Inkscape or Varve. Preserve it as a regression candidate until a bounded
reproducer is available.

Inkscape [#894](https://gitlab.com/inkscape/inkscape/-/issues/894) reports
zero-length SVG paths with square caps rendered in Firefox but not Inkscape.
The reporter notes that the sample changed after an optimization and that the
expected result was uncertain. Because the expected semantics are unsettled,
Varve should only adopt this as a visual test after checking the current SVG
specification and sample; no change is justified from the report alone.

Inkscape [#1063](https://gitlab.com/inkscape/inkscape/-/issues/1063) reports
white bars in large radial gradients in Cairo while comparing other SVG
backends. Varve's browser renderer does not use Cairo, so this does not show a
shared failure. Large-coordinate radial gradients are still a reasonable
cross-renderer test case; the referenced SVG and inbox samples were not
downloaded.

Inkscape [#1351](https://gitlab.com/inkscape/inkscape/-/issues/1351) reports
severe editing lag from its Simplify live-path effect, even after removing
embedded images. Varve has no equivalent live-path-effect feature, so there is
no direct implementation target.

Other PDF reports reinforce the need for real output checks. Inkscape
[#685](https://gitlab.com/inkscape/inkscape/-/issues/685) reports overlapping
colored text in a different order on the canvas and in PDF; its reporter says
the PDF agrees with the SVG text-order specification and other renderers. The
linked sample was not downloaded. Varve routes text through the live compositor
for standard PDF, so comparing the canvas and resulting PDF is a useful parity
check, not a presumed defect.

Inkscape [#694](https://gitlab.com/inkscape/inkscape/-/issues/694) reports
masked artwork disappearing from PDF under a combination of transforms,
clipping, and blur. [#712](https://gitlab.com/inkscape/inkscape/-/issues/712)
reports masks rasterized at visibly low resolution, plus duplicate masked
objects disappearing when they share a layer. These are old reports with
linked SVG/PDF examples that remain uninspected. Varve also rasterizes masked
subtrees for standard PDF, but has a different renderer and scene structure.
Inspect output resolution and verify every masked sibling remains visible in
generated PDFs before treating the failure class as closed. No matching Varve
defect has been reproduced.

Inkscape [#651](https://gitlab.com/inkscape/inkscape/-/issues/651) reports
that selecting an embedded image in its XML Editor froze the whole application
in a 2019 beta. Varve has no equivalent XML Editor selection workflow, so this
does not map to a current product feature.

## Not directly transferable: relative image paths in extensions

Inkscape [#6477](https://gitlab.com/inkscape/inkscape/-/issues/6477) reports
linked image paths being rewritten after running an extension and points to
[#1313](https://gitlab.com/inkscape/inkscape/-/issues/1313). The earlier report
attributes path drift to extension execution converting relative paths and
failing to restore them. Inkscape's [1.0.1 release notes](https://inkscape.org/release/inkscape-1.0.1/)
say relative paths to linked images no longer break when running an extension.
Later first-hand reports [#5482](https://gitlab.com/inkscape/inkscape/-/issues/5482)
and [#6483](https://gitlab.com/inkscape/inkscape/-/work_items/6483) describe
similar path corruption in Inkscape 1.4 and 1.4.2. This establishes recurrence
of the user-visible failure across versions, but does not prove the same code
path regressed. The seven comments on #6483 and 13 notes on #1313 are being
checked in the durable crawler; the first-hand issue bodies and 1.0.1 release
note have been reviewed.

Varve's `DocumentAsset` storage and SVG import currently use embedded,
content-addressed image assets; remote and filesystem image references do not
become mutable linked paths. There is no equivalent third-party Python
extension API that rewrites an SVG href against its installation directory.
The reported mechanism is therefore outside Varve's current product path. The
design invariant remains: export or local transformation must preserve an
asset's document identity and must not silently replace an unresolved asset
with a successful-looking placeholder. No site-copy or feature change is
justified by the current evidence.

## Failure reports from other design tools

These first-hand complaints are comparison evidence, not proof that Varve
shares the same defects. They help identify the output and editing workflows
that should be checked before closing this audit.

Penpot users report blurred or downsampled images in large-format PDF exports
([#1899](https://github.com/penpot/penpot/issues/1899), still open in the
reviewed issue history; [#7047](https://github.com/penpot/penpot/issues/7047),
an image-resolution complaint tracked separately). Varve's native PDF image
manifest preserves source image samples for supported image fills, while
effect fallbacks rasterize through the live renderer and PDF/X uses a separate
flattened print path. The UI's minimum-image-resolution setting is a preflight
floor; it does not resample images. Validate one high-resolution placed image
in standard PDF and PDF/X output, including an effect-rasterized case, before
making a broad fidelity claim. No matching Varve defect is established.

Penpot [#10208](https://github.com/penpot/penpot/issues/10208) reports a
bold Work Sans substitution that made auto-width text wider and clipped the
export; Penpot tracked the fix in [#10238](https://github.com/penpot/penpot/issues/10238),
and the reporter confirmed it in Penpot 2.17.0. Varve's standard PDF and
raster export wait for export fonts to become ready, and the native PDF/X path
collects font data and rejects missing font records. Existing tests cover the
readiness wait and missing-font data validation. This is an existing Varve
protection to retain; it is not evidence that every external font will render
with the same metrics in every viewer.

Penpot [#10496](https://github.com/penpot/penpot/issues/10496) describes a
save-validation failure after teams used a shared custom font and imported raw
SVG content with dangling children. Penpot fixed it in [#10837](https://github.com/penpot/penpot/issues/10837),
and the reporter later confirmed the problem no longer reproduced. Varve's
SVG import and document persistence use different data structures, and no
matching Varve failure was found in this review. Keep imported-SVG save/reopen
round trips in the regression set when that area is changed; do not infer a
Varve defect from the Penpot report alone.

An Adobe Illustrator forum report describes QR artwork missing from a saved
PDF while it remains visible in InDesign; replies point to a collapsed
MediaBox/CropBox, and the thread also contains conflicting diagnoses. This is
a useful reminder to inspect page boxes and open generated PDFs in an
independent renderer alongside application screenshots. It does not establish
a general Illustrator failure or a Varve bug.

**Website impact:** these findings do not change a supported-format boundary,
file-size limit, or measured fidelity result. Leave the marketing website
unchanged until the targeted PDF artifacts are validated; then update only a
specific claim if the evidence shows it is inaccurate or a fix adds a verified
capability.

## Current disposition

One native PDF manifest error-path guard has been prepared during the #5782
workflow investigation; it addresses a separate malformed-resource failure,
not #5782's singular-transform cause. A focused real-export check is still
needed to confirm the source workflow is handled in Varve. The other findings remain
body-only and do not yet justify code changes. The full Inkscape issue corpus
and comment crawl are still being reviewed; this page is an interim evidence
record, not the final product audit. Initial website review of
`features/local-first.astro`, `support/troubleshooting.astro`, and
`docs/file-formats.astro` found existing low-memory/save-recovery guidance and
an explicit description of PDF import as a bounded local parser. No unsupported
save-memory or full-fidelity PDF claim was found in those surfaces, so no site
copy change is justified for these unconfirmed candidates. Recheck the relevant
feature and troubleshooting pages for every later implementation batch.

## Cross-application PDF compatibility and zoom resource limits

Inkscape [#6242](https://gitlab.com/inkscape/inkscape/-/issues/6242) reports
that its CapyPDF-generated PDF 2.0 files fail when included by LuaLaTeX, while
QDF-normalized files work. The report explicitly identifies CapyPDF/LuaTeX
interoperability as the likely boundary. Varve's standard PDF writer emits
PDF 1.4, and PDF/X-4 emits 1.6; both are within the reported LuaTeX 1.7
maximum. This rules out the specific PDF 2.0 version trigger, but does not
claim LuaLaTeX interoperability has been tested. No marketing change or format
change is supported by this report. Discussion review remains pending.

Inkscape [#2190](https://gitlab.com/inkscape/inkscape/-/issues/2190) reports
garbled or unopenable PDFs when embedding mixed/bold text fonts on Windows in
Inkscape 1.0.2. The report lists inconsistent reproduction and is tied to an
older font embedding/subsetting path. Varve's PDF text export has separate font
embedding and subsetting code, so this is a useful cross-viewer test category,
not evidence of a matching defect. Reader coverage for embedded and subset
fonts remains pending.

Inkscape [#3580](https://gitlab.com/inkscape/inkscape/-/issues/3580) reports
`std::bad_alloc` while scroll-zooming some documents near 15,000%. Varve clamps
zoom at 6,400% and bounds raster surfaces to 16,384 pixels per side with an
area limit. The reported zoom level is therefore unreachable in Varve; existing
clamp and raster-budget checks cover the closest shared resource boundary. The
issue's discussion history remains pending, and no matching Varve failure was
identified.

## Thread review: dashed strokes, filters, and transformed masks

A targeted review of the cached discussions narrows several earlier body-only
candidates:

- [#670](https://gitlab.com/inkscape/inkscape/-/issues/670) is traced in its
  notes to Cairo's banded raster export: dashed paths can disappear when a
  64-pixel band contains neither dash endpoint, especially with round or bevel
  joins. The thread includes a minimal SVG and a C reproducer, and reports
  different results across output scales. Varve does not share that Cairo
  implementation; keep it as a cross-output regression candidate rather than
  assuming the same defect.
- [#721](https://gitlab.com/inkscape/inkscape/-/issues/721) mixes background-
  dependent filter primitives with blend modes. The notes distinguish those
  older filters from CSS blend modes and report version-dependent results.
  This is not evidence that every PDF blend effect is broken.
- [#685](https://gitlab.com/inkscape/inkscape/-/issues/685) was reproduced on
  older Inkscape builds and fixed by [MR !1299](https://gitlab.com/inkscape/inkscape/-/merge_requests/1299).
  Keep overlapping text as a cross-output test category, but do not treat it as
  an active Inkscape defect.
- [#694](https://gitlab.com/inkscape/inkscape/-/issues/694) traces clipping and
  degraded mask resolution to transform handling. [MR !5000](https://gitlab.com/inkscape/inkscape/-/merge_requests/5000)
  landed a fix for those symptoms, while explicitly leaving other masked-item
  PDF cases unresolved. Later notes identify filter-dependent mask failures as
  a separate cause.
- [#712](https://gitlab.com/inkscape/inkscape/-/issues/712) is duplicate
  evidence: the low-resolution symptom was tracked under #252 and the
  duplicate-mask disappearance under #694. The discussion attributes the
  disappearance to transforms rather than duplicate-mask count.

The linked SVG/PDF attachments have not been downloaded or executed. These
thread outcomes refine the source claims; they do not establish matching Varve
defects. The discussion downloader is still running. Its latest durable
snapshot at `2026-10-18T13:12:24Z` had retrieved 12,748 of 32,692 reported
non-system comments across 1,931 issue threads. Retrieval coverage is not
content-review coverage.

## Additional PDF import/export reports screened

A further body-screening batch adds five candidates without treating their
reports as confirmed Varve defects:

- [#6143](https://gitlab.com/inkscape/inkscape/-/issues/6143) reports a
  clipped object from an editable PDF becoming invisible after import unless a
  large white rectangle is added behind the mask. The sample PDF remains
  uninspected; this matters only where Varve's PDF import promises editable
  transparency fidelity.
- [#6220](https://gitlab.com/inkscape/inkscape/-/issues/6220) reports missing
  paths and a background pattern in a recent Inkscape 1.5-dev PDF export. The
  issue links the original SVG and PDF, but the fixture and upstream discussion
  have not been checked.
- [#6298](https://gitlab.com/inkscape/inkscape/-/issues/6298) reports a 1.1 MiB
  glitched PDF for clipped/masked text, compared with 12 KiB outputs from
  `rsvg-convert` and Typst `svg2pdf`; the reporter says the Typst output keeps
  clip edges sharp. This is a strong Varve raster-fallback size/fidelity test
  candidate, but Varve output has not been compared yet.
- [#6323](https://gitlab.com/inkscape/inkscape/-/issues/6323) supplies a
  minimal negative-origin `viewBox` that reportedly shifts content in one PDF
  export route while PNG and Save/Save-a-Copy remain correct. This supports a
  focused viewBox-origin export test.
- [#6407](https://gitlab.com/inkscape/inkscape/-/issues/6407) reports a fatal
  error only for a Windows CLI PDF export on one Inkscape 1.5-dev build; Save a
  Copy and other formats work. Its fixture and discussion are still pending,
  so the failure is not generalized to other PDF paths.

These five descriptions raise body screening to 49 of 6,392. Their linked
files and discussions remain pending where noted. The marketing site still has
no relevant full-fidelity PDF claim to revise until a Varve reproduction is
confirmed.

## More export and import reports screened

Six more issue descriptions were checked against Varve's current architecture:

- [#204](https://gitlab.com/inkscape/inkscape/-/issues/204) reports an
  out-of-memory import after adding two SVGs with 25 MB and 9 MB source images.
  It lacks controlled dimensions or a Varve reproduction, so it remains an
  aggregate image-memory test candidate.
- [#255](https://gitlab.com/inkscape/inkscape/-/issues/255) attributes an old
  PDF import crash to a later `libpoppler-glib8` package from external Linux
  repositories. This points to dependency error handling, not a confirmed
  format-level Varve defect.
- [#698](https://gitlab.com/inkscape/inkscape/-/issues/698) reports black
  crosses and a foggy color haze over masked red/orange artwork in Inkscape
  0.92.3 PDF output. It is a useful mask/color parity fixture if the source SVG
  becomes accessible.
- [#814](https://gitlab.com/inkscape/inkscape/-/issues/814) reports a slight
  raster-image position shift between equivalent SVG-to-PDF exports in
  Inkscape 0.92.4. Its paired SVGs and PDFs have not been inspected.
- [#952](https://gitlab.com/inkscape/inkscape/-/issues/952) reports underline
  text decoration missing from old Inkscape PDF output. Check whether Varve's
  rich-text model supports the same decoration before treating it as a direct
  compatibility gap.
- [#5971](https://gitlab.com/inkscape/inkscape/-/issues/5971) reports print
  marks absent from a PDF made with Inkscape 1.4.2. Varve has explicit PDF/X
  mark generation and Rust coverage; a rendered marked page is still the useful
  visual check before making changes.

Body screening is now 55 of 6,392. Comments and attached files for these six
reports remain pending, so these are screening results rather than full issue
reviews.

## Recent font, bleed, and scale-limit complaints

A recent-issue pass screened nine more reports and mapped them to concrete
Varve boundaries:

- [#5451](https://gitlab.com/inkscape/inkscape/-/issues/5451) says Adobe
  Acrobat rejects a PDF with embedded fonts, while outlining the same text
  makes it open. This supports cross-reader structural and visual checks for
  font embedding; Acrobat is not available in this Linux validation run.
- [#5527](https://gitlab.com/inkscape/inkscape/-/issues/5527) reports a crash
  exporting a 32,000×16,000 raster page. Varve's 16,384-pixel side and 64 Mi
  pixel surface budgets bound that 512-million-pixel request before allocation.
  Verify the scale-down warning and boundary behavior when the raster workflow
  is validated.
- [#5661](https://gitlab.com/inkscape/inkscape/-/issues/5661) says page-tool
  bleed settings do not reach the PDF's separate bleed box. Varve's PDF/X
  `MarksGeometry` derives page boxes, but inspect a generated bleed export
  before declaring that path visually and structurally covered.
- [#5808](https://gitlab.com/inkscape/inkscape/-/issues/5808) reports text
  omitted when an Inkscape 1.5-dev AppImage cannot load existing fonts. Varve
  gathers requested font data and fails before export when required data is
  unavailable; verify the user sees that explicit failure rather than a
  successful PDF with missing text.
- [#5893](https://gitlab.com/inkscape/inkscape/-/issues/5893) is a
  CapyPDF-specific segfault on imported nested group/child transparency and
  gradients. The shared risk category is resource nesting, but the backend is
  different and no Varve regression is established.
- [#6031](https://gitlab.com/inkscape/inkscape/-/issues/6031) reports invalid
  PDFs with Hiragino fonts on macOS; this remains a targeted font-corpus case,
  not evidence of a general Varve PDF failure.
- [#6132](https://gitlab.com/inkscape/inkscape/-/issues/6132) reports legacy
  SVG 1.2 `flowRoot` text omitted by CapyPDF but present in Cairo output. Varve
  does not claim complete legacy flowed-text roundtripping.
- [#6243](https://gitlab.com/inkscape/inkscape/-/issues/6243) reports a clipped
  clone of a root-level group missing from a multi-page batch PDF while PNG
  and Save Copy succeed. Keep it as a page/clone/clip export candidate if that
  workflow is supported.
- [#6284](https://gitlab.com/inkscape/inkscape/-/issues/6284) reports memory
  exhaustion when two SVGs link to each other and one is cold-opened. It is not
  a direct Varve match unless the importer starts resolving external SVG links.

Body screening is now 64 of 6,392. Attachments and reported discussions remain
pending for this batch; the notes above are not full issue resolutions.

## Further Inkscape issue-corpus screening

A bounded sweep extended coverage into three IID ranges. The 1,190 available
issue descriptions in #2401–#3600 were individually screened; #2443, #2580,
#2806, #2880, #2946, #3011, #3452, and #3558 were unavailable in the local
cache. The other two IIDs in that range had already been screened. No cached
comment threads were available for #2401–#3600, so the candidates below are
body-only and remain unconfirmed against attachments or discussion history.
The earlier #1–#1200 and #1201–#2400 passes were lexical triage followed by
manual review of selected candidates; they are not represented as full manual
reviews of those ranges.

### Import, document integrity, and command-line contracts

- [#3115](https://gitlab.com/inkscape/inkscape/-/issues/3115) describes a
  missing linked-image placeholder overwriting authored dimensions, then
  corrupting the image when it is relinked. This is a data-integrity test
  category for any Varve flow that supports external links; Varve's
  content-addressed embedded-image path may not share the mechanism.
- [#265](https://gitlab.com/inkscape/inkscape/-/issues/265) reports invalid
  PDF page selection causing crashes or empty output, while
  [#270](https://gitlab.com/inkscape/inkscape/-/issues/270) reports CLI export
  failures sometimes returning exit code zero. The shared product contract is
  explicit failure and no published partial artifact for invalid requests.
- [#1794](https://gitlab.com/inkscape/inkscape/-/issues/1794) documents
  export-by-ID mutating the source document. Varve export should preserve the
  open document snapshot; the report does not demonstrate a Varve defect.
- [#526](https://gitlab.com/inkscape/inkscape/-/issues/526) and
  [#804](https://gitlab.com/inkscape/inkscape/-/issues/804) describe absolute
  local paths leaking through SVG metadata. Check portable-file metadata only
  where Varve writes equivalent local paths.
- [#1119](https://gitlab.com/inkscape/inkscape/-/issues/1119) reports a PDF
  import expanding repeated glitter assets into very large files and high
  memory use. The supplied file was not available for this review; generic
  deduplication and bounded-import behavior are useful checks if PDF import is
  supported.

### PDF, raster, and multipage fidelity

- [#602](https://gitlab.com/inkscape/inkscape/-/issues/602) reports stroked
  text clipped in PDF despite correct canvas rendering. Cached discussion says
  the report still reproduced on Inkscape development builds in 2022. This is
  a strong text/stroke export regression category, not a confirmed Varve bug.
- [#947](https://gitlab.com/inkscape/inkscape/-/issues/947) reports CLI PNG
  export diverging from GUI export for an image clipped with
  `clipPathUnits="objectBoundingBox"`; comments attribute it to coordinate
  interpretation in one render path. Compare equivalent export paths if
  Varve supports this SVG clip behavior.
- [#1246](https://gitlab.com/inkscape/inkscape/-/issues/1246) describes a
  large blurred export becoming black when allocation fails. Assert bounded
  allocation and an honest error/degradation path for expensive raster export.
- [#1491](https://gitlab.com/inkscape/inkscape/-/issues/1491) reports print
  output losing a pattern that remains in Save-As PDF; the thread connects it
  to [#1018](https://gitlab.com/inkscape/inkscape/-/issues/1018), where Cairo
  rasterizes large pattern tiles at zoom-dependent resolution. Varve's capped
  pattern tile path addresses a distinct implementation; its cap has a
  visually reviewed regression test.
- [#2704](https://gitlab.com/inkscape/inkscape/-/issues/2704) and
  [#3239](https://gitlab.com/inkscape/inkscape/-/issues/3239) identify clipped
  blend and filtered-mask PDF cases. They are candidate scenes for independent
  PDF rendering and canvas comparison if the corresponding Varve features are
  in scope.
- [#2828](https://gitlab.com/inkscape/inkscape/-/issues/2828) reports
  mask-heavy large-canvas PDF export exhausting memory. Varve has raster
  surface bounds; peak memory and graceful handling of nested/cardinality-heavy
  scenes remain the relevant validation questions.
- [#3009](https://gitlab.com/inkscape/inkscape/-/issues/3009) reports thin
  strokes changing under skew in vector printing. [#3214](https://gitlab.com/inkscape/inkscape/-/issues/3214)
  reports filtered content and embedded images disappearing on later pages of
  a multipage PDF. These are useful targeted visual fixtures only if the same
  output features are supported.
- [#3517](https://gitlab.com/inkscape/inkscape/-/issues/3517) reports
  `preserveAspectRatio` raster edge leakage during PNG export;
  [#3569](https://gitlab.com/inkscape/inkscape/-/issues/3569) reports hairline
  seams between multipage PDF pages. Both need synthetic cross-renderer cases
  before assigning any Varve cause.
- [#3596](https://gitlab.com/inkscape/inkscape/-/issues/3596) reports an
  empty drawing export crashing instead of returning a clear result. Test the
  empty-document boundary if the corresponding export command is exposed.
- [#558](https://gitlab.com/inkscape/inkscape/-/issues/558) is a historical
  masked-image clone clipping report; the reporter later said it no longer
  reproduced in Inkscape 1.4.2. Keep it as a regression shape, not a current
  upstream defect claim. [#827](https://gitlab.com/inkscape/inkscape/-/issues/827)
  was traced to and resolved through an upstream Cairo fix; it is an
  interoperability corpus idea rather than evidence of a current Varve issue.

### Adjacent renderer and resource cases

The remaining manually selected reports include large-coordinate pattern
phase (#2520), filter bounds under transforms (#2589, #2618), filtered
clone/clip behavior (#2463), repeated image-heavy transforms (#2523), and
repeated image relinking/import state (#3115). These map to stress or visual
regression scenarios where Varve has an equivalent feature; Inkscape-specific
GTK, extension, live-path-effect, arbitrary-marker, EPS/PS and packaging
reports were not treated as Varve defects. The full-body lexical triage in
#1–#1200 and #1201–#2400 is not counted as individual manual screening; the
ledger records only descriptions that received a substantive read.

### Additional historical threads and document-safety cases

A direct read of [#1668](https://gitlab.com/inkscape/inkscape/-/issues/1668)
found an old print clipping report whose discussion separates at least two
reproductions: the original clip/print mismatch was reproduced on 1.0 and
0.92.5, then not reproduced on 1.1-dev; a second user reported nested SVG
viewports not appearing in print. Later notes link separate Inbox reports and
additional fixtures. Treat this as historical renderer-parity evidence, not a
single current defect. [#1627](https://gitlab.com/inkscape/inkscape/-/issues/1627)
reports PNG export hanging on a clipped group whose fill references a gradient
inside itself, with repeated “more than 32 iterations” document-update
warnings. Its discussion also contains later distinct examples and a 42 KB
comment; that thread is not counted as content-reviewed here. This reinforces
cycle detection and bounded export as a test category without establishing a
Varve hang. [#1957](https://gitlab.com/inkscape/inkscape/-/issues/1957) records
an export-by-ID-only operation removing objects before a later export in the
same session; [#1673](https://gitlab.com/inkscape/inkscape/-/issues/1673)
records an old complex-document hit-testing loop during tool switching. These
are historical integrity/performance reports; no matching Varve failure is
known.

## Recent Inkscape reports, IID 6001–6392

A full-description pass read all 375 available, previously unscreened issues in
this range. Ten were already in the ledger and seven bodies were unavailable;
exact IDs are recorded in the continuation record. No discussions or linked
attachments were reviewed in this pass, so the findings below are screening
candidates only.

Recent body reports again cluster around export fidelity and data integrity:
PDFs reportedly lose content in masks and patterns (#6073, #6157, #6163,
#6176, #6347), imported PDF colors/text can differ by renderer (#6186, #6278,
#6380), and export metadata/links and page geometry can be wrong (#6052,
#6105, #6184, #6185, #6305, #6317, #6390). Other reports cite incorrect
HSL serialization (#6309), turbulence seams (#6331), raster edge bleed
(#6160), and a 512× viewBox expansion during plain-SVG export (#6317).

These reports are not direct evidence of matching Varve defects. Validate only
where Varve supports the same feature and use the linked report as a regression
shape; the attached samples were not fetched. Several reports concern current
1.5 development builds, so check the tested version, platform, and export path
before treating them as continuing upstream failures. User-pain reports also
include an eight-minute selection of thousands of layers (#6391) and PDF form
radio controls rendered selected on import (#6292); both are feature-specific
and need realistic Varve workflow evidence before implementation.

## Inkscape issue bodies #3901–#4800

All 868 available, previously unscreened descriptions in this range were read
in full. Bodies #3601–#3900 have not yet been fully screened; compact excerpts
from part of that range are not counted. Thirty IDs had no cached body, and two were already screened. This
pass did not inspect comments or attachments; findings here remain issue-body
reports, not confirmed Varve defects.

The strongest transferable reports include PDF export dropping a cloned
marker (#3911), multi-page PDF output progressively clipping a masked JPEG
(#3998), a pattern-of-pattern PDF mismatch (#4217), objects omitted from bleed
areas (#4292), single-page bleed omitted while multipage output includes it
(#4487), transparent text hiding earlier PDF text (#4572), mismatched page
MediaBoxes (#4780), and clones omitted from batch PDF export (#4702). Import
cases report PDF page scaling errors (#4251) and a renderer-specific PDF
round-trip failure (#4577). These warrant fixtures only where Varve supports
the same print/import behavior.

Integrity and lifecycle reports include image dimensions changing when a
missing link is edited (#4014), live preview actions wiping document contents
(#4385), text style lost after saving/reopening (#4160), and document content
flipping when a page moves with an inverted Y axis (#4350). Repeated export
failures, invalid IDs, and closing during export can crash the application
(#4235, #4328, #4523/#4524, #4703). These suggest invariant tests for
non-destructive edits, saved state, explicit invalid-input errors, and safe
cancellation. Their reports are version-specific and have not been reproduced
in Varve.
