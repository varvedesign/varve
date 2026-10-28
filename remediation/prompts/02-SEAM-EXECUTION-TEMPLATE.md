# Seam execution - Batch A, entry A-04 (IntelligencePanel tabs)

Repo-native rewrite of the Go-oriented execution template. One seam, one
worktree, one commit. Reuse the skeleton for the next entry by changing only the
resolved values below; the protocol and commands are identical.

## Resolved values (this entry)

| Key | Value |
|-----|-------|
| Batch | A |
| Entry id | A-04 |
| Package | `packages/editor` |
| Target file | `packages/editor/src/panels/IntelligencePanel.tsx` - 3,191 lines, frozen at 3191 |
| Covering test | `packages/editor/src/panels/IntelligencePanel.test.tsx` - 259 lines, 9 tests |
| Seam | one module per tab under the destination directory plus shared severity, histogram, and helper modules; the panel stays a thin tab router |
| Destination | `packages/editor/src/panels/intelligence/` - a destination directory counts as one seam (precedent: `packages/editor/src/menu/defs.ts` became an 11-line barrel plus 15 modules under `menu/defs/`) |
| Worktree | `.worktrees/A-04` |
| Branch | `seam/A/A-04-intelligence-panel` |
| Baseline | `.file-size-baseline.json` |
| Remediation doc | `docs/quality/agent-context-remediation-2026-10-28.md` |
| Campaign plan | `docs/plans/agent-infrastructure-campaign-2026-10-28.md` |
| Policy | `docs/quality/file-size-policy.md` |
| Gate | `pnpm audit:filesize` |
| Declaration planner | `node scripts/quality/godsplit-plan.mjs <file> [--json] [--top N]` |
| Move verifier | `node scripts/quality/refactor-verify.mjs --base <git-ref> --target <path> --dest <dir> [--json]` |
| Ledger | `BACKLOG_LEDGER.md` |
| Expected ratchet | 960 -> 959 frozen entries; exactly one entry removed; 0 added, 0 grown |

Inputs to attach: the four docs above, each as an exact path;
`@packages/editor/src/panels/IntelligencePanel.tsx` read by line range;
`@packages/editor/src/panels/IntelligencePanel.test.tsx` (259 lines, read
fully); only the specs that directly cover the moved declarations.

## Step 0 - pre-flight in a clean worktree

This step is executable only after the foundation checkpoint commit exists on
local `master` (guards, baseline, policy docs, seam tooling, completed split
batches). Verify in the main checkout first:

```bash
git rev-parse --verify master
git log -1 --oneline master
pnpm audit:filesize            # exit 0; checkpoint state is 960 frozen entries
pnpm check:agent               # exit 0 (queued recursive tsc)
test -f scripts/quality/godsplit-plan.mjs
test -f scripts/quality/refactor-verify.mjs
```

Then create the task worktree **from local `master`**, never from
`origin/main`: the remote does not contain `.file-size-baseline.json`, the
guard scripts under `scripts/quality/`, the `audit:filesize` script, or the
completed split batches. A worktree from `origin/main` has no ratchet to run,
and a PR cut from it would re-introduce god files that are already split
locally (for example the 2,269-line `packages/engine/src/replay-fill.test.ts`).

```bash
git worktree add .worktrees/A-04 -b seam/A/A-04-intelligence-panel master
cd .worktrees/A-04
pnpm install --frozen-lockfile
pnpm audit:filesize            # exit 0 at 960 entries
pnpm check:agent               # exit 0
node scripts/quality/godsplit-plan.mjs packages/editor/src/panels/IntelligencePanel.tsx --top 5
node scripts/quality/refactor-verify.mjs --base master \
  --target packages/editor/src/panels/IntelligencePanel.tsx --json
```

