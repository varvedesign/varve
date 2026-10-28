# Opportunities noticed during the lightcraft corpus review

Out-of-scope for the current slice by design. Nothing here is claimed as
fixed, and none of it was silently absorbed into batch 1.

## Varve follow-ups discovered while implementing F-1 (folder export safety)

1. **Expose the conflict policy in the export dialog.** The model already
   declares ask | replace | skip | rename (packages/scene/src/export/model.ts:314)
   but the dialog hardcodes rename. A small destination control (Rename
   (default) / Replace / Skip) plus a report status for skipped files would let
   users choose. Batch 1 deliberately implements only the safe default.
2. **Make the destination probe race-free.** The new pre-write probe is
   check-then-write; a concurrent writer can still land the chosen name between
   probe and the native atomic rename. A Rust-side create_new reservation
   (or write-to-reserved-temp + rename with a no-clobber primitive) would close
   it. Needs an IPC contract change and a Windows/macOS native test.
3. **Verify single-file save overwrite consent on Linux/Tauri.** Folder export
   now never overwrites; the single-file path uses the native save dialog. Tauri
   plugin-dialog (rfd/GTK) overwrite confirmation should be checked on Linux and
   Windows before claiming the same guarantee there.
4. **Preflight destination existence.** Preflight is currently pure/synchronous;
   a per-batch existence probe could surface a warning before export starts
   ('3 files already exist in this folder; they will be saved as name-2 …') in
   the PreflightFindingsPanel. Batch 1 reports the actual saved name after the
   fact instead.
5. **Report per-file destination renames in the results list.** The report now
   names the written file; a short 'renamed to avoid overwriting' note per row
   would make the reason explicit (ExportResultsList.tsx renders the file name
   but not the report warnings today).

## QA coverage opportunities (classes evidenced by the corpus)

6. **Dialog e2e at 1366x768.** The corpus repeatedly reports clipped dialog
   actions at 1366x768 (#781, #1263). The shared Dialog already clamps/scolls
   and pins the footer; a Playwright case that opens Export at 1366x768 and
   asserts Cancel/Export are visible and clickable would lock the regression
   (menus are already tested at 1366x400 in
   tests/e2e/menus/visual-integrity.spec.ts:103).
7. **Native GTK dialog/portal + GTK drag-drop coordinate tests.** Implemented
   but explicitly untested (packages/platform/src/tauri.ts:945-994;
   docs/release/platform-support-matrix.md). Corpus analogies: #191, #189,
   #639, #3140. Requires a desktop runner, not a browser lane.
8. **Adversarial import fixtures from the corpus's hardening reports.** Even
   where Varve's header gate already handles a class, these are cheap oracle
   tests: 35-byte GIF declaring 1 Gpx (#2116/#2553), TIFF O(n^2) chunk inference
   (#2128), BigTIFF next-IFD overflow (#1516), keyword-tree recursion (#2558),
   catalog.log quadratic resync (#2124 class, no analog). Add them to
   packages/import fixtures if a hostile-input lane is reintroduced.
9. **WASM integer-overflow sweep.** F-2 is one verified instance
   (crates/varve-wasm/src/lib.rs:211). A grep for unchecked width*height products
   in wasm-exposed entry points (trace, raster conversion, effects) would find
   siblings before a fuzzer does.
10. **Cancel contract for long single operations.** F-3: exportService.renderJob
    takes no AbortSignal. The corpus's clearest user complaint (#832) is exactly
    'Cancel waits for all of it'; a cooperative cancellation token through the
    engine render/encode path would also fix presentation/print exports.

## Product / corpus classes with no current Varve mechanism

11. **XMP sidecar conflict policy** (#2603, #3175): Varve documents do not use
    sidecars. If Varve ever exports round-trippable photo metadata, adopt
    LightCraft's conflicts-on-external-change policy as a requirement, not an
    afterthought.
12. **Photo-library DAM migration** (#832, #1213, #1234): if Varve adds a
    catalog/library, LightCraft's migration progress/cancel and torn-index
    failures are the failure-mode catalogue to design against.
13. **Max-long-edge export mode** (#1312): a feature request in Varve terms,
    useful for social/web presets; needs a scale model decision, not a bug fix.
14. **Camera-raw colour science / DCP** (#1281 and the camera-colour cluster):
    explicitly outside Varve's product boundary today; revisit only with a
    product decision and a licence/patent review of any DCP/ICC data.

## Architecture / platform ideas worth keeping (not adopted)

15. **PR #2491 reusable patterns, if Linux global-menu support is ever
    requested:** one menu model with two consumers (in-window + exported),
    rejecting stale library events, revalidating actions on the UI thread,
    modal-action guards, an explicit opt-out environment switch, and documented
    vendored-patch provenance. Varve would implement this against Tauri's
    native menu surface with upstream support, not by vendoring winit.
16. **Automation seam lessons** (#181, #2139, #1405): an API/tool surface that
    silently accepts unknown parameter names, and file-writing tools annotated
    non-destructive, are cheap audit targets for packages/cli and the LLM tool
    schemas described in docs/architecture/ipc-type-contract.md.
17. **Photo-adjustment numeric parity** (#523, #634, #1129, #1214): Varve has
    photo adjustments (Photo workspace). The corpus's recurring complaints
    (highlight flattening, shadow-crushing tone curve, masked effects changing
    unmasked regions) would need a reference-image evaluation harness before any
    defect claim; recorded as research-worthy, not as a Varve bug.

## Documentation/site review decision for batch 1

18. No website change was made for F-1. The site's export pages describe format
    capability, not destination conflict behaviour, and no existing claim became
    false; adding a 'never overwrites' sentence should come with a visual
    desktop/mobile pass of the FAQ/export pages, which this constrained session
    did not run. The behaviour is recorded in CHANGELOG.md instead. This is a
    justified no-change decision, not an oversight.
