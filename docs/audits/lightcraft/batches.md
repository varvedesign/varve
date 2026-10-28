# Batches — lightcraft corpus hardening program

One record per reviewable slice. Each batch: research → reproduce → fix →
validate → review → document → commit → integrate, then a continuation record.

## Batch 1 — Desktop folder export: destination conflict safety (F-1)

**Dates:** 2026-10-28 (session 1). **Cutoff:** L1 (see scope.md).
**Branch/worktree:** feat/lightcraft-hardening in .worktrees/lightcraft-hardening,
based on local master 1301951a7.
**Corpus evidence:** lightcraft #93 (closed), #1405 (open), #2571, #1944 — export
writers replacing existing files without applying the declared conflict policy.
**Varve class:** data loss / output integrity. **Priority:** P1.

### Research and reproduction

- Enumerated the full corpus (1,218 issues + 2,047 PRs) and screened it; the
  write-target/overwrite class is H1 in the screener's transferable-class list.
- Traced the Varve desktop export path: ExportLayer.tsx:355 →
  exportSaveAdapter.ts:138 (pre-fix) → platform/tauri.ts:789 →
  apps/desktop/src-tauri/src/lib.rs:399-423 → write_file_atomic. No destination
  existence probe existed (git grep at base: zero hits in editor/scene export).
- ConflictPolicy is declared (scene/export/model.ts:314) and hardcoded to rename
  in the dialog, but resolveCollisions only handled intra-batch names.
- Reproduced in Varve: a real-filesystem regression drives ExportService with the
  real folder save adapter; against the pre-fix adapter 3 of 4 cases fail
  (existing file replaced / sibling replaced). Negative-control run is recorded
  below; the fix is restored afterwards (grep: 3 probeDestination occurrences).

### Implementation

- packages/editor/src/exportSaveAdapter.ts — createExportFolderSaveFile now
  probes the destination (tri-state: free/occupied/unknown via platform.fileExists),
  picks the first free appendSuffix name, and fails closed with a clear error
  when a probe cannot answer (first or mid-loop). The native atomic write and
  Rust folder containment are unchanged. The adapter reflects the written entry
  back into job.fileName only for the job's own output.
- packages/scene/src/export/naming.ts — appendSuffix exported (line count stays
  431; frozen baseline respected); no other change.
- packages/editor/src/exportDestinationConflict.test.ts — new real-filesystem
  regression over ExportService + the real adapter: existing file kept, planned
  name collision between jobs, free folder, multi-file sibling rename.
- packages/editor/src/exportSaveAdapter.test.ts — unit coverage for consecutive
  occupied suffixes, free folder, sibling non-retitle, fail-closed probe
  (first and mid-loop), POSIX-root/trailing-separator/Windows probe paths, and
  probe-budget exhaustion.
- CHANGELOG.md — Unreleased/Fixed entry.

### Validation (evidence, including what did not run)

Ran in the worktree with hardlinked node_modules and direct binaries (the DSH
sandbox makes $HOME read-only, so pnpm store locks/queue are unavailable;
VARVE_VALIDATION_QUEUE=0 equivalent = direct node invocations):

| Check | Command (abridged) | Result |
|---|---|---|
| New + adjacent unit tests | vitest run exportSaveAdapter/exportDestinationConflict | 20 passed |
| Adjacent export suites | vitest run naming/exportService/exportBatchPaths/ExportDialog/ExportResultsList/DestinationPicker | 92 passed |
| Focused conflict suites after review fixes | vitest run exportSaveAdapter/exportDestinationConflict/naming/exportService | 70 passed |
| Negative control (pre-fix adapter) | integration test on reverted factory | 3 of 4 failed (expected), fixed code restored |
| Typecheck | tsc -p packages/scene, packages/editor, apps/desktop, apps/website | scene 0, editor 0, desktop 0, website 0 (rerun after final edits: editor 0; desktop/website results recorded in continuation) |
| Dependent package typechecks | tsc -p for ai, cli, codegen, collab, history, home, import, layout, print, prototype, ui | all 0 (desktop/website initially given a wrong path, rerun with apps/ paths) |
| Lint/format | biome check on the four changed code files | clean (exit 0) |
| Docs gate | node scripts/audit-docs.mjs | clean (1,289 docs, 998 links, 183 ADRs) |
| Emoji gate | node scripts/audit-emoji.mjs | clean (5,560 files) |
| Import gate | node scripts/audit-committed-imports.mjs | clean (12,805 imports) |
| Radius audit | node scripts/quality/audit-radius.mjs | clean |
| Verify plan | node scripts/quality/verify.mjs plan | Tier 2/3, 38 lanes, full-suite escalation NO |
| Affected Tier-2 unit lanes | vitest run packages/scene packages/editor | did **not** complete after ~30 min under host load (started twice, stopped); deferred to CI — focused/adjacent suites and the pre-commit checkpoint passed |
| Integrated candidate revalidation | merged master bcff6aed4: focused vitest 20/20 + editor tsc | passed |

**Not run / outstanding:**
- Native Tauri desktop execution of the real folder write (would need a cargo
  build/launch; host had ~1 GB available and 5-6 GB free disk). The
  adapter-boundary test uses the real filesystem and the same platform contract;
  this is explicitly not native-app evidence. Exact repro steps are in
  continuation.md.
- Browser Playwright lane: the folder-write sink is Tauri-only; browser exports
  use the ZIP/download sinks that this change does not touch, so no browser spec
  exercises it. Not claimed as browser-validated.
- Full verify:affected (all 38 lanes) and full gate: not run (host limits; no
  escalation trigger in the plan).

### Review

- Separate reviewer agent (not the implementer), report at
  reports/lightcraft-corpus/research/reviewer/review.md (local, gitignored).
  Verdict: no blocker in the approach; three major findings, all addressed:
  evidence-chain overclaim (status corrected; batches/continuation created),
  #1405 inventory depth (Lead deep-read overrides), sibling rename reporting
  (documented limitation + real-FS test rather than widening into frozen files).
  Minors fixed: tri-state fail-closed probe, scoped wording, Windows/root/trailing
  probe-path tests, budget-exhaustion test, stray artifacts excluded from commit.

### Docs and site impact

- CHANGELOG.md updated (user-facing behaviour change).
- No website change: the export pages describe format capability, and no site
  claim became false. A 'no overwrite' sentence should ship with a desktop/mobile
  visual pass of the FAQ/export pages; recorded as a justified no-change decision
  in opportunities.md §18.
- No ADR: this completes the declared conflict policy for an existing write path;
  no architectural decision changed.

### Integration state

- Commit/worktree/merge refs: 2c05a46f7 (code), 0e3bcb942 (ledger), bcff6aed4 (local master merge; parents 1301951a7 + 0e3bcb942). Remote not pushed; continuation.md is the authoritative state file. (The authoritative-state sentence continues below.)
  state file) because this batch record is committed with them.
- Remote: not pushed. Local master and origin/master have diverged (486 local /
  149 remote commits at baseline); publishing this slice as a remote PR requires
  a separate history reconciliation decision, recorded as a blocker.
