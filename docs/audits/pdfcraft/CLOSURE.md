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
candidate, not proof of a material change. Forty-nine issue/discussion/attachment
adjudications are now recorded below and in `source-adjudications.tsv`;
**399 remain uncertified**. Partial reading and
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
| cluster-assessed | 1,447 |
| outside-varve-scope | 313 |
| implemented-validated | 115 |
| verified-already-correct- | 66 |
| candidate / deferred | 10 / 0 |

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

The bounded source batch in `source-adjudications.tsv` read the complete frozen
bodies and discussions for #3910, #3911, #3912, #3915, #3916, #3921, #3924, #3926
and #3929. #3911's attached PDF was downloaded (hash/size recorded), its relevant
field/widget objects inspected, and its rendered page 5 read; no embedded
JavaScript was executed. The other eight reports contain no attachment links.
Three old outside-scope labels were reopened: #3916 also concerns page drags,
#3924 also concerns unbounded named-file reads, and #3929 includes asynchronous
reopen/duplicate/drag/count mechanisms. #3916 and #3929 are not counted complete
while their linked drag evidence and item-by-item applicability remain open.
This is seven completed source adjudications, not nine new runtime passes.
#3922's issue discussion and live #3956 follow-up were read
partially; it is not added to completed coverage.

A further partial read of #3919's complete body and three comments reopened its
implemented label: the issue is about worker launch/panic failures leaving state
stuck, not just JS exceptions or time limits. Its proposed #4043 explicitly
excludes OCR and discloses untested GUI-picker success flows. Linked evidence
and actual Varve provider reset/retry tests remain open; no completed-review id
was added for it. This also corrects its obsolete claim that later batch jobs
continue after an unresolved render timeout.

A second bounded batch completed source adjudication for #3940, #3944, #3945,
#3947, #3950, #3951, #3954 and #3957. All bodies and discussions were read; none
contains an attached file/image. Inline reproduction code was read but not
executed, and #3954's Discord origin was not independently inspected. The notes
distinguish absent PDF form/script/OCR/localization features from the general
principles they illustrate; no upstream fix or Varve runtime pass is inferred.
#3936 and #3937 were subsequently completed: both linked screenshots were
inspected, as were all six rendered pages of #3937's Tamil PDF. Hashes and
bounded observations are in the source notes. A still image does not prove a
view transition or the contents of a closed language dropdown; no upstream
crop/OCR runtime reproduction is claimed.

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

Earlier PDFCraft attachments inspected: stills for #4030, #4028 and #4118, plus
one frame at 2 seconds of #4056's recording. That frame did not establish the
reported escape sequence. No claim of inspecting every attachment is supported.
The later #3911/#3936/#3937 attachment inspections are detailed in the source
notes above and `source-adjudications.tsv`.

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
the actual corpus. The actual corpus still has ten open
candidates, 399 uncertified reviews and inherited citation gaps. No push, merge
or worktree removal is authorized by these local passes alone.

Current checkpoint: export/recovery/website-copy follow-up committed successfully
as `7a1392bef`; its normal commit checkpoint passed all 25 tests in the three
changed editor suites (44.83 s), including the empty-filename timeout case.
The worktree was clean when resumed. The editor typecheck, committed-import audit
(12,412 imports) and emoji audit passed. The architecture audit **did not complete**:
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

Resume notes: the linked #4042 integration-test patch
(`crates/ui-egui/tests/it/native_open.rs`) has now been read in full, as have its
production patches. It asserts actual modal recipients, saved/reopened output,
ordered/deduplicated intake, read failures, password retry/cancellation and
normal/full-screen dialog responses. These are inspected upstream tests, not
tests executed here, and that PR does not address reload/drop/general draft
ownership. Varve's shared Dialog uses native modality but does not publish a
document identity; ColorConversionHost keeps its open state while
ColorConversionDialog reads the current editor commands. The next probe is an
actual file-open completion under that dialog, not another selection-only test.
`shutil.which` confirmed both `qpdf` and `verapdf` unavailable in the previous
follow-up; PDF/X conformance remains unverified.

### Resume validation and source batch — 2026-10-23

The prior CI-tools failure is now diagnosed, not merely classified as baseline.
`commonGitDirectory({ cwd })` and `gitOperationState({ cwd })` created their
default Git adapter against `process.cwd()`, ignoring the supplied directory.
The full-gate fixture therefore stored receipts under the actual checkout's
common Git directory, not the fixture repository. The push-receipt helper had
the same defect. A real isolated repository/linked-worktree regression failed
against both old helpers before repair. The helpers now honor the requested
directory; no receipt identity, expiry, invalidation or release rule was relaxed.
This repair is committed as `98bc091ca`; its normal commit checkpoint passed
53 validation-policy tests plus formatting, health, emoji, contacts, impact,
interaction, secret and import-boundary checks.

Commands actually run for this slice:

