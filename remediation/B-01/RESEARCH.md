# RESEARCH - Batch B / B-01 Tauri command surface (lib.rs)

**Status:** research complete 2026-10-28 (measured in `.worktrees/B-01` on
branch `seam/B/B-01-librs-commands` at checkpoint
`67ad127cdb525f09c304f05fcab347a0bededc1c`). No source was edited before this
document, [GAP_ANALYSIS.md](GAP_ANALYSIS.md) and [SEAM_SPEC.md](SEAM_SPEC.md)
existed.

## 1. Measured checkpoint state

| Fact | Command | Measured result |
|---|---|---|
| Local master before this session | `git rev-parse master` | `11e341e69e105cff7efef55e8645333efeebcc49` (checkpoint not yet on master) |
| Lead fast-forward (unblock step 1) | `git merge --ff-only 67ad127cdb...` | fast-forward; master = `67ad127cdb525f09c304f05fcab347a0bededc1c` |
| Worktree | `git worktree add .worktrees/B-01 -b seam/B/B-01-librs-commands master` | created from the checkpoint; `git status --porcelain` empty before the seam |
| File-size gate on the clean worktree | `node scripts/quality/audit-file-size.mjs --report` | exit 0; "Scanned 6084 source files; 955 over the 400-line cap; 955 frozen in .file-size-baseline.json; 0 violation(s); 0 untracked WIP over-cap file(s)"; "Excess over cap: 323686 lines. Baseline entries: 955 (0 stale)" |
| File-size gate | `pnpm audit:filesize` (worktree) | exit 0; "File-size budget OK: 6084 source files scanned; 955 over 400 lines, all frozen ... (tracked content)" |
| Target | `wc -l apps/desktop/src-tauri/src/lib.rs` | 7,376 lines; baseline line 9: `"apps/desktop/src-tauri/src/lib.rs": 7376` |
| Target declarations | raw-string/brace-aware top-level scan + hand read of every range | 70 `#[tauri::command]` fns, 86 other top-level fns, 40 structs, 7 statics, 35 consts, 7 impl blocks, 1 type alias, 1 enum, 24 `mod` declarations, 18 `use` items; 87 `#[test]` fns in the `#[cfg(test)] mod tests` block (5,357-7,275) |
| Covering suite (before) | `cargo test -p varve-desktop --lib` | 161 collected: 156 passed, 1 failed, 4 ignored. The lib.rs block contributes 86 compiled tests (87 source `#[test]` fns; `remove_background_ai_method_is_rejected_without_ai_feature` is `#[cfg(not(feature = "ai"))]` and the `ai` feature is default-on): 85 passed + 1 pre-existing failure `tests::bg_remove_rejects_incompatible_graphs_before_decoding_or_inference` (deterministic on the untouched checkpoint tree; recorded, not caused by this seam) |
| IPC registration guard (before) | `pnpm audit:ipc` | exit 0; "IPC contract OK: 154 Rust commands; 172 unique literal TS invokes; 124 matched; 48 known pre-existing native gaps"; 4 dynamic allowlisted; 30 commands never literally invoked (informational) |
| IPC audit spec (before) | `node --test scripts/quality/audit-ipc-contract.test.mjs` | 10/10 pass, 0 fail |
| Planner | `node scripts/quality/godsplit-plan.mjs apps/desktop/src-tauri/src/lib.rs` | exit **2**, "unsupported file extension: .rs" (measured; TS/JS tool) |
| Verifier smoke | `node scripts/quality/refactor-verify.mjs --base master --target apps/desktop/src-tauri/src/lib.rs --json` | exit **2**, "cannot parse ... Unexpected keyword or identifier." (measured; TS/JS tool) |
| Install | `pnpm install --frozen-lockfile` | environment limit: `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` / "Read-only file system"; substituted with 22 `node_modules` symlinks to the main checkout (same A-07/A-09 workflow) |
| Queued type gate | `pnpm check:agent` | environment limit: `EROFS: read-only file system, open '/run/user/1000/varve-validation-queue/exclusive.lock'`; substituted with the same recursive tsc program run directly against the main checkout's `tsc` binary (recorded below) |
| Queue / worktrees | `pnpm queue:status` / `pnpm worktree:status` | queue idle, 0 waiting; no peer writer in `.worktrees/B-01` |
| Toolchain | `cargo --version` / `rustc --version` | cargo 1.97.1, rustc 1.97.1 |
| Native build assets | `apps/desktop/src-tauri/onnxruntime-libs` (ignored, not tracked) | copied from the main checkout (38 MB) so the Tauri build script's `onnxruntime-libs/**/*` glob resolves; untracked/ignored and not committed |

