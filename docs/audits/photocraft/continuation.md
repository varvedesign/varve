# Continuation record

Last updated: 2026-10-18 (session 6).

## Frozen baseline

- Cutoff A: `2026-10-17T04:41:35Z`–`2026-10-17T04:42:17Z`; 1,296 unique
  issues and 1,682 PR records, with pagination and search totals reconciled.
  Hashes and retrieval details are in `README.md`.
- Cutoff B: `2026-10-18T12:28:21Z`–`2026-10-18T12:28:46Z` UTC. The full 33-page
  `state=all` API response is outside Git at `/tmp/opencode/photocraft/`, SHA-256
  `13e385871d051ce3a18734bcc8a3b1ebab875b2e749ae2cb9a2515c9ff29748a`. It
  reconciles to 1,454 issues (936 open / 518 closed) and 1,795 PRs; all A IDs
  remain present. The 158 new issue records are in
  `issue-ledger-follow-on-b.jsonl`, with bodies hashed but not included. All 158
  bodies and current comment threads are now reviewed; the ledger records 40
  screened-for-Varve, 116 out-of-scope, and 2 already handled, with zero queued.
  Current comments were fetched after the issue inventory, so they do not form
  an atomic snapshot with the cutoff B issue records. Linked evidence, sample
  files and attachments remain open where noted in findings.md. Do not move
  cutoff A or B.
- Scope mismatch: user resolved the brief’s conflicting links as PdfCraft
  (`storytold/pdfcraft`); `storytold/photocraft` is a separate repo. See README.
- Cutoff A review depth was: 25 full issue threads, 1,258 full bodies, and 13
  empty-body title-only records. Relevant thread and attachment review is not
  complete; unresolved classes remain listed in `findings.md`.

## Repository and ownership

- Worktree: `/home/kevina/CodingProjects/varve/.worktrees/photocraft-hardening`
- Branch: `feat/photocraft-hardening`, based on `32de0c41c4e30defe14452f04e500a624ac2582b`.
  Task commits: `3524d07ee` (text draft save integrity), `f0c0ae563`
  (PDF blend/transparency fidelity and release-aware website copy), `9a7e447eb`
  (cutoff A corpus records/findings), `5b2c3a409` (mobile website evidence),
  `722315eda` (cutoff B inventory), `bd0c62933` (cutoff B review and Linux
  support guidance), `349cfcb2a` (cutoff B reconciliation), `11601d58e`
  (corrected issue provenance), `57eccb6a2` (reconciled cutoff A totals),
  `de2c09ef6` (provenance review checkpoint), and `a79c0a239`
  (integration/workflow state snapshot).
- The main checkout has unrelated in-flight edits. Do not stage, revert,
  reset, stash, or commit them. The latest read-only workflow status showed the
  task branch has no upstream configured; at that check it had 9 commits
  unique to the task branch and was 33 behind local `master`. Additional task
  commits have since been added, so refresh this count before integration. The
  main checkout remains dirty, and the
  codegen/scene source files are untracked there as well as in this task
  worktree. No merge or rebase is in progress. Do not merge into the main
  checkout until the source-owning work lands and candidate validation can run.
- `pnpm workflow:status` also listed other running full-gate operations in the
  shared workflow registry. They were not inspected further, stopped, or
  altered.
- `packages/codegen/src/bundle-assets.ts` and
  `packages/scene/src/nodeResize.ts` are untracked in this worktree and match
  untracked files in the main checkout. Ownership remains with other work;
  both are excluded from this task's commits. Do not alter them.
- `pnpm verify:affected` currently stops at touched-file formatting because
  the other-worktree `packages/codegen/src/bundle-assets.ts` is unformatted.
  It exits before running any affected tests. The source omissions and exact
  hashes are documented in `findings.md` §6.1; a clean-commit build still
  needs those owning changes to land or a base that contains them.
- Keep the ChatGPT Linux app open and do not stop other agents, their tests, or
  their leases. Use `scripts/quality/heavy-lease.mjs` for Playwright work and
  wait for shared leases to clear; never reclaim a live lease.

## Work completed in this pass

1. Enumerated all 1,296 issues and 1,682 PR records at cutoff A. The issue
   ledger has one row per issue; counts are summarized in
   `issue-ledger.summary.json`.
2. Corrected ledger findings for issue #811 and lock enforcement. Source
   review remains partial at the depth stated above.
