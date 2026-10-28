# Phase 0 gap analysis — A-04 IntelligencePanel seam

**Status:** analysis complete 2026-10-28. A-04 is not ready to execute: the
baseline gate cannot pass from a fresh worktree, the declaration verifier the
protocol depends on does not exist, and the entry is larger than one seam.
**Inputs:** [RESEARCH.md](RESEARCH.md), the campaign plan, the file-size policy,
the remediation record, and this checkout measured on 2026-10-28.

**Measured state used below:**

- File-size guard: 6,064 files scanned, 964 over the 400-line cap, 960 tracked
  frozen entries, 4 untracked WIP files, 337,363 excess lines, 0 violations.
- A-04 target: 3,191 lines, baseline entry exactly 3,191, 40 top-level
  declarations, 11 tab components, 4 variant-UI components.
- Covering test: 259 lines, 9 it blocks, jsdom, real EditorProvider fixtures.
- Git: branch master at 80665933f; origin exists. 168 staged/modified paths.
  .file-size-baseline.json is staged as a new file and is absent from HEAD.
- Unknowns: whether another worktree edits this panel; whether the CSS cascade
  survives every tab move without a visual diff.

## Gap -> action -> owner -> prompt file

| ID | Gap | Action | Owner | Prompt file |
|----|-----|--------|-------|-------------|
| G1 | Batch A claims "one module per tab" but A-04 is 3,191 lines and cannot be one 3-File / 1-Seam task | Decompose A-04 into A-04a..h with one seam each; re-baseline after each | Campaign lead | 02-SEAM-EXECUTION-TEMPLATE.md |
| G2 | Batch definitions do not state whether A-D are disjoint by path or by concern | Keep path disjointness (A-04 target is unique); treat cross-batch order as a preference, not a dependency | Campaign lead | docs/plans/agent-infrastructure-campaign-2026-10-28.md |
| G3 | "Low risk" overstates A-04: SimilarTab imports inference decoding, IndexedDB embedding storage, and a worker pool | Reclassify the Similar seam as medium risk; require its own tests and a rendering check | Reviewer | 02-SEAM-EXECUTION-TEMPLATE.md |
| G4 | Baseline regeneration has no named owner and no single-writer rule per merge train | Name a baseline owner; only that owner runs --update, on a merged green tree, in the seam worktree | Baseline owner | docs/quality/file-size-policy.md |
| G5 | Baseline is not in HEAD; a fresh worktree has no baseline and audit:filesize fails or refuses | Commit the baseline adoption first, or copy it only with an explicit adoption commit; do not work around the guard | Campaign lead + baseline owner | 02-SEAM-EXECUTION-TEMPLATE.md (Step 3) |
| G6 | No rollback procedure for "seam lands but the ratchet does not go down" | Revert source and baseline together; a removed entry cannot be re-added by --update, so restore it by git revert, never --force | Seam worker + baseline owner | 02-SEAM-EXECUTION-TEMPLATE.md (Step 8) |
| G7 | No trend or aging record; only a snapshot baseline and a top-40 report | Add an append-only ledger row per seam: date, path, before/after lines, frozen count, excess lines, tests, PR | Docs owner | 01-RESEARCH-AND-GAP-ANALYSIS.md + 03 |
| G8 | A single frozen count hides stale entries and the 90+ day tail | Require aging buckets and last-action per entry in any ledger or workbench | Front-end owner | 03-FRONTEND-REMEDIATION-WORKBENCH.md |
| G9 | No remediation workbench exists (glob evidence in RESEARCH.md) | Queue the workbench as its own task under 03; do not fold it into A-04 | Front-end owner | 03-FRONTEND-REMEDIATION-WORKBENCH.md |
| G10 | Execution template is Go-oriented: go build/vet/test, gofmt/goimports, refactor_verify.py, godsplit planner | Use the Varve equivalents below; treat missing tools as blockers, not as optional | Tooling owner | 02-SEAM-EXECUTION-TEMPLATE.md |
| G11 | No declaration-level verifier exists for TS/TSX (no refactor_verify.py equivalent) | Add scripts/quality/verify-declarations.mjs using the TypeScript compiler API; compare before/after top-level declarations including non-exported ones | Tooling owner | 02-SEAM-EXECUTION-TEMPLATE.md (Step 6) |
| G12 | No godsplit planner exists for TSX; there are no doc-comment-aware block ranges | Add scripts/quality/godsplit-plan.mjs or require hand ranges in SEAM_SPEC.md with a reviewed declaration list; do not invent cut lines | Tooling owner | 02-SEAM-EXECUTION-TEMPLATE.md (Step 4) |
| G13 | Template worktree command uses origin/main; this repository's branch is master | Generate the worktree from master (or the reviewed integration branch); update the template | Tooling owner | 02-SEAM-EXECUTION-TEMPLATE.md (Step 2) |
| G14 | Template Step 9 commits and opens a PR; repository rules say never commit unless asked | The executing session stops at a reviewed diff unless the maintainer asks for a commit; record SHAs if asked | Seam worker | docs/agents/validation-and-workflow.md |
| G15 | Test realism is thin: 9 tests for 11 tabs; no Linter, Debt, Governance, Prototype, Layout, Components, or variant-table tests | Add a scenario test rendering every tab with a representative document before extraction; keep all 9 existing tests | Seam worker | 02-SEAM-EXECUTION-TEMPLATE.md (Step 7) |
| G16 | UI risk register (a11y, i18n, dark mode, empty/error/loading) is absent from the template | For A-04, record "no visual surface change" and preserve the existing ARIA/dialog/severity contracts; a workbench task must cover the full state matrix | Reviewer + front-end owner | 04-VISUAL-VALIDATION-AND-CLOSEOUT.md |
| G17 | Peer-hot files and 25 registered worktrees are not named per entry | Claim packages/editor/src/panels/IntelligencePanel.tsx, its test, and the baseline; stop if the panel is dirty in another worktree | Seam worker | docs/quality/concurrent-agents.md |
| G18 | --force has already been used for unrelated concurrent growth three times | Ban --force in seam commits; re-adoption is a separate reviewed task with a written reason | Baseline owner | docs/quality/file-size-policy.md |
| G19 | The template requires BACKLOG_LEDGER.md, SEAM_SPEC.md, and NEXT_PROMPT.md; none exist in the repository | Create the ledger and SEAM_SPEC template as part of Phase 0 or the first seam, with an explicit location | Docs owner | templates/NEXT-PROMPT.md (missing) |
| G20 | Claims are advisory and do not block, but nothing tells the worker which entries are already claimed | Run pnpm claims claim before work and record the claim id in SEAM_SPEC.md | Seam worker | docs/plans/agent-infrastructure-campaign-2026-10-28.md |
| G21 | The queue's definition of progress is only "frozen count non-increasing" | Define progress as count non-increasing AND the target ceiling lower AND excess lines lower; a split into two over-cap files is not progress | Reviewer | docs/quality/file-size-policy.md |
| G22 | Extracted files can themselves exceed 400 (ReviewTab ~451, SimilarTab ~503), which the guard refuses to freeze | Plan each destination under 400 before extraction; sub-split Review and Similar in the same campaign, not after a failed update | Campaign lead + seam worker | 02-SEAM-EXECUTION-TEMPLATE.md (Step 8) |