Final substitute run (after the seam): 20 packages checked, 0 package failures, desktop exit 0, e2e exit 0 (same recursive tsc program as check:agent:raw).

The TypeScript seam tools cannot parse Rust, so this entry applies the A-07
Rust substitution: a hand-built declaration inventory from a raw-string-aware
top-level scan, every block range read and confirmed by hand, and a
partition/byte-identity matrix against `git show master:...` instead of
`refactor-verify`, with `cargo test -p varve-desktop --lib` and
`pnpm audit:ipc` as the covering gates.

## 2. Research themes (repository evidence)

1. **Rust module resolution and privacy: the move requires visibility edits.**
   Every command fn in `lib.rs` is private; a command moved into a sibling
   module must be `pub(crate)` to be registered from the crate root, exactly
   like the already-extracted `home_store` commands
   (`home_store/documents.rs` uses `#[tauri::command] pub(crate) fn`).
   Wire structs returned by those commands must also be `pub(crate)` (Rust's
   private-interface rules). Failure mode: a "pure" byte move that cannot
   compile, or a visibility flood that silently exports a payload type.
   Guardrail: visibility edits are a declared, enumerated planned-edit class
   (`fn -> pub(crate) fn`, `struct -> pub(crate) struct`), names stay
   identical, and no item becomes `pub`; the crate's external surface is
   unchanged.
2. **`mod` declaration + `generate_handler!` registration are two lists that
   must both stay complete.** A moved command that is missing from either list
   is unreachable; a stale registration fails to compile. `audit:ipc` parses
   `#[tauri::command]` fns from every `.rs` file under
   `apps/desktop/src-tauri/src` recursively (`readRustSources`) and the
   `generate_handler!` body with a regex that takes the last
   `::`-segment (`parseRegisteredCommands`), so nested module paths such as
   `inference::background::remove_background` register exactly like the
   existing `home_store::home_list_files` lines. Guardrail: `pnpm audit:ipc`
   before and after (154 commands, 0 unregistered, 0 stale gaps) plus the
   10/10 audit spec.
3. **Cross-module `crate::` call sites in already-extracted modules.** The
   checkpoint's other `src/*.rs` modules reach these `lib.rs` items by path:
   `crate::uuid` (12 refs), `crate::sha256_file` (2),
   `crate::validate_inference_sha256` (3),
   `crate::validate_inference_model_id` (1),
   `crate::valid_download_request_id` (2),
   `crate::inference_model_path_at` (1), `crate::ensure_native_ai` (2), and
   `crate::resolve_user_path` / `resolve_user_path_approved` /
   `write_file_atomic` (home_store/library.rs). Failure mode: moving the item
   without preserving the `crate::` path breaks four existing modules.
   Guardrail: `uuid` stays a crate-root helper; the five model helpers are
   re-exported from `models` and `ensure_native_ai` from
   `inference::native_ai` at the crate root with `pub(crate) use`; the three
   file helpers are re-exported from `files`. The existing modules are not
   edited.
