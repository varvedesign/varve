# VectorCraft corpus — findings and evidence

Each finding keeps the chain the review requires:

**external evidence → user problem → applicable Varve workflow and code path →
current observed behavior → intended outcome → implementation decision →
acceptance criteria.**

Research depth and engineering status are separate. A finding whose research is
complete can still have open engineering work; that is recorded as such rather
than relabelled.

---

## F1 — A save may not report success before the bytes exist

- **External evidence:** vectorcraft#1693 (browser save discards download
  errors, marks clean, can close unsaved documents), #1685 (save failures
  silent when the destination is locked or unavailable), #1721 (save planning
  mutates file dates before validation or writing succeeds). All three are
  ordering defects: success is recorded before the write is confirmed.
- **User problem:** the document reports "Saved", the modified marker clears,
  recovery points are deleted, and closing the tab/app then discards work that
  was never written.
- **Varve workflow and code:** *Save* with the Varve Library as destination
  (`app-storage` save target). `packages/editor/src/context/usePersistence.ts`
  `performSave` → `mirror()` → `afterPrimaryWrite()`.
- **Observed behavior (before):** for filesystem targets the mirror is
  genuinely secondary — the bytes are on disk — but the `app-storage` branch
  reused the same swallow-everything `mirror()`. A failed library write still
  ran `afterPrimaryWrite`, which sets `saveState: 'saved'`, clears `dirty`,
  stamps `lastSavedAt`, deletes the recovery point and allows a close.
- **Intended outcome:** a failed library write leaves the document dirty, keeps
  recovery, reports a named failure, and does not let a close proceed.
- **Implementation:** `packages/editor/src/persistence/librarySave.ts`
  (`commitLibrarySave`) makes the ordering explicit — confirm the write, then
  commit — and maps quota exhaustion to `quota-exceeded` instead of a generic
  reason. `usePersistence` now routes the app-storage branch through it.
- **Acceptance criteria:** a throwing library write never runs the commit step;
  the returned issue says the work is still unsaved; quota errors are named;
  the success path still commits once, in order.
- **Validation:** `packages/editor/src/persistence/librarySave.test.ts` (5
  cases, helper ordering) and
  `packages/editor/src/context/__tests__/librarySave.test.tsx` (2 cases that
  drive the real `EditorProvider` save: a rejected library write must leave
  `dirty` true, `saveState` `error` and `lastSavedAt` null; a successful one
  must clear them). Filesystem behaviour deliberately unchanged.
- **Adjacent, not fixed here:** autosave failures (`useAutoBackupServices`,
  `AutoSaveService`) are still only logged — `onStateChange` has no production
  consumer, so a user whose recovery writes keep failing is not told. The
  authoritative save path is unaffected.

## F2 — Offset Path work is bounded by the offset distance, not the geometry

- **External evidence:** vectorcraft#1028 — a Milkshake "r" outline with
  miter joins and a 6 pt offset froze the app; memory grew ~50 MB/s past 6 GB
  and work since the last recovery snapshot was lost. The reporter narrowed it
  to the offset distance (`5.8` ok, `6.0` hangs, `6.4` ok) and to
  spike-producing joins.
- **User problem:** a synchronous main-thread effect can consume unbounded time
  and memory, taking the whole session with it.
- **Varve workflow and code:** Object → Offset Path
  (`packages/editor/src/actions/createActionHandlers.ts`) →
  `offsetPathSelected` → `packages/engine/src/pathOffset.ts#offsetPath`.
- **Observed behavior (before):**
  1. Per-join arc steps were `ceil(|sweep| × |distance| × 0.1)` — work grew
     linearly with a user-supplied number, so an extreme distance could emit
     hundreds of thousands of points per vertex. The prompt only rejected
     non-finite input.
  2. The round-join branch was unreachable for a normal corner (it required the
     offset lines to be parallel), so choosing *round* produced a miter or a
     bevel. The UI default is round.
  3. An open path joined its first vertex to its **last** segment and never
     emitted the far endpoint, so offsets could bridge the two ends.
- **Intended outcome:** work is bounded by geometry and tolerance; round means
  round; open paths stay open.