```text
node scripts/quality/operation-history.test.mjs
node scripts/quality/validation-receipts.test.mjs
node scripts/quality/full-gate.test.mjs
pnpm exec biome check scripts/quality/operation-history.mjs scripts/quality/operation-history.test.mjs scripts/quality/validation-receipts.mjs tests/e2e/save/recovery-destination.spec.ts docs/audits/pdfcraft/cutoff3.summary.json
pnpm audit:docs
pnpm audit:imports
pnpm audit:emoji
pnpm audit:tokens
pnpm audit:pdfcraft-closure
```

The last command passed its 14 fixtures, then correctly failed the real corpus
at six candidates, 440 outstanding reviews and 51 inherited citation gaps;
reopening #3919 subsequently raised the candidate count to seven. Imports
checked 12,413 committed relative imports; contrast checked 324 pairs. These
are not full-suite certification. Actual shell versions are Node v22.23.2 and
pnpm 11.9.0, not the Node 26 toolchain recorded in AGENTS.md.

`tests/e2e/save/recovery-destination.spec.ts` adds a real IndexedDB recovery →
cancelled first Save → chosen Save workflow, including an existing Library
file's stolen id and a hostile recorded disk path. Its first affected attempt
stopped on formatting. The next passed format/lint, docs, emoji, claims and E2E
typecheck, waited for another task's heavy lease, then failed in test collection
because importing the scene barrel loaded browser-only `import.meta` code into
Node. The fixture is now data-only and still decodes/migrates through the actual
UI path; there is no browser-workflow pass yet. Do not count a test-collection
failure as a product reproduction. The first triage retry stopped on formatting
in the new helper test; that is repaired. The subsequent triage
(`sh_16af31bff001XCR1duLpRtWQGM`) passed format/lint, docs, emoji, claims,
E2E typecheck (53.8 s), policy (60.3 s), and the complete selected CI-tools lane
(324.6 s), including the formerly failing full-gate fixture. Its recovery E2E
waited behind other live leases for 600 seconds and hit the lease deadline
without launching a browser. This is a resource-admission blocker, not a
workflow failure or pass. The exact-spec retry through the normal lease
(`sh_16b16de57001PwSv98teXh3qz9`) subsequently launched Chromium and failed:
the recovery dialog was absent after reload and creation of `Untitled 2`.
It failed before Restore or any Save assertion. Artifacts are preserved under
`test-results/run-486452-1547/save-recovery-destination--cc8d4-rwrites-recorded-provenance-chromium/`
(`trace.zip`, `error-context.md`, `test-failed-1.png`). WASM fell back to TS;
this is not WASM qualification. No validation process remains active.

The helper-repair nine-path plan selected touched format/lint, docs, emoji, claims,
E2E typecheck, policy, CI-tools and the recovery E2E. `pnpm verify:affected`
returns 2 for mandatory full escalation because validation infrastructure
changed. Exact-candidate full certification remains required. The previous
hosted refusal (dirty/non-master candidate) has not been waived; repeating that
unchanged prerequisite failure is not useful. No full suite was run. Rust,
website and global visual suites were deliberately not rerun for this localized
tooling/test/source-record slice; the earlier branch-wide obligations remain.

```text
Changed scope: local validation cwd/receipt helpers and their real-Git regression;
  recovery first-save E2E; PDFCraft source adjudication records
Validation plan: nine paths selected nine lanes; final full gate required for
  validation-infrastructure changes
Commands actually run (in addition to direct checks listed above):
  pnpm verify:plan
  pnpm verify:affected
  VARVE_E2E_PORT=1547 pnpm verify:triage
Passed: all selected non-browser lanes; 53 commit-checkpoint policy tests;
  three direct helper/receipt/full-gate fixture scripts; docs/imports/emoji/tokens
Blocked: recovery E2E not launched within the lease's 600-second deadline;
  exact-candidate full gate and corpus completion still outstanding
Skipped as unrelated: Rust, website and global rendering checks for this slice
Escalations: infrastructure change requires final full certification, not waived
Full suite run: no
```

The delegation-permission question was interrupted by a server restart without
an answer. No subagent approval is inferred and no review agent was launched.

After `98bc091ca`, the remaining six-path working-tree plan selects the seven
documentation/test lanes without a new escalation. That does not revoke the
branch's earlier full-gate requirement. Fresh E2E typecheck, touched JSON/test
formatting and docs audit passed. A direct
`node scripts/quality/audit-pdfcraft-closure.mjs` recheck reports the current
seven candidates and 430 pending reviews (expected incomplete exit 1); the
cutoff-3 disposition census and 20 unique, seven-column source-note records
were also checked for consistency. Frozen cutoff-1/2 files remain untouched.

