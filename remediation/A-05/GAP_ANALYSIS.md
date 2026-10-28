# Phase 0 gap analysis — A-05 scene type aggregation seam

**Status:** analysis complete 2026-10-28. A-05 is ready to execute after this
document and [RESEARCH.md](RESEARCH.md) are accepted; the declaration-identity
check and the consumer type gate are the two proof steps that must be added to
the run. Baseline update and commit are Lead-owned.

**Inputs:** [RESEARCH.md](RESEARCH.md), [SEAM_SPEC.md](SEAM_SPEC.md),
[module-map.json](module-map.json), the file-size policy, the remediation
record, the execution template (prompt 02), and this checkout measured on
2026-10-28 at base `b1ee0d09a`.

**Measured state used below:**

- Target 3,055 lines, frozen at 3,055 (baseline line 772); branch
  `seam/A/A-05-scene-types`; 32 registered worktrees.
- 193 declarations (70 aliases, 105 interfaces, 17 functions, 1 private const),
  189 exported declarations, 4 private, 5 re-export statements with 23 names:
  public surface 212 names. `refactor-verify` pre-flight: `baseCount: 193,
  presentCount: 193, missing: [], missingExports: []`. Planner: 198 blocks,
  2,398 declaration lines, 2,421 block lines, 634 lines outside blocks, AST full
  ranges add 394 lines across 96 declarations; five file-relative
  `import('./...')` specifiers live inside four moved declarations.
