# Continuation record

Last updated: 2026-10-21 (session 1).

## Frozen baseline

- **Cutoff A:** `2026-10-21T19:30:05Z` – `2026-10-21T19:31:11Z`.
  - 1,237 issues (531 open / 706 closed) and 2,221 pull-request records,
    reconciled against the search index; 4,964 comments over 50 pages.
  - Raw pages are outside Git at `/tmp/opencode/vectorcraft/raw/`, aggregate
    issue-page SHA-256 `59eb7225874acf08886b85c940d09cd9cf0443676f91030caa7d736f45702ef2`.
  - Do not move cutoff A.
- **Cutoff B:** `2026-10-21T20:41:01Z`. Four issues created after cutoff A
  (#3465, #3467, #3470, #3471) and two older issues whose status changed
  (#3446, #2523, both closed upstream). The four new records are reviewed in
  `issue-ledger-cutoff-b.jsonl`; they do not move cutoff A, and anything
  created after cutoff B belongs to the follow-on queue.

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
| `c6f479aa5` | `docs`: vectorcraft audit area, ledger, findings, website export guidance |
| `683153357` | `fix(codegen)`: whole-document SVG export keeps gradient fills |
| `e79389c3a` | `fix(engine)`: round only the outside of a turn (review finding), global point ceiling |
| `9cee9e7c8` | `test(persistence)`: editor-level library-save failure; codegen emits the engine default family |

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
| Visual: exported gradient document rendered in Chromium | before = flat dark rectangle, after = red→blue gradient |
| `pnpm audit:emoji` / `audit:tokens` / `audit:claims` / `audit:docs` | clean |
| `packages/editor/src/context/__tests__/librarySave.test.tsx` | 2/2 pass (editor-level failure and success) |
| `tests/e2e/canvas/offset-path.spec.ts` | **2/2 pass** through `scripts/quality/heavy-lease.mjs` (Chromium, web build, workers=1). Asserts Inspector dimensions: outward +200 adds 400 per axis, inward −60 removes 120. Captures inspected; see `evidence/`. |
| Website `astro check` | 0 errors, 0 warnings, 0 hints (201 files) |

## Engineering status

Implemented and locally validated, awaiting integration:

- **F1** library save truthfulness (vectorcraft #1693 / #1685).
- **F2** bounded offset path + round joins + open-path endpoints (#1028).
- **F3** SVG generic font fallback (#3135).
- **F8** whole-document SVG export keeps gradients (export/canvas agreement;
  visual before/after in Chromium).

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

## Cutoff B arrivals (reviewed)

| Issue | Disposition |
|---|---|
| #3465 `.ase` palette files missing from the picker | outside scope — Varve has no palette import UI (parsers exist unused in `@varve/shared`) |
| #3467 drag stroke colour onto fill does nothing | screened-relevant (paint/UI); unverified in Varve, same request as #2223 |
| #3470 masked artwork not rendered after save | uncertain — report needs the screenshots and a reproduction |
| #3471 taskbar treated as app area in full screen | outside scope — Tauri window chrome, not egui viewport |

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

## Integration record

- Branch `feat/vectorcraft-corpus` pushed and merged through
  **PR #165** (`https://github.com/varvedesign/varve/pull/165`).
- Merge commit on `master`: **`335b4ce966466624b474d072a8dbf8d9f28bccfd`**
  ("Merge pull request #165 from varvedesign/feat/vectorcraft-corpus"),
  verified on `origin/master` with `git fetch` + `git log`. 24 files,
  2,720 insertions.
- CI at merge time: `Change lanes` passed; the WASM/AppImage/Lighthouse lanes
  were still queued in a saturated runner pool. `master` has no branch
  protection and no required checks, so the merge was not gated by them. The
  pending lanes are **not** claimed as passing.
- `website-deploy.yml` run `39681379730` was queued for the merge SHA, so the
  docs page publishes to GitHub Pages. That is a site deploy, not a release:
  no tag, no installer, no version bump.
- Ledger dispositions for the four implemented findings are now
  `integrated-verified` with the merge reference.

## Remaining work

Reviewer findings: resolved — inner-corner arcs (high), global ceiling
   (medium-high), call-site regression test (medium-high), default font family
   (low). The miter-limit ratio (low) is pre-existing and left unchanged; it is
   recorded in `findings.md` as a follow-up rather than silently altered.
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
