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

## Not directly transferable: relative image paths in extensions

Inkscape [#6477](https://gitlab.com/inkscape/inkscape/-/issues/6477) reports
linked image paths being rewritten after running an extension and points to
[#1313](https://gitlab.com/inkscape/inkscape/-/issues/1313). The older report
attributes path drift to extension execution converting relative paths and
failing to restore them. Varve's `DocumentAsset` storage currently supports
embedded assets only, so this exact linked-path failure is not present in its
current document model. Keep comments, fix history, and any separate Varve
plugin/workflow mapping pending before excluding the broader class.

## Current disposition

No code fix is justified by these three body-only candidates. The full Inkscape
issue corpus and comment crawl are still being reviewed; this page is an
interim evidence record, not the final product audit. Marketing-site impact is
also undecided until a behavior change is verified. Initial website review of
`features/local-first.astro`, `support/troubleshooting.astro`, and
`docs/file-formats.astro` found existing low-memory/save-recovery guidance and
an explicit description of PDF import as a bounded local parser. No unsupported
save-memory or full-fidelity PDF claim was found in those surfaces, so no site
copy change is justified for these unconfirmed candidates. Recheck the relevant
feature and troubleshooting pages for every later implementation batch.
