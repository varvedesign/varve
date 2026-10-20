# Photocraft review continuation

Last updated: 2026-10-19. Status: active and incomplete.

## SVG embedded raster budget follow-up (2026-10-19)

- PhotoCraft #6105 is tracked as F-025. Varve now inspects embedded SVG raster
  headers before renderer decode and admits distinct sources under the existing
  64 MP per-image and per-SVG decoded-pixel limits. Repeated data URLs are
  charged once, and animated images are charged by canvas pixels times frame
  count. Unsupported filters and patterns remain explicitly dropped; this
  change does not implement PhotoCraft's raster fallback pipeline.
- Commit `8a21a5119` contains the implementation, security regressions, import
  architecture note, and updated issue record. Focused SVG security tests (19),
  importer typecheck, the importer suite (416 tests before a final constant
  source cleanup), format/lint, docs/emoji/token audits, E2E typecheck, and
  editor typecheck passed. The final `pnpm verify:affected` stopped at the
  existing desktop type error in `packages/editor/src/collab/CollabSurfaces.tsx:450`
  (readonly `Affine` cast); later unit and browser lanes did not run through the
  affected runner. The required import E2E and screenshot inspection remain
  pending because another worktree's live canvas E2E process holds the shared
  heavy-task lease. No browser test was launched, and the implementation must
  remain unverified for visual integration until that check passes.
- The current marketing site has no SVG image-count, raster-fallback, or
  resource-limit claim. No site change is indicated. Continue with the next
  unresolved source batch while preserving the visual check as an open item.

## Native save follow-up (2026-10-19)

- PhotoCraft #6602/#6603/#6606 now have an implementation batch in F-022.
  Explicit user-selected save/export targets reject missing parent folders;
  app-managed writes retain their separate create-parent policy. Saves refuse
  multiply linked targets on Unix and Windows with Save As guidance. Linux
  copies xattrs (including POSIX ACL xattrs) within fixed bounds, macOS uses
  `copyfile(COPYFILE_METADATA)`, and Windows uses `ReplaceFileW` with a sibling
  rollback backup. The stale staging sweep recognizes abandoned backup files.
- The Windows API documentation notes failure outcomes that can leave the
  target at the backup name; implementation now attempts restoration before
  returning an error. The same docs say the final replacement file ID is the
  replacement file's ID, so hard links are refused on Windows too rather than
  assuming `ReplaceFileW` preserves aliases.
- Focused Linux Tauri tests pass: atomic-write tests (11), explicit-save tests
  (2), including hard-link refusal, missing folder refusal, xattr, and ACL
  regressions. The platform `saveTargets` test passes (14). Windows and macOS
  target snippets compile in isolation, but full desktop cross-builds and
  native runtime checks are blocked by missing platform SDK/linkers on this
  Linux host. NTFS ACL/alternate-stream and APFS Finder-tag/creation-time
  runtime evidence remains required before full cross-platform closure.
- No website change is indicated: Varve makes no public promise about hard
  links, filesystem metadata preservation, or missing-folder save behavior.
  F-022 and `filesystem-boundary.md` record the concrete behavior.
- Progressive implementation checkpoint: commit `2aae14eec` contains the
  native save changes and F-022. Focused Rust atomic-write tests (11) and
  explicit-save tests (2), platform `saveTargets` tests (14), platform
  typecheck, Rust formatting, docs/emoji/token audits, and the staged commit
  checkpoint passed. Windows replacement/hard-link snippets cross-compile in
  isolation; full desktop Windows and macOS builds/runtime tests remain
  unavailable. The desktop package typecheck was interrupted after roughly
  three minutes under shared memory pressure, before a result.
- `pnpm verify:plan` selects 43 lanes and reports `FULL-SUITE ESCALATION: YES`
  because the planner classifies the desktop target dependency change as a
  workspace/toolchain change. `pnpm verify:affected` stops at that escalation
  before executing lanes. `pnpm verify:full` was attempted with a stated
  reason, then refused because hosted certification requires a clean,
  committed `master` candidate. Full-gate certification remains deferred until
  the integration candidate. Do not count this batch as fully validated.

## Save-memory follow-up (2026-10-19)

- PhotoCraft #6607's report prompted measurement before choosing a serialization
  change. A local Node probe encoded a Varve document with a 16 MiB embedded
  image: encoded JSON was 21.3 MiB, RSS delta after encode was 33.6 MiB, and
  peak RSS delta was 58.2 MiB. This isolates `DocumentCodec.encode`; it is not a
  full Tauri save/recovery/PSD-export measurement.
- The native external-change check previously loaded the existing document text
  over IPC while the new serialized JSON was resident, only to hash it. A
  64 KiB streaming native hash now returns the existing JS-compatible hash and
  avoids that old-text allocation and IPC transfer. The serializer and atomic
  writer still hold the new document as whole buffers, so #6607 is partially
  addressed and more format/backend profiling is required.
- `pnpm verify:plan` selected 44 lanes and 79% of test files; full-suite
  escalation was NO. `pnpm verify:affected` passed touched format/lint plus
  emoji and docs audits, then stopped at `audit:radius` with 10 existing raw
  radius consumers in untouched Presentation/SpecPanel styles. Later lanes did
  not run through that command. `pnpm audit:tokens` passed all 324 contrast
  pairs across three themes and the token-usage scan.
- `pnpm exec vitest run
  packages/editor/src/context/__tests__/saveTargetCollision.test.tsx
  packages/platform/src/tauri.test.ts` passed 35 tests after adding unsupported
  hash fallback coverage. Focused Rust hash tests passed 2/2 with `cargo test
  --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
  filesystem::tests::streamed_text_hash -- --nocapture`. The full platform
  package typecheck and tests previously passed (330 tests / 25 files). The
  editor typecheck was interrupted after roughly three minutes at about 2.9 GB
  RSS; editor unit tests in that chained command did not run. No full visual
  validation applies to this backend-only change. No marketing performance
  claim was found; website changes are not indicated. Progressive checkpoint:
  commit `ac7c9b4d6`; staged commit checks passed, while affected closure and
  editor typecheck remain incomplete as recorded above.

## Malformed-settings follow-up (2026-10-19)

- PhotoCraft #6611 is not an exact Varve reproduction: a wrongly typed scalar
  is not decoded as one all-or-nothing preferences struct in Varve, but its
  generic `mergePartial` used to accept the malformed value and pass it through.
  Non-null-default fields now fall back independently on runtime type mismatch;
  a regression covers a string autosave interval alongside valid language,
  units, and dark-theme settings.
- Reviewed PhotoCraft PR #6641's full patch. At the frozen cutoff it was open; a
  live API check on 2026-10-19 found it merged at `5e1d90d86e62dd5d969f7f454cbc8d25628692a2`.
  It reports invalid paths and repairs the file while preserving unknown keys.
  Its own description says it has no bad-file backup, untranslated notices, and
  no hand testing in desktop/web. Varve's current change does not yet notify or
  rewrite localStorage, and does not validate nullable fields, enum values, or
  nested object members. F-024 records this as partial hardening, not parity.
