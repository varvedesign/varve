# B-09 research and gap analysis — SAM2 segmentation hook

Entry: Batch B / B-09. Target `packages/editor/src/context/useSam2Segmentation.ts`
(2,222 lines, frozen at 2222). Destination `packages/editor/src/context/sam2/`.
Worktree `.worktrees/B-09`, branch `seam/B/B-09-sam2-hook`, created from local
`master` at f1411c4ac (the B-08 seam; local master was fast-forwarded from
c57b6501a to f1411c4ac in this session before the worktree existed, per the
handoff unblock sequence).

## Measured checkpoint state (every number measured this session)

| Command | Result |
|---------|--------|
| `git merge --ff-only f1411c4acf8046092ee65acb6162b7ac94d8861e` (main checkout) | `Updating c57b6501a..f1411c4ac`, fast-forward, exit 0; no conflict with the main checkout's untracked WIP paths (diff touched 15 files, none dirty) |
| `pnpm audit:filesize` (integrated master, main checkout) | exit 0; "6315 source files scanned; 951 over 400 lines, all frozen" + 4 untracked WIP over-cap files (`packages/automation/*`, other sessions' reported-only WIP) |
| `node scripts/quality/audit-file-size.mjs --report` (main checkout) | 6,315 scanned / 951 over cap / **947 frozen / 0 stale** / 302,863 excess / 4 untracked WIP reported |
| `git worktree add .worktrees/B-09 -b seam/B/B-09-sam2-hook master` | exit 0; HEAD f1411c4ac; clean tree; 21 `node_modules` symlinks to the main checkout (read-only pnpm store blocks `pnpm install --frozen-lockfile`), matching the B-06/B-07/B-08 measured environment |
| `pnpm audit:filesize` (B-09 worktree) | exit 0; "6223 source files scanned; 947 over 400 lines, all frozen"; 0 untracked WIP (clean worktree) — identical to the handoff's checkpoint reading |
| `node scripts/quality/audit-file-size.mjs --report` (B-09 worktree) | 6,223 scanned / 947 frozen / **0 stale** / 300,868 excess / 0 WIP |
| `grep -n useSam2Segmentation .file-size-baseline.json` | line 307: `"packages/editor/src/context/useSam2Segmentation.ts": 2222` (line 306: covering test 929) |
| `wc -l` target + covering test | 2,222 / 929 |
| `node scripts/quality/godsplit-plan.mjs <target>` (no flags; `--top` exits 2 "unknown argument" at this checkpoint) | exit 0; "Lines: 2222 \| imports: 16 \| blocks: 30"; hazards: file over 400-line cap; **sub-split required: `useSam2Segmentation` lines 277-1902 is 1,626 lines on its own** |
| `node scripts/quality/refactor-verify.mjs --base master --target <target> --json` | exit 0; `{ok:true, baseCount:30, presentCount:30, missing:[], missingExports:[]}` |
| `pnpm exec vitest run <covering test> --reporter=dot --silent=passed-only` | **34 passed (34)** / 0 failed, 1 test file, 12.42 s (direct vitest: the queue blocks `pnpm test:agent` with EROFS on `/run/user/1000/varve-validation-queue/exclusive.lock`) |
| direct recursive tsc program (same inputs as `check:agent:raw`: 20 `packages/*/tsconfig.json` + `apps/desktop` + `tests/e2e`, direct `./node_modules/.bin/tsc`; `pnpm -r exec` dies on the read-only store pre-install) | `packages-checked=20 packages-fail=0 desktop-exit=0 e2e-exit=0 diagnostics=0` (exit 0) |
| `pnpm worktree:status` / `pnpm queue:status` | worktree list healthy, B-09 clean; "validation-queue: exclusive free; shared 0/4 slots busy; 0 waiting" |
| `node -e` package.json `claims` script | present (`pnpm claims` exists; advisory path claims) |
| `git status --short` (B-09) | empty (clean pre-edit) |

Consumer and spec inventory (measured with grep):

- Module path importers: `packages/editor/src/context.tsx:516`
  (`import { useSam2Segmentation } from './context/useSam2Segmentation'`, used at
  line 3991) and the covering test `packages/editor/src/context/useSam2Segmentation.test.tsx:17-21`
  (`buildMaskPayload`, `mapPromptedRoutingFailure`, `useSam2Segmentation`).
  No other file imports the path; `Sam2SegmentationAPI` has no external
  consumer; `packages/engine/src/colorization/sam2Recolor.ts:81` only mentions
  the name in a comment.
- Specs directly covering the moved declarations: only the covering test
  (34 tests). `promptedSegmentationProvider.test.ts` covers
  `runPromptedSegmentation` (not moved); `maskAlgebra.test.ts` covers
  `combineAlphaMasks` (engine, not moved; cited by the `buildMaskPayload`
  docstring).

## Required reading (in protocol order)

1. `docs/quality/agent-context-remediation-2026-10-28.md` — five-defect
   matrix (god files: 969 over cap at first measurement, 947 today); ranked
   backlog **row 17**: "`packages/editor/src/context/useSam2Segmentation.ts` |
   2,222 | SAM2 segmentation hook: capability probing, cache budgeting,
   prompt/embedding transport, mask post-processing | Extract capability/budget
   helpers, the worker transport, and mask post-processing into
   `context/sam2/` modules; hook composes them | Medium risk, batch B.
   Cache-budget behavior has dedicated tests"; Batch B list includes #17.
2. `docs/plans/agent-infrastructure-campaign-2026-10-28.md` — Batch B order:
   "lib.rs ... print, clipboard, document codec, filters, snapping, room
   server, bgremove, **SAM2**, ContentAwareFill, AdjustmentEditor"; SAM2 is
   the next entry after B-08 (ledger rows B-01..B-08 measured below).
3. `docs/quality/file-size-policy.md` — 400-line cap, 350-400 split target,
   baseline lifecycle, `--update`/`--force` rules, seam tooling
   (`godsplit-plan` ranges only, never destinations; `refactor-verify`
   fails when a base declaration or exported name is missing from target +
   destination).
4. `.ai/skills/split-god-file.md` — split at a real seam; parent keeps the
   public API via re-export; baseline update in the same change; "a split does
   not lower function complexity".
5. `docs/quality/concurrent-agents.md` + `docs/agents/validation-and-workflow.md`
   — one worker per worktree, single-writer generated surfaces, staged-only
   `verify:commit`.
6. Prompts `01-RESEARCH-AND-GAP-ANALYSIS.md`, `02-SEAM-EXECUTION-TEMPLATE.md`
   (this document + `GAP_ANALYSIS.md` + `SEAM_SPEC.md`); prompts 03/04 only
   if their gates fire (they do not — no rendered surface).
7. Target and covering test read in line ranges only (73-275, 277-454,
   454-754, 754-1054, 1054-1354, 1354-1654, 1654-1964, 1964-2222); covering
   test read by title/import slices (929 lines).

Precedents measured from `BACKLOG_LEDGER.md` tail (rows for B-03, B-04, B-05,
B-06 and the `menu/defs.ts` record): TS entries become an **explicit named
re-export barrel plus destination-directory modules, all <= 400 lines**, with
giant declarations sub-split as a thin orchestrator that keeps its name while
phases move verbatim (B-05 conversion/defaults switches, B-06 `snapPosition`,
B-04 `collectNodeClosure`). refactor-verify is run before tests with
`--dest`; extra planned glue functions are allowed (`presentCount >= baseCount`).

## A. Research themes (repository evidence first)

1. **Module-evaluation side effects.** Meaning: moving declarations must not
   change when anything is constructed or registered. Evidence: the target has
   **no module-scope constructions** — the planner's 30 blocks are pure
   declarations (5 constants, functions, 1 interface, 1 type alias), and the
   only runtime singleton use, `new EmbeddingCache(...)`, happens inside the
   hook render behind `if (enabled && !embeddingCacheRef.current)` (lines
   304-329), not at import time. Failure mode in this repo: A-04's auditPool
   precedent — a singleton duplicated per module. Guardrail: one home per
   constant (no copies of `MASK_DECODE_TIMEOUT_MS` / budget constants),
   inventory shows each name exactly once, covering test exercises cache
   construction through the hook. Owner: `SEAM_SPEC.md` destination map.
2. **tsconfig project boundaries / package entry points.** Evidence:
   `packages/editor/tsconfig.json` covers `src/**`; the destination is
   `src/context/sam2/` — same project, same `@varve/editor` package
   (no package.json export change; package manifests are single-writer and out
   of scope). Failure mode: making the move compile by adding a cross-package
   import. Guardrail: moved code keeps its existing `@varve/engine` /
   `@varve/scene` imports; recursive tsc exit 0. Owner: prompt 02 step 4.
3. **Path aliases and import ordering.** Evidence: base imports use relative
   `./` (context siblings) and `../` (tools, backgroundRemoval, canvas,
   components); from `context/sam2/` each gains one `../`. Failure mode: a
   missed rebase breaks resolution — caught by tsc, but a wrong-but-resolving
   rebase (e.g. `../tools` -> `./tools`) needs review. Guardrail: rebases are
   mechanical (+1 depth), biome orders imports once, tsc verifies. Owner:
   prompt 02 step 4.
4. **Template-literal / code-like text.** Evidence: dense user-facing template
   literals inside announce strings (e.g. line 916
   `Selected subject (${formatSelectionScore(...)})`, lines 1744-1745) and
   regex/error strings (line 2045). Failure mode: brace/line-count cuts
   corrupting a literal. Guardrail: cut only on the planner's declaration
   boundaries and recorded phase boundaries; partition proof asserts every
   moved line byte-identical. Owner: `SEAM_SPEC.md` proof plan.
5. **Overloaded / identity-sensitive declarations.** Evidence: the covering
   test imports `buildMaskPayload`, `mapPromptedRoutingFailure`,
   `useSam2Segmentation` from `./useSam2Segmentation` and `context.tsx:516`
   imports `useSam2Segmentation` from the same path; no TS overloads exist in
   the target (planner: none). Failure mode: a moved-and-exported name that is
   no longer importable from the original path. Guardrail: the target keeps
   `useSam2Segmentation` and `Sam2SegmentationAPI` in place and re-exports the
   three moved exports explicitly (no `export *`); covering test untouched;
   refactor-verify export check. Owner: prompt 02 steps 1-3.
6. **Same-named private helpers in sibling modules.** Evidence: the base has
   exactly one home per helper (30 unique names, planner output); the split
   creates new adjacency (`countMaskCoverage` next to `maskMatchesDimensions`
   next to `formatSelectionScore`). Failure mode: copy-paste duplicates that
   drift (two `markFailure` variants). Guardrail: destination map assigns one
   module per declaration; `markFailure` and the phase bundles are typed glue,
   not copies; grep duplicate-name check after the move. Owner:
   `SEAM_SPEC.md`.
7. **Dropped declarations.** Evidence: `refactor-verify --base master --json`
   = 30/30 today; exit 0 required with `--dest` **before** tests. Failure
   mode: a phase cut leaves a declaration in neither file, or a sub-split
   renames something. Guardrail: never rename; extra phase functions are new
   glue names only; verifier exit 0 + JSON recorded. Owner: prompt 02 step 3.
8. **Tracked-versus-untracked baseline policy.** Evidence: clean worktree, 0
   WIP over-cap; new `sam2/*.ts` files are untracked until staged (reported,
   never frozen) and are subject to the 400-line cap the moment they are
   staged (`--staged` lane inside `pnpm verify:commit`). Guardrail: check
   every generated module <= 400 before staging; `--update` never freezes WIP.
9. **Stale / grandfathered baseline entries.** Evidence: 0 stale entries at
   947 (measured). Failure mode: a different entry leaving or a frozen file
   growing would mask a wrong ratchet. Guardrail: `--update` without `--force`,
   baseline diff must remove exactly
   `"packages/editor/src/context/useSam2Segmentation.ts": 2222`, 0 added,
   0 grown; expected 947 -> 946. Owner: prompt 02 step 5.
10. **Concurrent worktree conflict on peer-hot surfaces.** Evidence:
    `pnpm queue:status` = exclusive free, 0 waiting; `pnpm worktree:status`
    healthy; baseline/map/ledger/docs README are single-writer. The B-08
    seam is already committed (its ledger row exists), so the baseline's last
    writer finished. Guardrail: this worktree is the only writer for
    `.file-size-baseline.json`, `docs/agents/repo-map.generated.md`,
    `BACKLOG_LEDGER.md`; advisory `pnpm claims claim` for the paths; never
    share a worktree.
11. **Rollback.** Evidence: the seam stays uncommitted until step 6/8 of
    prompt 02; everything created here is inside `.worktrees/B-09` +
    `remediation/B-09/`. Failure mode: saving a partial seam in a commit.
    Guardrail: on red, discard this worktree's uncommitted changes only;
    never revert main-checkout files; never commit partial; stop before the
    ratchet if `--update` cannot remove exactly one entry.
12. **Rust-crate equivalents.** Does not apply: B-09 is a TypeScript entry;
    `godsplit-plan` and `refactor-verify` both parse the target (measured
    exit 0). No `mod` registration, `generate_handler!`, or `audit:ipc`
    surface is involved.

### B-09-specific themes (the sub-split hazard the planner flags)

13. **The apply body is 1,449 lines inside a 1,626-line hook and is only
    partially tested.** Evidence: planner hazard "sub-split required:
    `useSam2Segmentation` lines 277-1902 is 1626 lines"; the covering test
    asserts `controls.infer` **not** called in 20+ tests and never mocks a
    successful fresh run — the reviewed-candidate commit path, mask
    combination, entry guards and layer extract are covered, while the fresh
    inference path (image load -> routing -> worker transport -> publication
    -> operation switch, base lines 1015-1862) has **no covering test**.
    Failure mode: a "cleanup" that restructures the untested path. Guardrail:
    those lines move **verbatim** at recorded phase boundaries with a
    byte-identity partition proof (precedent: B-03 "1,814 byte-identical +
    29 export prefixes", B-06 "all other moved lines byte-verbatim"); no
    logic edits inside them; STOP if any phase cannot be moved verbatim.
14. **React hook order and useCallback deps.** Evidence: AGENTS hard rule
    ("same order every render"), base order
    (refs 286-331, writeTransientSession 333, preview 347-356, cancel 358,
    provider preference 369, select 386, review 402, effects 427 and 442,
    apply 454-1891, return 1893-1901); apply deps array 1881-1891 lists
    `[enabled, stateRef, setState, updateDoc, announcerRef, setAreaSelection,
    writeTransientSession, promptedProviderPreference]`. Failure mode: an
    extraction that reorders hooks or drops a dep (stale closure). Guardrail:
    the hook block stays in the target verbatim; only the apply body moves;
    deps array preserved byte-identical; covering test renders the hook
    (renderHook) before and after.
15. **try/catch/finally boundary semantics.** Evidence: base setup (1015-1087)
    runs **outside** the try at 1090; phases 1089-1862 run **inside** it; the
    catch maps errors through `mapSegmentationFailure`/`isCancellationError`
    and the finally clears `abortRef`/`softDeadlineRef` when the generation
    is current (1869-1877). Failure mode: a phase restructure that lets setup
    exceptions be swallowed as `markFailure`, or that skips finally on an
    early return. Guardrail: the orchestrator keeps setup pre-try and every
    phase call inside the try with the base catch/finally verbatim; early
    phase returns funnel into the orchestrator's `return null` inside the try
    (finally still runs, as in base).
16. **Closure threading instead of rewrites.** Evidence: `markFailure`
    (1055-1073) captures `generation`, refs, `nodeId`, `currentDoc`; phases
    need dozens of shared locals (`naturalW`, `decision`, `imageMapper`,
    `sourceFingerprint`, ...). Failure mode: renaming locals to `run.x`
    everywhere (a mass rewrite that destroys reviewability). Guardrail: phase
    functions receive the shared values as **parameters with the original
    local names**, so moved bodies stay byte-identical; the shared types live
    in a type-only module (`sam2/applyContext.ts`) to keep the import graph
    acyclic.

## B. Reference-tool and failure-mode analysis

What codemod/batch tools fail at that this seam must not repeat:

- **Silent skips** (a declaration or branch not matching the pattern is left
  behind while the tool reports success). Prevented here by
  `godsplit-plan`'s fixed 30-block inventory + the hand-completed table in
  `SEAM_SPEC.md` + `refactor-verify` exit 0 with an explicit
  `missing: []`/`missingExports: []` (it fails, not warns, on a gap).
- **False-success reporting** (exit 0 while producing broken code).
  Prevented by running the verifier *before* tests, then the covering test
  (34/34), then the full direct tsc program (20/20 + desktop + e2e), then
  biome, then `audit:filesize`, then the staged-only `pnpm verify:commit`
  (which re-runs staged file-size, staged map, health, docs and staged tests).
- **Type-check failure after automated edits** (imports/rebases).
  Prevented by the recursive tsc program measured before and after with
  identical zero diagnostics expected.
- **Large-changeset review blindness** (11+ new files nobody can review).
  Mitigated by the recorded allowlist: every module is base-range lines +
  a named wrapper; the partition/byte-identity script proves nothing else
  changed; the ledger row carries the counts.

What remains untested/unknown (becomes explicit STOP conditions in
`SEAM_SPEC.md`):

- The fresh inference path (base 1015-1862) has no test coverage in the
  covering suite — therefore byte-identity proof + tsc + unchanged hook are
  the only safety net; any line inside those ranges that cannot move verbatim
  is a STOP, not a silent edit.
- Module-evaluation order: no module-scope side effects exist in the moved
  code (measured), so the residual risk is only import-cycle introduction
  through type-only modules; `node scripts/audit-health.mjs` (cycles lane)
  plus tsc gate this.
- Whether biome reflows any moved signature (export prefix / line wrap) —
  recorded as planned formatting-only edits if they occur (precedent: B-03
  29 export-prefix lines, B-05 "signatures reflowed by the planned export
  prefix").

## C. Edge-case and gap register

| Edge case | Applies? | Decision for B-09 (evidence + guardrail) |
|-----------|----------|------------------------------------------|
| Module-eval side effects | applies (low) | No module-scope construction in the target (planner 30 pure declarations); constants keep one home; covering test exercises cache construction |
| tsconfig / package entry points | applies | Destination inside `packages/editor/src`; no export-map change; tsc 20/20 |
| Path aliases / import rebasing | applies | +1 relative depth from `context/sam2/`; biome formats, tsc resolves |
| Template-literal / code-like text | applies | Announce literals at 916/1744-1745 and error strings at 2045+ move only with their declarations; byte-identity proof |
| Overloaded / symbol identity | applies | `useSam2Segmentation` + `Sam2SegmentationAPI` stay on the original path; 3 moved exports re-exported explicitly; test import lines untouched |
| Same-named helpers in sibling modules | applies | One home per declaration (destination table); duplicate-name grep after |
| Dropped declaration | applies | Inventory 30; `refactor-verify --dest` exit 0 before tests |
| Parse failure in target/destination | applies (measured OK) | `godsplit-plan` exit 0 at checkpoint; tsc parses every new module |
| Tracked-vs-untracked baseline | applies | New modules untracked until staged; `--staged` lane enforces <= 400 at stage time |
| Stale/grandfathered/slack entry | applies | 0 stale measured; exactly one entry must leave (947 -> 946); any other diff is a STOP |
| `--update` refusing / adding / growing | applies | Run without `--force`; review `git diff -- .file-size-baseline.json`; STOP on anything but one removal |
| Test-file exemption from ratchet | applies | Covering test (929 lines, frozen) must not grow; expected to stay byte-identical |
| Generated files / exclusions | applies | `vendor/**` + 3 generated tables untouched; repo map regenerated only via `pnpm agent:map` |
| Concurrent conflict on peer-hot files | applies | Queue free (measured); single-writer surfaces listed; advisory claims |
| Rollback path | applies | Uncommitted seam; discard only this worktree's changes |
| Unknown/unresolved tools | does not apply | Both seam tools exist and parse this target (measured exit 0) |
| Hot render/replay dispatch | does not apply | No render/replay dispatch touched; split-god-file benchmark clause not triggered |
| Rust equivalents | does not apply | TypeScript entry; verifier parses TS |
| Front-end necessity gate | does not apply | No remediation workbench exists; pure move; see `GAP_ANALYSIS.md` verdict |
| Visual/Playwright gates | does not apply | No rendered surface changes; prompts 03/04 do not fire |

## Failure modes -> guardrails

| Failure mode | Evidence | Guardrail command / review check | Owner |
|--------------|----------|----------------------------------|-------|
| Silent skip of a declaration during the cut | planner 30 blocks; base verify 30/30 | `node scripts/quality/refactor-verify.mjs --base master --target <t> --dest packages/editor/src/context/sam2 --json` exit 0 before tests | 02 step 3 / SEAM_SPEC |
| Corrupted template literal or string in a moved range | announce literals lines 916, 1744-1745, 1966-1968 docs | byte-identity partition script (every moved line == base line) + covering test | 02 step 2 / SEAM_SPEC |
| Restructuring the untested fresh-inference path | covering test only asserts `controls.infer` not called | verbatim ranges at recorded boundaries; STOP if any edit inside 1015-1862 is required | SEAM_SPEC stop conditions |
| Hook order or deps-array drift | base order 286-454, deps 1881-1891 | diff review of the target; covering test renderHook 34/34 | 02 step 4 |
| Import rebase error / new cycle | relative imports at lines 40-71 | direct recursive tsc (20 pkgs + desktop + e2e) exit 0; `node scripts/audit-health.mjs` | 02 step 4 |
| Public export lost from the original path | test imports lines 17-21; `context.tsx:516` | explicit named re-exports; refactor-verify `missingExports: []`; covering test untouched | 02 step 1 |
| New module over the 400-line cap | destination sizes planned <= 400 | `wc -l` pre-stage + `audit-file-size.mjs --staged` inside `pnpm verify:commit` | 02 step 6 |
| Baseline grows or a second entry leaves | 947 frozen / 0 stale measured | `node scripts/quality/audit-file-size.mjs --update` (never `--force`) + diff review + `pnpm audit:filesize` exit 0 | 02 step 5 |
| Behavior drift in the commit path (tested) | 19 reviewed-candidate commit tests | covering test 34/34 before and after, 0 failures | 02 step 4 |
| Commit contamination (NEXT_PROMPT, other sessions' files, lockfiles) | main checkout has untracked WIP | explicit stage list; `pnpm verify:commit` staged-only; `git status` review before commit | 02 steps 6-8 |
| Queue EROFS masking a red check | measured EROFS on `/run/user/1000/...` | direct substitutions recorded above (tsc program + direct vitest), run before and after | Blockers / this doc |
| Duplicate helper copies drifting | one-home rule | destination table + post-move duplicate-name grep | SEAM_SPEC |

