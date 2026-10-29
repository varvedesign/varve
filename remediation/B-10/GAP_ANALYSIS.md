# B-10 gap analysis — Content-Aware Fill dialog split

Companion to `RESEARCH.md`. Measured checkpoint state lives there; this file
records the gap register with owners, the measured coverage gap, and the
front-end necessity verdict.

## Measured checkpoint state (summary)

`.worktrees/B-10` on branch `seam/B/B-10-content-aware-fill` at
`6128380b3` (the committed B-09 seam), clean before the phase-0 docs.
`pnpm audit:filesize` exit 0 at **946 frozen / 0 stale / 0 violations /
0 untracked WIP** (report: 6,234 scanned, 946 over the cap, 299,046 excess
lines, baseline entries 946). Target measured 4,513 lines, frozen at 4513
(`.file-size-baseline.json` line 144). `godsplit-plan` exit 0 with 21 imports
and 29 blocks plus the hazard "sub-split required: ContentAwareFillDialog lines
502-4513 is 4012 lines on its own"; `refactor-verify --base master` exit 0 with
`{ok:true, baseCount:29, presentCount:29, missing:[], missingExports:[]}`.
Covering set measured on this worktree by direct vitest (the queue path fails
with EROFS on `/run/user/1000/varve-validation-queue/shared-0.lock`):
**10 files, 1,924 lines, 102 passed (102), 0 failed, 44.22 s duration**. The
environment uses a single `node_modules` symlink to the main checkout because
the pnpm store is read-only. A prior handoff recorded 29.9 s for the same set;
the pass counts are identical, only wall time differs.

## Gap -> action -> owner -> prompt file

| Gap | Action | Owner | Prompt file |
|-----|--------|-------|-------------|
| Batch definition/order: is B-10 the correct next entry? | Yes, measured: the remediation doc's Batch B list is "... room server, bgremove, SAM2, ContentAwareFill, AdjustmentEditor" and the campaign plan orders "... bgremove, SAM2, ContentAwareFill, AdjustmentEditor"; ledger rows B-01..B-09 are committed (B-09 at 946), so B-10 is next and disjoint (its target path is untouched by any completed seam). The entry after B-10 is `packages/editor/src/components/AdjustmentLayer/AdjustmentEditor.tsx` (ranked row 14) | orchestrator (records merged seams in the dated doc); this session executes only B-10 | this file + `02-SEAM-EXECUTION-TEMPLATE.md` |
| Baseline regeneration: who runs `--update`, how is the diff reviewed, what prevents growth? | The seam worker runs `node scripts/quality/audit-file-size.mjs --update` once in this worktree after the split compiles and the covering set passes; `git diff -- .file-size-baseline.json` must show exactly the removal of `"packages/editor/src/components/ContentAwareFill/ContentAwareFillDialog.tsx": 4513` (0 added, 0 grown), then `pnpm audit:filesize` exit 0 at 945. `--update` refuses new freezes by policy; `--update --force` is forbidden. The orchestrator regenerates on the merged tree | seam worker (this session) | 02 step 5; policy in `docs/quality/file-size-policy.md` |
| Seam tooling: planner gives ranges, not destinations; verifier is TS-only | `godsplit-plan` (no flags; `--top` unsupported at this checkpoint) seeds the inventory; every destination in `SEAM_SPEC.md` is a hand decision; `refactor-verify --dest` must exit 0 before tests; Rust substitution does not apply (both tools parse the target) | seam worker | 01 + 02 steps 1-3 |
| No direct jsdom coverage of the dialog (recorded gap) | `grep -rln 'ContentAwareFillDialog' --include='*.test.ts' --include='*.test.tsx'` returns nothing: no spec mounts the component. The measured 10-file/102-test covering set covers the sibling helper modules and the `contentAwareFill` action only. Rendered behaviour rests on `tests/e2e/caf/caf.spec.ts` (22 tests) + 11 PNG baselines (heavy-lease, deferred) and on the partition/byte-identity proof. Do not add a jsdom component test inside the seam (02 forbids new tests for a pure move; 03 forbids folding UI work into the seam); a dedicated component test would be a separate bounded task | seam worker | this row + `SEAM_SPEC.md` proof plan / stop conditions |
| The 4,012-line component is a sub-split hazard | Sub-split into an orchestrator plus hook/section modules under `dialog/` along recorded boundaries, with bodies byte-verbatim and all hook order/dependency arrays preserved; every destination module <= 400 lines, further sub-split allowed inside the same destination directory. Any range that needs a semantic edit to compile is a STOP | seam worker | `SEAM_SPEC.md` sub-split + stop conditions |
| Rollback: what if the seam lands but the ratchet does not go down? | Stop before committing; the seam stays uncommitted; discard only this worktree's changes; never `--force`, never hand-edit the baseline, never commit a partial seam, never touch the main checkout's untracked work | seam worker | 02 steps 5-8 |
| Observability: how do we know the queue shrinks rather than changes shape? | `--report` FROZEN_COUNT 946 -> 945 and excess lines 299,046 -> lower by the target's excess; exactly one ledger row with a caller-generated ISO-8601 timestamp; monotone ratchet (never an added/grown entry); there is no dashboard | seam worker (row + report), orchestrator (dated doc) | 02 steps 5-7 |
| Front-end / accessibility / i18n / dark mode / empty-error-loading states | Not applicable to a pure move (verdict below): the dialog's DOM, class names, aria labels, copy, props, state transitions and error/empty/loading states move verbatim; any change is a defect. No visual baseline edit, no browser lane, no screenshot. Proof: covering set 102/102 unchanged, untouched `caf.spec.ts` + 11 PNGs, and the "no visual surface changed" statement in `SEAM_SPEC.md` | seam worker | 02 (03 answered, 04 does not fire) |
| Concurrency: peer-hot surfaces | `.file-size-baseline.json`, `docs/agents/repo-map.generated.md`, `BACKLOG_LEDGER.md`, `docs/README.md`, `package.json` are single-writer; this worktree is their only writer for this seam (queue exclusive free measured). Regenerate the map from the staged tree; never hand-merge | seam worker | 02 steps 6-7 |
| Testing: is the covering suite a real-world scenario? | Real-world for the neighbouring surface: the two action specs exercise handler registration and the `contentAwareFill` action; the eight sibling suites exercise the helper modules the dialog composes. **Not covered:** the dialog itself (no jsdom mount), its hook order/effects, its JSX sections, and the rendered DOM path; `tests/e2e/caf/caf.spec.ts` is the deferred rendered proof and is not run in this seam. Residual recorded here and in `RESEARCH.md` theme 13 | seam worker | `RESEARCH.md` theme 13; `SEAM_SPEC.md` proof plan |
| Docs index: does this seam touch `docs/`? | No: it adds `remediation/B-10/*` (outside `docs/`) and regenerates `docs/agents/repo-map.generated.md` via `pnpm agent:map` (generated, staged). `pnpm audit:docs` requires no index row for remediation docs; the dated remediation record and campaign plan stay untouched by workers | seam worker | 02 step 6 |
| Environment limits (measured, not blockers) | `node_modules` is one symlink to the main checkout; pnpm cannot install (read-only store: "Read-only file system (os error 30)"); the validation queue path is EROFS (`shared-0.lock`), so use direct `pnpm exec vitest run ... --reporter=dot --silent=passed-only` and the direct recursive tsc program; both substitutions produced checkpoint-identical results | seam worker | Blockers section of the handoff; this file |