- `audit-file-size` pre-flight exit 0, 959 frozen, 0 stale, 0 violations. The
  Lead's `--report` snapshot measured 6,031 scanned files / 332,577 excess
  lines; the current re-run reads 6,052 / 333,038 / 1 untracked WIP over-cap
  file (the parallel executor's `.scratch/a05-codemod.mjs`). WIP is reported and
  never enforced; tracked frozen excess remains 332,577.
- `packages/scene/src/types.ts` was unmodified when these docs were written;
  the executor's real write started after the review, with an earlier 19-module
  preview in untracked `.scratch/a05-preview/`. `pnpm claims check` on target and
  baseline -> `overlaps: []`.

## Gap -> action -> owner -> prompt file

| ID | Gap | Action | Owner | Prompt file |
|----|-----|--------|-------|-------------|
| G1 | A-05 could be mistaken for a multi-seam campaign like A-04 | Execute as one mechanical batch: 19 modules, no sub-splits (largest declaration 151 lines, largest destination 271 declaration lines) | Split executor | 02-SEAM-EXECUTION-TEMPLATE.md |
| G2 | Protocol requires RESEARCH/GAP_ANALYSIS before source edits | These documents are the gate; the executor's real write started after they existed (the earlier preview was confined to untracked `.scratch/`) | Lead | 01-RESEARCH-AND-GAP-ANALYSIS.md |
| G3 | SEAM_SPEC proof 3 requires declaration text identity, but refactor-verify is name-set based only | Run a separate one-off AST identity check: 189 declarations byte identical and 4 declarations byte identical apart from the five path-only inline-import rebases; record matches/mismatches; never claim refactor-verify provides it | Split executor + reviewer | 02 (Step 3) |
| G4 | "No runtime code moves" overstates a type-only move: 17 functions and the private const move unchanged | Phrase the seam as a type-only move that moves 17 function bodies and 1 private const definition unchanged; this is part of the no-behavior-change proof; residual wording in SEAM_SPEC proof 9 is Lead's to correct | Reviewer (Lead) | 02 (Step 2/Definition of done) |
| G5 | The 212-name reference set lives in untracked `.scratch/base-export-names.json`; no CLI checks set equality | Regenerate the reference from `exportedNames`; compare the barrel set (212 names, 0 added/removed, the 4 private names absent) in the verification report | Split executor + reviewer | 02 (Step 3) |
| G6 | Execution template is A-04-specific: `godsplit-plan --top 5` exits 2; Steps 0/5/6/7/8 hardcode 960 -> 959 and the 9-test A-04 command | Record as a known residual/observation; out of scope for this seam's commit (`remediation/prompts/` is not in the allowed commit set); do not edit prompts/templates; A-05 values live in SEAM_SPEC and these docs | Lead / campaign owner | 02 (residual, not edited) |
| G7 | No covering runtime test exists for module/barrel structure and no test-count parity proof | Proof stack: refactor-verify parity, identity check, 212-name equality, package tsc, biome, `pnpm check:agent`, baseline diff; optional scene-suite run is supplemental only; record that incidental value-import tests are not seam coverage | Split executor | 02 (Step 4) |
| G8 | Package-scoped tsc compiles only `packages/scene/src`, not consumers | Run `pnpm check:agent` once as the consumer gate (1,223 files / 1,589 statements import `@varve/scene`; 223 files / 240 statements reach the types file) | Lead | 02 (Step 4/5) |
| G9 | Runtime value-import cycles must not appear between destination modules | Keep value imports intra-module (measured: helpers/groups only); assert 0 `from '../types'` imports; run `node scripts/audit-architecture.mjs --cycles` | Split executor | 02 (Step 4) |
| G10 | Baseline regeneration is single-writer and must survive rebases | Lead runs `audit-file-size --update` in `.worktrees/A-05` on the green tree; diff must be added 0, grown 0, lowered 0, removed exactly the types.ts entry; 959 -> 958; `--force` forbidden; re-run after any rebase on the merged tree | Lead (baseline owner) | 02 (Step 5) |
| G11 | Commit, ledger row, agent map and NEXT_PROMPT are single-writer surfaces | Lead owns `git add`/commit, the one `BACKLOG_LEDGER.md` row, `pnpm agent:map` from the staged tree, `verify:commit`, and the next prompt; workers never stage or commit | Lead | 02 (Steps 6-8, 10) |
| G12 | New modules are untracked and never frozen, so an over-cap module can hide until staging | Measure `wc -l` on every module (preview maximum 315), stage all 19 modules plus barrel, then rely on `verify:commit`'s `audit-file-size --staged` | Lead | 02 (Step 6) |
| G13 | Keeping base line 78 verbatim needs a barrel import, and the 60-80-line barrel estimate assumed a rewrite | **Resolved by Lead:** keep line 78 verbatim and keep the two-name `./colorManagement` type import verbatim; no from-form rewrite; the estimate is superseded, record the measured barrel length after the real split. Do not add `types/index.ts`; `./types` must keep resolving to the barrel file | Split executor | 02 (Step 2) |
| G14 | Front-end, workbench, a11y, i18n and dark-mode gates could be misread as triggered | Record measured answers: no workbench (0 workbench/remediation files under packages/apps), no API shape, no error/loading/permission change, no queue UI, 0 JSX/CSS/DOM access; no prompts 03/04 work and no screenshots | Reviewer | 03/04 (not triggered) |
| G15 | No dashboard; progress can only be read from commands and the ledger | Require the observability commands in section 4 plus one ledger row; no workbench work for A-05 | Lead | 02 (Step 7) |
| G16 | Two writers share `.worktrees/A-05` (docs vs source), against the one-writer-per-worktree rule | Record the exception: hard-disjoint write scopes (remediation/A-05 docs vs packages/scene/src only), Lead-owned baseline/commit, advisory claims with no measured overlap; neither writer touches the other's scope | Lead | docs/quality/concurrent-agents.md |
| G17 | Rollback path is not written for a move that ratchets the baseline | Before commit: discard the uncommitted seam. After merge without the ratchet: revert source move and baseline together; a removed entry is restored by git revert, never `--force`; the barrel re-export reverts with the modules | Lead | 02 (closeout) |
| G18 | Untracked executor scratch adds a WIP over-cap file to the report | `.scratch/a05-codemod.mjs` (861 lines) and the preview are WIP only: never staged/committed; tracked frozen excess stays 332,577; the final report may show WIP until scratch is removed | Split executor + Lead | 02 (Steps 6/7) |

## 1. Batch definitions, disjointness and order

Batch A (remediation record lines 68-74) is path-disjoint. A-04
`IntelligencePanel.tsx` is merged and recorded in the ledger; the remaining
Batch A entries touch `scripts/screenshots/product.mjs`,
`crates/varve-bridge/tests/wgsl_validation.rs`, the already-split
`replay-fill.test.ts` (A-08), the split replay/halftone suites and
`scripts/perf/run-production-workload.mjs`. A-05 is the only entry naming
`packages/scene/src/types.ts`, and it touches one target file plus its new
sibling directory. The remediation record lists #7 `scene/types.ts` next after
A-04, so it is the correct next entry.

Order is a preference, not an enforced dependency: A-05 needs nothing from
A-04. Its real prerequisites are the checked-in baseline (959 entries), the
checked-in seam tooling (`godsplit-plan.mjs`, `refactor-verify.mjs` are tracked
at `b1ee0d09a`), the reviewed declaration map, and these documents. All are
present. The batch description's "type-only change ... one mechanical batch
with typecheck-only validation" matches the plan, but it does not lower the bar
on the identity check: the verifier cannot see comments, duplicates, kind drift
or inline-import rebases.

## 2. Baseline regeneration procedure and ownership

`--update` refuses to freeze a new over-cap path or record growth, records only
splits/deletes/renames-with-split, prunes stale entries, is byte-deterministic,
and `--force` is forbidden (`docs/quality/file-size-policy.md` lines 153-191).
Procedure: (1) confirm the 959-entry baseline and a green `audit-file-size`
before edits; (2) split, then run tsc, biome, refactor-verify, the identity
check and the surface check; (3) only then run `--update` in `.worktrees/A-05`,
review the JSON diff and require added 0 / grown 0 / lowered 0 / exactly the
`packages/scene/src/types.ts` entry removed, 959 -> 958; (4) run
`audit-file-size` again, stage, and run `pnpm verify:commit`; (5) after any
rebase, re-run the update on the merged tree.

**Who:** the Lead is baseline owner. The split executor never runs `--update` on
the shared checkout, never hand-edits the JSON, never uses `--force`, and never
stages. Because the target shrinks to a small barrel, its entry must disappear;
a lowered-but-still-frozen target, a new entry, or any grown entry means the
seam is wrong.

## 3. Rollback

The seam is uncommitted until the Lead's commit, so the first rollback is
discarding the move. If it is committed and the ratchet did not go down, revert
the source move and the baseline entry together; a removed entry cannot be
re-added by `--update`, so restore the previous baseline blob with git revert or
recheckout, never `--force`. If a consumer breaks after merge, revert the new
module set and its barrel re-exports together, because the barrel is part of the
public package surface. The worktree is not pruned until the seam merges or is
explicitly abandoned.

## 4. Observability

There is no remediation dashboard and none is in scope. The seam is observable
through commands, each with an expected result:

```bash
node scripts/quality/refactor-verify.mjs --base b1ee0d09a --target packages/scene/src/types.ts \
  --dest packages/scene/src/types --json     # missing: [], missingExports: []
<one-off AST identity check>                 # 189/189 byte-identical + 4/4 except 5 rebases
node_modules/.bin/tsc -p packages/scene/tsconfig.json --noEmit   # exit 0
pnpm check:agent                                                  # consumer gate (Lead)
node_modules/.bin/biome check packages/scene/src/types.ts packages/scene/src/types
node scripts/audit-architecture.mjs --cycles                      # no new cycles
node scripts/quality/audit-file-size.mjs --update                 # one removed entry
node scripts/quality/audit-file-size.mjs                          # exit 0, 958 frozen
pnpm verify:commit                                                # staged checkpoint
```

Add one `BACKLOG_LEDGER.md` row using its existing columns (timestamp, batch A,
entry A-05, target path, frozen_lines 3055, current_lines = measured barrel,
seam_status, worktree `.worktrees/A-05`, commit/branch, frozen_count_after 958,
notes with module count, verifier summary and identity/surface results). The
ledger is the trend record; the report numbers must be read with the WIP caveat
(one untracked scratch file is over-cap and is not part of the ratchet).

## 5. Workbench and front-end gate

The 03 prompt's trigger is "the platform has no workbench for the queue"; true
at program level, but A-05 does not fire it. `git ls-files packages apps` matches
0 workbench/remediation files, and A-05 has no operator surface: no IPC/API
shape, no error/empty/loading/permission state, no queue rendering. The move
must not change output because no rendered artifact consumes the type module at
runtime. Queue the workbench independently; do not fold it into this seam.

## 6. Accessibility, i18n, dark mode, empty/error/loading

Not applicable, with measurements: the target contains no JSX, no CSS imports
and no DOM access (`window.`/`document.`/`localStorage`/`.css` pattern count 0;
the one textual hit is the prose "canvas navigator." in a doc comment). There
are no user-visible strings, focus behavior, colour tokens, translations or
theme-dependent styles in the moved declarations, and no rendered output
changes. Accessibility, i18n, dark-mode and visibility-state review belong to UI
seams, not to a declaration move.

## 7. Concurrency and peer-hot entries

Measured: 32 registered worktrees; `.worktrees/A-05` is on
`seam/A/A-05-scene-types` at `b1ee0d09a`; the target was unmodified when these
docs were written and the executor's write started after; preview and codemod
sit in untracked `.scratch/`; the claims check for target and baseline reports
`overlaps: []`. Single-writer surfaces are the baseline,
`docs/agents/repo-map.generated.md`, `BACKLOG_LEDGER.md` and the commit; the Lead
is their only writer. The two-member, same-worktree pattern is an exception to
the one-writer rule, justified only by hard-disjoint scopes (docs vs
`packages/scene/src`) and the Lead gating the real write on these documents. Stop
and re-check if the target becomes dirty or another claim appears.

## 8. Test realism

There is no covering runtime test: no test imports the barrel to assert module
structure, and 175 of 193 declarations are type-only. Incidental runtime
coverage is not seam coverage: 23 direct import statements carry value bindings
used by 6 package test files, and 5 editor test/benchmark files import moved
function values through `@varve/scene`; those would catch a broken function body
at best, and the 17 function bodies move verbatim anyway. The identity proof has
one deliberate exception class: four declarations contain five file-relative
`import('./...')` specifiers that must be rebased when the declaration moves
deeper, so the proof is 189/189 byte-identical declarations plus 4/4
byte-identical apart from those five path-only specifier rewrites. What the
proof stack cannot prove: comment intent (identity check covers text), structural
equivalence of a wrong-but-compatible type origin, consumer breakage if
`pnpm check:agent` is skipped, or duplicate absence unless the identity check
runs. The untracked `.scratch/a05-preview/` was measured at 193 declaration
names, 189 exported module names, a 212-name barrel surface with 0 missing/extra,
0 `export *`, 0 `../types` imports and a 315-line maximum module; strong signals,
re-measure after the real split.

## 9. Varve-native equivalents for the Go-oriented execution template

The template is Go-oriented (go build/vet/test, gofmt/goimports,
`tools/refactor_verify.py`, `tools/godsplit_plan.py`). Varve equivalents, with
status measured at `b1ee0d09a`:

| Template step | Varve command/tool | Status |
|---|---|---|
| Baseline build | `pnpm check:agent` (queued recursive tsc) | Exists; heavy (432 s in record) |
| Package types | `node_modules/.bin/tsc -p packages/scene/tsconfig.json --noEmit` | Exists; pre-flight exit 0 |
| Static checks | `biome check` + audits | Exists; target clean pre-flight |
| Package tests | No covering suite; optional `pnpm test:agent packages/scene` | Partial (incidental only) |
| Format | `biome check --write` (new files only) | Exists |
| Imports | biome organize-imports; tsc enforces verbatimModuleSyntax | Partial (no type-only inference) |
| Declaration proof | `scripts/quality/refactor-verify.mjs` (13 tests) | Exists; set-based only |
| Cut planner | `scripts/quality/godsplit-plan.mjs` (9 tests) | Exists; `--json`, no `--top` |
| Identity proof | none; one-off AST check required by SEAM_SPEC proof 3 | Missing (G3) |
| Cycle check | `node scripts/audit-architecture.mjs --cycles` | Exists, not in `verify:agent` |
| Hygiene gate | `scripts/quality/audit-file-size.mjs` | Exists |
| Staged checkpoint | `pnpm verify:commit` | Exists |
| Generated map | `pnpm agent:map` + `--staged` check | Exists |
| Ledger | `BACKLOG_LEDGER.md`, one row per seam | Exists |
| Worktree base | local `master`/`b1ee0d09a`; `origin/main` lacks foundation | Different |
| Scope semantics | TS module move is not a no-op: export/import/barrel decisions | Different, critical |

## 10. Recommended A-05 decomposition

Matches [SEAM_SPEC.md](SEAM_SPEC.md) and [module-map.json](module-map.json)
exactly; no alternative decomposition is recommended and no number is restated
beyond the reviewed plan: one seam, one destination directory
`packages/scene/src/types/`, 19 modules, 193 declarations, 2,398 declaration
lines, and the target becomes a re-export barrel. Per-module counts, ranges and
moved-line counts are the SEAM_SPEC table; module-map.json is the machine-readable
assignment (verified: 193 unique names, range multiset equal to the planner,
movedLines sum 2,398, no drift). No sub-split is required: the largest
declaration is `EffectVariant` at 151 lines (below the 350-line hazard) and the
largest destination by declaration lines is `appearance.ts` at 271 (AST full
range including comments 293), so every module plus barrel stays under 400. The
barrel's length is not a gate: the 60-80 estimate is superseded by the line-78
decision (G13); record the measured length after the real split.

## 11. Blocking risks and definition of ready

**Blocking risks to close before the commit (not all block the extraction):**

1. **Declaration identity is unproven until the one-off AST check runs** (G3);
   the name-set verifier cannot see text loss, duplicates or inline-import rebases.
2. **Consumer surface is unproven until `pnpm check:agent` runs** (G8); package
   tsc is not a consumer gate and 1,223 files import the package entry.
3. **Barrel/text decisions:** line 78 stays verbatim with its two-name import
   (G13, resolved); the measured barrel length replaces the superseded estimate.
4. **WIP scratch must not be staged** (G18); it would fail `verify:commit` for
   the wrong reason and must never enter the commit set.
5. **Template drift is a known residual, out of scope for this commit** (G6);
   do not edit `remediation/prompts/`.
6. **Same-worktree peer** (G16): a real source write before this review passes
   breaks the docs-first protocol; the Lead's gate is authoritative.

**Definition of ready for the A-05 execution run:** baseline committed at 959
entries and `audit-file-size` green; `refactor-verify` and `godsplit-plan`
tracked and green (measured); SEAM_SPEC correct on block arithmetic, line 78,
proof 3 and the inline-import edge case (Lead corrected); these documents
accepted; claims recorded with no overlap (measured); write scopes disjoint and
Lead owns baseline/commit; the extraction can then proceed to the proof stack in
section 4, with the Lead running `--update`, `pnpm check:agent`, the ledger row
and the single commit.
