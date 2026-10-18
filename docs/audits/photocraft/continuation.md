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
  bodies and current comment threads are now reviewed; after follow-up fixes,
  the ledger records 37 screened-for-Varve, 117 out-of-scope, 2 already handled,
  and 2 implemented, with zero unreviewed issue bodies/threads.
  Current comments were fetched after the issue inventory, so they do not form
  an atomic snapshot with the cutoff B issue records. Linked evidence, sample
  files and attachments remain open where noted in findings.md. Do not move
  cutoff A or B.
- Scope mismatch: user resolved the brief’s conflicting links as PdfCraft
  (`storytold/pdfcraft`); `storytold/photocraft` is a separate repo. See README.
- Cutoff A review depth is: 30 full issue threads, 1,253 full bodies, and 13
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
run. The read-only integration review found that direct Rust PDF and PDF/X-4
calls did not reject blend modes with no PDF name, even though editor
preflight did. Task-branch commit `373ef7439` adds the same refusal at both
native API boundaries; its merged integration commit is `cb75b7f4a`.
`cargo test -p varve-print a_mode_without_a_pdf_name` passes both standard-PDF
and PDF/X-4 regression cases, and `cargo fmt -p varve-print -- --check` passes.

Follow-up Agent Validation Report: changed scope is the editor clipboard and
text-edit/save lifecycle, scene/PDF export fidelity, Rust PDF writers, Astro
marketing/export pages, and this audit record. After the native PDF review fix,
`pnpm verify:plan` selected 38 lanes with no full-suite escalation. The latest
`pnpm verify:affected` stopped at Tier 0 on the unowned
`packages/codegen/src/bundle-assets.ts` format issue; downstream lanes did not
run. Focused commands that passed: `pnpm --filter @varve/editor typecheck`,
`pnpm typecheck:e2e`,
`pnpm exec vitest run packages/editor/src/clipboard.test.ts packages/editor/src/context.import.test.tsx`
(58 tests), `cargo test -p varve-print a_mode_without_a_pdf_name` (2 tests),
`cargo fmt -p varve-print -- --check`, `pnpm audit:docs`, `pnpm audit:emoji`,
`pnpm audit:tokens`, `pnpm exec biome check` on task-owned TypeScript files,
`pnpm exec vitest run apps/website/src/test/download-copy.test.ts` (2 tests),
and `git diff --check`. `pnpm audit:radius` was run and reported existing
Presentation/SpecPanel legacy-radius consumers outside this change. The
`text-target-switch.spec.ts` Playwright attempt timed out after the 600-second
shared lease wait without starting; browser E2E and visual suite lanes were
deferred. Website desktop/mobile screenshots and PDF render samples were
visually inspected as recorded above. Full Vitest, full Playwright, Rust
workspace tests, and full gate were not run; the planner did not escalate.

Integration: the task-only candidate was pushed as a fast-forward to `master`
at `6e6c9d569586fca2d2c628a7f907d495fb414f8e` on 2026-10-18. Its Website
Deploy quality gate failed because `download-copy.test.ts` still prohibited
the repository's tracked Arch PKGBUILD, and the date-format regression test
also caught a raw ISO date replacing the page's human-readable UTC date. The
follow-up `daa308d1ea383843106ec5bb8c364bb5cbfdcafb` updates that test to
assert the tracked `packaging/aur/varve-desktop-bin/PKGBUILD` route without
claiming AUR publication, and restores `formatReleaseDate`; the focused
website test passed locally (2 tests). At the time of this update, `master`
was at `daa308d1ea383843106ec5bb8c364bb5cbfdcafb`; Website Deploy was in
progress, CI was pending, and the earlier Keyboard Nav run was still running
on `6e6c9d56`.

The `pnpm verify:push` attempt started a fresh dependency install in the
candidate; I stopped only that install when I found another agent's
`pnpm verify:full --local` waiting on the live shared Vitest lease. A direct
dry-run also could not load `cross-spawn` from the candidate's incomplete
`node_modules`. The push checkpoint therefore did not pass; the remote
workflows are the exact-SHA follow-up.

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
5. Follow the exact-SHA CI and Website Deploy workflows for `daa308d1`. The
   E2E Keyboard Nav run is on its parent task commit. Reconcile later arrivals
   and continue the open applicable issue queue; a passing merge workflow does
   not close that audit queue.

