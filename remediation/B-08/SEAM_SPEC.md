# B-08 seam specification - `crates/varve-bgremove/src/inference.rs` split

**Single concern:** pure code motion of the ONNX inference orchestration into
`crates/varve-bgremove/src/inference/...`; `crates/varve-bgremove/src/inference.rs` stays
as the thin module entry and keeps the existing public inference surface. No behavior,
naming, comment, API or test change. No visual surface changed (Rust native inference;
no rendered surface), so the front-end/visual gates do not fire.

## Pre-flight (measured on `.worktrees/B-08`, branch `seam/B/B-08-bgremove-inference`)

- `pnpm audit:filesize`: exit 0; "6215 source files scanned; 948 over 400 lines, all
  frozen in .file-size-baseline.json".
- `node scripts/quality/audit-file-size.mjs --report`: 6,215 scanned / 948 frozen /
  0 stale / 302,353 excess lines / 0 WIP.
- `pnpm install --frozen-lockfile`: read-only-store failure; 21 symlinked node_modules
  trees + ignored onnxruntime-libs copy as measured for B-06/B-07.
- `pnpm check:agent`: queue EROFS; substituted by the direct recursive-tsc program
  (20 package tsconfigs + apps/desktop + tests/e2e) measured before and after.
- `godsplit-plan` exit 2 (`unsupported file extension: .rs`); `refactor-verify` exit 2
  (`cannot parse crates/varve-bgremove/src/inference.rs`) - Rust substitution (hand
  inventory + partition matrix + cargo test) applies.
- `cargo test -p varve-bgremove --features ai`: 54 passed / 6 ignored / 0 failed
  (lib 53 passed + 1 ignored, `tests/lama_expand_qualification` 1 passed, five
  `tests/native_*.rs` 1 ignored each).
- `cargo check -p varve-bgremove --features ai --all-targets`: exit 0 (20.89s).
- `cargo fmt -p varve-bgremove --check`: exit 0 (crate is fmt-clean at the checkpoint).
- `pnpm queue:status`: "exclusive free; shared 0/4 slots busy; 0 waiting";
  `pnpm worktree:status`: 45 worktrees, 0 unmerged, 0 stale candidates.
- Base blob: `git show HEAD:crates/varve-bgremove/src/inference.rs`, 1,885 lines,
  sha256 `3bb8ce0119863be498ee3601c23b306cb5ae42f15647c3e34bcd1ae6e5729a4d`.
- Covering test files unchanged: six `crates/varve-bgremove/tests/*.rs` (666 lines)
  sha256 prefix `c792c72a`, `44d886af`, `2e408670`, `0ab41a75`, `cb9fd159`, `56aa9b82`
  (full hashes in the research log; re-checked after the move).

## Declaration inventory (hand-completed; planner unavailable for .rs)

Kind, base inclusive range, visibility, destination. Every item appears exactly once.
Produced by the raw-string-aware scanner (`target/b08-analysis/scan.mjs`), then read
and confirmed block by block. 67 top-level items: 8 imports, 58 declarations, 1 test
module.