## Front-end necessity gate (prompt 01 section D)

Gating text: prompt 03 — "Run this gate only when the seam or a linked task
changes a rendered surface or the contract behind one:" (the surface list
includes a dialog), and necessity question 4 — "Is the change only internal
(module boundary, export path, implementation)? If yes, the required proof is
the unchanged component test plus a 'no visual surface changed' statement; do
not open a visual-baseline task." Prompt 03 also says: "If the answer to any of
1-3 is yes, link `04-VISUAL-VALIDATION-AND-CLOSEOUT.md` in the same task before
merge. Do not silently fold UI work into a refactor seam." Prompt 04 says:
"**Not required for a pure code move.** A declaration-level extraction that
preserves DOM, class names, props, state transitions, and API shapes must not
change pixels." and "Do not update a baseline and do not start a browser lane
for a pure move."

- Does this seam change anything an operator sees or does in a remediation
  workbench? **No** — no workbench exists (the queue is the baseline + ledger +
  report commands); B-10 is a pure module move that must render identically.
- Does it change an API/IPC response shape consumed by the UI? **No** — the two
  exports keep identical names, signatures and import paths; no IPC surface is
  touched.
- Does it change error, empty, loading, or permission states? **No** — every
  announcement string, error mapping, state write and JSX attribute moves
  verbatim; any such change is a defect, not a feature.
- Is the change only internal (module boundary, export path, implementation)?
  **Yes** — the pure-move condition of question 4.

**Verdict: prompt 03 is opened and answered "not triggered"; prompt 04 does not
fire.** A rendered dialog does not by itself trigger the gate — the trigger is a
change to a rendered surface, and none occurs. Required artifacts: the "no
visual surface changed" statement in `SEAM_SPEC.md`, the unchanged covering set
(102/102 before and after), the partition/byte-identity accounting, and the
untouched `tests/e2e/caf/caf.spec.ts` plus its 11 PNG baselines. No
`VISUAL_VALIDATION.md`, no `pnpm visual:update`, no browser lane, no screenshot
and no baseline change. Because no jsdom spec mounts the dialog, the
component-test half of the question-4 proof does not exist as an artifact; that
gap is recorded above, and no component test is added inside the seam.
