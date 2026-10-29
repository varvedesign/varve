# GAP_ANALYSIS - Batch B / B-01 Tauri command surface (lib.rs)

**Status:** gap analysis complete 2026-10-28, before any source edit, in
`.worktrees/B-01` on `seam/B/B-01-librs-commands` at checkpoint
`67ad127cdb525f09c304f05fcab347a0bededc1c`.

## 1. Queue position and batch definitions

| Check | Evidence | Verdict |
|---|---|---|
| B-01 is the next queue entry | `NEXT_PROMPT.md` (generated at the checkpoint) names Batch B / B-01 and the campaign ledger row reads "partial: Home extracted ... other groups queued"; Batch B order starts with `lib.rs` command groups; Batch A is complete (A-04..A-09 landed) | correct entry |
| Single seam | The seam is one destination directory tree under `apps/desktop/src-tauri/src/`: domain modules for the 70 commands still in `lib.rs` (printing, inference, models, fonts, clipboard, stubs, plus the supporting files/app/upscale/trace/media groups the remaining surface needs) | one code-motion seam |
| Not a second seam | No Batch C hot-path or Batch D hub file is touched; no behavior, API or UI change | confirmed |
| Pre-existing partial row | The dated remediation record's "B-01 (partial)" row covers the earlier Home extraction; this session completes the command-surface extraction and does not edit that record (orchestrator-owned) | confirmed |

## 2. Gap -> action -> owner -> prompt file

| Gap | Action | Owner | Prompt file |
|---|---|---|---|
| Rust target not parseable by the seam planner | Use the A-07 substitution: raw-string/brace-aware top-level scan + hand read of every range; record the inventory in SEAM_SPEC | seam worker | 01 (Rust substitution note), 02 Step 1 |
| Rust target not parseable by the move verifier | Substitute the partition/byte-identity matrix: every base line classified exactly once; per-destination fragment SHA-256 compared against `git show master:apps/desktop/src-tauri/src/lib.rs`; `cargo test` + `audit:ipc` as the semantic gates. Never suppress or edit the verifier | seam worker | 02 Step 3 |
| `generate_handler!` must stay complete | Move each command to a domain module; register nested paths; run `pnpm audit:ipc` and the 10/10 contract spec before and after | seam worker | 02 Step 4 |
| Crate-root `crate::` call sites in other modules | Keep `uuid` at the crate root; re-export the six moved helpers with `pub(crate) use`; do not edit other modules | seam worker | 02 Step 2 |
| Visibility edits required by the move | Enumerate every `pub(crate)` planned edit in SEAM_SPEC; add no `pub` and rename nothing | seam worker | 02 Step 2 |
| Baseline ratchet | `node scripts/quality/audit-file-size.mjs --update` once; diff must be exactly the `apps/desktop/src-tauri/src/lib.rs` entry removed (955 -> 954), 0 added, 0 grown; `--force` forbidden | seam worker | 02 Step 5 |
| Untracked WIP new modules | Stage the seam first; `pnpm verify:commit` runs the staged file-size lane; no WIP is frozen | seam worker | 02 Step 6 |
| Generated surfaces | Regenerate `docs/agents/repo-map.generated.md` from the staged tree (`pnpm agent:map`), add exactly one `BACKLOG_LEDGER.md` row; never hand-merge | seam worker | 02 Step 6/7 |
| Queue-backed gates unavailable (EROFS) | Run the same recursive tsc program directly with the main checkout's `tsc`; record packages-checked/fail and desktop/e2e exits | seam worker | 01 B |
| Install unavailable (read-only pnpm store) | Symlink the main checkout's 22 installed `node_modules` trees into the worktree (A-07/A-09 workflow); record that the install is not what validates the seam | seam worker | 01 B |
| Rollback | Seam uncommitted until commit; discard only this worktree's changes or leave it unmerged; never revert another session's files | seam worker + Lead | 02 "Do not" |
| Concurrent writers | No peer writer in this worktree; baseline/map/ledger regenerated in this session only; queue reported idle | seam worker | 01 C |
| Observability | FROZEN_COUNT and excess lines via `--report`; one ledger row per seam; monotone ratchet; no dashboard | seam worker | 01 E |
| Docs index | Only `remediation/B-01/*` is added, outside `docs/`, so `docs/README.md` does not need a row (and must not be edited) | seam worker | 01 E |

## 3. Front-end necessity gate

| Question | Answer | Evidence |
|---|---|---|
| Does this seam change anything an operator sees or does in a remediation workbench? | No | no workbench exists; the queue is the baseline, ledger and audit commands |
| Does it change an API response shape consumed by the UI? | No | wire structs move verbatim (same fields, derives, serde renames); command names and registration are unchanged, `audit:ipc` 154 commands before and after |
| Does it change error, empty, loading or permission states? | No | pure Rust code motion; any such change is a defect, not a feature |
| Does it make the 955-entry queue harder to understand? | No | one fewer frozen entry; the ledger row records the seam |

**Verdict: no front-end work; the necessity gate does not fire.** Prompts 03 and
04 stay closed. No visual surface changed, and no visual baseline run is
appropriate for a backend module move. The covering evidence is
`cargo test -p varve-desktop --lib` plus `pnpm audit:ipc`.

## 4. Measured checkpoint state (authoritative for this session)

- `node scripts/quality/audit-file-size.mjs --report` (clean worktree):
  6,084 source files scanned; 955 over the 400-line cap; 955 frozen; 0 stale;
  0 untracked WIP over-cap; 323,686 excess lines.
- Target `apps/desktop/src-tauri/src/lib.rs`: 7,376 lines, baseline value
  7376.
- Covering suite before: `cargo test -p varve-desktop --lib` -> 161 collected,
  156 passed, 1 failed (pre-existing, deterministic on the untouched tree), 4
  ignored; lib.rs's `tests::` block: 86 compiled / 85 passed / 1 failed from 87
  source `#[test]` fns.
- `pnpm audit:ipc`: exit 0, 154 Rust commands, 124 matched, 48 known gaps,
  0 unregistered; contract spec 10/10.
- TS seam tools on the Rust target: planner exit 2, verifier exit 2 (recorded
  in RESEARCH; not edited).
- Environment substitutions: pnpm install unavailable (read-only store);
  queue-backed `check:agent` unavailable (EROFS on the queue runtime) -> the
  direct recursive tsc program is the recorded substitute; cargo 1.97.1
  available.

## 5. Acceptance / stop conditions for this seam

- One commit on `seam/B/B-01-librs-commands`, no push, no merge.
- 87 source `#[test]` fns preserved; full lib suite 156 passed / 1 failed / 4
  ignored identical; `cargo test` and `pnpm audit:ipc` green except the one
  recorded pre-existing failure.
- Partition/byte-identity matrix: every base line classified; per-destination
  content identical to the base ranges after the enumerated planned edits.
- `lib.rs` at or under 400 lines; every destination at or under 400 lines.
- Baseline diff: exactly one entry removed (955 -> 954), 0 added, 0 grown.
- `pnpm verify:commit` green on the staged seam; one ledger row; repo map
  regenerated; `NEXT_PROMPT.md` regenerated for the next entry and left
  untracked.
