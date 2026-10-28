# GAP_ANALYSIS - Batch A / A-09

**Measured checkpoint state:** master `11e341e69e105cff7efef55e8645333efeebcc49`
(fast-forwarded by the Lead this session); `pnpm audit:filesize` exit 0 at
**956 frozen / 0 stale** in `.worktrees/A-09` (6,077 scanned, 0 untracked WIP
on the clean tree); target frozen at 1969 and 1,969 lines; covering suite
12/12 before; planner 79 blocks / 8 imports; verifier smoke
`baseCount 67`, `missing: []`.

## Gap -> action -> owner -> prompt file

| Gap | Action | Owner | Prompt file |
|---|---|---|---|
| G1 Batch ordering: is A-09 the correct next entry? | Campaign row A-09 and remediation row #21 both name `run-production-workload.mjs`; A-07 is the only seam completed since the checkpoint; the next queue entry in the handoff is A-09 alone | Lead | templates/NEXT-PROMPT.md |
| G2 Baseline regeneration after the split | Seam worker runs `audit-file-size.mjs --update` once in its worktree; diff must remove exactly `scripts/perf/run-production-workload.mjs`; `--update --force` forbidden; orchestrator re-runs on the merged tree | seam worker | 02 Step 5 |
| G3 `godsplit-plan --top` unsupported (exit 2, measured) | Use the plain form (79 blocks) plus a full manual read of every range; record the residual | seam worker | 01 / 02 Step 1 |
| G4 `refactor-verify` covers TS/JS only | Applies directly here (both smoke exit 0); no Rust substitution needed | seam worker | 02 Step 3 |
| G5 `pnpm install` blocked (read-only store) | 22 `node_modules` symlinks from the main checkout (A-07 workflow) | seam worker | 02 Step 0 |
| G6 Queue-backed `pnpm check:agent` blocked (EROFS on `/run/user/1000/varve-validation-queue`) | Substitute the same recursive tsc program run directly (20 packages + desktop + e2e); record as substitution, not as a `check:agent` pass | seam worker | 02 Step 0/4 |
| G7 Runner top-level side effects could fire at import | Destination modules are declaration-only; side-effect statements stay in the entry or move into functions called at the original position; import order analysis recorded in SEAM_SPEC | seam worker | 01 theme 1 / 02 Step 2 |
| G8 Mutable cross-boundary state (`partial`, `browser`, `exitCode`) | `partial`/`server`/`exitCode` stay entry-local and are threaded as parameters; `browser` becomes `export let` in `session.mjs` (A-06 pattern) | seam worker | 01 theme 3 |
| G9 Entry must end at or under 400 lines while keeping every module under 400 | 8-module destination map with expected sizes 110-358; entry ~230 | seam worker | 02 Step 1 |
| G10 Rollback if the ratchet does not go down | Stop before committing; discard only this worktree's edits; never `--force` | seam worker | 02 Step 5 |
| G11 Observability of a shrinking queue | One ledger row with measured counts; FROZEN_COUNT 956 -> 955 in the row; report re-run at closeout | seam worker | 02 Step 7 |
| G12 Peer-hot single-writer surfaces | Baseline, map, ledger regenerated in this worktree only; queue and worktrees measured idle before start | seam worker | 01 theme 10 |
| G13 Front-end necessity gate | Does this seam change anything an operator sees? **No** - Node tooling only, no workbench exists, no rendered output, no API/error/loading state. Prompts 03/04 do not fire | Lead | 03 / 04 |
| G14 Visual validation | No rendered surface changed; proof = covering suite 12/12 before/after plus verbatim code motion; `SEAM_SPEC.md` states "no visual surface changed" | seam worker | 04 |
| G15 Docs index | `remediation/A-09/` is outside `docs/`; no `docs/README.md` row required; the dated remediation doc and campaign plan are orchestrator-owned and untouched | seam worker | 01 section E |

## Front-end necessity verdict

- Operator-visible workbench surface? **No** - none exists; Batch A forbids
  building one.
- API response shape consumed by a UI? **No** - internal tooling split; the
  runner's CLI contract (flags, output JSON schema, exit codes) is unchanged.
- Error/empty/loading/permission states? **No** - any such change is a defect.
- Queue readability? **Not applicable** - the queue is the baseline + ledger +
  report commands; this seam removes one frozen entry.

**Verdict: the front-end necessity gate does not fire; prompt 03 is not
opened and prompt 04 (visual validation) is not triggered.** The only
UI-adjacent requirement is the "no visual surface changed" statement plus the
12/12 covering suite before and after.
