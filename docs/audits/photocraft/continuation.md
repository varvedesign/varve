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
  at `/home/kevina/.cache/codex/photocraft-2026-10-17/comments/`. Bodies and
  discussions for the frozen A set have now been read; the post-A #6400 comment
  was reviewed with cutoff B.
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

- Issue bodies and discussions: all 3,275 cutoff-A issue rows and their
  complete retrieved comment pages have been read; all five cutoff-B changed
  or new issue records (#6392, #6400, #6962, #6964, #6965) have also been
  reviewed. The JSONL issue ledger reflects this. Relevance classification and
  linked evidence are still open; completion here means the source issue text
  and comments were reviewed, not that every linked artifact was resolved.
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
- Issue range #5001–#6000: all 490 existing issue records reviewed; cached
  comment counts match with no missing pages. #5195/#5211 warrant checking
  Canvas2D and vector-mask work budgets; #5373/#5092/#5115/#5702 are useful
  cross-document tool-state regression leads; #5706 is a cache invalidation
  lead; and #5657/#5752 reinforce numeric narrowing checks. These are leads,
  not confirmed Varve defects. #5982's metadata amplification does not match
  Varve's bounded EXIF orientation reader. Marketing complaints #5536/#5933
  concern PhotoCraft's trial wording and stale download version; they do not
  justify a Varve website change. Sources: [#5195](https://github.com/storytold/photocraft/issues/5195),
  [#5211](https://github.com/storytold/photocraft/issues/5211),
  [#5373](https://github.com/storytold/photocraft/issues/5373),
  [#5092](https://github.com/storytold/photocraft/issues/5092),
  [#5115](https://github.com/storytold/photocraft/issues/5115),
  [#5702](https://github.com/storytold/photocraft/issues/5702),
  [#5706](https://github.com/storytold/photocraft/issues/5706),
  [#5657](https://github.com/storytold/photocraft/issues/5657),
  [#5752](https://github.com/storytold/photocraft/issues/5752),
  [#5982](https://github.com/storytold/photocraft/issues/5982),
  [#5536](https://github.com/storytold/photocraft/issues/5536), and
  [#5933](https://github.com/storytold/photocraft/issues/5933).
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
- Prerequisite commit: `98dec72b5` (cherry-picked repair of the missing
  `nodeResize.ts` module).
- Next: complete the branch-level defect-first review and broad validation;
  capture and inspect F-003's save-error screenshot after the live editor
  Vitest lease releases (the first visual attempt timed out in the lease queue,
  before Chromium launched); then run the planner-required broad gate on the
  current candidate. Continue Varve applicability checks for filesystem,
  recovery, and rendering leads. Recheck the live remote/worktree state before choosing an integration
  path; do not bring unrelated local master commits into this branch.
- Research next: classify issue relevance and recursively inspect linked
  evidence for applicable leads; review PR descriptions/discussions where they
  connect to a finding. The source text review is complete for the two issue
  cutoffs, but this does not complete the broader task.

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