Both seam tools exit 2 when invoked without usable input, so the planner smoke
must exit 0 with a block table, and the verifier smoke must exit 0 with
`missing: []` and `missingExports: []`. Record all pre-flight output in
`SEAM_SPEC.md`. If a gate is red or a tool is absent, stop and report the
blocker; do not edit source and do not force the baseline. Claim the paths
advisory-only: `pnpm claims claim --task "A-04 intelligence panel split" --path
packages/editor/src/panels --path .file-size-baseline.json --path
docs/agents/repo-map.generated.md --path BACKLOG_LEDGER.md --path remediation/A-04`.

## Step 1 - SEAM_SPEC.md before coding

Write `remediation/A-04/SEAM_SPEC.md`. It must contain:

- **Declaration inventory (mandatory, hand-completed).** Seed it with
  `node scripts/quality/godsplit-plan.mjs packages/editor/src/panels/IntelligencePanel.tsx --top 200`,
  then read each block range and confirm/correct by hand. List every top-level
  declaration with kind, line range, export status, and destination module (or
  "stays in the router"). The observed plan is 41 blocks over 3,191 lines; the
  router keeps `IntelligencePanel`, the tab metadata/applicability hook, and the
  shared shell, and the tabs are `LinterTab`, `LinterConfigEditor`, `ReviewTab`,
  `AuditTab`, `SpacingTab`, `NamingTab`, `GovernanceTab`, `DebtTab`,
  `PrototypeTab`, `LayoutTab`, `ComponentsTab`, `SimilarTab` plus their local
  helpers and dialogs. The list is a starting point, not an excuse to skip the
  read: `godsplit-plan` gives ranges and hazards but never proposes a
  destination.
- **Single concern.** Pure code motion of the panel's presentation modules; no
  behavior, rendering, API, or error-state change.
- **Destination map.** One module per tab plus shared modules for severity
  marks/labels, histogram bars, tab metadata/applicability, and genuinely shared
  helpers. Every module at or under 400 lines (350-400 target where the tab is
  naturally that large; smaller is fine when cohesive). The parent keeps the
  public `export function IntelligencePanel` and ends under the 400-line cap.
- **Before and expected-after declaration sets**, the parent's expected line
  count, and each destination module's expected size.
- **Edge-case answers** from `GAP_ANALYSIS.md`, in particular: `auditPool`
  stays a single import-time singleton (line 833) with unchanged evaluation
  timing; the CSS side-effect import appears exactly once; relative imports are
  rebased for the deeper destination; `IntelligencePanel` stays the named export
  of the same module path for `components/Inspector/panels/AuditPanel.tsx` and
  the test; `ExtendedTab` and the `initialTab` prop contract are unchanged; each
  shared helper has one home; strings and JSX text are untouched.
- **Proof plan.** `refactor-verify` exit 0, 9/9 component tests before and after,
  `pnpm check:agent` exit 0, biome clean, baseline diff exactly one removed
  entry.

If the inventory shows two unrelated concerns, stop: execute only the first and
write a continuation prompt for the second.

## Step 2 - extraction rules

- Move declarations by the planner's declaration boundaries only. Never cut by
  line count, alphabetical range, or brace matching across template literals,
  JSX text, or comments.
- Preserve comments and JSDoc verbatim; do not rename declarations to make the
  move compile; do not add behavior, features, or new state.
- Move imports with the code and rebase relative specifiers. Keep the
  side-effect CSS import exactly once; keep the `auditPool` construction in one
  module and import the instance.
- One home per shared helper; no copy-paste duplicates; do not export a helper
  just because a sibling module imports it (a local import is fine).
- No new over-cap file and no line added to a frozen file to prepare the split.
  If a tab is too large for one module, split it further inside the same
  destination directory (still one seam) and record the split in `SEAM_SPEC.md`.

## Step 3 - prove no declaration was dropped (before tests)

```bash
node scripts/quality/refactor-verify.mjs --base master \
  --target packages/editor/src/panels/IntelligencePanel.tsx \
  --dest packages/editor/src/panels/intelligence --json
```

