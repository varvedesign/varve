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
  cases). Filesystem behaviour deliberately unchanged.
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
  point global ceiling, a real round join on the outside of the corner, and
  explicit handling of open-path endpoints.
- **Acceptance criteria:** 512-vertex outline at distance 1,000,000 completes
  in under 2 s with ≤ 200,000 finite points; a rounded square produces arc
  points at exactly the offset radius around each corner; a miter corner still
  reaches (−10, −10) at distance 10; a straight open path yields no bridging
  point.
- **Validation:** `packages/engine/src/pathOffset.test.ts` (16 cases, 4 new).
  Visual check recorded in `continuation.md`.
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
