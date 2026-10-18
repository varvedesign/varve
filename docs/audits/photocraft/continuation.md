# Photocraft review continuation

Last updated: 2026-10-18. Status: active and incomplete.

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
  metadata. All PR descriptions/discussions remain unreviewed except #6863,
  whose changed files were inspected but whose discussion still needs review.

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
  but descriptions/discussions have not been comprehensively reviewed. PR
  #6863 changed files were inspected; its full discussion and release status
  remain open.
- Link frontier: #6863; #5752; #6424; #1101; #6423's related link(s); #6392's
  #3641 / SolidCraft evidence; #6962's #2850/#2339/#2687; #6964's #3384/#6669;
  and all relevant links not yet enumerated from the corpus.
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
