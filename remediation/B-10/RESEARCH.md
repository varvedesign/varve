# B-10 research and gap analysis — Content-Aware Fill dialog

Entry: Batch B / B-10. Target
`packages/editor/src/components/ContentAwareFill/ContentAwareFillDialog.tsx`
(4,513 lines, frozen at 4513). Destination
`packages/editor/src/components/ContentAwareFill/dialog/`. Worktree
`.worktrees/B-10`, branch `seam/B/B-10-content-aware-fill`, created from local
`master` at `6128380b3` (the committed B-09 seam; local `master` was
fast-forwarded `f1411c4ac` -> `6128380b3` before the worktree existed).

Companion: `GAP_ANALYSIS.md`. The declaration inventory, destination map, hook
invariants and proof plan are the seam owner's `SEAM_SPEC.md`; this document
records the research, the measured checkpoint state and the failure-mode
analysis that gate it.

## Measured checkpoint state (every number measured this session)

All commands run in `.worktrees/B-10` on the clean worktree before any edit.

| Command | Result |
|---------|--------|
| `git rev-parse HEAD` / `git log -1 --oneline` | `6128380b39b569a679350a08493cc8e89e0c97e7`; "refactor(editor): split sam2 segmentation hook into context/sam2/ modules (Batch B/B-09)" |
| `git status --short` (pre-edit) | empty (clean, 0 paths) |
| `pnpm audit:filesize` | exit 0: "File-size budget OK: 6234 source files scanned; 946 over 400 lines, all frozen in .file-size-baseline.json (tracked content)". pnpm prints a `[WARN]` that its pre-script dependency install failed on the read-only store; the guard itself runs and exits 0 |
| `node scripts/quality/audit-file-size.mjs --report` | "Scanned 6234 source files; 946 over the 400-line cap; 946 frozen in .file-size-baseline.json; 0 violation(s); 0 untracked WIP over-cap file(s)"; "Excess over cap: 299046 lines. Baseline entries: 946 (0 stale)". Target is the #2 offender: `4513 packages/editor/src/components/ContentAwareFill/ContentAwareFillDialog.tsx [frozen]` |
| `grep -n 'ContentAwareFillDialog' .file-size-baseline.json` | line 144: `"packages/editor/src/components/ContentAwareFill/ContentAwareFillDialog.tsx": 4513,` |
| `wc -l` target | `4513` |
| `node scripts/quality/godsplit-plan.mjs <target>` (no flags) | exit 0: "Lines: 4513 \| imports: 21 \| blocks: 29"; hazards: "target is over the 400-line cap" and "sub-split required: ContentAwareFillDialog lines 502-4513 is 4012 lines on its own". `--top` is unsupported at this checkpoint (no argument parsing for it) |
| `node scripts/quality/refactor-verify.mjs --base master --target <target> --json` | exit 0: `{"ok":true,"baseCount":29,"presentCount":29,"missing":[],"missingExports":[]}` |
| covering set, direct vitest (`pnpm exec vitest run --reporter=dot --silent=passed-only <10 files>`) | `Test Files 10 passed (10)`; `Tests 102 passed (102)`; 0 failed; Duration **44.22 s** (transform 88.82 s, setup 9.74 s, import 124.98 s, tests 1.07 s, environment 29.40 s). The 10 files are 1,924 lines (`wc -l`) |
| `pnpm test:agent <spec>` (queue path) | fails: `EROFS: read-only file system, open '/run/user/1000/varve-validation-queue/shared-0.lock'`; the direct vitest command above is the measured substitution |
| `pnpm worktree:status` | B-10 row: `current seam/B/B-10-content-aware-fill 6128380b39b5`; the only working-tree delta is the untracked phase-0 directory `remediation/B-10/` |
| `pnpm queue:status` | "validation-queue: exclusive free; shared 0/4 slots busy; 0 waiting"; runtime `/run/user/1000/varve-validation-queue` |
| environment | `node_modules` is a single symlink to `/home/kevina/CodingProjects/varve/node_modules`; pnpm cannot lock/install there (read-only store: "Read-only file system (os error 30)"), so tools run against the main checkout's installed trees |
| `git status --short` after measurements | only `?? remediation/B-10/` (phase-0 docs); no source, baseline, map, ledger or manifest change |

