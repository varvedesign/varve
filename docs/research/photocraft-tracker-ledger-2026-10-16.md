# Photocraft tracker research ledger — 2026-10-16

Research inputs for Varve hardening, mined from a sibling project's defect
tracker. Source tracker:
[storytold/photocraft](https://github.com/storytold/photocraft/issues) — a
Rust + Tauri photo editor ("written from scratch in pure Rust") that shares
Varve's architectural family: Tauri shell, native engine, canvas compositor
with GPU and CPU paths, layered document model, undo/history, text engine,
export/import interchange.

Issues were read through the GitHub API (authenticated `gh`) on 2026-10-16.
The full open backlog was captured with bodies and labels to a working
dataset (1,536 open issues, ~2.0 MB of body text; 99% carry a body).

**Evidence levels used below** (same vocabulary as
`document-workflows-tracker-ledger-2026-10-15.md`): *report*, *proposal*,
*audit* (source-inspected, not runtime-reproduced), *reproduced* (reporter
supplied an executable or minimal repro), *fixed*.

## Scope and method

The tracker holds 3,257 issues (1,536 open / 1,721 closed) and 968 open pull
requests; there are no milestones, no discussions, and no wiki. Independent
issue threads are not the right unit of transfer — 290 open issues are
labelled `multiple issues` and 159 are duplicates, and the value is in
**failure classes**. The sweep therefore classifies every open issue into a
terminal verdict, then verifies only transferable classes against Varve's
code.

Classification covers all 1,536 open issues with one of: `applicable`,
`already-covered`, `absent-surface`, `ps-parity`, `hardware`, `quality`,
`unclear`. A mechanical pre-filter assigns 292 issues a likely exclusion
before judgement (159 `duplicate`, 78 format/feature surfaces Varve does not
implement, 28 hardware/platform-specific, 8 no-signal, 4 spam and 15
Photoshop-parity-only), leaving 1,244 requiring judgement.

**This ledger records only findings verified against Varve source.** A
classification of `applicable` means a failure class *could* exist here; it is
not a claim that it *does*. Every entry below cites the file and line that was
actually read.

## Tracker-shape observations

These hold across the whole backlog and are independent of any single issue.

1. **File-integrity failures cluster at the edges of the write path**, not in
   the write itself. The tracker's own consolidated issue
   ([#6617](https://github.com/storytold/photocraft/issues/6617)) states that
   atomic saves (temp file, fsync, rename, directory fsync, Windows rename
   retry), incremental crash-recovery autosave and portable mode "already work
   well" — while the defects sit in identity, collision, permission and
   metadata handling around that core.
2. **Two-writer collisions are reported at top severity.** Three of the
   tracker's critical/high file bugs are the same class: two documents or tabs
   targeting one path with no claim on it. The recurrence of the same class
   across separate reporters is the signal, not any one report.
3. **Lock enforcement is systemic, not per-tool.** Lock-related bypasses
   appear against filters, plugins, transforms and image operations
   separately, each time because a sibling path was added without the guard.
4. **Numeric coercion to non-finite is a repeated, save-breaking family.** Four
   separate issues describe a value past `f32::MAX` becoming `inf` and the
   document then never saving again, across different command groups.
5. **Derived-render invalidation is documented as fixed in some paths and
   broken in their siblings.** The reporter of one transform bug explicitly
   names the sibling paths that do clear the cache. This is an asymmetry
   class, not a missing-feature class.

## Ledger

| Source | Status | Bounded failure | Transferable lesson for Varve | Decision |
|---|---|---|---|---|
| photocraft #5752, #6424, #6862 | open, *audit* | A number beyond `f32::MAX` (e.g. `1e39`) loads or is coerced to `inf`; the command returns `Ok` and the document can then **never** be saved. The load path has no finite check, and the only check runs on save | A value that the save path rejects must be refused at the point it enters the model, not discovered at write time. Load and interactive input are both entry points | **Varve finding confirmed (same class).** `NumberField.tsx:177-190` guards the plain-number path with `Number.isFinite` but returns the expression path's `evaluate(...)` unguarded; `expr.ts:53-81` tokenizes no exponent but `1e308*10` / `1e-320` reciprocals evaluate to `Infinity`; `NumberField.tsx:269` clamps to unbounded min/max; `canonical.ts:351-356` then **throws** at save; `document-utils.ts` contains no `Number.isFinite` check at all, so `validateDocument` / `repairDocument` do not refuse such a document on load. `usePersistence.ts:126-129` surfaces the throw as `unknown-io`, leaving the document unsaveable. **Repro not yet run** — reachability is by code path |
| photocraft #6808 | open, *audit* | After Free Transform or Warp, a fill layer's cached render keeps drawing for the old frame. The reporter names the sibling paths that *do* clear the cache and the one that does not | Geometry-changing paths must invalidate every derived cache, or the one path that forgets becomes a visible-correctness bug | Plan: audit Varve's transform/geometry entry points for asymmetric derived-cache invalidation, against the existing AGENTS.md rule "never show pixels no fresh frame will replace" |
| photocraft #6770, #5623, #5655 | open, *audit* | Locked layers are mutated by plugin and filter paths that skip the check every built-in command performs — three separate reports, three separate paths | Lock is a model invariant, not a per-surface affordance | **Varve finding confirmed (same class).** `packages/scene/src/operations/*.ts` has **zero** `locked` references; the flag is enforced per-surface (`HitTestPolicy.ts:196`, `HitTestEngine.ts:262`, `marqueeGeometry.ts:231`, `paintTarget.ts:105`, `rasterTarget.ts:143`, `clippedPaintLayer.ts:166`, `LiquifyTool.ts:92`, `LayersTree.tsx:937`, `plugins/controller.ts:155`). `ScaleTool`, `PenTool`, `NodeEditTool`, `TextTool`, `CropTool` have **no** locked guard, and `SelectionOverlay.tsx:351-354` suppresses handles only when `isSingle` is true — so a **multi-selection containing locked nodes still exposes transform handles**. Automation is separately guarded (`packages/automation/src/commands/common.ts:236-250`, incl. ancestor lock). **Repro not yet run** |
| photocraft #6597 | open, *audit* | Save As onto a path that another open document owns leaves that document marked "saved"; its content exists only in memory and is lost on close, and a later save there overwrites the other's file | "Saved" is per-document state, so a path must have a single owner or the collision must be refused | **Varve finding confirmed (same class, native route).** `crossTabWrite.ts` protects **browser-local** documents (Web Locks per document + optimistic `updatedAt` skip). The native file route has no equivalent: `saveCoordinator.ts` serializes per document only, and no session-target collision check exists (`context.tsx:9478-9483` dedupes at *open* time on `fileId`/`filePath`, which is open-time only). `diskContentHash` (`context/types.ts:326-338`) detects external *content* drift, not another session's ownership. **Repro not yet run** |
| photocraft #6601, #6600, #6602, #6603, #6604, #6605, #6606 | open, *audit*, partly cross-platform-confirmed | Non-UTF-8 filenames open-fail and Save As writes a **second** file; read-only targets are replaced; atomic rename breaks hard links; extended attributes are dropped; interrupted saves leak temp files; a dangling symlink is replaced by a regular file; missing folders are silently created | Filename and metadata fidelity are part of the save contract, not incidental I/O | **already-covered** in Varve by `docs/architecture/filesystem-boundary.md:82-103`: atomic writes use an app-generated sibling temp name and explicitly **do not** convert the target filename through `to_string_lossy()`; replacement uses the host-native atomic replace (`MoveFileExW` with replace/write-through where plain rename fails); failure categories include `READ_ONLY`; generated names handle Windows-invalid characters and reserved device names. Verify the remaining edges (xattr/hard-link preservation, dangling symlink, implicit directory creation) rather than re-planning the core |
| photocraft #6563, #6564 | open, *audit* | A layer-texture allocation failure is not caught or evicted, and one wgpu error (including a recoverable Out-Of-Memory) disables GPU drawing for the rest of the session | A transient resource failure should degrade the current frame, not the session; capability state must distinguish "this attempt failed" from "this device is gone" | Plan: check `varve-accel` degradation is per-frame. ADR-0237 already defines staged capability (discovered → runtime-loadable → device-usable → execution-verified); confirm a mid-session allocation failure does not collapse the stage permanently |
| photocraft #6865, #6732, #6867 | open, *report* | Non-mutating actions (using a selection tool, hovering a blend-mode menu) mark the document modified and/or create history entries | Dirty state and history must track *mutations*, not presence in a tool or a preview | Plan: audit selection tools and preview/hover surfaces for history writes. Varve already scopes per-gesture transactions in several controls (`NumberField` wheel/scrub idle-commit, `FramePresetDropdown.tsx:318`), so the pattern exists to extend |
| photocraft #6598 | open, *audit* | Opening a file already open creates a second tab bound to the same path; saving one overwrites the other | Open-time identity must dedupe on canonical identity, not only on the string the caller passed | **already-covered** in Varve: `context.tsx:9478-9483` switches to the existing tab on matching `fileId`/`filePath`, including restoring that session's snapshot, selection and viewport. Note the residual gap is the *save* route (see #6597 row) |
| photocraft #6776, #6780 | open, *audit* | Operationally: a mask processed through the colour path gains an alpha channel and a zero default, so a reveal-all mask hides everything; and a routing parameter is dropped so the wrong target is mutated | Single-channel and multi-channel surfaces must not share a transform implementation; routing parameters must survive to the mutation site | Plan: verify Varve's mask surface pool and clip/alpha/luminance paths do not route masks through the colour path. `masking-system.md` already separates the clip/alpha paths and the hard-clip `ctx.clip()` fast path; grep for mask warps that use the colour warp |
| photocraft #6883, #6846, #6741, #4073 | open, *report* | Emoji render blank or monochrome; missing font names are silently substituted with a bundled fallback; Persian ZWNJ inserts a regular space | Font fallback outcomes must be truthful (a missing glyph is disclosed, never silently substituted), and joining controls must not be normalized away | Plan: lattice-test the text pipeline for colour-glyph, missing-glyph disclosure and ZWNJ/ZWJ preservation. `docs/architecture/text-pipeline.md` is the contract surface |
| photocraft #6619 | open, *report* | Undo after finishing a pen path deletes the whole path; each undo removes one whole path | Undo granularity inside a multi-step authoring gesture is a product decision, but it must be deliberate | **Not adopted.** Varve commits the whole path in one transaction (`PenTool.ts:389-423`) and provides an explicit last-anchor removal (`PenTool.ts:375`), so the behaviour is intentional rather than a defect. Recorded so it is not re-raised as a bug |
| photocraft #6611 | open, *audit* | One wrongly typed value in the preferences file resets **every** preference on **every** launch, and the bad file is never rewritten, so it recurs | Config decoding must be per-field tolerant, or one bad key permanently degrades the session | Plan: check Varve preference decoding for per-field fallback. A single-key type error must not discard unrelated settings |
| photocraft #6608 | open, *audit* | Linked assets store absolute paths, so moving or sharing a project breaks every link | Portable documents must store relative references and resolve them first | **already-covered** in Varve: `PortableProjectPath` (filesystem-boundary.md) rejects absolute paths, drive prefixes, UNC roots, backslashes, `.`/`..`, URL schemes and traversal components |
| photocraft #6615 | open, *report* | The web build has only a `beforeunload` prompt; a tab crash or OOM kill loses all unsaved work, because the recovery store is native-only | Browser persistence parity must be explicit, or the gap must be disclosed | **already-covered** in Varve: the browser route documents IndexedDB recovery points (`varve-recovery`, capped at 20, cleaned after 7 days) and the lifecycle system treats web persistence as a contract |
| photocraft #6110 | open, *audit* | Stroke coverage is materialised as one dense float buffer over the whole bounding box, with the footprint guard private to a single command, so five sibling retouch commands are unbounded | A cost guard must be shared by every command that reaches the same allocation | Plan: check the paint path's stroke budget is shared rather than local. Varve has `MAX_STROKE_OPACITY_BYTES` (`packages/scene/src/strokeOpacity.ts:8`) and a visible stroke-opacity limit announcement (`PaintTool.ts:626`); confirm coverage allocation for a very large brush radius is equally bounded |
| photocraft #6533, #6535, #6528 | open, *audit* | Toggling an adjustment layer, the eye icon, or a clipped adjustment damages the whole canvas rather than its own base; past the GPU budget it becomes a full CPU composite with no reuse of the previous result | Invalidation scope should follow the dependency graph, and a before/after toggle should be able to reuse the previous composite | Plan: compare against `docs/architecture/render-pipeline.md` partial-redraw guards. Varve already has byte-exact camera equality and `surfaceMatchesBackingStore` for the camera-only fast path; this finding argues for checking *layer-level* invalidation scope, not camera scope |
| photocraft #6607 | open, *audit* | Saving needs ~4× the file size in extra RAM because the whole encoded file is built in one `Vec<u8>` before writing | Large documents should stream to the write target | Plan: check Varve's save path for a whole-document buffer. Relevant only if a single-buffer encode exists on the document save route |
| photocraft #6423 | open, *reproduced* (280-byte reproducer) | A self-referencing compound shape recurses with no depth limit or visited set and aborts on stack overflow, which `catch_unwind` cannot survive | Structural recursion over untrusted input needs both a depth bound and a visited set; a depth bound alone does not stop cycles | Plan: audit Varve import parsers for unguarded recursion over document-supplied references. Mask/scope graphs already run `detectMaskCycles`, which is the right shape to extend |

## Independent checks

- The tracker's file-integrity audit issue
  ([#6617](https://github.com/storytold/photocraft/issues/6617)) is a
  first-party statement of what already works in that codebase. It is used
  here only to identify the *edges* of an otherwise-correct write path, and
  is not treated as evidence about Varve.
- Varve's `docs/architecture/filesystem-boundary.md` and `save-destinations.md`
  were read directly, not inferred from their titles, before any
  `already-covered` verdict was recorded.

## Evidence limitations

- Tracker reading was API-based. Attachments, screenshots and comment threads
  beyond the issue body were not examined; several reports carry their only
  technical detail in an attachment.
- **No photocraft scenario was runtime-reproduced against photocraft by this
  audit.** Every photocraft entry is *report* or *audit* as stated.
- **No Varve repro has been run yet for the confirmed findings.** The
  `NumberField` overflow, the locked-node multi-selection transform, and the
  native save-path ownership gap are traced through source and are marked
  *audit*; each needs an executable regression before any fix is claimed.
- Classification verdicts are judgements over issue text, not verified claims
  about Varve. `applicable` means "expressible in a subsystem Varve has".
- The mechanical pre-filter's format list is Varve's declared scope and can
  become stale if that scope changes.

## Open questions for the next pass

1. Which `applicable` classifications survive source verification? The first
   verification pass (recorded above) confirmed four classes and produced one
   correction (#6619 is not a defect).
2. Are the confirmed findings reproducible? Each needs a failing test before
   a fix.
3. Does any landing fix change a public product claim? If it does, the
   website's marketing contract (`docs/marketing/positioning-and-discovery.md`)
   and the affected page need the same review.
