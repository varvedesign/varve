# B-07 gap analysis

Target `crates/varve-room/src/server.rs` -> `crates/varve-room/src/server/` (entry kept).
Covering suite `cargo test -p varve-room` = 30/30 measured before editing.

## What the standard (TypeScript) seam protocol cannot do here

| Standard step | Status on this checkpoint | Substitution used |
|---------------|---------------------------|-------------------|
| `godsplit-plan` inventory | exit 2, `unsupported file extension: .rs` (and `--top` is not a supported flag at this checkpoint: exit 2, `unknown argument: --top`) | hand-built raw-string-aware top-level inventory (61 items) + line-range partition from `git show HEAD:crates/varve-room/src/server.rs` |
| `refactor-verify` declaration proof | exit 2, `cannot parse crates/varve-room/src/server.rs` | partition/byte-identity matrix + `cargo test -p varve-room` (compiles every moved declaration) |
| `pnpm check:agent` | queue EROFS on `/run/user/1000/varve-validation-queue/exclusive.lock` | direct recursive `tsc` over the `check:agent:raw` program (20 packages + apps/desktop + tests/e2e), before and after; no TS file changes |
| `pnpm install --frozen-lockfile` | `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` (read-only store) | 21 measured `node_modules` symlinks + ignored `onnxruntime-libs` copy |
| `cargo fmt -p varve-room --check` | RED at the checkpoint (pre-existing rustfmt drift in `join.rs`, `store.rs`, `server.rs`, the covering test) | do not reformat unrelated code; keep moved lines byte-identical and compare the formatting-delta set before/after |
| `pnpm exec biome` | `biome` 2.5.7 available; Rust paths are not biome inputs | measure on changed (non-Rust) files only; no TS/JS changed here |

## Gaps in the target that the seam must close

1. `server.rs` mixes four concerns that the backlog row names: protocol/body types,
   room/session state, HTTP surface + origin policy, and WebSocket transport/accept
   loop. The move assigns one module per concern family, plus a prelude for the shared
   import block, an operation/frame split for the two audit-heavy functions, a lifecycle
   module for the accept loop and public entry points, and a tests module.
2. The shared import block (base 11-37) is used by every module; moving it verbatim
   would either duplicate 20 import statements or force a glob from the entry. The B-02
   precedent is a `prelude.rs` with `pub(crate) use` and one glob import per module.
3. `handle_client_frame` is 390 lines: moving it with its two refusal helpers would
   exceed the 400-line cap, so `operation_id_of` + `reject_frame` live in
   `operation.rs` next to `handle_operation` and `frames.rs` holds the dispatcher alone.
4. Cross-module private access: `RoomHost` fields, room/session state fields, and
   helpers (`lock`, `deliver`, `deliver_to`, `now_ms`, `hostname`) are currently
   private-in-file. After the split they are accessed from sibling modules, so they get
   `pub(super)` visibility prefixes (planned edits in `SEAM_SPEC.md`); no name, type,
   body, comment, or call site changes.
5. The inline `#[cfg(test)] mod tests` (base 1860-1976) becomes `server/tests.rs`
   declared as `#[cfg(test)] mod tests;` in the entry, so test names stay
   `crate::server::tests::*` and the lib unit test count stays 14. Only the test
   module's `use` line is replaced by explicit imports.

## STOP conditions

- A declaration in the inventory cannot be placed without a behavior change or a
  rename -> stop, do not improvise.
- The partition matrix reports any unassigned or duplicated non-blank base line -> stop.
- `cargo test -p varve-room` count drops below 30 or any test fails -> stop.
- The baseline `--update` adds an entry, grows a frozen file, or removes more than the
  intended one entry -> stop (never `--force`).
- The staged file-size check reports a new module over 400 lines -> re-cut the seam
  inside the same destination directory; do not stage an over-cap file.

## Non-goals

- No behavior, API, wire, or test change. No unrelated reformatting. No edits to
  `server_integration.rs` (1,100 lines) or `protocol_conformance.rs` (64 lines), and no
  edits to the dated remediation record, the campaign plan, or `docs/README.md`.
- No front-end/visual gates: no rendered surface changed.
