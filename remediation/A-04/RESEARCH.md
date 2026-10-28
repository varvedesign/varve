# Phase 0 research — A-04 IntelligencePanel seam

**Status:** research complete 2026-10-28; implementation stays blocked until
[GAP_ANALYSIS.md](GAP_ANALYSIS.md) is accepted. Sources were found by web search
and fetched directly, not taken from the remediation record.

**Scope:** Batch A / A-04, packages/editor/src/panels/IntelligencePanel.tsx
(3,191 lines) to packages/editor/src/panels/intelligence/. Covering test:
IntelligencePanel.test.tsx (259 lines).

**Measured inputs (this checkout, 2026-10-28):**

- Target 3,191 lines, exactly its baseline ceiling (no slack), 40 top-level
  declarations, 11 tabs, 4 variant-UI components, 9 tests in the covering file.
- File-size report: 6,064 scanned, 964 over cap, 960 tracked frozen, 4 WIP,
  337,363 excess lines, 0 violations. The plan's 965/960 figure already drifted.
- Working tree: 168 staged/modified paths; .file-size-baseline.json is staged as
  a new file and absent from HEAD (git cat-file exits 128); target file is clean.
- No remediation workbench: globs for *Workbench* / *Remediation* under packages
  and apps return nothing; workbench text exists only in remediation prompts.

## 1. God-file seam extraction hazards (build tags, init order, aliases, raw strings)

**Approach should:** plan the cut with an AST-aware tool, then move declarations
with their comments and imports, preserving every per-file condition.

**Failure modes.**