## 1. Batch definitions: disjoint, ordered, and realistic?

The four batches are mostly path-disjoint: A-04 names IntelligencePanel only;
A-05 scene/types.ts, A-06 product.mjs, A-07 wgsl_validation.rs, and A-09 the
workload runner touch different paths. No other entry names this panel or its
test. That part is sound.

Order is not actually enforced. B-01 (lib.rs Home extraction) landed before
A-04, and B-01 was marked partial. That is defensible, but the plan should say
order is a preference unless a dependency exists. The real dependencies for
A-04 are: a committed baseline, a declaration verifier, and a destination plan
where every new file is under 400 lines.

"Low risk, no behavior" is only true for the leaf tabs. The Similar tab uses
engine inference interfaces, platform IndexedDB storage, and a shared worker
pool; the Components tab carries four variant-UI components and a promote
dialog on the native Dialog contract. Treat A-04 as low risk for Linter,
Audit/Spacing, Governance/Debt/Prototype/Layout and medium risk for Review,
Components, and Similar.

## 2. Baseline regeneration procedure and ownership

The guard is conservative by construction: --update refuses to freeze a new
over-cap file or to grow a frozen entry, and prunes stale entries. That is the
right policy; the gap is operational.

**Procedure to adopt:**

1. Confirm .file-size-baseline.json is committed at the worktree base. Today it
   is not in HEAD, so Step 1 cannot be satisfied.
