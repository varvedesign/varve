# Findings — lightcraft corpus → Varve

Failure classes are grouped by the mechanism that transfers, not by the
upstream label. Every "already handled" verdict names the Varve file that
proves it; every "implemented" verdict names a test that fails without the
change.

## 1. Exported markup carried characters XML 1.0 forbids — implemented

**Evidence.** storytold/lightcraft#2131 — *"XMP writer emits characters XML 1.0
forbids (U+0000–U+001F, U+FFFE), so other tools reject the whole sidecar."* The
report's own source evidence points at the writer, not the reader: escaping
`& < > "` is not sufficient, because XML 1.0 §2.2 also excludes C0 controls
(other than tab/LF/CR), the noncharacters U+FFFE/U+FFFF, and unpaired UTF-16
surrogates. None of those can be represented at all, not even as character
references.

**Varve path.** `packages/codegen/src/shared.ts` `escapeXml` (used by the SVG
emitter for text, font families, node ids, image hrefs and path data),
`packages/codegen/src/index.ts` and `packages/codegen/src/tailwind.ts` carried
independent copies of the same five-replacement function, and
`packages/editor/src/export/aiDisclosure.ts` built XMP and SVG metadata with
its own inline escaper.

**Observed.** A text layer containing a pasted U+0001 exported an SVG whose
`<tspan>` held the raw control byte. The file looked exported, but an XML
consumer rejects the whole document — the same silent-corruption shape as the
upstream report. Reproduced in `packages/codegen/src/xmlIntegrity.test.ts`:
with the previous escaper the assertion "SVG export must not carry XML-illegal
characters" fails; with the change it passes.

**Decision.** One sanitizer in `@varve/shared`
(`packages/shared/src/xmlText.ts`): `sanitizeXmlText` removes characters that
never had a visual form (C0 controls, U+FFFE/U+FFFF) so the exported text
matches what the canvas showed, and replaces a lone surrogate with U+FFFD
because it stands for a character that could not be decoded at all.
`escapeXmlText` sanitizes then escapes. The three duplicate codegen escapers now
delegate to it, and the AI-disclosure writer uses it directly.

**Acceptance criteria.** (a) An SVG exported from a text node containing
`\u0001`, `\uFFFE` and a lone surrogate contains no XML-illegal code point and
parses with a strict XML parser. (b) Legal whitespace, CJK and supplementary
plane characters (emoji) survive unchanged. (c) XMP and SVG disclosure metadata
stay well-formed for adversarial descriptions. Covered by
`packages/shared/src/xmlText.test.ts`, `packages/codegen/src/xmlIntegrity.test.ts`
and the appended cases in `packages/editor/src/export/aiDisclosure.test.ts`.

## 2. Name truncation split grapheme clusters — implemented

