# Continuation record — lightcraft corpus hardening (Varve)

Last updated: 2026-10-28 (session 1). **Read this file first; it is the input for
the next run.** Refresh only the evidence the unfinished work needs.

## Frozen cutoffs, inventory and coverage

- **L1 (frozen):** 2026-10-28T17:10:57.432Z → 17:11:48.379Z UTC. Full state=all
  enumeration: 1,218 issues (627 open / 591 closed) + 2,047 PRs (1,058 merged /
  771 open / 218 closed-unmerged). Issues endpoint 33 pages / 3,265 records;
  pulls endpoint 21 pages / 2,047; reconciled against search totals
  (1,218 / 2,047) and the repository open_issues_count (1,398 = open issues +
  open PRs). Raw pages and per-page SHA-256 are in the gitignored cache
  reports/lightcraft-corpus/data/ (manifest.json); whole-file hashes are in
  docs/audits/lightcraft/inventory.summary.json.
- **L2 (reconciliation, declared 2026-10-28T18:00:20Z-18:00:24Z):** issues 1,219
  (+1), PRs 2,047 (unchanged). New arrival: **#3270** 'LightCraft 0.13.0–0.15.0 —
  two sharpness issues found comparing with Lightroom Classic' (created
  17:57:40Z). Follow-on queue only; L1 does not move. One existing issue was
  updated in the window (#3174) with no new-comment review performed; treat its
  thread as unread. Details: docs/audits/lightcraft/reconciliation-L2.json.
- **Coverage depth:** 1,218/1,218 issues and 2,047/2,047 PRs have an inventory
  row (title-level at minimum). Bodies read: 105 issues; body+comments: 4 issues;
  Lead deep-read this session: #93/#1405/#2571/#1944 (F-1 evidence) plus the
  #2491 PR body. Comment threads: 31 fetched / 175 comments, 4 read in depth.
  Applicable families are deep-read at their highest-severity clusters only —
  remaining applicable bodies are NOT claimed as read.
- **Remaining frontier (research):** finish body deep-reads for the applicable
  clusters listed by the screener (import 79 remaining of 93, crash 20/30,
  export 30/41, persistence 52/65, perf 62/71); read remaining comment threads
  for those; triage the 479 'uncertain' issue rows; classify the 2,046
  title-screened PRs only where a relevant class needs the fix/test evidence.
  Inaccessible: lightcraft GitHub Projects (400, token lacks project scope);
  attachments/screenshots not downloaded. Neither is evidence of absence.

## Findings by engineering status

| Finding | Status | Next action |
|---|---|---|
| F-1 desktop folder export overwrote existing files (P1) | implemented → validated at adapter boundary → independently reviewed → locally integrated (auto-merge pending/recorded below); native Tauri unverified; not released | native desktop check (below), then close or widen |
| F-2 wasm trace unchecked width*height*4 (crates/varve-wasm/src/lib.rs:211) | deferred (verified gap) | next slice brief below |
| F-3 folder-export cancel waits for the in-flight render/encode unit (exportService.ts:361) | deferred (partial gap) | design cancellation contract; medium slice |
| F-4 test/DX gaps: dialog e2e at 1366x768, native GTK/portal + GTK drop bridge, TOCTOU-free create_new reservation | deferred | small/medium QA slices |
| Already-handled classes (alpha/geometry, ICC, metadata policy, persistence, import bounds, menubar/focus, history) | recorded with proving files in findings.md | re-verify only if touched |
| Out-of-scope classes (camera RAW science, DAM migration, XMP sidecars, file-op undo, MCP server, Flatpak, vendor GPU crashes, raw codec coverage) | documented with reasons in findings.md | none unless product boundary changes |

## Completed commits and integration state

- Worktree: /home/kevina/CodingProjects/varve/.worktrees/lightcraft-hardening
  Branch: feat/lightcraft-hardening (base local master 1301951a7).
- Commits: 2c05a46f7 (fix + tests + CHANGELOG; pre-commit checkpoint passed — 20 direct
  tests, biome/docs/emoji/health/secret/import-boundary audits), the ledger
  commit containing this file, and an integration-record commit that follows the
  local master merge.
- Merge state: **not merged at the time of the ledger commit.** The local master
  merge is performed after this ledger is committed and its result (merge commit
  + revalidation) is recorded in the integration-record commit. Until that commit
  exists, treat this branch as integrated-at-branch only.
- Remote: **not pushed**. origin/master (varvedesign/varve, a771499b9) and local
  master diverged (local 486 ahead / 149 behind at baseline). Publishing would
  require reconciling history that belongs to other sessions; that decision is
  outside this task. Do not force-push, do not rewrite master.
- The main checkout remains dirty with other owners' uncommitted work. Never
  stage/revert/reset/stash it. This program's files do not overlap the dirty set
  (verified before merge).

## Ownership, dependencies, blockers

- Coordinator (Lead) owns the ledger and integration. Batch 1 files:
  packages/editor/src/exportSaveAdapter.ts (+test),
  packages/editor/src/exportDestinationConflict.test.ts,
  packages/scene/src/export/naming.ts (one keyword export, size frozen at 431),
  CHANGELOG.md, docs/audits/lightcraft/*.
- Frozen files deliberately untouched: packages/editor/src/exportService.ts
  (791), packages/editor/src/components/Shell/ExportLayer.tsx (556). Any future
  change there must not grow them; split first.
- Blockers: (a) native Tauri desktop run not possible on this host session
  (memory ~1 GB available, disk ~5 GB free); (b) full verify:affected not run
  under host load — Tier-2 unit lanes were started and are recorded below;
  (c) remote PR path blocked on the master/origin divergence above.
- Machine sharing: other sessions hold other worktrees and heavy-lease jobs.
  Never reclaim a live lease; use the heavy-lease wrapper for Playwright.

## Last verified state and exact next operation

- Last verified: worktree HEAD 2c05a46f7 (code) plus this ledger commit; changed
  files typecheck editor:0, scene:0, apps/desktop:0; focused conflict suites 70
  passed; pre-commit checkpoint passed (20 direct tests + staged biome, docs,
  emoji, health, contact, secret-scan and import-boundary checks); negative
  control 3 of 4 failed pre-fix; radius audit clean; verify:plan = 38 lanes, no
  escalation. The Tier-2 package unit lanes (vitest packages/scene packages/editor)
  were started; their final result is recorded in the integration-record commit.
  apps/website typecheck was not run through its package script (astro check); a
  direct tsc invocation is not equivalent and only surfaced pre-existing
  Astro-generated-type errors in untouched website files.
- **Exact next operation:** run the native desktop check of the folder-write
  path, then F-2 (below), then F-3. To reproduce this session's environment:
  1. Worktree dependencies are hardlinked from the main checkout (pnpm install
     fails because the DSH sandbox makes $HOME read-only; pnpm store locks live
     there). If they are missing: cp -al node_modules, packages/*/node_modules,
     apps/desktop/node_modules, apps/website/node_modules from the main checkout.
  2. Run tools directly: node node_modules/vitest/vitest.mjs run <files>
     --reporter=dot ; node node_modules/typescript/bin/tsc -p <pkg>/tsconfig.json
     --noEmit --pretty false ; node scripts/audit-*.mjs ;
     node scripts/quality/verify.mjs plan.
  3. Native desktop (not executed): cargo build the desktop app in the worktree
     with CARGO_TARGET_DIR pointed at a workspace path, run it under a native
     Wayland/X11 session, export a batch to a folder that already contains one
     output, and confirm the old file is byte-identical and the new file is
     name-2.ext with a truthful results list. Record OS/backend/build.

## Next slice brief — F-2 (small, high value)

**Target:** crates/varve-wasm/src/lib.rs:211 (unchecked width*height*4 product
before the pixels.len() check), plus a parity guard test. LightCraft evidence:
#2138, #2569, PR #2180.
**Acceptance criteria:**
1. A (width,height) pair whose width*height*4 overflows u32/usize is rejected
   with an Err before any slice/index, using checked u64 math.
2. Zero dimensions rejected; a buffer whose length is smaller than
   width*height*4 is rejected with a typed error, not a panic/abort.
3. Valid in-range input still traces (existing behaviour unchanged).
4. Unit test lives in crates/varve-wasm (cargo test -p varve-wasm) and fails
   against the current code; note the release profile has no overflow-checks,
   so test the checked arithmetic directly rather than relying on debug panics.
**Validation:** cargo test -p varve-wasm; cargo check -p varve-wasm --target
wasm32-unknown-unknown if target/toolchain available; keep other crates untouched.
**Files:** crates/varve-wasm/src/lib.rs (+ its test module or adjacent test file).

## Follow-on queue (late arrivals, not in L1)

- Issue #3270 (sharpness vs Lightroom Classic comparison, created 2026-10-28
  17:57:40Z): camera-raw sharpening parity class. Screened as out-of-scope
  unless Varve's RAW/DNG path claims comparable development; needs a body read
  before any disposition is final.
- Issue #3174 was updated in the L2 window; its thread was not re-read.
