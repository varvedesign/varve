# Continuation record

Last updated: 2026-10-17.

## Goal and scope

Review the Inkscape issue corpus and recursively investigate relevant evidence
to make verified improvements in Varve. The target is Inkscape's main vector
editor issue tracker (`gitlab.com/inkscape/inkscape`), not PDFCraft. User
clarification on 2026-10-17 supersedes the contradictory PDFCraft wording and
seed links in the attached brief. Do not expand the baseline to another
project.

## Cutoffs

- Cutoff A creation timestamp: `2026-10-17T10:03:35Z`.
- GitLab API count and reconciled crawl: 6,390 issues (2,112 opened; 4,278
  closed), 6,390 unique IIDs, zero duplicate rows.
- Full list/body crawl: completed across 64 pages from `2026-10-17T10:05:41Z`
  through `2026-10-17T10:08:41Z` UTC. Page 64 has 90 rows; all page totals
  reported 6,390. Creation dates span 2018-11-19 through 2026-10-16; no
  post-cutoff records were present.
- Raw cache: `/tmp/inkscape-corpus-2026-10-17/`; combined issue NDJSON SHA-256
  `f1e9f6be7cc3eaa8a7381b510bf89cad23858717e84dd6468126d81a80720d43`.
- List records report 32,680 notes across 5,667 issues. Discussion notes
  are being retrieved through GitLab GraphQL `Issue.notes` connections;
  thread review remains incomplete until the fetch and count reconciliation
  finish. At `2026-10-17T10:24:25Z`, 921 issue threads and 14,364 total note
  records (6,216 non-system comments) were cached. The fetcher is resumable and
  persists notes per IID in the external cache. Seven aliases per request
  succeeded below the observed complexity limit; eight scored 201 and failed
  the API's 200 ceiling. `user_notes_count` counts non-system comments; the
  GraphQL connection also returns system notes.
- Cutoff B: pending; take only after completing the baseline engineering pass,
  then record later arrivals separately.

## Repository/worktree

- Varve repository: `varvedesign/varve`; actual remote still points at the
  previous `K-Arthur/varve` URL, which GitHub resolves to the current project.
- Task worktree: `.worktrees/inkscape-corpus`, branch `feat/inkscape-corpus`,
  created from local `master` at `0241f1a63`.
- Local `master` is 143 commits ahead and 7 behind `origin/master`, with
  extensive uncommitted work owned by other sessions. Do not alter, stage, or
  commit that work. No remote integration or deployment has occurred.
- The earlier `feat/photocraft-corpus` worktree contains a separate, wrong-scope
  audit and the current turn's uncommitted experiments. Leave it untouched;
  this branch will not carry those changes into the Inkscape task.
- Do not stop other agents, their browser/app sessions, or their validation
  processes. The earlier queued browser run was this agent's own and was
  cancelled before acquiring the shared heavy-task lease.

## Completed

1. Read the supplied brief and project instructions.
2. Corrected source identity: GitHub mirror has no issues; official tracker is
   GitLab. Confirmed the tracker with GitLab's public API and reconciled the
   open/closed totals at cutoff setup.
3. Created this isolated worktree and source-boundary record.
4. Downloaded and reconciled all issue list pages and bodies. The inventory has
   6,390 rows and unique IIDs; 6,387 descriptions are non-empty. Per-page
   retrieval timestamps and checksums are preserved in the raw cache.
5. Built a one-row-per-issue ledger with source metadata and explicit pending
   screening, thread, evidence, engineering and visual status. Added a
   resumable GraphQL notes fetcher and started comment retrieval.
6. Screened issue bodies #6398 (save-time memory growth), #6380 (PDF text loss),
   #6477 (extension path rewriting) and linked #1313. Varve uses embedded,
   content-addressed image assets and strips repeated per-fill payloads, so
   #6398 is only an adjacent memory-risk hypothesis pending measurement. The
   #6380 PDF attachment returned HTTP 403; #6398's attached archive warns it
   can lock up the system and was not downloaded or executed.
7. Screened body #2800, a second historical Inkscape report of memory retained
   per save with a linked PNG. The reported archive was not downloaded. Current
   body-screening total is 5 of 6,390; threads and linked fix history for these
   candidates remain pending.

## Next operation

Complete and reconcile the reported 32,680 non-system comments, then screen
issue bodies and discussions for high-impact candidate failure classes. Keep
system notes for linked events and state history. Do not mark an issue
reviewed based only on its title, labels, or downloaded body. Do not use the
PDFCraft corpus as a substitute.