4. **App-builder evaluation order and setup side effects.** `run()` performs
   order-sensitive work: Wayland program name env vars before GTK init, the
   Tauri plugin chain, then `.setup(...)` with directory resolution, legacy
   data migration, model-root injection, logs, crash capture, store creation,
   managed state, native presenter attach, the GTK pinch bridge, menu events,
   and the home-directory watcher; then the single `generate_handler!`
   registration and `.build(...).run(...)` event hooks. Failure mode: a move
   that reorders statements (e.g. store before crash capture) changes startup
   behavior. Guardrail: `run()` keeps the env block + plugin chain + setup
   hook + handler list + run-event hook in the crate root; only the
   `.setup` closure **body** moves verbatim, in order, into
   `app::setup(app: &mut tauri::App)`, and the pure-Linux pinch closure body
   moves into `app::pinch_linux::attach_pinch_zoom`. The replacement points
   are declared planned edits and no statement is reordered.
5. **Wire structs are command payloads, not crate furniture.** The 40 structs
   in `lib.rs` are command arguments/returns (`BgRemoveOptions`,
   `GenerativeEditOptions`, `TraceImageOptions`, `PrinterInfo`, ...). The
   IPC contract policy in `docs/architecture/ipc-type-contract.md` puts
   payload structs with the command module, so they move with their command
   group (all to `pub(crate)` where a `pub(crate) fn` exposes them).
   `SceneIr` is already `pub` because it was exported; it keeps `pub`.
6. **Tests are source and move with the extraction.** The 87 `#[test]` fns
   (1,899 lines) live in one `#[cfg(test)] mod tests` at the end of
   `lib.rs` and exercise the private helpers that move. They are distributed
   to per-domain `tests.rs` child modules (one `#[cfg(test)] mod tests;`
   declaration per domain), keeping every test fn and its `#[cfg(...)]`
   attributes verbatim. Failure mode: a test compile-out from a lost
   `#[cfg(unix)]` / `#[cfg(not(feature = "ai"))]` attribute halves the
   count silently. Guardrail: the source `#[test]` count stays 87, the
   compiled count stays 86 (one default-feature-gated test), and the full
   suite's 156 passed / 1 failed / 4 ignored must be preserved exactly
   (the one failure is the recorded pre-existing one).
7. **Crate root and destination budget.** `lib.rs` can only leave the
   baseline if it ends at or under 400 lines. The kept remainder is the module
   declarations, `uuid`, the crate-root re-exports, the appimage helper,
   `run()`'s env block, plugin chain, setup hook, 154-command registration
   list and build/run hook: estimated ~295 lines. Every destination file stays
   at or under 400 lines (largest estimated 379: `printing.rs`); the six
   generative submodules are split so no file approaches the cap.
8. **Baseline policy for untracked modules.** New destination files are
   untracked until staged, so the report lists them as WIP but never freezes
   them; `--staged` in `pnpm verify:commit` is the cap check that matters.
   `--update` must remove exactly the `lib.rs` entry (955 -> 954) and freeze
   no new file. `--update --force` is forbidden.
9. **Concurrent single-writer surfaces.** `.file-size-baseline.json`,
   `docs/agents/repo-map.generated.md`, `BACKLOG_LEDGER.md` and
   `docs/README.md` are single-writer; this session regenerates them from
   the staged tree and does not touch the dated remediation doc, the campaign
   plan or `docs/README.md`.
10. **Rollback.** The seam stays uncommitted until the commit step; a failed
    extraction discards only `.worktrees/B-01` changes, or leaves the
    worktree unmerged. No partial seam is committed, and no other session's
    files are reverted.
11. **Front-end necessity gate (does not fire).** No rendered output, no API
    response shape, no error/empty/loading/permission state changes: this is a
    Rust module/visibility move behind an unchanged IPC surface. The covering
    evidence is the Rust unit suite plus `pnpm audit:ipc`; there is no
    component or visual check to run and none is added. Prompts 03 and 04 stay
    closed.

## 3. Failure modes -> guardrails

