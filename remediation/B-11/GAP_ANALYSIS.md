# B-11 gap analysis — AdjustmentEditor family split

## Measured checkpoint state (summary)

- Worktree `.worktrees/B-11`, branch `seam/B/B-11-adjustment-editor`, HEAD
  `5e4b1955c` (integrated master merge of the B-10 checkpoint `196535baf`).
  Clean start: `git status --porcelain` 0 paths.
- `pnpm audit:filesize` / `node scripts/quality/audit-file-size.mjs --report`
  on the clean worktree: exit 0; 6,280 source files scanned; **945 frozen
  entries, 0 stale**; 945 files over the 400-line cap; 294,933 excess lines;
  0 untracked WIP over-cap files.
- Target: `packages/editor/src/components/AdjustmentLayer/AdjustmentEditor.tsx`
  = 2,405 lines, baseline entry at `.file-size-baseline.json` line 135 = 2405;
  covering test = 309 lines, `AdjustmentEditor.test.tsx` 18 passed / 0 failed
  (handoff measurement; this session measured the pair with
  `AdjustmentPanel.test.tsx` at 32/32 before and after).
- `godsplit-plan` on the target: exit 0, 24 blocks, 23 imports; hazards
  measured: `LegacyAdjustmentEditor` (807 lines) and `HalftoneEditor`
  (446 lines) both require a documented sub-split.
- `refactor-verify --base master` on the untouched target: exit 0,
  `{ok:true,baseCount:24,presentCount:24,missing:[],missingExports:[]}`.
- Expected ratchet: **945 → 944**, exactly one removed entry, 0 added, 0 grown.
- Environment substitutions measured: read-only pnpm store; 21 symlinked
  `node_modules` trees; validation queue EROFS; direct `tsc`/`vitest`
  substitutions (same as B-10). No Rust seam.

## Gap -> action -> owner -> prompt file

| Gap | Action | Owner | Prompt file |
|---|---|---|---|
| Batch order: confirm B is the active batch and B-11 is the next unblocked entry (B-10 committed as `196535baf`, integrated by the Lead; B-12 follows) | Cross-check the ranked backlog row 14, the Batch B table, and `BACKLOG_LEDGER.md`; do not open the next entry | Lead / seam worker | 01 A, 02 |
| Clean sub-split plan for two over-cap declarations inside the target (807- and 446-line functions) | Document orchestrator + phase renderers for Legacy and hook + shell + advanced phase for Halftone in `SEAM_SPEC.md` before touching source; keep every module ≤400 lines | Seam worker | 01 A, 02 Step 1 |
| Declaration inventory is hand-completed, not tool-proposed | Seed from `godsplit-plan` (24 blocks), read each block range, assign a destination per block, record base ranges/exports | Seam worker | 02 Step 1 |
| No declaration may be dropped or lose its export | `refactor-verify --base master --target <target> --dest <dest>` must exit 0 before tests; never edit the verifier | Seam worker | 02 Step 3 |
| Behavior must be identical (state lifetime, hook order, React tree) | Explicit hook invariants: `hueSaturationRange` stays in the orchestrator hook chain; nested `LutEditor` stays nested; Halftone Advanced stays unconditionally mounted; dispatch fallback DOM preserved | Seam worker + Lead review | 01 C, 02 Step 1/2 |
| Rendered-surface proof for a pure move | Run the direct covering pair before and after; count unchanged; state "no visual surface changed" with the jsdom component-test proof; no visual baseline exists for this component | Seam worker | 03, 04 (not triggered) |
| Baseline regeneration | Seam worker runs `--update` in its worktree, reviews the diff (exactly one removal), runs `pnpm audit:filesize`; `--force` forbidden; orchestrator re-measures after merge | Seam worker; orchestrator after merge | 02 Step 5 |
| Seam tooling limits | `godsplit-plan` gives ranges/hazards but no destination; `refactor-verify` is TypeScript/JavaScript only; no Rust verifier is applied | Seam worker | 01 E, 02 Step 3 |
| Missing direct unit coverage for 11/24 blocks (notably `SelectiveColorEditor` zero coverage anywhere) | Record the gap (not fix it in a pure-move seam); rely on the unchanged component-test pair as the behavior net and on e2e specs as the broader net without running browser lanes | Seam worker | 01 A/C |
| Rollback if the ratchet cannot go down or the move is incomplete | Stop before commit; discard only the B-11 worktree changes (restore tracked target from HEAD, delete untracked dest tree); never reset the shared checkout | Seam worker | 02 Step 8, 01 A.11 |
| Shared-surface concurrency (baseline, map, ledger, docs index, manifests) | One writer in `.worktrees/B-11`; advisory claims on the target dir, baseline, map, ledger, `remediation/B-11`; stage then regenerate map; commit only seam files | Seam worker | 01 A.10, 02 Step 6 |
| Observability: queue must shrink, not change shape | One ledger row, one removed baseline entry, monotone ratchet, `--report` numbers recorded; no dashboard exists and none is built | Seam worker | 01 E |
| Docs index | This seam adds only `remediation/B-11/*`, outside `docs/`; `pnpm audit:docs` needs no docs-index row. No `docs/` page is added or moved | Seam worker | 01 E |
| Environment limits (read-only pnpm store, queue EROFS) | Use the measured substitutions: symlinked `node_modules`, direct `vitest`, direct recursive `tsc`; do not bypass a red gate | Seam worker | 01 A, 02 Step 0 |
| Stale counts in the handoff template | Re-measure everything at handoff time from the committed branch worktree and re-instantiate `NEXT_PROMPT.md`; never copy stale numbers | Lead | 02 Step 10 |

