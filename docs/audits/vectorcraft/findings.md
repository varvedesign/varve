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

## F5 — Area-text overset is computed and thrown away (open)

- **External evidence:** vectorcraft#1471 (area-type overflow is not reported;
  `text.create`/`setStyle` return plain success), #2323 (overflow indicator
  only appears once the box is selected), #2769 (CJK area text clips its last
  line with no overset indicator).
- **Varve code:** `packages/engine/src/replay.ts` computes
  `hasVerticalOverflow` but uses it only for the ellipsis decision;
  `packages/scene/src/typographyPreflight.ts` accepts an optional `oversetMap`
  that nothing produces, and `preflight.ts` permanently marks `overset-text`
  as `unavailable`.
- **Status:** `applicable-requires-work`. Not implemented in this pass. The
  smallest honest change is to derive an overset count per area-text node and
  feed the existing preflight check, rather than inventing a new indicator.

## F6 — Gradient stop transparency is lost in PDF export (open)

- **External evidence:** vectorcraft#1140 (canvas blends gradient stop opacity
  premultiplied, unlike PDF export, SVG viewers and `Gradient::sample`), #827
  (raster-effect blend modes dropped in PDF), #3234 (blend between tints of one
  spot colour written as process CMYK).
- **Varve code:** `packages/engine/src/replayGradient.ts` interpolates stops in
  premultiplied alpha; `crates/varve-print/src/lib.rs` `ShadingRegistry` /
  `create_sampled_function` discards the alpha component when sampling.
- **Status:** `applicable-requires-work`. Not implemented in this pass: a
  truthful fix needs per-stop alpha in the shading function plus an `/SMask`
  (or equivalent) and a rendered-PDF comparison, which is its own batch.

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