Recorded in `SEAM_SPEC.md` pre-flight by the seam owner (in this worktree, not
re-run for this document): direct recursive TypeScript substitution
`packages-checked=20 packages-fail=0 desktop-exit=0 e2e-exit=0` (exit 0).

## Consumer and spec inventory (measured with grep)

- Module-path importers: `packages/editor/src/Shell.tsx:33`
  (`import { ContentAwareFillDialog } from './components/ContentAwareFill'`),
  rendered at `Shell.tsx:1138-1146` behind `{editor.state.cafDialogNodeId && (...)}`
  with `nodeId`, `isOpen={true}`, `onClose`/`onApplied` =
  `editor.closeCafDialog`. `packages/editor/src/components/ContentAwareFill/index.ts`
  lines 1-2 re-export `ContentAwareFillDialogProps` and
  `ContentAwareFillDialog`; no other source module imports the target path.
- `ContentAwareFillDialogProps` consumers: only `index.ts:1` (re-export) and the
  target itself (definition 495-500, parameter type 507). No external type
  consumer.
- jsdom specs: **none**. `grep -rln 'ContentAwareFillDialog' --include='*.test.ts'
  --include='*.test.tsx' .` returns no paths. The 10-file / 102-test covering set
  measures neighbouring behaviour, not the dialog: the two action specs
  (`packages/editor/src/actions/createActionHandlers.test.ts` 877 lines,
  `registerAll.test.ts` 291 lines) reference the `contentAwareFill` action only
  (`createActionHandlers.test.ts:549,564`; `registerAll.test.ts:175,177`), and the
  eight sibling suites (756 lines) import the eight sibling helper modules
  (`expandCanvas`, `expandComposition`, `expandControls`, `generationRaster`,
  `maskOperations`, `selectionEvidence`, `selectionHealth`,
  `variationSession`). **Recorded gap:** no jsdom spec imports or mounts the
  moved declarations.
- Rendered-surface coverage (deferred by policy): `tests/e2e/caf/caf.spec.ts`
  (1,056 lines, 22 tests; selects `dialog.varve-dialog--caf[open]`,
  `#caf-dialog-title`, `.caf-dialog__quality-btn`, `canvas.caf-dialog__mask-canvas`,
  `canvas.caf-dialog__preview-canvas`, footer actions) plus 11 PNG baselines in
  `tests/e2e/caf/caf.spec.ts-snapshots/` (`generative-edit-*-chromium-linux.png`).
  No browser lane runs for this seam; the spec and baselines must stay untouched.

## Required reading (in protocol order)

1. `docs/quality/agent-context-remediation-2026-10-28.md` — five-defect matrix;
   ranked backlog **row 4**: "content-aware fill dialog UI and preview workflow
   ... split dialog shell + state hook, preview canvas, control sections, and
   result placement; keep component bodies under the 200 complexity ceiling |
   Medium risk, batch B. UI behavior verified by component tests". The last claim
   is contradicted by the measured jsdom gap above; the seam substitutes the
   partition/byte-identity proof and records the gap.
2. `docs/plans/agent-infrastructure-campaign-2026-10-28.md` — Batch B order
   "... room server, bgremove, SAM2, ContentAwareFill, AdjustmentEditor";
   per-split task protocol (move code only, focused tests before/after, biome,
   `--update`, sequential merge); worker rule (one worker per worktree, no
   concurrent baseline update, no `--force`, no merge).
3. `docs/quality/file-size-policy.md` — 400-line cap, 350-400 split target,
   baseline lifecycle, `--update`/`--force` rules, `--staged` lane, seam tooling
   (`godsplit-plan` ranges only; `refactor-verify` declaration/export proof).
4. `remediation/prompts/01-RESEARCH-AND-GAP-ANALYSIS.md` and
   `02-SEAM-EXECUTION-TEMPLATE.md` (this document, `GAP_ANALYSIS.md`,
   `SEAM_SPEC.md`); prompts 03/04 only when their gates fire (03 is answered in
   `GAP_ANALYSIS.md`; 04 does not fire).