- Reviewed `apps/website/src/pages/docs/settings.astro`: it describes controls
  without promising malformed-preference recovery. No website copy change is
  justified. `pnpm exec vitest run packages/editor/src/settings.test.ts` passed
  29 tests; `pnpm typecheck:e2e` passed. `pnpm verify:plan` selected 12 lanes
  with no full-suite escalation. `pnpm verify:affected` passed touched
  format/lint and emoji/docs audits, then stopped at the same 10 pre-existing
  radius-token findings in untouched Presentation/SpecPanel styles. The planned
  settings E2E is queued behind an active `e2e:canvas` lease in another worktree;
  it has not started yet. Full editor package typecheck/tests were not reached.
  Progressive checkpoint: commit `86c55936e`; the staged commit checkpoint
  passed the 29-test settings file and docs/emoji/health/import-boundary checks.

## Current follow-up batch (2026-10-19)

- PhotoCraft #6962's post-cutoff author update confirms that its System Title
  Bar workaround avoids the black return-from-minimize screen while retaining
  GPU acceleration. Linked reports #2687/#2339 and #2850/#2246 trace related
  symptoms to Windows custom-frame behavior, but #3810 is a separate mixed-DPI
  issue and the AMD drag-performance report is separate from window chrome.
- PhotoCraft #2340 is now covered by a browser regression for Ctrl+Tab and
  Ctrl+Shift+Tab cycling, including wraparound in both directions. The test is
  committed as `28f49c9f3`; touched-file formatting/lint, E2E typecheck, and
  the commit checkpoint passed. The affected E2E lane could not acquire the
  shared heavy-task lease within 30 minutes, so browser behavior and its
  screenshot remain unverified. Keep #2340 as a candidate until the focused
  Chromium run passes; the test must be rerun after the live canvas lease
  clears.
- Varve already resolved native Windows/macOS chrome in `@varve/platform`, but
  the shared Tauri config disabled decorations globally. The shared config now
  enables them; `tauri.linux.conf.json` keeps Linux custom chrome. F-020 and
  [linked-window-chrome-evidence.md](linked-window-chrome-evidence.md) record
  the evidence, scope, and website no-change decision.
- Validation so far: `pnpm verify:plan` escalated to the full gate because the
  desktop target config was classified as workspace/toolchain infrastructure;
  `pnpm verify:affected` correctly stopped and directed to that gate. `pnpm
  audit:docs`, `pnpm audit:emoji`, JSONL parsing/unique-ID checks, and direct
  config-entry checks pass. Native Linux/Windows app visual validation has not
  run; the exact Windows minimize/restore path requires a Windows target. The
  host filesystem has about 5.3 GB free at the latest check. The
  separate read-only review found no actionable issues. Windows build and
  native minimize/restore visual validation remain required before calling
  F-020 fully verified. The public site makes no title-bar or driver-specific
  claim, so no website edit is indicated.
- `a9d358199` commits the platform-specific Tauri decoration configuration.
  Its exact-SHA local full gate passed format/lint, audits, health and
  architecture checks, all workspace typechecks, and E2E typecheck. The
  remaining lane then waited for a shared visual E2E lease until the wrapper's
  10-minute deadline. Because this branch advanced while it waited, the gate
  rejected the stale lane receipt and exited nonzero; the full gate is
  **incomplete**, not passed. Rerun at a frozen exact SHA after the live lease
  clears.
- This turn compared PhotoCraft #3804/#3806/#6596/#6597/#6599/#6600/#6604/
  #6605/#6613/#6740 against Varve effect, rasterization, format, save, export,
  atomic-write, and paint-lock contracts. #3804 is an adjacent design lead;
  #3806 and #6599 have no matching workflows; #6740 and #6596/#6597 are
  covered by existing guards and focused tests; #6600/#6604/#6605 pass 9
  focused Tauri atomic-write tests; and #6613 passes 21 export-service tests.
  The editor save-target regression passes 11 tests, including the newly added
  external-edit refusal case. Counts in the issue ledger and README reflect
  these dispositions. Public export docs already describe the desktop
  dialog/browser download; no marketing copy change is needed.
- For the new #6596 regression, `pnpm verify:plan` selected its focused editor
  test plus format/lint and audits. `pnpm verify:affected` passed touched-file
  format/lint and emoji, then stopped at the existing radius audit's ten raw
  radius consumers in untouched Presentation/SpecPanel files. The directly
  selected `saveTargetCollision.test.tsx` passed all 11 tests. Record the
  affected closure as incomplete; no CSS changed in this save-path batch.
- Next: rerun the #2340 browser test after the live lease clears, finish the
  queued full gate, run Windows-native build/minimize/restore
  visual validation when a Windows target is available, continue recursive
  source/PR review, then complete final independent review and safe integration
  to `master` without touching the dirty primary checkout.

## Current engineering batch (2026-10-18)

- PhotoCraft #5195/#5211: Varve native fill lowering now includes the emitted
  cover quad in its vertex budget. Variable-width canvas stroke expansion uses
  endpoint-only sampling for straight segments, caps outlines at 65,536
  samples, caps dashed expansion at 16,384 on-runs with a pressure-aware solid
  tail, and bounds pathological dash-pattern length. Focused engine unit tests
  pass (5 tests); the native cover-quad regression passes (1 Rust test).
  `pnpm --filter @varve/engine typecheck` passed, as did focused engine tests,
  Rust tests/clippy, and Biome checks. Independent review found that dash
  splitting rescanned the full sample list for every run and that patterns over
  128 entries lost their dash. Both are fixed: sample traversal now advances a
  shared cursor, distance lookup is logarithmic, and long patterns fall back to
  native dashed centerline replay. A second review caught a zero-width/tiny
  dash loop that escaped the run cap; a 32,768-step cap now sends unproductive
  patterns to native dashed replay. These review repairs are committed as
  `7d3e0bc87` and `0e21e9a89`. The focused engine bounds suite now passes all
  five tests, the full `varve-accel` library suite passes 51 tests, and clippy
  passes. The independent review-agent's final pass found no actionable defect
  in the committed stroke changes or current editor changes. The real-browser
  visual fixture now shows the preserved dashes clearly and passes
  baseline generation plus clean comparison at 1×, 2×, and 3× DPR. The 1×–3×
  snapshots are in `tests/e2e/visual/replay.spec.ts-snapshots/`. The
  source fix in PhotoCraft PR #5204 was read; it also covers large coordinates,
  which this Varve change does not fully match. Website review found no
  affected marketing claim.
- PhotoCraft #2826: Clone Stamp now accepts Ctrl/Command-click as an alternate
  source gesture alongside Alt-click, addressing the reported Cinnamon
  window-manager conflict. Focused unit coverage passes (8 tests), and
  `pnpm typecheck:e2e` passes. The targeted real-browser pointer E2E passes
  using Ctrl-click, and its target-safety screenshot was inspected and retained
  as `evidence/clone-stamp-control-click.png`. Chromium verifies app event
  handling but cannot reproduce Cinnamon's OS-level interception. No marketing
  copy change is indicated.
- PhotoCraft #3093: locked selections hide gradient handles and the drag path
  rechecks the latest lock state before mutation. A pointer regression covers
  unlocked movement and lock-mid-drag behavior. E2E typecheck and the targeted
  real-browser test pass. The inspected lock-mid-drag screenshot is retained
  as `evidence/gradient-locked-during-drag.png`. A first standard Playwright
  retry stalled in shared `global-setup.ts`; the successful targeted run skipped
  only that shared warm-up and exercised real Chromium navigation, editor DOM,
  pointer events, and persisted document state.
