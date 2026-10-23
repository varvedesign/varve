# PDFCraft review — closure draft, not certified

**Status correction, 2026-10-23:** this review is **not complete or integrated**.
The earlier green gate checked disposition labels, not whether the required
investigation had happened. Its “terminal, evidence-bearing” success message
was too strong. Do not use that transcript or the terminal labels as a
completion certificate. This document is the current task checkpoint.

- Branch: `codex/pdfcraft-closure-20261023`, based on `6eebb9581`.
- Worktree: `.worktrees/pdfcraft-closure`; preserve it until integration is
  validated and confirmed. The primary checkout contains unrelated work.
- Source: <https://github.com/storytold/pdfcraft/issues>.
- Gate: `pnpm audit:pdfcraft-closure`; fixture regressions:
  `node --test scripts/quality/audit-pdfcraft-closure.test.mjs`.
- Acceptance remains unchanged: adjudicate new/materially changed reports,
  inspect discussions/attachments and contradictory evidence, reproduce defects,
  validate actual browser/native workflows, review, obtain exact-candidate CI,
  merge and confirm on `origin/master`, then remove only this worktree.

## 1. Inventory, not investigation coverage

| Cutoff | List retrieval (UTC) | Discussions through (UTC) | Records | Issues | PRs | Open issues + PRs |
|---|---|---|---:|---:|---:|---|
| 1 | 2026-10-17T04:41:02Z–04:41:58Z | 2026-10-17T05:00:00Z | 2,978 | 1,296 | 1,682 | 827 + 583 = 1,410 |
| 2 | 2026-10-21T19:31:27Z–19:32:05Z | 2026-10-21T19:32:41Z | 3,903 | 1,790 | 2,113 | 1,044 + 843 = 1,887 |
| 3 | 2026-10-23T07:52:52Z–07:53:32Z | 2026-10-23T07:54:25Z | 4,208 | 1,951 | 2,257 | 1,103 + 725 = 1,828 |

Cutoff 3 has 43 listing pages and 6,761 repository-wide comments (including PR
threads). Its open total matches the retained repository metadata. The frozen
issue-ID SHA-256 is
`592a60bc77220c32de6c886e28c7a5ebe5a75e8c306fb6665f2d85d909773511`.
Retained raw data is local under `node_modules/.cache/pdfcraft-cutoff3/`; that
cache is not a portable committed evidence archive. Do not rerun its generator:
it overwrites later hand-corrected summary fields.

The delta contains **161 new issues and 200 earlier issues updated after cutoff
2**, not 361 earlier issues. The latter was the combined updated count including
new issues. The 838 earlier issues that are closed in the snapshot are **not**
838 proven closures since cutoff 2; that requires a historical state comparison.

