# Phase 0 - mandatory research and gap analysis (Batch A, entry A-04)

Status: repo-native rewrite of the Go-oriented prompt. Applies to the Varve
repository (TypeScript/React editor, Rust engine). The execution target is
Batch A, entry A-04:
`packages/editor/src/panels/IntelligencePanel.tsx` (3,191 lines, frozen at
3191 in `.file-size-baseline.json`); covering test
`packages/editor/src/panels/IntelligencePanel.test.tsx` (259 lines, 9 tests);
seam destination `packages/editor/src/panels/intelligence/`.

## Rule

Do not plan and do not code yet. Produce `remediation/A-04/RESEARCH.md` and
`remediation/A-04/GAP_ANALYSIS.md` first. Implementation is blocked until both
exist and `SEAM_SPEC.md` (in the execution prompt) carries the declaration
inventory. Research means repository evidence first: read the canonical files,
measure the tree, and quote the command that produced each number. Use web
search only when a claim genuinely needs an external source, and never let a web
result override `AGENTS.md`, the policy docs, or the measured tree.

## Required reading (source of truth, in order)

1. [agent-context-remediation-2026-10-28.md](../../docs/quality/agent-context-remediation-2026-10-28.md)
   - five-defect matrix, ranked backlog row #6 (IntelligencePanel), Batch A
   definition, the completed `menu/defs.ts` (15 modules plus an 11-line barrel)
   and A-08 (84 tests before and after, baseline 961 -> 960) precedents.
2. [agent-infrastructure-campaign-2026-10-28.md](../../docs/plans/agent-infrastructure-campaign-2026-10-28.md)
   - per-split task protocol, worker rule, Batch A table, A-04 seam row.
3. [file-size-policy.md](../../docs/quality/file-size-policy.md)
   - 400-line cap, 350-400 split target, baseline lifecycle, `--update` and
   `--force` rules, seam tooling, generated-file exclusions.
4. [split-god-file.md](../../.ai/skills/split-god-file.md),
   [concurrent-worktree.md](../../.ai/skills/concurrent-worktree.md),
   [run-shared-validation.md](../../.ai/skills/run-shared-validation.md)
   - the three playbooks this task must follow.
5. [concurrent-agents.md](../../docs/quality/concurrent-agents.md)
   - worktree isolation, single-writer surfaces, staged-only validation, merge
     protocol.
6. [validation-and-workflow.md](../../docs/agents/validation-and-workflow.md)
   - validation economy, regression protocol, exact commands, heavy lease.
7. The target and covering test in line ranges; never read the whole 3,191-line
   file in one request. The JSON contract for the new seam tools is in
   `docs/quality/file-size-policy.md` ("Seam tooling") and in the tools
   themselves (`--help` is not implemented; invoke with no arguments to print
   usage).

## Measure before reasoning

Run and record in `RESEARCH.md`:

```bash
node scripts/quality/audit-file-size.mjs --report
grep -n 'IntelligencePanel.tsx' .file-size-baseline.json
wc -l packages/editor/src/panels/IntelligencePanel.tsx \
      packages/editor/src/panels/IntelligencePanel.test.tsx
node scripts/quality/godsplit-plan.mjs packages/editor/src/panels/IntelligencePanel.tsx --top 200
node scripts/quality/refactor-verify.mjs --base master \
  --target packages/editor/src/panels/IntelligencePanel.tsx --json
grep -rln 'IntelligencePanel' packages/editor/src --include='*.test.ts' --include='*.test.tsx'
git status --short
pnpm worktree:status
pnpm queue:status
```

The campaign's older "964 entries" count is stale; only the report on the
checkpoint tree is authoritative. The expected checkpoint state is 960 frozen
entries with 0 stale, and the target frozen at 3191 and 3,191 lines.

## A. Research themes (repository-native, not Go)

For each theme, record in `RESEARCH.md`: what it means for a declaration-level
move here, at least one concrete failure mode observed in this repository or in
the tooling, the guardrail this prompt adds, and the evidence (command output,
file:line, or URL).

