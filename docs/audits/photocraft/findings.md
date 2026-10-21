# PdfCraft corpus → Varve findings

Source tracker: [storytold/pdfcraft](https://github.com/storytold/pdfcraft/issues),
default branch `main`. The task brief also linked
[storytold/photocraft](https://github.com/storytold/photocraft/issues), which the
GitHub API confirms is a separate repository. The user resolved this conflict
by selecting PdfCraft because it matches the five seed issue links and the
existing audit corpus. The `photocraft/` audit directory is retained for
continuity; it does not refer to the separate PhotoCraft repository.

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
| `screened-for-varve` (failure class reaches a Varve subsystem) | 407 |
| `already-handled` (verified in Varve source) | 205 |
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

### Cutoff B inventory and review status

The second API crawl ran `2026-10-18T12:28:21Z`–`2026-10-18T12:28:46Z` UTC.
Pagination and search reconciliation found 3,249 unique issue-endpoint records: 1,454
issues (936 open / 518 closed) and 1,795 PRs. All cutoff A issue IDs remain
present; 158 new issues were created after A, 40 existing issues changed state,
and 251 issues were updated. All 158 new issue bodies and current comment
threads have now been reviewed. Review dispositions and depth are in
`issue-ledger-follow-on-b.jsonl`; linked evidence and attachments remain an
open frontier as detailed below. The raw response is outside Git at
`/tmp/opencode/photocraft/pdfcraft-cutoff-b-pages.json` (SHA-256
`13e385871d051ce3a18734bcc8a3b1ebab875b2e749ae2cb9a2515c9ff29748a`).

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

### 4.1 Text edits lost inside an editing session — **implemented; save/close browser-verified**

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
  8. Directly switching from one text node to another while the first node has
     buffered characters is a separate interaction and was not covered by
     those save/close cases. PdfCraft #2022 is upstream-fixed (PR #2302), but
     Varve's matching browser regression remains pending until that exact
     target-switch workflow is exercised.

### 4.2 Edit-target identity drift — **source-specific report; Varve has stable authored-node identity**

- **External evidence** — [#2516](https://github.com/storytold/pdfcraft/issues/2516)
  (critical) a PDF paragraph ordinal becomes stale after geometric regrouping;
  its proposed mitigation PR [#2756](https://github.com/storytold/pdfcraft/pull/2756)
  remains open and unmerged. #2517 is a separate grouping/deletion report,
  with open draft PR #2529; #2508 tracks durable PDF marked-content identity.
  These are related PDF paragraph API problems, not a single reproduced
  Varve defect.
- **Mechanism in the source product** — paragraphs are addressed by ordinal
  position in a list regrouped from geometry after every edit, so an edit that
  changes the grouping retargets the next edit and destroys text.
- **Varve verdict** — authored text content is addressed by `SceneNodeId` and grapheme offsets
  (`TextEditOverlay`, `createUnicodeIndexMap`/`normalizeGraphemeRange`), never
  by an ordinal recomputed from layout. This supports stable identity for
  Varve-authored text; it does not implement or verify PdfCraft's ordinal PDF
  paragraph editing API. Ledger #2516 is therefore source-specific/out of
  Varve scope, not evidence that the whole class is handled.
- **Residual risk** — the class would reappear if any surface introduced
  layout-derived indices. Recorded as a review question, not an open defect.

PdfCraft #2512 is an open design proposal for a one-paragraph editing session.
It is related to session lifetime and latency, not digital signatures (the
previous ledger rationale was incorrect). It does not report a reproduced
failure. Varve's buffered text draft drain is an implementation choice for its
own editor; it does not establish that PdfCraft's proposed architecture is
needed or that the two products share a defect.

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
- **Adjacent-repository evidence (outside this corpus)** — the similarly
  numbered [PhotoCraft #6883](https://github.com/storytold/photocraft/issues/6883)
  and [#6846](https://github.com/storytold/photocraft/issues/6846) report
  platform-specific emoji glyph rendering. The Persian keyboard report is
  [PhotoCraft #4073](https://github.com/storytold/photocraft/issues/4073):
  macOS Shift+Space inserts an ordinary space instead of U+200C. These are not
  PdfCraft issues, so they are not in this review queue. Static Varve review
  found color-font outline limitations documented in `textOutlines.ts` and the
  text-pipeline docs, while canvas rendering has platform emoji fallback; no
  Varve rendering failure was reproduced. The Shift+Space report is an OS text
  input path and no Varve reproduction was performed. Keep these as adjacent
  research leads, not PdfCraft findings.

### 4.7 Render compositing against the wrong backdrop — **screened; authored PDF output verified**

- **External evidence** — [#2970](https://github.com/storytold/pdfcraft/issues/2970)
  includes a minimal generated PDF and distinguishes a transparent page
  backdrop from paper white. Its current comments add a public
  [libharu demo fixture](https://github.com/libharu/libharu/blob/3467749fd1c0ab6ca6ed424d053b1ea53c1bf67c/demo/ext_gstate_demo.pdf)
  (10,387 bytes; SHA-256
  `01e2126bab892af1c7248aadb723ccfc3f8e7bce0fb01265f8d5a19a0067352a`) and
  report that [PR #2972](https://github.com/storytold/pdfcraft/pull/2972)
  fixes the source renderer against MuPDF. The PR remains open and unmerged;
  its tests and comparison were inspected, not run here. The public fixture was
  downloaded, hash-verified, and visually inspected with Poppler; it shows
  labelled normal, alpha, and separable blend examples. #2971 reports ignored
  knockout groups, #2975 double-applied stencil-mask alpha, alongside #2200
  and #1560.
- **Varve surface** — `@varve/compositor` (Canvas2D/WebGPU/WebGL2),
  `canvas/renderPipeline.ts`, `docs/architecture/blend-evaluation-policy.md`.
- **Transfer to Varve** — only the compositing invariant transfers: layer
  content should preserve the source colour over an empty transparent area,
  while still blending with existing content. PdfCraft's fix is inside its PDF
  page-group renderer, which Varve does not share. The Varve PDF import path is
  explicitly partial and does not implement an existing-PDF page renderer.
  Varve's authored-PDF path was exercised with the real Rust `export_pdf`
  entry point: `blend_probe.rs` exported `screen-over-empty.pdf`, Poppler 26.05.0
  rendered it at 72 dpi, `pdfinfo` reported one 200×200 pt PDF 1.4 page, and
  the rendered sample pixel was green `(0, 255, 0)` over the page's white
  display backdrop. The screenshot
  [`pdf-blend-screen-empty.png`](evidence/pdf-blend-screen-empty.png) was
  inspected; SHA-256 is
  `fe4b97d838847b3ed8aab12b7b6dfefc5908780b9c6e0f733517b16c508bbd19`.
  The focused `screen_over_an_unpainted_area_keeps_the_source_colour` test
  passed. This establishes authored-PDF behavior for the reported Screen case,
  not the full Canvas2D/GPU compositor or a general PDF reader.
- **Related source branches** — #1968 is a separate imported Foxit highlight
  appearance/alpha failure and has no Varve PDF-annotation workflow. #1548 is
  the reading-colour regression that motivated #1557; its merged patch keeps
  annotations out of document-colour replacement and puts the page background
  inside the page group only in reading-colour mode. The unconditional
  background placement then broke #2970. Cross-project
  [VectorCraft #827](https://github.com/storytold/vectorcraft/issues/827)
  reports a Screen outer glow over gray being emitted as Normal; the reporter
  compared sampled PDF pixels against PNG and observed the backdrop's green and
  blue channels drop from 128. The issue was fixed by merged
  [PR #884](https://github.com/storytold/vectorcraft/pull/884), whose test
  exports a Screen glow and Multiply shadow and checks their compositing. This
  is a distinct output path. A Varve authored-PDF probe found that `render_effects`
  painted drop shadows without applying their blend mode or alpha. The PDF
  output now carries an effect-local ExtGState, including explicit Normal to
  override a non-Normal node mode, and combines node opacity, effect opacity,
  and shadow-colour alpha. Unsupported modes are reported by export preflight;
  PDF/X-1a refuses effect transparency and unsupported modes. A generated
  red Screen shadow over gray was exported by the real Rust writer and rendered
  with Poppler 26.05.0. `pdfinfo` reports one 200×200 pt PDF 1.4 page. At 72 dpi,
  sample pixel `(150, 100)` inside the shadow is `(255, 128, 128)`; unshadowed
  gray at `(10, 10)` remains `(128, 128, 128)`. Normal blending would instead
  have discarded the backdrop channels. The render
  [`pdf-drop-shadow-screen-over-gray-after.png`](evidence/pdf-drop-shadow-screen-over-gray-after.png)
  was visually inspected; the generated source PDF is
  [`drop-shadow-screen-over-gray.pdf`](evidence/drop-shadow-screen-over-gray.pdf).
- **Status** — the authored-PDF Screen-over-empty-page case was verified with no
  defect. The separate authored drop-shadow blend/alpha implementation and
  three-source alpha regression are in the worktree. With test/dev debug info
  and incremental artifacts disabled, all 198 `varve-print` tests, crate
  Clippy, and 134 desktop Rust tests passed. The website E2E lane completed
  with 687 passed and 3 failed: the unrelated homepage light/dark and footer
  dark global visual snapshots on the GitHub Pages base each captured page
  height one pixel away from baseline. The changed `/features/export` route
  passed axe checks in light and dark on both site bases, and computed-style
  contrast checks in light and dark on the custom-domain base. Full-page export
  route captures at 1440×1000 and 390×844 were visually inspected; the new copy
  remains readable and the narrow layout has no horizontal overflow. Evidence:
  [`website-export-feature-pdf-shadow-desktop.png`](evidence/website-export-feature-pdf-shadow-desktop.png)
  and
  [`website-export-feature-pdf-shadow-mobile.png`](evidence/website-export-feature-pdf-shadow-mobile.png).
  A final docs/evidence `verify:affected` rerun repeated its audits, website
  typecheck/unit, and `varve-print` test/Clippy successfully, but its repeated
  desktop lane stopped when concurrent shared work filled `/`; Cargo reported
  `No space left on device`. The earlier low-debug desktop run passed all 134
  tests. Only this worktree's target was cleaned afterward. The PdfCraft
  existing-PDF renderer and full GPU compositor remain outside this
  verification; no fix to their behavior is claimed.

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
  reports recovery metadata from a cancelled password prompt being applied to
  the next encrypted document and changing its Save destination. The issue
  describes the cross-document overwrite as established by static proof; the
  UI sequence was not executed, and its fix status was not verified. #167 is a
  deterministic delayed-import wrong-document repro; #171 is a delayed startup
  open that steals active focus; #1801 reports stale OCR page indices and
  redacted text reappearing but explicitly says its evidence is static review
  only; #1805 is a CLI/MCP output collision race.
- **Transferable rule** — every async completion carries the document/session
  identity *and* the generation it started for, and drops the result with a
  visible reason when that target is gone.
- **Varve surface** — `useFileImport.ts` captures the destination document,
  session and revision and is covered by `useFileImport.test.tsx`; canvas drops
  capture document/session/revisions and are guarded by `dropUtils.test.ts`;
  paste validates its invocation before applying. Background removal and
  segmentation also capture document/node identity before committing. A distinct
  possible focus race remains at `apps/desktop/src/App.tsx:236`: concurrent
  Home opens can finish out of order because `handleOpenFile` has no latest
  intent check after its awaits. This is a focus/activation concern; each open
  receives its own tab, so wrong-document save or data loss is not established.
  It has not been reproduced in Varve. PdfCraft #813's password-recovery flow
  has no analogous Varve workflow identified. Treat the class as screened, not
  as a confirmed Varve defect.

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
  A current DesignCraft report describes the opposite tradeoff: a 4000 × 3000
  JPEG placed in a 100 × 75 mm frame remains at 1019 ppi and about 9.5 MB even
  with `compressImages: true`, with no target-PPI option
  ([#1268](https://github.com/storytold/designcraft/issues/1268)). These are
  distinct user needs: retain source detail for quality, while optionally
  reducing excess resolution and file size when the delivery target calls for
  it. A default downsample would reproduce Penpot's loss-of-detail complaint;
  silently retaining large originals while labeling export compression would
  reproduce DesignCraft's expectation mismatch.
  Illustrator users report a soft white box where a transparent PNG sits in a
  PDF/X-1a export ([Adobe Community](https://community.adobe.com/questions-652/soft-white-box-when-exporting-artwork-with-transparent-image-808510)).
  These reports do not prove a Varve defect; they reinforce that users need
  either faithful output or a precise stop before a misleading file is saved.
  Adobe's guidance describes flattening as necessary when a target cannot
  carry transparency and distinguishes PDF/X-4's live transparency path
  ([Illustrator transparency guidance](https://helpx.adobe.com/illustrator/using/printing-saving-transparent-artwork.html)).
- **Varve surface** — `crates/varve-print` (PDF/X, CMYK, ICC), code export,
  image export.
- **Image-resolution evidence** — `packages/editor/src/export/printImageManifest.ts`
  reads each decoded source at its natural pixel dimensions and sends those
  dimensions with RGBA pixels; it does not downsample. The native PDF renderer
  writes the manifest width/height into the image XObject; its focused
  `render_fills_image_with_manifest_embeds_source_dimensions` test asserts
  this for a 32 × 32 fixture. The manifest has a 192 MiB aggregate decoded-RGBA
  cap, which protects memory but does not control effective PPI or optimize
  output file size. This is source/test evidence for the transfer contract,
  not a high-resolution end-to-end fidelity or file-size benchmark.
- **Implemented slice** — PDF blend modes now use PDF ExtGState entries for
  representable node/fill modes. PDF/X-1a refuses unsupported blend modes in
  both preflight and the Rust/native export boundary, and refuses explicit
  object/fill opacity and alpha-bearing image/pattern sources instead of
  writing live transparency or silently omitting a tile. PDF/X-4 carries
  supported blend modes and live transparency. User guidance and the public
  export feature page describe the same boundary.
- **Remaining acceptance** — render representative generated PDFs through an
  independent viewer and compare measured pixels/structure; formally validate
  PDF/X with a standards checker when available; run a realistic high-resolution
  image export and inspect effective PPI, image samples, and output size; verify
  all transparency/color cases. A future size-optimization control should be
  explicit, opt-in, and validated against a preserve-originals path. No PDF/X
  certification claim is made from the present tests.

### 4.12 Unbounded per-operation work — **partially implemented; export guard verified**

- **External evidence** — [#307](https://github.com/storytold/pdfcraft/issues/307)
  reports a large-PDF open reaching about 16 GB of RAM; that opening workload
  differs from Varve's export path but is relevant class-level memory evidence.
  [#971](https://github.com/storytold/pdfcraft/issues/971)
  reports a limited `text_find` request extracting every page first;
  [#2616](https://github.com/storytold/pdfcraft/issues/2616) reports laggy PDF
  text editing; and [#1796](https://github.com/storytold/pdfcraft/issues/1796)
  reports a decoder ignoring the caller's output budget. These are failure
  patterns, not evidence of the same defect in Varve. The audit ledger marks
  #971 as not a Varve defect and now records #307 as applicable class-level
  performance evidence, not as a report of the same export defect; the
  previously cited #6110 could not be verified as a PdfCraft issue.
- **Transferable rule** — a document-scale operation is bounded by an explicit
  memory/time budget and can return a partial result; a decoder enforces its
  own budget rather than trusting the caller.
- **Varve state** — several bounded-work mechanisms exist:
  `MAX_STROKE_OPACITY_BYTES`, decode dimension guards, and thumbnail scheduler
  concurrency 1. A review of `printImageManifest.ts` found its 192 MiB decoded
  RGBA cap ran only after all image readbacks and base64 strings had been
  allocated. That made the error too late to protect export-time memory for
  oversized or cumulative image sets. The manifest now checks each image's
  expected RGBA byte count before its export canvas/readback allocation, checks
  the cumulative limit before preparing the next image, and rechecks the
  aggregate before base64 conversion. The raster-fallback bitmap path applies
  the same pre-allocation guard and closes the bitmap on refusal. Regression
  tests cover single-image, aggregate, and raster-fallback refusal paths.
- **Remaining acceptance** — measure peak memory for realistic mixed-image
  documents on the 4 GB target and verify the error/recovery path through the
  desktop export UI. Existing decoder, stroke-opacity, and thumbnail bounds
  have not been re-audited end-to-end in this batch.

### 4.13 Dirty state and history truthfulness — **screened**

- **External evidence** — #1312 (undo to the opened revision still reports
  unsaved work), #2663 (autosave only runs when the window repaints), #1803 (a
  failed autosave suppresses retries), #6865/#6732 (non-mutating actions mark
  the document modified).
- **Varve surface** — `persistence/documentRevision.ts`, history sessions,
  `autoSaveService`. Screened: the transactional model already distinguishes
  preview from edit, so the specific failures may not be expressible; that has
  to be shown, not assumed.

### 4.14 Cutoff B triage findings — **body and current-comment review complete; recursive evidence remains**

All 158 new issue bodies and their current comment threads have been read and
classified in `issue-ledger-follow-on-b.jsonl`. The ledger separates 40
screened-for-Varve candidates, 116 out-of-scope reports, and 2 capabilities
already handled in Varve. A screened classification is only a follow-up
queue: it does not claim a Varve defect. Linked issues/PRs, source fixtures,
attachments and external app builds remain unreviewed where the later sections
say so.

The incremental counts at the end of §§4.15–4.19 are preserved as batch-time
progress records; the final reconciled cutoff-B totals appear after §4.22.

The requested transparent-canvas E2E probe was invalid for issue #2970: it
selected a shape whose selection overlay affected sampled pixels, and after
deselection it measured Varve’s intentionally opaque editor pasteboard rather
than a transparent render surface. The probe was removed and no production
change was made. Therefore the transparent-surface canvas differential remains
open; the other agent’s in-flight test in the shared main checkout is preserved
and is not part of this branch’s evidence.

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
the PDF/X-4 blend/transparency behavior. Both changed website pages were
captured and visually inspected at desktop and 390×844 mobile widths. Their
desktop and mobile evidence is saved in `evidence/website-export-*.png`; local
navigation destinations returned HTTP 200. `/try/` is built as part of the
combined deployment artifact rather than the standalone Astro dev server.
Formal PDF/X standards validation remains pending.

### 4.15 Cutoff B text and input screen — 15 threads screened; no new Varve defect confirmed

Read-only review covered issue bodies and current issue comments for
[#3248](https://github.com/storytold/pdfcraft/issues/3248),
[#3234](https://github.com/storytold/pdfcraft/issues/3234),
[#3231](https://github.com/storytold/pdfcraft/issues/3231),
[#3128](https://github.com/storytold/pdfcraft/issues/3128),
[#3093](https://github.com/storytold/pdfcraft/issues/3093),
[#3224](https://github.com/storytold/pdfcraft/issues/3224),
[#3223](https://github.com/storytold/pdfcraft/issues/3223),
[#3202](https://github.com/storytold/pdfcraft/issues/3202),
[#3196](https://github.com/storytold/pdfcraft/issues/3196),
[#3185](https://github.com/storytold/pdfcraft/issues/3185),
[#3183](https://github.com/storytold/pdfcraft/issues/3183),
[#3167](https://github.com/storytold/pdfcraft/issues/3167),
[#3154](https://github.com/storytold/pdfcraft/issues/3154),
[#3127](https://github.com/storytold/pdfcraft/issues/3127), and
[#2982](https://github.com/storytold/pdfcraft/issues/2982). The issues include
reporter-provided screenshots and sample PDF links; attachment bytes were not
retrieved. Shallow bot comments and linked upstream changes were not treated as
proof of Varve behavior.

- **Navigation:** #3248 and #3234 are platform reports without captured input
  traces; #3234's author explicitly lacks a Windows precision-touchpad device.
  Varve's wheelClassifier.ts treats line/page deltas as mouse input and may
  apply app inertia, while pixel-mode trackpad deltas bypass it. The Windows
  deltaMode path needs hardware verification before changing classification.
  #3231's “page follows pointer” direction is already the documented and
  E2E-tested middle-drag convention; its separate speed complaint is not
  measured. #3128 requests optional speed-dependent gain, a product preference
  not a defect. #3093 requests middle-click auto-scroll but has no interaction
  requirements; no subsystem was added based on this underspecified request.
- **Text and fonts:** #3223, #3185 and #2982 concern rewriting text that uses
  embedded/subsetted PDF fonts, which Varve does not support. #3224 concerns
  PDF comment hover/bookmark surfaces not present in Varve. #3202, #3196,
  #3167 and #3154 reach Varve's Unicode text, font packaging/selection and PDF
  export boundaries. #3202's shared Unicode export route now has a focused
  reproduction and fix in §4.25; #3196, #3167 and #3154 remain screened for
  focused coverage. #3183 is ambiguous about whether the affected field is
  search or document text. #3127 lacks sample text, font and expected Korean
  line break; existing Unicode layout tests are adjacent evidence, not
  reproduction.
- **Existing evidence and limits:** packages/engine/src/text/paragraphs.ts
  itemizes bidirectional and script runs; paragraphLayout.test.ts covers
  mixed Arabic and RTL layout, and text fixtures include multiple scripts.
  TextEditOverlay.tsx uses dir="auto". The font resolver can diagnose known
  missing glyphs. The generic CSS fallback chain and system-only Noto Sans CJK
  registration do not prove those faces are present in a clean packaged
  install. No fresh tests, native IME, clean-machine packaging, or visual text
  export comparison was performed for this screen. The follow-on ledger records
  15 bodies/threads screened, with the other 143 new issues still queued.

### 4.16 Cutoff B PDF output and document reports — 13 threads screened; boundary limits most

Read-only review covered current issue bodies and comments for
[#3229](https://github.com/storytold/pdfcraft/issues/3229),
[#3176](https://github.com/storytold/pdfcraft/issues/3176),
[#3159](https://github.com/storytold/pdfcraft/issues/3159),
[#3157](https://github.com/storytold/pdfcraft/issues/3157),
[#3149](https://github.com/storytold/pdfcraft/issues/3149),
[#3148](https://github.com/storytold/pdfcraft/issues/3148),
[#3147](https://github.com/storytold/pdfcraft/issues/3147),
[#3123](https://github.com/storytold/pdfcraft/issues/3123),
[#3119](https://github.com/storytold/pdfcraft/issues/3119),
[#3063](https://github.com/storytold/pdfcraft/issues/3063),
[#2986](https://github.com/storytold/pdfcraft/issues/2986),
[#2992](https://github.com/storytold/pdfcraft/issues/2992), and
[#2984](https://github.com/storytold/pdfcraft/issues/2984). Some reports include
synthetic PDF scripts, screenshot/video references, or third-party PDF fixture
links. Those attachments were not downloaded or executed; links in comments
were not treated as verified fixes.

The product boundary is important here: packages/import/src/pdf.ts extracts
text and simple rectangles with explicit fidelity warnings. It does not render
arbitrary PDF pages or interpret PDF optional-content groups, annotations,
redactions, or text clipping. Varve creates its own PDFs from its scene through
crates/varve-print; its image export renders authored scene content. Therefore
most imported-PDF reader/editor failures below are out of scope for Varve.

- **Adjacent authored-output checks remain open:** #3229 reports incorrect
  compositing when one PDF path operator fills and strokes the same path; #3176
  reports alpha loss in PDF shading patterns. The Varve writer emits fills and
  strokes through separate passes. This is not the same parser path, but the
  correct transfer question is whether a Varve-authored semi-transparent
  fill+stroke and pattern alpha export match the live canvas. Compare actual
  canvas and independently rendered PDF pixels before calling this a defect.
- **Export progress/grayscale:** #3159 combines toast layout, a premature
  100% indicator and grayscale settings. Varve already models preflight,
  rendering, encoding, writing, completion, and failure in exportService.ts,
  and completion follows the write. No defect is known from source inspection.
  No grayscale PDF export option was identified, so no claim is made that the
  PdfCraft option exists in Varve.
- **Crop, work bounds and false success:** #3148 uses PDF user-space crop
  coordinates, unlike Varve's source-pixel image crop. #3147 concerns PDF
  image arranger endpoints absent in Varve. #3119 concerns bounded recursive
  PDF interpretation; Varve's render bitmap/residency budgets are different
  memory controls. Its transferable rule is that a bounded operation must not
  report complete when work was truncated; no matching Varve no-op or silent
  truncation was found in this screen.
- **Explicit exclusions:** #3157 and #3063 concern arbitrary PDF page rendering
  (the latter is unconfirmed even in PdfCraft); #3149 concerns egui texture
  limits; #3123 requires editing/redacting PDF clipping modes; #2986 requires
  PDF OCG/OCMD interpretation; #2992 requests PDF-to-DOCX behavior; and #2984
  compares PDF-page rasterizers. These do not map to Varve's authored-scene
  renderer or PDF output path. #3157's maintainer could not reproduce blank
  pages on a 1,424-page document and requested a fixture.
- No Varve reproduction, fresh test, or visual comparison was run for these
  candidates. The ledger records 28 new issue bodies and threads screened; 130
  post-A issues remain queued.

### 4.17 Cutoff B printer and page workflow screen — 13 threads screened; OS print path is not a current UI workflow

Read-only review covered current bodies and comments for
[#3208](https://github.com/storytold/pdfcraft/issues/3208),
[#3203](https://github.com/storytold/pdfcraft/issues/3203),
[#3188](https://github.com/storytold/pdfcraft/issues/3188),
[#3153](https://github.com/storytold/pdfcraft/issues/3153),
[#3152](https://github.com/storytold/pdfcraft/issues/3152),
[#3151](https://github.com/storytold/pdfcraft/issues/3151),
[#3047](https://github.com/storytold/pdfcraft/issues/3047),
[#3032](https://github.com/storytold/pdfcraft/issues/3032),
[#3046](https://github.com/storytold/pdfcraft/issues/3046),
[#3096](https://github.com/storytold/pdfcraft/issues/3096),
[#3094](https://github.com/storytold/pdfcraft/issues/3094),
[#2991](https://github.com/storytold/pdfcraft/issues/2991), and
[#2983](https://github.com/storytold/pdfcraft/issues/2983). Screenshot and driver
or PDF attachments were not opened; fixes mentioned by commenters were not
independently validated.

- **Potential OS print capability gap:** PdfCraft users report ignored duplex,
  missing nonstandard paper sizes, missing printers, and driver-specific failures.
  Varve's Windows native adapter hardcodes A4/Letter and duplex false and
  ignores duplex, color and page_size in print_pdf. Linux passes requested
  lp settings but discards printer option discovery. However repository search
  found no frontend consumer of listPrinters or printPdf; these adapters are
  not evidence of a reachable user workflow. The PDF/X press panel is a
  separate artifact-export workflow, not OS printing. No Windows or Linux
  physical printer reproduction was run. These reports remain screened for a
  product decision and reachability check, not confirmed Varve defects.
- **PDF reader/editor exclusions:** #3203 batch-printing PDF pages, #3188
  replacing PDF pages, #3153 Organize Pages export, #3152 PDF page cropping,
  and #3046 printing hidden PDF OCGs require a multipage PDF editor/reader,
  which Varve does not provide. #2983's reported crash is in a different
  PdfCraft Windows PDF/XPS rendering path.
- **Other candidates:** #3151 sequential page-export naming lacks steps or
  expected output and is only adjacent to Varve batch naming. #3047/#3032 are
  tied in source comments to printer driver failures on PdfCraft's distinct
  Direct2D/XPS path. #2991 asks for persistent printer preferences, but no
  Varve user-facing OS print settings or preference flow was located.
- No Varve issue was reproduced in this screen. The follow-on ledger now records
  41 new issue bodies and current comment threads screened; 117 remain queued.

### 4.18 Cutoff B editing, interaction, and platform screen — 13 threads screened; one request already handled

Read-only review covered current issue bodies/comments for
[#3249](https://github.com/storytold/pdfcraft/issues/3249),
[#3236](https://github.com/storytold/pdfcraft/issues/3236),
[#3190](https://github.com/storytold/pdfcraft/issues/3190),
[#3144](https://github.com/storytold/pdfcraft/issues/3144),
[#3139](https://github.com/storytold/pdfcraft/issues/3139),
[#3001](https://github.com/storytold/pdfcraft/issues/3001),
[#3002](https://github.com/storytold/pdfcraft/issues/3002),
[#2995](https://github.com/storytold/pdfcraft/issues/2995),
[#2997](https://github.com/storytold/pdfcraft/issues/2997),
[#3082](https://github.com/storytold/pdfcraft/issues/3082),
[#3051](https://github.com/storytold/pdfcraft/issues/3051),
[#3058](https://github.com/storytold/pdfcraft/issues/3058), and
[#3073](https://github.com/storytold/pdfcraft/issues/3073). Reporter screenshots
and video were not opened; linked PRs and commits remain unverified.

- **Already handled:** #3249 asks to replace only the current Find match, show
  its position and advance predictably. Varve's FindReplaceBar already has
  separate Replace and Replace & Find Next actions and a match counter.
  Unit tests cover advancing after replacement; the E2E spec covers counters,
  Replace All and undo, but does not directly click Replace & Find Next.
- **Visual/interaction candidates:** #3236 reports text overlapping PdfCraft's
  toolbar at zoom; #3001 reports cursor state leaking from PDF content through
  the mode bar; #3082 reports Hebrew filename tofu on macOS. These are good
  targeted visual checks, but the PDFs, screenshots and exact linked fixes
  were not reviewed, and no Varve defect was reproduced. #3144 says clipboard
  behavior is imperfect without a failing route or payload; Varve already has
  clipboard unit and browser E2E coverage, but that does not resolve an
  unspecified case.
- **Different or absent workflows:** #3190 and #3139 concern editing PDF
  images/context menus and watermarks. #3002 requests shortcuts for PDF
  annotation tools, while #2995 requests a particular fullscreen control
  placement. #2997 requests modifier-drag duplication in a PDF page organizer;
  Varve has page duplicate/reorder controls but no PDF Organize Pages surface.
  These are feature requests or product-specific paths, not defects in Varve's
  existing interactions.
- **Distinct causes:** #3051's “text changes disappear” title resembles the
  pending-draft save case, but its maintainer suspects edited text is covered
  by later page background content. Varve's committed pending-draft drain
  covers a different window and its PDF import does not rewrite page content.
  #3058 reports an eframe/AppKit KVO teardown crash that its thread says was
  fixed upstream; Varve's Tauri lifecycle is a different stack. #3073 gives
  no workload or metrics for lag on a 2010 MacBook with OCLP and legacy NVIDIA,
  so it does not show a Varve regression.
- The follow-on ledger records 54 new issue bodies and current comments
  screened: 22 screened-for-Varve, 19 out-of-scope, and one already handled
  across this and earlier screens. The other 104 issues remain queued.

### 4.19 Cutoff B tagged PDF, redaction, parser and annotation screen — 15 threads screened; outside Varve's PDF contract

Read-only review covered the bodies and current comments for
[#3221](https://github.com/storytold/pdfcraft/issues/3221),
[#3219](https://github.com/storytold/pdfcraft/issues/3219),
[#3218](https://github.com/storytold/pdfcraft/issues/3218),
[#3217](https://github.com/storytold/pdfcraft/issues/3217),
[#3216](https://github.com/storytold/pdfcraft/issues/3216),
[#3215](https://github.com/storytold/pdfcraft/issues/3215),
[#3214](https://github.com/storytold/pdfcraft/issues/3214),
[#3213](https://github.com/storytold/pdfcraft/issues/3213),
[#3212](https://github.com/storytold/pdfcraft/issues/3212),
[#3211](https://github.com/storytold/pdfcraft/issues/3211),
[#3205](https://github.com/storytold/pdfcraft/issues/3205),
[#3179](https://github.com/storytold/pdfcraft/issues/3179),
[#3178](https://github.com/storytold/pdfcraft/issues/3178),
[#3177](https://github.com/storytold/pdfcraft/issues/3177), and
[#3175](https://github.com/storytold/pdfcraft/issues/3175). Several bodies
include carefully constructed synthetic PDFs, corpus samples or concrete
parser/operator traces. Those files were not downloaded or executed. Comments
that say a fix is being worked on or cite a PR are not treated as a shipped fix;
the identified PRs were checked only for their open/merged state.

Varve's PDF import at packages/import/src/pdf.ts is explicitly partial: it
extracts text and simple rectangles and does not preserve PDF page geometry,
vectors or embedded images. Format capabilities likewise mark the importer
partial. Varve does not have a PDF page renderer, content-stream editor,
ToUnicode parser, tagged-PDF structure tree, optional-content-group reader,
annotation flattener, PDF redaction engine, or PDF-to-Office exporter. The
related PdfCraft issues therefore remain explicitly outside Varve's current
product boundary, even where the external reports are reproducible and severe.

The reviewed families cover tagged accessibility MCR stream identity (#3221),
ActualText/MCID preservation (#3219), form-aware redaction audits (#3218),
content-stream rewriting and comment boundaries (#3217), vertical Identity-V
edit geometry (#3216), per-run text render state (#3215), hidden-layer PDF
selection/flattening/output (#3214, #3213, #3212, #3211), PDF phone-pattern
redaction (#3205), JPX palette images (#3179), Type3 glyph soft-mask rendering
(#3178), malformed ToUnicode CMaps (#3177), and missing annotation appearance
flattening (#3175). These do not establish failures in Varve-authored scenes.
If Varve later adds any such feature, the documented source fixtures and
operation-specific controls are valuable acceptance candidates; until then,
these remain out of scope, not deferred Varve defects.

The follow-on ledger now records 69 new issue bodies and current comments
screened: 29 screened-for-Varve, 39 out-of-scope, and one already handled.
The other 89 new issues remain queued.

### 4.20 Cutoff B remaining text, layout, and platform reports — 16 issues screened

The remaining queued reports in this group are [#2981](https://github.com/storytold/pdfcraft/issues/2981), [#2985](https://github.com/storytold/pdfcraft/issues/2985), [#2990](https://github.com/storytold/pdfcraft/issues/2990), [#2999](https://github.com/storytold/pdfcraft/issues/2999), [#3005](https://github.com/storytold/pdfcraft/issues/3005), [#3029](https://github.com/storytold/pdfcraft/issues/3029), [#3031](https://github.com/storytold/pdfcraft/issues/3031), [#3037](https://github.com/storytold/pdfcraft/issues/3037), [#3048](https://github.com/storytold/pdfcraft/issues/3048), [#3052](https://github.com/storytold/pdfcraft/issues/3052), [#3057](https://github.com/storytold/pdfcraft/issues/3057), [#3060](https://github.com/storytold/pdfcraft/issues/3060), [#3061](https://github.com/storytold/pdfcraft/issues/3061), [#3072](https://github.com/storytold/pdfcraft/issues/3072), [#3074](https://github.com/storytold/pdfcraft/issues/3074), and [#3079](https://github.com/storytold/pdfcraft/issues/3079). Each issue body and all comments returned by GitHub at review time were read. Attachments and linked issues/PRs were not independently inspected except where noted below.

- **Possible shared text fidelity question:** #2981 reports Thai characters becoming question marks after PdfCraft Fill & Sign input ends; #3133 is an exact duplicate of #2981, as its bot comment states. The linked #2354 describes a Windows 11/PdfCraft 0.7.1 comparison: Thai works in the main Add Text path with craft-fonts but not in comment text or Fill & Sign. #2428 is a distinct report where Thai appears as boxes only while editing existing PDF text, then renders correctly afterward. #506 describes the broader WinAnsi FreeText limitation. PR #1775 remains open/unmerged and excludes Thai; #2811 also remains open/unmerged for existing text. Merged #1112 makes undrawable text fail visibly instead of emitting `?`, and #403 addresses Arabic, neither is a Thai fix. Varve does not edit PDF form text, but Thai edit/save/export is a reasonable focused check of its own Unicode path. Its existing `tests/e2e/canvas/text-corpus.spec.ts` and corpus manifest include Thai paint/save/reopen coverage; the focused lease-wrapped run waited 600 seconds for another live shared test lease and expired before Playwright started. The result is pending, not a pass or failure. No Varve reproduction is claimed.
- **Font and localization reports:** #3150 is screenshot-only with no steps/version. Its linked #396 CJK UI/tofu report was closed in favor of #826, which records ongoing CJK fallback work and remaining bundled/web/Linux gaps; #142/#614 address bookmark mojibake rather than tab labels, while #689 reports CJK glyphs missing in a Mac Flatpak. Varve's tab strip uses ellipsized filenames and system font fallback, but no matching failure has been reproduced in a packaged target. #3181's attached 2,685-line Finnish TSV is a localization proposal, not a Varve defect; Varve Settings currently makes no localization claim. The TSV and linked proposals were not independently validated.
- **Adjacent layout and platform candidates:** #2990 reports a crowded page-number control; a commenter could not reproduce the original and only noticed icon overlap during resize. #2985 requests ARM support, which Varve already builds for Windows ARM64 and Linux aarch64; the platform support matrix retains qualification caveats. Neither establishes a new Varve failure. These reports and the later #3097, #3150, #3151, #3166, #3181, #3197/#3228, #3230 and #3247 remain individually classified in the ledger as responsive UI, shell, font UI, batch naming, musl packaging, localization, updater channels, startup visuals and keyboard-navigation candidates.
- **PDF editor boundary:** #3005 and #3061 are PDF content selection/clipping reports; #3029 is a PDF graphics-state leak; #3072 concerns XFA; and #3079 concerns selecting PDF vector paths. Varve's partial PDF importer does not edit PDF object streams, render arbitrary pages, execute XFA or import PDF vector paths. #3031 and #3057 concern certificate validation or online signing; #3048 asks for a OneNote clone. These have no corresponding current Varve workflow. #3037 is a PdfCraft-specific panel issue that its maintainer said would be fixed in a panel redesign; #3052 is an arbitrary PDF reader performance report without its sample file; #2999/#3074 request translation, not a reported Varve failure.
- No source attachment, linked fix, or source-product build was verified for this group. The website was not changed: none of these reports establishes a Varve capability or claim that needs correction.

### 4.21 Cutoff B parser, export, printing, and application requests — 51 issue threads screened

The group includes [#3080](https://github.com/storytold/pdfcraft/issues/3080), [#3081](https://github.com/storytold/pdfcraft/issues/3081), [#3084](https://github.com/storytold/pdfcraft/issues/3084), [#3085](https://github.com/storytold/pdfcraft/issues/3085), [#3086](https://github.com/storytold/pdfcraft/issues/3086), [#3087](https://github.com/storytold/pdfcraft/issues/3087), [#3088](https://github.com/storytold/pdfcraft/issues/3088), [#3090](https://github.com/storytold/pdfcraft/issues/3090), [#3095](https://github.com/storytold/pdfcraft/issues/3095), [#3097](https://github.com/storytold/pdfcraft/issues/3097), [#3098](https://github.com/storytold/pdfcraft/issues/3098), [#3099](https://github.com/storytold/pdfcraft/issues/3099), [#3103](https://github.com/storytold/pdfcraft/issues/3103), [#3104](https://github.com/storytold/pdfcraft/issues/3104), [#3107](https://github.com/storytold/pdfcraft/issues/3107), [#3108](https://github.com/storytold/pdfcraft/issues/3108), [#3109](https://github.com/storytold/pdfcraft/issues/3109), [#3110](https://github.com/storytold/pdfcraft/issues/3110), [#3111](https://github.com/storytold/pdfcraft/issues/3111), [#3112](https://github.com/storytold/pdfcraft/issues/3112), [#3113](https://github.com/storytold/pdfcraft/issues/3113), [#3115](https://github.com/storytold/pdfcraft/issues/3115), [#3117](https://github.com/storytold/pdfcraft/issues/3117), [#3118](https://github.com/storytold/pdfcraft/issues/3118), [#3120](https://github.com/storytold/pdfcraft/issues/3120), [#3121](https://github.com/storytold/pdfcraft/issues/3121), [#3122](https://github.com/storytold/pdfcraft/issues/3122), [#3124](https://github.com/storytold/pdfcraft/issues/3124), [#3130](https://github.com/storytold/pdfcraft/issues/3130), [#3131](https://github.com/storytold/pdfcraft/issues/3131), [#3132](https://github.com/storytold/pdfcraft/issues/3132), [#3133](https://github.com/storytold/pdfcraft/issues/3133), [#3135](https://github.com/storytold/pdfcraft/issues/3135), [#3136](https://github.com/storytold/pdfcraft/issues/3136), [#3137](https://github.com/storytold/pdfcraft/issues/3137), [#3138](https://github.com/storytold/pdfcraft/issues/3138), [#3140](https://github.com/storytold/pdfcraft/issues/3140), [#3141](https://github.com/storytold/pdfcraft/issues/3141), [#3142](https://github.com/storytold/pdfcraft/issues/3142), [#3143](https://github.com/storytold/pdfcraft/issues/3143), [#3145](https://github.com/storytold/pdfcraft/issues/3145), [#3146](https://github.com/storytold/pdfcraft/issues/3146), [#3150](https://github.com/storytold/pdfcraft/issues/3150), [#3151](https://github.com/storytold/pdfcraft/issues/3151), [#3156](https://github.com/storytold/pdfcraft/issues/3156), [#3158](https://github.com/storytold/pdfcraft/issues/3158), [#3160](https://github.com/storytold/pdfcraft/issues/3160), [#3162](https://github.com/storytold/pdfcraft/issues/3162), [#3163](https://github.com/storytold/pdfcraft/issues/3163), [#3164](https://github.com/storytold/pdfcraft/issues/3164), [#3166](https://github.com/storytold/pdfcraft/issues/3166), and [#3169](https://github.com/storytold/pdfcraft/issues/3169). Current comments were read for all. Strong synthetic PDF cases and comparator measurements in the issue bodies/comments were reviewed as claims; their fixture files, attachments, linked PRs and external oracles were not independently run. Issue #3151 was also discussed in §4.17; this pass reread its thread and reconciled its ledger record.

- **High-confidence source-product failures:** #3080/#3081, #3084, #3107–#3111, #3113, #3115, #3117/#3118, #3120/#3122, and #3145/#3146 contain concrete content-stream, state, extraction, redaction, or ordering reproducers. #3086 has multiple PDF text-extraction corpus reports, including distinct glyph-spacing cases. These are serious PdfCraft reader/editor/audit issues, but Varve does not parse or rewrite arbitrary PDF content streams, perform PDF redaction, or export PDF text to Office. They do not establish defects in Varve's authored scene path.
- **Other reader and platform reports:** #3087 describes lost 3D annotations during PDF flattening; #3099 is PDF bookmark editing; #3103 is a PdfCraft demo generation race; #3132 is a Windows physical-printer/font issue on PdfCraft's print path; #3156 is grayscale print preview; and #3169 concerns PDF glyph-name text extraction. They lack a corresponding Varve workflow. #3097's macOS menu/clipping report has too little evidence for a Varve reproduction and remains a shell-visual candidate.
- **Feature/process requests:** the remaining items ask for XFA, OCR, signatures, PDF version controls, themes, AI, office conversion, header/footer/watermark tooling, context menus, custom printers, or contributor merge coordination. The ledger records the per-issue boundary and whether a nearby Varve surface still merits product follow-up. No marketing claim or website guidance was changed because no requested behavior was implemented or newly promised.

### 4.22 Cutoff B long-document, update, and platform reports — 22 issue threads screened

Current bodies and comments were read for [#3170](https://github.com/storytold/pdfcraft/issues/3170), [#3171](https://github.com/storytold/pdfcraft/issues/3171), [#3172](https://github.com/storytold/pdfcraft/issues/3172), [#3173](https://github.com/storytold/pdfcraft/issues/3173), [#3174](https://github.com/storytold/pdfcraft/issues/3174), [#3180](https://github.com/storytold/pdfcraft/issues/3180), [#3181](https://github.com/storytold/pdfcraft/issues/3181), [#3189](https://github.com/storytold/pdfcraft/issues/3189), [#3193](https://github.com/storytold/pdfcraft/issues/3193), [#3194](https://github.com/storytold/pdfcraft/issues/3194), [#3197](https://github.com/storytold/pdfcraft/issues/3197), [#3199](https://github.com/storytold/pdfcraft/issues/3199), [#3201](https://github.com/storytold/pdfcraft/issues/3201), [#3206](https://github.com/storytold/pdfcraft/issues/3206), [#3207](https://github.com/storytold/pdfcraft/issues/3207), [#3220](https://github.com/storytold/pdfcraft/issues/3220), [#3225](https://github.com/storytold/pdfcraft/issues/3225), [#3228](https://github.com/storytold/pdfcraft/issues/3228), [#3230](https://github.com/storytold/pdfcraft/issues/3230), [#3238](https://github.com/storytold/pdfcraft/issues/3238), [#3247](https://github.com/storytold/pdfcraft/issues/3247), and [#3250](https://github.com/storytold/pdfcraft/issues/3250). Linked documents, screenshots, PRs and sample PDFs were not downloaded. Fixes cited in comments remain thread claims unless the Varve implementation was separately inspected.

- **PDF extraction/reader limits:** #3170–#3174 report long-document truncation, Type 3 ordering, overlapping glyphs, clipping, and positioned subscript extraction. #3180 concerns XFA page content changed by metadata save; #3193/#3220 concern PDF bookmarks/comments; #3189 is PDF text highlighting; #3250 is raster quality in a PDF reader. Varve's PDF import is explicitly partial and text-focused, so these cases do not demonstrate a Varve failure.
- **Platform/update/product requests:** #3197 and duplicate #3228 concern update channels and portable updater behavior. Varve has signed updater plumbing with manual, notify and automatic-download consent and release channels bound to the installed build; no Varve update failure or user-selectable channel/changelog gap was established. #2985's ARM request is already covered by Varve release targets (see §4.20). #3166's musl request is not a supported Varve release target. #3230's black startup frame was not reproduced by the PdfCraft maintainer and uses a different desktop stack than Varve. #3181 asks for Finnish UI localization; #3201/#3206 ask for PdfCraft Docker images; #3247 asks for optional `hjkl` scrolling. These are product decisions, not defects established by these issues.
- **Deeper update evidence:** PdfCraft #28's update PR #32 adds a user-initiated release-page check, while #1682 points to #99, where users describe manually finding, downloading, replacing and relaunching builds. #2814 asks for a more visible launcher update path; the related Craft Launcher #400 comments describe an AppImage being offered to Flatpak users, illustrating a packaging mismatch. PhotoCraft #2375 users request notifications but object to forced updates and raise package-manager conflicts. Varve already goes beyond a release-page link for supported self-managed desktop builds: settings expose manual, notify and automatic-download consent; the app verifies signed bytes before install; update channel is reported and bound to the installed build. The UI does not expose an arbitrary channel switch. This supports keeping consent and package authority explicit; the PdfCraft/PhotoCraft complaints do not justify an update-policy change in Varve.
- **Deeper startup and keyboard evidence:** PdfCraft #3230's maintainer could not reproduce the full-window black frame and measured a separate dark pre-compositor frame clearing in roughly 70 ms; linked #76/#378/#413 describe distinct blurry UI, black-window, or GPU-reset reports. These do not transfer to Varve's Tauri/WebView startup. PdfCraft #3247 links page-navigation requests #224/#214 and LightCraft #1171; merged LightCraft PR #1264 adds arrow navigation while leaving `h/j/k/l` unbound because of shortcut conflicts. Varve likewise restricts arrow panning to Hand/Space-Hand so the keys remain available to text and controls. No new Vim-key mapping is warranted by this single request.
- No Varve-specific visual reproduction was justified by the source evidence in this group. The #3166 musl report did reveal ambiguous marketing copy: the download page called the AppImage “universal” and said it ran on any distro even though published builds require glibc 2.35+. The wording now limits that claim to supported glibc-based systems and explicitly names musl/Alpine as unsupported; `docs/release/platform-support-matrix.md` records the same boundary. This is a support-clarity correction, not a new musl support promise. No other site claims changed for this group.

The website was visually checked at desktop and 390px mobile widths. The mobile pass exposed clipped install commands and long distro labels in the responsive package table; the small-screen styles now allow both to wrap. Captures are in `evidence/download-linux-support-desktop.png` and `evidence/download-linux-support-mobile.png`.

The follow-on ledger now has body and current-comment coverage for all 158 cutoff-B issues: 40 screened-for-Varve, 116 out-of-scope, and 2 already handled. “Reviewed” here means issue body and current comments read, not full recursive-source exhaustion. Attachments, sample files, linked implementation PRs and relevant external discussions still require follow-up where the ledger or findings says they matter. No new Varve defect is confirmed by this cutoff-B screen.


### 4.23 Follow-up source checks for image and page workflows

A deeper read of the source threads and linked PRs corrected three prior
ledger rationales and narrowed one disposition:

- [#434](https://github.com/storytold/pdfcraft/issues/434) reports image
  stamps rotating on rotated PDF pages. Merged PR
  [#473](https://github.com/storytold/pdfcraft/pull/473) fixes natural-size
  point placement at 90/180/270 degrees, but explicitly excludes image
  signatures, explicit rectangles, PDF-page stamps, image-file orientation
  metadata, and the reporter's original PDF. Varve has no matching PDF
  annotation/stamp workflow, so this is not a Varve defect; the previous
  signature-validation rationale was wrong.
- [#2944](https://github.com/storytold/pdfcraft/issues/2944) has since closed
  with merged [PR #2951](https://github.com/storytold/pdfcraft/pull/2951),
  which corrects EXIF orientation in PdfCraft's image-to-PDF create APIs. The
  cutoff ledger's open state is historical. Varve's image-ingestion path
  adjusts displayed dimensions and covers EXIF orientation 6; this is
  already handled for the analogous import path, unlike PDF page construction.
- [#787](https://github.com/storytold/pdfcraft/issues/787) is not a blanket
  missing cross-page drag in Varve. `SelectTool` reparents a dropped node to
  the destination page, with a test for a drop on an empty trim. Multi-page
  selection remains restricted by ADR-0195 and Layers-tree cross-page drag is
  documented unsupported. A focused Varve context regression now covers
  same-document rich paste after switching publishing pages: clipboard v5
  carries `sourcePageId`, and paste uses destination placement instead of the
  source page's world anchor. Same-page in-place paste remains covered by the
  existing regression. The direct browser flow and visible destination trim
  still need confirmation; this does not cover layer-tree transfer or
  multi-page selection. The linked PR #1861 is still draft/open and is not
  release evidence.

These findings came from source review only; they do not claim a fresh Varve
reproduction for the unresolved routes.

### 4.24 Follow-up: authored stroke alpha and PDF pattern reports

The later comment on cutoff-B issue [#3229](https://github.com/storytold/pdfcraft/issues/3229)
reports a current PdfCraft reproduction and ongoing work. Its primary defect is
specific to reading one PDF `B`/`b` path operator or text rendering mode 2 as
two compositing operations. Varve does not import arbitrary PDF content
streams, and its authored scene contract paints fills and strokes as separate
canvas paints, so that single-object knockout behavior is not a Varve feature
gap. The issue's alpha example did, however, motivate a separate authored
output check: Varve canvas stroke colors retain their alpha, while the Rust PDF
stroke serializer previously emitted only RGB. A real scene export rendered
through Poppler confirmed a fully opaque blue border before the fix. The
writer now writes the product of node opacity and stroke-color alpha as PDF
graphics-state alpha. After the fix, Poppler samples on the same output were
`(95,31,158)` on the stroke over the red fill and `(64,64,191)` on the outer
stroke over gray; the fill remained `(191,63,63)`. This addresses Varve's
separate color-alpha defect, not PdfCraft's combined-operator bug.
The inspected post-fix captures are [the vector fill/stroke export](evidence/pdf-stroke-alpha-after.png)
and [the raster-pattern export](evidence/pdf-pattern-opacity.png); SHA-256
values are recorded in the audit continuation checkpoint.

Issue [#3176](https://github.com/storytold/pdfcraft/issues/3176) is likewise an
imported-PDF pattern graphics-state timing problem. Its linked #2200 / PR #2132
is a distinct soft-mask/shading fast-path fix; #2975 / PR #2977 concerns
stencil-mask alpha; #2970 concerns page backdrop blend modes. Those branches
were followed and kept separate. Varve's authored raster-pattern export uses
an explicit opacity graphics state and embedded tile alpha. A synthetic
Varve-exported red pattern at 25% opacity rendered over gray through Poppler
to `(159,95,95)`; the saved visual was inspected. Existing `varve-print` tests
also verify the opacity state and tile soft mask. The importer-specific
`/ca`-after-`scn` and `/CA`-after-`SCN` failure is outside Varve's partial PDF
import contract.

Related issue [#1469](https://github.com/storytold/pdfcraft/issues/1469) and
merged PR #1478 concern Type 3 glyphs, where text rendering mode 2 must not
paint glyph procedures twice. The report and patch were inspected; that
Type-3-only behavior does not apply to Varve's authored text-to-PDF path.
Other followed edges are recorded in `link-frontier.jsonl`. The export feature
page was reviewed; it makes no specific stroke-alpha or PDF transparency
promise that this correction would require changing. The new `CHANGELOG.md`
Unreleased entry is also the public `/changelog` source. Website Deploy did
not previously watch that root source file, so its path filter now includes
`CHANGELOG.md`; otherwise the public changelog would remain stale. No
export-feature marketing claim changed. `docs/architecture/fill-system.md`
now records the PDF and PDF/X stroke-alpha contract.

### 4.25 Follow-up: Unicode glyph mapping in subset-font PDF exports

PdfCraft issue [#3202](https://github.com/storytold/pdfcraft/issues/3202)
reports Polish diacritics rejected by its in-place Add Content editor. The
issue's linked [PR #3076](https://github.com/storytold/pdfcraft/pull/3076)
uses a per-text `/Encoding` `/Differences` table for its standard fonts; its
reported tests cover save/reopen and extraction. That editing workflow remains
outside Varve's product boundary. The Polish sample in the issue was still a
useful Unicode PDF-export probe for Varve.

With `subset_fonts=true`, Varve previously wrote each Unicode scalar directly
as a two-byte Identity-H character code and relied on the default
`/CIDToGIDMap /Identity`. That mapping makes the code equal the TrueType glyph
index; Unicode scalar values generally are not glyph indices. Adobe's
[ISO 32000-1 §9.7.4.2](https://developer.adobe.com/document-services/docs/assets/35e4369068f86065372c18787171a17e/PDF_ISO_32000-1.pdf)
defines `/CIDToGIDMap /Identity` as the identity mapping between CIDs and
glyph indices. The old PDF embedded a subset font but emitted no explicit
Unicode-to-glyph map or valid multi-byte `ToUnicode` map.

Reproduction: `cargo run -p varve-print --example unicode_text_probe --
/tmp/varve-unicode-cid-before`, followed by Poppler `pdftoppm` and `pdftotext`.
The rendered page was blank and extraction returned unrelated Latin characters
instead of “Łódź: zażółć gęślą jaźń”. The writer now outlines text outside
WinAnsi even when subset-font export is enabled. The same Poppler render shows
the Polish text correctly; `pdftotext` returns no text because those glyphs
are paths. This is an appearance fix with an explicit searchability limit,
not a fix for editing existing PDF text. Latin WinAnsi text retains the
embedded, searchable-text path.

The before/after captures are [the broken identity-CID output](evidence/pdf-unicode-subset-before.png)
and [the outlined Unicode output](evidence/pdf-unicode-subset-after.png),
rendered at 120 dpi from a 595×120 pt page. Their SHA-256 values are recorded
in the continuation checkpoint. `crates/varve-print/examples/unicode_text_probe.rs`
and the regression test `export_pdf_subsets_extended_latin_as_glyph_paths`
retain the deterministic probe. The export documentation and Unreleased
changelog now state the outline/searchability tradeoff. The marketing feature
page makes no Unicode text-searchability promise, so its copy needs no separate
change.

### 4.26 Recursive checks from Unicode text reports

The “possibly related” and ticket-relay links from #3202 and #2918 were
checked individually; a shared “Unicode” label was not treated as a common
root cause.

- [#2918](https://github.com/storytold/pdfcraft/issues/2918) reports Japanese
  text accepted during typing but refused at commit by PdfCraft's
  Windows-1252 limit. It also includes a separate rotated-text-box screenshot.
  The bot links #1835, #2101 and #1869; these are distinct script, cursor and
  page-rotation cases.
- [#1835](https://github.com/storytold/pdfcraft/issues/1835) reports Greek
  text either refused or saved as question marks, and explicitly expects
  searchable/copyable output. Varve's missing-glyph UI only solves unavailable
  glyph recovery; it does not satisfy that PDF searchability request. The
  current Unicode outline fallback provides appearance but not text
  extraction, so the stronger Greek requirement remains screened, not fixed.
- [#1821](https://github.com/storytold/pdfcraft/issues/1821) reports Chinese
  input rejected for an absent glyph and asks about installed-font discovery
  and localized font names. Those are existing-PDF editing and font-discovery
  needs not established by the Polish Latin sample. No CJK font or Unicode
  text-searchability promise is inferred from this batch.
- [#2101](https://github.com/storytold/pdfcraft/issues/2101) reports reversed
  Hebrew/Arabic rendering and cursor hits at the wrong logical position in
  PdfCraft's PDF text tools. Varve's shared editor uses bidi levels while
  retaining logical source offsets; `paragraphLayout.test.ts` covers pure RTL
  visual order, caret direction, hit testing and mixed-direction boundaries.
  This shared text-layout class is already handled in Varve, while editing
  text inside an existing PDF remains outside the product boundary.
- [#1869](https://github.com/storytold/pdfcraft/issues/1869) concerns comments,
  stamps and text boxes on rotated PDF pages. Its linked
  [PR #1710](https://github.com/storytold/pdfcraft/pull/1710) is merged and
  fixes text boxes on a page that is already rotated; the PR says it does not
  reorient old annotations after a later rotation. Varve's export page rotation
  is not that in-place PDF annotation workflow, so no matching feature or fix
  is claimed.

Issue threads and linked PR metadata were inspected; the attached screenshots
were not downloaded. These recursive edges are recorded in
`link-frontier.jsonl`. The exact PDF sample proving the Varve CID defect remains
the independent Polish output in §4.25, not a claim that Greek, Arabic, or CJK
exports are now searchable or fully shaped.


### 4.27 Cutoff C: short-window menus, scroll controls, and bundled-platform failures

The C review adds 70 issue bodies and their full fetched comment threads, plus
189 post-B comment candidates across 146 existing threads. The complete inventory
and changed-record metadata are in `issue-ledger-follow-on-c.jsonl` and
`issue-ledger-cutoff-c-updates.jsonl`; crawl reconciliation and page hashes are
in `issue-ledger-follow-on-c.summary.json`. The issue and comment requests were
not atomic. #3354 and #3403 each received one new comment after the issue row
read; both were reconciled against a later live count. No report or PR merge is
called complete merely because its source issue is closed or a source PR is open.

- **Short-window menus — already handled in Varve, visually verified.**
  PdfCraft [#3373](https://github.com/storytold/pdfcraft/issues/3373) reports
  menus clipped below a 1366×768 XFCE display with no scrollbar. The issue's
  comment says PdfCraft's open [#3374](https://github.com/storytold/pdfcraft/pull/3374)
  adds a scrollable menu and short-window test; that PR remains open at
  `3c433631a9c0c5547e6a466eb9df01cf41ba8036`. Varve's shared
  [`Menu.tsx`](../../../packages/ui/src/components/Menu.tsx) caps its scroll
  viewport to the visual window and keeps the outer placement node non-scrollable.
  [`Menubar.tsx`](../../../packages/editor/src/Menubar.tsx) also groups the long
  View list and provides a scroll owner for long command lists.
  [`Menu.test.tsx`](../../../packages/ui/src/components/Menu.test.tsx) checks
  the menu as the sole scroll owner and keyboard reachability. This is direct source/test evidence, and the new lease-wrapped 1366×400
  Chromium regression passed. The saved menu capture was visually inspected at
  [`menu-short-viewport.png`](evidence/menu-short-viewport.png) (SHA-256
  `7788c651ef2a0218f1f8b8686126b94f2fc7982dfa777b95eef20b4d7f8af99a`). The
  run used the TypeScript renderer fallback; it validates menu layout and item
  reachability, not GPU rendering. The website has no menu behavior claim to
  revise.
- **Touchpad scroll speed — already provided; hardware validation remains open.**
  PdfCraft [#3329](https://github.com/storytold/pdfcraft/issues/3329) asks for a
  manual speed multiplier after slow Linux GNOME input reports. Varve exposes
  wheel behavior and a persistent `0.25×`–`4×` sensitivity control in Drawing
  Input settings ([`DrawingInputSettingsTab.tsx`](../../../packages/editor/src/components/Settings/DrawingInputSettingsTab.tsx));
  the existing canvas navigation audit records wheel classification and tests.
  Linux Wayland hardware feel is still unmeasured in
  [`input-system-behavior-matrix.md`](../../../docs/architecture/input-system-behavior-matrix.md).
  PdfCraft's related [#2623](https://github.com/storytold/pdfcraft/pull/2623) is
  open at `fd5d6a03e7132d7fdcf46173f63676b4a6136347`; injected input tests do
  not establish hardware behavior. No new Varve code change is justified by the
  feature request alone.
- **Linux file-picker failure — different configured backend.** PdfCraft
  [#3344](https://github.com/storytold/pdfcraft/issues/3344) provides a concrete
  AppImage/XFCE/X11 report: rfd 0.17 tries the XDG FileChooser portal, falls
  back to Zenity on failure, and returns no path when both fail. Tauri's plugin
  source and Varve's lockfile show `tauri-plugin-dialog` 2.7.2 with its default
  `gtk3` feature and `rfd` 0.16.0; Varve's picker is therefore configured for
  GTK3 rather than the reported portal→Zenity chain. The issue is useful Linux
  support evidence but does not establish the same backend failure in Varve.
  A related UX limitation remains: the platform dialog facade currently
  returns the same `None` for cancellation and picker failure, so it cannot
  safely show an unconditional failure alert without distinguishing a normal
  cancel. This cutoff did not reproduce that failure in Varve; it remains a
  separate platform observability follow-up.
- **Broad drawing complaint — screened, not reproduced.** PdfCraft
  [#3370](https://github.com/storytold/pdfcraft/issues/3370) bundles alleged
  input latency/flicker, jagged strokes, gesture-based shape snapping, and
  smoothing. It supplies no app version, test file, recording, or steps. Varve
  has a separate canvas responsiveness and visual-quality workstream and an
  existing Paint smoothing setting, but this source report does not demonstrate
  a Varve defect. No shape-assist feature or marketing claim is added from this
  request.
- **Other recursive leads.** #3258's Macedonian text report is PdfCraft
  Fill & Sign text encoded in WinAnsi; open [#1775](https://github.com/storytold/pdfcraft/pull/1775)
  adds Type 3 text for that workflow, but Varve does not provide Fill & Sign.
  #3396's original stream-boundary allegation was corrected by its author;
  PdfCraft already inserts the spec-required separator, while Varve's PDF importer
  explicitly remains a partial text/rectangle extractor. These do not support
  a shared PDF-reader defect claim. Other product requests concern PDF security,
  forms/XFA, OCR, reader navigation, printing, signatures, scanner acquisition,
  prepress, or operating-system packaging and are individually classified in
  the C ledger.

### 4.28 Cutoff C follow-up: browser save state and callout editing

- **Browser download completion — shared behavior; fixed in Varve.** PdfCraft
  [#2167](https://github.com/storytold/pdfcraft/issues/2167) separates a
  cross-origin host-bridge defect from an unresolved browser-download contract.
  Its merged [#2601](https://github.com/storytold/pdfcraft/pull/2601) fixes the
  host bridge and explicitly leaves the download behavior open: an anchor click
  cannot tell the page whether the person kept or cancelled the file. The new
  comment requests leaving the document modified, preserving the leave-page
  warning, and saying that download started; File System Access can report a
  completed write where supported. Varve already distinguishes browser file
  handles from `download-only` targets, but its first-save path incorrectly
  cleared dirty state after `writeSaveTarget` only clicked a download link.
  This was reproduced in `downloadOnlySave.test.tsx`. Varve now keeps both the
  editor and session dirty and does not advance `lastSavedAt` for first or
  subsequent download-only saves; native, library, and browser-handle writes
  retain revision-aware clean marking. The audit ledger's earlier #2167
  “already handled” entry had an unrelated recovery rationale; this follow-up
  corrects that assessment. The Browser Demo guide now says that Firefox and
  Safari downloads cannot be confirmed and keep the document modified; no new
  public capability is claimed.
- **Callout repositioning — direct tail and independent body movement implemented; resizing remains open.**
  PdfCraft [#1152](https://github.com/storytold/pdfcraft/issues/1152) and its
  new floor-plan user comment ask to move the callout body/text independently
  while its arrow tip stays anchored; the commenter says canvas drags currently
  move the whole callout. Varve has separate body, text, and tail nodes, a
  layer-tree deep-selection path and numeric Inspector controls. A selected
  parametric pointed callout now has direct canvas handles for its arrow tip
  and bend, with fixed 24 CSS-pixel hit targets, keyboard nudging, and pointer
  regression coverage. The body handle now moves the balloon body and text
  independently while preserving each tail tip's world-space position, with
  undoable pointer dragging and keyboard nudging. The eight-way resize behavior
  requested by #1152 remains absent, so the issue is only partially addressed.
  The previous cutoff-B disposition and rationale (“PDF interchange
  metadata”) were incorrect. Adobe user reports also warn that grouped handles
  can be hard to reach and unreliable below 100% zoom; the zoom-independent hit
  target is an intentional response, but cross-platform native-app validation
  remains a follow-up.
- **Additional Varve-adjacent reports — screened, not reproduced.** PdfCraft
  [#3266](https://github.com/storytold/pdfcraft/issues/3266) reports a page
  that jumps after zoom settles. Its later
  [merged fix, PR #3350](https://github.com/storytold/pdfcraft/pull/3350),
  confirms the cause: the paginated reader could draw a zoom-anchor scroll
  beyond the content bounds for one frame before the UI toolkit clamped it.
  Varve's authoring canvas has no page-scroll boundary; it solves camera pan
  directly from the world point under the zoom anchor in
  `packages/shared/src/viewport.ts`, and the wheel path previews that camera
  without a separate settle animation in `packages/editor/src/canvas/inputPipeline.ts`.
  Unit coverage checks the anchor through zoom and clamping, and
  `tests/e2e/canvas/input-navigation.spec.ts` checks repeated cursor-anchored
  Ctrl-wheel zoom in the browser. The PdfCraft page-boundary failure therefore
  does not map to Varve's current canvas model; no matching jump was reproduced
  and no code change is justified. PdfCraft
  [#3284](https://github.com/storytold/pdfcraft/issues/3284) and
  [#3317](https://github.com/storytold/pdfcraft/issues/3317) requested opaque
  fills and thicker borders for text boxes/callouts; their merged source fix
  is reviewed in §4.29. PdfCraft
  [#3399](https://github.com/storytold/pdfcraft/issues/3399) asks for callout
  text sizing, already available through Varve's Typography inspector on the
  ordinary dialogue TextNode. These are recorded as partial workflow matches,
  not as defects found in Varve. No marketing claim follows from them.

### 4.29 Cutoff C follow-up: text-frame fill and border

- **Source behavior is now implemented; Varve still has a distinct gap.**
  PdfCraft issues [#3284](https://github.com/storytold/pdfcraft/issues/3284)
  and [#3317](https://github.com/storytold/pdfcraft/issues/3317) describe text
  placed over busy floor plans becoming hard to read without an opaque backing,
  and request fill and border-width controls for text boxes and callouts. The
  merged [PR #3366](https://github.com/storytold/pdfcraft/pull/3366) adds
  persistent FreeText `/C` fill, callout/text-box border controls including
  zero width, saved tool defaults, annotation appearance regeneration, and
  `comment_edit` support. Its own annot, automation, UI, and native checks are
  source-project evidence, not validation of Varve.
- In Varve, callout bodies are ordinary `ShapeNode`s and already use the
  standard Fill and Stroke inspector. Ordinary `TextNode` has shared node
  fills, but those are used to paint glyphs; `TextNode.strokes` outlines glyphs
  through the text painter. Neither gives users a backing rectangle or a
  border around a text frame. The floor-plan readability need therefore
  remains relevant to Varve's authoring workflow.
- **Comparable-app complaint (checked 2026-10-19):** an Inkscape report,
  [Text/Border padding #3705](https://gitlab.com/inkscape/inbox/-/issues/3705),
  migrated from Launchpad and dated 2006-11-15, asks for a text-box background,
  border, and inset spacing. The reporter describes composing separate
  rectangles with flowed text and inset/outset commands as a longer workaround.
  This supports the value of a first-class box style, while also identifying
  padding/inset as a separate capability that this batch does not implement.
  The distinct Inkscape complaint about an outside *glyph* stroke
  ([Reddit, 2020-04-25](https://www.reddit.com/r/Inkscape/comments/g7v72j/help_trying_to_add_outside_border_to_text/))
  concerns stroke alignment eating small glyphs; a text-frame border does not
  solve that glyph-outline problem, so this batch makes no such claim.
- **Implementation acceptance:** provide an optional text-frame backing and
  frame border without changing existing text appearance; retain glyph fill
  and glyph-outline behavior; keep the frame aligned to the same computed text
  geometry used by selection and hit testing; preserve undo, copy/paste,
  duplicate, save/reopen, and old-document compatibility; render consistently
  in Canvas2D, native/WASM, SVG, and PDF export; expose clear inspector controls
  with an explicit no-fill/zero-border state. Verify point, area, rich, and
  vertical text, including clipping and text reflow. Do not claim this
  capability on the marketing site until every supported output path passes.
- **Implementation status:** an additive `TextNode.textFrame` style is now
  wired through schema 2.34, the text render primitive, native/WASM bridge,
  Canvas2D replay, SVG and PDF export, and a dedicated Inspector section. Existing
  node fill/stroke fields remain glyph styling, and the v2.33 migration does
  not invent a frame style. Focused persistence, renderer, bridge, PDF, and
  visual E2E regressions have been added. Targeted Rust tests, changed-crate
  Clippy, the 12-case SVG suite, and both WASM builds pass. A read-only second-pass review caught
  an SVG opacity mismatch; SVG now applies opacity to frame and text as
  separate paint operations, matching Canvas2D and PDF. The PDF probe was
  rasterized independently with Poppler: the fill masks the
  diagonal floor-plan lines inside the frame, the border remains crisp, and
  `pdftotext` extracts the label. See
  [`text-frame-pdf-render.png`](evidence/text-frame-pdf-render.png) (SHA-256
  `dbe164ef571e91075deb60abbe483681ec0a58b48a59f60428dcb5593933cabd`). The
  app visual E2E passes save/reopen and zero-width persistence; desktop and
  1024×768 captures were inspected. The typography page visual E2E passes at
  desktop and 390×844, and both captures were inspected. Evidence:
  [`text-frame-inspector-desktop.png`](evidence/text-frame-inspector-desktop.png)
  (`eb004f0489f0a6e24856e81b93829d168d27c3c842dce7bab85a2bdccea49159`),
  [`text-frame-inspector-1024.png`](evidence/text-frame-inspector-1024.png)
  (`582b0d5bedafad0695bdaf41fa28dfb96ac57d58eba09f947b25f1e400bcb6a8`),
  [`text-frame-marketing-desktop.png`](evidence/text-frame-marketing-desktop.png)
  (`6fbb76512fee27e7e7546f536171458db55d74547c72ca315bcd4c329237ff9c`), and
  [`text-frame-marketing-mobile.png`](evidence/text-frame-marketing-mobile.png)
  (`fafdad263372fc20d4b2fc92387491a731ef9c121c0fb69d22f36188af26e9d9`).
  The affected plan selected 75 lanes and escalated to the exact-SHA full gate.
  The complete affected triage had contention-sensitive failures and remains
  incomplete; however, the exact-SHA hosted full integration, final-candidate
  adoption, and local full-gate complement passed on merged master SHA
  `d2ed5a42694742c2bbbcffe4916e2ae932ad0890`. This certifies the integrated
  candidate at that SHA; it does not convert the incomplete local triage into a
  pass or imply a public release. The exact source PR scope
  and later issue closure are recorded in
  `issue-ledger-post-cutoff-c-updates.jsonl` and `link-frontier.jsonl`.

The website's Browser Demo guide was updated to explain the download-only save
state; no other marketing or capability claim needed revision. The menu and
wheel controls are existing behaviors.

## 5. Cutoff D review (203 new issues; engineering mapping in progress)

Cutoff D was reconciled against pagination and Search API totals, then every
new issue body and all 356 comments in its current thread were read. This is
source-review coverage, not 203 verified Varve defects. The per-issue ledger
records `review_depth: thread`; its separate Varve mapping/disposition remains
pending until the corresponding source path and relevant linked evidence are
checked. Pull requests in the issue endpoint were counted separately; their PR
discussion and review comments were not part of this issue-thread pass.

The reviews surfaced these strongest candidates for source-level follow-up:

| Reports | Transferable failure family | Varve check / current boundary |
|---|---|---|
| #3409, #3496, #3555, #3755 | Save success, dirty state, file-watcher races, and undo continuity | Inspect atomic-save finalization, open text draft drains, external-file detection, and undo persistence together. #3496 is consistent with the already-reviewed pending-edit defense; the other cases require separate verification. |
| #3421, #3444, #3481, #3505, #3519, #3592, #3597, #3601, #3604, #3684, #3687, #3707, #3713, #3769 | Unicode entry, bidi caret movement, glyph coverage, and text selection | Varve has a distinct text/font/shaping path. Treat PDF font/resource failures as evidence for tests and diagnostics, not proof of a Varve defect; inspect Arabic/Indic/CJK fallback and spaces in Varve's supported text path. |
| #3446, #3464, #3650, #3665, #3736, #3793 | Canvas input, touchpad gestures, device-specific pointer handling, and window presentation | Varve already has a native Linux touchpad pinch bridge and pointer-type policy. #3793's user clarifies that a Synaptics touchpad scrolls too slowly and pinch does not work on KDE Plasma 6.8 / Arch; this remains a device-level validation gap, not a confirmed Varve failure. #3650's Wacom report likewise needs comparison with Varve's Tauri event path and supported hardware. |
| #3437, #3474, #3518, #3541, #3620, #3651, #3693, #3747, #3780 | Direct manipulation, live feedback, transformed hit testing, and selection/deletion invariants | Map only after inspecting the exact Varve tool and whether the reported PDF operation has a native analogue. The callout body/tail drag improvement is already implemented and visually validated in this branch. |
| #3429, #3499, #3507, #3511, #3644, #3645, #3646, #3647, #3732 | Destructive changes, hidden content, dependency reachability, and truthful partial results | Varve is not a PDF sanitizer or redaction tool. Check only shared export/visibility invariants; do not infer a need for PDF security features. |
| #3570, #3590, #3666, #3675, #3744, #3776 | Visible geometry versus hit testing, text layout preservation, UI layout, and color compositing | Follow concrete samples or synthetic reproductions before mapping to Varve. #3776 is specifically DeviceCMYK PDF blend-space behavior, outside Varve's present color model unless the renderer supports an equivalent contract. |

Examples screened out of the current product boundary include PDF signatures,
forms/XFA, redaction, PDF page organization, reader-only preferences, PDF
content-stream rewriting, and OS-specific PDF printer controls. These remain
source-product bugs or requests, not Varve defects. Bot-generated “possibly
related” links were not treated as verified duplicates or fixes. In particular,
the four issue IDs beyond the reviewers' initial numeric cohorts were read
directly: #3792 concerns PDF spread layout and native PDF editing; #3793 is the
touchpad report above; #3795 requests browser-style middle-button auto-scroll,
which is not established as a Varve requirement; and #3797 concerns editing
text already inside a PDF, which Varve's limited importer does not support.

The next source-review pass should resolve the highest-risk save/undo and text
input candidates first, then the platform input reports. It must inspect
linked fixes/PRs and attachments where they contain the only reproduction,
and verify current Varve behavior before changing code or marketing claims.