The conservative full-evidence review inventory is **448 unique issues**: the
union of the 161 new reports, 200 earlier updated reports and 103 resolution /
citation-restatement rows. An updated timestamp is a materiality-screening
candidate, not proof of a material change. One full issue/discussion adjudication
(#3634) is now recorded below; **447 remain uncertified**. Partial reading and
tests for other issues do not satisfy that stronger acceptance. The IDs are recorded in
`cutoff3.summary.json` under `review`.

Cutoffs 1 and 2 remain immutable. Their TSV and JSON disposition counts disagree
(cutoff-2 JSON candidate/deferred/verified 10/1/17; TSV 9/0/19). The TSV is the
per-issue authority; retain and disclose the discrepancy. Earlier records also
cite a nonexistent `docs/adr/0242-document-authority-and-interchange.md`.
Current source/test citations do not retroactively establish that missing ADR.

## 2. Declared dispositions are provisional

| Latest declared label | Count |
|---|---:|
| cluster-assessed | 1,446 |
| outside-varve-scope | 320 |
| implemented-validated | 116 |
| verified-already-correct- | 66 |
| candidate / deferred | 3 / 0 |

These are the existing annotations, **not independently certified outcomes**.
`resolutions.tsv` proposes 88 inherited resolutions and 15 citation restatements.
Several reasons say “not measured”, rely on source structure, or infer soundness
from a shared path; those are not runtime verification. New rows and resolutions
must be adjudicated, corrected or reopened as the evidence warrants. Inherited
implemented rows without code/test paths also remain provenance gaps; append
restatements rather than rewriting frozen ledgers.

The gate now rejects missing/malformed ledgers, duplicate issue IDs, stale
resolution ancestry, unsupported dispositions, inconsistent totals/hashes,
missing evidence paths and incomplete recorded review coverage. A blocker must
name both `command="..."; error="..."`; even a well-recorded blocker remains
non-terminal. A gate pass would establish only metadata/recorded-coverage
consistency, not behavioral correctness or integration.

## 3. Implemented work and remaining review

| Area | Existing implementation | Evidence and gap |
|---|---|---|
| Recovery provenance | `98b026365`: recorded paths renamed `recordedFileId` / `recordedFilePath` | Hostile-sidecar unit case; naming hardening, not a demonstrated prior active-path exploit |
| Restore failure | `38a8bc343`: `loadDocument` returns boolean; delete recovery only on success | Dedicated single/bulk failed-restore and real loader-outcome regressions added in the current follow-up |
| Export wait budget | `98b026365`: five-minute promise race; follow-up repairs | Three failing regressions reproduced overlap, cancellation-boundary and starved-timer bugs. Repairs stop later batch jobs, forward the abort signal to supported raster barriers and reject over-budget late results. This still does not forcibly cancel synchronous/native work; real pathological-export acceptance remains open |
| Surface isolation | `9169bcbd9`: development-only boundary probes | Browser containment/reload cases; not containment of a Rust process panic |
| Text alignment | `b0f7cefff`, corrected in `38a8bc343` | Centered alignment browser case failed with `start` before the fix; direction-aware default retained for RTL |
| Password bytes | `309c826f1`, type fixes in `38a8bc343` | Wipe-on-success/failure unit cases; immutable JS strings cannot be zeroized |

The temporary depth-blur kernel probe measured 20 / 775 / 1,804 / 5,999 ms at
512² / 1024² / 2048² / 4096². It was **not a full export**, not a pathological
export, and not a measurement at 64 MP. Extrapolation does not prove a legitimate
multi-effect export finishes inside five minutes. The constant is provisional.

### Source adjudication follow-up

- **#3634 — reviewed, remains candidate.** Read the [complete report](https://github.com/storytold/pdfcraft/issues/3634)
  and [both](https://github.com/storytold/pdfcraft/issues/3634#issuecomment-6289127966)
  [comments](https://github.com/storytold/pdfcraft/issues/3634#issuecomment-6335338150)
  in the frozen cache. There are no attachment links in those records. The
  requested watchdog cancels the interpreter at an operator boundary; returning
  early from a promise race is not equivalent. The last comment says a fix is
  being worked on, not that one shipped. Varve executor defects were reproduced
  by three failing unit cases before repair, but actual-work cancellation and
  end-to-end pathological-export verification remain open. No translation was
  necessary (these records are English).
- **#3917 — partial, reopened.** Read the body and both comments. The [last
  comment](https://github.com/storytold/pdfcraft/issues/3917#issuecomment-6336712928)
  describes proposed #4042 as OS-open-only and explicitly excludes file-watcher
  reloads and drag-and-drop. Acting on the “live document” is the reported
  danger, not a sufficient fix. Linked PR evidence and modal-apply workflows
  still need inspection; selection-clearing unit tests do not close this row.
- **#3923 — partial, reopened.** Read the body and its [comment](https://github.com/storytold/pdfcraft/issues/3923#issuecomment-6326291766).
  The source has two mechanisms (destination trust and uncapped sidecar reads).
  It calls severity low, contrary to the retained critical label. The previous
  Varve caller already omitted stored destinations, so the rename is hardening,
  not a reproduced prior overwrite exploit. First-save and read-boundary
  verification remain open.

## 4. Evidence already obtained (bounded claims)

### Browser and visual

Earlier focused Chromium runs passed overlay clipping, centered alignment, RTL,
three sidebar window sizes, and inspector/canvas isolation (canvas independently).
The combined nine-case capture run ended after eight passes during a restart;
there is no completed combined-run receipt. WASM fell back to the TS renderer in
those logs, so this is not WASM qualification.

Six captures were inspected and committed in `docs/screenshots/pdfcraft/`:

- `text-edit-overlay-1024x600.png`
- `text-edit-overlay-dark-1440x900.png`
- `text-edit-alignment-center-1440x900.png`
- `surface-isolation-inspector-1024x600.png`
- `inspector-tabs-1024x600.png`
- `inspector-tabs-1440x900.png`

The surface-isolation image is actually **1280×720**, despite its 1024×600
filename (PNG header checked). Do not cite that filename as small-window proof.
The WebKitGTK run
completed both font-availability cases and the small-window scroll/zoom clipping
case, then was interrupted; scaled viewport, alignment and RTL remain unverified
on that engine. Website rendered/keyboard/responsive checks are still outstanding.

PDFCraft attachments actually inspected: stills for #4030, #4028 and #4118, plus
one frame at 2 seconds of #4056's recording. That frame did not establish the
reported escape sequence. No claim of inspecting every attachment is supported.

### Native PDF output

The temporary native `varve-print` example generated PDF, searchable PDF,
PDF/X-1a and PDF/X-4 bytes. Poppler `pdfinfo`, `pdftotext` and rendered PNGs were
inspected: searchable text extracted as “Searchable text 2026”; outlined text
extracted empty, with a visible box for a missing `漢` glyph. PDF/X version markers
were present. **Markers and readability do not establish PDF/X conformance.**

The example and some logs were temporary, so the record is historical rather
than a reproducible committed native-app journey. Vite production bundling is
not a Tauri build/run. Full desktop GUI export/glyph-warning verification remains
open. `qpdf` was invoked and unavailable. The previous veraPDF-absence statement
had no recorded invocation; recheck rather than treating it as established.

## 5. Follow-on queue

The earlier query returned 50 post-cutoff issues; its recorded UTC timestamp is
unverified (possible local-time mislabelling). Titles were classified, but the
claim that every item repeats an adjudicated mechanism was not established.
`follow_on_queue_at_closure` is now null because closure has not occurred.
Re-query with a real UTC retrieval timestamp before final reporting. Do not
expand the frozen review indefinitely merely because the live tracker grows.

## 6. Validation and integration checkpoint

Historical focused evidence: 101 tests across seven editor files and a standalone
editor typecheck passed. E2E typecheck passed repeatedly. These do not replace
the selected affected closure or exact-candidate CI.

The last push attempt (`/dev/shm/opencode-push/push7.log`) ended after direct
tests, during website units; its process is gone and no remote branch exists.
There is no successful push, PR, merge or exact-candidate CI receipt. Earlier
attempts timed out or ran out of temporary storage. Do not keep retrying them
without a changed probe/environment.

`pnpm verify:plan --since origin/master` selected 28 lanes and full escalation.
That escalation has not been waived; do not describe it as an authorized false
positive. Affected/full validation, architecture and token audits still need
completion; native and website verification also remain open.

Next slices:

1. Finish gate/record corrections, keep the fixture regression results.
2. Finish actual-work cancellation/pathological-export verification; preserve
   the wait/abort and two-job regressions without claiming forced termination.
3. Finish independent review; the new failed-recovery-load checks passed in the
   focused 42-test run.
4. Adjudicate the review inventory with source discussion/attachment provenance.
5. Complete selected validation, native/website/visual checks and exact-candidate
   CI before merge. Confirm the merge SHA on `origin/master` before cleanup.

### Agent validation report — gate correction at `988f26858`

```text
Changed scope: scripts/quality/audit-pdfcraft-closure*; PDFCraft task records
Validation plan: full escalation on branch; affected plan required before commit
Commands actually run:
  node --test scripts/quality/audit-pdfcraft-closure.test.mjs
  pnpm verify:plan
  pnpm verify:affected
  pnpm verify:triage
  VARVE_FULL_GATE_REASON='PDFCraft closure gate infrastructure change: planner requires exact-SHA full certification' pnpm verify:full
  git diff --check
  pnpm audit:docs
  pnpm audit:imports
  pnpm audit:emoji
Passed: 14 fixture cases (9 exposed false passes in the previous gate);
  touched format/lint, docs, emoji, claims and policy lanes in triage;
  direct docs/imports/emoji audits and whitespace check
Blocked: affected exits 2 requesting full escalation; hosted full gate refuses
  an uncommitted non-master candidate. Triage ci-tools fails at
  scripts/quality/full-gate.test.mjs:92 with ENOENT full-gate-receipts.
Baseline comparison: git archive 6eebb9581 scripts extracted under
  /tmp/opencode/pdfcraft-baseline-6eebb9581; running its unchanged
  scripts/quality/full-gate.test.mjs reproduces the same ENOENT at line 92.
  This is a baseline tooling failure, not a passing lane or a waived gate.
Completion gate: intentionally incomplete; 448 reviews and 51 inherited
  implementation claims without code/test paths remain
Skipped as unrelated: no browser rendering changed in this gate-only slice
Escalations: affected/full integration remains required, not waived
Full suite run: no
```

### Follow-up validation — export wait and recovery outcomes

The three export regressions failed against the previous behavior (two renders
started after timeout; cancellation resolved as failure; starved-timer result
was saved). After repair, 42 tests passed across:

```text
pnpm exec vitest run packages/editor/src/exportService.nodeBudget.test.ts packages/editor/src/exportService.test.ts packages/editor/src/components/Shell/RecoveryManager.test.tsx packages/editor/src/context/__tests__/documentSwitchOwnership.test.tsx --maxWorkers=1
pnpm --filter @varve/editor typecheck
pnpm audit:tokens
pnpm audit:docs
```

The four-file run passed (42 tests, 226.94 s), the editor typecheck passed, all
324 contrast pairs across three themes passed, and token usage/docs audits were
clean. One earlier 120-second foreground test attempt was interrupted, not a
pass. A subsequent empty-filename timeout case is included in the next direct
checkpoint. The website guide now accurately scopes this to a render wait
limit in the next desktop release, not hard cancellation. No new rendered
website or native GUI validation is claimed.

The manual completion command now runs its fixture regressions before checking
the actual corpus. The actual corpus still fails intentionally: three reopened
candidates, 447 uncertified reviews and inherited citation gaps. No push, merge
or worktree removal is authorized by these local passes alone.

Current checkpoint: export/recovery/website-copy follow-up awaits its direct
commit checkpoint. The editor typecheck, committed-import audit (12,412 imports)
and emoji audit passed. The architecture audit **did not complete**:
`node scripts/audit-architecture.mjs --ci` failed in `runMadge` with `ETIMEDOUT`
while scanning `packages/editor/src/index.ts`, before enforcing final metrics.
That is not an architecture pass or a measured threshold regression. Do not
weaken its timeout or retry the same overloaded environment indefinitely.
Full/affected integration, native/browser/website workflow evidence and independent
review remain open. Do not start a duplicate push or discard this worktree after
a server restart.

Follow-up self-review inspected the actual export/recovery/website diff in two
passes: cancellation/deadline/write outcomes and repository standards. It
checked listener cleanup, disabled-deadline cancellation, late results, batch
failure reporting and restore-deletion conditions against callers/tests. No hub
imports or render/replay dispatch changed. This is not an independent review or
native/UI certification; the open mechanisms above remain explicitly unresolved.