- **Implementation:** chord-tolerance tessellation
  (`2·acos(1 − tol/r)`, 0.25 unit tolerance), a 64-step per-join and 200,000
  point global ceiling, a round join applied **only on the outside of a turn**
  (an inner corner uses the offset lines' intersection), and explicit handling
  of open-path endpoints.
- **Review finding (fixed before integration):** the first version drew the arc
  on inner corners too. For the default inward offset (−8) that scooped
  `|distance|·(√2−1)` out of every corner — 3.3 px on a 10 px offset — so the
  result was not an offset curve at all. Caught by independent review; the
  side test (`cross × distance > 0`) and a regression test for the inward case
  are now in place. The global ceiling was also only enforced per join, so the
  total could still grow past it; the vertex loop now stops at the ceiling and
  never emits a truncated arc.
- **Acceptance criteria:** 512-vertex outline at distance 1,000,000 completes
  in under 2 s with ≤ 200,000 finite points; a rounded square produces arc
  points at exactly the offset radius around each corner; a miter corner still
  reaches (−10, −10) at distance 10; a straight open path yields no bridging
  point.
- **Validation:** `packages/engine/src/pathOffset.test.ts` (16 cases, 4 new).
  Visual check recorded in `continuation.md`.
- **Follow-up resolved:** the miter limit divided the miter length by the
  *edge length*, which is dimensionally wrong and scale-dependent: a long edge
  could never clip, so an acute spike survived `miterLimit=4`. It now uses the
  SVG/PostScript definition (distance from the original vertex to the miter tip
  over the offset distance), and a test proves the decision depends on the
  angle, not the edge length.
- **Not covered:** VectorCraft's hang was inside their geometry library's
  sweep; Varve has no sweep phase, so the specific non-terminating
  intersection loop does not exist here. The bounded-work property is what
  transfers.

## F3 — Exported SVG text names no generic font family

- **External evidence:** vectorcraft#3135 — exported CSS is
  `font-family:'Source Sans 3'` with no generic, so viewers without the font
  draw the design in their default serif face.
- **User problem:** an exported design looks wrong in the recipient's viewer,
  with no warning and no way to tell that a substitution happened.
- **Varve workflow and code:** Export → SVG
  (`packages/codegen/src/svg.ts` run and node text attributes,
  `packages/codegen/src/index.ts` document exporter).
- **Observed behavior (before):** `font-family="<design face>"` only. The CSS
  and email exporters already ended their stacks in a generic family
  (`emailGenericFamily`); the SVG path never got that treatment.
- **Intended outcome:** every exported `font-family` ends in
  `serif` / `sans-serif` / `monospace` chosen by the same classification the
  other exporters use.
- **Implementation:** `svgFontFamilyValue()` in `svg.ts`, reused by the
  document exporter; applied at all four SVG text sites.
- **Acceptance criteria:** Source Sans 3 → `Source Sans 3, sans-serif`;
  Playfair Display → `, serif`; JetBrains Mono → `, monospace`; an
  already-generic family is not duplicated; the document exporter's text
  output carries the fallback.
- **Validation:** `packages/codegen/src/svg-font-fallback.test.ts` (6 cases)
  plus the updated `index.test.ts` assertion; full `@varve/codegen` suite green.
- **Not covered:** embedding or subsetting fonts is a separate contract and is
  not claimed here.

## F4 — SVG physical size (checked, no defect in Varve)

- **External evidence:** vectorcraft#2924 (duplicate of #864) — a millimetre
  document exported unitless `width`/`height` holding **point** values, so a
  50 × 30 mm drawing rendered at 37.5 × 22.5 mm (75 %).
- **Varve check:** Varve's user unit is CSS px at 96 dpi
  (`packages/shared/src/units.ts`), and SVG's unitless user unit is also 96 dpi
  CSS px. An A4 page is stored as 793.7 × 1122.5 and exports as
  `width="793.7"`, which measures 210 mm in a conforming viewer. There is no
  points-based user unit, so the 75 % error cannot occur.
- **Outcome:** already handled. A regression test now pins the invariant so a
  future unit change that starts emitting points without a unit fails.
- **Validation:** `svg-font-fallback.test.ts` → "SVG physical size".

## F8 — Whole-document SVG export flattened gradients

- **External evidence:** the corpus records repeated "the export does not match
  the canvas" paint defects: #3135 (text paint fallback), #2011 (SVG export
  loses colours in Blender), #1292 (round-trip element semantics), #3192.
  The shared mechanism is an export route that bypasses paint-server
  definitions.
