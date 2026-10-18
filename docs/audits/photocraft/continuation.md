# Continuation record

Last updated: 2026-10-18 (session 4).

## Frozen baseline

- Cutoff A: `2026-10-17T04:41:35Z`–`2026-10-17T04:42:17Z`; 1,296 unique
  issues and 1,682 PR records, with pagination and search totals reconciled.
  Hashes and retrieval details are in `README.md`.
- Cutoff B is still pending. Re-query `state=all` with
  `sort=created&direction=desc`, diff against `issue-ledger.jsonl`, and record
  later arrivals separately. Do not move cutoff A.
- Raw crawl cache, outside Git: `/tmp/opencode/photocraft/`. If absent, re-crawl
  rather than reconstructing the evidence from notes.
- Thread-depth limits remain: 25 full issue threads, 1,258 full bodies, and 13
  empty-body title-only records. Relevant thread and attachment review is not
  complete; unresolved classes remain listed in `findings.md`.

## Repository and ownership

- Worktree: `/home/kevina/CodingProjects/varve/.worktrees/photocraft-hardening`
- Branch: `feat/photocraft-hardening`, based on `32de0c41c4e30defe14452f04e500a624ac2582b`.
  Task commits: `3524d07ee` (text draft save integrity) and `f0c0ae563`
  (PDF blend/transparency fidelity and release-aware website copy).
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
- Both changed export pages were captured at desktop width and visually
  inspected after the upcoming-release copy change. The page layout, current
  feature screenshot, navigation, and explicit next-desktop-release wording
  rendered correctly. Their evidence is in `evidence/website-export-*-desktop.png`.
  Mobile-width screenshots remain queued behind other agents' live heavy
  browser work. Playwright reported missing host browser libraries on later
  launches; system packages were not changed. A headless system Firefox capture
  is queued through the same shared lease.
- Editor, scene, website, and E2E TypeScript checks all passed after the
  current changes; Astro reported zero errors, warnings, or hints. Do not run
  the full suite; the planner did not escalate.

## Exact next steps

1. Let the queued Firefox website screenshots run after other agents' live
   heavy browser jobs. Inspect both mobile pages, click-check relevant links,
   and retain the visual evidence.
2. Complete a distinct second-pass self-review of the reproducible pixel
   probe and corpus docs; the PDF fidelity/site diff already received one.
   Keep corpus tracking in a separate documentation commit. Do not include
   either unowned source file above.
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
