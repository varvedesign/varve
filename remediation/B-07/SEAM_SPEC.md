# B-07 seam specification - `crates/varve-room/src/server.rs` split

**Single concern:** pure code motion of the room-host server implementation into
`crates/varve-room/src/server/...`; `crates/varve-room/src/server.rs` stays as the thin
module entry and keeps the existing public server surface. No behavior, naming,
comment, API or test change. No visual surface changed (Rust collaboration host; no
rendered surface), so the front-end/visual gates do not fire.

## Pre-flight (measured on `.worktrees/B-07`, branch `seam/B/B-07-room-server`)

- `pnpm audit:filesize`: exit 0, "949 over 400 lines, all frozen", 0 violations.
- `node scripts/quality/audit-file-size.mjs --report`: 6,206 scanned / 949 frozen /
  0 stale / 303,929 excess lines / 0 WIP.
- `pnpm install --frozen-lockfile`: read-only-store failure; 21 symlinked
  node_modules trees + ignored onnxruntime-libs copy as measured for B-06.
- `pnpm check:agent`: queue EROFS; substituted by the direct recursive-tsc program.
- `godsplit-plan` and `refactor-verify` on the target: exit 2 (Rust unsupported) -
  Rust substitution (hand inventory + partition matrix + cargo test) applies.
- `cargo test -p varve-room`: 30/30 pass (14 lib + 3 protocol_conformance + 13
  server_integration); fmt crate check pre-existing red.
- Base blob: `git show HEAD:crates/varve-room/src/server.rs`,
  sha256 `5d239f5ca51ab9716f69b532f8c363901183fa640bb1f7ecdec51f3a1c10f001`, 1,976 lines.

## Declaration inventory (hand-completed; planner unavailable for .rs)

Kind, base inclusive range, visibility, destination. Every item appears exactly once.

