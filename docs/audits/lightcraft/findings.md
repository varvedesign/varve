# LightCraft corpus — canonical findings for Varve

Evidence levels (a finding climbs only with evidence):
externally reported → supported by source → reproduced in external app →
applicable to Varve → reproduced in Varve → implemented → validated →
independently reviewed → integrated → released.

A lightcraft issue is never a Varve defect by itself. Each finding names the
Varve code path that was checked. Research status and engineering status are
tracked separately; deferred relevant work stays unresolved rather than being
relabelled.

## F-1 — Desktop folder export silently replaced existing destination files

**Engineering status:** implemented → validated at the adapter boundary (real-filesystem regression, negative control, package typecheck/unit lanes) → independently reviewed (separate agent; corrections applied) → locally integrated. Native Tauri desktop execution was **not** run; remote merge was not performed (see continuation.md).
**Evidence level reached:** applicable to Varve → reproduced in Varve (pre-fix adapter) → implemented → validated (adapter boundary) → independently reviewed → locally integrated. Not released; native-path runtime evidence is outstanding.
**Class:** data loss / output integrity. **Priority:** P1.

**External evidence (lightcraft):**
- [#93](https://github.com/storytold/lightcraft/issues/93) — export/render/MCP writes could overwrite a photo's original file; the native writer was a plain std::fs::write (truncate) and replacement was unconditional. Expected: refuse or confirm, write temp+rename, apply the conflict policy to sidecars.
- [#1405](https://github.com/storytold/lightcraft/issues/1405) — an explicit destination path silently replaced a pre-existing file (CLI/MCP), exit 0, no warning; conflict=unique/skip did not apply to explicit paths.
- [#2571](https://github.com/storytold/lightcraft/issues/2571) and [#1944](https://github.com/storytold/lightcraft/issues/1944) are the same class at other writers (subfolder traversal; keyword export bypassing the original-file guard). Closed issues are evidence, not proof of a shipped fix; the corpus guards differed per writer.

**User problem:** re-exporting artwork into the same folder destroys the
previous deliverable (or any user file with the same name) with no prompt and
no undo. For a local-first design suite this is silent loss of the user's own
output.

**Varve workflow / code path (checked at HEAD 1301951a7):**
- packages/editor/src/components/Shell/ExportLayer.tsx:355-356 — desktop batch export with a chosen folder builds createExportFolderSaveFile(platform, batch.destinationFolder).
- packages/editor/src/exportSaveAdapter.ts:138-145 (before fix) — forwarded the planned entry straight to platform.writeBinaryFileToFolder.
- packages/platform/src/tauri.ts:789-808 → apps/desktop/src-tauri/src/lib.rs:399-423 (write_binary_file_to_folder) → write_file_atomic (lib.rs:274-320): the native write is atomic, but its rename replaces an existing target unconditionally. No destination existence check existed anywhere in the editor export path (grep: 0 hits).
- packages/scene/src/export/model.ts:314-320 declares ConflictPolicy = ask | replace | skip | rename; packages/editor/src/components/Export/ExportDialog.tsx:203,291 hardcodes rename, and resolveCollisions only resolved intra-batch collisions (packages/scene/src/export/naming.ts:347-405), never collisions with files already on disk.

**Current behaviour (reproduced in Varve):** exporting a batch to a folder that
already contains Logo.svg rewrites /chosen/Logo.svg; the previous file is gone.
The new real-filesystem regression
(packages/editor/src/exportDestinationConflict.test.ts) fails on the pre-fix
adapter in 3 of 4 cases (negative-control run recorded in batches.md).

**Intended outcome:** a desktop folder export does not replace an existing file.
An occupied name is deterministically suffixed (Logo-2.svg, Logo-3.svg, …), the
results report names the primary file that actually landed on disk, and the old
file is untouched. If the existence probe cannot answer, the export fails that
job closed (nothing written) rather than guessing; the error names the file and
the destination. The mechanism is check-then-write, so a concurrent writer
creating the chosen name between the probe and the native atomic rename is a
documented residual window (F-4 / opportunities.md), not claimed as eliminated.

**Implementation decision (smallest coherent change):**
- packages/editor/src/exportSaveAdapter.ts — resolveDestinationEntry() probes platform.fileExists() (existing platform capability; Tauri home_file_exists accepts any absolute path, lib.rs:4680-4689) and returns the first free appendSuffix name, capped at 999 probes with an explicit error. The writer keeps its atomic native write and folder containment.
- packages/scene/src/export/naming.ts — appendSuffix is exported (no line growth; file stays at its 431-line frozen baseline) so the suffix rule has one implementation shared with intra-batch collision resolution.
- The adapter reflects the written entry back into job.fileName only for the job's own output; the report's primary fileName/savedPath are truthful without touching the frozen exportService.ts / ExportLayer.tsx. Known limitation (found in independent review): for a multi-file deliverable (e.g. React CSS Modules) a renamed sibling is correct on disk but the report's additionalFiles list still carries the planned sibling name, and the results UI does not display additional files today. Locked by a real-filesystem test.
- Not changed: browser exports (ZIP/download sinks, browser-managed duplicate naming), single-file save dialog (native dialog owns overwrite consent), ConflictPolicy UI exposure (ask/replace/skip remain unexposed — see opportunities.md).

**Acceptance criteria (observable):**
1. Folder containing Logo.svg + batch exporting Logo.svg ⇒ writes Logo-2.svg; original bytes unchanged; report shows Logo-2.svg.
2. Logo.svg and Logo-2.svg present ⇒ writes Logo-3.svg.
3. Free folder ⇒ requested name, no rename, no extra suffix.
4. Multi-file deliverable sibling (Card.module.css) never retitles the job (Card.tsx stays the reported name).
5. Probe rejects/throws ⇒ the job fails closed with a clear error and writes nothing (mid-loop probe failure included).
6. No path outside the chosen folder is created (existing Rust containment is unchanged and still enforced). Probe paths are tested for POSIX root, trailing separators and Windows drive folders.

**Validation evidence:** see batches.md §Validation. Native Tauri desktop run was
**not** executed in this environment (host memory/disk constraints; exact repro
steps retained in continuation.md). The adapter-boundary test uses the real
filesystem and the same platform contract the Tauri adapter implements. This
finding is not reported as released.

**Independent review record:** a separate reviewer agent (not the implementer) reviewed the uncommitted slice: no blocker in the approach, three major findings. (1) The evidence chain overclaimed integration before commit — corrected by this status block and by creating batches.md/continuation.md. (2) The #1405 inventory row recorded title-level depth while the finding quotes its body — corrected by Lead deep-read overrides in the inventory. (3) Multi-file sibling renames were reported untruthfully — documented as a limitation and locked with a real-filesystem sibling test instead of widening the change into the frozen exportService.ts. Minor findings were fixed: the probe is now tri-state and fails closed for first and mid-loop failures, the "never replaces" wording is scoped to the mechanism, tests cover root/trailing-separator/Windows joins, mid-loop failure and probe-budget exhaustion, and stray untracked worktree artifacts were excluded from the commit. Reviewer report: reports/lightcraft-corpus/research/reviewer/review.md.

## F-2 — WASM trace entry computes an unchecked width*height*4 product (verified gap, deferred)

**Engineering status:** deferred (verified gap; not implemented this session).
**Evidence level reached:** applicable to Varve → verified by source read.
**Class:** web-build abort / input validation. **Priority:** P2.

crates/varve-wasm/src/lib.rs:211 computes (width*height*4) as usize before
validating pixels.len(); the release profile (root Cargo.toml) does not enable
overflow-checks, so 65536x65536 wraps and an empty buffer can pass the length
check before a downstream abort. The media paths avoid this by validating with
u64 math (crates/varve-media/src/limits.rs:43). LightCraft evidence:
[#2138](https://github.com/storytold/lightcraft/issues/2138),
[#2569](https://github.com/storytold/lightcraft/issues/2569) (wasm32 unchecked
usize products defeating size validation), PR #2180.

**Why deferred:** it is a Rust crate change in a different package from this
slice; it needs cargo test -p varve-wasm plus a wasm target check, and this host
was under severe memory pressure (available memory ~1 GB). Next-slice brief and
exact acceptance criteria are in continuation.md.

## F-3 — Folder-export cancellation waits for the in-flight render/encode unit (partial gap, deferred)

**Engineering status:** deferred (partial).
**Evidence level reached:** applicable to Varve → verified by source read.

packages/editor/src/exportService.ts:361 (renderJob) takes no AbortSignal; the
signal is checked between jobs (:667,687,698,721), so Cancel during one long
render/encode resolves only after that unit finishes. LightCraft evidence:
[#832](https://github.com/storytold/lightcraft/issues/832) (Cancel waits for all
of it), #2132 (panic inside a batch leaves lanes waiting), #2678/#2680 (large
operations with no useful progress). User impact: Cancel can appear unresponsive
on large single outputs. Deferred: the fix needs a cancellation contract in the
engine render path (not a one-line check).

## F-4 — Native/dialog coverage gaps (test/DX, no defect found)

- No automated dialog test at 1366x768 — the size at which lightcraft
  [#781](https://github.com/storytold/lightcraft/issues/781) and #1263 clip
  Cancel/Export. The shared Dialog already viewport-clamps and pins the footer
  (packages/ui/src/components/components.css:650-702) and an a11y e2e lane exists,
  so this is a missing regression, not a reproduced defect.
- Native GTK file dialog / xdg-portal behaviour and the GTK drag-drop coordinate
  bridge are implemented but explicitly untested
  (docs/release/platform-support-matrix.md; packages/platform/src/tauri.ts:945-994).
  LightCraft evidence: #191, #189, #639, #3140. Recorded as a desktop test
  limitation, not a Varve claim.
- No TOCTOU-free guarantee on the new destination probe: a second writer can
  still create the chosen name between probe and atomic rename. Documented
  limitation; create_new follow-up in opportunities.md.

## Already handled in Varve — corpus class checked, proving file named

| Lightcraft class | Varve mechanism | Proof |
|---|---|---|
| Export geometry rounding + alpha (#1312, #1670, #2976) | scale/plan geometry caps, alpha-aware resample, PNG alpha path | packages/engine/src/exportPipeline/resample.test.ts:91,103,154; tests/e2e/export/png-alpha.spec.ts:22-60 |
| TIFF 16-bit/LZW (#2882) | No TIFF encoder exists; capability table says so | packages/scene/src/export/capabilities.ts:443-447 |
| Export ICC/profile classes (#180, #1281-adjacent) | Real ICC engine + raster export policy + PDF/X output intent | packages/engine/src/rasterColor/exportPolicy.ts:28-160; components/SpecPanel/export.ts:585-597; crates/varve-print/src/cmyk.rs:360-385 and test :906 |
| EXIF/metadata policy (#1617-1620, #1505) | explicit metadata policy end-to-end | packages/engine/src/metadata/policy.ts:35-81; metadata.test.ts:175-221; presets.test.ts:76-79 (sidecars/capture-time have no Varve mechanism ⇒ out-of-scope) |
| Persistence/recovery (#103, #227, #2124, #2129) | atomic native writes, autosave retry, recovery points, history tail recovery | apps/desktop/src-tauri/src/lib.rs:274-320; lifecycle/saveCoordinator.ts:29-76; autoSaveService.test.ts:123,228,296; history/__tests__/store-idb.test.ts:170,244 |
| Untrusted-import size (#2116, #2553, #2128-adjacent) | header gate before data-URL/decode + Rust allocation bounds + dimension-pre-checked trace | packages/import/src/rasterInspection.ts:5-7,42-100; crates/varve-media/src/limits.rs:9-56; import/src/service.ts:294, validation.ts:113; AGENTS.md Image Trace rule 4 |
| Linux menubar/focus (#189, #191) | in-window menubar, flyout dismissal, focus restore | tests/e2e/menus/visual-integrity.spec.ts:30-40; tests/e2e/menus/file-picker.spec.ts:33-56; docs/architecture/focus-navigation.md:204; platform/src/tauri.ts:135 |
| Keyboard/focus/number-input (#1435, #1669, a11y) | shared Dialog/FocusTrap, NumberField precision path, slider contract | packages/ui/src/components/Dialog.tsx; docs/architecture/slider-system.md; a11y e2e lane |
| Undo/history (#293, #735) | revision DAG, editor history session, recovery | packages/history/src/undo.ts:66-212; editorHistorySession.test.ts:165,477,503; history.test.ts:229,252 |

## Out-of-scope-with-reason (no Varve mechanism, or product boundary)

| Corpus class | Reason |
|---|---|
| Camera-RAW colour science / DCP / camera-specific rendering (#1281, #515, #860, #2112, #1343) | Varve is not a camera-raw developer. It has a bounded DNG/RAW-capability import path (docs/audits/photo-raw-hdr-capability-audit-2026-09-13.md) but no per-camera profile pipeline; adopting LightCraft's colour science is a different product, not a hardening change. |
| Lightroom catalog migration / photo-library DAM (#832, #1116, #1213, #1234) | Varve has no photo catalog; Home is a recents/projects surface, not a DAM. The transferable progress/cancel lesson is carried as F-3 class 7. |
| XMP sidecars / external-change conflict policy (#2603, #3175, #92) | Varve documents do not use XMP sidecars; its document store and recovery paths are separate. |
| File-operation undo of library moves (#1500, #2130) | Varve history is document-revision based; no library file-operation history exists. |
| Max-long-edge export mode (#1312 class) | Varve's scale model is multiplier/resolution/fit-to-box with explicit plan geometry; a max-long-edge mode is a feature request. |
| MCP/control-channel stalls (#1527, #2139, #181, #1405 automation root) | Varve has no MCP server; its LLM/CLI seams are covered by docs/architecture/ipc-type-contract.md and packages/cli. Silent-unknown-parameter and destructive-annotation lessons recorded in opportunities.md. |
| Flatpak cursor/packaging (#1657, #3048, #1833) | Varve's packaging is Tauri installers + website download; no Flatpak mechanism. |
| GPU-driver-specific crashes (#136, #315, #620, #783, #812, #1134) | Vendor/driver-specific egui/Vulkan defects; Varve has its own truthful GPU capability model (ADR-0237) and cannot inherit them. |
| Raw camera format coverage (#314, #525, #556, #769, #1404) | Codec coverage specific to a raw developer (see RAW reason above). |

## PR evidence

### PR #2491 — KDE Plasma Global Menu (evaluated in full; **not adopted**)

- Status: open **draft**, 2 commits, head feat/kde-plasma-integration → main,
  mergeable state dirty at read (rebaseable false), no GitHub Actions checks on
  the head (only a CodeRabbit review comment). +65,085/−10 across 239 files.
- Scope: ~99.9% is a vendored winit 0.30.13 tree (214 files; one additive safe
  WindowExtWayland::wayland_surface() accessor with provenance/hash in
  vendor/winit/CRAFT_PATCH.md), a new vendor/craft-desktop crate (~2.2k lines:
  DBusMenu transport, appmenu/wayland binding, appearance portal), ~130 lines of
  app/UI wiring, docs and Flatpak D-Bus permissions.
- Licence/provenance: handled correctly in the source PR (upstream MIT/Apache
  LICENSE/NOTICE retained; CC-BY-SA winit SVG assets removed after review).
  Copying is not the issue — fit is.
- **Varve verdict: do not port.** Varve's menu is a Tauri 2 + React in-window
  menubar (packages/editor/src/Menubar.tsx, apps/desktop/src-tauri/src/menu.rs);
  the egui/winit global-menu integration surface does not exist. Vendoring 65k
  lines conflicts with Varve's dependency and IPC conventions and creates a
  Tauri-upgrade maintenance cliff. No corpus issue references a global menu
  (0 hits), so product demand is not evidenced. Reusable ideas only: one menu
  model with two consumers, UI-thread action revalidation, modal guards, opt-out
  environment switch, provenance discipline.

### Linked / relevant PRs reviewed

- 133 issue-referenced PRs were evaluated (79 merged / 36 open / 18
  closed-unmerged); each is mapped to the issue it addresses and its merge
  state. No Varve code was copied from any PR. The only PR design that informs
  this slice is the conflict-policy direction visible in #1405/#93, which
  Varve's own ConflictPolicy model already declares.
- 45 fix/test PRs for the applicable classes were reviewed for what they change
  (conflict policies, atomic write, subfolder containment, import bounds, probe
  hard limits). Their status is not treated as proof of a shipped LightCraft
  release, and none is treated as a Varve fix.

## Coverage and limitations

- Inventory: 1,218 issues + 2,047 PRs at cutoff L1 (see scope.md).
- Review depth: 1,109 issues title-screened, 105 bodies read, 4 body+comments;
  2,046 PRs title-screened, PR #2491 body+review read. Applicable issue families
  were deep-read at their highest-severity clusters; remaining applicable issues
  keep an honest review_depth: title line and a body-signal triage reason.
- Comment threads: 31 fetched (175 comments), 4 read in depth; missing threads do
  not silently become no discussion.
- The corpus is not declared fully reviewed; continuation.md carries the
  remaining frontier and the exact next operations.
- No lightcraft maintainer was contacted, nothing was posted upstream, and no
  third-party attachment or code was copied.
