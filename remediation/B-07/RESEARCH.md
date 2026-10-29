# B-07 research and repository evidence

Entry: Batch B, B-07 - `crates/varve-room/src/server.rs` (1,976 lines, frozen at 1976).
Covering suite: `cargo test -p varve-room` (14 lib unit + 3 protocol_conformance + 13
server_integration = 30 tests, measured before any edit). Destination:
`crates/varve-room/src/server/` with `server.rs` kept as the thin module entry.

Measured on the B-07 worktree, branch `seam/B/B-07-room-server`, created from local
master `6c4aa2009` (the merge of seam B/B-06, whose checkpoint commit
`834c69758` is an ancestor; `git merge-base --is-ancestor 834c69758 master` exit 0).

```
$ node scripts/quality/audit-file-size.mjs --report   # tail summary
Scanned 6206 source files; 949 over the 400-line cap; 949 frozen in .file-size-baseline.json;
0 violation(s); 0 untracked WIP over-cap file(s).
Excess over cap: 303929 lines. Baseline entries: 949 (0 stale).
$ grep -n 'crates/varve-room/src/server.rs' .file-size-baseline.json
47:    "crates/varve-room/src/server.rs": 1976,
$ wc -l crates/varve-room/src/server.rs crates/varve-room/tests/server_integration.rs crates/varve-room/tests/protocol_conformance.rs
  1976 crates/varve-room/src/server.rs
  1100 crates/varve-room/tests/server_integration.rs
    64 crates/varve-room/tests/protocol_conformance.rs
$ git show HEAD:crates/varve-room/src/server.rs | sha256sum
5d239f5ca51ab9716f69b532f8c363901183fa640bb1f7ecdec51f3a1c10f001  -
```

`6,206` scanned files is 3 more than the handoff's checkpoint reading (6,203): the two
unrelated website/brand marketing commits already on local master add three tracked
source files, none over the cap. The frozen count, excess lines and 0-stale state are
unchanged and are the authoritative gate values for this session.

## Rust substitution for the standard seam protocol (measured, not assumed)

The repo-native seam tools parse TypeScript/JavaScript only. This is a Rust target, so
the A-07/B-02 Rust substitution applies; all four probes below were executed on this
worktree before editing:

```
$ node scripts/quality/godsplit-plan.mjs crates/varve-room/src/server.rs
godsplit-plan: unsupported file extension: .rs            # exit 2
$ node scripts/quality/godsplit-plan.mjs crates/varve-room/src/server.rs --top 200
godsplit-plan: unknown argument: --top                    # exit 2 (flag unsupported at this checkpoint)
$ node scripts/quality/refactor-verify.mjs --base master --target crates/varve-room/src/server.rs --json
refactor-verify: cannot parse crates/varve-room/src/server.rs: Unexpected keyword or identifier.  # exit 2
```

Substitution used for the missing planner/verifier: a hand-built, raw-string-aware
top-level declaration inventory plus a partition/byte-identity matrix against
`git show HEAD:crates/varve-room/src/server.rs` (sha256 above), and `cargo test -p
varve-room` as the declaration/behavior gate. This is the B-02/A-07 protocol recorded
on the ledger; it is not a waiver, it is the measured capability of the checkpoint.

Environment substitutions measured in this worktree (same as B-06):

- `pnpm install --frozen-lockfile` exits non-zero: `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`
  (read-only pnpm store). Workflow: 21 `node_modules` symlinks to the main checkout
  (:1 top-level, .opencode, apps/desktop, apps/website, 17 packages) plus the ignored
  `apps/desktop/src-tauri/onnxruntime-libs` copy (38 MiB). `git status` stays clean.
- Queue-backed `pnpm check:agent` / `pnpm test:agent` are unusable here
  (`EROFS ... /run/user/1000/varve-validation-queue/exclusive.lock`). Direct
  substitution measured before the move: recursive `tsc` over the same program as
  `check:agent:raw` (20 package tsconfigs, apps/desktop, tests/e2e) and direct
  `cargo test -p varve-room`. The seam changes no TypeScript, so the before/after
  diagnostic sets must be byte-identical.
- `cargo fmt -p varve-room --check` is RED at the checkpoint: current rustfmt (Rust
  1.97.1) reflows pre-existing code in `join.rs`, `store.rs`, `server.rs` and the
  covering test. This is a pre-existing toolchain/formatting drift, not introduced
  here; unrelated formatting is out of scope for a code-move seam. The seam therefore
  keeps every moved line byte-identical instead of reformatting, and proves the
  formatting delta set is unchanged (same reflow hunks, moved to the destination files).

## A. Research themes for a declaration-level Rust move

1. **Module-evaluation side effects - does not apply, no hazard.** Rust has no
   module-scope constructors in this file: the only side-effect-bearing item is
   `impl Drop for RoomHost` (base 86-95), which releases the host lock when the host
   value drops. It moves with `RoomHost` into one module, so the drop schedule and the
   single lock release are unchanged. `HOST_LOCK_STALE_MS` / `HOST_LOCK_REFRESH_MS`
   are consts; no statics or lazy inits exist.
2. **Module registration / dropped `mod` - compile-checked.** A dropped `mod`
   declaration is a hard compile error in Rust, not a silent skip, and the public
   `pub use` re-exports in `server.rs` are type-checked against the child modules. The
   real risk is a *moved but unreachable* item (widened visibility forgotten): the
   inventory + matrix below is the guard, and the package test suite compiles every
   moved declaration.
3. **Path aliases and import ordering - one measured instance.** `grep -n 'super::'
   crates/varve-room/src/server.rs` matches exactly one line (1862, the test module's
   `use super::*;`). Everything else is `crate::` absolute. Moving the tests module to
   `server/tests.rs` keeps its module path `crate::server::tests` (same test names) and
   replaces the glob with explicit imports of the same names; no production path
   specifier needs rebasing.