| # | kind | name | lines | vis | destination |
|---|------|------|-------|-----|-------------|
| 1 | module doc | (crate-visible docs) | 1-9 | - | server.rs (entry) |
| 2 | use block | imports (20 statements) | 11-37 | - | prelude.rs (`pub(crate)`) |
| 3 | struct | HostConfig | 39-61 | pub | host.rs |
| 4 | impl | HostConfig::for_data_dir | 63-75 | pub | host.rs |
| 5 | struct | RoomHost | 77-84 | pub (fields pub(super)) | host.rs |
| 6 | impl | Drop for RoomHost | 86-95 | - | host.rs |
| 7 | const | HOST_LOCK_STALE_MS | 97-99 | private | host.rs |
| 8 | const | HOST_LOCK_REFRESH_MS | 100-101 | pub(super) | host.rs |
| 9 | struct | ParticipantEntry | 103-110 | pub(super) | state.rs |
| 10 | struct | RoomState | 112-115 | pub(super) | state.rs |
| 11 | struct | Session | 117-124 | pub(super) | state.rs |
| 12 | struct | ValidityCache | 126-135 | pub(super) | state.rs |
| 13 | impl | ValidityCache::new/valid | 137-162 | valid pub(super) | state.rs |
| 14 | struct | SessionState | 164-172 | pub(super) | state.rs |
| 15 | impl | SessionState::new | 174-182 | new pub(super) | state.rs |
| 16 | struct | RateLimiter | 184-190 | pub(super) | state.rs |
| 17 | struct | PendingUpload | 192-204 | pub(super) | state.rs |
| 18 | consts | OPS_*, CHAT_*, OUTBOUND_QUEUE_CAPACITY, VALIDITY_TTL | 206-221 | private | state.rs |
| 19 | impl | RateLimiter::new/refill/take/take_draft | 223-274 | take*, pub(super) | state.rs |
| 20 | fn | hostname | 276-281 | pub(super) | state.rs |
| 21 | fn | now_ms | 283-288 | pub(super) | state.rs |
| 22 | impl | RoomHost::open + 4 admin fns | 290-449 | pub | host.rs |
| 23 | struct | AdminRoom | 451-454 | pub | host.rs |
| 24 | fn | router | 456-473 | pub | http.rs |
| 25 | fn | browser_origin_allowed | 475-486 | private | http.rs |
| 26 | fn | apply_cors | 488-513 | private | http.rs |
| 27 | fn | cors | 515-546 | private | http.rs |
| 28 | fn | health | 548-550 | private | http.rs |
| 29 | fn | ready | 552-562 | private | http.rs |
| 30 | struct | CreateRoomBody | 564-570 | private | http.rs |
| 31 | fn | admin_rooms | 572-595 | private | http.rs |
| 32 | struct | CreateInviteBody | 597-603 | private | http.rs |
| 33 | fn | admin_invites | 605-638 | private | http.rs |
| 34 | fn | admin_revoke | 640-657 | private | http.rs |
| 35 | fn | admin_end_room | 659-676 | private | http.rs |
| 36 | fn | admin_authorized | 678-689 | private | http.rs |
| 37 | fn | admin_unauthorized | 691-697 | private | http.rs |
| 38 | fn | is_loopback_host | 701-714 | pub(super) | http.rs |
| 39 | fn | is_local_origin | 716-728 | private | http.rs |
| 40 | fn | is_loopback_bind | 730-733 | private | http.rs |
| 41 | fn | origin_allowed | 735-767 | pub(super) | http.rs |
| 42 | fn | ws_upgrade | 769-780 | pub(super) | connection.rs |
| 43 | enum | Registration | 782-790 | private | connection.rs |
| 44 | fn | lock | 792-799 | pub(super) | state.rs |
| 45 | fn | deliver | 801-820 | pub(super) | state.rs |
| 46 | fn | deliver_to | 822-825 | pub(super) | state.rs |
| 47 | fn | register_participant | 827-881 | private | connection.rs |
| 48 | fn | run_session | 883-1148 | private | connection.rs |
| 49 | fn | handle_operation | 1150-1269 | pub(super) | operation.rs |
| 50 | fn | display_name_of | 1271-1280 | private | connection.rs |
| 51 | fn | client_id_of | 1282-1287 | private | connection.rs |
| 52 | fn | operation_id_of | 1289-1298 | private | operation.rs |
| 53 | fn | reject_frame | 1300-1326 | pub(super) | operation.rs |
| 54 | fn | handle_client_frame | 1328-1717 | pub(super) | frames.rs |
| 55 | fn | validate_bind | 1719-1735 | private | lifecycle.rs |
| 56 | fn | spawn_accept_loop | 1737-1757 | private | lifecycle.rs |
| 57 | fn | spawn_lock_heartbeat | 1759-1797 | private | lifecycle.rs |
| 58 | fn | serve_with_handle | 1799-1824 | pub | lifecycle.rs |
| 59 | fn | serve_on_current_runtime | 1826-1839 | pub | lifecycle.rs |
| 60 | fn | serve | 1841-1858 | pub | lifecycle.rs |
| 61 | mod | tests (6 tests + 2 helpers) | 1860-1976 | cfg(test) | tests.rs (module `server::tests`) |

Section comments base 456 (`// -- HTTP surface --`) and 699 (`// -- WebSocket session --`)
move verbatim into `http.rs` and `connection.rs` respectively.

## Destination map (every file <= 400 lines; expected sizes)

| file | source blocks | expected lines | note |
|------|---------------|----------------|------|
| `src/server.rs` (entry) | 1-10 + structural | ~25 | docs, 8 `mod` decls, `#[cfg(test)] mod tests;`, 3 `pub use` lines; same public path `crate::server::*` |
| `src/server/prelude.rs` | 11-37 | ~45 | 20 shared imports as `pub(crate) use`; `#![allow(unused_imports)]`; one glob per module |
| `src/server/host.rs` | 39-101, 290-454 | ~245 | HostConfig, RoomHost + Drop + admin impl, lock consts, AdminRoom |
| `src/server/state.rs` | 103-288, 792-825 | ~235 | participant/room/session state, validity cache, rate limiter, pending upload, shared lock/outbound helpers |
| `src/server/http.rs` | 456-697, 701-767 | ~320 | router, CORS, health/ready, admin API, origin/host policy |
| `src/server/connection.rs` | 699, 769-790, 827-1148, 1271-1287 | ~380 | upgrade, registration, session loop, display/client-id helpers |
| `src/server/operation.rs` | 1150-1269, 1288-1326 | ~170 | authenticated operation handler + refusal attribution |
| `src/server/frames.rs` | 1328-1717 | ~397 | frame dispatcher only (tightest file; see risk note) |
| `src/server/lifecycle.rs` | 1719-1858 | ~150 | bind validation, accept loop, lock heartbeat, public serve entry points |
| `src/server/tests.rs` | 1864-1975 | ~115 | test module body; replaces the glob with explicit imports; names stay `server::tests::*` |