2. Create the worktree from master. Do not run --update in the shared checkout;
   its index currently holds a staged baseline from another session.
3. Before editing, run node scripts/quality/audit-file-size.mjs and record the
   target's current line count and the frozen total in SEAM_SPEC.md.
4. After the move and after tsc, biome, and the focused tests pass, run
   node scripts/quality/audit-file-size.mjs --update in the worktree.
5. Review the JSON diff, not just the exit code: added = 0, grown = 0, every
   other entry unchanged, and the target entry strictly lower (or removed only
   when the file is under 400).
6. Commit the source files, the new modules, the test changes, and the baseline
   in one change. --force is not permitted.

**Who:** one baseline owner per merge train. Workers never merge. If the target
entry is unchanged, the seam failed, even if the file shrank by a few lines:
the entry is the ratchet, not the line count.

**What prevents growth:** the script's refusal, the reviewed diff, the absence
of --force, and the staged check in verify:commit. The plan should also add the
explicit assertion in Step 5 to SEAM_SPEC.md; an exit-0 update is not proof that
only the intended entry moved.

## 3. Rollback

The baseline is one-way by design. That makes rollback a git operation, not a
tool operation.

- If the extraction is wrong before merge: discard the worktree; no baseline
  change has been made.
- If the seam merged and the ratchet did not go down: revert the source move and
  the baseline change together. Do not "fix" the baseline with --force.
- If the entry was removed prematurely: --update will refuse to re-add it, so
  restore the previous baseline blob with git revert/recheckout. Force is not a
  rollback tool.
- If a downstream caller breaks: revert the new module and the re-export, not
  just the panel router; the barrel is part of the public surface.
- Worktree cleanup happens only after merge or explicit close; an unmerged
  worktree is left for review, per the campaign worker rule.

## 4. Observability

Today the only signals are the baseline JSON, the report's top 40, and prose in
the remediation record. There is no timestamp, owner, age, PR, or trend, so the
campaign cannot distinguish shrinking from reshaping.

Adopt a ledger row per seam with: date, entry id and path, sub-seam name,
before/after lines, destination files and their sizes, frozen entry count,
excess lines, focused test counts before/after, declaration-parity result, PR
or commit, worktree, and elapsed time. The workbench can read this later; the
ledger is useful even without it.

Define "shrinking" as: frozen count non-increasing, the target entry's ceiling
lower, and total excess lines lower. A 3,191-line file split into two 1,600-line
files is not progress under this definition because both new files would be new
over-cap violations and --update would refuse them anyway.

## 5. Workbench and front-end

There is no workbench. The 03 prompt's trigger is therefore satisfied at the
program level, but not by this seam. The two must not be conflated:

- A-04 changes no operator-visible surface. It needs no workbench task, no new
  screenshots, and no new UI states.
- The program needs a workbench because the 960-entry queue has no aging,
  ownership, changed-line, or ratchet-trend view. That is a separate task with
  the 03 requirements (KPI strip, aging buckets, entry table, ratchet trend,
  drift block, empty/error/loading/permission states, keyboard access, no
  color-only status) and the 04 closeout.

If the workbench is built before A-04, it must not be used as a reason to skip
the baseline/verifier fixes; it is observability, not enforcement.

## 6. Accessibility, i18n, dark mode, empty/error/loading