```bash
VARVE_E2E_PORT=1527 node scripts/quality/heavy-lease.mjs "e2e: buffered text save and close" -- \
  bash -lc 'TMPDIR=/home/kevina/.cache/varve-photocraft-tmp npx playwright test tests/e2e/save/text-draft-save.spec.ts --project=chromium --workers=1 --reporter=list'
```

## 2026-10-18: authored PDF stroke alpha follow-up

The recursive thread review for cutoff-B #3229 and #3176 is recorded in
`findings.md` §4.24 and `link-frontier.jsonl`. The combined-PDF-operator issue
does not map to Varve's partial PDF importer or its separate canvas fill/stroke
paint contract. During the adjacent authored-output check, a real Varve scene
export exposed a directly shared transparency defect: the PDF writer dropped
`EngineColor` alpha for strokes. Commit `173d6d9f1` fixes this by writing
`node.opacity × stroke.color.alpha` as the stroke graphics-state alpha. A
separate regression confirms the product and PDF/X-1a refusal remains covered.

The tracked Poppler renders were visually inspected:

- `evidence/pdf-stroke-alpha-after.png`, SHA-256
  `bbf202a52dd331fdccbe6fb782d4313cd4ddac3a53faf13983ab74040ae40d92`; at
  72 dpi, inner stroke over red `(95,31,158)`, outer stroke over gray
  `(64,64,191)`, fill `(191,63,63)`.
- `evidence/pdf-pattern-opacity.png`, SHA-256
  `27724baad0ca4116a1625a10febe4c96c773c716e80d58168fe3999f5cf9c241`; the
  25% red raster pattern over gray sampled `(159,95,95)`, with untouched gray
  outside.

The reproducible exporter command was
`cargo run -p varve-print --example blend_probe -- /tmp/varve-pdf-alpha-verification`;
Poppler rendered the resulting PDFs with `pdftoppm -r 72`. The before-fix
render was captured and inspected during the first run (opaque blue stroke),
then the same inputs were rerendered after the fix. The post-fix captures above
are retained; the pre-fix raster was not retained as a file.

Validation for this slice:

```text
Changed scope: varve-print Rust exporter/tests/probe; fill-system architecture doc; changelog and website deploy path filter; PdfCraft audit records/evidence
Validation plan: 13 files selected Tier 0 format/lint/emoji/docs, Tier 2 varve-print test/clippy, Tier 3 standalone desktop Rust tests; the workflow trigger change caused FULL-SUITE ESCALATION: YES (validation-infrastructure change).
Commands actually run: cargo fmt --check; cargo test -p varve-print render_strokes_preserves_stroke_color_alpha (red before fix, green after); cargo test -p varve-print; cargo clippy -p varve-print -- -D warnings; node scripts/audit-docs.mjs; node scripts/audit-emoji.mjs; just validate-workflows; just pin-actions; git diff --check; Poppler `pdftoppm` renders and ImageMagick pixel samples.
Passed: 193 varve-print tests; focused red→green regression; print-crate Clippy; formatting; docs audit (1,140 docs / 816 links / 178 ADRs); emoji audit (5,308 files); 13 workflow YAML/actionlint checks; all action pins.
Skipped as unrelated: website functional tests and full canvas visual suite were not selected by the direct affected plan; website `/changelog` visual inspection is still due after its master deployment.
Escalations: Full exact-SHA gate is required by the plan and remains to be run after the reviewed commit is pushed to a remote branch. `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` reached the Tauri build script but stopped because this integration clone lacks the ignored `onnxruntime-libs/**/*` bundle. The bundle exists in the active task worktree; it was not copied or modified. Its local build target was cleaned after failure (5.0 GiB reclaimed).
Full suite run: no
If yes, reason: —
```

`pnpm verify:plan` in the dependency-light integration clone began pnpm's
workspace linking rather than reaching the planner; that command was stopped
before completion. The same planner was run directly from the already
provisioned task-worktree script against this exact tree. `pnpm verify:affected`
was not run in this clone; its selected print-crate lanes were run directly,
and the dependent desktop lane is blocked as described above. Do not treat the
local push checkpoint or hosted full gate as passed yet.

Website impact: `CHANGELOG.md` feeds `/changelog`, but Website Deploy did not
watch that source file. Commit `173d6d9f1` adds it to the workflow path filter.
The visible item is explicitly `Unreleased`; export-feature marketing copy
needs no change. The master website build/deploy and visual inspection still
need confirmation after integration.