| # | kind | name | lines | vis | destination |
|---|------|------|-------|-----|-------------|
| 1 | module doc | (crate-visible module docs) | 1-9 | - | inference.rs (entry) |
| 2 | use block | shared imports (8 statements) | 11-20 | - | prelude.rs (pub(crate)) |
| 3 | trait | InferenceRuntime | 24-40 | pub | runtime.rs |
| 4 | struct | TensorShape | 42-44 | pub | runtime.rs |
| 5 | struct | TensorOutput | 46-51 | pub | runtime.rs |
| 6 | trait | InferenceSession | 53-116 | pub | runtime.rs |
| 7 | struct | OrtInferenceRuntime | 120-126 | pub | runtime.rs |
| 8 | struct | OrtSession | 128-135 | pub(crate) | runtime.rs |
| 9 | impl | OrtInferenceRuntime | 137-237 | private | runtime.rs |
| 10 | impl | InferenceRuntime for OrtInferenceRuntime | 239-249 | private | runtime.rs |
| 11 | impl | InferenceSession for OrtSession | 251-382 | private | runtime.rs |
| 12 | static | CURRENT_RUNTIME | 386-386 | private | session.rs |
| 13 | static | SESSION_POOL | 387-387 | private | session.rs |
| 14 | static | AUTO_GPU_MODEL_FAILURES | 388-388 | private | session.rs |
| 15 | fn | set_runtime | 390-397 | pub | session.rs |
| 16 | fn | get_runtime | 399-404 | private | session.rs |
| 17 | fn | get_session_pool | 406-408 | private | session.rs |
| 18 | fn | auto_gpu_model_failures | 410-412 | private | session.rs |
| 19 | fn | model_failure_key | 414-416 | private | session.rs |
| 20 | fn | auto_gpu_model_is_quarantined | 418-423 | private | session.rs |
| 21 | fn | quarantine_auto_gpu_model | 425-429 | private | session.rs |
| 22 | fn | clear_auto_gpu_model_quarantine | 431-438 | pub | session.rs |
| 23 | fn | auto_gpu_model_fallback_reason | 440-448 | pub | session.rs |
| 24 | fn | auto_gpu_model_fallbacks | 450-465 | pub | session.rs |
| 25 | fn | provider_cache_key | 467-469 | private | session.rs |
| 26 | fn | model_memory_estimate | 471-490 | private | session.rs |
| 27 | fn | automatic_gpu_fallback_allowed | 492-497 | private | session.rs |
| 28 | fn | execution_provider_fallback | 499-549 | private | session.rs |
| 29 | fn | checkout_session | 551-578 | private | session.rs |
| 30 | fn | checkout_cpu_session | 580-593 | private | session.rs |
| 31 | fn | session_pool_metrics | 595-598 | pub | session.rs |
| 32 | fn | unload_model_session | 600-608 | pub | session.rs |
| 33 | fn | unload_all_model_sessions | 610-613 | pub | session.rs |
| 34 | type | ModelSpec | 617-617 | private | segmentation.rs |
| 35 | struct | LetterboxTransform | 619-624 | private | segmentation.rs |
| 36 | fn | model_spec | 626-639 | private | segmentation.rs |
| 37 | const | DENOISE_INPUT_DIVISIBLE | 649-649 | private | denoise.rs |
| 38 | fn | align_to | 651-657 | private | denoise.rs |
| 39 | struct | ImageModelSpec | 659-670 | private | denoise.rs |
| 40 | enum | ChannelOrder | 672-676 | private | denoise.rs |
| 41 | impl | ChannelOrder | 678-694 | private | denoise.rs |
| 42 | fn | image_model_spec | 696-731 | private | denoise.rs |
| 43 | struct | DenoiseResult | 733-743 | pub | denoise.rs |
| 44 | fn | denoise_image | 745-761 | pub | denoise.rs |
| 45 | fn | denoise_image_cancellable | 763-900 | pub | denoise.rs |
| 46 | fn | pad_rgba_edges | 902-916 | private | denoise.rs |
| 47 | struct | LamaInpaintRequest | 928-942 | pub | lama.rs |
| 48 | struct | LamaInpaintResult | 944-955 | pub | lama.rs |
| 49 | const | LAMA_INPUT_SIZE | 957-957 | private | lama.rs |
| 50 | fn | lama_inpaint | 959-962 | pub | lama.rs |
| 51 | fn | lama_inpaint_cancellable | 964-1239 | pub | lama.rs |
| 52 | fn | stream_sha256 | 1243-1265 | pub | integrity.rs |
| 53 | fn | verify_model_sha256 | 1267-1288 | pub | integrity.rs |
| 54 | fn | remove_ai | 1292-1299 | pub | segmentation.rs |
| 55 | fn | remove_ai_cancellable | 1301-1395 | pub | segmentation.rs |
| 56 | fn | infer_segmentation_mask | 1397-1470 | private | segmentation.rs |
| 57 | fn | mask_confidence | 1472-1481 | private | segmentation.rs |
| 58 | const | DEFAULT_PREVIEW_MAX_DIMENSION | 1483-1484 | private | segmentation.rs |
| 59 | fn | reconstruct_letterbox_mask | 1486-1513 | private | segmentation.rs |
| 60 | fn | normalize_segmentation_output | 1515-1538 | private | segmentation.rs |
| 61 | fn | resize_mask | 1540-1566 | private | segmentation.rs |
| 62 | mod | tests (15 test fns: 14 active + 1 ignored, 2 helpers) | 1568-1885 | cfg(test) | tests.rs (module crate::inference::tests) |