A-04 must preserve, not improve, the existing UI contract:

- Tab semantics: tablist labelled "Intelligence tabs", tab ARIA controls and
  selected state, the More trigger outside the tablist, and the tabpanel
  labelled by the active tab or More trigger. The covering test asserts these;
  they are the acceptance test for the router move.
- Dialog: the promote flow uses the native Dialog contract (showModal focus,
  containment, Escape, focus restoration). Moving PromoteDialog must not
  reintroduce a div with aria-modal.
- Severity: icon plus text, not colour alone; the test asserts the svg and the
  "Error/Warning/Info:" text in .intelligence-severity-mark. The class name is a
  test contract.
- Empty/loading: Similar's "select an image or enter a description", Naming's
  async classification states, and "No issues detected" must keep their exact
  conditions.
- i18n: labels are hardcoded English (TAB_LABELS). That is pre-existing debt;
  do not fix it in a move commit, and do not add new hardcoded strings in the
  workbench without a decision.
- Dark mode: the panel styles come from inspector.css; moving the import or
  adding per-tab CSS can change the cascade in both themes. Keep the CSS import
  in the panel shell and verify one dark-mode render if the workbench or a
  screenshot is touched.
- If the workbench is built, it owns the full state matrix: loading, empty,
  error, permission-denied, and gate-blocked states, with visible focus and
  keyboard navigation.

## 7. Concurrency and peer-hot entries

The shared checkout currently has 168 staged/modified paths and a staged
baseline. The concurrency doc registers 25 worktrees; git worktree list shows
multiple checkouts, including several unmerged experiments. The baseline is a
single-writer surface, and the panel is peer-hot because UI sessions touch it.

Required controls: claim the panel, its test, and the baseline with pnpm claims
(advisory); create one worktree per sub-seam; never run --update in the shared
root; never hand-merge baseline JSON; merge sequentially and re-run the update
after a rebase. If the panel or its test is dirty in the main checkout, stop;
another session owns it.

The baseline's staged state is a specific hazard: a worker who runs --update in
the main checkout would rewrite another session's in-flight index entry. That
must be prohibited in the task prompt, not just discouraged.

## 8. Test realism

The 9 tests cover contrast findings, tab semantics, Naming, tab applicability,
Similar's empty state, and the promote dialog. They do not mount Linter, Debt,
Governance, Prototype, Layout, Components, or the variant table; Similar is only
tested empty. That is fixture-level coverage of a 3,191-line surface.

Before the first seam, add one scenario test that renders IntelligencePanel
through EditorProvider with a document containing a frame, a text node, and a
selected shape, visits every tab via the tablist or More menu, and asserts the
tabpanel is present and no error boundary fired. Keep the 9 existing tests and
their assertions; count tests before and after each seam. Add a Playwright
panel capture only if a visual change is claimed; for a pure move the required
statement is "no visual surface changed" backed by the jsdom assertions and a
zero-diff capture where practical.

When splitting the test file, every new file needs the // @vitest-environment
jsdom directive on its first line; that directive is the per-file analogue of
the build tag hazard in RESEARCH.md.

## 9. Varve-native equivalents for the Go-oriented execution template

The supplied template is explicitly Go-oriented: go build ./..., go vet ./...,
go test ./pkg/..., gofmt/goimports, tools/refactor_verify.py, and a
tools/godsplit_plan.py planner. Varve's stack is pnpm + tsc + vitest + node
scripts/quality/audit-file-size.mjs. There is no refactor_verify.py and no
declaration-level godsplit planner in this repository.