- The latest `pnpm verify:plan` selected 16 lanes for the editor changes and
  visual fixture; full-suite escalation was NO. The required
  `pnpm verify:affected` run stopped at the pre-existing
  `audit:radius` failure: ten raw-radius consumers in untouched Presentation,
  SpecPanel, and other files. It did pass touched-file format/lint and the
  emoji/docs audits before stopping. Targeted engine bounds tests pass (5),
  `@varve/engine` typecheck passes, and all 51 `varve-accel` library tests plus
  clippy pass. Clone Stamp and Save As focused tests pass (18 total), editor
  typecheck and E2E typecheck pass, and token audit passes (324 pairs, 3
  themes). Desktop typecheck remains blocked by the
  existing untouched `CollabSurfaces.tsx:450` readonly `Affine` cast error.
  A dedicated visual fixture for a variable-pressure path with a >128-entry
  dash pattern passes at all three DPRs. Clone Stamp and locked-gradient pointer
  E2Es pass; screenshots were inspected. The current E2E typecheck passes.
  The latest `pnpm verify:affected` passed touched format/lint, emoji, and docs
  checks, then stopped on the same pre-existing radius audit findings.
  Package-wide JS unit lanes remain
  outstanding. Do not report the affected closure as passed.
- Progressive commits: `dd5120f28` (native fill cover-quad budget),
  `a4aca5e53` (bounded variable-width stroke expansion), `7d3e0bc87` (linear,
  pattern-preserving dash fallback), and `0e21e9a89` (cap unproductive dash
  traversal), and `13a3f67b6` (Clone Stamp modifier fallback and gradient lock
  guard), `d5b396986` (pending crop session regression and visual evidence), and
  `37c6458cd` (#1015 source comparison and partial disposition). The independent
  read-only review found no actionable findings in
  those editor changes. The real-browser crop session regression is now added:
  the complete crop pointer spec passes 14/14, including New-tab cancellation,
  crop commit, cancel, undo and redo. The new-tab case confirms the pending
  crop rectangle changed before switching and that Enter leaves the new
  document's serialized state unchanged. The 1280×721 new-tab screenshot was
  inspected and retained as `evidence/crop-cleared-on-new-tab.png`. The first
  affected run failed before Chromium because the root filesystem was full; a
  retry passed after space returned (4.4 GB available). Crop commit logs the
  existing development warning for `updateDoc` outside a transaction; the
  same browser run verified crop undo/redo. Direct file-open and tab-switch
  routes use the same session-sync branch but were not separately driven.
  PhotoCraft #1015 is now source-compared as a partial match: its reported GPU
  OOM-to-whole-document-CPU fallback does not exist in Varve's Canvas2D-first,
  simple-shape-only GPU path. Its large-raster low-zoom cost does map to the
  still-open, independently measured ADR-0214 pyramid; synchronous Transform
  Pixels commit is bounded but remains unprofiled at the admitted limit.
  Upstream PRs #1427, #4218, #5590, and #6800 were read as separate fallback,
  cancellable-transform, Warp, and speed improvements. No website performance
  claim needs a change. Issue #1101 is also confirmed covered: adjustment
  normalization repairs a NaN exposure value before serialization, and the new
  DocumentCodec save/decode regression passes (15 tests in the focused file).
  PhotoCraft #478's controlled device-loss report maps to existing Varve
  behavior: the visible canvas is Canvas2D, loss requests an authoritative
  redraw, and focused WebGPU/lifecycle tests cover the recovery path. The
  browser suite does not yet destroy a real device and compare pixels, so this
  is a source-traced covered disposition, not an end-to-end reproduction. No
  marketing claim needs revision. PhotoCraft #1540 is now a partial match:
  Varve's Windows/Linux startup args are forwarded through Tauri's single-
  instance plugin into the existing file-open queue, with a relative-path
  regression added and Linux requesting taskbar attention for Wayland. The
  focused native test build was stopped when root free space fell to about
  826 MB, before it reached the test executable. Free space has since risen to
  about 974 MB, still below a safe native build margin. Independent review
  caught a startup race where activation could be lost before the main window
  exists; the code retains and retries the request on Tauri `Ready`. A fresh
  source review found a second edge where failed focus could consume the
  request; the latest code only acknowledges activation after a successful
  focus or Linux attention result. The updated unit case checks that a failed
  attempt leaves the request pending. A read-only review of the latest diff
  found no further actionable issue. Neither the native test nor the full
  callback-to-`Ready` lifecycle has run yet.
  Linux package-level visual validation and Windows launch validation are
  still pending. The desktop
  TypeScript check hit the previously documented unrelated
  `CollabSurfaces.tsx:450` readonly `Affine` cast. The issue remains partial
  until native validation is completed. Website copy does not claim this
  behavior. PR #2358 and #3755 discussions were reviewed as linked evidence.
  Validation: `pnpm verify:plan` selected touched format/lint, docs/emoji,
  desktop typecheck/unit, and desktop-native lanes, and escalated to the full
  gate because of the Cargo manifest change. Rustfmt and `git diff --check`
  passed; `pnpm audit:docs` and `pnpm audit:emoji` passed. The required full
  gate, affected JS/native lanes, and packaged visual checks have not run due
  to insufficient disk headroom; no implementation commit for #1540 has been
  made. Documentation-only evidence checkpoints are committed. The ledger is now 222 candidates / 453 partial matches / 28 covered.
  Safe integration to `master` remains outstanding. A clean-snapshot merge
  preview succeeded, but the real dirty master checkout rejected the merge
  because unrelated local edits and untracked files overlap paths touched by
  this branch; no master worktree changes were made.

## Source boundary

- Repository: `storytold/photocraft`, issue tracker (not `storytold/pdfcraft`).
- First frozen cutoff: 2026-10-17 10:08:14 UTC; crawl interval 10:07:24–10:08:14 UTC.
- Frozen set: 3,275 issues and 3,683 PR records over 70 fully paginated REST
  pages; 4,900 issue-comment count reported by the issue records.
- First crawl cache and checksums: see `README.md`; raw issue/comment responses
  live only under the task cache paths recorded there.
- All 3,275 issue comment endpoints were subsequently retrieved through every
  page from 10:29:00–10:31:14 UTC; 0 request failures. The retrieval cache is
  at `/home/kevina/.cache/codex/photocraft-2026-10-17/comments/`. Retrieval and
  source reading are complete. The row-level Varve comparison pass is complete
  except for 4 explicitly `unclear` issues; those retain uncertainty reasons
  instead of being counted as excluded. Recursive link review and relevant PR
  discussion review remain incomplete.
- Latest observed update at crawl: 2026-10-17 09:59:48 UTC.
- Second declared cutoff B: 2026-10-17 10:33:10 UTC, observed over 70 pages
  from 10:32:24–10:33:10 UTC. It contains 3,278 issues and 3,686 PRs; cutoff A
  contained 3,275 issues and 3,683 PRs. No issue removals; new issues #6962,
  #6964, #6965; changed issue #6400 gained a post-A comment; #6392 changed body
  bytes without a changed `updated_at`. All five changed/new discussions were
  refreshed. Reconciliation details are in the audit JSON and delta JSONL.
- Pull-request records are separately inventoried: 3,683 at A and 3,686 at B.
  Three new PRs were added at B; 14 existing PR records changed body or
  metadata. PR descriptions/discussions have not been comprehensively reviewed.
  Reviewed linked exceptions include #2358/#3755, #3843/#5859/#6186,
  #5753/#5831, #6863, and numeric-boundary fixes #4182/#4202; the remaining PR
  inventory is still unreviewed.

## Progress snapshot

- Issue source reading: all 3,275 cutoff-A issue bodies and discussions have
  now been read in inventory order. The ledger has 3,275 complete source-read
  rows, zero pending cutoff-A rows. Coverage includes #181–#1100 (426 issues,
  496 comments), #1101–#2199 (491 issues, 899 comments), #2203–#3298 (502
  issues, 776 comments), #5002–#6000 (490 issues, 672 comments), #3301–#5000
  (775 issues, 1,208 cutoff comments), #6004–#6960 (512 issues, 786 comments),
  and prefix #1–#180 (79 issues, 101 comments). The row count includes 13
  previously completed records in other slices; one overlaps the original 17
  records. Three comments on #3958, #4366, and #4879 arrived after the frozen
  cutoff and were also read; they are excluded from cutoff counts. All five
  changed/new cutoff-B records were also read. #6962's cutoff-B body was
  missing from the local delta/cache and was recovered from the live page; the
  other four full bodies were likewise recovered from live pages because the
  compact B cache stored only deltas. Their exact historical body bytes are
  unavailable; post-B events were excluded. The cutoff-A issue inventory has
  zero `unassessed` rows, 4 `unclear` rows, and 3,271 completed dispositions.
  Cutoff-B delta review, recursive linked evidence, and relevant PR discussions
  remain in progress; “complete” here records source reading, not completion of
  those separate reviews.