5. `.ai/skills/split-god-file.md` — split at a real seam, parent keeps the public
   API, baseline update in the same change, splitting does not lower function
   complexity.
6. `docs/quality/concurrent-agents.md` + `docs/agents/validation-and-workflow.md`
   — one writer per worktree, single-writer generated surfaces, staged-only
   `verify:commit`, quiet validation substitution.
7. Target read only in line ranges: imports 1-105 (21 import statements, CSS
   import at 104), 29 planner block headers, hook region 860-1180 and 1435-1490,
   render boundary 3294-3320, tail 4495-4513. B-09
   (`.worktrees/B-09/remediation/B-09/*`) is the formatting precedent for the
   seam documents and the orchestrator plus byte-verbatim-phase precedent for a
   giant declaration.

Precedents measured from `BACKLOG_LEDGER.md`: TS seams become an explicit named
re-export surface plus destination-directory modules, all <= 400 lines; giant
declarations sub-split as a thin orchestrator with phase bodies byte-verbatim
(B-04/B-05/B-06/B-09). `refactor-verify` runs `--dest` before tests and allows
planned glue names (`presentCount >= baseCount`).

## A. Research themes (repository evidence first)

1. **Module-evaluation side effects.** Meaning: a declaration move must not
   change when anything is constructed, registered or imported. Evidence: the
   target's module scope holds only the 21 imports, nine constants
   (106-114), the `EditableSourceMask` type alias (116-124), 16 private
   helper functions and two interfaces (126-500) — no module-scope
   construction or subscription (planner: 29 pure declaration blocks). The
   one evaluation-order-sensitive statement is the side-effect CSS import at
   line 104, whose only importer in the repository is this file (measured with
   `grep -rn 'ContentAwareFillDialog.css'`). Failure mode: the A-04 precedent —
   a singleton duplicated per module, or a side-effect import lost/duplicated
   when code moves. Guardrail: the CSS import stays exactly once in the parent;
   the nine constants get exactly one home; no new module-eval code is added.
   Owner: `SEAM_SPEC.md` destination map.
2. **tsconfig project boundaries and package entry points.** Evidence: the
   destination is inside `packages/editor/src`, so it stays in
   `packages/editor/tsconfig.json` and inside the same `@varve/editor` package;
   `components/ContentAwareFill/index.ts` keeps both re-exports unchanged, and no
   package manifest changes. Failure mode: making the move compile by adding a
   cross-package import or a new entry point. Guardrail: moved code keeps its
   existing `@varve/*` imports; imports are rebased relative only.
3. **Path aliases and import ordering.** Evidence: the target imports workspace
   aliases plus relative siblings (`./expandCanvas`, `./selectionHealth`,
   `./variationSession`, ...) and parent-level modules (`../../context/...`,
   `../../tools/...`). From `ContentAwareFill/dialog/` each sibling gains one
   level and each parent-level import gains one level (`./x` -> `../x`,
   `../../y` -> `../../../y`). Failure mode: a missed rebase (caught by tsc) or a
   wrong-but-resolving rebase that imports a nearby sibling with a similar name.
   Guardrail: mechanical rebase reviewed per import, biome for ordering, direct
   tsc gate.
4. **Template-literal and JSX code-like text.** Evidence: dense user-facing copy,
   aria labels, class names and template literals throughout the handlers and
   the 1,218-line JSX render body (3296-4513). Failure mode: a brace/line-count
   cut corrupting JSX text, an attribute or a template literal. Guardrail: cut
   only on planner/recorded declaration boundaries; partition proof asserts every
   moved line byte-identical after dedent; no class-name, aria-label or copy edit.