Integration state: local implementation commit `173d6d9f1` is on
`codex/photocraft-hardening-integration`, based on master `d8adb3be1`; audit
records/evidence reconciliation is not yet committed. Remote master still
points to `d8adb3be1`. The exact-SHA CI on `3da083f54` remains in progress and
the docs-only `d8adb3be1` CI remains pending; retain and poll these workflows.
No full-gate, website deployment, or native UI export verification is claimed.

Second-pass self-review (not independent): inspected the complete implementation
diff and both production PDF builder call paths. The opacity resource is
collected before page resources are assembled; PDF/X-1a still rejects visible
stroke alpha; no hub, schema, or public UI boundary changed. No other actionable
code finding was found. The direct exporter output is verified, but native UI
export remains unverified because the local Tauri build lacks its ignored model
bundle; exact-SHA hosted validation is still required.

Next: commit the audit ledger/frontier reconciliation separately, publish the
reviewed candidate branch to obtain the plan-required hosted exact-SHA full
gate, and fast-forward the verified commits to master through the normal
permitted path. Then inspect the deployed `/changelog` at desktop and mobile
widths. Continue cutoff-A and cutoff-B recursive evidence and Varve-specific
checks; 38 cutoff-B issues remain screened for Varve and the older cutoff-A
queue is still open.

## 2026-10-18: direct text-session handoff follow-up

The first post-merge run of `tests/e2e/save/text-target-switch.spec.ts` exposed
that clicking another text node while the Text tool was active created an
empty layer instead of transferring the inline session. The Text tool now
receives the overlay's active target and, only during an active text session,
switches to a hit text node; ordinary Text-tool clicks on existing artwork
still create point text, preserving the nearby-placement behavior users expect.
Before handing off, it drains buffered input and closes any open text-creation
transaction so the previous draft is durable in its own history step. The
focused TextTool regression covers the handoff ordering and both click modes.
The browser spec checks the second node's active editor, verifies the first
buffered value after switching back, and confirms undo through the inspector's
Text content field.

The TextTool suite passed 7/7, editor and E2E typechecks passed, and changed
TypeScript files passed Biome. A focused Chromium E2E pass before the explicit
buffer-drain handoff was visually inspected at
`/tmp/varve-photocraft-text-switch-visual-final-2026-10-18/save-text-target-switch-sw-5e2cc-ed-draft-and-preserves-undo-chromium/text-target-switch.png`;
both text objects render with the expected content. The subsequent run with
the explicit buffer drain confirmed the first draft was restored after undo,
but its final canvas-coordinate selection missed after the layout shifted.
The spec now selects the restored text through its Layers tree item and is
queued through the shared heavy-task lease behind another worktree’s Vitest
run; do not treat that latest run as passed until it completes.
`audit:docs` passed
(1,162 docs, 833 links, 182 ADRs), `audit:emoji` passed, and `audit:tokens`
passed all 324 pairs in three themes. `pnpm verify:affected` still stops in
Tier 0 on the untracked `packages/codegen/src/bundle-assets.ts` formatter
difference owned by concurrent work; neither it nor the other concurrent
untracked `packages/scene/src/nodeResize.ts` was modified. The required
architecture audit for the `CanvasArea` tool-context field was started, but
its completion result was not captured while another worktree ran the same
long audit; rerun it when that shared CPU-heavy audit finishes.

Exact-SHA CI for master commit `0245c169aae97f10d5a88c32ffd201a317cf8d7c`
passed. Website Deploy run `39136030071` for `daa308d1` failed four browser
cases: one install-guidance assertion still prohibited the PKGBUILD guidance
the page now correctly contains, and three visual captures used stale download
page baselines. The failed-run screenshots were inspected; the current source
baselines differ from the CI actual screenshots by 0.0053% (dark download)
and 1.1241% (Linux guidance), both within the visual test's 2% threshold. The
integration candidate's first correction was pushed as
`cf89909b61d271f15c86b86b2550946276c5bc3d`. Its CI passed all non-website
lanes, but Website Deploy `39141258752` found one more stale copy assertion
in both deployment modes: the Linux package table says “PKGBUILD recommended,”
not “recommended default for Arch.” The other 688 cases passed, including the
updated visual baselines. That wording correction was committed and pushed as
`558f97fdd`; its exact-SHA CI and Website Deploy quality gates and deploy
passed. On the next integration head, `3da083f54e5f5bcff02105aac9237326e4cb6797`,
CI and E2E Keyboard Nav are running and Website Deploy is queued.