- **User problem:** exporting the document to SVG produced flat-coloured shapes
  where the canvas showed gradients, with no warning.
- **Varve workflow and code:** Export → SVG, whole document
  (`packages/editor/src/components/Shell/ExportLayer.tsx` →
  `exportDocumentToSvgAdvanced` → `packages/codegen/src/index.ts`).
- **Observed behavior (before):** the document exporter collected mask,
  path-text and pattern definitions only, and filled each node from
  `rgba(node.fill)`. The per-node exporter (`exportNodeToSvg`) already emitted
  `url(#grad-…)`, so the two routes disagreed for the same document.
- **Implementation:** gradient definitions are collected for every visible root
  subtree (deduplicated by id) and the node emitter references the topmost
  linear/radial paint server. Angular and diamond gradients keep the flat
  fallback, which the per-node route already reports as a limitation.
- **Acceptance criteria:** a document with a linear gradient fill contains
  `<linearGradient` and `url(#grad-<id>-0)`; a solid document contains neither;
  the rendered SVG visually shows the gradient.
- **Validation:** `packages/codegen/src/document-svg-gradient.test.ts` (2
  cases), full `@varve/codegen` suite (385 pass), and a rendered comparison in
  Chromium (flat before, gradient after).
- **Not covered:** gradient strokes in the document route, and per-stop
  transparency (see F6).

## F5 — Area-text overset is computed and thrown away (fixed)

- **External evidence:** vectorcraft#1471 (area-type overflow is not reported;
  create/set-style calls return plain success), #2323 (the overflow indicator
  only appears once the frame is selected), #2769 (CJK area text clips its last
  line with no overset indicator).
- **User problem:** text that does not fit its frame is either clipped or painted
  past the frame with no warning, so a print or export surprises the author.
- **Varve code:** `packages/engine/src/replay.ts` computed
  `hasVerticalOverflow` and used it only for the ellipsis decision;
  `packages/scene/src/preflight.ts` permanently reported `overset-text` as
  unavailable, and `runTypographyPreflight` accepted an `oversetMap` that
  nothing produced.
- **Observed behavior (before):** a short area frame holding long text showed
  no finding at all; preflight said the check could not be run.
- **Implementation:** `packages/editor/src/render/textOverset.ts` lays each
  measurable area frame out through the same canonical pipeline the renderer
  uses (`layoutRichTextSnapshot`, supplied with a 2D measure context), and
  compares each line's box against the frame height. Results are cached per
  node by object identity, so an unchanged frame is measured once; the cache is
  dropped when `document.fonts.ready` resolves, because fallback metrics would
  otherwise produce false overset. `runCombinedPreflight` now accepts
  `oversetMap` and `oversetUnmeasured`.
- **Where it surfaces:** preflight is a Print-workspace status section, so the
  warning appears there and not in Design — the existing product decision about
  where preflight lives. Moving it (or adding a canvas overset marker) would be
  a separate design change, not a side effect of measuring overflow.
- **Honest limits:** frames that follow their text (`autoHeight`/`autoWidth`)
  cannot be overset and are skipped. Contour-wrapped and vertical frames are
  reported as **unmeasured**, and the check stays `unavailable` while any exist
  — it never claims a document is clear when part of it was not inspected.
- **Acceptance criteria:** a frame too short for its text yields one `overflow`
  warning in preflight; a frame that fits yields none; the check reads
  `verified` only when every area frame was measured.
- **Validation:** `packages/editor/src/render/textOverset.test.ts` (5 cases,
  fixed-width measure context), `packages/scene/src/preflight.test.ts` (3 new
  cases), and `tests/e2e/canvas/preflight-overset.spec.ts` driving the real
  editor (type tool → frame → text → preflight panel) in Chromium and WebKitGTK.

## F6 — PDF gradients: blank output (fixed) and stop transparency (fixed)