5. **Overloaded and identity-sensitive declarations.** Evidence: the file exports
   exactly two names — `ContentAwareFillDialogProps` (495-500) and
   `ContentAwareFillDialog` (502-4513) — imported through `index.ts` by
   `Shell.tsx`. There are no TypeScript overloads. Failure mode: a moved export
   that is no longer importable from the original module path, or a changed props
   contract. Guardrail: both exports stay on the original path (the parent keeps
   the shell/component export; type check covers consumers), `index.ts` is
   untouched, and `refactor-verify` `missingExports` must stay empty.
6. **Same-named private helpers in sibling modules.** Evidence: 16 module-private
   functions plus nine constants; adjacent sibling modules already export
   similarly named helpers (`expandCanvas.ts`, `expandComposition.ts`,
   `expandControls.ts`, `generationRaster.ts`, `maskOperations.ts`,
   `selectionEvidence.ts`, `selectionHealth.ts`, `variationSession.ts`).
   Failure mode: copy-paste duplicates that drift across destination modules.
   Guardrail: one home per declaration; cross-module imports use planned named
   exports only (they were module-private at base); no duplicate copies.
7. **Dropped declarations.** Evidence: base `refactor-verify` measures 29/29
   today. Failure mode: a declaration left in neither the parent nor a
   destination module. Guardrail: hand-completed 29-block inventory in
   `SEAM_SPEC.md`; `refactor-verify --dest` exit 0 before tests and again after
   biome; new glue names are allowed (`presentCount >= baseCount`).
8. **Tracked-versus-untracked baseline policy.** Evidence: the clean worktree
   reports 0 untracked WIP over-cap and 0 violations. New `dialog/*.tsx` and
   `dialog/*.ts` modules are untracked until staged, are reported as WIP only,
   and are enforced by the `--staged` lane the moment they are staged.
   Guardrail: measure every destination module with `wc -l` before staging;
   `--update` never freezes WIP.
9. **Stale and grandfathered baseline entries.** Evidence: 946 frozen, 0 stale
   measured. Failure mode: a second entry leaving, a frozen file growing, or a
   module over 400 being staged hides a wrong ratchet. Guardrail: the baseline
   diff must remove exactly the target entry (946 -> 945), 0 added, 0 grown;
   `--update` without `--force`; any other diff is a STOP.
10. **Concurrent worktree conflict on peer-hot files.** Evidence:
    `pnpm worktree:status` shows B-10 as the current worktree for
    `seam/B/B-10-content-aware-fill`; `pnpm queue:status` reports exclusive free,
    shared 0/4, 0 waiting. `.file-size-baseline.json`,
    `docs/agents/repo-map.generated.md`, `BACKLOG_LEDGER.md`, `docs/README.md`
    and `package.json` are single-writer surfaces. Guardrail: this worktree is
    their only writer for this seam; regenerate the map from the staged tree;
    never hand-merge.
11. **Rollback.** Evidence: the seam is uncommitted until the final step and
    everything it creates lives inside `.worktrees/B-10` plus
    `remediation/B-10/`. Failure mode: committing a partial seam to "save" it.
    Guardrail: on red, discard only this worktree's uncommitted changes; never
    revert main-checkout untracked files (`NEXT_PROMPT.md` and other sessions'
    work live there); never reset the shared checkout; stop before the ratchet if
    `--update` cannot remove exactly one entry.
12. **Rust-crate equivalents.** Does not apply: B-10 is a TypeScript entry and
    both seam tools parse the target (measured `godsplit-plan` exit 0,
    `refactor-verify` exit 0). No `mod` declaration, `generate_handler!`
    registration, crate-root growth or `audit:ipc` surface is involved; Rust
    seams are verified by their package suites, not by `refactor-verify`.

### B-10-specific themes

13. **No direct jsdom coverage of the dialog (recorded gap).** Evidence:
    `grep -rln 'ContentAwareFillDialog' --include='*.test.ts' --include='*.test.tsx'`
    returns nothing; the measured 102-test covering set covers sibling helper
    modules and the `contentAwareFill` action, not the target's declarations.
    Rendered behaviour is covered only by `tests/e2e/caf/caf.spec.ts` (22 tests)
    and its 11 PNG baselines, both heavy-lease and deferred by policy. Failure
    mode: a move that silently changes DOM, hook order or an effect dependency
    and is caught by no focused test. Guardrail: partition/byte-identity proof
    plus the unchanged covering set plus untouched e2e spec/baselines; the gap is
    recorded in `GAP_ANALYSIS.md`; no jsdom component test is added inside the
    seam (prompt 02 forbids new tests/snapshots for a pure move, prompt 03
    forbids folding UI work into the seam).