The first two source batches and their evidence limits are committed as
`97e08d31b`; the normal five-file commit checkpoint passed. A third source batch
has since read the complete bodies/discussions for #3960, #3963, #3965, #3966,
#3968, #3973, #3975, #3979, #3980 and #3984, including all seven linked images.
The image hashes and observations are recorded in `source-adjudications.tsv`.
No private resume (#3968) was supplied, and the proposed print fixes were not
executed here. The reports distinguish unconfirmed causes, negative reproduction
evidence, absolute-page parity versus list position, and signature appearance
versus cryptographic validation. The slide-audio request #3963 is no longer
misdescribed as Office/EPUB interchange.

#3973 was reopened because its body includes ordinary editable text blocks, not
only PDF form fields. Source inspection confirms that Varve leaves Enter to the
native textarea; it does not prove newline persistence/rendering. A real
newline → commit/save/reopen workflow remains required. The current recorded
coverage at that third batch was **28 source adjudications / 420 outstanding**,
with **eight candidates**; this was not runtime or integration completion.

Fourth source batch: complete frozen bodies/discussions were read for #3986,
#3988, #3989, #3990, #3992, #3994, #3995, #3996, #3998, #3999, #4000 and #4001.
Both #3986 images and #3996's image were inspected; hashes and bounded
observations are in `source-adjudications.tsv` and the attachment inventory.
#3988 explicitly concerns all native file dialogs, so the old Reduce File Size
exclusion was reopened. #3998–#4000's private vulnerability reports were not
available: the notes cover public mechanisms only, not unseen exploit evidence.
Coverage at the fourth batch was **40 / 448**, with **408 outstanding and nine
candidates**. The fourth batch's census, 42 unique seven-column source-note
records and three attachment hashes were rechecked. `pnpm audit:docs`, touched
Biome and `git diff --check` passed; `pnpm audit:pdfcraft-closure` passed its 14
fixtures then correctly failed the actual inventory at nine candidates, 408
pending reviews and the inherited citation gaps. These checks do not satisfy
the pending browser/native/website/integration obligations.

Recovery investigation: the browser trace shows no recovery dialog or JS
exception before the assertion. `lifecycle/pageHideBoundary.ts` marks a clean,
non-BFCache unload as clean; the test had planted `'false'` while its existing
editor was clean and then used an ordinary reload. Hypothesis: pagehide rewrites
the planted marker to `'true'`, so the next editor correctly discards stale
recovery points. Next probe records the post-reload marker and exact recovery
key before mounting the next editor. No production change or weaker assertion
is justified until that observation is made. The exact probe is now running
through the lease (`sh_16b23b872001bG2LTj1hyvNSF6`); E2E typecheck and touched
formatting passed before it launched. No duplicate browser run was started.

Fifth bounded source batch: all frozen bodies/discussions for #4002–#4010 were
read. All five linked images and both pages of #4009's PDF were inspected;
attachment hashes and exact observation limits are in the source notes. These
are source inspections, not macOS font-scale, Windows printer or Varve fidelity
passes. #4007's Korean text says Hangul fails in filenames and search, not that
a UI-language pack is missing; the row was reopened for those real workflows.
#4004 is now mechanism-assessed rather than excluded as another product's CI:
`node scripts/pin-github-actions.mjs --check` passed all 13 workflows, while
`CODEOWNERS` and `docs/release/ci-secrets.md` explicitly disclose advisory
ownership/repository-level secrets under the solo-maintainer policy. No live
GitHub protection settings, signing execution or independent approval was
verified, and no repository settings were changed. Current recorded source
coverage is **49 / 448**, with **399 outstanding and ten candidates**.

Distinct self-review passes checked the actual helper changes against cwd,
linked-worktree and injected-adapter behavior, then standards and the affected
callers in full-gate, snapshots, operation journaling and push receipts. No
additional defect remained in that reviewed slice after repairing the duplicate
push-receipt helper. This is self-review, not independent integration approval.

Additional investigation, not completed source coverage: live #4039 is merged
at `fda1fee9d4c4c50018093745d45fa4883e59a963` (2026-10-23T14:43:05Z, after cutoff
3). Its body, two-line production change and complete 192-line pointer-regression
file were read. The tests check Undo/Redo/delete/replacement, retained Redo,
ordinary subsequent move/copy, and saved/reopened order; they were not executed
here. Varve PageNav resolves stable ids but has no equivalent observed
held-pointer/undo proof. For #3929, a repository-wide search found the Reopen
callback declaration and optional invocation only; no `onReopenLast` supplier
was found. A shortcut declaration alone does not establish an implemented live
reopen workflow. Keep both investigations open.

Further #3919 evidence: live PR #4043 is still open at
`d42d2812f3d3b019624a0ecb732c3db6c2cfb11f`. Its complete Export and Action Wizard
production/test patches were read, including injected launch failure, escaped
panic, poisoned progress locks, exact retry bytes, source-state preservation,
partial outputs/colliding names and locale checks. Tests were not executed here;
the author explicitly leaves GUI-picker success and Windows/macOS runtime
checks unperformed. Review comments also identify the undisclosed completed-file
count after partial failure. OCR remains excluded. Varve PDF/X goes from
`components/SpecPanel/export.ts` through `invoke('export_pdfx1a'/'export_pdfx4')`
to synchronous Rust commands in `apps/desktop/src-tauri/src/lib.rs`; those
command bodies have no local panic guard. This is not the upstream custom
thread-launch implementation, and JS rejection tests do not establish native
panic containment or provider reset/retry. Keep #3919 candidate; no runtime pass
or completed-source promotion is inferred from the upstream patches alone.