- **External evidence:** vectorcraft#1140 (canvas blends gradient stop opacity
  premultiplied, unlike PDF export, SVG viewers and `Gradient::sample`), #827
  (raster-effect blend modes dropped in PDF), #3234 (blend between tints of one
  spot colour written as process CMYK). The canvas-versus-SVG half of #1140 is
  measured separately in F11.
- **Varve code:** `crates/varve-print/src/lib.rs` — `ShadingRegistry`,
  `create_sampled_function`, `sample_gradient`.
- **Observed behavior (before), critical:** a Type 0 sampled function declared
  `Range` with **four 0..255 outputs** regardless of colour space, while an RGB
  stream carries **three** bytes per sample and PDF colour components are
  **0..1**. Poppler reported `GfxUnivariateShading: function with wrong output
  size` and drew **nothing**: every gradient-filled shape exported to PDF came
  out blank. This was not limited to transparency — any RGB gradient was
  affected.
- **Intended outcome:** the function's output arity matches the shading colour
  space (3 for DeviceRGB, 4 for DeviceCMYK) and its range is 0..1.
- **Implementation:** the Range is now built from the colour-space component
  count with `[0, 1]` pairs.
- **Validation:** `gradient_sampled_function_range_matches_colour_space` and
  `..._cmyk_space` assert the emitted dictionaries; the crate suite is 201/201.
  Rendered with poppler 26.08: the exported red-to-blue gradient was a blank
  page before and correct after — `evidence/pdf-gradient-before.png` and
  `evidence/pdf-gradient-after.png`.
- **Second defect, fixed here:** per-stop **alpha** was discarded when the
  shading was sampled (`engine_color_rgba(&color)` drops the alpha component), so
  a gradient fading to transparent exported as a hard-edged solid block.
- **Implementation (alpha):** when any stop is translucent, the registry now
  also emits a DeviceGray shading of the alpha ramp as a Type 0 function
  (`Range [0 1]`, one component) and wraps it in a Form XObject registered as a
  luminosity `/SMask` in an ExtGState; the content applies that state before
  `sh`. Opaque gradients emit no mask, so the common case pays nothing. The
  ExtGState dictionary is merged with the opacity/blend states already
  installed rather than replacing them.
- **Validation (alpha):** `gradient_stop_alpha_emits_luminosity_soft_mask` and
  `opaque_gradient_emits_no_soft_mask`; the crate suite is 203/203. Rendered
  with poppler 26.08: an opaque-red-to-transparent-red gradient was a solid red
  block before and fades to the page after — `evidence/pdf-gradient-alpha-before.png`
  and `evidence/pdf-gradient-alpha-after.png`.
- **PDF/X-1a:** `hasPdfX1aTransparency` already reports gradient stop alpha in
  the export panel, so an X-1a export of such artwork is disclosed before it
  runs; the soft mask is emitted only on the paths that permit live
  transparency, alongside the `/ca` opacity states this writer already used.
- **Considered and rejected:** splitting the ramp into flat-alpha bands. It
  needs no mask but bands visibly in the alpha channel for any smooth fade.

## F7 — Whole-document hover/selection scans (checked, already handled)

- **External evidence:** vectorcraft#1280, #1172 (hover, marquee, snapping and
  drags scan the whole document; no bounds cache or spatial index).
- **Varve code:** `packages/editor/src/scene/spatialIndex.ts` (64 px grid,
  cached per document revision), consumed by `HitTestEngine` and
  `toolContext`.
- **Outcome:** already handled for ordinary editing. One branch
  (`HitTestEngine.queryWithTolerance` when a master placement exists) returns
  every entry and filters by geometry — a bounded follow-up, recorded rather
  than fixed here.

---

## Exclusion classes (recorded, not silently dropped)