Exit codes: 0 preserved; 1 a declaration or exported name is missing; 2 bad
input. This must exit 0 before tests run. If it fails, the cut is incomplete:
fix the extraction, never suppress or edit the verifier. Record the JSON summary
(`baseCount`, `presentCount`, `missing`, `missingExports`) in
`SEAM_SPEC.md`. The tool parses TypeScript/JavaScript only; Rust seams are out
of its scope.

## Step 4 - focused tests, then static checks

Before editing, on the clean worktree:

```bash
pnpm test:agent packages/editor/src/panels/IntelligencePanel.test.tsx
```

Record the pass count (9 tests today) and 0 failures. After the extraction, run
the same command and require the identical count and 0 failures. Do not weaken,
skip, or delete tests, and do not add snapshots for a pure move. This jsdom
suite with `EditorProvider` is the real-world scenario: it renders the panel,
checks tab semantics and applicability, exercises contrast, naming,
similar-search, and the promote dialog. Then:

```bash
pnpm exec biome check --write packages/editor/src/panels/IntelligencePanel.tsx \
  packages/editor/src/panels/intelligence
pnpm exec biome check packages/editor/src/panels/IntelligencePanel.tsx \
  packages/editor/src/panels/intelligence
pnpm check:agent
node scripts/audit-health.mjs   # hub caps, complexity ceilings, cycles
```

Biome may fix formatting and import order; it must not be used to rewrite moved
logic. `check:agent` is the recursive type gate and is mandatory.

## Step 5 - ratchet the baseline down

```bash
node scripts/quality/audit-file-size.mjs --update
git diff -- .file-size-baseline.json
pnpm audit:filesize
node scripts/quality/audit-file-size.mjs --report
```

Required result: 960 -> 959 frozen entries. The baseline diff removes exactly
`packages/editor/src/panels/IntelligencePanel.tsx` and nothing else: 0 added,
0 grown. The parent and every new module are at or under 400 lines, and the
report no longer lists the target in the top offenders. Do not hand-edit the
baseline. If `--update` refuses, adds an entry, or grows a frozen file, stop and
report; `--update --force` is forbidden.

## Step 6 - generated surfaces and staged checkpoint

Stage the seam first so the generated map is built from the staged tree:

```bash
git add packages/editor/src/panels/IntelligencePanel.tsx \
        packages/editor/src/panels/intelligence \
        .file-size-baseline.json \
        remediation/A-04
pnpm agent:map
git add docs/agents/repo-map.generated.md BACKLOG_LEDGER.md
node scripts/quality/generate-agent-map.mjs --staged
pnpm verify:commit
```

`pnpm agent:map` writes `docs/agents/repo-map.generated.md` from the staged
tree (it reads `git ls-files --cached`), so stage the new modules before
regenerating; never hand-edit the map. `pnpm verify:commit` is the staged-only
pre-commit checkpoint (emoji, staged map, staged file-size, health, docs, and
direct staged tests). It is the same driver the git hook would run, so run it
explicitly before committing. Add the covering test to the commit only if its
path or imports had to change; expected outcome for a pure move is no test edit.

## Step 7 - one ledger row

Append exactly one row to `BACKLOG_LEDGER.md` using its existing column order:
timestamp (caller-generated ISO-8601, `date --iso-8601=seconds`), batch `A`,
entry `A-04`, target path, frozen_lines `3191`, current_lines (the router's
measured lines, or 0 if the path was deleted), seam_status, worktree
`.worktrees/A-04`, commit (the branch name; the SHA is reported to the Lead
after the commit - see Step 8), frozen_count_after `959`, and notes (module
count, test counts before/after, verifier summary, baseline diff). Do not edit
the dated remediation record or the campaign plan; the orchestrator records
merged seams there. Never invent a timestamp or a count.

## Step 8 - commit only the seam

```bash
git status --short
git add <the exact paths from Step 6>
git commit -m "refactor(editor): split intelligence panel tabs into panels/intelligence/ (Batch A/A-04)"
```