Risk note: `frames.rs` is the only destination close to the cap; if the generated file
exceeds 400 lines the module doc/blank structural lines are trimmed (never a moved
line). The guard check at stage time is authoritative.

## Planned edits (the complete allowlist; everything else is byte-identical)

1. 20 import statements in `prelude.rs` gain the `pub(crate) ` prefix (single-token
   edit on the first line of each statement; multi-line group bodies unchanged).
2. Visibility prefixes (`pub(super) `) on: `RoomHost` 5 fields; `ParticipantEntry`
   (struct + 4 fields); `RoomState` (struct + field); `Session` (struct + 5 fields);
   `ValidityCache` struct; `SessionState` (struct + 3 fields); `RateLimiter` struct;
   `PendingUpload` (struct + 7 fields); methods `ValidityCache::valid`,
   `SessionState::new`, `RateLimiter::take`, `RateLimiter::take_draft`; fns
   `hostname`, `now_ms`, `lock`, `deliver`, `deliver_to`, `ws_upgrade`,
   `handle_operation`, `reject_frame`, `handle_client_frame`, `origin_allowed`,
   `is_loopback_host`; const `HOST_LOCK_REFRESH_MS`. No body line changes.
3. Structural wrappers only: entry mod/use declarations; module headers/imports; the
   test wrapper lines 1860-1861 and 1976 replaced by the entry's `#[cfg(test)] mod
   tests;`; the test glob at 1862 replaced by three explicit imports; blank separator
   lines between moved top-level blocks normalized to one (blank lines are not code).

## Proof plan

1. Partition/byte-identity matrix: every base line 1-1,976 either inside one moved
   block or an explicit structural line; every non-blank moved line byte-identical
   except the allowlist above; count verbatim/edited/structural lines; assert each
   destination <= 400 lines and total moved lines owned exactly once.
2. Public-name preservation: the 7 public names of `crate::server` remain re-exported
   from the entry (plus `HostConfig::for_data_dir`, `RoomHost::open`/`admin_*`, which
   travel with their pub types).
3. `cargo test -p varve-room` after the move: 30/30 (14 lib + 3 conformance + 13
   integration), 0 failed, test names of the lib unit tests unchanged
   (`server::tests::*`).
4. `cargo check -p varve-room --all-targets` (or the test build itself) catches
   visibility/module registration mistakes.
5. `cargo fmt -p varve-room --check` before/after: record the pre-existing red state
   and compare the formatting-delta set; do not reformat unrelated code.
6. Direct recursive-tsc substitution: diagnostics byte-identical before/after (no TS
   file changed).
7. `node scripts/quality/audit-file-size.mjs --update` then `pnpm audit:filesize`:
   949 -> 948, removed exactly `crates/varve-room/src/server.rs`, 0 added, 0 grown;
   staged cap check on all new modules.
8. Unchanged covering test files: `server_integration.rs` 1,100 lines,
   `protocol_conformance.rs` 64 lines, hashes recorded before and after.

## Measured proof (after the move; commands recorded on the B-07 worktree)

Partition/byte-identity matrix (script reproduced in `target/b07-analysis/split.mjs`,
report in `target/b07-analysis/matrix.json`):

- base blob `git show HEAD:crates/varve-room/src/server.rs`, sha256
  `5d239f5ca51ab9716f69b532f8c363901183fa640bb1f7ecdec51f3a1c10f001`, 1,976 lines.
- 1,955 moved lines: 1,885 byte-verbatim + 70 planned single-token visibility/use
  edits + 105 formatting-only test-body de-indents (the inline `mod tests` nesting is
  gone, so the body is de-indented by 4 spaces; A-07 precedent for a recorded de-indent).
- 13 blank separator lines between destination blocks dropped, and 4 wrapper lines
  (test `mod` opening/closing and the `use super::*;` glob) replaced by the entry's
  `#[cfg(test)] mod tests;` declaration. 1,955 + 13 + 4 + the 4 block-edge blanks
  re-inserted by the assembler = 1,976: every base line accounted exactly once.
