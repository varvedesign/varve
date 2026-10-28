# RESEARCH - Batch A / A-09 production workload runner

**Status:** research complete 2026-10-28 (measured in `.worktrees/A-09` on
branch `seam/A/A-09-workload-runner` at checkpoint
`11e341e69e105cff7efef55e8645333efeebcc49`). No source was edited before
this document and its GAP_ANALYSIS sibling existed.

## 1. Measured checkpoint state

| Fact | Command | Measured result |
|---|---|---|
| Local master before this session | `git rev-parse master` | `8d1346966a7cff35c68f9ff531c58dbc100a0d29` (checkpoint not yet on master) |
| Lead fast-forward (unblock step 1) | `git merge --ff-only 11e341e69...` | `Updating 8d1346966..11e341e69 Fast-forward`; master = `11e341e69e105cff7efef55e8645333efeebcc49` |
| File-size gate on checkpoint tree | `node scripts/quality/audit-file-size.mjs --report` | exit 0; "6144 source files scanned; 960 over the 400-line cap; 956 frozen ... 0 violation(s); 4 untracked WIP over-cap file(s)"; "Baseline entries: 956 (0 stale)"; excess 327,250 lines (the extra scanned/WIP files are other sessions' untracked files in the main checkout; the clean worktree reads 6,077 scanned / 0 WIP) |
| File-size gate in the task worktree | `pnpm audit:filesize` (in `.worktrees/A-09`) | exit 0; "6077 source files scanned; 956 over 400 lines, all frozen in .file-size-baseline.json (tracked content)" |
| Worktree | `git worktree add .worktrees/A-09 -b seam/A/A-09-workload-runner master` | created from the checkpoint; `git status --porcelain` empty before the seam |
| Target | `wc -l scripts/perf/run-production-workload.mjs` | 1,969 lines; baseline line 835: `"scripts/perf/run-production-workload.mjs": 1969` |
| Covering suite | `wc -l scripts/perf/productionEvidence.test.mjs scripts/perf/workloadGeometry.test.mjs` | 248 + 25 = 273 lines |
| Covering suite (before) | `node --test scripts/perf/productionEvidence.test.mjs scripts/perf/workloadGeometry.test.mjs` | `# tests 12 / # pass 12 / # fail 0` (10 + 2) |
| Planner (plain form) | `node scripts/quality/godsplit-plan.mjs scripts/perf/run-production-workload.mjs` | exit 0; "Lines: 1969 / imports: 8 / blocks: 79"; hazards: target over cap, sub-split required for Try lines 1332-1967 (636 lines) |
| Planner `--top` | `... --top 200` | exit 2 `godsplit-plan: unknown argument: --top` (the recorded A-05/A-06 residual holds on this checkpoint; the plain form's full 79-block table is used instead) |
| Verifier smoke | `node scripts/quality/refactor-verify.mjs --base master --target scripts/perf/run-production-workload.mjs --json` | exit 0; `{ok: true, baseCount: 67, presentCount: 67, missing: [], missingExports: []}` |
| Consumers | `grep -rln 'run-production-workload'` | 14 paths: the runner itself, `scripts/perf/run-webgl2-qualification.mjs` (line 268, spawns the runner by path as a child process), `scripts/perf/webkit/run-ghosting-oracle.py` (comment), `scripts/perf/README.md`, `docs/perf/ledger.md`, `docs/perf/webgl2-qualification.md`, `docs/audits/tablet-mode-2026-09-29.md`, `docs/repository-hygiene-progress.md`, `docs/plans/...`, `docs/quality/...`, `docs/agents/canvas-fluidity-...`, `.file-size-baseline.json`, `remediation/A-05/GAP_ANALYSIS.md`. Module importers: **none** (`grep -rn "from '.*run-production-workload\|import(.*run-production-workload\|require(.*run-production-workload"` returns nothing) |
| Queue / worktrees | `pnpm queue:status` / `pnpm worktree:status` | "validation queue: idle; 0 waiting"; A-09 clean, no peer writer |
| Health baseline | `node scripts/audit-health.mjs` | exit 0 ("health check passed") |
| Install | `pnpm install --frozen-lockfile` | environment limit: `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` / "Read-only file system"; substituted by 22 `node_modules` symlinks to the main checkout (measured `find . -maxdepth 4 -name node_modules -type l | wc -l` = 22), exactly the A-07 workflow |
| Queued type gate | `pnpm check:agent` | environment limit: `EROFS ... /run/user/1000/varve-validation-queue/exclusive.lock`; substituted by the same recursive tsc program run directly (`check:agent:raw` body): `packages-checked=20 packages-fail=0`, `desktop-exit=0`, `e2e-exit=0` (20 = `ls packages/*/tsconfig.json | wc -l`; `packages/automation` has no tsconfig) |

## 2. Research themes (repository evidence)

1. **Module-evaluation side effects in a CLI entry (the defining risk here).**
   The target is not a library: its top level *is* the program. Side effects in
   base order: argv parse (61), `--help` exit (68-89), flag validation
   `fail()` exits (141-153), `CPU_COUNT = run('nproc')` subprocess (155),
   vite build subprocess (1219-1242), preview server spawn (1258-1276),
   `buildIdentity()` git/uname subprocesses (1294-1308), signal handlers
   (1323-1330), then the top-level `try` (1332) that launches Chromium.
   Failure mode if moved naively: importing a destination module would build
   the app or start a server (A-06 recorded exactly this class of bug as
   "critical" and fixed it by moving launches inside `runCapture()`).
   Guardrail: destination modules contain only declarations; every side-effect
   statement stays in the entry or moves into a function the entry calls at the
   original position; the import list is ordered so `cli.mjs` (argv, help,
   validation) evaluates before `machineState.mjs` (nproc) - which is also
   structurally guaranteed because `machineState.mjs` imports `ROOT` from
   `cli.mjs`, so depth-first evaluation runs the validation body first.
2. **Working-tree imports vs. module boundaries.** The runner has zero module
   importers (measured above), so no consumer sees an import-path change; the
   only path contract is the CLI path itself, referenced by
   `run-webgl2-qualification.mjs:268` and `scripts/perf/README.md` - the
   entry keeps its path, shebang and flags. Failure mode: moving the entry
   would break the qualification runner; guardrail: the entry file path is
   never renamed.
3. **Mutable module state across the new boundary.** `partial` (51 references),
   `server`, `serverLog`, `BASE`, `exitCode` are read and written from the
   try block, `flush` and the signal handlers. Failure mode: copying state
   into a module creates a second, divergent instance (the A-04 singleton-pool
   analogue). Guardrail: all five stay entry-local; extracted functions receive
   `partial`/`server`/`exitCode` as parameters and mutate the same objects;
   `browser` is the one binding that must be visible to both the entry's
   `finally`/signal handlers and the launching code, so it moves to
   `session.mjs` as `export let browser` - a live binding the entry reads,
   assigned only inside the defining module (the A-06 `const -> let` pattern).
4. **Closure-based control flow (`restoreBaselineCamera`).** The baseline
   camera restorer (1580-1612) closes over `page` and `baselineCamera` and is
   called from both the setup block and the workload loop. Failure mode:
   re-creating it per iteration or hoisting it changes when the oracle runs.
   Guardrail: it stays one closure inside `prepareBaseline()`, returned once
   and passed into the loop - identical identity and capture.
5. **Shared gesture helpers between setup and loop.** `contentCanvasDigest`,
   `resolveDragTarget`, `drainInteractionTraces`, `summarizeRendererFrames`
   are each called from two extracted regions plus the entry region. Failure
   mode: duplicate copies that drift (A-04 theme 6). Guardrail: one home per
   helper in `workload/`; consumers import; no helper is copied.
6. **Report aggregation is interleaved with driving.** Inside the loop,
   measurement (1741-1849), evidence (`performanceEvidence`, 1863-1878),
   validity classification (1892-1921) and trace-failure gating (1923-1933)
   build `record` while the same block drives the browser. Failure mode: a
   split that changes *when* `record.machineAfter` or `record.validity` is
   computed relative to the gestures. Guardrail: the whole loop moves as one
   unit into `runMeasurementLoop()` - aggregation order inside it is untouched.
7. **Dropped declarations.** `baseCount 67` is the contract. Failure mode: a
   range map that misses a block (e.g. the stranded doc comment 644-649, or
   `fail` at 359). Guardrail: `refactor-verify --dest scripts/perf/workload/`
   must exit 0 before tests; the range map in SEAM_SPEC is a full partition of
   lines 1-1969 checked by the split script itself.
8. **Comments and docs-as-comments.** The file carries dense rationale
   comments (e.g. 478-485 undo-oracle doc, 644-649 stranded fixture-drag doc,
   688-693 drag-target rationale). Failure mode: a cut that orphans or drops
   them. Guardrail: comments move with their declaration, verbatim; the
   partition check counts comment lines like any other line.
9. **Tracked-vs-untracked baseline policy.** New `.mjs` files under
   `scripts/perf/workload/` are untracked until staged: WIP-reported, never
   frozen, subject to the 400-line cap once staged (`verify:commit`'s
   `--staged` check). `--update` must remove exactly the target entry.
10. **Concurrent single-writer surfaces.** Baseline, agent map,
    `BACKLOG_LEDGER.md` are peer-hot; `pnpm worktree:status` and
    `pnpm queue:status` measured idle/no peer before starting; the seam claims
    advisory paths only.
11. **Rollback.** Nothing is committed until the final step: a failed
    extraction is discarded by restoring the worktree's own files only; never
    `reset` the shared checkout, never touch another session's files (the main
    checkout carries unrelated untracked WIP: `align.ts`, `packages/automation/`,
    e2e specs, etc. - measured in `git status`).
12. **Rust equivalents: does not apply.** A-09 is Node tooling; both seam tools
    parse it directly (both exit 0 above), so the A-07 Rust substitution does
    not apply. Recorded so a later Batch-B entry cannot inherit the wrong
    verification.

## 3. Reference-tool failure modes (codemod/batch-refactor history)

- **Silent skips / false success:** a range-based cut can leave a declaration
  behind while still producing parseable files. Prevented here by
  `refactor-verify` (AST-based, exit 0 required) plus the split script's own
  line-partition assertion (every base line classified exactly once).
- **Type-check failure after automated edits:** `scripts/**` is outside every
  tsconfig project (A-06 measured the same), so the recursive tsc gate proves
  no *collateral* breakage only; syntax of the moved code is proven by
  `node --check` on every module and by the covering suite actually importing
  `productionEvidence.mjs`/`workloadGeometry.mjs`.
- **Large-changeset review blindness:** mitigated by the SEAM_SPEC inventory
  (79 blocks, every destination named before the cut) and the verification
  record listing every planned textual edit.
- **Already prevented by existing machinery:** `refactor-verify`,
  `audit-file-size` (shrink-only ratchet), `verify:commit` (staged-only),
  `biome check`, `audit-health`, and the A-06 precedent (2,767 -> 77-line
  entry with 15 modules, 15/15 tests).
- **Remaining unknown for A-09:** whether every side-effect ordering claim
  holds at runtime - addressed by explicit ordering analysis in SEAM_SPEC and
  the recorded import order; the covering suite does not execute the runner
  (no spec imports it), so runtime behaviour is proven by construction
  (verbatim ranges), `node --check`, and the identity partition - not by an
  end-to-end perf run, which is out of scope (never run `pnpm build` or a
  browser workload for a file split).

## 4. Edge-case register

| Edge case | Decision for A-09 | Evidence |
|---|---|---|
| Module-eval side effects (help exit, validation fail, nproc, vite build, server spawn, git identity, chromium launch) | Only argv/help/validation/DIST live at module scope in `cli.mjs` (all before any runner statement in base too); nproc moves to `machineState.mjs`, which imports `cli.mjs` so validation still precedes it; every launch after argv stays in the entry or inside functions called at the original position | Base order 61-155, 1219, 1258, 1294, 1332; A-06 "capture side effects" rule |
| tsconfig / package exports | None: `scripts/**` is outside every tsconfig project; no package boundary touched; entry path unchanged | `ls packages/*/tsconfig.json | wc -l` = 20; no importer of the runner |
| Path aliases / import rebasing | Only two relative depths: `./workload/*.mjs` from the entry, `../productionEvidence.mjs` / `../workloadGeometry.mjs` from modules; `ROOT` gains no depth change because it is re-expressed by `import.meta.url` inside `cli.mjs` at the same `scripts/perf/` depth (line 59 moves verbatim - no rebase needed) | Base line 59; destination `scripts/perf/workload/cli.mjs` would need `../../` - **decided instead:** ROOT stays byte-verbatim only if the module sits at the same depth; since `cli.mjs` is one level deeper, the single planned edit is `'../../'` -> `'../../../'` on that line (allowlisted, A-06 precedent "ROOT gains one `..`") |
| Template-literal / string text | Cuts are AST block ranges, never brace counting; help text and error strings move inside their declarations | Planner ranges + partition check |
| Identity-sensitive declarations | Entry keeps its path, shebang, flags, exit codes; no export existed, so no consumer import changes | grep result above |
| Same-named helpers in sibling modules | One home each: `contentCanvasDigest` -> evidence, `resolveDragTarget` -> scenarios, etc.; no copies | dependency map in SEAM_SPEC |
| Dropped declaration / export | `refactor-verify --dest` exit 0 required (baseCount 67) | smoke above |
| Parse failure | `node --check` on every new module; godsplit-plan re-run on the entry after the split | proof plan |
| Stale/grown baseline entry | Exactly one removal (`run-production-workload.mjs`), 0 added, 0 grown; `--force` forbidden | proof plan |
| Test-file exemption | Covering tests untouched (they import sibling modules that do not move); 273 lines stay | wc above |
| Generated files / exclusions | `vendor/**` and the three generated tables untouched | policy |
| Concurrency | queue idle, no peer writer; advisory claims | `pnpm queue:status` output above |
| Rollback | Uncommitted until the last step; discard only this worktree's own edits | `git status` in worktree |
| Unknown tools | `godsplit-plan` and `refactor-verify` both exist and exit 0 on the checkpoint | smoke above |
| `--top` unsupported | Recorded residual; plain `godsplit-plan` (79 blocks) used for the inventory | exit 2 measured |
| Queue-backed gates unavailable | Recorded environment limits with the direct-tsc substitution | rows above |
