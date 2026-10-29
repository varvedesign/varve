# B-08 research and repository evidence

Entry: Batch B, B-08 - `crates/varve-bgremove/src/inference.rs` (1,885 lines, frozen at
1885). Covering suite: `cargo test -p varve-bgremove --features ai` (54 passed / 6
ignored / 0 failed measured before any edit). Destination:
`crates/varve-bgremove/src/inference/` with `inference.rs` kept as the thin module
entry.

Measured on the B-08 worktree, branch `seam/B/B-08-bgremove-inference`, created from
local master `c57b6501a` (the B-07 seam commit, fast-forwarded onto master from
`6c4aa2009`; `git merge-base --is-ancestor c57b6501a master` exit 0).

```
$ node scripts/quality/audit-file-size.mjs --report   # head, measured on this worktree
Scanned 6215 source files; 948 over the 400-line cap; 948 frozen in .file-size-baseline.json;
0 violation(s); 0 untracked WIP over-cap file(s).
Excess over cap: 302353 lines. Baseline entries: 948 (0 stale).
$ grep -n 'crates/varve-bgremove/src/inference.rs' .file-size-baseline.json
  "crates/varve-bgremove/src/inference.rs": 1885,
$ wc -l crates/varve-bgremove/src/inference.rs
1885 crates/varve-bgremove/src/inference.rs
$ git show HEAD:crates/varve-bgremove/src/inference.rs | sha256sum
3bb8ce0119863be498ee3601c23b306cb5ae42f15647c3e34bcd1ae6e5729a4d  -
```

The handoff's checkpoint reading (948 frozen / 0 stale / 6,215 scanned / 302,353 excess)
is confirmed exactly. The frozen count, 0-stale state and excess lines are the
authoritative gate values for this session.

## Rust substitution for the standard seam protocol (measured, not assumed)

The repo-native seam tools parse TypeScript/JavaScript only. This is a Rust target, so
the A-07/B-02 Rust substitution applies; all probes below were executed on this worktree
before editing:

```
$ node scripts/quality/godsplit-plan.mjs crates/varve-bgremove/src/inference.rs
godsplit-plan: unsupported file extension: .rs            # exit 2
$ node scripts/quality/refactor-verify.mjs --base master --target crates/varve-bgremove/src/inference.rs --json
refactor-verify: cannot parse crates/varve-bgremove/src/inference.rs: Unexpected keyword or identifier.  # exit 2
```

Substitution used for the missing planner/verifier: a hand-built, raw-string-aware
top-level declaration inventory (`target/b08-analysis/scan.mjs`, 67 top-level items +
module docs) plus a partition/byte-identity matrix against
`git show HEAD:crates/varve-bgremove/src/inference.rs` (sha256 above), and
`cargo test -p varve-bgremove --features ai` as the declaration/behavior gate. This is
the B-02/A-07 protocol recorded on the ledger; it is not a waiver, it is the measured
capability of the checkpoint.

Environment substitutions measured in this worktree (same as B-07):

- `pnpm install --frozen-lockfile` exits non-zero: `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`
  (read-only pnpm store). Workflow: 21 `node_modules` symlinks to the main checkout
  (:1 top-level, .opencode, apps/desktop, apps/website, 17 packages) plus the ignored
  `apps/desktop/src-tauri/onnxruntime-libs` copy (4 files, 38 MiB). `git status` stays clean.
- Queue-backed `pnpm check:agent` / `pnpm test:agent` are unusable here
  (`EROFS ... /run/user/1000/varve-validation-queue/exclusive.lock`); `pnpm queue:status`
  itself is read-only and measured "exclusive free; shared 0/4 slots busy; 0 waiting".
  Direct substitution measured before the move: recursive `tsc` over the same program as
  `check:agent:raw` (20 package tsconfigs, apps/desktop, tests/e2e) and direct cargo
  commands. The seam changes no TypeScript, so the before/after diagnostic sets must be
  byte-identical.
- `cargo fmt -p varve-bgremove --check` is CLEAN at this checkpoint (exit 0), unlike the
  B-07 crate. Every seam file must therefore stay rustfmt-clean and every moved line
  byte-identical; no reformatting of unrelated code.