1. Build constraints are lost or widened. Go includes source_windows.go only on
   Windows; moving its declarations to an untagged file compiles them everywhere
   ([go/build](https://pkg.go.dev/go/build#hdr-Build_Constraints)). The
   /modularize skill names per-file build tags as one of exactly three reasons a
   same-package move is not a no-op
   ([fak skill](https://github.com/anthony-chaudhary/fak/blob/main/.claude/skills/modularize/SKILL.md)).
2. Initialization order silently changes. Go initializes package state and runs
   init in lexical file-name order ([Go spec](https://go.dev/ref/spec#Package_initialization));
   moving an init across files reorders side effects. In Varve the analogue is
   module evaluation: auditPool = new AuditWorkerPool(...) is constructed at
   module scope (line 833), and imported module side effects run before the
   importer's body, with cycles able to leave bindings uninitialized
   ([MDN modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)).
3. Aliased imports are not re-inferred: goimports re-derives plain imports but
   does not copy x "path" (skill's third exception). The target has no import
   aliases, but the 47 lines containing backticks/template literals and its interleaved comments are
   literal text that a line-based cut can split; the refactoring study finds
   interleaved comments a recurring trigger
   ([arXiv 2409.14610](https://arxiv.org/abs/2409.14610)), and the reference
   verifier advertises a raw-string-aware fold
   ([refactor_verify](https://github.com/anthony-chaudhary/fak/commit/d7248b0272bc0c9bc06dab6d066fd50f0e72b4ce)).

**Guardrail:** a hazard row in SEAM_SPEC.md for per-file directives, module-level
side effects, import cycles, CSS import order (inspector.css is imported at line
106), aliases, and comments/literals. Move auditPool to a leaf module before any
tab imports it; keep the CSS import in the panel shell; each new test file keeps
// @vitest-environment jsdom on its first line. No new top-level side effects.

**A-04:** build tags and aliases do not apply; init applies only as module-eval
order; raw strings apply weakly; comments apply.

## 2. refactor_verify and dropped declarations

**Approach should:** prove the multiset of top-level declarations is unchanged
before/after, flagging DROPPED, RELOCATED, and OVER-SPLIT. The tool folds a git
ref against the working tree
([commit](https://github.com/anthony-chaudhary/fak/commit/d7248b0272bc0c9bc06dab6d066fd50f0e72b4ce)).

**Failure modes.** (1) A dropped but unreferenced declaration compiles clean:
the tool's motivation is a dead-but-real or exported-only symbol that go build,
vet, and test cannot see. In TypeScript, tsc catches unresolved references but
not an unreferenced private helper or an export dropped from a barrel while the
suite stays green. (2) Over-splitting or relocating changes the public surface;
a move to a new module without a re-export breaks consumers the panel tests do
not cover.

**Guardrail:** SEAM_SPEC.md lists all 40 declarations (name, kind, export flag,
destination). A new TypeScript declaration verifier compares git HEAD vs working
tree, including non-exported declarations. Until it exists A-04 is blocked,
because template Step 6 has no Varve equivalent. **A-04:** high severity, only
one of 40 declarations is exported.

## 3. God-file ratchet baseline regeneration

**Approach should:** allow updates only to remove an entry, lower its ceiling, or
prune a stale one, and make the diff reviewable.

**Failure modes.** (1) Regeneration re-derives a permissive ceiling: RuboCop
generates Metrics Max "just high enough so that no offenses are reported" and
--regenerate-todo refreshes the file
([RuboCop](https://docs.rubocop.org/rubocop/usage/auto_gen_config.html)).
Applied to size, regeneration after a partial split can restore the old ceiling.
(2) Stale entries and fingerprint drift hide accepted debt: entries become stale
when under the limit, and ratchet suppression only allows equal-or-better values
([skillsaw](https://github.com/stbenjam/skillsaw/blob/main/docs/baseline.md)).
(3) The escape hatch erodes: the remediation record shows --update --force used
three times in one day for unrelated concurrent growth (VectorizeWorkflow +2,
image-trace +7, varve-sync +5).

**Guardrail:** single-writer updates on a merged, green tree in the seam
worktree. Assert on the JSON diff: added = 0, grown = 0, exactly the target entry
lower or removed, everything else byte-identical. --force is banned in seam
commits; re-adoption is a separate reviewed task. Record frozen count and excess
lines after each seam. **A-04:** applies every sub-seam; the entry must fall from
3,191 and is removed only when the panel is under 400.

## 4. Automated codemod silent failures

**Approach should:** transform every matched file, report skips with reasons, and
exit non-zero when an intended edit did not happen.

**Failure modes.** (1) react-codemod #325 marks a whole file SKIP as soon as it
contains any React type import, even with runtime React.useState present
([issue](https://github.com/reactjs/react-codemod/issues/325)). (2) Parse errors
become "no change": jscodeshift guidance catches the parser throw and returns
undefined so the batch continues, which is indistinguishable from "nothing to
do" ([error handling](https://github.com/facebook/jscodeshift#error-handling)).
(3) The CLI reports success over skipped steps: opencrvs printed "Upgrade
completed successfully!" while warnings scrolled and one documented flag was
accepted then ignored
([commit](https://github.com/opencrvs/opencrvs-core/commit/fb227bcf38dccb20ddddaf64db6ce1bf2c771f0b)).

**Guardrail:** no codemod for A-04. Hand extraction with a fail-closed manifest:
11 tabs and 40 declarations mapped to destinations, every item checked after the
move. A missing tab or symbol fails the task and is never reported as "no change
needed". **A-04:** applies as a prohibition on agent-driven batch moves.

## 5. Sourcegraph Batch Changes limitations

**Approach should:** publish reviewable changesets from one spec, with errors and
skips visible at scale.

**Failure modes** ([Sourcegraph FAQ](https://sourcegraph.com/docs/batch-changes/faq)):
(1) default behavior stops creating diffs on repo errors, and -skip-errors
ignores errors, turning a partial batch into apparent success; (2) manipulating
tens of thousands of changesets "can be clumsy", with local Docker performance
and job parallelism as constraints; (3) multiple users cannot edit the same
organization batch change, branches cannot be reused across batch changes, and
only personal access tokens are supported.

**Guardrail:** one seam per PR, at most three files plus the seam, per-file
changed-line review, no repository-wide batch. **A-04:** applies as a sizing
rule; "split all tabs" repeats the large-batch failure.

## 6. Refactoring engine bugs

**Approach should:** preserve external behavior, check preconditions, and warn
when safety cannot be proven.

**Failure modes.** (1) The Eclipse/IntelliJ/NetBeans study found 242 compile
errors, 106 crashes, and 66 behavior changes, with incorrect transformations
(165), precondition checking (62), flow analysis (51), and type resolving (35)
as root causes; 97.1% were triggerable by default settings
([arXiv](https://arxiv.org/abs/2409.14610), [ACM](https://dl.acm.org/doi/10.1145/3747289)).
(2) Eclipse JDT issue 1530 moved two static members and changed output from
1/true to 2/false with no warning or exception
([issue](https://github.com/eclipse-jdt/eclipse.jdt.ui/issues/1530)).

**Guardrail:** move-only commit, no renames or unrelated formatting; the existing
jsdom suite plus a new all-tab scenario prove behavior; declaration parity
proves completeness. Any unexpected rendered/type difference fails the seam.
**A-04:** silent-change candidates are auditPool evaluation, hook-order-dependent
mounting, and CSS cascade.

## 7. Backlog dashboard UX (aging, stale risk, count hiding)

**Approach should:** show whether the queue is recovering, which items are stuck,
and who owns the next action, not only how many exist.

**Failure modes**
([Smart Statistics](https://smartstatistics.co.uk/your-backlog-total-is-hiding-the-problem-use-ageing-and-flow-to-find-stuck-work/)):
(1) a count-only view hides the tail: the total rose by seven while the risk sat
in 96 items older than 30 days; 40 arriving and 40 leaving can leave the total
unchanged while the oldest keep aging because easy new items finish first;
(2) equal weighting erases risk: a one-day routine task and a sixty-day customer
risk each count as one unit, and a stock-only total cannot answer who waits
longest or where work is blocked. (3) Locally, 960 entries are reported as one
number with no age, owner, last action, or PR in the record.

**Guardrail:** aging buckets (0-7, 8-30, 31-90, 90+), per-entry owner/last
action, batch progress, and a ratchet trend; a count appears only beside its age
distribution. **A-04:** seam does not touch the queue UI; the missing workbench
is a program-level gap (section D).

## 8. Visual regression with dynamic content

**Approach should:** capture before/after in one environment, animations and
caret disabled, volatile regions masked, with a documented threshold.

**Failure modes.** (1) Playwright issue 20987 reports screenshot tests "very
flaky" because assets load slowly and JS does not render in time; the
two-identical-screenshots stop condition can pass on a stable but incomplete
page, and the reporter's workaround was sleeping before screenshots on retries
([issue](https://github.com/microsoft/playwright/issues/20987)). (2) Playwright
threshold defaults to 0.2 and maxDiffPixels is unset; screenshots differ across
browsers/platforms because of rendering and fonts, and stylePath exists to
filter volatile elements
([snapshots](https://playwright.dev/docs/test-snapshots)). The animations option
defaults to disabled and caret is separate
([page assertions](https://playwright.dev/docs/api/class-pageassertions#page-assertions-to-have-screenshot-1)).
A 0.0 threshold is not a goal; 0.1-0.3 with a rationale is the closeout rule.

**Guardrail:** component-level captures, animations off, caret hidden, masks for
timestamps/volatile data, threshold 0.1-0.3 with written rationale; a pure move
asserts zero diff. **A-04:** applies only if a screenshot is captured; jsdom
assertions are the primary proof.

## Failure modes -> guardrails

| # | Theme | Failure mode | Guardrail | Varve enforcement | A-04 |
|---|-------|--------------|-----------|-------------------|------|
| 1 | Seam hazards | Build constraint lost/widened | Per-file directive row in SEAM_SPEC | tsc/biome + review | No |
| 2 | Seam hazards | Module-eval order changed | Move singletons to leaf; no new side effects | Import-cycle check | Yes |
| 3 | Seam hazards | Aliased import lost | Copy imports verbatim | tsc | No |
| 4 | Seam hazards | Literal/comment split | AST-aware cut, verbatim text | biome parse | Weak |
| 5 | Declaration parity | Dropped unreferenced declaration | 40-name inventory + verifier | New script (missing) | Yes |
| 6 | Declaration parity | Over-split/relocated export | One tab per file; barrel re-exports | tsc + review | Yes |
| 7 | Ratchet | Regeneration raises a ceiling | added=0, grown=0, target lower | audit-file-size diff | Yes |
| 8 | Ratchet | Stale entry or force re-adoption | Prune stale; ban --force | audit:filesize | Yes |
| 9 | Codemod | File silently skipped | No codemod; fail-closed manifest | New check | Yes |
| 10 | Codemod | Success over skips | Non-zero on unmapped tab/symbol | Script exit code | Yes |
| 11 | Batch UI | Large batch clumsy/errors hidden | One seam per PR, 3-file cap | Review size | Yes |
| 12 | Refactor engine | Silent behavior change | Move-only; before/after tests | vitest + scenario | Yes |
| 13 | Dashboard | Count hides aging tail | Aging, owner, last action, trend | Workbench (missing) | Program |
| 14 | Visual | Flaky/ambiguous screenshots | Animations off, masks, threshold | Playwright + 04 | If captured |

## B. Competitor and user-complaint analysis

**Codemod/batch tools fail at:** silent skips and false success (react-codemod,
opencrvs); type-check breakage after edits (242 compile errors in the refactoring
study); large-batch clumsiness and missing changed-line visibility (Sourcegraph
says tens of thousands of changesets are clumsy); and no per-item proof of what
should have changed but did not. We must not repeat any of these: every moved
declaration is accounted for, every tab is mapped, and the checking command
fails closed.

**Backlog dashboards fail at:** count-only reporting that hides the aging tail;
equal weighting of small and risky items; averages and totals that hide
distribution and stale ownership; and configuration-heavy admin panels that
obscure the next action. Our workbench must show the queue with batch, age,
owner, last action, ceiling, current lines, PR, and a ratchet trend, and must
block a regeneration that would add or grow an entry.

**Resolvable here vs out of scope:** in scope is a repository-local workbench
over the baseline JSON, git metadata, and a ledger, with Playwright captures. Out
of scope is multi-user editing of a live batch change, code-host orchestration,
and replacing the PR review UI.

## C. Edge-case register (A-04)

| # | Edge case | Status | Evidence |
|---|-----------|--------|----------|
| 1 | per-file build tags | does not apply | No Go/TS build tags; test jsdom directive is the analogue. |
| 2 | init() ordering across files | applies (analogue) | auditPool at module scope (line 833); module eval/cycles. |
| 3 | aliased imports | does not apply | No import alias in the target. |
| 4 | raw string literals | applies (weakened) | 47 lines contain backticks; copy verbatim. |
| 5 | receiver-qualified identity | does not apply | No methods/receivers. |
| 6 | same-named methods in one file | does not apply | No methods; watch helper collisions in one directory. |
| 7 | incomplete cut drops a declaration | applies | 40 declarations; only one export, so tsc is blind to some drops. |
| 8 | test-file exemption from ratchet | does not apply | Tests are scanned and counted. |
| 9 | generated files | does not apply | Target is hand-maintained, not in GENERATED_FILES. |
| 10 | parse failure in target | applies | biome/tsc must fail the move, never be suppressed. |
| 11 | grandfathered entry in slack band | applies | 3,191 = exact ceiling; one added line fails. |
| 12 | entry removed rather than shrunk | applies later | Stays over 400 until the last tab leaves. |
| 13 | baseline refusing add/raise | applies | Update refuses growth; no --force. |
| 14 | stale entry whose file disappeared | applies at end | Final barrel may drop under 400; update prunes. |
| 15 | touched entry ceiling ratchets down | applies | Every sub-seam lowers 3,191; unchanged is failure. |
| 16 | concurrent peer-hot conflict | applies/unknown | 25 worktrees, 168 dirty paths, baseline staged; panel ownership unknown. |
| 17 | rollback after failed extraction | applies | Revert source + baseline; removed entry needs git revert, not --force. |

## D. Front-end necessity gate

1. Operator-visible workbench change? **No.** No workbench exists, and rendered
   panel output must not change.
2. API response shape consumed by UI? **No.** No IPC, Tauri, store, or network
   contract is touched.
3. Error/empty/loading/permission states? **No.** Existing conditions and text
   must be preserved; several are asserted by the current tests.
4. Makes the 960-entry queue harder to understand? **No.** The baseline and queue
   are untouched by the move.

**Seam gate: NO.** Do not fold UI work into A-04. **Program gate: YES,
independently:** the 03 trigger includes "platform has no workbench for the
964-entry queue", which is true. Queue the workbench as its own task with 04
closeout; it is not a prerequisite for the seam and must not enter its PR.

## E. Gaps and blocking risks

Details are in [GAP_ANALYSIS.md](GAP_ANALYSIS.md). Three findings block A-04 now:
the baseline is staged but absent from HEAD, so a fresh worktree cannot pass the
gate; the template's declaration verifier and planner have no Varve
implementation; and one module per tab creates files over 400 (Review ~451,
Similar ~503), which --update must refuse. The entry needs sub-seams and the
campaign needs the missing tooling before any cut.