1. **Module-evaluation side effects.** The target constructs a module-scope
   worker pool: `const auditPool = new AuditWorkerPool({ fallbackToMain: true })`
   at line 833, documented as "Singleton worker pool shared across all ReviewTab
   instances"; its constructor reads `navigator.hardwareConcurrency`. The target
   also has a side-effect CSS import (`import '../components/Inspector/inspector.css'`)
   and module-level model constants. Moving the Review tab must not construct a
   second pool, must not change when the pool is constructed relative to the
   panel import, and must keep the CSS import exactly once. A split that turns a
   singleton into one instance per module is a behavior change.
2. **tsconfig project boundaries and package exports.** The destination stays
   inside `packages/editor/src`, so it stays in the same tsconfig project and
   the same published entry surface (`@varve/editor` exports only `.` and
   `./auxiliary`). Do not add a cross-package import or a new entry point to
   make the move compile; the moved code keeps its existing `@varve/*` imports
   unchanged.
3. **Path aliases and import ordering.** Workspace imports use `@varve/*`
   aliases (engine, scene, ui, platform, prototype); relative imports inside
   `packages/editor/src` must be rebased by destination depth (for example
   `../audit/auditWorker` becomes `../../audit/auditWorker` from
   `panels/intelligence/`). One biome pass may order and format imports; do not
   hand-reorder semantically ordered code, and do not let a rebase break the
   side-effect import order.
4. **Template-literal and JSX code-like text.** The file contains dense JSX,
   rule ids, class names, and tool copy. A regex/brace-based mechanical cut can
   corrupt template literals or JSX text. Cut by declaration boundaries from the
   planner's ranges, never by line count or brace matching across strings.
5. **Overloaded and identity-sensitive declarations.** The public export is
   `export function IntelligencePanel({ initialTab }: { initialTab?: ExtendedTab } = {})`,
   imported by `packages/editor/src/components/Inspector/panels/AuditPanel.tsx`
   and by the covering test from the same module path. The move must keep that
   path exporting the same named component and keep the `ExtendedTab` /
   `initialTab` contract identical. There are no TypeScript overloads in this
   file; the equivalent risk is an export or symbol whose module identity other
   code depends on.
6. **Same-named private helpers in sibling modules.** The file has small
   helpers with similar responsibilities (`tabLabel`, `humanizeToken`,
   `severityLabel`, `isTabApplicable`, `candidateSignature`,
   `scoreBadgeClass`, `buildHistogramBars`, `loadImageToImageDataForAI`) plus
   tab-local helpers that may repeat across tabs. Each helper gets exactly one
   home in the destination directory; duplicate copies that drift are a defect,
   and extra exports are not the goal.
7. **Dropped declarations.** The planned inventory must be complete before the
   cut, and `refactor-verify` must pass before tests. A declaration that moves
   but is not exported, or is deleted by accident, fails the verifier; a
   declaration that is renamed is out of scope.
8. **Tracked-versus-untracked baseline policy.** The guard measures tracked
   content and reports untracked WIP separately. New destination modules are
   untracked until staged, so they are WIP-reported and never frozen; they are
   still subject to the 400-line cap the moment they are staged (`--staged` in
   `pnpm verify:commit`). `--update` never freezes WIP and prunes entries whose
   file fell at or under the cap.
9. **Stale and grandfathered baseline entries.** The A-04 entry must leave the
   baseline, not merely shrink, because the parent must end under the 400-line
   cap. A different stale entry or a grandfathered file that would grow is a
   blocker to report, never a reason to use `--force`. The ratchet is
   monotone non-increasing.
10. **Concurrent worktree conflict on peer-hot files.** The baseline, agent map,
    `BACKLOG_LEDGER.md`, `docs/README.md`, and `package.json` are single-writer
    surfaces; only one split updates the baseline at a time. Check
    `pnpm worktree:status` and `pnpm queue:status` before starting, claim the
    paths with `pnpm claims claim --task "A-04 intelligence panel split" --path ...
    --path ...` (advisory only), and never share a worktree.
