# LightCraft issue + PR corpus review — Varve audit area

Durable record for the review of [storytold/lightcraft](https://github.com/storytold/lightcraft)
as evidence for hardening Varve. LightCraft is a young, fast-moving pure-Rust
photo library / raw developer (egui desktop app, WASM web build, MCP control
channel). It is a **sibling product, not a Varve release channel**: its issue
reporter counts, camera-RAW complaints and performance reports are external
evidence; nothing here is a Varve defect until it is reproduced against Varve
source or a Varve workflow.

| File | Contents |
|---|---|
| `scope.md` | This file: frozen cutoffs, sources, retrieval, method, status vocabulary, baseline and limitations |
| `inventory.jsonl` | One line per lightcraft issue/PR: URL/id, state, dates, review depth, family, relevance, Varve mapping, priority, status |
| `inventory.summary.json` | Counts, review-depth tally, and SHA-256 of every bulk evidence file |
| `findings.md` | Canonical findings with explicit evidence levels and engineering status |
| `batches.md` | Per-slice record (research → implementation → validation → review → integration) |
| `continuation.md` | Running continuation prompt: exact next operation and next-slice brief |
| `opportunities.md` | Corpus evidence noticed outside the current slice; not silently absorbed |

## Frozen source cutoffs

| Cutoff | Window (UTC) | Enumerated | Notes |
|---|---|---|---|
| **L1 (frozen)** | `2026-10-28T17:10:57.432Z` → `2026-10-28T17:11:48.379Z` | 1,218 issues (627 open / 591 closed) + 2,047 PRs (1,058 merged / 771 open / 218 closed-unmerged) | Full `state=all` enumeration: issues endpoint 33 pages / 3,265 records; pulls endpoint 21 pages / 2,047 records; every pagination cursor followed |
| **L2 (reconciliation)** | Recorded in `continuation.md` after the session's implementation work | Delta only | A second declared cutoff for late arrivals; later records enter a follow-on queue, they do not move L1 |

Both listings were read with `sort=created&direction=asc&per_page=100` so IDs are
stable across pages. The issue endpoint returned the PR records too; records
with a `pull_request` field were separated and reconciled against the pulls
endpoint: 2,047 records in both, so the split is complete, not inferred.

### Source verification (revalidated at execution time)

| Source | Result |
|---|---|
| `https://github.com/storytold/lightcraft` | 200; default branch `main`; licence Apache-2.0 detected (`LICENSE-APACHE` + `LICENSE-MIT` = MIT OR Apache-2.0); issues enabled |
| `https://github.com/storytold/lightcraft/issues` | 200 |
| `https://github.com/storytold/lightcraft/pull/2491` | 200; open draft, `feat/kde-plasma-integration` → `main` |
| `https://github.com/storytold/lightcraft/projects` | **400 / inaccessible** — no project board is reachable with this token (project scope not granted). Recorded as an access gap, not as "no project". |
| `https://github.com/K-Arthur/varve` | 200 → redirects to `https://github.com/varvedesign/varve` (Varve repository of record) |
| `https://github.com/varvedesign/varve` | 200; default branch `master` |
| `https://varve.studio` | 200 (Varve site) |
| `https://getartcraft.com/apps/lightcraft` | 200 (lightcraft product page) |

Search-API reconciliation at L1: `repo:storytold/lightcraft type:issue` = 1,218;
`type:pr` = 2,047; repository `open_issues_count` = 1,398 = 627 open issues + 771
open PRs. All three agree with the paginated enumeration.

## Method

1. Enumerate **all** records with `state=all` and every cursor; split PR records
   from issues; reconcile against the search totals before trusting the counts.
2. Screen every record at title level into a failure family, then deep-read the
   bodies of the applicable/uncertain families (import/robustness, crash/data
   loss, export integrity, persistence, performance/memory, Linux platform,
   accessibility, undo/history, security). Comment threads are fetched only
   where the finding depends on the discussion; `review_depth` records exactly
   what was read (`title` / `body` / `body+comments`).
3. Map every surviving class onto a Varve code path with `path:line` evidence
   before designing anything. "Already handled" requires the proving file/test.
4. Implement the smallest coherent change for the selected slice; add a
   regression that fails against the previous behaviour; run the affected
   checks; review; document; commit; integrate.
5. Keep bulk evidence out of normal history: raw API pages and fetched comment
   threads remain in the gitignored `reports/lightcraft-corpus/` cache, with
   per-page SHA-256 in `data/manifest.json` and whole-file SHA-256 in
   `inventory.summary.json`. No third-party issue body is committed verbatim.

## Status vocabulary (research and engineering are separate)

| Research (`review`) | Meaning |
|---|---|
| `title` | Individually screened from the title/family classifier; body not read |
| `body` | Full issue/PR body read |
| `body+comments` | Body plus the fetched comment thread read |

| Engineering (`status` in findings/batches) | Meaning |
|---|---|
| `already-handled` | Verified in Varve source; proving file/test named |
| `implemented` | Change in this branch with regression coverage |
| `validated` | Reproduced/fixed on the real path and checked with evidence |
| `integrated` | Merged into the local integration branch (remote status stated separately) |
| `deferred` | Applicable work queued with a concrete next operation |
| `out-of-scope` | Outside Varve's product boundary or mechanism, with the reason |

A closed lightcraft issue is **not** evidence that a fix shipped; a merged PR is
evidence, not proof. Varve relevance is never inferred from a sibling product's
bug — the Varve code path is checked first. When an earlier Varve claim is
contradicted by that check, the correction is recorded in `findings.md`.

## Varve baseline at program start (2026-10-28)

- Canonical remote: `varvedesign/varve` (`K-Arthur/varve` redirects); default
  branch `master`; no branch protection at read time.
- Local `master` at HEAD `1301951a7` was **486 commits ahead / 149 behind**
  `origin/master` (`a771499b9`). The local checkout is the integration line used
  by concurrent sessions; the remote has divergent PR-merge history. This
  program therefore integrates into the local `master` and states remote status
  separately — it never force-pushes or rewrites shared history.
- Main checkout was dirty on entry (46 modified + 93 untracked files, other
  owners' uncommitted work). This program works in
  `.worktrees/lightcraft-hardening` (branch `feat/lightcraft-hardening`, based on
  `1301951a7`) and does not stage, revert, reset or stash any other owner's work.
- Environment: Linux CachyOS 7.2.9, AMD Lucienne iGPU, 8 threads, 22 GB RAM but
  a heavily-oversubscribed host (load average 10-20, `MemAvailable` ~1-4 GB during
  the session), 6.7 GB free disk at start. Concurrent sessions hold other
  worktrees and heavy-lease jobs. This is **not** a 4 GB-class validation host:
  no low-memory claim is made from it.
- Validation tooling note: the DSH workspace sandbox makes `$HOME` read-only, so
  `pnpm install`/store locks fail. The worktree instead uses hardlinked
  `node_modules` copied from the main checkout and runs tools directly
  (`node node_modules/vitest/vitest.mjs …`, `node node_modules/typescript/bin/tsc …`).
  `pnpm verify:plan` and the audit scripts are run directly with `node`.
- The file-size baseline (400-line budget) was copied from the main checkout for
  local auditing; over-cap files (`exportService.ts` 791, `ExportLayer.tsx` 556,
  `naming.ts` 431) are treated as frozen/shrink-only by this program.

## Access and coverage limitations (recorded, never assumed away)

- The GitHub **projects** surface is not accessible with this token (400).
- The issue endpoint's comment lists are not embedded; only threads fetched for
  applicable/uncertain families were read (31 threads / 175 comments). Remaining
  applicable bodies are marked by their actual `review_depth`; they are not
  claimed as read.
- Attachments/screenshots/videos from lightcraft issues are external evidence and
  were **not** downloaded (rights + size + no need for a Varve decision this
  session); the finding text is used, not the media.
- Merged lightcraft PRs are not proof of shipped releases; "merged" here means
  merged into `main`, not released.