| Template step | Go command/tool | Varve equivalent | Status |
|---|---|---|---|
| Baseline build | go build ./... | pnpm check:agent (recursive tsc --noEmit, queued) | Exists |
| Static checks | go vet ./... | No direct equivalent; closest is pnpm exec biome check plus tsc plus the audits | Partial |
| Package tests | go test ./pkg/... -count=1 | pnpm test:agent packages/editor/src/panels/IntelligencePanel.test.tsx | Exists |
| Caller tests | go test ./... | pnpm verify:affected (affected plan) or a targeted test set | Exists, heavier |
| Format | gofmt -w | pnpm exec biome check --write | Exists |
| Imports | goimports -w | biome organize-imports | Partial; does not re-infer aliases |
| Declaration proof | tools/refactor_verify.py | None; propose scripts/quality/verify-declarations.mjs | Missing (blocker) |
| Cut planner | tools/godsplit_plan.py | None; propose scripts/quality/godsplit-plan.mjs or reviewed hand ranges | Missing |
| Hygiene gate | fak hygiene --gates GOD_FILE_GROWTH | node scripts/quality/audit-file-size.mjs | Exists |
| Commit checkpoint | none | pnpm verify:commit (staged file-size, agent map, health) | Exists |
| Worktree base | origin/main | master (origin exists; branch is master) | Different |
| Scope semantics | same-package move is a no-op | ES module move is not a no-op: file scope, exports, cycles, side effects | Different, critical |

The semantic difference is the most important gap: the Go protocol's proof
strategy starts from "moving a declaration between files in the same package is
a no-op". In TypeScript the module is the scope, so every moved declaration
needs an export/import decision, and module-level side effects (auditPool) move
with it. The verifier and the review must account for that, not copy the Go
assumption.

## 10. Recommended A-04 decomposition

Proposed sub-entries, each a separate 3-File / 1-Seam task. Line ranges are from
the current file and must be re-verified by the planner before cutting.

| ID | Seam | Destination | Approx. size | Notes |
|----|------|-------------|--------------|-------|
| A-04a | Shared tab model, labels, applicability, severity helpers | panels/intelligence/tabs.ts, SeverityMark.tsx | ~200 | Moves no tab; unblocks imports |
| A-04b | Linter tab and config editor | panels/intelligence/LinterTab.tsx, LinterConfigEditor.tsx | ~390 | Fits under 400 |
| A-04c | Review tab | panels/intelligence/review/ (2 files) | ~451 total | Must sub-split; medium risk |
| A-04d | Audit and Spacing | panels/intelligence/AuditSpacingTabs.tsx | ~174 | Low risk |
| A-04e | Naming, Governance, Debt, Prototype, Layout | panels/intelligence/ (3 files) | ~590 total | Group by concern, not alphabetically |
| A-04f | Components and variant UI | panels/intelligence/components/ (2 files) | ~580 total | PromoteDialog keeps Dialog contract |
| A-04g | Similar tab and embed/search helpers | panels/intelligence/similar/ (2 files) | ~560 total | Highest risk; own tests |
| A-04h | Panel router and re-export barrel | panels/intelligence/IntelligencePanel.tsx, root re-export | ~140 | Removes the baseline entry only if under 400 |

Every destination must be under 400 lines before --update; otherwise the guard
will correctly refuse to freeze a new violation and the seam will fail at Step
8. This is why the entry cannot be one task.

## 11. Blocking risks and definition of ready

**Blocking risks:**

1. **Baseline absent from HEAD.** A fresh worktree cannot run the gate; the
   staged copy belongs to the shared checkout. Fix by committing the baseline
   adoption before A-04 starts.
2. **No declaration verifier or planner.** The template's Steps 4 and 6 cannot
   be executed as written. Fix by adding the scripts or by an explicit,
   reviewed substitute that includes non-exported declarations.
3. **Destination files over 400.** A naive one-module-per-tab cut creates new
   violations and --update refuses them. Fix by the A-04a..h decomposition.
4. **Dirty shared tree and staged baseline.** Running --update in the root would
   rewrite another session's work. Fix by worktree-only updates and a claim.
5. **Thin tests.** Nine tests do not characterize seven of eleven tabs. Fix by
   adding the all-tab scenario before the first extraction.

**Definition of ready for A-04a:** baseline committed; verifier and planner
available or explicitly waived with a reviewed inventory; claims recorded; a
worktree from master; the all-tab scenario green; the baseline entry and excess
line count recorded. Until then, the correct action is to fix the campaign
tooling, not to start cutting the file.
