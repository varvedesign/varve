# Continuation record

Last updated: 2026-10-21 (session 1).

## Frozen baseline

- **Cutoff A:** `2026-10-21T19:30:05Z` – `2026-10-21T19:31:11Z`.
  - 1,237 issues (531 open / 706 closed) and 2,221 pull-request records,
    reconciled against the search index; 4,964 comments over 50 pages.
  - Raw pages are outside Git at `/tmp/opencode/vectorcraft/raw/`, aggregate
    issue-page SHA-256 `59eb7225874acf08886b85c940d09cd9cf0443676f91030caa7d736f45702ef2`.
  - Do not move cutoff A.
- **Cutoff B:** not yet taken. It will be recorded here after the first
  integration pass, together with any newly created issues.

## Repository and ownership

- Worktree: `/home/kevina/CodingProjects/varve/.worktrees/vectorcraft-corpus`
- Branch: `feat/vectorcraft-corpus`, based on `origin/master`
  `2e8c5b018b00a85fde341a0acc3dc80cde042f83`.
- The main checkout at `/home/kevina/CodingProjects/varve` is **dirty** and
  314 commits ahead / 16 behind `origin/master`. Those 43 entries belong to
  other work: nothing was staged, reverted, stashed, or committed there, and no
  file from it was read for this task.
- `origin` is `https://github.com/K-Arthur/varve.git`; `varvedesign/varve` is
  the same repository and `master` is unprotected (admin permission confirmed,
  no branch protection). No push has happened yet.

## Task commits (local, not pushed)

| Commit | Scope |
|---|---|
| `54c5e8e21` | `fix(persistence)`: library save confirms the write before marking clean |
| `8e0523450` | `fix(engine)`: bounded Offset Path tessellation, real round joins, open-path endpoints |
| `f87e66c1d` | `fix(codegen)`: generic `font-family` fallback in exported SVG (quoted so it parses) |
| (pending) | `docs`: vectorcraft audit area, ledger, findings, website export guidance |

## Validation evidence

| Check | Result |
|---|---|
| `packages/editor/src/persistence/librarySave.test.ts` | 5/5 pass |
| `packages/editor/src/persistence` + `autoSaveService.test.ts` | 56/56 pass |
| `pnpm --filter @varve/editor exec tsc --noEmit` | clean |
| `packages/engine/src/pathOffset.test.ts` | 16/16 pass (4 new) |
| `packages/editor/src/geometry` + pathOffset | 41/41 pass |
| `@varve/codegen` suite | 383 pass, 1 skipped |
| `@varve/codegen` typecheck | clean |
| `pnpm audit:claims` | clean |
| `pnpm audit:docs` | clean (1148 docs) |
| Visual: exported SVG rendered in Chromium | before = Times New Roman (serif), after = `'Source Sans 3', sans-serif` → sans-serif; **this check caught that the unquoted form did not work** |
| `tests/e2e/canvas/offset-path.spec.ts` | **not run yet** — heavy-task lease held by another agent's `verify:affected` (pid 1792255). Must run through `scripts/quality/heavy-lease.mjs`. |

## Engineering status

Implemented and locally validated, awaiting integration:

- **F1** library save truthfulness (vectorcraft #1693 / #1685).
- **F2** bounded offset path + round joins + open-path endpoints (#1028).
- **F3** SVG generic font fallback (#3135).

Verified as already correct:

- **F4** SVG physical size (#864 / #2924 duplicate) — pinned by a regression test.
- **F7** hover/selection spatial index (#1280 / #1172) — existing grid index.

Open, recorded, not implemented:

- **F5** area-text overset is computed then discarded (#1471 / #2323 / #2769).
- **F6** PDF gradient stop alpha discarded by the shading sampler (#1140).
- Autosave failure visibility: `AutoSaveService.onStateChange` has no
  production consumer, so a user whose recovery writes keep failing is never
  told. Separate finding from F1.
- `HitTestEngine.queryWithTolerance` whole-document scan in master-placement
  mode.

## Corpus status

| Disposition | Count |
|---|---|
| `screened-relevant` (open work) | 830 |
| `outside-varve-scope` (reason recorded per row) | 398 |
| `verified-existing` | 3 |
| `implemented-pending-integration` | 4 |
| `applicable-requires-work` | 2 |

All 1,237 titles were read. Full threads were read for the issues behind
F1–F7 and the highest-severity integrity threads. The 830 `screened-relevant`
rows are **not** a verdict and **not** a completion signal; each needs a thread
review plus a Varve reproduction before it can be dispositioned.

## Exact next operation

1. Wait for the heavy-task lease to free, then run:
   `VARVE_E2E_PORT=1471 node scripts/quality/heavy-lease.mjs "e2e: offset path" -- npx playwright test tests/e2e/canvas/offset-path.spec.ts --project=chromium --workers=1 --reporter=list`
   Inspect `reports/vectorcraft/offset-path-round.png`; fix the spec or the
   geometry if it fails.
2. Resolve the reviewer's findings, re-run the affected suites.
3. Commit the audit docs and the e2e spec.
4. `pnpm verify:plan` then `pnpm verify:affected` on the integrated candidate.
5. Merge `feat/vectorcraft-corpus` into `master` and push; verify the pushed
   SHA on the remote. Report merge separately from deployment.
6. Take cutoff B, record it here, and remove the worktree only after the merge
   is confirmed on the remote.

## Blockers

- Heavy-task lease contention (another agent's `verify:affected`). This blocks
  only the browser E2E; every unit-level check above is complete.
- No blocker on the code; the remaining corpus work is a scope/time limit, not
  an access limit. No issue body, comment page, or attachment failed to fetch.