- `cargo check -p varve-bgremove --features ai --all-targets` exit 0 (20.89s) before the
  move; the default-feature build does not compile the target, so all pre/post gates use
  `--features ai`.

## A. Research themes for a declaration-level Rust move

1. **Module-evaluation side effects - no runtime constructor; lazy statics only.** The
   file's only module-scope state is three `OnceLock` statics: `CURRENT_RUNTIME`
   (base 386), `SESSION_POOL` (387) and `AUTO_GPU_MODEL_FAILURES` (388), all initialized
   lazily by their accessors (`set_runtime`, `get_session_pool`,
   `auto_gpu_model_failures`). No constructor, thread, worker pool, or eager `lazy_static`
   runs at module evaluation. Moving each static together with its sole accessor family
   into one module preserves initialization timing and the singleton identity. No
   `static mut` exists, so no second copy can be created.
2. **Module registration / dropped `mod` - compile-checked.** A dropped `mod` or a
   missing `pub use` re-export is a hard compile error in Rust, not a silent skip. The
   real risk is a *moved but unreachable* item (forgotten visibility widening): the
   inventory + matrix below is the guard, and the package test suite compiles every moved
   declaration (including the 15 inline unit tests, 14 active + 1 ignored).
3. **Path aliases and import ordering - one measured import block.** The whole production
   import surface is base 11-20 (8 `use` statements, two multi-line). Every one of them is
   needed by at least one destination module and none is a relative `super::` path in
   production code. The B-02/B-07 precedent (a `prelude.rs` with `pub(crate) use` and one
   glob import per module) moves the block exactly once; the only `super::` occurrences
   are in the inline test module, whose import list is rebased explicitly.
4. **Raw-string / brace corruption - mitigated by construction.** The base file contains
   byte/format strings and doc examples but the cut is not a regex/brace heuristic: the
   inventory is produced by a raw-string-aware scanner (`scan.mjs` tracks nested block
   comments, normal strings, byte strings and `r#""#` raw strings) and every emitted line
   is a line-range slice of the committed blob. The matrix then proves every non-blank
   base line appears exactly once.
5. **Identity-sensitive declarations - the real seam constraint.** The crate's public
   inference surface is 23 `pub` items plus `pub(crate) OrtSession`, and it is consumed
   through `crate::inference::*` by `src/modnet.rs` (`TensorOutput`, `TensorShape`),
   `src/tensor_runtime.rs` (`InferenceSession`, `OrtInferenceRuntime`, `OrtSession`),
   `src/lib.rs` (12 re-exports/call sites), both examples, the six `tests/*.rs` files and
   `apps/desktop/src-tauri/src/{acceleration.rs,inference/background.rs}`. All of them must
   keep resolving through the same `crate::inference` module path via `pub use`
   re-exports from the thin entry. The inline test module keeps the module path
   `crate::inference::tests` (same test names) via `#[cfg(test)] mod tests;` in the entry.
6. **Same-named helpers - one home each.** The scanner reports 67 top-level declarations;
   a per-name duplicate check finds no duplicate declaration names, so each helper keeps
   exactly one destination and nothing is copy-pasted.
7. **Dropped declarations - proof plan.** 67 top-level items inventoried (table in
   `SEAM_SPEC.md`); the matrix asserts partition/byte identity and per-name occurrence
   counts; `cargo test -p varve-bgremove --features ai` must stay 54 passed / 6 ignored /
   0 failed. `refactor-verify` cannot help here (exit 2 above).
8. **Tracked-versus-untracked baseline.** The new destination modules are untracked until
   staged and are WIP-reported, never frozen. They are enforced at the 400-line cap the
   moment they are staged (`--staged` runs in `pnpm verify:commit`); the commit check is
   the real cap gate.
9. **Stale/grandfathered baseline entries.** The intended ratchet is exactly one entry
   removed (`crates/varve-bgremove/src/inference.rs`) and none added or grown: 948 -> 947.
   The entry must leave, not shrink, because the entry file ends far under 400 lines.
   `--update --force` is forbidden.
