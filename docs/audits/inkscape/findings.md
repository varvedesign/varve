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
Visual and independent PDF-renderer validation remain pending.

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
confirmed crash while exporting filtered content with a clip path. The thread
narrows the failure to the PDF exporter rasterizing a filtered item with a clip
path; a maintainer identified a missing raster image as a likely intermediate
state. The issue was traced to an opacity change, fixed in
[MR 2907](https://gitlab.com/inkscape/inkscape/-/merge_requests/2907), and the
reporter confirmed the minimal reproducer no longer crashed. The larger
original file remained unverified because it exceeded the reporter's available
memory.

Varve sends PDF subtrees with effects or masks through a live canvas raster
fallback, so this is a relevant workflow to exercise. The Inkscape report does
not establish that Varve shares its renderer or opacity bug, and no equivalent
Varve crash has been reproduced. Keep the targeted export regression pending
until a real document with a filtered clipped raster is exported and inspected.

Inkscape [#1739](https://gitlab.com/inkscape/inkscape/-/issues/1739) separately
reports memory growth, crashes, or a missing fill for masked images inside SVG
patterns. Its small embedded-image sample shows reported peak memory growing
from roughly 104 MB at a 10×10 pattern to 1.3 GB at 128×128; a 150×150 case
crashed and produced a zero-byte PDF. The issue body is screened, but its two
comments and linked original sample remain pending review. Varve's print
pipeline expands supported image tiles into PDF content and caps the estimated
tile count, but does not implement SVG masks nested inside arbitrary SVG
patterns. The described Inkscape mechanism is not yet shown to exist in Varve;
measure the actual supported pattern path before proposing a code change.

These reports reinforce the need to test export completion, output validity,
and visual content on complex documents. They do not justify claims of shared
causes, and they do not currently justify marketing copy changes.

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