| Failure mode | Evidence | Guardrail (command or review check) | Owner prompt |
|---|---|---|---|
| Dropped or duplicated declaration during the move | 551 base units / 7,376 lines; hand inventory in SEAM_SPEC | Partition matrix: every base line classified exactly once; per-destination fragment SHA-256 re-verified against `git show master:...`; `cargo test` + `audit:ipc` | 02 Step 3 (Rust substitution) |
| Moved command not registered | `generate_handler!` is the only registration site | `pnpm audit:ipc` (unregistered-command rule) + 10/10 contract spec | 02 Step 4 |
| Nested command path not parsed by the guard | guard splits on `::`, takes last segment | Precedent `home_store::...`; post-move audit reports 154 commands | 01 C |
| Visibility edit changes the public surface | commands are private today | Only `pub(crate)` added, enumerated per declaration; no `pub` added for moved items except the pre-existing `pub` items | 02 Step 2 |
| Startup order changes in `run()` | env vars must precede GTK init; crash capture before store use | setup body moved verbatim as ordered statements; pinch block moved whole; diff review | 02 Step 2 |
| Tests move but a `#[cfg]` attribute is lost | one default-feature-gated and two unix-gated tests | Source `#[test]` count 87; compiled count 86; full suite 156/1/4 identical | 02 Step 4 |
| New file over the 400-line cap | split policy | Every destination measured before staging; `--staged` file-size lane in `verify:commit` | 02 Step 5 |
| Baseline freeze/growth | ratchet is shrink-only | `audit-file-size --update` diff is exactly one removed entry; `pnpm audit:filesize` 955 -> 954 | 02 Step 5 |
| Queue-backed gates unavailable (EROFS) | measured above | Direct tsc program substitution, recorded with its own counts | 01 B |
| Rust seam tools exit 2 | measured above | A-07 substitution: inventory + partition/byte-identity matrix; no verifier suppression | 01 C |

## 4. Edge-case register

| Edge case | Applies? | Decision / guardrail |
|---|---|---|
| Module-eval side effects (startup ordering) | yes | setup body + pinch body move verbatim; no statement reordered; plugin chain and registration stay in `run()` |
| Rust module resolution / privacy | yes | `mod` declarations added in `lib.rs`; moved commands and exposed payload types become `pub(crate)` (planned edits enumerated in SEAM_SPEC) |
| `generate_handler!` registration completeness | yes | `pnpm audit:ipc` before/after; 154 commands, 0 unregistered, 0 stale |
| `crate::` paths from existing modules | yes | `uuid` stays at crate root; six helpers re-exported at crate root with `pub(crate) use`; 0 edits to existing modules |
| Tests / test count | yes | 87 source tests distributed to domain `tests.rs` children; source count 87, compiled 86, suite 156/1/4 identical |
| Wire struct serialization/rename contracts | yes | structs move verbatim (fields, derives, serde attrs untouched); only visibility token edited |
| Allocation-bound constants shared across domains | yes | each constant moves with its domain; cross-module uses import it (`pub(crate)`) |
| Tracked-vs-untracked baseline policy | yes | new files staged before `--staged` check; `--update` removes exactly `lib.rs` |
| Stale/grandfathered baseline entries | yes | verify 0 stale before and after; no other entry may change |
| Comment / doc-comment preservation | yes | comments move verbatim with their item; only wrapper indentation (setup/tests) is dedented |
| Cross-platform `#[cfg]` items | yes | `native_presenter`, clipboard wayland/non-wayland pairs and unix tests keep their `#[cfg]` attributes verbatim |
| Generated files / exclusions | n/a | no generated data file, vendor file or lockfile is touched |
| Front-end / visual surface | no | no rendered output; gate does not fire; no visual baseline run |
| Rollback | yes | one worktree, uncommitted until commit; abort path documented in GAP_ANALYSIS |
| Unknown seam tooling | yes (known) | both TS seam tools exit 2 on Rust (measured); A-07 substitution recorded |