| Class | Count | Why it is out of scope |
|---|---|---|
| Unsupported file formats (DXF, DWG, CDR, Affinity, WMF/EMF, PMD, HPGL, STL, JXL, IDML) | ~22 | Varve does not read or write these; adding one is a product decision, not a defect fix. |
| VectorCraft packaging/distribution (Flatpak, AUR, RPM, Homebrew, DMG, ARM ports, launchers, translations, torrents) | ~20 | Different application, different distribution. |
| Host automation surfaces (MCP, control channel, CLI, plug-in API, ExtendScript) | ~28 | Varve has no equivalent surface; the defects are in a subsystem Varve does not ship. |
| Adjacent products (PhotoCraft, PdfCraft, ArtCraft suite, 3D/materials, collaboration) | ~10 | Separate products or unshipped subsystems. |
| No mapped Varve subsystem | 295 | Title-level screening found no corresponding workflow; these remain title-reviewed only and are recorded as such. |
| `screened-relevant` | 830 | Mapped to a Varve subsystem but not deep-reviewed in this pass. **Open**, not excluded. |

The `screened-relevant` count is the honest size of the remaining corpus. It is
not a claim that those issues do not apply, and it is not a completion signal.

---

## Website and marketing impact review

| Page | Decision |
|---|---|
| `apps/website/src/pages/docs/tools/export.astro` | **Changed.** States that exported `font-family` lists end in a generic family, and that SVG text is referenced by name rather than embedded or subset — so a recipient without the face substitutes it and metrics can change. Also tells the reader to expand text to outlines when exact metrics matter. |
| `apps/website/src/pages/features/export.astro` | **No change.** It claims SVG output "for supported shapes, paths, text, and transforms" and lists no font-embedding capability. The gradient claim ("Gradient and solid fills") is now true for the whole-document route as well; tightening it would overstate nothing, but there is no false statement to correct. |
| Pricing, compare, FAQ, download, release pages | **No change.** No capability, platform, compatibility, performance or standards claim moved. The fixes are fidelity and safety corrections inside capabilities already advertised. |
| Changelog | **Changed.** Four user-facing entries under `Unreleased → Fixed`, written for someone deciding whether to install the update. |

Merging these changes touches `apps/website/**`, which triggers
`website-deploy.yml` (GitHub Pages) on `master`. That is a docs-page deploy,
not a release: no tag, no installer, no version bump. It is covered by the
instruction to update the marketing site and merge; it is reported separately
from any release.

## Committed visual evidence

`docs/audits/vectorcraft/evidence/` holds the captures inspected during this
review:

| File | What it shows |
|---|---|
| `svg-font-fallback-chromium.png` | The same exported SVG text rendered in Chromium with and without the generic fallback: serif (before) versus sans-serif (after). This is the capture that revealed the unquoted form did not work. |
| `svg-gradient-whole-document.png` | `exportDocumentToSvgAdvanced` output rendered in Chromium: flat dark rectangle (before) versus the red-to-blue gradient (after). |
| `offset-path-round.png` | Outward Offset Path result driven through Object → Path → Offset Path. The rounded corner arc is visible at the top-left; a miter join would show a sharp corner there. A menubar panel remains over the left edge of the capture. |
| `offset-path-inward.png` | Inward Offset Path result from the same spec. |
| `pdf-gradient-before.png` | Poppler render of a PDF exported from a gradient-filled rectangle **before** the sampled-function fix: the page is blank. |
| `pdf-gradient-after.png` | The same export after the fix: the red-to-blue gradient renders. |

Screenshots are evidence of a specific run, not a claim about every platform:
the SVG captures are Chromium on Linux at the recorded viewport, and the canvas
captures are the Vite web build (stub renderer warning is visible in the run
log), not the native Tauri path.

## F9 — Autosave failures were invisible

- **External evidence:** vectorcraft#1685 — background saves fail silently
  while the UI shows nothing persistent; the reporter's point was that the
  *state handling* was right but the failure was only a transient status line.
- **User problem:** the recovery safety net stops writing (storage quota,
  revoked permission, disabled storage) and the user keeps working under the
  impression that a crash will cost them nothing.
- **Varve code:** `packages/editor/src/autoSaveService.ts` already reports
  `'error'` through `onStateChange`; `useAutoBackupServices` constructed the
  service without subscribing, so nothing consumed it.
- **Observed behavior (before):** a failed recovery write produced only the
  service's internal state. The save status indicator, which reports the
  authoritative save, correctly stayed silent — so a broken safety net looked
  exactly like a healthy one.