3. Implemented the pending text draft drain in the save and termination
   paths. A second review added the visible IME composition snapshot and keeps
   the typing transaction open until `compositionend`.
4. Implemented the first PDF fidelity slice: PDF blend modes, PDF/X-1a
   transparency and unsupported-mode stops, PDF/X-4 blend/transparency
   output, shared authored-alpha checks, user guidance, and upcoming-release
   website copy. PDF/X standards conformance remains unverified.

## Review record

A follow-up source check corrected two provenance/ledger errors: the emoji and
Persian keyboard references in findings §4.6 are PhotoCraft issues outside the
PdfCraft cutoff, and PdfCraft #813 is now classified under async-generation
with its actual cancelled password-recovery report. The same check noted a
possible Home-open focus race in Varve; no runtime repro was run and tab identity
prevents claiming the reported wrong-save outcome.

The `review-agent` workflow was applied as a distinct second-pass self-review;
it does not permit delegating this read-only review, and no independent review
was available for these local commits. The reviewer and implementer were the
same agent; this is not represented as independent approval.

- `3524d07ee`: checked registration cleanup and replacement, synchronous
  draining before save revision capture and termination dirty-set decisions,
  focused Save shortcut routing, IME draft visibility and transaction
  lifetime, plus the tests for save, close, unload, and unmount.
- `f0c0ae563`: checked the capability declarations against Rust's PDF blend
  mappings and refusal boundary, shared preflight/export alpha handling,
  error text and recovery choices, and that website copy labels the behavior
  as next desktop release. Five generated PDFs were independently rendered
  and sampled with Poppler; no PDF/X conformance claim is made.
- `9a7e447eb`: recomputed ledger counts from JSONL (1,296 unique IDs; 827 open,
  469 closed; 883 with comments; 25 threads; disposition counts match the
  summary), checked cutoff/research-depth statements, and compiled and ran the
  reproducible PDF probe. The broader issue/comment/attachment frontier is
  still explicitly partial.

## Agent Validation Report

```text
Changed scope: editor save/lifecycle/shortcut paths; PDF print/export/preflight; two website export pages; audit docs and PDF probe.
Validation plan: initial pnpm verify:plan selected 54 lanes across 38 changed files; FULL-SUITE NO. A later residual-tree plan selected 41 lanes; FULL-SUITE NO.
Commands actually run: pnpm verify:plan; pnpm verify:affected; pnpm audit:docs; pnpm audit:emoji; pnpm audit:tokens; pnpm audit:radius; targeted Biome; editor/scene/website typechecks; pnpm typecheck:e2e; lease-wrapped text E2E; focused Vitest export batch; cargo test -p varve-print; cargo fmt -p varve-print -- --check; cargo clippy -p varve-print -- -D warnings; cargo run -p varve-print --example blend_probe; cargo clippy -p varve-print --all-targets -- -D warnings; Poppler render and pixel sampling; local website-link status check; git diff --check.
Passed: text/IME/lifecycle tests (49); text commit checkpoint (168); PDF focused batch (208/208 across five files); PDF commit checkpoint (83 across three files); text save/close E2E; editor, scene, website, and E2E typechecks; website Astro diagnostics (0 errors/warnings/hints); Rust print suite (188); Rust fmt/clippy; PDF probe compilation/run and five expected Poppler pixels; desktop/mobile website screenshots visually inspected; local page links (all served targets HTTP 200); docs/emoji/token audits; staged commit checks.
Skipped as unrelated or unavailable: full Vitest/Cargo workspace suites, browser E2E and visual regression beyond the targeted text flow, native Tauri menu/GUI matrix, benchmarks, packaging/signing/release checks, formal PDF/X validator (not installed). Website Playwright screenshot launch lacked host libraries; inspected website screenshots were captured with system Firefox.
Escalations: none. pnpm verify:affected stopped at touched-file format because the other-worktree packages/codegen/src/bundle-assets.ts is unformatted; it ran no affected test lanes. pnpm audit:radius reported ten existing consumers in Presentation and SpecPanel CSS outside this change.
Full suite run: no.
If yes, reason: n/a.
```

## Validation evidence and gaps

- `pnpm verify:plan`: 54 selected lanes, 38 changed files,
  `FULL-SUITE NO`.