Section comments move verbatim with their following group: base 22 (`InferenceRuntime
trait`) and 118 (`OrtInferenceRuntime`) into `runtime.rs`; 384 (`Default runtime
instance`) into `session.rs`; 615 (`Model spec`) into `segmentation.rs`; 641-647
(`Denoise (SCUNet)`) into `denoise.rs`; 918-927 (`LaMa Inpainting`) into `lama.rs`;
1241 (`SHA-256 stream verification`) into `integrity.rs`; 1290 (`Public API`) into
`segmentation.rs`.

## Destination map (every file <= 400 lines; planned sizes)

| file | base ranges / structural content | planned lines | note |
|------|----------------------------------|---------------|------|
| `src/inference.rs` (entry) | 1-10 + module declarations + re-exports | ~42 | docs kept; 7 `mod` decls, `#[cfg(test)] mod tests;`, 24 re-exports |
| `src/inference/prelude.rs` | 11-20 (8 imports, `pub(crate)`) | ~19 | `#![allow(unused_imports)]`; one glob per module |
| `src/inference/runtime.rs` | 22-382 | ~365 | runtime/session traits + ORT implementations |
| `src/inference/session.rs` | 384-613 | ~234 | lazy statics, runtime registry, GPU quarantine, session checkout, pool metrics |
| `src/inference/segmentation.rs` | 615-639, 1290-1566 | ~309 | model geometry spec + remove_ai pipeline and mask pre/post |
| `src/inference/denoise.rs` | 641-916 | ~281 | SCUNet denoise pipeline + dynamic-shape model specs + edge padding |
| `src/inference/lama.rs` | 918-1239 | ~328 | LaMa inpainting pipeline |
| `src/inference/integrity.rs` | 1241-1288 | ~52 | streaming SHA-256 model verification |
| `src/inference/tests.rs` | 1570-1884 (de-nested) | ~319 | same `crate::inference::tests::*` names; explicit sibling imports |

## Planned edits (the complete allowlist; everything else is byte-identical)

1. `prelude.rs`: the 7 `use` statements that begin a statement (base 11, 12, 13, 14, 15,
   17, 20) gain the `pub(crate) ` prefix; the two continuation lines (18-19 body of the
   `session_pool` group) are unchanged.
2. Visibility prefixes (`pub(super) `) - 16 single-token edits, no body or signature
   change:
   - `session.rs`: `auto_gpu_model_is_quarantined`, `quarantine_auto_gpu_model`,
     `automatic_gpu_fallback_allowed`, `execution_provider_fallback`,
     `checkout_session`, `checkout_cpu_session`;
   - `segmentation.rs`: `ModelSpec` (type), `LetterboxTransform` struct + its 3 fields
     (`offset_x`, `offset_y`, `scale`), `model_spec`, `DEFAULT_PREVIEW_MAX_DIMENSION`,
     `reconstruct_letterbox_mask`, `normalize_segmentation_output`, `resize_mask`.
