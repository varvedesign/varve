# Continuation record

Last updated: 2026-10-18 (session 4).

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
  still require body and thread triage. Do not move cutoff A or B.
- Scope mismatch: user resolved the brief’s conflicting links as PdfCraft
  (`storytold/pdfcraft`); `storytold/photocraft` is a separate repo. See README.
- Thread-depth limits remain: 25 full issue threads, 1,258 full bodies, and 13
  empty-body title-only records. Relevant thread and attachment review is not
  complete; unresolved classes remain listed in `findings.md`.

## Repository and ownership

- Worktree: `/home/kevina/CodingProjects/varve/.worktrees/photocraft-hardening`
- Branch: `feat/photocraft-hardening`, based on `32de0c41c4e30defe14452f04e500a624ac2582b`.
  Task commits: `3524d07ee` (text draft save integrity), `f0c0ae563`
  (PDF blend/transparency fidelity and release-aware website copy), `9a7e447eb`
  (cutoff A corpus records/findings), and `5b2c3a409` (mobile website evidence).
- The main checkout has unrelated in-flight edits. Do not stage, revert,
  reset, stash, or commit them.
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

## Exact next steps

1. Screen all 158 cutoff B issue bodies, then inspect full threads and linked
   evidence for applicable or uncertain cases. Update the follow-on ledger with
   research and engineering dispositions without changing cutoff A.
2. Review new candidate classes against Varve source and tests before claiming
   defects; resolve high-impact applicable classes in progressive commits.
3. Continue the open applicable queue in `findings.md`: compositing backdrop,
   color-glyph/joining-control shaping, async generation guards, export
   fidelity and claims, bounded document-scale work, and dirty-state truth.
   Review deeper linked evidence for each relevant class.
4. Take cutoff B, reconcile arrivals, refresh project/remote/default-branch
   state, and integrate only after the owning untracked modules and affected
   validation are resolved. A push to `master` touching `packages/**` or
   `apps/website/**` runs `website-deploy.yml`; the assignment authorizes the
   normal task merge/push, but no separate manual release.

```bash
VARVE_E2E_PORT=1527 node scripts/quality/heavy-lease.mjs "e2e: buffered text save and close" -- \
  bash -lc 'TMPDIR=/home/kevina/.cache/varve-photocraft-tmp npx playwright test tests/e2e/save/text-draft-save.spec.ts --project=chromium --workers=1 --reporter=list'
```