- `pnpm verify:affected`: blocked at Tier 0 by the other-worktree codegen
  file's formatting; it ran no tests. The issue is recorded above and was not
  repaired here.
- Targeted Biome checks and `git diff --check` passed after owned-file
  formatting fixes. `pnpm audit:docs`, `pnpm audit:emoji`, and `pnpm
  audit:tokens` passed. The text commit's staged checkpoint passed Biome,
  emoji/docs audits, health, impact config, interaction audit, secret/contacts
  scans, E2E TypeScript, and 168 focused tests. The checkpoint explicitly
  deferred browser E2E and visual regression, native desktop GUI matrices,
  full suites, benchmarks, and release checks. `pnpm audit:radius` reports ten existing consumers in
  Presentation and SpecPanel CSS outside this patch.
- `packages/scene/src/export/preflight.test.ts`: 28 passed before the shared
  predicate extraction; the updated preflight is included in the queued PDF
  test rerun. Latest focused text/IME/lifecycle tests passed: 49 tests across
  three files.
- Current lease-wrapped text-save E2E passed both saved-byte and close-unsaved
  cases. Its screenshot is retained at
  `evidence/text-draft-before-save.png` and was visually inspected.
  Chromium fell back from WASM to the TypeScript renderer and used a browser
  Save picker stub, so this does not verify native Tauri menu behavior.
- The corrected PDF/export/preflight/shortcut batch passed 208 tests across
  five files. Earlier `cargo test -p varve-print` passed 188 tests;
  `cargo fmt -p varve-print -- --check` and
  `cargo clippy -p varve-print -- -D warnings` passed. Five PDF examples were
  rendered with Poppler and inspected; pixel samples and `pdfinfo` evidence
  are in `findings.md` §6.3. This is not PDF/X certification.
- Both changed export pages were captured and inspected at desktop and mobile
  widths after the upcoming-release copy change. Desktop and 390×844 mobile
  evidence is in `evidence/website-export-*.png`; the mobile text wraps cleanly
  with no horizontal overflow. Local links from both pages returned HTTP 200.
  `/try/` is built as a separate combined Pages deployment artifact and is
  therefore absent from the local Astro dev server; this is documented in
  `docs/release/website.md` and `.github/workflows/website-deploy.yml`.
  Playwright Chromium reported missing host libraries on later launches; no
  system packages were changed. The inspected mobile captures used isolated
  headless system Firefox under the shared lease.
- Editor, scene, website, and E2E TypeScript checks all passed after the
  current changes; Astro reported zero errors, warnings, or hints. Do not run
  the full suite; the planner did not escalate.

### Latest validation report — cutoff B issue-body and thread screen

Changed scope: cutoff B classifications for 89 queued issues, findings, README, summary and continuation docs.
Validation plan: pnpm verify:plan selected 38 lanes; FULL-SUITE NO. Two unowned files under codegen/scene keep those packages in the affected closure.
Commands actually run: pnpm verify:plan; pnpm verify:affected; pnpm audit:docs; pnpm audit:emoji; git diff --check; inline Python JSONL/summary consistency check.
Passed: audit:docs; audit:emoji; follow-on ledger count/state/depth consistency; diff check.
Skipped as unrelated: package compilers, unit tests and E2E did not run because verify:affected stopped at Tier 0 on the unowned packages/codegen/src/bundle-assets.ts formatting error.
Escalations: none. No fix was applied to the other-worktree file.
Full suite run: no.
If yes, reason: n/a.

### Latest validation report — Linux package guidance and mobile table

Changed scope: `apps/website/src/pages/download.astro`, `docs/release/platform-support-matrix.md`, cutoff-B findings/ledger notes, and desktop/mobile visual evidence.
Validation plan: `pnpm verify:plan` selected 41 lanes and reported FULL-SUITE NO. The package-codegen and scene untracked files remain in the affected closure.
Commands actually run: `pnpm verify:plan`; `pnpm verify:affected`; `pnpm build:website`; `pnpm audit:docs`; `pnpm audit:emoji`; `pnpm audit:radius`; `pnpm exec biome check` on the owned touched files; `git diff --check`; inline Python ledger/summary consistency check; Firefox Playwright visual captures at 1440px and 390px; lease-wrapped Thai text corpus E2E attempt.
Passed: website client-env guard and Astro check/build (126 static pages); docs audit (1162 docs, 833 links, 182 ADRs indexed); emoji audit (5414 files); owned-file Biome check; whitespace check; ledger/summary reconciliation; desktop and mobile visual review.
Skipped as unrelated: full visual suite, Rust workspace tests, native print tests, and unrelated package/browser lanes. The Thai text corpus E2E never started: its shared heavy lease expired at 600 seconds while another live test lease remained active. `verify:affected` stopped at Tier 0 on the unowned `packages/codegen/src/bundle-assets.ts` formatting error, before dependent lanes; no fix was applied there. `audit:radius` still reports the 10 pre-existing legacy-radius consumers under editor Presentation and SpecPanel; none is in this change.
Escalations: none. No full suite run.
Full suite run: no.
If yes, reason: n/a.