3. Structural wrappers only: the entry's `mod`/`pub use` block (new lines); each
   destination module's `//!` header and `use super::prelude::*;`/`use super::...` lines
   (new lines); the test wrapper lines 1568, 1569 and 1885 replaced by the entry's
   `#[cfg(test)] mod tests;`; the test import block 1570-1578 replaced by explicit
   sibling-module imports; the test body 1579-1884 de-indented by 4 spaces
   (formatting-only, the inline `mod` nesting is gone - A-07/B-07 precedent for a
   recorded de-indent).
4. Eight blank separator lines at destination boundaries (base 21, 383, 614, 640, 917,
   1240, 1289, 1567) are dropped and replaced by the structural headers; blank lines inside
   a moved range are kept verbatim.
5. Three formatting/path consequences of the structural move are part of the recorded
   allowlist: (a) base 1809's `super::auto_gpu_model_is_quarantined` becomes unqualified
   `auto_gpu_model_is_quarantined` because the test module's `super` is now the entry and
   the same function is already imported by the replaced import block (same function, same
   call); (b) base 1832+1833 are joined into one line - the inline-test 8-space wrappers
   no longer exist, so rustfmt requires the join; (c) `pub(super) fn pad_rgba_edges` exceeds
   the 100-column limit on one line, so its signature is rustfmt-wrapped to 5 lines
   (token-identical).

No name, type, body, comment, string, or call site changes. No new export beyond the
preserved re-exports. No module exceeds the 400-line cap after generation.

## Proof plan

1. Partition/byte-identity matrix: every base line 1-1,885 either inside one moved
   destination range or an explicitly dropped/structural line; every non-blank moved line
   byte-identical except the allowlist above; count verbatim/edited/dropped/added lines;
   assert each destination <= 400 lines and each base line owned exactly once.
2. Public-name preservation: the 23 `pub` names plus `pub(crate) OrtSession` of
   `crate::inference` remain re-exported from the entry, so every measured consumer
   unchanged path still resolves (`lib.rs`, `modnet.rs`, `tensor_runtime.rs`, examples,
   six `tests/*.rs`, `apps/desktop` acceleration/background).
3. `cargo test -p varve-bgremove --features ai` after the move: 54 passed / 6 ignored /
   0 failed, lib unit-test names unchanged (`inference::tests::*`).
4. `cargo check -p varve-bgremove --features ai --all-targets` exit 0 catches
   visibility/module registration mistakes.
5. `cargo fmt -p varve-bgremove --check` exit 0 after the move (checkpoint is clean;
   no formatting drift allowed).
6. Direct recursive-tsc substitution: diagnostics byte-identical before/after (no TS file
   changed).
7. `node scripts/quality/audit-file-size.mjs --update` then `pnpm audit:filesize`:
   948 -> 947, removed exactly `crates/varve-bgremove/src/inference.rs`, 0 added,
   0 grown; staged cap check on all new modules.
8. Unchanged covering test files: six `crates/varve-bgremove/tests/*.rs` hashes recorded
   before and after.

## Measured proof (after the move)

## Measured proof (after the move; commands recorded on the B-08 worktree)

### Partition / byte-identity matrix

ARTIFACTS: `target/b08-analysis/split.mjs` (generator + reproduction/partition checks),
`target/b08-analysis/matrix.json` (per-line ownership), `target/b08-analysis/verify.mjs`
(independent re-read of every emitted line against the matrix).

- Base blob: `git show HEAD:crates/varve-bgremove/src/inference.rs`, 1,885 lines,
  sha256 `3bb8ce0119863be498ee3601c23b306cb5ae42f15647c3e34bcd1ae6e5729a4d` (the repo HEAD of
  this worktree is the pre-move checkpoint, so the committed blob is the pre-move base).
- Every base line 1-1,885 owned exactly once: **1,561 verbatim** + **24 allowlisted
  single-token/path edits** (7 prelude `pub(crate) ` prefixes + 16 `pub(super) ` visibility
  prefixes + 1 test path qualifier) + **277 de-indented test-body lines** + **1 rustfmt
  signature reflow** (1 base line -> 5 lines) + **2 merged test lines** (base 1832+1833 ->
  1 line) + **11 dropped lines** (8 boundary blanks + 3 test-module wrapper lines) +
  **9 replaced lines** (the inline test import block) = 1,885. 0 unaccounted, 0 duplicated,
  0 reproduction mismatches.