11. **Rollback.** The seam is uncommitted until the commit step, so a failed
    extraction can be abandoned without touching anything else: discard only the
    task worktree's uncommitted changes for the paths this task created or edited,
    or leave the worktree unmerged for review. Never revert another session's
    files, never reset the shared checkout, and never commit a partial seam to
    "save" it. If the baseline cannot ratchet down, stop before committing.
12. **Rust-crate equivalents (does not apply to A-04).** There is no Rust seam in
    this entry. The equivalent Batch B risks are `mod` declaration/registration
    (a dropped `mod` or `generate_handler!` entry), `audit:ipc` registration
    parsing, and crate-root growth; they are verified by the package test suite,
    not by `refactor-verify`, which parses TypeScript/JavaScript only. Record
    this as "does not apply" with the reason so a future entry cannot silently
    inherit the wrong verification.

## B. Reference-tool and failure-mode analysis

Answer explicitly in `RESEARCH.md`:

- What do codemod and batch-refactoring tools fail at that this seam must not
  repeat (silent skips, false-success reporting, type-check failures after
  automated edits, large changeset review blindness)?
- Which of those failures are already prevented here by existing machinery:
  `pnpm check:agent` (types after the move), `refactor-verify` (declaration
  preservation), focused component tests (behavior), `pnpm audit:filesize`
  (baseline shrink-only), `pnpm verify:commit` (staged-only checks), and the
  split precedent evidence (`menu/defs.ts`, A-08)?
- Which risks remain untested or unknown for A-04 (module evaluation order of a
  singleton worker pool is the main one) and therefore become explicit checks in
  `SEAM_SPEC.md` and STOP conditions?

## C. Edge-case and gap register

Enumerate every applicable edge case in `RESEARCH.md`, marked
`applies / does not apply / unknown`, with evidence and the guardrail:

| Edge case | What to decide for A-04 |
|-----------|--------------------------|
| Module-eval side effects (worker pool, CSS import, model constants) | Where does `auditPool` live after the move; is exactly one instance constructed; does the CSS import stay once; does import order change any evaluation timing? |
| tsconfig project boundaries / package entry points | Does every new path stay inside `packages/editor/tsconfig.json` includes; are `@varve/editor` exports unchanged? |
| Path aliases and import ordering | Are rebased relative imports correct; is the side-effect import order preserved; did biome only format? |
| Template-literal / JSX code-like text | Are cuts on declaration boundaries only; did any string move or change? |
| Overloaded/method identity across modules | Does `IntelligencePanel` remain the same named export from the same path; are `ExtendedTab` and the `initialTab` prop contract unchanged? |
| Same-named private helpers in sibling modules | Does each helper have one home; are there duplicate copies; did any new export appear unnecessarily? |
| Dropped declaration | Is the inventory complete and did `refactor-verify` exit 0? |
| Parse failure in the target or a destination module | Does `godsplit-plan` parse the target; does `pnpm check:agent` parse every new module? |
| Tracked-vs-untracked baseline policy | Are new modules kept under 400 lines before staging; is no WIP being frozen? |
| Stale / grandfathered / slack-band baseline entry | Does exactly the A-04 entry leave; are there other stale entries; is any frozen file grown? |
| Baseline regeneration refusing to add or raise | Does the tree allow `--update` to complete with 0 added and 0 grown? |
| Test-file exemption from the ratchet | Tests count as source here; the covering test is 259 lines but any test edit must stay under 400. |
| Generated files and exclusions | `vendor/**` and three generated data tables are out of scope; do not touch them. |
| Concurrent worktree conflict on peer-hot files | Is the target claimed; is another split touching the baseline, map, or ledger? |
| Rollback path | Is the seam still uncommitted; which paths can be discarded without touching another session? |
| Unknown/unresolved tools | Do `godsplit-plan` and `refactor-verify` exist in the checkpoint and parse the target? |

## D. Front-end necessity gate