10. **Concurrent single-writer surfaces.** `.file-size-baseline.json`,
    `docs/agents/repo-map.generated.md`, `BACKLOG_LEDGER.md` and the dated remediation
    record are single-writer; this session updates the first three only. `pnpm queue:status`
    measured "exclusive free; 0 waiting"; no second split runs in this worktree.
11. **Rollback.** The move is uncommitted until the final commit; a failed extraction is
    abandoned by discarding this worktree's changes, never by resetting the shared
    checkout. A partial seam is never committed.
12. **Rust-crate equivalents of the IPC concerns - does not apply.** This crate is not
    Tauri and registers no `#[tauri::command]`; `pnpm audit:ipc` is unaffected. The
    crate-root growth concern is handled by the thin entry. Cancellation/job state is not
    declared in this file: the persistent token/lease state already lives in
    `crate::session_pool` and is threaded through the moved pipelines unchanged, so the
    seam records that boundary instead of inventing a module for it.

## B. Reference-tool and failure-mode analysis

Codemod/batch tools cannot parse Rust here (both repo seam tools exit 2 on `.rs`), so
they cannot silently skip or falsely report a move - but they also cannot prove it. The
failure modes this seam must avoid are: silent omission of an item (caught by the partition
matrix: every non-blank line accounted for exactly once), a visibility omission (caught by
the `--all-targets` compile gate and the test build), a behavior change hidden in the move
(caught by the 54-test covering suite, including the 15 inline tests that exercise
normalization, letterboxing, mask resize, the automatic-GPU quarantine seam and the ORT
runtime trait), baseline drift (caught by the staged file-size check), and import churn
(caught by the prelude + compile + fmt).

Remaining untested/unknown risks and their explicit checks: (a) the inline test module is
de-nested into `inference/tests.rs`; its path stays `crate::inference::tests` and the test
count/names are compared before and after; (b) private-item visibility across the new
sibling modules is only catchable by compilation, so the test build runs twice (before and
after) and `--all-targets` compiles the crate, examples and integration tests; (c) the
rustfmt-clean checkpoint state must stay clean, checked with the crate-scoped `cargo fmt
--check` after the move and after the staged tree.

## C. Edge-case and gap register

| Edge case | Decision for B-08 | Evidence / guardrail |
|-----------|-------------------|----------------------|
| Module-eval side effects | does not apply: lazy `OnceLock` statics only, each moves with its accessor | scanner inventory; statics all in `session.rs` |
| Module registration / public entry | one thin entry keeps 7 `mod` declarations, the test declaration and 24 re-exports | compile + `lib.rs` re-export type-check |
| Path aliases / import ordering | production import block moves once to `prelude.rs`; only the test module's `super::` imports are rebased explicitly | measured `grep -n 'super::'` (test module only) |
| Raw-string / brace cutting | no heuristic cut: line-range partition from the committed blob by the raw-string-aware scanner | matrix |
| Identity-sensitive exports | 23 `pub` + 1 `pub(crate)` item stay on `crate::inference` | public-name set comparison + compile |
| Same-named helpers | no duplicates; one home per helper | inventory duplicate check |
| Dropped declarations | every base line assigned exactly once; no declaration duplicated | matrix |
| Tracked vs untracked baseline | new modules untracked until staged, cap enforced at stage | `--staged` in verify:commit |
| Stale/grandfathered entries | remove exactly one entry; no growth; no `--force` | `--update` diff + `pnpm audit:filesize` |
| Concurrent single-writer surfaces | baseline/map/ledger updated once here; dated doc untouched | queue:status measured idle |
| Rollback | discard worktree changes only | git status |
| Rust-crate IPC equivalents | does not apply (not a Tauri crate) | no `#[tauri::command]` in target |
| Formatting gate | checkpoint is fmt-clean; moved lines stay byte-identical, added structural lines rustfmt-canonical | `cargo fmt -p varve-bgremove --check` before/after |
| Test module path | destination `inference/tests.rs` keeps `crate::inference::tests` names; 54/6/0 count unchanged | `cargo test -p varve-bgremove --features ai` before/after |
| Front-end necessity gate | not triggered: no rendered surface; Rust ONNX inference orchestration only | seam is a pure code move |