- 73 added structural lines: entry mod/`pub use` block (23), prelude header (7), and the
  module docs + prelude glob + sibling imports of the seven moved modules (43).
- Destination sizes (all <= 400): entry 33, prelude 17, runtime 365, session 236,
  segmentation 310, denoise 285, lama 328, integrity 50, tests 317; total 1,941 lines.
  Exactly the 8 planned module files exist in `src/inference/` (0 orphans).
- Declaration check: 67 top-level inventory items; 0 duplicate top-level declaration
  names; 15/15 inline test function names identical and in identical order;
  `crate::inference::tests::*` path preserved.
- Public surface: 24/24 names re-exported from the entry (23 `pub` + `pub(crate) OrtSession`).
  Consumers keep the same paths with zero edits: `src/lib.rs` (12 references),
  `src/modnet.rs`, `src/tensor_runtime.rs`, both examples, all six `tests/*.rs`, and
  `apps/desktop/src-tauri/src/{acceleration.rs,inference/background.rs}`.
- Covering test files unchanged: six `crates/varve-bgremove/tests/*.rs` sha256 identical
  before and after the move (`c792c72a...`, `44d886af...`, `2e408670...`, `0ab41a75...`,
  `cb9fd159...`, `56aa9b82...`).

### Gates

- `cargo test -p varve-bgremove --features ai` (ORT_DYLIB_PATH set): **54 passed /
  6 ignored / 0 failed before and 54 passed / 6 ignored / 0 failed after** (lib 53 passed
  + 1 ignored; `tests/lama_expand_qualification` 1 passed; the five `tests/native_*.rs`
  files 1 ignored each; doc-tests 0). Lib unit-test names unchanged.
- `cargo check -p varve-bgremove --features ai --all-targets`: exit 0 before (20.89s) and
  after (1.41s).
- `cargo fmt -p varve-bgremove --check`: exit 0 before and after (checkpoint-clean crate
  stayed clean; the only rustfmt-driven line changes are the recorded formatting edits in
  allowlist item 5).
- Direct recursive-tsc substitute for the queue-EROFS `check:agent` (same program as
  `check:agent:raw`: 20 package tsconfigs + apps/desktop + tests/e2e, bounded-parallel
  runner): `packages-checked=20 packages-fail=0 desktop-exit=0 e2e-exit=0 diagnostics=0`
  (exit 0; bounded-parallel run, 152 s). The worktree's TypeScript content is unchanged by this seam
  (`git status` shows only the Rust split, baseline and remediation docs), so the
  program's inputs are byte-identical to the checkpoint's.
- `godsplit-plan` / `refactor-verify`: exit 2 on the `.rs` target (recorded above); the
  Rust substitution above is the covering proof.

### Ratchet

- `node scripts/quality/audit-file-size.mjs --update`:
  `Wrote .file-size-baseline.json: 947 frozen file(s) over 400 lines. added 0, grown 0,
  removed 1 (splits/deletes/untracked-pruned). 8 untracked file(s) scanned; over-cap WIP is
  never frozen.`
- Baseline diff is exactly the deletion of
  `"crates/varve-bgremove/src/inference.rs": 1885`; no entry added, no entry grown.
  `--update --force` was not used.
- `pnpm audit:filesize`: exit 0, "6223 source files scanned; 947 over 400 lines, all frozen
  in .file-size-baseline.json". `--report`: 6,223 scanned / 947 frozen / 0 stale /
  0 untracked WIP over-cap / 300,868 excess lines (was 948 frozen / 302,353 excess).
- Staged cap check (`audit-file-size.mjs --staged`) and staged map/health lanes run inside
  `pnpm verify:commit`; every staged source file is <= 400 lines.