This repository has **no remediation workbench**: the frozen queue is
`.file-size-baseline.json` plus `BACKLOG_LEDGER.md` plus docs, read by agents
through commands. Do not plan UI work for Batch A, and do not build a dashboard.

Answer every question with evidence, then record the verdict in
`GAP_ANALYSIS.md`:

- Does this seam change anything an operator sees or does in a remediation
  workbench? **No** - no workbench exists and none is in scope; A-04 is a pure
  move that must render identical UI.
- Does it change an API response shape consumed by the UI? **No** - internal
  module move; the exported `IntelligencePanel` symbol and prop contract stay
  identical.
- Does it change error, empty, loading, or permission states? **No** - code moves
  verbatim; any such change is a defect, not a feature.
- Does it make the 960-entry queue harder to understand? **Not applicable** - the
  queue is not a UI; it is the baseline, the ledger, and the report commands.

Verdict for A-04: **no front-end work; the necessity gate does not fire**. The
only UI-adjacent requirement is proof of identical rendering: the covering
component test (9 tests) must pass unchanged before and after, and
`SEAM_SPEC.md` must state "no visual surface changed". If any answer changes to
yes, open `03-FRONTEND-REMEDIATION-WORKBENCH.md` as a bounded gate and link
`04-VISUAL-VALIDATION-AND-CLOSEOUT.md`; never fold UI work into the seam.

## E. Required content of GAP_ANALYSIS.md

Write `remediation/A-04/GAP_ANALYSIS.md` with a table whose columns are
`Gap -> action -> owner -> prompt file`. Cover at least:

- **Batch definitions and order:** are Batch A entries disjoint and is A-04 the
  correct next entry (compare the ranked table, the batch table, and the ledger)?
- **Baseline regeneration:** who runs `--update` (the seam worker, in its
  worktree), how the diff is reviewed (exactly one removed entry), what prevents
  growth (`--update` refusal; `--force` forbidden), and who regenerates after a
  merge (the orchestrator on the merged tree).
- **Seam tooling:** `godsplit-plan` gives ranges but not destinations; the
  declaration inventory and seam decision are review artifacts in `SEAM_SPEC.md`.
  `refactor-verify` covers TypeScript/JavaScript only; Rust seams use package
  tests.
- **Rollback:** what happens if the seam lands but the ratchet does not go down
  (stop, do not commit); how a failed extraction is discarded without touching
  other sessions.
- **Observability:** how we know the queue is shrinking rather than changing
  shape (FROZEN_COUNT and excess lines in `--report`, one ledger row per seam,
  monotone ratchet); there is no dashboard.
- **Front-end, accessibility, i18n, dark mode, empty/error/loading states:** not
  applicable to a pure move, with the component-test proof and the
  "no visual surface changed" statement.
- **Concurrency:** which entries are peer-hot (baseline, map, ledger,
  `docs/README.md`); how a worktree avoids collisions; advisory claims.
- **Testing:** are the component tests a real-world scenario or only fixtures?
  The covering suite mounts `EditorProvider`, establishes selection state, and
  exercises contrast, naming, applicability, similar-search, and the promote
  dialog; record why that is sufficient and what it does not cover (no
  end-to-end desktop run).
- **Docs index:** this entry adds only `remediation/A-04/*`, which is outside
  `docs/`; `pnpm audit:docs` does not require a docs-index row for it. If a
  future entry adds or moves a file under `docs/`, update `docs/README.md` and
  run `pnpm audit:docs` in the same change.

## Output contract

- `RESEARCH.md` contains a **"Failure modes -> guardrails"** table (failure
  mode, evidence, guardrail command or review check, owner prompt file) and the
  complete edge-case register.
- `GAP_ANALYSIS.md` contains the **"Gap -> action -> owner -> prompt file"**
  table, the front-end necessity verdict, and the measured checkpoint state.
- Cite commands and file:line for repo evidence. External claims need a URL, and
  only when the repository cannot answer the question.
- No unresolved template placeholders, no emoji, Markdown only.
- Do not start implementation before both documents exist. Do not edit source,
  the baseline, the map, the ledger, or any shared doc in this phase.