- declaration check: 79 distinct top-level declaration names; per-name occurrence
  counts equal to the base (missing: [], duplicates: []); all 61 inventory blocks
  present exactly once.
- destination sizes (all <= 400): entry 25, prelude 34, host 234, state 227,
  http 318, connection 377, operation 165, frames 397 (tightest), lifecycle 148,
  tests 116.
- public surface: the entry keeps
  `pub use host::{AdminRoom, HostConfig, RoomHost};`,
  `pub use http::router;`, and
  `pub use lifecycle::{serve, serve_on_current_runtime, serve_with_handle};`
  so every `crate::server::*` path is unchanged and `lib.rs` re-exports type-check.
- covering suite `cargo test -p varve-room`: **30/30 before and 30/30 after**
  (14 lib + 3 protocol_conformance + 13 server_integration; 0 failed; the lib tests
  keep their `server::tests::*` names). The two covering test files are unchanged:
  `server_integration.rs` 1,100 lines sha256
  `741bdb647850cf832a802e1c1244565f8cfbd8779f578ce4ce9a5507513f66fe`,
  `protocol_conformance.rs` 64 lines sha256
  `be725742d31c26aac4f632148da647faf5f284c0f4ce7c5c8b81dc6862e87444`.
- `cargo check -p varve-room --all-targets`: clean (all moved declarations compile).
- formatting: `cargo fmt -p varve-room --check` is red before and after (pre-existing
  rustfmt drift in `join.rs`, `store.rs`, `server.rs` and the covering test). The
  changed-line multiset is identical: 477 before / 477 after with an empty symmetric
  difference after normalizing the recorded de-indent, so the move adds no formatting
  delta and no moved body line was reformatted.
- direct recursive-tsc substitution for the queue-EROFS `check:agent`: before and
  after both `packages-checked=20 packages-fail=0 desktop-exit=0 e2e-exit=0
  diagnostics=0`; the two diagnostic files are byte-identical (both empty).
- ratchet: `node scripts/quality/audit-file-size.mjs --update` wrote 948 frozen entries,
  "added 0, grown 0, removed 1"; the baseline diff is exactly the deletion of
  `crates/varve-room/src/server.rs`. `pnpm audit:filesize` exit 0;
  report 6,215 scanned / 948 frozen / 0 stale / 302,353 excess lines (was 303,929).
  `--update --force` was not used.

## Residuals and review notes

- **Formatting state is a pre-existing checkpoint residual, not introduced here.** The
  crate was already not fmt-clean at the checkpoint (rustfmt 1.97.1 reflows
  `join.rs`, `store.rs`, `server.rs` and the covering test), and the repo-wide fmt
  lane (`cargo fmt --all -- --check` in the release-candidate workflow / justfile) was
  already red for other crates at the checkpoint (recorded in the A-07 ledger row).
  This seam keeps every moved body line byte-identical and proves the formatting-delta
  multiset is unchanged (477 changed lines before and after, empty symmetric
  difference), so the crate's fmt state is identical in kind before/after. Consequence
  for a future formatting pass: under the same rustfmt, `frames.rs` (397 committed
  lines) would reflow to ~460 lines, so a crate-wide `cargo fmt` must be paired with a
  follow-up split of `handle_client_frame`'s presence/chat arms. This is a follow-up
  item, not a violation of the enforced 400-line guard: every committed destination is
  <= 400 lines and `pnpm verify:commit`'s staged file-size lane passes (10 staged
  source files, all <= 400).
- **Independent read-only cross-check** of the generated tree confirmed: compiles
  (`cargo check -p varve-room --lib --tests`, 0 warnings), 30/30 covering tests,
  partition coverage with 0 deficits, exactly the 70 planned visibility/use edits, no
  missing/duplicate declarations, all 7 public items re-exported from the entry, no
  orphan module files, and the sole `super::` occurrence (the test glob) correctly
  replaced. Its only flag was the rustfmt-after-size consequence recorded above.