14. **Rendered-dialog front-end gate decision.** Evidence: the target renders a
    `<dialog>` (JSX root at 3296-3328), so prompt 03's trigger surface list
    applies and the gate must be explicitly answered rather than skipped. The
    seam is a pure declaration move that preserves DOM, class names, props,
    state transitions and the export path, so prompt 03 necessity questions 1-3
    are No and question 4 is Yes: the gate is answered "not triggered" with the
    component-test plus "no visual surface changed" proof (substituted by the
    covering set and byte identity). Prompt 04 does not fire: no visual baseline
    edit, no `pnpm visual:update`, no browser lane, no screenshot artifact, no
    `VISUAL_VALIDATION.md`. Verdict and quotes: `GAP_ANALYSIS.md`.
15. **The 4,012-line component is a sub-split hazard.** Evidence: planner hazard
    "sub-split required: ContentAwareFillDialog lines 502-4513 is 4012 lines on
    its own"; the component holds 52 `useState`, 20 `useRef`, 31
    `useCallback`, 5 `useMemo` and 11 `useEffect` calls, an early return at
    3294, and a 1,218-line JSX render body (3296-4513). Failure mode: a
    single-file move that leaves the parent over 400 lines, or a cut through the
    component body that reorders hooks. Guardrail: orchestrator plus hook/section
    modules under `dialog/` (B-09 precedent), every destination module <= 400
    lines (350-400 target), further sub-split inside the same destination
    directory if needed; hooks keep creation order and dependency arrays.
16. **Effect order A-K.** Evidence: exactly 11 top-level `useEffect` calls, at
    lines 955 (preview-area ResizeObserver measure), 971 (dialog
    `showModal`/`close` sync), 981 (reset form state on open), 1042 (hydrate
    from an accepted edit on reopen), 1078 (close/reset when the source is
    missing or its signature changed), 1097 (cancel jobs on close), 1107
    (unmount cleanup), 1117 (model availability probe), 1137 (native generative
    model status probe), 1164 (async source/preview load), 1451
    (`requestAnimationFrame(centerPreview)`). Failure mode: an extraction that
    changes effect order, adds an effect or reconditions one (stale closures,
    double loads, cancelled-job leaks). Guardrail: the hook-order rule from
    `AGENTS.md`; the effects move into lifecycle/status/centering hooks in the
    same A-K order with dependency arrays byte-verbatim; no effect added,
    removed, reordered or reconditioned (SEAM_SPEC hook invariants).
17. **Render-phase `currentJobSnapshotRef.current` assignment.** Evidence:
    `currentJobSnapshotRef` is declared at 564, written during render at 897-909
    (document, source revision/hash, placement fingerprint, mask revision,
    settings and output-frame fingerprints), and read by handlers at 2184, 2188
    and 2758. Failure mode: moving the assignment into an effect or a component
    that renders later, so a generation started in the same render sees a stale
    snapshot. Guardrail: the assignment stays in the same derived/state section
    of the orchestrator (render phase, before the generation/apply hooks read
    it); review check in `SEAM_SPEC.md` hook invariants.
18. **Oversized handlers.** Evidence: `handleGenerate` spans 2145-2854 (~710
    lines), `handleApply` 2885-3229 (~345 lines), and `handleDeleteVariation`
    3264-3292, each a `useCallback` whose dependency array ends at 2852-2854,
    3227-3229 and 3291 respectively. They are the seam's complexity drivers: the
    ranked row requires component bodies under the 200 complexity ceiling, and a
    file split alone does not lower a function's estimated complexity (only the
    extraction moves handler bodies out of the component). Failure
    mode: a handler extraction that edits the body to fit a new module boundary.
    Guardrail: handler bodies move byte-verbatim into hook modules; dependency
    arrays are part of the byte identity, not reformatted; `audit-health`
    complexity listing must not grow. Note: splitting a file does not lower a
    function's complexity; extracting the handler bodies out of the component is
    what lowers the component's estimate, so this seam is the relief path.

