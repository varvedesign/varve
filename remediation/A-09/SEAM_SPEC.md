# SEAM_SPEC - Batch A / A-09 production workload runner

**Status:** seam plan accepted 2026-10-28 (single seam, one worktree, one
commit). Implementation runs only in `.worktrees/A-09` on branch
`seam/A/A-09-workload-runner`, after this document, [RESEARCH.md](RESEARCH.md)
and [GAP_ANALYSIS.md](GAP_ANALYSIS.md) exist.

## Seam hypothesis

- **Entry:** Batch A / A-09 (remediation rank #21).
- **Target:** `scripts/perf/run-production-workload.mjs` - 1,969 lines,
  frozen at 1,969 in `.file-size-baseline.json` (line 835).
- **Single concern:** the production workload/benchmark runner, split along
  its three data/flow concerns exactly as the campaign row defines them -
  **scenario definitions vs runner vs report aggregation** - into one new
  destination directory.
- **Single extraction destination:** `scripts/perf/workload/` (one destination
  directory = one seam; precedents: `menu/defs.ts` -> `menu/defs/`, A-06
  `product.mjs` -> `product/`).
- **Target after seam:** the entry stays the executable (same path, shebang,
  flags, JSON output, exit codes) as a ~230-line orchestrator: argv/help
  validation live in `workload/cli.mjs`, and the entry keeps build, serve,
  `partial`, `flush`, signal handlers, and a rewritten `try` shell that calls
  `openMeasurementSession()`, `prepareBaseline()`, `runMeasurementLoop()`.
- **Public API:** unchanged. No base declaration was exported, so no consumer
  import changes; the only path contract is the CLI path itself (referenced by
  `run-webgl2-qualification.mjs:268` and `scripts/perf/README.md`), which does
  not move.

## Declaration inventory (79 planner blocks = 67 declarations + 12 non-declaration blocks)

Measured with `node scripts/quality/godsplit-plan.mjs
scripts/perf/run-production-workload.mjs` (exit 0; 1,969 lines, 8 imports,
79 blocks; `--top` exits 2 as a recorded residual), then every range read in
full and completed by hand. Every base line 1-1969 belongs to exactly one
destination below (the split script asserts this partition).

| # | block | kind | base lines | destination |
|---|---|---|---|---|
| 1 | `ROOT` | const | 59 | `workload/cli.mjs` (one planned edit: `'../../'` -> `'../../../'`, module depth) |
| 2 | `args` | const | 61-66 | `workload/cli.mjs` |
| 3 | help block | If | 68-89 | `workload/cli.mjs` (statement) |
| 4-24 | `ITERATIONS` .. `VIEWPORT_HEIGHT` (21 constants) | const | 91-111 | `workload/cli.mjs` |
| 25 | `EXTERNAL_BASE` (+ doc 112-116) | const | 117 | `workload/cli.mjs` |
| 26 | `WORKLOADS` | const | 118-121 | `workload/cli.mjs` (scenario data) |
| 27 | `MEASUREMENT_TRACE_KINDS` | const | 122-139 | `workload/cli.mjs` (scenario data) |
| 28-32 | five flag-validation `if` blocks | If | 141-153 | `workload/cli.mjs` (statements) |
| 33 | `CPU_COUNT` | const | 155 | `workload/machineState.mjs` |
| 34-41 | `readProc`, `loadAverages`, `thermalMaxC`, `psiAvg10`, `cpuFrequency`, `backgroundActivity`, `captureMachineState`, `run` (+ section comment 157-160) | function | 162-299 | `workload/machineState.mjs` |
| 42 | `findFreePort` | function | 301-310 | entry (stays: serve lifecycle) |
| 43 | `buildIdentity` (+ doc 312) | function | 313-338 | `workload/evidence.mjs` (report provenance) |
| 44 | `hashDirectory` | function | 340-357 | `workload/evidence.mjs` |
| 45 | `fail` | function | 359-362 | `workload/cli.mjs` |
| 46 | `readChromiumGpuDiagnostics` | function | 364-398 | `workload/evidence.mjs` |
| 47 | `rendererModeUrl` | function | 400-405 | `workload/evidence.mjs` |
| 48 | `inspectRendererMode` | function | 407-465 | `workload/evidence.mjs` |
| 49 | `contentCanvasDigest` | function | 467-476 | `workload/evidence.mjs` |
| 50 | `waitForAuthoritativeCanvasDigest` (+ doc 478-485) | function | 486-503 | `workload/evidence.mjs` |
| 51 | `readScriptResourceState` | function | 505-522 | `workload/evidence.mjs` |
| 52 | `summarizeRendererFrames` | function | 524-550 | `workload/evidence.mjs` (report aggregation) |
| 53 | `openEditorCanvas` (+ section comment 552-556, doc 558) | function | 559-597 | `workload/scenarios.mjs` |
| 54 | `openFixtureEditor` (+ doc 599-606) | function | 607-642 | `workload/scenarios.mjs` |
| 55 | stranded fixture-drag doc + `buildScene` doc + `buildScene` | function | 644-712 | `workload/scenarios.mjs` (comments move verbatim, in order) |
| 56 | `ensureCanvasHitTarget` (+ doc 714-718) | function | 719-745 | `workload/scenarios.mjs` |
| 57 | `resolveDragTarget` (+ doc 747-753) | function | 754-802 | `workload/scenarios.mjs` |
| 58 | `waitForCameraToSettle` (+ doc 804-809) | function | 810-828 | `workload/gestures.mjs` |
| 59 | `latestInteractionTraceId` | function | 830-835 | `workload/evidence.mjs` (trace evidence) |
| 60 | `waitForCommittedInteraction` | function | 837-869 | `workload/evidence.mjs` |
| 61 | `largeBrushTipPrepared` (+ doc 871-874) | let | 875 | `workload/gestures.mjs` |
| 62 | `driveWorkload` | function | 876-1197 | `workload/gestures.mjs` (scenario gesture definitions; sub-split hazard: 322 lines - kept whole because it is one switch) |
| 63 | `drainInteractionTraces` (+ doc 1199-1204) | function | 1205-1213 | `workload/evidence.mjs` |
| 64 | `DIST` | const | 1217 | `workload/cli.mjs` (pure path config) |
| 65 | build block | If | 1219-1242 | entry (stays: side effect at original position) |
| 66 | `buildMode` | const | 1244 | entry |
| 67 | dev-build warning | If | 1245-1250 | entry |
| 68-70 | `server`, `serverLog`, `BASE` | let | 1254-1256 | entry (stays) |
| 71 | server spawn block | If | 1258-1276 | entry (stays: side effect) |
| 72 | `waitForServer` | function | 1278-1290 | entry (stays: uses entry `BASE`) |
| 73 | `browser` | let | 1292 | `workload/session.mjs` (`export let browser`; A-06 live-binding pattern) |
| 74 | `exitCode` | let | 1293 | entry (stays) |
| 75 | `partial` | const | 1294-1308 | entry (stays: report state) |
| 76 | `flush` | function | 1310-1320 | entry (stays: uses `partial`/`OUT`) |
| 77 | signal handlers | ForOf | 1323-1330 | entry (stays) |
| 78 | `try` | Try | 1332-1967 | **split:** shell stays in entry (1333-1335, 1555-1562, 1564 guard, 1950-1967); 1337-1554 -> `workload/session.mjs` `openMeasurementSession()`; 1565-1628 -> `workload/session.mjs` `prepareBaseline()`; 1630-1949 -> `workload/workloads.mjs` `runMeasurementLoop()` |
| 79 | final expression | Expression | 1969 | entry (`process.exit(exitCode)`) |

Non-declaration blocks: #3, #28-32, #65, #67, #71, #77, #78, #79 = 12;
79 - 12 = 67 declarations = the measured `baseCount`.

## Destination map (expected sizes; measured at closeout)

| module | declared concern | expected lines |
|---|---|---|
| `scripts/perf/run-production-workload.mjs` (entry) | build, serve, report state, flush, signals, try shell | ~230 |
| `workload/cli.mjs` | argv parse, help, flag constants, scenario data (WORKLOADS, MEASUREMENT_TRACE_KINDS), validation, `fail`, `ROOT`, `DIST` | ~110 |
| `workload/machineState.mjs` | `CPU_COUNT` + host-state probes + `run` | ~148 |
| `workload/evidence.mjs` | report aggregation helpers: provenance, hashing, GPU/renderer qualification, pixel/trace evidence, frame summaries | ~295 |
| `workload/scenarios.mjs` | document/fixture/scene setup and drag-target resolution | ~255 |
| `workload/gestures.mjs` | the workload gesture switch (`driveWorkload`) + camera settle | ~358 |
| `workload/session.mjs` | browser/page session setup, resource accounting, baseline camera, snapshot | ~310 |
| `workload/workloads.mjs` | `runMeasurementLoop`: warm-up, measurement, record/evidence/validity aggregation | ~343 |

All modules at or under 400 lines (350-400 target where natural); the entry
ends far under the cap. Module graph (acyclic, no destination imports the
entry): `cli` <- `machineState` <- `evidence` <- `gestures`; `cli` <- `session`
<- `workloads`; `scenarios` <- `gestures`/`session`/`workloads`.

## Applied edge cases (answers from GAP_ANALYSIS)

- **Side effects stay out of module evaluation.** Destination modules contain
  only declarations. Vite build (1219), server spawn (1258), `buildIdentity`
  (1294), signal registration (1323) stay in the entry at their original
  positions; Chromium launch (1337) moves inside `openMeasurementSession()`,
  which the entry awaits at the same point of the `try`.
- **Evaluation order.** Entry import order (after the base's own pure
  imports): `cli` -> `evidence` -> `session` -> `workloads`; `machineState`
  evaluates as `cli`'s consumer chain runs. Base side-effect order
  (argv -> help -> validation -> nproc -> build -> serve -> identity -> signals
  -> try) is preserved exactly; the only movements are pure ones (`ROOT`,
  `DIST` evaluate earlier - unobservable) and are recorded here.
- **Shared mutable state.** `partial`, `server`, `serverLog`, `BASE`,
  `exitCode` stay entry-local and are passed as parameters (same objects, same
  mutations). `browser` becomes `export let` in `session.mjs`; the entry's
  signal handlers and `finally` read the live binding (read-only import),
  exactly matching base null-until-launch semantics.
- **Closure identity.** `restoreBaselineCamera` is created once inside
  `prepareBaseline()`, returned, and passed into `runMeasurementLoop()` -
  one closure, same captures, same call sites.
- **No duplicate helpers.** One home per declaration (table above); consumers
  import; nothing is copied.
- **Relative specifiers.** `./workload/*.mjs` from the entry;
  `../productionEvidence.mjs`, `../workloadGeometry.mjs` from modules;
  `ROOT` is the single allowlisted depth rebase (`../../` -> `../../../`).
- **Planned textual edits (complete allowlist).** (a) `export` keywords on
  moved declarations; (b) the `ROOT` depth rebase; (c) added import blocks;
  (d) the three new function wrappers with their parameter lists and `return`
  statements (`openMeasurementSession`, `prepareBaseline`,
  `runMeasurementLoop`); (e) the entry's rewritten import block and `try`
  shell (calls + braces); (f) `browser` gains `export`. Nothing else changes:
  no rename, no reformat beyond biome's import organization, no logic edit.

## Proof plan

1. Split script asserts a complete partition: every base line 1-1969 is
   classified exactly once (kept / moved / allowlisted rewrite), then writes
   the files from those ranges (byte-identical moves by construction).
2. `node --check` exits 0 on the entry and every new module.
3. `node scripts/quality/refactor-verify.mjs --base master --target
   scripts/perf/run-production-workload.mjs --dest scripts/perf/workload/
   --json` exits 0 with `missing: []`, `missingExports: []`, baseCount 67,
   **before tests**.
4. Covering suite `node --test scripts/perf/productionEvidence.test.mjs
   scripts/perf/workloadGeometry.test.mjs` -> 12/12 before (recorded) and
   12/12 after, same test names, 0 failures.
5. `pnpm exec biome check --write` then `biome check` on every changed file;
   `node scripts/audit-health.mjs` exit 0.
6. Recursive tsc substitute (`packages/*` + `apps/desktop` + `tests/e2e`)
   exit 0 (recorded substitution for the queue-blocked `pnpm check:agent`).
7. Baseline ratchet: `audit-file-size.mjs --update` -> exactly one removed
   entry (`scripts/perf/run-production-workload.mjs`), 0 added, 0 grown,
   956 -> 955; `pnpm audit:filesize` exit 0.
8. Stage seam paths; `pnpm agent:map`; `pnpm verify:commit`; one ledger row;
   one commit on `seam/A/A-09-workload-runner`; no merge, no push.
9. Regenerate `NEXT_PROMPT.md` for the following entry and stop.


## Verification record (measured after the split, before the commit)

- **Modules:** 7 files under `scripts/perf/workload/` plus the 255-line entry.
  Measured `wc -l`: `cli` 102, `machineState` 150, `scenarios` 251,
  `evidence` 296, `session` 331, `gestures` 361, `workloads` 365; every
  module at or under 400; total 2,111 lines (base 1,969 + module-boundary
  imports/exports/wrappers).
- **Declaration preservation:** `node scripts/quality/refactor-verify.mjs
  --base master --target scripts/perf/run-production-workload.mjs --dest
  scripts/perf/workload/ --json` -> exit 0,
  `{ok: true, baseCount: 67, presentCount: 70, missing: [], missingExports: []}`
  (the three extras are the glue functions `openMeasurementSession`,
  `prepareBaseline`, `runMeasurementLoop`). Run before tests and again after
  biome: identical.
- **Line partition (by construction):** the split script asserted 26 ranges
  cover lines 1-1969 exactly once before writing any file (`PARTITION OK`).
- **Statement identity (independent AST check):** TypeScript-AST-printed
  comparison of all 1,002 base statements against the destination tree ->
  **996 matched** (export prefixes and the two re-indented blocks normalized by
  the printer), **6 allowlisted planned edits** (top-level `try` dissolved into
  the entry shell; `if (!PREFLIGHT_ONLY)` shell rewritten to two calls; that
  if's immediate Block; `ROOT` `'../../'` -> `'../../../'`; the
  `// ── Build ───` comment re-binding from moved `const DIST` to the build
  block it heads; the build `if` adopting that leading comment), **0
  unexplained**.
- **Line-level presence:** 1,865 non-blank, non-import base lines are present
  in the output tree; the only differing line is the allowlisted `ROOT` line.
  Every base comment is present verbatim (the six line-level flags were biome
  line-joins of three expressions after the -2-space re-indent: whitespace
  only).
- **Syntax:** `node --check` exit 0 on the entry and all 7 modules.
- **Module-load smoke:** importing all 7 modules succeeds with the expected
  exports, `session.browser === null` at import, and no exit/build/server side
  effects (run before and after biome).
- **Static reference audit:** ad-hoc `tsc --checkJs` over the 8 files reports
  **0 x TS2304 (unbound), 0 x TS2305 (missing export), 0 x TS2307 (missing
  module)**; the remaining diagnostics are type-level noise on untyped browser
  globals (`window.__varvePerf`, `AddressInfo`, `performance.memory`) that
  the base file carries identically - `scripts/**` is outside every tsconfig
  project.
- **Covering suite:** `node --test scripts/perf/productionEvidence.test.mjs
  scripts/perf/workloadGeometry.test.mjs` -> **12/12 pass before, 12/12 pass
  after**, 0 failures, same test names (10 + 2).
- **Consumer gate (substitution):** the recursive tsc program as
  `check:agent:raw` (`packages/*` + `apps/desktop` + `tests/e2e`) exits 0
  before (`packages-checked=20 packages-fail=0; desktop-exit=0; e2e-exit=0`)
  and after with identical output. Recorded substitution for the queue-blocked
  `pnpm check:agent` (EROFS on `/run/user/1000/varve-validation-queue`).
- **Lint:** `biome check --write` (fixed 5 files: import organization and
  re-indent) then `biome check` exit 0, "No fixes applied".
- **Health:** `node scripts/audit-health.mjs` exit 0 before and after.
- **Evaluation order (recorded, not hidden):** base side-effect order is
  preserved exactly - argv parse -> `--help` exit -> flag validation `fail`
  -> `nproc` -> vite build -> server spawn -> git identity -> signal handlers
  -> try. The `nproc` position is structurally guaranteed because
  `machineState.mjs` imports `ROOT` from `cli.mjs`, so the validation body
  always evaluates first. Pure movements: `ROOT` and `DIST` now evaluate at
  import time (no side effects); the `// ── Build ───` comment re-binds to the
  build block (bytes unchanged, still exactly once).
- **Baseline (Step 5 result):** recorded below after `--update`.

## No visual surface changed

The seam moves tooling code only: a Node benchmark runner with no rendered
output of its own, no UI surface, no API shape. Proof: the covering suite
(`productionEvidence.test.mjs` 10 tests + `workloadGeometry.test.mjs` 2 tests)
passes 12/12 before and after with identical names, the entry keeps its CLI
path and output schema, and every moved byte is covered by the partition
check. **No visual surface changed; visual validation is not triggered.**