### Latest validation report — provenance and ledger correction

Changed scope: PdfCraft #813 classification and rationale, adjacent PhotoCraft source links, async-open risk notes, cutoff A count summary.
Validation plan: `pnpm verify:plan` selected 38 lanes, FULL-SUITE NO. Untracked, unowned codegen/scene files caused those packages to enter the closure.
Commands actually run: `pnpm verify:plan`; `pnpm verify:affected`; `pnpm audit:docs`; `pnpm audit:emoji`; `pnpm exec biome check docs/audits/photocraft/issue-ledger.summary.json`; `git diff --check`; Python JSONL/summary reconciliation.
Passed: docs audit (1162 docs, 833 links, 182 ADRs); emoji audit (5414 files); JSONL/summary counts and uniqueness; summary formatting; staged commit checkpoints for all audit documentation commits in this follow-up sequence.
Skipped as unrelated: package compilers, unit tests and E2E did not run because `pnpm verify:affected` stopped at Tier 0 on the unowned `packages/codegen/src/bundle-assets.ts` formatter error. The other unowned `packages/scene/src/nodeResize.ts` remains untracked too.
Escalations: none. No full suite run. The possible Home-open focus race is documented but not reproduced or changed.
Full suite run: no.
If yes, reason: n/a.

### Latest validation report — PdfCraft #2970 link reconciliation

Changed scope: cutoff A classification for #2970, render-compositing findings and summary totals; no application code changed.
Validation plan: `pnpm verify:plan` selected 38 lanes and reported FULL-SUITE NO. The unowned codegen/scene source files remain in the affected dependency closure.
Commands actually run: `gh api` for issue #2970 and PR #2972; `gh pr diff 2972`; `curl` of the public libharu fixture; `sha256sum`; `pdfinfo`; `pdftoppm`; visual inspection of the 800×1200 Poppler render; `pnpm verify:plan`; `pnpm verify:affected`; `pnpm audit:docs`; `pnpm audit:emoji`; Biome formatting of the summary; JSONL/summary consistency check; `git diff --check`.
Passed: issue/PR status reconciliation (issue open, PR #2972 open and unmerged at the check); fixture SHA-256 `01e2126bab892af1c7248aadb723ccfc3f8e7bce0fb01265f8d5a19a0067352a`; PDF metadata inspection; Poppler visual inspection; docs/emoji audits; 1,296 ledger-ID uniqueness and all summary counts.
Skipped: affected compilers, unit tests and E2E did not run because `pnpm verify:affected` stopped at Tier 0 on the unowned `packages/codegen/src/bundle-assets.ts` formatting issue. No full suite run; the planner did not escalate.
Review: distinct self-review confirmed the corrected ledger disposition agrees with §4.7 and summary counts. The in-flight untracked compositor E2E in the shared main checkout was not treated as evidence or modified.

## Exact next steps

### Session 6 follow-up (2026-10-18)

Current task HEAD before the new follow-up commit is
`1134b82775da38d2cbb61b012430984b0d2c1b25`. Read-only seed reviews corrected
the ledger and findings for PdfCraft #434 (partial stamp fix; old signature
rationale unrelated), #2944 (merged EXIF fix and Varve import analogue), #787
(canvas cross-page drag exists; Layers/cut-paste routes remain open), #2512
(text-session design proposal; old signature rationale unrelated), and #2516
(PdfCraft-only ordinal paragraph API; authored Varve text uses stable IDs but
does not implement that API). #2022's PdfCraft fix is merged, while Varve still
needs a direct target-switch browser regression. Summary totals were
recomputed from all 1,296 ledger rows.