## Front-end necessity gate (prompt 01 section D)

Prompt 01 section D names this repository's front-end gate and prompt 03/04 are
opened only when a seam touches an operator-visible remediation surface. This
seam renders adjustment-editor components, so the four questions are re-answered
explicitly here rather than inherited from a non-UI entry:

- **Does this seam change anything an operator sees or does in a remediation
  workbench?** No. No remediation workbench exists (the queue is
  `.file-size-baseline.json` + `BACKLOG_LEDGER.md` + command output), and the
  seam is pure code motion. Verdict: prompt 03 opens as "not triggered".
- **Does it change an API response shape consumed by the UI?** No. The module
  path `./AdjustmentEditor` keeps its four named exports
  (`AdjustmentEditor`, `AdjustmentEditorProps`,
  `curvesPointsToCurvePoints`, `curvePointsToCurvesPoints`) and the dispatcher
  prop contract is unchanged; the test imports the same three value exports from
  the same path.
- **Does it change error, empty, loading, or permission states?** No. The
  fallback branch ("No editor for {kind}"), LUT capability disclosure text,
  histogram/loading props, and warning copy are moved verbatim.
- **Does it make the 945-entry queue harder to understand?** No. It removes one
  entry and adds one ledger row.

Verdict: **no front-end work; the necessity gate does not fire.** The rendered
surface proof is the direct jsdom component test pair
(`AdjustmentEditor.test.tsx` 18 passed / 0 failed before and after, plus
`AdjustmentPanel.test.tsx` 14/14) with no test edit and no module mock. Prompt
04 (visual validation and closeout) does not fire: no visual baseline exists for
this component, no baseline/screenshot/e2e file is touched, and no browser lane
runs for a file split. `SEAM_SPEC.md` carries the "no visual surface changed"
statement and the component-test proof.

## Environment limitations and deferrals

- The read-only pnpm store and the EROFS validation queue are environment limits,
  not seam blockers: `pnpm audit:filesize` was measured exit 0 (no queue), and
  tests/typecheck use the direct substitutions documented in `RESEARCH.md`.
- 11 of 24 blocks lack a direct unit assertion today (measured in
  `RESEARCH.md`); that is a pre-existing coverage gap recorded here, not
  something a pure-move seam may fix. No test is added, skipped, weakened, or
  snapshotted in this seam.
- No Rust crate is touched, so no Rust verifier or IPC audit is required.