4. **Raw-string / brace corruption - mitigated by construction.** The file contains
   many string literals and error templates (e.g. "Your access was revoked",
   `"data:image/png;base64,..."`); no raw-string literals were found by the
   raw-string-aware scan, but a regex/brace-based cut is still forbidden. The cut is a
   pure line-range partition generated from the committed blob; the matrix proves every
   non-blank base line is present exactly once.
5. **Identity-sensitive declarations - the real seam constraint.** The crate's public
   surface is `crate::server::{HostConfig, RoomHost, AdminRoom, router, serve,
   serve_on_current_runtime, serve_with_handle}`, re-exported by `lib.rs` (lines
   23-25). `src/bin/varve-room-server.rs` uses `varve_room::{HostConfig, RoomHost}` and
   `varve_room::serve`; the integration test uses `varve_room::{HostConfig, RoomHost}`.
   All seven names stay exported from the same `crate::server` module path via `pub use`.
6. **Same-named helpers - one home each.** No two moved helpers share a name. The
   helpers keep exactly one destination each; nothing is duplicated.
7. **Dropped declarations - proof plan.** 61 top-level declarations inventoried (table
   in `SEAM_SPEC.md`); the matrix asserts partition/byte identity; `cargo test -p
   varve-room` must stay 30/30. `refactor-verify` cannot help here (exit 2 above).
8. **Tracked-versus-untracked baseline.** The new destination modules are untracked
   until staged and are WIP-reported, never frozen. They are enforced at the 400-line
   cap the moment they are staged (`--staged` runs in `pnpm verify:commit`); the commit
   check is the real cap gate.
9. **Stale/grandfathered baseline entries.** The intended ratchet is exactly one entry
   removed (`crates/varve-room/src/server.rs`) and none added or grown: 949 -> 948.
   The entry must leave, not shrink, because the entry file ends far under 400 lines.
   `--update --force` is forbidden.
10. **Concurrent single-writer surfaces.** `.file-size-baseline.json`,
    `docs/agents/repo-map.generated.md`, `BACKLOG_LEDGER.md` and the dated
    remediation record are single-writer; this session updates the first three only.
    `pnpm queue:status` measured "exclusive free; 0 waiting"; no second split runs in
    this worktree.
11. **Rollback.** The move is uncommitted until the final commit; a failed extraction
    is abandoned by discarding this worktree's changes, never by resetting the shared
    checkout. A partial seam is never committed.
12. **Rust-crate equivalents of the IPC concerns - does not apply.** This crate is not
    Tauri and registers no `#[tauri::command]`; `pnpm audit:ipc` is unaffected. The
    crate-root growth concern is handled by the thin entry.

## B. Reference-tool and failure-mode analysis

Codemod/batch tools cannot parse Rust here (both repo seam tools exit 2 on `.rs`), so
they cannot silently skip or falsely report a move - but they also cannot prove it.
The failure modes the seam must avoid are: silent omission of an item (caught by the
partition matrix: every non-blank line accounted for), a visibility omission (caught by
`cargo test -p varve-room` compilation), a behavior change hidden in the move (caught by
the 30-test covering suite, including the 13 integration tests that spin a real host and
WebSocket clients), baseline drift (caught by the staged file-size check), and import
churn (not applicable: one `super::` line, replaced explicitly).

Remaining untested/unknown risks and their explicit checks: (a) rustfmt drift on the
checkpoint tree - checked as a before/after formatting-delta comparison, not a green
gate; (b) the test module path change could rename tests if the module were placed
anywhere other than `server::tests` - the destination keeps exactly that path;
(c) private-item visibility mistakes are only catchable by compilation, so `cargo test`
runs twice (before and after) and must compile the whole crate plus the integration
target.

## C. Edge-case and gap register

| Edge case | Decision for B-07 | Evidence / guardrail |
|-----------|-------------------|----------------------|
| Module-eval side effects | does not apply (Rust; only `Drop for RoomHost`) | `Drop` moves with `RoomHost`; no statics |
| Module registration / public entry | one thin entry keeps all 8 module declarations and the 7-name public re-export block | compile + `lib.rs` re-export type-check |
| Path aliases / import ordering | exactly one `super::` occurrence (test glob), replaced explicitly; `crate::` unchanged | measured grep |
| Raw-string / brace cutting | does not apply to the cut method: line-range partition from the committed blob | matrix |
| Identity-sensitive exports | `HostConfig`, `RoomHost`, `AdminRoom`, `router`, `serve`, `serve_on_current_runtime`, `serve_with_handle` stay on `crate::server` | public-name set comparison + compile |
| Same-named helpers | no duplicates; one home per helper | matrix + compile |
| Dropped declarations | every non-blank base line assigned exactly once; no declaration duplicated | matrix |
| Tracked vs untracked baseline | new modules untracked until staged, cap enforced at stage | `--staged` in verify:commit |
| Stale/grandfathered entries | remove exactly one entry; no growth; no `--force` | `--update` diff + `pnpm audit:filesize` |
| Concurrent single-writer surfaces | baseline/map/ledger updated once here; dated doc untouched | queue:status measured idle |
| Rollback | discard worktree changes only | git status |
| Rust-crate IPC equivalents | does not apply (not a Tauri crate) | no `#[tauri::command]` in target |
| Formatting gate | checkpoint is fmt-red; moved lines stay byte-identical; before/after delta set compared | captured fmt diffs before/after |
| Test module path | destination `server/tests.rs` keeps `crate::server::tests` names; 14 lib unit tests count unchanged | `cargo test -p varve-room` before/after |
| Front-end necessity gate | not triggered: no rendered surface; Rust room-server orchestration only | seam is a pure code move |