Added `tests/e2e/save/text-target-switch.spec.ts` to edit one text node, switch
to another before the buffered update window elapses, and verify the second
node plus undo. The first visual run exposed an edge-click in the test
coordinates; screenshot at
`test-results/run-314314-1420/save-text-target-switch-sw-5e2cc-ed-draft-and-preserves-undo-chromium/test-failed-1.png`
showed both created nodes intact and the first selected. Coordinates are now
centered on the visible text bounds. That queued rerun expired before
Playwright started. The current retry and shared-lease owner are recorded in
the addendum below; do not reclaim other agents' leases.

### Session 6 addendum — cross-page clipboard placement

Follow-up source review of PdfCraft #787 found that Varve's existing
same-document `worldAnchor` rule had no page provenance. Added clipboard v5
`sourcePageId`; same-document pose reuse now requires matching source and
destination page IDs. A missing source page ID in a legacy payload fails
closed for paged documents and uses destination placement. The architecture
contract is recorded in `docs/architecture/coordinate-system.md`. The ledger
now distinguishes this tested paste route from the still unsupported
Layers-tree route and multi-page selection.

The new context regression covers page switching, destination parent and
placement; together with the clipboard policy check, the focused editor batch
passed 58 tests across `clipboard.test.ts` and `context.import.test.tsx`.
`pnpm --filter @varve/editor typecheck` and `pnpm typecheck:e2e` both passed.
The latest `pnpm verify:affected` stopped at Tier 0 on the unowned, untracked
`packages/codegen/src/bundle-assets.ts` formatting issue; it did not run
affected lanes. The earlier task-owned import-order issue in the context test
was fixed. Do not modify the unowned `packages/codegen/src/bundle-assets.ts`
or `packages/scene/src/nodeResize.ts` files.

The latest text-target-switch Playwright attempt waited the full 600-second
lease deadline behind the live JavaScript unit-test lease owned by PID 402161.
Playwright never started and produced no screenshot. The queue timeout is not
a passing regression result. Do not reclaim that lease or stop the ChatGPT
Linux app or other agents' work. Website desktop/mobile screenshots and PDF
render samples were visually inspected earlier in this task; this targeted
text-switch visual check remains pending until the shared lease is free.

Validation: `pnpm verify:plan` selected 42 lanes and no full-suite escalation;
the affected run stopped at Tier 0 on the unowned format issue above.
`pnpm audit:docs` passed (1,162 docs, 833 links, 182 ADRs), `pnpm audit:emoji`
passed (5,415 files), `pnpm audit:tokens` passed all 324 pairs across 3 themes
and the usage scan, the focused editor batch passed 58 tests, both typechecks
passed, and Biome plus `git diff --check` passed. The directly invoked
`pnpm audit:radius` reported existing legacy-radius consumers in Presentation
and SpecPanel styles; none are in this task's changed files. No full suite was
run.

1. When the shared heavy-test lease is available, rerun the targeted Thai text
   corpus E2E; the previous attempt expired without starting Playwright.
2. Follow linked issues, PRs, attachments and source fixtures for cutoff-B
   candidates that remain relevant or uncertain in `findings.md` §§4.20–4.22;
   record inaccessible evidence rather than treating it as empty. The issue-body
   queue is empty, but recursive evidence is not exhausted.
3. Reproduce applicable candidates against Varve's declared workflows before
   calling them defects. New screens confirm no additional defect; language,
   layout, platform, startup, keyboard and updater candidates still need
   product-specific checks or decisions.
4. Continue the open applicable queue in `findings.md`: compositing backdrop,
   color-glyph/joining-control shaping, async generation guards, export
   fidelity and claims, bounded document-scale work, and dirty-state truth.
   Review deeper linked evidence for each relevant class.
5. Reconcile later arrivals, refresh project/remote/default-branch state, and
   integrate only after the owning untracked modules and affected validation
   are resolved. A push to `master` touching `packages/**` or
   `apps/website/**` runs `website-deploy.yml`; the assignment authorizes the
   normal task merge/push, but no separate manual release.

```bash
VARVE_E2E_PORT=1527 node scripts/quality/heavy-lease.mjs "e2e: buffered text save and close" -- \
  bash -lc 'TMPDIR=/home/kevina/.cache/varve-photocraft-tmp npx playwright test tests/e2e/save/text-draft-save.spec.ts --project=chromium --workers=1 --reporter=list'
```
