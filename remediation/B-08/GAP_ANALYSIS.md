# B-08 gap analysis

Target `crates/varve-bgremove/src/inference.rs` -> `crates/varve-bgremove/src/inference/`
(entry kept). Covering suite `cargo test -p varve-bgremove --features ai` = 54 passed /
6 ignored / 0 failed measured before editing.

## What the standard (TypeScript) seam protocol cannot do here

| Standard step | Status on this checkpoint | Substitution used |
|---------------|---------------------------|-------------------|
| `godsplit-plan` inventory | exit 2, `unsupported file extension: .rs` | hand-built raw-string-aware top-level inventory (67 items) + line-range partition from `git show HEAD:crates/varve-bgremove/src/inference.rs` |
| `refactor-verify` declaration proof | exit 2, `cannot parse crates/varve-bgremove/src/inference.rs` | partition/byte-identity matrix + `cargo test -p varve-bgremove --features ai` (compiles every moved declaration) |
| `pnpm check:agent` | queue EROFS on `/run/user/1000/varve-validation-queue/exclusive.lock` | direct recursive `tsc` over the `check:agent:raw` program (20 packages + apps/desktop + tests/e2e), before and after; no TS file changes |
| `pnpm install --frozen-lockfile` | `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` (read-only store) | 21 measured `node_modules` symlinks + ignored `onnxruntime-libs` copy |
| `cargo fmt -p varve-bgremove --check` | CLEAN at the checkpoint (exit 0) | keep every moved line byte-identical; keep added structural lines rustfmt-canonical; no reformatting |
| `pnpm exec biome` | Rust paths are not biome inputs | not applicable; no TS/JS file changed |

## Gaps in the target that the seam must close

1. `inference.rs` mixes six concerns the backlog row names: the swappable runtime
   abstraction and its ORT implementation (base 22-382), process-wide runtime/session-pool
   state, automatic-GPU quarantine and session checkout (384-613), per-model geometry /
   normalization specs (615-639), the denoise pipeline (641-916), the LaMa inpainting
   pipeline (918-1239), SHA-256 model verification (1241-1288) and the segmentation
   removal pipeline with its pre/post processing (1290-1566). The move assigns one module
   per concern family plus a prelude for the shared import block, a thin entry, and a
   tests module.
2. The shared import block (base 11-20) is used by six modules; moving it verbatim would
   duplicate 8 import statements. The B-02/B-07 precedent is a `prelude.rs` with
   `pub(crate) use` and one glob import per module.
3. Cross-module private access: the checkout/fallback helpers, the quarantine helpers, the
   model spec helper and the mask pre/post helpers are currently private-in-file. After
   the split the pipelines and the moved unit tests access them from sibling modules, so
   they get `pub(super)` visibility prefixes (planned edits in `SEAM_SPEC.md`); no name,
   type, body, comment, or call site changes.
4. The inline `#[cfg(test)] mod tests` (base 1568-1885) becomes `inference/tests.rs`
   declared as `#[cfg(test)] mod tests;` in the entry, so test names stay
   `crate::inference::tests::*` and the lib unit-test count stays 53 passed / 1 ignored.
   Only the test module's `use super::{...}` line is replaced by explicit sibling-module
   imports (the B-07 precedent); the test bodies are de-indented by 4 spaces and otherwise
   byte-identical.
5. Cancellation/job state is not declared in this file: `InferenceCancellationToken`,
   `SessionLease` and the pool itself already live in `crate::session_pool`; `inference.rs`
   only threads tokens through the pipelines. The seam keeps every cancellation check in
   its pipeline module and moves the lease/checkout orchestration into `session.rs`; no
   new state and no moved check is introduced.

## STOP conditions

- A declaration in the inventory cannot be placed without a behavior change or a
  rename -> stop, do not improvise.
- The partition matrix reports any unassigned or duplicated non-blank base line -> stop.
- `cargo test -p varve-bgremove --features ai` count drops below 54 passed / 6 ignored or
  any test fails -> stop.
- `cargo check -p varve-bgremove --features ai --all-targets` or
  `cargo fmt -p varve-bgremove --check` is not clean after the move -> fix the seam inside
  the destination directory; never reformat unrelated code.
- The baseline `--update` adds an entry, grows a frozen file, or removes more than the
  intended one entry -> stop (never `--force`).
- The staged file-size check reports a new module over 400 lines -> re-cut the seam inside
  the same destination directory; do not stage an over-cap file.

## Non-goals

- No behavior, API, wire, or test change. No unrelated reformatting. No edits to the six
  `crates/varve-bgremove/tests/*.rs` files (666 lines total, hashes recorded before and
  after), and no edits to `lib.rs`, the dated remediation record, the campaign plan, or
  `docs/README.md`.
- No front-end/visual gates: no rendered surface changed.
- No push, no merge, no second seam.