- **Intended outcome:** the user is told once, persistently, that recovery is
  paused, without implying that the document itself failed to save.
- **Implementation:** `persistence/recoveryStatus.ts` is a small external store
  (no new `EditorState` field, no context import-budget change);
  `useAutoBackupServices` writes it from `onStateChange` and resets on
  teardown; `SaveStatusIndicator` renders a `role="status"` "Recovery paused"
  chip whose text names the consequence and the action.
- **Acceptance criteria:** healthy autosave shows nothing; a failing cycle
  shows the chip with guidance; a later success clears it; the store notifies
  only on transitions.
- **Validation:** `recoveryStatus.test.ts` (store contract),
  `SaveStatusIndicator.recovery.test.tsx` (renders and clears), existing
  `StatusBar.test.tsx` still 14/14. Not validated in the running app: forcing a
  real quota failure in the browser build is not scriptable without a dev hook,
  so the chip reuses the already-shipped `save-status--error` skin and is
  covered at component level. Recorded as a limitation.

## F10 — A file that cannot be read opens as an empty document (fixed)

- **External evidence:** vectorcraft#861 — opening certain `.ai` files "does
  nothing: no document appears and no error is shown". The thread separates two
  halves: the parse cause (upstream #854) and the invisible failure (#881, which
  moved the message from the status bar into a dialog). The report is about a
  file that cannot be read at all, not about slow or partially rendered files.
- **Not evidence for this finding:** #1151 is a Wayland file-drop delivery
  problem (reclassified separately in the ledger), and #2177 is a multi-defect
  report about heavy PDF/AI decode time, missing content and blurry rendering,
  whose own follow-up says content appears after a long wait. Neither is an
  unreadable-payload case; an earlier draft of this section cited them and that
  was wrong.
- **Varve code:** `packages/editor/src/context.tsx` — `openFile`, the shared
  `loadDocument` decode gate, and the file-picker `FileReader` in `Shell.tsx`;
  `packages/editor/src/components/Shell/RecoveryManager.tsx` restore handlers.
- **Observed behavior (before):** when JSON was supplied but failed to decode,
  `openFile` fell back to `createDocument(name)` — a **blank document under the
  requested file's name**. The canvas looked like the file had opened, and the
  next save wrote over the real document. Three further conditions were found
  while repairing this:
  1. **Empty payload.** The guard was `if (json)`, so a zero-byte file (the
     picker hands over `""`) took the new-document branch without decoding. This
     is the real-world shape of a truncated download or an interrupted write.
  2. **Two gates, one guarded.** The guarded `loadDocument` lived on the
     document sub-context, while the main editor context — the one recovery
     restore calls — still exposed the unguarded persistence function. An
     undecodable recovery payload restored nothing and said nothing.
  3. **The only copy was deleted.** `RecoveryManager` deleted the stored
     snapshot after `loadDocument` regardless of outcome, so a refused snapshot
     was destroyed rather than kept for a retry.
- **Implementation:**
  - Only `null` requests a new document. Every other payload, including `""`
    and whitespace, goes through one decode gate that names the file, says
    "Nothing was changed", and leaves the current document, session identity,
    dirty state and save binding alone.
  - One admission helper (`admitDocumentPayload` in
    `context/usePersistence.ts`) parses, migrates, validates and resolves fonts.
    `openFile` builds a session from it; `loadDocument` applies it and returns
    `false` when admission or the state update fails. The document sub-context
    delegates to the editor context, so there is no second decision.
  - `loadDocument` returns that boolean, and both recovery restore paths delete
    the snapshot only after a successful load. A refused snapshot stays in the
    list.
  - A `FileReader` failure from File > Open now reports the read failure instead
    of doing nothing.
  - Documents that decode but fail semantic validation still open: preflight
    reports their problems, and refusing a recoverable file would be its own
    data loss.
- **Acceptance criteria:** an empty or unreadable payload leaves
  `state.document` identity, sessions and dirty state unchanged and emits one
  error toast naming the file; `null` still creates a blank document with no
  toast; a valid document still opens; a failed recovery restore keeps the
  snapshot.