- Pull requests: the 3,683 A records and three B additions are inventoried,
  but descriptions/discussions have not been comprehensively reviewed. Linked
  transform evidence is now reviewed for #3843, #5859, and #6186. PR #5859's
  discussion exposed false-positive test fixtures and a real history-order
  defect; PR #6186 records the asynchronous commit-cancellation root cause and
  remains open at cutoff B. Numeric overflow PRs #5753 and #5831 were also
  reviewed: both remain open as competing fixes, with review noting malformed
  non-array phase remains ignored in #5753. PR #6863's full body and timeline
  were reviewed; it remained open with one commit and no reviews at cutoff B.
  These reports do not establish PhotoCraft's exact save-corruption path in
  Varve's f64 model. The adjacent native GPU f64-to-f32 admission defect found
  from #6424 is implemented; the dependent desktop test lane remains pending.
- Link frontier: #1101; #6392's
  #3641 / SolidCraft evidence; #6962's #2850/#2339/#2687; #6964's #3384/#6669;
  #2784's inspected video symptoms and remaining Varve workflow ambiguity; and all relevant
  links not yet enumerated from the corpus.
- Varve batch A: decode boundary, expression overflow, invalid open preservation,
  docs, unit tests, and Playwright visual test are implemented. The focused
  editor/scene run passed 111 tests; codegen passed 16 tests. The real Inspector
  Playwright test passed, and screenshots are retained under `evidence/`.
  The first clean-SHA full local gate passed typechecks, architecture, health,
  CI tooling, and WASM lanes, but Vitest found two existing failures: the
  screenshot-policy test reported six literals in other specs, and the
  presentation demo fixture is stale. A second exact-SHA gate after Batch B
  reproduced those and found the selection-refinement benchmark just over its
  timing ceiling under full-suite load. The benchmark passed alone under the
  heavy-task lease (6.95s total; 3.44s for sigma-16 feather), so it is recorded
  as contention-sensitive, not a regression from Batch B. See Validation.
  A code-review
  finding for `__proto__` node IDs was fixed in a separate codegen commit. Prerequisite
  commits restored `packages/scene/src/nodeResize.ts` and
  `packages/codegen/src/bundle-assets.ts`, both already imported/exported by
  committed modules but missing from the clean base. The latter blocked the
  first browser boot; the first editor-provider test attempt also hit full
  `/tmp` tmpfs before its test could load.
- Website: current public claims reviewed; no change justified for this
  unreleased correctness fix.