## B. Reference-tool and failure-mode analysis

What codemod and batch-refactoring tools fail at that this seam must not repeat:

- **Silent skips** (a declaration does not match the pattern, is left behind, and
  the tool still reports success). Prevented here by the planner's fixed 29-block
  inventory, the hand-completed inventory in `SEAM_SPEC.md`, and
  `refactor-verify` exiting non-zero with an explicit `missing`/`missingExports`
  list instead of warning.
- **False-success reporting** (exit 0 while the result is broken). Prevented by
  running the verifier before tests, then the 102-test covering set, then the
  direct tsc substitution recorded in `SEAM_SPEC.md`, then biome, then the
  ratchet, then the staged-only `pnpm verify:commit`.
- **Type-check failure after automated edits** (import rebases and export
  prefixes). Prevented by the recursive tsc program and by `refactor-verify`
  requiring moved exported names to exist at top level.
- **Large-changeset review blindness** (a dozen new modules nobody can review).
  Mitigated by the recorded allowlist (every destination module is assigned base
  ranges plus named structural glue), the partition/byte-identity accounting, and
  a ledger row that carries the counts.

What remains untested or unknown, and therefore becomes explicit checks and STOP
conditions in `SEAM_SPEC.md`:

- The moved declarations have no direct jsdom/unit test (theme 13): rendered
  equivalence rests on byte identity, the unchanged covering set and the
  untouched e2e spec/baselines. Any moved line that cannot be byte-identical is
  a STOP, not an edit.
- Render-phase ref timing (theme 17) and hook/effect order (theme 16) are only
  review-visible; the byte-identity check plus the hook invariants are the proof.
- JSX section extraction changes component boundaries even when JSX is
  byte-identical; props threading is structural glue and must be reviewed line by
  line against the base render body.
- Whether biome reflows moved signatures: recorded as planned formatting-only
  edits if they occur (B-03/B-05/B-09 precedent).

## C. Edge-case and gap register

| Edge case | Applies? | Decision for B-10 (evidence + guardrail) |
|-----------|----------|------------------------------------------|
| Module-eval side effects (constants, CSS import) | applies | Nine constants one home; CSS import at 104 stays exactly once in the parent; no module-scope construction exists (planner 29 pure declarations) |
| tsconfig project boundaries / package entry points | applies | Destination inside `packages/editor/src`; `index.ts` and package manifests unchanged; moved code keeps `@varve/*` imports |
| Path aliases and import ordering | applies | One level deeper from `dialog/`; mechanical rebase, biome ordering, direct tsc |
| Template-literal / JSX code-like text | applies | JSX render 3296-4513 and handler copy move with their declarations only; partition byte identity |
| Overloaded / symbol identity | applies | `ContentAwareFillDialog` + `ContentAwareFillDialogProps` stay on the original path; `missingExports: []` |
| Same-named private helpers in sibling modules | applies | One home per declaration; planned cross-module named exports only; duplicate-name review |
| Dropped declaration | applies | Inventory 29; `refactor-verify --dest` exit 0 before tests and after biome |
| Parse failure in target/destination | applies (measured OK) | `godsplit-plan` exit 0; tsc parses every new module; JSX-bearing modules must be `.tsx` |
| Tracked-vs-untracked baseline | applies | New `dialog/` modules untracked until staged; `--staged` lane enforces <= 400 at stage time |
| Stale / grandfathered / slack entry | applies | 946 frozen, 0 stale measured; exactly the target entry must leave (946 -> 945); any other diff STOP |
| Baseline regeneration refusing to add or raise | applies | `--update` without `--force`; review `git diff -- .file-size-baseline.json`; 0 added, 0 grown |
| Test-file exemption from the ratchet | applies | Covering specs (1,924 lines total) must not grow or be edited; expected byte-identical |
| Generated files and exclusions | applies | `vendor/**` + 3 generated tables untouched; repo map regenerated only via `pnpm agent:map` |
| Concurrent worktree conflict on peer-hot files | applies | Queue exclusive free measured; B-10 is the only writer of baseline/map/ledger; advisory claims |
| Rollback path | applies | Uncommitted seam; discard only this worktree's changes; never commit partial; never touch main-checkout untracked work |
| Unknown / unresolved tools | does not apply | Both seam tools exist and parse the target (exit 0 measured); `--top` is unsupported, use no flags |
| Hot render/replay dispatch | does not apply | No render/replay dispatch or per-node loop touched; split-god-file benchmark clause not triggered |
| Rust equivalents | does not apply | TypeScript entry; `refactor-verify` parses TS only; package suites are the Rust path |
| Front-end necessity gate | answered, not triggered | Rendered dialog, but the change is internal-only (module boundary); prompt 03 answer and prompt 04 non-firing recorded in `GAP_ANALYSIS.md` |
| Visual/Playwright gates | does not apply | No rendered-surface change; no visual baseline edit, no browser lane, no screenshots; `caf.spec.ts` + 11 PNGs untouched |

