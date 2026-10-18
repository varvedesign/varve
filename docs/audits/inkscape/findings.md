# Preliminary Inkscape findings

This page records evidence reviewed so far. A body-screened report is not a
confirmed Varve defect. Discussion review and linked implementation history
remain pending unless stated otherwise in the issue ledger.

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
