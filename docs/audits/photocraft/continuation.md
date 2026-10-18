# Photocraft review continuation

Last updated: 2026-10-17. Status: active and incomplete.

## Source boundary

- Repository: `storytold/photocraft`, issue tracker (not `storytold/pdfcraft`).
- First frozen cutoff: 2026-10-17 10:08:14 UTC; crawl interval 10:07:24–10:08:14 UTC.
- Frozen set: 3,275 issues and 3,683 PR records over 70 fully paginated REST
  pages; 4,900 issue-comment count reported by the issue records.
- First crawl cache and checksums: see `README.md`; raw body/comment responses
  live only under `/tmp/codex/photocraft-2026-10-17/`.
- All 3,275 issue comment endpoints were subsequently retrieved through every
  page from 10:29:00–10:31:14 UTC; 0 request failures. The retrieval cache is
  at `/home/kevina/.cache/codex/photocraft-2026-10-17/comments/`. Retrieval is
  complete, but comment review is not. One post-A comment (#6400 at 10:18:44)
  was found and is queued for B reconciliation.
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

- Issue bodies assessed: #6862, #5752, #6424, #1101, #6423, seed mismatches,
  and #6596–#6615/#6617 (21 issues); the rest of the frozen rows remain
  unreviewed.
- Full issue discussions: #6862, #5752, #6424, #1101, the five cutoff-B delta
  threads, and all 37 comments across #6596–#6615/#6617 are read. Other comment
  coverage is not complete. #6863 diff/files inspected; PR discussion and
  release status still require review.
- Link frontier: #6863; #5752; #6424; #1101; #6423's related link(s); #6392's
  #3641 / SolidCraft evidence; #6962's #2850/#2339/#2687; #6964's #3384/#6669;
  and all relevant links not yet enumerated from the corpus.
- Varve batch A: decode boundary, expression overflow, invalid open preservation,
  docs, unit tests, and Playwright visual test are implemented. The focused
  editor/scene run passed 111 tests; codegen passed 16 tests. The real Inspector
  Playwright test passed, and screenshots are retained under `evidence/`.
  Full affected validation and independent review are pending. A code-review
  finding for `__proto__` node IDs was fixed in a separate codegen commit. Prerequisite
  commits restored `packages/scene/src/nodeResize.ts` and
  `packages/codegen/src/bundle-assets.ts`, both already imported/exported by
  committed modules but missing from the clean base. The latter blocked the
  first browser boot; the first editor-provider test attempt also hit full
  `/tmp` tmpfs before its test could load.
- Website: current public claims reviewed; no change justified for this
  unreleased correctness fix.
- Save/recovery review (#6596–#6617): Varve already has external-change guards,
  session dedupe, IndexedDB recovery, and collision-aware export names. Strong
  candidates still need focused confirmation: same-target session ownership
  (#6597), native read-only replacement and metadata/hardlink behavior
  (#6600/#6602/#6603), stale temp files (#6604), dangling symlink replacement
  (#6605), large-document save memory (#6607), and malformed-setting field
  normalization (#6611). See findings as this work is split into batches; a
  separate research pass is still checking these paths before implementation.

## Branch and next actions

- Worktree: `.worktrees/photocraft-source-review`.
- Branch: `codex/photocraft-source-review`.
- Base: local `master` `1109bf5962091fb00aa34198876d1812327d808b`.
- Prerequisite commit: `98dec72b5` (cherry-picked repair of the missing
  `nodeResize.ts` module).
- Next: run the escalated local full gate with an explicit reason because the
  document serialization boundary changed. The targeted Playwright check ran
  through the heavy-task lease and its screenshots were inspected. Review the
  final diff with the requested review-agent workflow, repair findings, commit
  coherent batches, then refresh branch/remote state and integrate only through
  the repository's approved mechanism.
- Research next: reconcile cutoff B, assess every issue's body before deciding
  relevance, review every comment page and relevant linked evidence recursively,
  then implement each applicable, feasible finding in coherent validated
  batches. Do not treat this first fix or the ledger itself as completion.

## Validation record

- `pnpm verify:plan`: latest plan selected 47 lanes and
  `FULL-SUITE ESCALATION: YES` due to workspace/toolchain/validation-infrastructure
  scope. This is the stated reason for the escalation.
- Latest focused run: 3 test files passed (107 tests); the editor provider file
  hit `ENOSPC` while `/tmp` was full. Editor, scene, and E2E typechecks passed.
  Rerun the full focused set with `TMPDIR` pointed to `.codex-tmp`.
- Playwright passed (1 test, 1.9 minutes) through the heavy-task lease. Both
  screenshots were visually inspected. The renderer logged its existing WASM
  fallback to the pure-TS stub; the tested Inspector field remained operational.
- `pnpm audit:docs` and `pnpm audit:emoji` passed. `pnpm audit:radius` failed
  on pre-existing consumers in Presentation and SpecPanel CSS, none of which
  are changed by this batch; run remaining selected audits independently.