## Failure modes -> guardrails

| Failure mode | Evidence | Guardrail command / review check | Owner |
|--------------|----------|----------------------------------|-------|
| Silent skip of a declaration during the cut | planner 29 blocks; base verifier 29/29 | `refactor-verify --base master --target <target> --dest .../dialog --json` exit 0 before tests | 02 step 3 / SEAM_SPEC |
| Corrupted JSX, class name, aria label or template literal | 1,218-line JSX body (3296-4513), dense handler copy | partition/byte-identity accounting (every moved line equals its base line after the recorded dedent) | 02 step 2 / SEAM_SPEC proof plan |
| Hook/effect order or dependency-array drift | 11 effects at 955/971/981/1042/1078/1097/1107/1117/1137/1164/1451; deps end at 2852-2854, 3227-3229, 3291 | hook invariants review; dependency arrays byte-verbatim; `audit-health` | SEAM_SPEC hook invariants |
| Render-phase ref timing change | `currentJobSnapshotRef.current` written 897-909, read 2184/2188/2758 | assignment stays in the derived/state section of the orchestrator | SEAM_SPEC hook invariants |
| Public export lost from the original path | `Shell.tsx:33,1138-1146`; `index.ts:1-2` | parent keeps both exports; `missingExports: []`; `index.ts` untouched | 02 step 1 / SEAM_SPEC |
| Import rebase error or new cycle | relative sibling/parent imports at 1-104 | direct recursive tsc (recorded in SEAM_SPEC pre-flight); `node scripts/audit-health.mjs`; biome | 02 step 4 |
| No direct jsdom coverage of the moved code | measured: no spec imports the dialog | unchanged 102/102 covering set; byte identity; untouched `caf.spec.ts` + 11 PNGs; gap recorded in GAP_ANALYSIS | 01 section E / GAP_ANALYSIS |
| New module over the 400-line cap | component is 4,012 lines; 16 helpers + JSX need their own homes | `wc -l` pre-stage plus `audit-file-size.mjs --staged` inside `pnpm verify:commit` | 02 step 6 |
| Baseline grows or a second entry leaves | 946 frozen / 0 stale measured | `--update` without `--force`, diff review, `pnpm audit:filesize` exit 0 at 945 | 02 step 5 |
| Behavior drift in the tested neighbourhood | 102 covering tests | covering set 102/102 before and after, 0 failures, no test edit | 02 step 4 |
| Commit contamination (NEXT_PROMPT, other sessions, lockfiles) | main checkout carries untracked work | explicit stage list; `pnpm verify:commit` staged-only; `git status --short` review before commit | 02 steps 6-8 |
| Queue/store EROFS masking a red check | measured `pnpm test:agent` EROFS; read-only store lock failure | direct vitest substitution and direct tsc program, run before and after | Blockers / this document |
| Duplicate helper copies drifting | one-home rule | destination table + duplicate-name grep after the move | SEAM_SPEC destination map |