## 2026-10-18: final read-only code review repairs

A read-only review of PDF export found two transparency gaps in text fast
paths: searchable and outlined text bypassed per-node blend state, and the
shared node opacity ExtGState set fill alpha without setting stroke alpha.
Commit `5d7561f28` scopes text output to the same node graphics state used by
the shape renderer and writes both PDF `ca` and `CA` alpha values. Regression
coverage checks searchable and outlined Multiply text plus fill and stroke
opacity. `cargo fmt --check` passed; `cargo test -p varve-print blend_mode`
passed 7 tests and `cargo test -p varve-print node_opacity_is_applied_not_commented`
passed 1 test.

The editor handoff is committed as `3da083f54e5f5bcff02105aac9237326e4cb6797`
on `master`, after `5d7561f28`. The final lease-wrapped Chromium run passed
1/1 in 51.9 seconds, including buffered handoff and undo. Its screenshot was
visually inspected at
`/home/kevina/CodingProjects/varve/.worktrees/photocraft-hardening/test-results/run-682421-1527/save-text-target-switch-sw-5e2cc-ed-draft-and-preserves-undo-chromium/text-target-switch.png`;
both text objects render, the selected first object shows the buffered draft,
and the inspector reflects that text. `node scripts/audit-docs.mjs` passed
(1,140 docs, 814 links, 178 ADRs), `node scripts/audit-emoji.mjs` passed
(5,308 files), and `node scripts/quality/audit-radius.mjs` passed with zero
legacy consumers. `cargo fmt --check`, `cargo clippy -p varve-print -- -D
warnings`, the 7 focused blend-mode tests, and the opacity test all passed.
The required architecture audit completed with 14 cycles (under the enforced
17-cycle cap) and zero layer violations. Its instability and unused-export
counts are report-only; the 76 unstable modules exceed the stored 55 reference,
so that known architecture debt remains visible and no baseline was changed.

The candidate plan selected 17 lanes with no full-suite escalation. Local
`pnpm verify:affected` could not complete in the task worktree because Tier 0
found an untracked formatter issue in another worktree; the integration clone
has no complete JS dependency tree. Exact-SHA CI for `3da083f54` completed its
preflight and is running the selected JS, Rust, and Playwright lanes. Website
Deploy for `3da083f54` is running; the immediately preceding code head's site
gates and deploy passed. Documentation-only follow-up `acdea6488` is on master
and its exact-SHA CI is queued. No full workspace suite was run.

## 2026-10-18 follow-up — Unicode PDF output and recursive text links

### Integration state

The prior two implementation commits are on remote `master` at
`2dfd8540307e1f86a403c3f80a32f2312ff8a7b4`:

- `173d6d9f1` — preserve authored stroke color alpha in PDF export.
- `2dfd85403` — record the PDF alpha evidence and watch `CHANGELOG.md` in
  Website Deploy.

Exact-SHA CI on the integration branch passed in run `39147245997`. The master
push triggered CI run `39150941272` and Website Deploy run `39150940960`; the
master CI passed all 39 jobs, and Website Deploy completed successfully with
its live smoke check. The deployed `/changelog/` route was visually inspected
at desktop width and showed the PDF transparency wording.

### New PDF Unicode reproduction and implementation

Starting commit was `2dfd8540307e1f86a403c3f80a32f2312ff8a7b4`. The Unicode
export batch is committed as `17e574d27bc6b9d2f4b559d1253b861a60e30789`
(`fix(print): preserve Unicode glyphs in subset PDF exports`) and fast-forwarded
to remote `master` through the normal pre-push checkpoint. Exact-SHA affected
CI run `39159848356` passed: planner and pipeline validation plus selected
Rust lanes on Windows, Ubuntu, and macOS. The push checkpoint passed history,
format/lint, `varve-print` tests and clippy, docs/emoji audits and Cargo fmt.
Master CI run `39161573299` passed, including pipeline validation and the
selected Rust lanes on Windows, Ubuntu, and macOS. Website Deploy run
`39161573285` passed both-mode website E2E, built-demo validation, artifact
verification, Pages deployment and live smoke check. The live
`https://varve.studio/changelog/` Unreleased entry was reloaded in the existing
Codex in-app browser and visually inspected at desktop width; its Unicode
limitation sentence is present and wraps cleanly in the PDF export fidelity
entry. The marketing feature page remains unchanged because it does not claim
Unicode text searchability.

The batch changes:

- Reproduced PdfCraft #3202's Polish text sample through Varve's PDF exporter
  with `subset_fonts=true`. The old Identity-H/CID-to-GID identity path emitted
  scalar values where glyph indices were required. Poppler rendered a blank
  page; `pdftotext` returned unrelated Latin characters. The PDF 32000-1
  `/CIDToGIDMap /Identity` definition is cited in findings §4.25.
- Removed the unverified CIDFont output path. Non-WinAnsi text now uses Varve's
  existing glyph-outline fallback. The same Poppler render shows
  “Łódź: zażółć gęślą jaźń” correctly. `pdftotext` returns no text for the
  outlined run; it is not searchable/copyable. Latin WinAnsi text remains on
  the native searchable-text path. This does not implement editing existing
  PDF text or satisfy Greek searchability.
- Added `crates/varve-print/examples/unicode_text_probe.rs`, the regression
  `export_pdf_subsets_extended_latin_as_glyph_paths`, before/after renders,
  architecture/changelog wording, ledger updates and recursive frontier edges.
  The feature page needs no claim change: it makes no Unicode text-searchability
  promise. Evidence PNG hashes: before
  `362d9f01dd025796e8bdfc1988df5952741d1872e6848e4792d2bbded6772da5`, after
  `69c4904c6132374218c91b2298789c67dd6a5c04c485d2e6306335ec00062358`.
- Followed #3202's #2918/#1835/#1821 references and #2918's #2101/#1869
  references. Varve RTL visual ordering and logical caret hit-testing are
  already covered by `paragraphLayout.test.ts`; the separate source PDF
  annotation and CJK font-discovery tasks stay outside Varve's PDF editor
  boundary. #1835's explicit Greek search/copy request remains open because
  outlined glyphs are not searchable.

### Review and validation

Review-agent workflow applied as a distinct second-pass self-review; no
qualified independent reviewer is available in this environment, so this is
not independent approval. The review checked the exporter branch ordering,
the limits of the glyph-outline fallback, deleted CID map construction, the
WinAnsi-only ToUnicode path, regression assertions, generated PDF and Poppler
renders, linked PR #3076's actual `/Differences` implementation and tests, and
the boundary between PdfCraft's existing-PDF editor and Varve's authored-text
export. No additional code finding was identified. Complex-script shaping,
font-resolution availability, and searchable Unicode PDF text remain separate
requirements, not claimed as solved here.

Validation for commit `17e574d27`:

```text
Changed scope: crates/varve-print; PDF text-platform docs; cutoff A/B ledgers, findings, frontier, continuation; Unreleased changelog; two Poppler evidence images.
Validation plan: pnpm verify:plan selected 7 lanes; FULL-SUITE NO (Tier 0 format/lint/docs/emoji; Tier 2 varve-print test/clippy; Tier 3 desktop Rust test).
Commands actually run: `pnpm verify:plan`; `pnpm verify:affected` (initially timed out waiting on another agent's lease); focused `cargo test -p varve-print export_pdf_subsets_extended_latin_as_glyph_paths`; Cargo example probes before and after; Poppler render/extraction/metadata inspection; `pnpm audit:docs`; Python ledger reconciliation; `git diff --check`; actual `git push` pre-push checkpoint; exact-SHA CI run `39159848356`.
Passed: focused regression; before/after independent Poppler visual inspection and output metadata; post-fix extraction loss matches the documented outline tradeoff; format; changed-file lint; emoji and docs audits (1140 docs, 818 links, 178 ADRs); ledger reconciliation; local push checkpoint including 194 `varve-print` tests and clippy; selected exact-SHA Rust CI on Windows, Ubuntu and macOS; pipeline/security validation.
Skipped as unrelated: full workspace suite and website E2E/full visual suite were not selected by the impact-aware planner for this Rust-only change.
Escalations: a separately dispatched full manual CI workflow run encountered two Playwright screenshot failures in unrelated canvas/UI specs. Its parent master full run passed all 39 jobs, and exact-SHA affected CI for this change passed. The full manual run was outside the planner-selected scope and is recorded in the session evidence.
Full suite run: no local full suite; one remote manual full-matrix diagnostic was run and failed on unrelated screenshots.
```

### Exact next steps