The commit contains only: the parent plus destination modules; the covering test
if its path changed; `.file-size-baseline.json`;
`docs/agents/repo-map.generated.md`; `BACKLOG_LEDGER.md`;
`remediation/A-04/RESEARCH.md`, `GAP_ANALYSIS.md`, `SEAM_SPEC.md`. It must not
contain `NEXT_PROMPT.md`, lockfiles, package manifests, unrelated formatting,
build output, screenshots, or another session's work. No AI-tool attribution,
co-author, or "generated by" trailers. Body: what moved, test counts
before/after, verifier result, 960 -> 959. Do not amend the commit to embed its
own SHA; report the SHA to the Lead and add it through a ledger-only follow-up
commit only if the orchestrator requires the exact SHA in the ledger.

## Step 9 - PR rule

Default: no push. Leave the commit on
`seam/A/A-04-intelligence-panel` for Lead review. Push and open a PR only when
the Lead explicitly authorizes a remote push **and** the remote base contains the
foundation checkpoint (local `master` does; `origin/main` does not). Then:

```bash
git push -u origin seam/A/A-04-intelligence-panel
```

Open the PR against the foundation base (never against an unfounded remote
`main`), with a body naming the seam, the test counts, the baseline diff, the
verifier result, and "no visual surface changed". Workers never merge.

## Step 10 - handoff and stop

In the main checkout root (`../..` from `.worktrees/A-04`), instantiate
`templates/NEXT-PROMPT.md` for the following unblocked entry: fill every
placeholder from its table with fresh measurements (`node
scripts/quality/audit-file-size.mjs --report` on the committed branch worktree;
the next entry from the batch tables crossed with the ledger; blockers
cleared/remaining), write `NEXT_PROMPT.md` at the main repo root, and leave it
untracked. Do not start that entry. Then report to the Lead: branch, worktree,
commit SHA, changed files, test counts before/after, verifier JSON, baseline
diff summary, FROZEN_COUNT 959, PR status, and remaining blockers.

## Definition of done

- `refactor-verify` exit 0 with every declaration preserved and exported names
  intact.
- The covering component test has the same count before and after, 0 failures;
  `pnpm check:agent`, biome, and `node scripts/audit-health.mjs` pass.
- Every touched source file is at most 400 lines; the parent is under the cap.
- `pnpm audit:filesize` exits 0 at 959 frozen entries; the baseline diff is
  exactly one removed entry, with 0 added and 0 grown; no `--force`.
- Repo map regenerated and staged; `pnpm verify:commit` passed.
- Exactly one `BACKLOG_LEDGER.md` row; `NEXT_PROMPT.md` regenerated; one commit
  on `seam/A/A-04-intelligence-panel`; no merge; no PR unless authorized.
- `SEAM_SPEC.md` states "no visual surface changed" and names the covering test
  that proves it. The front-end necessity gate does not fire for this seam.

## Do not

- Do not use `--update --force`, hand-edit the baseline, or freeze untracked
  WIP.
- Do not create the worktree or PR from `origin/main`.
- Do not change behavior, rename declarations, redesign UI, add a dialog or
  state, or split the seam into two concerns.
- Do not let a new module exceed 400 lines, and do not grow a frozen file.
- Do not weaken or skip tests, update snapshots, or run visual baselines for a
  pure move.
- Do not edit the dated remediation doc, campaign plan, `docs/README.md`,
  package manifests, or lockfiles.
- Do not commit `NEXT_PROMPT.md`, build output, screenshots, or another
  session's files; do not add AI-tool attribution trailers.
- Do not merge, prune the unmerged worktree, run the full gate, or start the
  next entry in this session.

## Reusing this prompt

For the next entry change only the resolved values table (batch, entry, package,
target, covering test, seam, destination, worktree, branch, expected ratchet) and
the seam-specific inventory description in Step 1. The pre-flight, extraction,
verification, baseline, staging, commit, PR, and handoff rules are the repo
protocol and stay fixed. This file deliberately contains no template placeholders;
`templates/NEXT-PROMPT.md` is where the placeholder syntax lives.
