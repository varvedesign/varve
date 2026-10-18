# Photocraft corpus → Varve findings

Source tracker: [storytold/pdfcraft](https://github.com/storytold/pdfcraft/issues)
(the project renamed from `photocraft`; both paths resolve to the same
repository, default branch `main`).

This document is the engineering record for the corpus review. The
machine-readable per-issue ledger lives beside it
(`issue-ledger.jsonl`, `issue-ledger.summary.json`); the durable continuation
state is in `continuation.md`.

## 1. Baseline

| Item | Value |
|---|---|
| Varve checkout | `/home/kevina/CodingProjects/varve`, branch `master` |
| Starting commit | `32de0c41c docs(adr): tie the unresolved local-undo pixels to the documented stale frame` |
| Divergence at start | 115 commits ahead of `origin/master`, 5 behind it; `master` is unprotected on `varvedesign/varve` (the old `K-Arthur/varve` URL redirects there) |
| Pre-existing working-tree state | 23 modified + 14 untracked paths owned by other in-flight sessions (load/save truthfulness, native lifecycle, collaboration host, presentation E2E) — **not touched by this work** |
| Pre-existing failure | `packages/scene/src/index.ts` exports `./nodeResize`, but `packages/scene/src/nodeResize.ts` was never committed by `5812b7f16`, so a clean checkout of local `master` cannot build. Restored in this branch (see §6.1) |
| Heavy-task coordination | `scripts/quality/heavy-lease.mjs` (cross-worktree exclusive lease + `MemAvailable` gate). All E2E work goes through it |
| Deployment consequence | A push to `master` touching `packages/**` or `apps/website/**` runs `.github/workflows/website-deploy.yml`, which publishes the production site. The task brief authorizes normal task-related pushes and merges; verify the exact workflow trigger and branch protection before using that authorization. A separate manual release requires separate authorization |

## 2. Corpus inventory

| Item | Value |
|---|---|
| Crawl | `GET /repos/storytold/pdfcraft/issues?state=all&per_page=100&sort=created&direction=asc` and `GET /repos/storytold/pdfcraft/issues/comments?per_page=100`, both followed through every `Link` cursor by `gh api --paginate` |
| Crawl window (UTC) | `2026-10-17T04:41:35Z` → `2026-10-17T04:42:17Z` |
| Issue-endpoint records | **2 978**, all unique by `id` |
| Issues (PR records removed) | **1 296** — 827 open, 469 closed (394 `completed`, 13 `not_planned`) |
| Pull requests (retained as linked evidence) | **1 682** — 583 open, 1 099 closed |
| Comments | **3 267** total — 1 717 attached to issues (883 issues have at least one), 1 550 on pull requests |
| Search-total reconciliation | `827 + 469 = 1 296` issues and `583 + 1 099 = 1 682` PRs — exactly matches the API enumeration, so no page was missed |
| Number range | #8 … #2978 (one number sequence shared with PRs; the highest number is not an issue count) |
| Bodies | 1 279 non-empty; median 908 characters; longest 57 572 |
| Labels | Only 347 of 1 296 issues carry any label (`priority: medium` 149, `multiple issues` 66, `bug` 62, `duplicate` 49) — so labels could order work but could not define scope |
| Integrity | `issues.ndjson` sha256 `197abc45…c2fa`; `comments.ndjson` sha256 `d5d6fa8b…46f5` |

The tracker is a PDF editor with 583 open pull requests and heavy bot
activity ("possibly related" comments on many issues). Bot links were treated
as unverified pointers: followed only when they named a concrete mechanism or
a second reproduction, never as evidence of a shared root cause.

### Coverage

Every one of the 1 296 issues received a disposition (see
`issue-ledger.summary.json`):

| Disposition | Count |
|---|---|
| `out-of-scope` (named product boundary, §3; includes no-signal records) | 677 |
| `screened-for-varve` (failure class reaches a Varve subsystem) | 405 |
| `already-handled` (verified in Varve source) | 207 |
| `implemented` in this corpus pass | 7 |

Reading depth is recorded per issue and is **not** uniform:

- **25** issues were read with their full comment thread (the named seeds plus
  every thread a class investigation depended on).
- **1 258** were read at title + full body.
- **13** were title-only (bodies empty); those are recorded as such rather
  than presented as reviewed text.

Attachment-only evidence (screenshots, recordings, attached PDFs) was **not**
downloaded: it is bulk third-party material, most of it re-encoded by GitHub's
asset proxy, and no conclusion in this pass depends on a pixel in another
product. Where a class's only evidence is an attachment, the ledger says so.

## 3. Product boundary (why 677 issues are excluded)

Varve authors documents and imports/exports them. It is not a PDF
page-description runtime, a form engine, a signing authority, or a redaction
appliance. Exclusions are per family, with the reason recorded per issue:

| Family | Why it is not a Varve defect |
|---|---|
| Digital signatures, certificate validation, QES/DSC | No signing trust surface exists; adding one is a separate product decision |
| Redaction, sanitising, decryption, PDF security | Integrity tooling, not authoring; Varve must not claim a capability it does not implement |
| AcroForm/XFA authoring, field scripting, calculations | No form runtime |
| PDF/A, PDF/X conformance, output intents, tagged PDF, outlines, destinations, portfolios | Document-metadata interchange, not artwork fidelity |
| OS printing, drivers, spooling, paper sizes | Platform print stack; Varve produces PDF |
| Packaging, installers, updaters, AUR/winget/brew, code signing of *that* product | Varve has its own release pipeline |
| Localisation coverage requests | Varve ships its own locale set |
| Feature requests for capabilities Varve has, deliberately lacks, or would have to justify | Not a transferable defect |

Every exclusion is a product-boundary statement, not a claim that the
reported behaviour is acceptable — in the source product it may well be a
serious bug.

## 4. Failure classes and their Varve verdicts

Classes are ordered by the severity policy in the assignment: data
loss/corruption and crashes first, then wrong documents/output, broken core
interactions, accessibility/performance, then useful improvements.

### 4.1 Text edits lost inside an editing session — **implemented; browser-verified**

- **External evidence** — [#811](https://github.com/storytold/pdfcraft/issues/811)
  "save and close ignore typing in an open paragraph" (closed via linked #843;
  the source issue's UI sequence was statically established, not executed);
  [#166](https://github.com/storytold/pdfcraft/issues/166) "Save omits AcroForm
  text while the field remains focused" (closed/completed);
  [#2022](https://github.com/storytold/pdfcraft/issues/2022) "text edits are not
  saved when switching between text boxes" (closed, fix landed upstream);
  [#347](https://github.com/storytold/pdfcraft/issues/347),
  [#2862](https://github.com/storytold/pdfcraft/issues/2862) same symptom on
  other entry points.
- **Comparable-app complaints** — Inkscape users separately report a missing
  unsaved-changes prompt after a background preference change and undo
  ([#2635](https://gitlab.com/inkscape/inkscape/-/work_items/2635)), text
  formatting and size changing after Save a Copy
  ([#2797](https://gitlab.com/inkscape/inkscape/-/work_items/2797)), and
  intermittent mixed-style text changes after save/reopen
  ([#13360](https://gitlab.com/inkscape/inbox/-/work_items/13360)). These
  firsthand reports show the user-visible cost of dirty-state and text
  persistence failures; they do not establish that Inkscape and Varve share a
  root cause. They strengthen the acceptance requirement to verify both the
  save decision and reopened document content.
- **User problem** — the paragraph on screen and the paragraph in the file
  disagree for a short window. Save, close, or quit inside that window
  persists (or keeps) a document missing the tail of the text, and because the
  model never saw those characters the document can still report itself clean.
  The user finds out on reopen.
- **Varve code path** — `components/TextEditOverlay.tsx` coalesces typing
  (`scheduleTextUpdate`, 100 ms; the coalescing is deliberate and mirrors the
  opposite failure in [#2616](https://github.com/storytold/pdfcraft/issues/2616)),
  then writes through `editor.updateNode`. The save engine
  (`context/usePersistence.ts#runSave`, "the one save engine… menu Save,
  keyboard Save, quit Save and Save As") captured `stateRef.current.document`
  with no drain, and the termination coordinator
  (`lifecycle/coordinator.ts#run`) derived the unsaved set from session dirt
  flags that cannot see a buffered keystroke.
- **Current observed behaviour** — verified by reading the two call sites and
  by the drain contract's absence: no module in the editor could ask an
  editing surface to publish held-back input.
- **Intended outcome** — anything that observes or persists the model on the
  user's behalf sees what the user sees; typing coalescing and undo
  granularity are unchanged.
- **Implementation** — `context/pendingEdits.ts` (registry + synchronous
  drain), registration in `TextEditOverlay`, drain at the head of `runSave`,
  drain in the coordinator's `run`/`shouldWarnOnUnload`/`bestEffortFlush`
  through a new `flushPendingEdits` dependency wired in `LifecycleProvider`.
- **Acceptance criteria and evidence** —
  1. A save taken while the textarea holds unapplied characters writes every
     character: `tests/e2e/save/text-draft-save.spec.ts`.
  2. Closing immediately after typing still counts the draft as unsaved work:
     same spec, second case.
  3. A drain publishes the whole draft and settles the transaction without
     ending the session: `TextEditOverlay.test.tsx`.
  4. Termination and unload paths drain before deriving the unsaved set:
     `lifecycle/__tests__/coordinator.test.ts`.
  5. Registry mechanics (replace, stale cleanup, skip-settled):
     `context/pendingEdits.test.ts`.
  6. A save during active IME composition snapshots the visible candidate,
     leaves native composition open, and closes the typing transaction only
     at `compositionend`: `TextEditOverlay.test.tsx`.
  7. The current Chromium E2E run passed both saved-byte and close-unsaved
     cases. Its pre-save screenshot was inspected and retained at
     `docs/audits/photocraft/evidence/text-draft-before-save.png`.
     The browser run used the browser save-picker stub and fell back from WASM
     to the TypeScript renderer; it does not cover the native Tauri menu path.

### 4.2 Edit-target identity drift — **already handled, verified**

- **External evidence** — [#2516](https://github.com/storytold/pdfcraft/issues/2516)
  (critical) paragraph numbers shift after an edit so the next edit rewrites a
  different paragraph; #2517, #2564, #1680, #2508 same mechanism.
- **Mechanism in the source product** — paragraphs are addressed by ordinal
  position in a list regrouped from geometry after every edit, so an edit that
  changes the grouping retargets the next edit and destroys text.
- **Varve verdict** — not the same class. Text content is addressed by
  `SceneNodeId` and grapheme offsets
  (`TextEditOverlay`, `createUnicodeIndexMap`/`normalizeGraphemeRange`), never
  by an ordinal recomputed from layout. A reflow cannot retarget an edit.
- **Residual risk** — the class would reappear if any surface introduced
  layout-derived indices. Recorded as a review question, not an open defect.

### 4.3 Locked objects — **already handled, verified (correcting the earlier ledger)**

- **External evidence** — [#6770](https://github.com/storytold/pdfcraft/issues/6770),
  #5623, #5655: plugin/filter paths mutate locked layers that every built-in
  command refuses.
- **Earlier note corrected** — an earlier body-level pass recorded "locked
  nodes are not enforced in the operation layer; a multi-selection containing
  locked nodes still exposes transform handles". Source verification this pass
  found that claim **wrong on both halves**, and the correction is recorded
  here rather than quietly dropped:
  - Lock enforcement is not per-surface-only. Click (`HitTestPolicy`), marquee
    (`marqueeGeometry`), select-all/select-similar (`selectionCommands`
    `isSelectable`/`effectivelySelectable`), nudge
    (`planManualWorldTranslation` → `collectManualPositionRoots` →
    `locked-or-hidden`), canvas drag (same planner), align/distribute (same
    collector) and the isometric commands all exclude effectively-locked and
    hidden nodes, including through ancestors.
  - Multi-selection does paint resize handles, but they are intentionally
    inert: `SelectionOverlay.test.tsx` pins "shows no interactive handles for
    multi-selection (dashed bbox, handles still in DOM with pointerEvents:none)".
    The hit targets carry `pointerEvents: 'none'` and no handlers, so they do
    not swallow clicks either.
- **What remains a genuine question** — whether *any* surface that writes
  geometry can still be driven for a locked node (Inspector restrictions
  disable the whole edit surface when any selected node is locked:
  `inspectorContext.canEditSelection`/`hasPartialLock`). No counter-example was
  found.

### 4.4 Untrusted recursion in import — **already handled, verified**

- **External evidence** — [#6423](https://github.com/storytold/pdfcraft/issues/6423)
  (self-referencing compound shape recurses until stack overflow, 280-byte
  reproducer), #1799, #1800.
- **Varve verdict** — import walks carry both a depth ceiling and a visited
  set: Figma source/native (256), SVG nesting depth, SVG `<use>` cycle guard
  (with `visitedIds` add/delete bracketing), EXIF IFD chain guard, ICC chain
  guard, gradient descriptor depth. A depth bound alone would not stop a
  cycle; Varve has both shapes.

### 4.5 Corrupt or unrecognised document input — **already handled by an in-flight session**

- **External evidence** — the tracker's load-boundary reports (e.g.
  [#1937](https://github.com/storytold/pdfcraft/issues/1937) damaged
  cross-reference table, #2722 missing pages) and the `designcraft` #1049/#744
  class another Varve session is currently implementing.
- **Varve state** — `DocumentCodec.decode` returns a structured result with
  warnings; a malformed version field, a migration throw and an unreadable
  legacy field are being handled in the uncommitted work owned by that
  session. This pass deliberately did **not** touch `documentCodec.ts`,
  `version.ts`, `expr.ts` or `usePersistence.ts`'s encode path for that
  reason.

### 4.6 Silent font substitution and missing-glyph disclosure — **already handled, verified**

- **External evidence** — [#2378](https://github.com/storytold/pdfcraft/issues/2378)
  (one character outside the subset switches the whole line to Helvetica),
  #2750, #2908 (Cyrillic blank when the font is not embedded), #2946
  (byte-swapped `post` version rejected → Hebrew falls back), #2354, #34,
  #2649, #2401.
- **Transferable rule** — a missing glyph must be resolved without changing the
  metrics of the text that *did* have coverage, and it must be reported rather
  than silently replaced.
- **Varve verdict** — the disclosure half is implemented and user-facing.
  `packages/engine/src/font/fontResolver.ts` classifies a text reference as
  `missing` / `missing-family` / `missing-face` / **`missing-glyph`**, records
  the offending characters (`missingGlyphs`), derives a diagnostic reason, and
  offers progressive substitutes. `FontBrowser/MissingFontDialog.tsx` renders a
  "Missing glyphs" category with a recovery flow
  (`missingFontRecovery.ts`, `MissingFontController.tsx`). A substitution
  cannot happen without a finding.
- **Residual question (not a defect claim)** — whether the *rendering*
  substitution is per run/character while preserving covered runs, or
  whole-node. `docs/architecture/text-pipeline.md` describes per-run shaping;
  this pass did not exercise a mixed-coverage string end to end.
- **Screened neighbours** — [#6883](https://github.com/storytold/pdfcraft/issues/6883)
  colour emoji rendering and #6846 (Persian ZWNJ) remain in the queue: both are
  shaping questions rather than substitution-disclosure questions.

### 4.7 Render compositing against the wrong backdrop — **open, screened**

- **External evidence** — [#2970](https://github.com/storytold/pdfcraft/issues/2970)
  (Screen/Lighten/Overlay/Difference over an empty page blend with white
  instead of the transparent backdrop, so green comes out white — a regression
  against their own 0.7.1), #2971 (knockout groups ignored), #2975 (stencil
  mask alpha applied twice), #2200, #1560.
- **Varve surface** — `@varve/compositor` (Canvas2D/WebGPU/WebGL2),
  `canvas/renderPipeline.ts`, `docs/architecture/blend-evaluation-policy.md`.
- **Status** — screened; needs a same-camera differential oracle (the repo
  already requires one for pixel-reuse changes) before any claim about the
  canvas/compositor. The PDF probe in §6.3 verifies only exported PDF output.

### 4.8 Stale derived renders after a geometry change — **screened, partially covered**

- **External evidence** — [#6808](https://github.com/storytold/pdfcraft/issues/6808)
  (a fill layer's cached render keeps drawing for the old frame after free
  transform/warp; the reporter names the sibling paths that do invalidate).
- **Varve state** — this is the class AGENTS.md already legislates ("never show
  pixels no fresh frame will replace") and defends with hash-based IR keys
  (`canvas/subtreeIrCache.ts` hashes every render-relevant field), tile
  identities (ADR-0241), and a forced-full-redraw oracle
  (`__varvePerf.forceFullRedraw`). The structural defence is present; the
  remaining question is coverage (which mutation paths have an oracle test),
  not a missing mechanism.

### 4.9 Async results applied to the wrong document — **screened**

- **External evidence** — [#813](https://github.com/storytold/pdfcraft/issues/813)
  (a cancelled password recovery changed the next document's save
  destination), #167, #171, #1801 (OCR results applied without a generation
  check), #1805.
- **Transferable rule** — every async completion carries the document/session
  identity *and* the generation it started for, and drops the result with a
  visible reason when that target is gone.
- **Varve surface** — import/export jobs, thumbnail scheduler,
  background-removal and upscale workers, collab host.

### 4.10 Success reported without durable acknowledgement — **screened**

- **External evidence** — #2167, #1792, #1804; the class is "request
  dispatched" reported as "bytes durable".
- **Varve state** — an in-flight session is implementing read-back verification
  for exactly this (`persistence/saveTruthfulness.ts`, uncommitted). Not
  duplicated here.

### 4.11 Export fidelity and export claims — **partial; targeted PDF output verified, standards conformance unverified**

- **External evidence** — #2806 (DOCX export drops text), #1936/#526 (images
  not retained), #2259/#2411 (output intent claimed from a whitespace scan of
  the content stream), #2924 (compression claims).
- **Transferable rule** — re-extract the produced file and compare against the
  source region; never claim a conformance level the produced bytes do not
  support.
- **Comparable-app complaints** — Penpot users report that placed images in
  PDF export are downsampled to their on-canvas 72-dpi size regardless of
  source pixels or export settings ([#7047](https://github.com/penpot/penpot/issues/7047)).
  Illustrator users report a soft white box where a transparent PNG sits in a
  PDF/X-1a export ([Adobe Community](https://community.adobe.com/questions-652/soft-white-box-when-exporting-artwork-with-transparent-image-808510)).
  These reports do not prove a Varve defect; they reinforce that users need
  either faithful output or a precise stop before a misleading file is saved.
  Adobe's guidance describes flattening as necessary when a target cannot
  carry transparency and distinguishes PDF/X-4's live transparency path
  ([Illustrator transparency guidance](https://helpx.adobe.com/illustrator/using/printing-saving-transparent-artwork.html)).
- **Varve surface** — `crates/varve-print` (PDF/X, CMYK, ICC), code export,
  image export.
- **Implemented slice** — PDF blend modes now use PDF ExtGState entries for
  representable node/fill modes. PDF/X-1a refuses unsupported blend modes in
  both preflight and the Rust/native export boundary, and refuses explicit
  object/fill opacity and alpha-bearing image/pattern sources instead of
  writing live transparency or silently omitting a tile. PDF/X-4 carries
  supported blend modes and live transparency. User guidance and the public
  export feature page describe the same boundary.
- **Remaining acceptance** — render representative generated PDFs through an
  independent viewer and compare measured pixels/structure; formally validate
  PDF/X with a standards checker when available; verify image resolution and
  all transparency/color cases. No PDF/X certification claim is made from the
  present tests.

### 4.12 Unbounded per-operation work — **screened**

- **External evidence** — #307 (16 GB RAM for a 186 MB file), #971 (`text_find`
  extracted every page before honouring `limit`), #2616 (per-keystroke full
  page re-layout), #6110 (unbounded stroke coverage allocation), #1796
  (decoder ignoring the caller's output budget).
- **Transferable rule** — a document-scale operation is bounded by an explicit
  memory/time budget and can return a partial result; a decoder enforces its
  own budget rather than trusting the caller.
- **Varve state** — partial: `MAX_STROKE_OPACITY_BYTES`, decode dimension
  guards, thumbnail scheduler concurrency 1. Verification pending.

### 4.13 Dirty state and history truthfulness — **screened**

- **External evidence** — #1312 (undo to the opened revision still reports
  unsaved work), #2663 (autosave only runs when the window repaints), #1803 (a
  failed autosave suppresses retries), #6865/#6732 (non-mutating actions mark
  the document modified).
- **Varve surface** — `persistence/documentRevision.ts`, history sessions,
  `autoSaveService`. Screened: the transactional model already distinguishes
  preview from edit, so the specific failures may not be expressible; that has
  to be shown, not assumed.

## 5. Evidence limitations for this corpus pass

- No photocraft/pdfcraft build was run. Every external issue is *report* or
  *source-quoted*, never reproduced in that application by this review.
- Attachments (screenshots, recordings, attached PDFs) were not downloaded, so
  a class whose *only* evidence is an attachment is recorded as report-only.
- Class verdicts for Varve are of three strengths and are labelled as such:
  **verified-in-source** (the mechanism was read and the disposition follows
  from it), **implemented-and-tested** (a failing/covering test exists in this
  branch), and **screened** (the class reaches a Varve subsystem and is queued;
  no claim is made that Varve currently fails).
- `screened-for-varve` is not a finding. It is a queue position.

## 6. Implementation log

### 6.1 Pre-existing build omissions in unowned working-tree files

`5812b7f16 feat(scene): canonical durable annotations with per-entity history`
committed `export * from './nodeResize'` in `packages/scene/src/index.ts` and
committed call sites in `packages/editor/src/context.tsx` and
`packages/automation/src/commands/node.ts`, but never committed
`packages/scene/src/nodeResize.ts`. The starting commit therefore cannot
resolve `@varve/scene` from a clean checkout.

The same omission exists a second time in `@varve/codegen`: committed sources
(`src/index.ts`, `src/css-modules.ts`, `src/tailwind.ts`) import
`./bundle-assets`; that source is also absent from the starting commit.

Both source files are currently present as untracked files in this worktree.
They match files in another active working tree, so their ownership remains
unresolved and they are intentionally excluded from this branch's changes.
Their hashes identify the exact copies that allowed local typechecks to
resolve the imports; they are not committed by this task:

| File | sha256 |
|---|---|
| `packages/scene/src/nodeResize.ts` | `59bcc566e4dcecfee1eba10f0f891c56fcd2e4a7edb2c7af8bb85dcf978f4203` |
| `packages/codegen/src/bundle-assets.ts` | `4bdb11a0014031968ed5de0e0768e1acb89c0526465241fd4981f2a30cfcdafd` |

The current `pnpm verify:affected` plan includes the separate codegen file and
stops at its formatting check. Clean-checkout build validation and integration
remain blocked until the owning change lands or the task branch can use a base
that contains these modules. No other agent's files were edited or staged.

### 6.2 Pending text draft flush — **unit and browser-verified; native path pending**

Files: `packages/editor/src/context/pendingEdits.ts` (new),
`components/TextEditOverlay.tsx`, `context/usePersistence.ts`,
`lifecycle/coordinator.ts`, `lifecycle/LifecycleProvider.tsx`, plus
`tests/e2e/save/text-draft-save.spec.ts` (new) and unit tests listed in §4.1.

Documentation updated in the same change: `docs/architecture/text-pipeline.md`
(the draft-drain contract) and `docs/architecture/lifecycle-system.md` (the
termination path drains before deciding). The latest focused editor, lifecycle
and registry unit run passed (49 tests across three files). The current
lease-wrapped browser run passed both saved bytes and the close-unsaved
decision, and its screenshot was visually inspected.
The browser used the TypeScript renderer fallback and browser Save picker
stub; native Tauri menu coverage remains outstanding. This is focused workflow
evidence; broader save/recovery scenarios remain outside this slice.

### 6.3 PDF blend and PDF/X-1a transparency fidelity — **unit-tested; sample output visually verified; PDF/X conformance unverified**

Files: `crates/varve-print/src/blend.rs`, `crates/varve-print/src/lib.rs`,
`crates/varve-print/src/cmyk.rs`, export preflight in
`packages/scene/src/export/`, and `packages/editor/src/components/SpecPanel/export.ts`.

The Rust print tests pass (188 tests), including image-fill blend-state emission,
perspective opacity multiplication, PDF/X-1a refusal for node opacity, alpha
images, alpha pattern tiles, and unsupported blend modes at the Rust/native
boundary; PDF/X-4 carries supported blend modes and live transparency. The
scene/editor-focused rerun passed 208 tests across five files; the PDF commit
checkpoint reran 83 tests across three files. Editor, scene, and website
typechecks pass. Five
PDFs from `crates/varve-print/examples/blend_probe.rs` were rendered with
Poppler `pdftoppm` at 72 dpi and visually inspected. Center-pixel samples were
Screen green over an unpainted page `(0, 255, 0)`, Multiply red over blue
`(0, 0, 0)`, Screen raster red over blue `(255, 0, 255)`, 50% node opacity
`(128, 0, 127)`, and combined 25% red over blue `(64, 0, 191)`. PDF structure
was also checked with `pdfinfo` (single page, 200×200 pt, PDF 1.4). This
validates sample ordinary-PDF output; it is not a formal PDF/X conformance
certificate. A standards checker is not installed. Website feature/help copy
and `docs/architecture/fill-system.md` now state the PDF/X-1a limitations and
the PDF/X-4 blend/transparency behavior. Both changed pages were captured and
visually inspected at desktop width; mobile viewport screenshots and the
PDF/X standards-validator check remain pending.