- **Validation:**
  - `packages/editor/src/context/__tests__/openFileUnreadable.test.tsx` — eight
    cases (unreadable, decodable-but-unusable, empty, whitespace-only,
    `loadDocument` return value, malformed font manifest through both entry
    points, new-document control, valid document).
  - `packages/editor/src/__tests__/openFileDedupe.test.tsx` — fixtures rebuilt
    with `DocumentCodec.encode(createDocument(...))`. The previous hand-built
    `{ id, name, nodes, rootChildren }` object lacks `components`, so the codec
    refused it before dedupe ran: the first case passed for the wrong reason and
    the second failed. The test now proves both dedupe and the second-tab
    document identity.
  - `packages/editor/src/components/Shell/RecoveryManager.test.tsx` — a refused
    restore keeps `deleteSession` uncalled; a successful one deletes.
  - `tests/e2e/menus/file-picker.spec.ts` — the real File > Open picker refuses a
    zero-byte file by name, keeps the tab count and document name, then opens a
    valid document through the same input. Chromium, workers=1, heavy lease.
- **Integration:** the original guard merged as `b9114559` (PR #187). That PR's
  CI had failed `openFileDedupe.test.tsx`; the fixture repair and the three
  conditions above are in `62f01d560` and `6d6bf5213` on `feat/vc-open-file`.
- **Not covered:** `RecoveryManager.restoreSession()` returns `null` for a
  snapshot that cannot be parsed or migrated at all; that path still does
  nothing and has no file name to report. Closing it needs a recovery-record
  redesign (a display name stored with the snapshot), not a guard.

## F11 — Gradient stop opacity: PDF fixed, canvas parity measured in Chromium only

- **External evidence:** vectorcraft#1140 — a gradient whose stops have
  different opacities renders differently on the canvas than in the app's PDF
  export and in SVG viewers. The reporter measured a transparent-white → black
  gradient over white at t=0.1/0.5/0.9: canvas 229/127/25, PDF 252/191/48,
  Chrome SVG 252/191/48, and attributed the canvas result to premultiplied
  interpolation.
- **Varve code:** PDF shading in `crates/varve-print/src/lib.rs`
  (`ShadingRegistry`); canvas gradients in
  `packages/engine/src/replayGradient.ts` (`addColorStop` with `rgba()`);
  exported SVG stops in `packages/codegen/src/svg.ts`.
- **PDF outcome (fixed, verified):** the PDF sampler previously discarded stop
  alpha. `89a2fac4` fixed the sampled-function `Range` arity and `b5b92eef` adds
  a luminosity `/SMask`, so transparency survives. Rendered evidence:
  `evidence/pdf-gradient-alpha-before.png` / `-after.png`.
- **Canvas parity probe (2026-10-23):** a standalone Playwright Chromium page
  drew the same gradient twice over white — once with `CanvasGradient` stops
  (`rgba(255,255,255,0)` → `rgba(0,0,0,1)`), once by drawing an inline SVG with
  `stop-color`/`stop-opacity` into a canvas — and sampled at x=40/200/360
  (t≈0.1/0.5/0.9):
  - Canvas2D: 252 / 191 / 48
  - SVG: 252 / 191 / 48
- **What the probe proves:** in this Chromium build the Canvas2D and SVG
  gradient interpolations agree, so the canvas-versus-SVG half of the upstream
  report does not reproduce here, and Varve's two rendering surfaces would agree
  for this gradient. **What it does not prove:** WebKit canvas parity (the
  desktop embeds system WebKitGTK; the bundled Playwright WPE build cannot
  launch without `pnpm webkit:prepare`), nor an end-to-end comparison of a
  Varve-exported SVG file — the probe uses the same stop values by inspection,
  not Varve's export pipeline.
- **Evidence:** `evidence/gradient-parity-chromium.png` — the top band is a
  Canvas2D gradient (transparent white → black over white), the bottom band is
  the same gradient drawn as an inline SVG. The capture shows they are visually
  indistinguishable; it does not include a Varve document.
- **Status:** PDF half integrated and verified; canvas half measured equal in
  Chromium, unmeasured in WebKit. Recorded as an engine gap, not as a Varve code
  defect, because the interpolation is browser-defined.