**Evidence.** storytold/lightcraft#266 — *"Panic in detail filmstrip when file
name contains CJK characters (byte-index truncation)"* — plus the family of
label-overflow reports (#2298, #1759, #1634, #372). The upstream crash is
Rust-specific, but the mechanism is language-independent: truncating user text
by code unit instead of by user-perceived character.

**Varve path.** `packages/editor/src/lifecycle/TerminationDialogHost.tsx`
truncated document names with `name.slice(0, 45)`. That is the quit/save dialog,
where the user must identify exactly which document is about to be closed. The
same code-unit truncation appeared in OCR layer naming
(`OcrSection.tsx`), font-detection previews (`FontDetectSection.tsx`), merge
conflict values (`ConflictResolver.tsx`), and background-removal error text
(`BackgroundRemovalSection.tsx`).

**Observed.** A document named with repeated family emoji lost half a surrogate
pair at the truncation point, leaving an unpaired code unit in the DOM.
Reproduced in `terminationDialogHost.test.tsx`: the previous implementation
leaves a lone surrogate and a partial ZWJ sequence; the change does not.

**Decision.** `truncateGraphemes` in `@varve/shared`
(`packages/shared/src/truncateText.ts`) counts grapheme clusters with
`Intl.Segmenter` and falls back to code points where the segmenter is absent
(the fallback still keeps surrogate pairs intact). The ellipsis counts toward
the budget, so the result never exceeds it. Applied at the five call sites.

**Acceptance criteria.** (a) Truncating a string of emoji yields whole
clusters and no lone surrogate. (b) A ZWJ family emoji survives as one unit.
(c) A combining mark stays with its base letter. (d) CJK truncates by character,
not by code unit. (e) Values within budget are returned unchanged. Covered by
`packages/shared/src/truncateText.test.ts` and
`packages/editor/src/lifecycle/__tests__/terminationDialogHost.test.tsx`.

## 3. Verified as already handled in Varve

These were checked against source before any change was considered; the
verifying file is the evidence.

| Upstream class | Issues | Varve verdict |
|---|---|---|
| Transparent regions turn black in JPEG output; 8-bit exports always carry opaque alpha | #1212, #1670 | Handled. `SpecPanel/export.ts` treats JPEG as non-transparent, fills an explicit white matte (`defaultFlattenMatte`) instead of relying on the browser's implementation-defined black, and warns when transparency was disabled. `export-matte.test.ts` pins both messages. |
| "2000 px long edge" output measures 1999 px | #1312 | Handled. `rasterScaleForJob` derives scale from the constrained axis and `exportNodeAsRaster` rounds each axis independently (`Math.round(bbox.w * scale)`), so the requested axis is exact. |
| Thumbnail-cache cleanup deletes unrelated files under `thumbs/` | #98, #245, #1504 | Handled by construction where it can be verified locally: the web store evicts only `STORE_THUMBS` records keyed by identity (`packages/platform/src/web.ts`), and the desktop path delegates to the SQLite `evict_thumbnails(keep_count)` table operation (`crates/varve-sync`, `apps/desktop/src-tauri/src/lib.rs`). No filesystem-wide traversal exists. |
| Hovering another top-level title does not switch an open menu | #421, #458 | Handled. `packages/editor/src/Menubar.tsx` switches `openMenu` from `onMouseEnter` whenever a menu is already open. |
| Dialogs taller than a 1366×768 window hide their actions | #781, #2472, #1263 | Handled. `.varve-dialog` caps height at `min(100dvh - 2rem, 42rem)` with a scrollable `.varve-dialog__body`, pinned by `tests/e2e/dialogs/dialog-system.spec.ts` → "Export dialog at a short viewport". |
| Fast brush strokes leave gaps between stamps | #517 | Handled. `interpolateStrokeSegment` (`tools/brushStroke.ts`) is used by the paint, selection, trimap and mask-refinement tools. |
| Slider values cannot be typed, and sliders have no reset | #1435, #1436, #532 | Handled. `RangeValueControl` pairs the range with a `NumberField` that edits the same value, and the shared `Slider` renders a reset button when `onReset` is provided. |
| Library/catalog lock, catalog format versioning, journal recovery | #99–#102, #2124, #2130 | Out of scope: Varve has no photo catalog. The equivalent *document* concerns are owned by the lifecycle and history systems (`docs/architecture/lifecycle-system.md`, `docs/architecture/…` history docs) and were not changed from this evidence. |

## 3a. Unreadable settings were discarded — preservation implemented

**Evidence.** storytold/lightcraft#103 — *"Settings files: unreadable
prefs/presets reset to defaults …"*. The thread records the upstream remedy:
damaged files are kept as `.corrupt-<time>`, reported to the user, and never
overwritten during that session.

**Varve path.** `packages/editor/src/settings.ts` `loadSettings` caught the
parse failure and returned defaults. The stored blob was left in place for the
rest of that session, but the next settings save overwrote it, so a user's
theme, panel layout and custom shortcuts were gone without a trace.

**Decision.** The catch now calls `quarantineCorruptSettings()`, which writes
the verbatim payload plus its source key (`varve-editor-settings` or the legacy
`strata-editor-settings`) and a timestamp to `varve-editor-settings.corrupt`
before returning defaults. `readQuarantinedSettings()` exposes the preserved
copy for a future recovery surface. One slot is kept, and an identical payload
is not rewritten, so repeated loads do not churn storage.

**Acceptance criteria.** (a) An unreadable current blob is preserved verbatim
and the caller still receives defaults. (b) A legacy blob is preserved and its
source is reported. (c) Repeated loads do not replace an identical quarantine.
(d) No quarantine exists when the stored settings are valid. Covered by
`packages/editor/src/settings.test.ts` → "settings quarantine".

**Not done.** There is no user-visible notice yet; Varve has no global notice
surface, and inventing one is a design decision larger than this batch. The
class stays in §4 for that half.

## 4. Screened, not claimed

These reach a Varve subsystem but need a reproduction before a defect can be
claimed. They stay on the queue; they are not reported as fixed.

| Class | Issues | Why it is not a finding yet |
|---|---|---|
| Preview/export divergence | #605, #787, #709, #960 | Varve exports through the same engine and settles fonts and image resources before replay (`SpecPanel/export.ts`), but no test compares a zoomed preview against the exported raster for the same camera. Needs a pixel comparison. |
| Deterministic export bytes | #180, #1373 | Varve injects `pHYs` into PNG without a timestamp; PDF metadata dates were not audited. Needs a byte-diff of two exports. |
| Mask overlay obscures the adjustment being made | #519, #1800, #1712, #1214 | Varve has a show-all-masks overlay; whether it hides while a slider is dragged was not verified. |
| Settings reset silently when the stored blob is unreadable | #103 | Preservation is implemented (§3a); a user-visible recovery notice is still missing, so the class is not closed. |
| Export overwrites an existing file without a decision | #93, #1405, #1944 | Varve's destination adapters were not audited for collision handling. Data-integrity concern; needs a test against the real write path. |
| GPU path renders wrong pixels after device loss | #78, #230, #1948, #1764 | Varve's WebGPU/WebGL2 paths fall back to Canvas2D, but no evidence was gathered for device-loss recovery. Needs a forced-loss run. |

## 5. Evidence limitations

- The upstream tracker mixes 981 issues with 1 540 PRs. PR bodies were retained
  as linked evidence; not every PR diff was read.
- The comment pass ran after the issue inventory, so the two are not an atomic
  snapshot.
- Attachments, recordings and reproduction files referenced by issues were not
  downloaded unless a finding depended on one; none of the implemented classes
  did, because their mechanism was confirmed in Varve source instead.
- lightcraft was not built or run: the implemented classes were reproduced in
  Varve, which is the product that had to be fixed.

## 6. The 28 uncertain records

These are the issues no rule could classify confidently; each needs a Varve
reproduction before a defect can be claimed. They are deliberately not
relabelled as irrelevant.

`253, 291, 322, 326, 462, 486, 638, 731, 1098, 1099, 1323, 1478, 1496, 1643,
1658, 1743, 1768, 1788, 1858, 1885, 1927, 2055, 2215, 2253, 2376, 2402, 2405,
2489`

Most are "the app crashed / felt wrong" reports without a reproduction, or
crop/mask interactions whose Varve analogue has a different interaction model.
Two (`2376`, `2489`) are reports with no actionable content.

## 7. Validation evidence

| Check | Command | Result |
|---|---|---|
| Unit tests for the XML sanitizer and both writers | `pnpm exec vitest run packages/shared/src/xmlText.test.ts packages/codegen/src/xmlIntegrity.test.ts packages/editor/src/export/aiDisclosure.test.ts` | 19 passed |
| Unit tests for grapheme truncation and the dialog | `pnpm exec vitest run packages/shared/src/truncateText.test.ts packages/editor/src/lifecycle/__tests__/terminationDialogHost.test.tsx` | 20 passed |
| Changed-component regression | `pnpm exec vitest run packages/editor/src/components/Inspector/sections/FontDetectSection.test.tsx …` | 48 passed across 6 files |
| Type checking | `pnpm --filter @varve/shared --filter @varve/codegen --filter @varve/editor typecheck` | clean |
| Format/lint/audits | commit checkpoint (Biome staged, emoji, health, contacts, docs, secrets, import boundaries, E2E typecheck) | passed |
| Real workflow, browser | `tests/e2e/dialogs/lightcraft-name-truncation.spec.ts` (Chromium, Linux) | see `continuation.md` |
| Documentation drift | `pnpm audit:docs` | clean |

The full `@varve/editor` Vitest package and the Rust workspace were **not** run
locally: the planner selects them through the shared-package dependency edge,
and the repository's commit checkpoint defers full suites to CI. The affected
package closure was type-checked, and every changed behaviour has a direct
test that would fail without the change. Native Tauri behaviour (the quit
dialog inside WebKitGTK) was not exercised; the browser lane is the evidence
that exists.

## 8. Documentation and website impact

- `apps/website/src/pages/docs/tools/export.astro` gained one paragraph in the
  SVG section stating that text is written as well-formed XML, that
  control characters pasted from another application are removed, and that an
  unpaired surrogate becomes U+FFFD. This describes behaviour a user can
  observe in the shipped exporter; no capability claim was added.
- No other marketing claim needed to change: neither fix adds a capability, and
  no page asserted byte-identical or lossless text preservation.
- The gradient/pattern and PDF pages were reviewed and left unchanged — their
  stated limitations still match the code.

## 9. Reconciliation with the independent classification pass

A second, independent pass classified all 981 records from their bodies. It
proposed 366 records as "applicable work"; this ledger keeps 90 in that queue.
The difference is deliberate, not an oversight:

- That pass counted capability requests as applicable work. A request is not a
  failure, and Varve does not adopt a feature because another product has it.
  The ledger files those under `feature-request` with an explicit reason.
- It counted photo-catalog behaviour (culling, stacks, virtual copies, missing
  file relinking, sidecar ownership) as applicable because the *mechanism*
  reads as generic. Varve has no catalog, so there is no code path to fix.
- It proposed `already-handled` for lightcraft-side fixes (for example #93,
  #98, #103, #180). Those say what upstream shipped, not what Varve does; this
  ledger verified Varve source separately and only then used that verdict.

What was adopted from the pass:

- **The duplicate map** (58 records) is now `duplicate_of` in the ledger, so
  repeated reports cannot inflate the evidence for a finding.
- **Two corrections** to the screened queue: #2462 records that the planar-TIFF
  fix in #1983 was incomplete (so the resource-bound class stays open), and
  #674 records that its submitted fix was reverted by its author (a closed
  issue is not a landed fix).
- **Title/body contradictions** worth remembering before citing an issue as
  proof: #1952 (the alpha direction is the opposite of its summary), #342
  (a file-dialog extension filter, not a decoder defect), #1093 (collapse, not
  close), #465 (verified working in a later comment), #2166 (a migration gap
  for old documents, not a live colour bug).