- Issue range #1101–#2199: full body/comment review is complete for 491 issue
  records and 899 comments; reported comment counts match. High-signal
  verification leads include multi-GB save responsiveness (#2017), ensuring
  every browser export path reaches its download sink (#1700), truthful dirty
  state after successful saves (#1547), and pointer-to-painted-frame latency
  diagnostics (#1343). The reported recovery-startup blocker (#2070) does not
  appear to transfer because Varve lists recovery asynchronously and restores
  only after user action. The SMB durability report (#1336) has unverified
  syscall attribution; treat it as a platform test lead. Installer completion
  complaints (#2132/#2134) concern PhotoCraft's installer, not Varve website
  copy. These are external reports, not confirmed Varve defects; no marketing
  change is justified from this range.
- Issue range #2203–#3298: full body/comment review is complete for 502 issue
  records and 776 comments; reported comment counts match. Verification leads
  include the camera-transform invariant for rotated overlays/guides (#2512,
  #3233, #3277), stale output after async refusal/cache refresh (#2422), strict
  automation validation before side effects (#2449, #2946), locked-layer and
  preview/commit consistency (#2585, #3004, #3009, #3010), and destructive
  target ambiguity across mask/layer commands (#2456–#2459 and related
  reports). These are external reports to verify against Varve contracts, not
  confirmed defects. Marketing complaints in this range do not justify a
  Varve website change.
- Issue range #3301–#5000: full body/comment review is complete for all 775
  issue records. The frozen inventory has 1,208 comments in this slice; the
  live reread returned 1,211, with exactly three comments arriving after the
  cutoff (#3958, #4366, #4879). Issue membership and body/title/state match the
  frozen records. Reports included importer working-set accounting, cache and
  history byte budgets, partial mutation after reported command failure, stale
  session references after rollback/remap, background-job invalidation, and
  inaccessible controls. These are cross-check leads, not confirmed Varve
  defects. The suspected Inspector expression-overflow asymmetry was already
  covered by `evaluate()`'s finite-result guard and its overflow regression.
  No additional website claim change was justified.
- Issue range #5002–#6000: full body/comment review is complete for 490 issue
  records and 672 comments; all cache and reported counts match. The strongest
  Varve-specific candidate is resource exhaustion in native path lowering:
  `flatten_contour` reserved `points.len() * 8` and could emit up to 64 vertices
  per cubic before the frame-wide vertex budget was checked. A bounded native
  path-lowering guard now caps each item's flattened vertices and rejects work
  before exceeding the remaining budget; a regression test is added, with
  focused Rust validation pending. Numeric narrowing, document-scoped tool
  state, and transparency compositing remain review prompts without a
  confirmed matching Varve defect.
  PhotoCraft's website complaints (#5536/#5933) concern its own trial copy and
  release link; they do not identify a Varve marketing claim to change.
- Issue range #1–#180: a sequential full read of 79 extant issue records and
  all 101 cached comments is complete, with no count mismatches. Reports include
  realistic-project latency, GPU/device-loss behavior (later fixed upstream),
  menu/layer discoverability, and fidelity gaps; these remain source-review
  leads rather than Varve defects. The complete issue-body pass now covers the
  full cutoff-A range; relevance and linked-evidence review continue.
- Save/recovery review (#6596–#6617): Varve already has external-change guards,
  session dedupe, IndexedDB recovery, and collision-aware export names. F-003
  now guards Save, Save As, and Save a Copy against another open session's
  destination, with native file-identity and browser handle-entry comparisons
  plus focused regressions.
  F-004 (#6604) now removes confirmed-dead PID-tagged staging files and old
  legacy temps; F-005 (#6605) preserves live symlinks and refuses unresolved
  dangling links. Their native focused tests pass, but broad verification is
  pending. Remaining candidates include metadata/hardlink behavior (#6602/#6603),
  large-document save memory (#6607), and malformed-setting field normalization
  (#6611). Batch B fixes the read-only replacement defect (#6600) and preserves
  writable target modes; see F-002. Other candidates remain under investigation.

- Save-path linked-evidence pass: #6602 hard-link loss and #6603 metadata loss
  are confirmed consequences of Varve's staged native replacement. Their fixes
  need deliberate policy/platform design: do not replace atomic writes with
  in-place writes, and do not copy security metadata best-effort. Microsoft
  documents `ReplaceFileW` preservation and failure behavior; Apple's
  `copyfile(COPYFILE_METADATA)` covers POSIX metadata, ACLs, and xattrs. The
  adjacent PdfCraft #3042 remains unmerged and is not platform validation.
  #6607 is retained for format/backend memory measurement. #6611 is a partial
  analogue because Varve normalizes several persisted fields but a broad catch
  can still return all defaults. #6615's normal browser path is already covered
  by Varve's IndexedDB recovery manager; quota/storage-denial edges remain.
  These dispositions are recorded on the matching issue inventory rows.
  Website review found no matching public claims requiring a copy change.
- Follow-up across tracker #6596–#6617: #6596 is covered by Varve's external
  change guard, #6597 by F-003, and #6598 only partially because duplicate open
  sessions remain possible while concurrent replacement is blocked. #6601's
  lossy UTF-8 native path conversion is confirmed and needs an end-to-end path
  contract; #6606's shared writer creates absent parent directories and needs
  intent-specific policy. #6610 recent-file missing state is already handled.
  #6612 is partial: Varve keeps recovery outside Linux config under Tauri's
  XDG data root, while XDG state is the canonical state location. PhotoCraft
  PR #6941 proposes a Linux migration and leaves macOS in Application Support;
  assess migration safety before changing Varve. Linked-smart-object reports
  #6608/#6609 do not match Varve's
  current embedded asset model. #6613 exposed a defense-in-depth gap: the
  dialog already renames duplicates, while ExportService now rejects duplicate
  names from direct callers and generated multi-file outputs; its focused test
  is green and wider validation remains. Read-only review found and fixed a
  path-alias gap by sharing canonicalization with the folder/archive sinks; its
  red/green regression is added. Full branch review found a case-insensitive
  path collision gap; the service key now matches Varve's case-insensitive
  filename resolver and a focused regression is queued behind the active unit
  lease. A second ZIP regression protects archive entries named `constructor`
  from inherited object keys. The non-finite-value scanner was also reviewed
  for large documents and now builds diagnostic paths only for nested objects
  and offending numbers. #6614's named-layer asset workflow is not present in
  Varve.
- Lock invariant (#1102–#1104, #1526, #2370, #3076/#3078, #3092–#3094): source
  review confirmed a double-click Node Edit bypass for effectively locked paths,
  including locked ancestors, plus Scale Tool mutation of a still-selected node
  after locking. Node Edit and Scale Tool now check inherited lock state at
  entry and mutation time; unit and real-browser regressions are pending. See
  F-011.

## Current full-gate checkpoint (2026-10-18)

- Exact reviewed SHA: `025f61d63984fef3e63c47918f0fb73d489276e8`.
- `pnpm verify:plan` escalated the 46-lane plan to the full suite because the
  change crosses shared Platform and native file-identity contracts.
- First exact-SHA `pnpm verify:full --local` run passed format/lint, emoji,
  health, architecture (14 distinct cycles; zero layer violations), all 20
  workspace typechecks plus E2E typecheck, CI tooling, and WASM browser
  artifacts. Its JavaScript unit-test lane timed out after 600 seconds waiting
  for the live JavaScript test lease owned by PID 605970 in another worktree.
- The unchanged-SHA `pnpm verify:full --local --resume` retry passed
  format/lint, emoji, health, architecture (same enforced results), and all
  typechecks. It timed out after 600 seconds in the `CI tooling tests` lane;
  the operation output identified the same occupied test lease. The owner was
  still running Vitest (PID 608096) when checked, so this is a shared-resource
  queue timeout, not a failing assertion result. Receipts are retained under
  the repository's `.git/varve-validation/operations/` directory.
- F-003 focused editor/web/native regressions remain passing, but the
  planner-required full gate is **not complete**. Do not describe this SHA as
  fully validated or integrated. Retry `pnpm verify:full --local --resume`
  only after the live owner exits and the lease becomes available.
- F-004 / PhotoCraft #6604 is committed as `77fcb00f2`; follow-up review fix
  `ba074e2e7` retains temp files with unrepresentable Unix PIDs. New native
  staging names carry the writer PID and are swept once that process is
  confirmed gone; legacy timestamp-only files require 24 hours. Sweeps are
  throttled to once every five minutes per directory, and cleanup errors do not
  fail saves. The minimal Windows API target probe passed; full native Windows
  compilation remains unverified because this Linux host lacks an MSVC-compatible
  C compiler. F-005 / #6605 is committed as `a708493b0`; its seven focused
  native `atomic_write_` tests pass. The defect-first review narrowed symlink
  handling to approved user paths so app-managed writes do not follow arbitrary
  symlinks; no remaining actionable F-005 finding was identified. Neither
  finding is covered by the older full-gate receipts above. Keep #6602 hard-link semantics and #6603
  xattr/ACL preservation separate; neither is fixed by read-only/mode
  preservation, F-004, or F-005.
- PhotoCraft #6604's linked #3489 and #203 source bodies and the #3489 comment
  were reviewed from the cutoff cache. The live Inkscape #260 report was also
  checked as a distinct crash-time data-loss complaint; it reinforces keeping
  atomic replacement while handling leftovers separately.
- PhotoCraft #6605 and its #6426 bot link were reviewed; #6426 concerns
  automation-root containment and is unrelated to document saving. Inkscape
  #9776 is adjacent symlinked-folder asset-path evidence, not the same
  atomic-rename failure.

## Branch and next actions

- Worktree: `.worktrees/photocraft-source-review`.
- Branch: `codex/photocraft-source-review`.
- Base: local `master` `1109bf5962091fb00aa34198876d1812327d808b`.
- `gh repo view K-Arthur/varve` resolves to `varvedesign/varve`; its default
  branch is `master`. A push to `master` that includes the changed editor,
  platform, or scene packages matches `website-deploy.yml` and rebuilds/deploys
  the Pages site, including its browser demo. The browser-demo guide now
  explains the storage-failure outcome for download-only saves; no landing-page
  capability claim changed. Responsive page screenshots and the relevant
  website E2E remain pending.
- Prerequisite commit: `98dec72b5` (cherry-picked repair of the missing
  `nodeResize.ts` module).
- Next: complete Varve applicability checks for the highest-priority save,
  resource, rendering, crop-state, clipboard, and lock leads; finish responsive
  screenshots and affected/full validation; then get a final independent code
  review and integrate through the repository's normal master process.
- Research next: assign a relevance disposition to every issue row (current
  ledger coverage is incomplete), recursively inspect linked evidence for the
  applicable leads, and review PR descriptions/discussions where they connect
  to a finding. Source-text review is complete for both issue cutoffs, though
  the exact historical bytes for the five cutoff-B bodies were not preserved.

## Validation record

- `pnpm verify:plan`: latest plan selected 45 lanes and
  `FULL-SUITE ESCALATION: YES` due to workspace/toolchain/validation-infrastructure
  scope. This is the stated reason for the escalation.
- Latest focused run: 4 editor/scene test files passed (111 tests), including
  the final existing-file ID/path preservation assertions. The commit
  checkpoint's `typecheck:e2e` initially exceeded its 120-second limit during
  shared machine contention; the standalone retry passed, and the commit
  checkpoint later passed as well.
- Playwright passed (1 test, 1.9 minutes) through the heavy-task lease. Both
  screenshots were visually inspected. The renderer logged its existing WASM
  fallback to the pure-TS stub; the tested Inspector field remained operational.
- `pnpm audit:docs`, `pnpm audit:emoji`, and `pnpm audit:tokens` passed.
  `pnpm audit:radius` and `pnpm audit:spacing` reported existing debt in
  untouched Presentation, SpecPanel, collaboration, FirstRunOverlay, and
  website styles.
- The first `pnpm verify:full --local` attempt scanned a Playwright transform
  cache because `TMPDIR` was inside the workspace. Retried with a task-specific
  temp directory outside the workspace: format/lint, emoji, health,
  architecture, and all package/E2E typechecks passed; CI tooling tests exposed
  a real `commonGitDirectory({ cwd })` adapter bug in the full-gate fixture.
  The adapter now binds to the requested repository root. Its existing
  full-gate fixture test and operation-history test pass, and the independent
  reviewer reported no findings. A subsequent clean-SHA retry at
  `31bdc72e78d28b02d6450979b4fee6696f2e1800` passed formatting/lint, emoji and
  health audits, architecture audit, all 20 workspace typechecks plus E2E
  typecheck, CI tooling tests, and baseline/SIMD/colour WASM browser artifacts.
  Vitest completed with 1,992 test files passed, 14 skipped, and two failures;
  22,905 tests passed and 17 skipped. `tests/quality/e2e-evidence-output.test.ts`
  found six hard-coded screenshot destinations in existing specs
  `vertical-text-orientation.spec.ts` and `visual-compositing.spec.ts`;
  `apps/website/src/test/demoDocuments.test.ts` found the committed
  `presentation.varve` fixture stale. These failures were observed before
  F-002 and do not touch its native filesystem path.
- For F-002, `pnpm verify:plan` selected format/lint, emoji, desktop JS
  typecheck/unit, and desktop-native lanes, then escalated to full suite because
  the touched native boundary is classified as shared contract surface.
  `pnpm verify:affected` reported the escalation and did not run its lanes.
  The first native test compile exhausted the host filesystem; its generated
  target and Cargo lockfile churn were removed/restored. Retrying with a
  task-specific `/tmp` target and debug info disabled passed all three
  `atomic_write_` tests. Rustfmt passed for the touched `lib.rs` with child
  modules excluded; repository-wide `cargo fmt --check` reports existing drift
  in untouched `collab_host.rs` and `lifecycle.rs`. The exact-SHA gate at
  `a5684de538823ce0180d151de6d8413cfbec963a` passed formatting/lint, emoji,
  health, enforced architecture checks (14 cycles, zero layer violations),
  all 20 workspace typechecks and E2E typecheck, 40 CI tooling tests, and all
  baseline/SIMD/colour WASM builds. Its Vitest lane ran 2,008 files: 1,991
  passed, 14 skipped, and 3 failed; 22,904 tests passed and 17 skipped.
  The failures were (1) six pre-existing hard-coded screenshot destinations in
  `vertical-text-orientation.spec.ts` and `visual-compositing.spec.ts`,
  (2) stale `presentation.varve`, and (3) `feather-sigma16` at 10.365s against
  the benchmark's 10s bound. The focused benchmark passed via the heavy-task
  lease with `feather-sigma16` at 3.44s. Full-gate output and operation receipt
  are retained in local validation history; this does not certify hosted E2E,
  packaged builds, or native Windows/macOS matrices.

- F-003 focused checks: `pnpm exec vitest run
  packages/editor/src/context/__tests__/saveTargetCollision.test.tsx
  packages/platform/src/__tests__/webSaveHandle.test.ts
  packages/platform/src/tauri.test.ts --reporter=verbose` passed (26 tests).
  `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
  same_approved_file_identity_ --lib` passed (2 tests), and rustfmt passed for
  the touched native module. `pnpm audit:docs`, `pnpm audit:emoji`, and
  `pnpm audit:tokens` passed. The final 46-lane plan escalates to full suite;
  `pnpm verify:affected` reported that escalation without running lanes. The
  exact-SHA gate and an unchanged-SHA resume both passed typechecks, but each
  timed out after 600 seconds waiting for a live shared heavy-test lease; see
  the current checkpoint above. The prior standalone desktop typecheck's
  `CollabSurfaces.tsx:450` cast diagnostic did not recur in the full workspace
  typecheck. An earlier editor check's fixture literal errors were corrected
  and the focused tests now pass.
- F-004 native red/green reproduction: before implementation,
  `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
  atomic_write_removes_stale_staging_files_but_keeps_recent_ones --lib`
  failed because the aged staging file remained. The implementation was then
  tightened during review to retain old files whose writer PID is still live.
  The latest five native tests cover stale legacy files, a dead PID, a live
  PID, malformed names, and a stale symlink. `rustfmt --edition 2021 --check
  --config skip_children=true apps/desktop/src-tauri/src/lib.rs`, `pnpm audit:docs`,
  `pnpm audit:emoji`, and `pnpm audit:tokens` passed. The latest planner
  selected seven lanes but escalated; `pnpm verify:affected` reported that
  escalation without running its lanes. Full-gate validation for this newer
  SHA remains outstanding.
- F-005 / PhotoCraft #6605 red/green: before the fix,
  `atomic_write_refuses_dangling_symlink_without_replacing_it` failed because
  the link was replaced, and `atomic_write_through_live_symlink_preserves_the_link`
  failed because the live link disappeared. After canonicalizing symlink paths
  before atomic replacement, both pass; the focused `atomic_write_` suite now
  passes 7 tests. This is Unix-only regression coverage; Windows/macOS symlink
  behavior and the broad planner-required gate remain unverified. Website review
  found no claim that needs changing.
- F-003 visual work: the Save-flow E2E now hovers the failed-save status,
  asserts the quota error tooltip, and captures `evidence/save-failed-status.png`.
  `pnpm typecheck:e2e` passed. The first `pnpm verify:affected` attempt reached
  the visual lane but its lease wrapper timed out after 600 seconds waiting for
  an editor Vitest owner; Chromium did not launch and no screenshot was
  produced. The E2E source is still uncommitted. Retry only after the live owner
  exits and inspect the generated image before committing it.

- F-007 / PhotoCraft #4963 and linked PR #5077: read the complete issue and
  current PR body/discussion. The source issue is a static security audit, not
  a reproduced disclosure. Varve's native writer had a matching write-before-
  permission sequence. The current change creates an existing-file staging
  file with mode 000 on Unix, applies the target permissions before writing,
  and aborts/cleans up with an explicit permission-setup error if this fails;
  new-file 0666-and-umask behavior is kept. The empty-stage mode, final-mode,
  and setgid restoration regressions passed in the 9-test `atomic_write_`
  native group. The first cold debug build filled `/tmp`; retrying with debug
  info and incremental compilation disabled passed. Windows ACL and xattr
  preservation are not covered. Marketing site review found no
  confidentiality/save claim to change.
  `pnpm verify:plan` selects desktop-native, affected desktop tests/typecheck,
  `pnpm verify:quick` passed touched-file format/lint, emoji/docs audits, and the
  E2E typecheck, then queued the visual E2E behind the live shared editor unit
  lease (owner PID 696193). `pnpm verify:affected` exits on the full-gate
  escalation before running lanes. `pnpm --filter @varve/desktop typecheck`
  reports the known untouched `CollabSurfaces.tsx:450` readonly `Affine` cast
  diagnostic. No website copy change is justified.

- 2026-10-18 mask numeric boundary follow-up: PhotoCraft #4201 and merged PR
  #4202 confirm a finite 0–1,000 px vector-mask feather contract. Varve's
  `setMaskFeather` previously preserved non-finite values, the document mask
  validator did not bound finite values, and the mask blur initializer scales
  with the radius. The current unvalidated change ignores non-finite setter
  input, caps finite edits at 1,000 px, rejects out-of-range loaded documents,
  and applies the same maximum in the Inspector. Regression coverage and the
  masking architecture note are added; docs now identify the source and the
  distinct Varve failure mode. PhotoCraft #4181 / PR #4182 concern Global
  Light, which has no corresponding Varve feature, so #4181 is now explicitly
  out of scope. Marketing-site review found no matching claim to change.
  `pnpm verify:plan` currently selects desktop format/lint, docs and emoji
  audits, desktop unit/typecheck, and desktop-native, and escalates to the full
  gate because the worktree also contains the earlier Cargo manifest change.
  Workspace space remains critically low (360 MB free at check); affected
  validation, native build, UI visual inspection, and final code review have
  not run. Do not call the implementation complete until those are done.

- Follow-up validation snapshot: `pnpm verify:plan` now selects 42 lanes across
  desktop/editor/scene plus downstream workspace packages, and reports full
  suite escalation due to the uncommitted Tauri manifest change.
  `pnpm verify:affected` exited before running lanes with the required
  `pnpm verify:full` instruction. Touched-file Biome and `git diff --check`
  pass; docs and emoji audits pass; token audit passes all 324 pairs in three
  themes; Inspector CSS audit is clean with existing debt warnings. Spacing
  audit reports 30 unrelated baseline drifts in collab/first-run/website files;
  radius audit reports 10 existing legacy consumers in Presentation/SpecPanel.
  Neither audit points at a changed file. `impeccable detect` reports no UI
  source findings. Disk has stayed below 400 MB free with unrelated Vitest and
  Playwright jobs active, so tests, native builds, and visual screenshots are
  still deferred; final code review and code commit remain pending.

- Additional evidence review: read the complete merged conversations for
  PhotoCraft PR #4202 and PR #4182. #4202 validates vector-mask feather
  against the finite 0–1,000 px pixel-mask contract and tests rejection before
  mutation/history changes; #4182 validates Global Light angle/altitude before
  narrowing to `f32`, which remains out of scope because Varve has no matching
  feature. Both PR inventory rows now record complete body/discussion review,
  and the issue README lists them as linked implementation evidence. The docs
  audit passes after this update. A Vite browser preview visually confirmed
  the home and new-document screens, but the mask Inspector could not be
  reached: generating a test document failed with `ENOSPC` as root space fell
  to zero. The preview server and its 43 MB cache were stopped/removed; only
  intended source changes remain in the worktree. Feature-specific visual
  evidence, full affected validation, and final code review are still pending.

- 2026-10-18 mask visual follow-up: after clearing Cargo target artifacts, the
  browser preview reached the Inspector. Typing `1001` first produced an
  invalid document that was rejected on reopen; this exposed the need to clamp
  at the Inspector action boundary in addition to the scene helper. After that
  change, a fresh document capped the same entry to `1000`, saved, and reopened
  with `1000`. The dark-theme Inspector layout was visually inspected. Focused
  scene/codec regressions passed before the action-boundary follow-up; the
  combined rerun (including the new Inspector input regression) is queued
  behind the shared heavy-task lease. Multi-theme visual checks,
  planner-required broad validation, final code review, and integration remain
  pending. Website review found no public mask-feather or Global Light claim
  that needs revision.

- 2026-10-18 validation and WebGPU-boundary follow-up: inspected the saved mask
  document's Inspector in dark, light, and high-contrast themes. Each showed
  the 1,000 px limit; entering 1,001 resolved to 1,000, and the saved document
  reopened at that value. The source page makes no mask-range or Global Light
  claim, so no marketing copy change is warranted. Earlier focused scene
  validation passed 80 mask tests. A broader 14-package Vitest sweep was
  stopped after about an hour under shared-machine contention; it is not a
  pass, and the mask-specific focused checks remain the relevant evidence.

  Separate review of #6424 and linked numeric-overflow reports found an
  adjacent defect in the opt-in Rust GPU planner: finite `f64` geometry could
  overflow during narrowing to `f32` and still produce a presentable plan.
  Lowering now checks shape records, transforms, path vertices, and cover
  vertices after conversion, rolling back a path item if any vertex fails.
  Two regressions cover `1e39` rectangle and path coordinates. `pnpm verify:plan`
  selected format/lint, emoji, `varve-accel` tests and Clippy, plus dependent
  desktop Rust tests; it reported no full-suite escalation. The first affected
  run passed all 53 accelerator unit tests and accelerator Clippy. A follow-up
  diagnostic classification and rustfmt cleanup happened after that first
  pass, so validation was rerun. The current run passed the same 53 accelerator
  tests, Clippy, format/lint no-op checks, emoji, and docs audits. Its dependent
  desktop Rust lane could not complete: the default-debug build drove free disk
  below 350 MB; a low-debug retry reached 91 MB while unrelated worktrees were
  building. Both desktop attempts were stopped before filesystem exhaustion,
  and only this worktree's generated Cargo target was cleaned. Desktop tests
  remain unverified due to shared disk capacity. The oversized Vitest sweep was
  interrupted with SIGINT and must not be reported as passing. A read-only
  review of the committed GPU diff found no additional actionable defects, and
  the #6424 and #4201 issue-inventory records now reflect the current evidence.
  The focused Inspector unit and desktop Rust checks remain pending, as does
  integration into master.

- PhotoCraft #6423 and recursive import evidence: the exact Affinity compound
  import path is outside Varve's supported formats. The review found an
  analogous weakness in Varve's PSD/PSB group conversion: both converters
  recursively walked nested groups without aggregate limits. Both now perform
  an iterative preflight that rejects depth over 64, more than 50,000 nodes,
  more than 500,000 child slots, and repeated references before conversion.
  Tests cover depth rejection in both paths, plus repeated references, node
  count, root child slots, and aggregate nested child slots. The upstream `@webtoon/psd` dependency
  still recursively freezes groups before returning the parsed tree; that
  earlier boundary is caught and documented, not patched. Related PhotoCraft
  #6486/#6506 and Filmcraft #2063 / Effectcraft #1128 show the same import graph
  risk in adjacent parsers. Focused PSD tests pass (30), and import/editor/
  website typechecks pass. The affected planner stops at existing radius-token
  drift in untouched editor files, so the broader selected lanes did not
  complete. The real PSD/PSB import E2E passed and its Import Results screenshot
  baseline was inspected. The public file-format page lists PSD/PSB import; it
  now states the tree limits, with an assertion added to its screenshot E2E.
  The targeted website screenshot E2E passed for both GitHub Pages and custom-
  domain projects, and both screenshots were visually inspected. The affected
  closure remains incomplete because its planner run stops at unrelated
  `audit:radius` findings; an earlier code-only run also encountered the known
  desktop typecheck error. No public page claims Affinity import. See F-018.

- PhotoCraft #6601 non-UTF-8 native paths: the Rust OS-open queue now refuses
  invalid UTF-8 startup paths and `RunEvent::Opened` paths before lossy
  conversion; second-instance paths containing U+FFFD are refused because
  Tauri may already have substituted them for invalid bytes. Native Tauri
  drag/drop queues an actionable error, and native Open/Import/Save catch the
  dialog plugin's `path contains invalid UTF-8 characters` serialization
  failure. The public File Formats page now documents the Unicode filename
  requirement and rename recovery. This is early refusal, not support for
  arbitrary byte or unpaired-surrogate paths; literal U+FFFD filenames through
  second-instance forwarding must be opened from File → Open. Inkscape issue
  #9197 records a comparable user complaint where Open/Save As appeared to do
  nothing after an invalid-UTF-8 path failure; Varve now surfaces the failure.
  Validation: focused desktop Rust tests passed (6); focused platform tests
  passed (21); platform and website typechecks passed; the website File Formats
  screenshot E2E passed under the lease in both GitHub Pages and custom-domain
  projects, and both screenshots were visually inspected. Both website builds
  passed. The touched checks passed, as did the emoji, docs, and token audits.
  `verify:affected` stops on 10 pre-existing raw-radius consumers in untouched
  Presentation/SpecPanel styles; desktop typecheck separately reaches the
  existing `CollabSurfaces.tsx:450` readonly Affine mismatch. Native Tauri
  runtime validation and the Windows unpaired-surrogate test remain pending.
  `audit-architecture.mjs --ci` completed: 14 current cycles remain under the
  17-cycle ceiling, no new cycle identity was reported, and layer violations
  remain zero. Its instability, unused-export, and hub-budget findings are
  report-only under the repository policy. Final full code review is pending.

- PhotoCraft #2585/#3092 locked editing follow-up: the real-canvas locked-path
  regression passed for Node Edit and Scale, and its screenshot was inspected.
  Review then found the separate text-replacement surface: Edit text and the
  selection quick bar could open a locked text node, and an active inline
  editor could keep writing after its layer was locked. Both entry points now
  check effective ancestor locks; an open textarea becomes read-only, the
  floating text controls are hidden, and text/typography callbacks recheck the
  latest document. Four focused unit files passed (100 tests); editor and E2E
  typechecks passed. The browser test passed after correcting its selector to
  target the new text row; the screenshot showed the lock explanation and
  unchanged text. `verify:affected` passed format, touched-file lint, and the
  emoji audit, then stopped at the known 10 raw-radius consumers in untouched
  Presentation/SpecPanel CSS. The explicit docs, emoji, and token audits pass.
  The full layer-workflows file passes (16 tests), the keyboard E2E domain
  passes (28 tests), and the desktop unit lane passes (90 tests). The
  package-wide editor unit run exceeded 30 minutes under shared Vitest load;
  it reported a separate `retouchTools.test.ts` failure before it was stopped,
  so the aggregate editor suite is incomplete. Desktop typecheck still fails
  on the existing `CollabSurfaces.tsx:450` readonly Affine cast. The docs and
  issue records now mark #2585 and #3092 covered. The locked-text slice is
  committed as `6e27d0dd9`.

- PhotoCraft #2913 gradient-map opacity handles: source review identified an
  interaction gap in Varve's `GradientMapEditor`: opacity could be changed by
  keyboard or numeric entry, but pointer dragging only changed horizontal
  position and the handles did not encode opacity vertically. The editor now
  maps vertical drag to opacity and renders handles at their opacity height.
  `pnpm verify:plan` selected 15 lanes and reported no full-suite escalation.
  The latest `pnpm verify:affected` run passed format, lint, emoji, docs,
  Inspector CSS, and token audits, then stopped at 30 existing
  spacing-baseline drifts in untouched collab, FirstRunOverlay, and website
  files. The final E2E typecheck passed after adding the viewport assertion and
  focused screenshot capture. The focused GradientMapEditor unit file passed (23 tests),
  and editor typecheck passed. Desktop typecheck still reproduces the existing
  `CollabSurfaces.tsx:450` readonly Affine cast. `VARVE_TEST_WORKERS=2 pnpm exec
  vitest run packages/editor --reporter=dot` completed in 59m32s: 913 files and
  8,993 tests passed, 2 files and 2 tests skipped, and one unrelated assertion
  failed in `packages/editor/src/tools/__tests__/retouchTools.test.ts:108`
  (expected “Alt-click”, received “Alt-, Ctrl-, or Command-click”). The selected
  desktop unit lane `pnpm exec vitest run apps/desktop --reporter=dot` passed
  (15 files, 90 tests). The full serial
  gradient-map spec failed before reaching the new test because its existing
  “Add adjustment” menu remained closed. The isolated case uses the visible
  Colour Grade correction preset to establish a real Gradient Map, then
  exercises the handle with real mouse events; it passes and asserts the 50%
  opacity value, viewport visibility, and vertical alignment. The focused
  opacity-bar screenshot was inspected and is saved at
  `docs/audits/photocraft/evidence/gradient-map-opacity-handle.png`.
  `pnpm audit:docs` passes (1,171 docs, 888 links, 182 ADRs indexed). The
  Impeccable detector found no deterministic UI-rule issues. The Gradient Maps
  marketing page already claims users can edit opacity stops; numeric and
  keyboard editing supported that claim before this change, and vertical drag
  now adds a direct affordance. No website copy change is needed. Read-only
  review of the complete #2913 code, test, evidence, and inventory diff found
  no actionable defects. The #2913 slice is ready for commit; master integration
  remains part of the larger incomplete issue-corpus review.

- PhotoCraft #6110 and linked #4961 resource-bound review: compared the issue
  and linked open PR #5992 against Varve's retouch implementation. PR #5992
  adds both an early stroke-footprint estimate and an actual rendered-coverage
  admission check before dense allocation; this remains upstream, unmerged work
  at the frozen cutoff. Varve does not accumulate retouch coverage for a whole
  stroke: each dab creates its mask and writes only touched tiles in
  `retouchRaster.ts`. The retouch UI constrains brush diameter to 1–1000 px, and
  `setOptions` is connected to that bounded control. This does not establish the
  PhotoCraft defect in Varve; #6110 is marked reviewed/no direct action. The
  separate per-dab allocation is bounded by the user-facing size limit and is
  not treated as an equivalent whole-stroke allocation. No product behavior
  changed, so no visual validation or marketing copy change applies. Full code
  review and master integration for the larger corpus task remain outstanding.