1. Finish the #2970 rendering thread follow-up: PdfCraft's issue, fixture,
   comments, and PR #2972 were inspected. Varve's authored-PDF Screen output
   was rendered with Poppler and its focused Rust regression passed; the
   screenshot is retained as `evidence/pdf-blend-screen-empty.png`. The exact
   PdfCraft PDF-viewer behavior has no matching Varve reader path. Recursive
   links #1968 and #1548 were verified as separate reader/annotation cases.
2. VectorCraft #827 and merged PR #884 are now reviewed. The Varve authored-PDF
   `DropShadow` writer omitted blend mode and alpha; a fix, blend/alpha and
   PDF/X-1a regression cases, and an eight-case Poppler probe are in the current
   worktree. The website copy and architecture/findings evidence are updated.
   `pnpm verify:plan` selects website checks, `varve-print`, desktop Rust, and
   website E2E. Emoji/docs/radius audits, website typecheck, and 307 website
   unit tests pass. Three earlier affected attempts timed out before Rust tests
   could acquire the shared heavy-task lease (first owner: full local gate
   Vitest; later owner: editor Vitest). A fourth was externally terminated
   during the website unit lane after typecheck; owned-process cleanup
   completed. A fifth ran the `varve-print` test and Clippy lanes, then failed
   in the desktop Rust lane when `/tmp` filled during native dependency
   compilation. Once all compiler processes exited, `cargo clean` removed only
   this worktree's generated targets and recovered 3.4 GiB. A sixth attempt
   passed all 198 print tests and crate Clippy, then failed during Tauri
   dependency compilation when its unique target exhausted `/` (`No space left
   on device`); no other agent's process was stopped. Cleaning only that target
   recovered about 4.4 GiB. The low-debug retry
   (`CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0
   CARGO_INCREMENTAL=0`) passed 198 `varve-print` tests, crate Clippy, 134
   desktop Rust tests, and both 307-test website unit lanes. Its E2E lane
   completed with 687 passed and 3 failed. The failures are the global GitHub
   Pages homepage light/dark and footer dark visual snapshots; each capture
   differs from baseline by one pixel in full-page height. All other E2E cases
   passed, including export-route axe checks in both themes on both site bases
   and export-route contrast checks in both themes on the custom-domain base.
   Do not refresh unrelated global snapshots for this content-only change. The
   eight-output Poppler probe now independently renders the shadow PDF as one
   200×200 pt PDF 1.4 page: pixel `(150, 100)` in the Screen shadow is
   `(255, 128, 128)` and unshadowed gray at `(10, 10)` is `(128, 128, 128)`.
   The PNG is visually inspected and linked from findings.md §4.7. Current
   full-page export-page captures at 1440×1000 and 390×844 are also visually
   inspected and linked there. The mobile layout has no horizontal overflow.
   The screenshot job waited behind the live shared Playwright lease for
   Inkscape SVG import visuals, then ran after it cleared without stopping or
   reclaiming that work. A final `pnpm verify:affected` rerun after the
   documentation/evidence updates passed its audits, website typecheck, 307
   website unit tests, 198 `varve-print` tests, and crate Clippy, then failed in
   the repeated desktop Rust lane: concurrent shared activity filled `/`, and
   Cargo failed writing its unique low-debug target with `No space left on
   device`. Once its compiler exited, `cargo clean` removed only this
   worktree's unique target and restored about 1 GiB; no other process was
   stopped. The same low-debug lane had passed all 134 desktop tests earlier.
   This last rerun exited before website E2E; the full earlier E2E result
   remains 687 passed and the three one-pixel global snapshots described above.
   The final validation plan selected format/lint (no
   Biome-compatible source files), emoji/docs/radius audits, website typecheck,
   website unit, `varve-print` tests/Clippy, desktop Rust tests, and website
   E2E. The completed full affected run's only failing lane was website E2E:
   687 tests passed and its three one-pixel global visual snapshots failed. The
   later docs/evidence rerun was blocked at desktop compilation by the shared
   disk exhaustion noted above. No full suite ran. The read-only review found no
   implementation defect and strengthened color-alpha coverage; it was done by
   the implementer, not an independent reviewer. The desktop app remains open.
3. Continue cutoff-A and cutoff-B recursive evidence and engineering queue.
   Cutoff A is 1,296 issues (30 full threads, 1,253 bodies, 13 title-only);
   cutoff B is 1,454 issues (37 still screened, 117 out of scope, 2 already
   handled, 2 implemented). The issue bodies are read, but relevant linked
   evidence, attachments and Varve workflows remain open as listed in
   `findings.md` and `link-frontier.jsonl`.
