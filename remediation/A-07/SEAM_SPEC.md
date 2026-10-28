# SEAM_SPEC - Batch A / A-07 WGSL validation

**Status:** seam plan accepted 2026-10-28 (single seam, one worktree, one
commit). Implementation starts only after this document, [RESEARCH.md](RESEARCH.md)
and [GAP_ANALYSIS.md](GAP_ANALYSIS.md) exist; it runs only in
`.worktrees/A-07` on branch `seam/A/A-07-wgsl-validation`.

## Seam hypothesis

- **Entry:** Batch A / A-07 (remediation rank #12).
- **Target:** `crates/varve-bridge/tests/wgsl_validation.rs` - **2,696 lines**,
  frozen at 2,696 in `.file-size-baseline.json` (line 28).
- **Single concern:** the offline naga WGSL validation suite. The file is one
  Rust integration-test crate: 2 use items, 17 WGSL raw-string consts, one
  shared `fn validate`, and 9 `#[test]` functions. The seam splits it by
  **shader family**, with the shared fixture helper in a support module.
- **Single extraction destination:** `crates/varve-bridge/tests/wgsl_validation/`
  (one destination directory = one seam; precedents:
  `packages/editor/src/menu/defs.ts` -> 11-line barrel + 15 modules under
  `menu/defs/`, A-04 `IntelligencePanel.tsx` -> `panels/intelligence/`,
  A-05 `types.ts` -> `types/`, A-06 `product.mjs` -> `product/`).
- **Target after seam:** the Cargo test target `wgsl_validation` is unchanged,
  but its crate root moves to `crates/varve-bridge/tests/wgsl_validation/main.rs`
  (Cargo auto-discovers `tests/<name>/main.rs` as target `<name>`; see the
  measured evidence below), so the old `tests/wgsl_validation.rs` path is
  deleted. The invocation `cargo test -p varve-bridge --test wgsl_validation`
  and the 9 test names are unchanged. No library API, IPC command, manifest, or
  TS runtime surface changes.
- **Scope note (declared):** the two TypeScript drift guard specs
  (`packages/compositor/src/webgpu/wgsl-drift.test.ts`,
  `packages/compositor/src/webgpu/effects/__tests__/wgsl-drift.test.ts`) and the
  mirror generator (`packages/compositor/scripts/gen-wgsl-mirrors.mjs`) read /
  write these declarations by path and are updated as harness wiring in the same
  seam (A-06 G7 precedent); 14/14 drift tests before and after, and a diff-free
  generator rerun. No assertion, test name, or WGSL byte changes.

## Declaration inventory (29 top-level items, hand-completed)

The TypeScript planner cannot parse Rust (`godsplit-plan` exits 2:
"unsupported file extension: .rs"; tested, not edited), so this inventory was
built by hand from a raw-string-aware top-level scan of the checkpoint blob and
a read of every block range. Counts: 2 `use` items + 17 `const` + 1 `fn` +
9 `#[test]` functions = 29 items / 27 declarations.

| # | declaration | kind | base lines | destination |
|---|-------------|------|-----------|-------------|
| 1 | `use naga::front::wgsl::parse_str;` | use | 25 | `support.rs` |
| 2 | `use naga::valid::{Capabilities, ValidationFlags, Validator};` | use | 26 | `support.rs` |
| 3 | `SOLID_VERTEX_WGSL` | const &str | 30-107 | `render_stages.rs` |
| 4 | `SOLID_FRAGMENT_WGSL` | const &str | 109-128 | `render_stages.rs` |
| 5 | `CIRCLE_VERTEX_WGSL` | const &str | 134-204 (preface 130-132) | `render_stages.rs` |
| 6 | `CIRCLE_FRAGMENT_WGSL` | const &str | 206-230 | `render_stages.rs` |
| 7 | `BLIT_VERTEX_WGSL` | const &str | 232-256 | `render_stages.rs` |
| 8 | `BLIT_FRAGMENT_WGSL` | const &str | 258-266 | `render_stages.rs` |
| 9 | `SEPARABLE_BLUR_H_WGSL` | const &str | 270-298 | `blur_kernels.rs` |
| 10 | `SEPARABLE_BLUR_V_WGSL` | const &str | 300-328 | `blur_kernels.rs` |
| 11 | `validate(wgsl, name, has_entry_points)` | fn | 332-347 | `support.rs` |
| 12 | `solid_vertex_wgsl` | #[test] fn | 351-354 | `render_stages.rs` |
| 13 | `solid_fragment_wgsl` | #[test] fn | 356-359 | `render_stages.rs` |
| 14 | `circle_vertex_wgsl` | #[test] fn | 361-366 | `render_stages.rs` |
| 15 | `circle_fragment_wgsl` | #[test] fn | 368-371 | `render_stages.rs` |
| 16 | `blit_vertex_wgsl` | #[test] fn | 373-376 | `render_stages.rs` |
| 17 | `blit_fragment_wgsl` | #[test] fn | 378-381 | `render_stages.rs` |
| 18 | `separable_blur_h_wgsl` | #[test] fn | 383-390 | `blur_kernels.rs` |
| 19 | `separable_blur_v_wgsl` | #[test] fn | 392-399 | `blur_kernels.rs` |
| 20 | `RGBSPLIT_WGSL` | const &str | 404-582 | `rgb_split.rs` |
| 21 | `CRT_WGSL` | const &str | 584-892 | `crt.rs` |
| 22 | `LIGHTLEAK_WGSL` | const &str | 894-1062 | `light_leak.rs` |
| 23 | `PALETTESNAP_WGSL` | const &str | 1064-1312 | `palette_snap.rs` |
| 24 | `VHS_WGSL` | const &str | 1314-1602 | `vhs.rs` |
| 25 | `LIGHTSHAFTS_WGSL` | const &str | 1604-1858 | `light_shafts.rs` |
| 26 | `CAUSTICS_WGSL` | const &str | 1860-2144 | `caustics.rs` |
| 27 | `LENSFLARE_WGSL` | const &str | 2146-2393 | `lens_flare.rs` |
| 28 | `BLOOM_WGSL` | const &str | 2395-2683 | `bloom.rs` |
| 29 | `effect_kernel_wgsl_compiles` | #[test] fn | 2685-2696 | `main.rs` |

Non-declaration blocks that move verbatim (no declaration, no edit):

| block | base lines | destination | note |
|---|---|---|---|
| crate doc header (23 `//!` lines) | 1-23 | `main.rs` | preserved verbatim; the pre-existing header gap (the generated effect kernels are documented only by the 401-402 notice, not by the two-TS-file list) is recorded and not fixed by this pure move |
| section marker `// ---- shaders.ts ----` | 28 | `render_stages.rs` | verbatim |
| section marker `// ---- gpuAccelerator.ts ----` | 268 | `blur_kernels.rs` | verbatim |
| section marker `// ---- helpers ----` | 330 | `support.rs` | verbatim |
| section marker `// ---- tests ----` | 349 | `render_stages.rs` | verbatim |
| generated notice (2 comment lines) | 401-402 | `main.rs` | verbatim; placed above the generated-const imports / meta-test |
| blank boundary lines | 17 lines | dropped | block separators; no content |
| 8 naga import lines + mirrors | see inventory | - | - |

Block SHA-256 (first 16 hex chars of each exact base block, used by the
byte-identity proof): main header `f1fa5d74b25b4807`; imports
`7b924fa5155383bb`; render shaders `fbf804a50fc0056f`; blur consts
`c0e8888e9bbb937c`; helpers `fa761357618e6466`; render tests
`434c828e9b3a19ac`; blur tests `f62cd95169c51ebd`; effect header
`42f858ef29ee825e`; RGBSPLIT `b6729c1117f80cca`; CRT `c7e839e5d8d9c88e`;
LIGHTLEAK `93fd57ca6ebddc11`; PALETTESNAP `e6be4d43fe80bf03`; VHS
`dccc7f2f0401dc06`; LIGHTSHAFTS `b364130c912a65ba`; CAUSTICS
`4ad5a72e87281f9c`; LENSFLARE `aa259988d3b873ad`; BLOOM
`4fb272c3dcac1421`; kernel test `4da0d05b59a2c8cb`. Base file SHA-256:
`b3d7f76930a20b61e3a1f20d9d8eb8c17e7febcd8973e99d6fdecbeffbc0eb15`.

## Destination map (expected sizes; measured at closeout)

| module (under `crates/varve-bridge/tests/wgsl_validation/`) | concern | expected lines |
|---|---|---|
| `main.rs` | crate root: doc header, 12 `mod` declarations, generated-kernel notice, 10 imports, the one `effect_kernel_wgsl_compiles` meta-test (11 shader modules + support) | 63 |
| `support.rs` | shared fixture: naga imports + `validate()` helper | 21 |
| `render_stages.rs` | shaders.ts family: SOLID/CIRCLE/BLIT vertex+fragment mirrors + their 6 per-shader tests | 275 |
| `blur_kernels.rs` | gpuAccelerator.ts family: SEPARABLE_BLUR_H/V mirrors + their 2 per-shader tests | 81 |
| `rgb_split.rs` | generated effect kernel RGBSPLIT (banner + const) | 181 |
| `crt.rs` | generated effect kernel CRT (largest single const, 309 lines) | 311 |
| `light_leak.rs` | generated effect kernel LIGHTLEAK | 171 |
| `palette_snap.rs` | generated effect kernel PALETTESNAP | 251 |
| `vhs.rs` | generated effect kernel VHS | 291 |
| `light_shafts.rs` | generated effect kernel LIGHTSHAFTS | 257 |
| `caustics.rs` | generated effect kernel CAUSTICS | 287 |
| `lens_flare.rs` | generated effect kernel LENSFLARE | 250 |
| `bloom.rs` | generated effect kernel BLOOM | 291 |

All 13 modules are at or under the 400-line cap; the largest is `crt.rs` at
311. The measured total is 2,730 lines (2,696 base + 34 framing/prefix/banner
lines).
The old path `crates/varve-bridge/tests/wgsl_validation.rs` is deleted, so the
ledger's `current_lines` for it is **0** (measured root `main.rs` is 63; both
numbers are recorded).

**Sub-split hazard:** a WGSL mirror is a single `r#"..."#` literal and cannot
be subdivided without editing string bytes. Family granularity is therefore the
floor; nine generated families and the two hand-mirror source families are the
natural module units. CRT (309) is under the cap; no further split is needed.

## Cargo integration-test target layout (the reviewed seam decision)

- Cargo auto-discovers `crates/varve-bridge/tests/<name>/main.rs` as the
  integration-test target `<name>`; the crate root may live inside the
  destination directory and its `mod` declarations resolve to sibling files in
  the same directory.
- Evidence measured in `.worktrees/A-07` with a throwaway scratch crate (deleted
  before staging; `[workspace]`-detached):
  `cargo metadata --no-deps --offline` listed target
  `{name: "wgsl_validation", kind: ["test"], src: "tests/wgsl_validation/main.rs"}`
  and `cargo test --offline --test wgsl_validation` passed with
  `mod support;` resolving to `tests/wgsl_validation/support.rs`.
- The old `tests/wgsl_validation.rs` is deleted in the same commit, so there is
  no duplicate target name; no `[[test]]` entry or `Cargo.toml` edit is needed
  and the package manifest stays out of the commit.
- The covering command and the target name are unchanged:
  `cargo test -p varve-bridge --test wgsl_validation`.

## Before and expected-after declaration sets

- **Before:** the 29 items in the inventory above, one file, 9 `#[test]` fns.
- **After:** the same 29 items in the 13 modules above; 9 `#[test]` fns with
  identical names; 17 consts with identical names; 1 `validate` helper; the 2
  naga `use` items. No declaration is renamed, duplicated, or dropped. The only
  semantic-ish edits are the ten `pub(crate)` visibility prefixes needed by the
  module boundary (module plumbing, recorded below).
- **Expected root:** `main.rs` = 63 lines (framing file, far under the cap).

## Planned-edits allowlist (everything else is byte-identical)

1. `fn validate` -> `pub(crate) fn validate` (support.rs; base line 332).
2. `const RGBSPLIT_WGSL` -> `pub(crate) const RGBSPLIT_WGSL` and the same
   prefix on the eight other effect consts (base lines 404, 584, 894, 1064,
   1314, 1604, 1860, 2146, 2395).
3. New framing lines only: 12 `mod` declarations in `main.rs`; 10 `use
   crate::...` lines in `main.rs`; one `use crate::support::validate;` line
   each in `render_stages.rs` and `blur_kernels.rs`; one generated banner line
   plus one blank line in each of the nine generated modules; blank separator
   lines.
4. Moved comment blocks are verbatim (doc header, the four section markers, the
   generated notice, the CIRCLE_VERTEX preface, the tests-section comment).
5. The old single-file path is deleted; the crate root is the new
   `main.rs`.
6. Three declared TS harness files: the two drift specs change their read path
   to the module directory (same extraction marker, same assertions, same test
   names/counts); `gen-wgsl-mirrors.mjs` is repointed to write the nine
   generated consts into their family modules and no longer rewrites the old
   root file.
7. No WGSL byte, no test body/assertion, no const name, no function body, and no
   import target inside moved code changes.

## Applied edge cases (answers from GAP_ANALYSIS.md)

- **Raw strings are the payload:** all 17 consts move as whole blocks derived
  from a raw-string-aware scan; no cut crosses a `r#"..."#` boundary; the
  byte-identity matrix is the guard.
- **Generated mirrors stay durable:** the generator is repointed at the module
  files; after the split it is re-run and must produce an empty `git diff` over
  the generated modules (otherwise the seam is not durable and is not
  committed).
- **Drift guards stay green:** both specs read the module directory and
  concatenate the `.rs` files; 14/14 before and after; assertions untouched.
- **Test identity:** 9 Rust tests, same names, same count; the meta-test remains
  one test validating all nine generated consts (not split into nine).
- **Crate/target identity:** target name `wgsl_validation` and the documented
  invocation are unchanged; no manifest edit.
- **Module-evaluation side effects:** not applicable; the crate contains const
  literals and tests only. Import order has no runtime effect.
- **Comments:** moved verbatim; the crate doc header is not reworded (it already
  says "the corresponding const below"; after the move the consts are below in
  the crate's module tree, and the generated effect source was already
  documented separately at the 401-402 notice). This pre-existing header gap is
  recorded, not silently fixed.
- **Formatting:** rustfmt may reorder only the new framing (`mod`/`use`) lines;
  the identity matrix is re-run after `cargo fmt`. Biome does not format Rust.
- **No behavior change:** no logic, shader, assertion, name, or output changes;
  any difference beyond the allowlist is a defect.

## Pre-flight record (measured in `.worktrees/A-07` on 2026-10-28)

| Check | Command | Result |
|---|---|---|
| Checkpoint | `git rev-parse master` / `git log -1 --oneline master` | `8d1346966a7cff35c68f9ff531c58dbc100a0d29` / "refactor(scripts): split product screenshot pipeline into product/ modules (Batch A/A-06)" |
| Worktree | `git worktree list` / `git status --porcelain` | A-07 at the checkpoint on `seam/A/A-07-wgsl-validation`; clean |
| File-size gate | `node scripts/quality/audit-file-size.mjs` | exit 0; "6065 source files scanned; 957 over 400 lines, all frozen ..." |
| Ranked inventory | `node scripts/quality/audit-file-size.mjs --report` | 957 over cap, 957 frozen, 0 violations, 0 untracked WIP over-cap, 327,551 excess lines, 0 stale |
| Baseline entry | `grep -n wgsl_validation .file-size-baseline.json` | line 28: `"crates/varve-bridge/tests/wgsl_validation.rs": 2696`; 957 entries |
| Planner smoke (Rust substitution) | `node scripts/quality/godsplit-plan.mjs crates/varve-bridge/tests/wgsl_validation.rs` | exit 2: "unsupported file extension: .rs" (`--top` additionally exits 2: "unknown argument: --top") |
| Verifier smoke (Rust substitution) | `node scripts/quality/refactor-verify.mjs --base master --target crates/varve-bridge/tests/wgsl_validation.rs --json` | exit 2: "cannot parse ...: Unexpected keyword or identifier." |
| Covering Rust suite (before) | `cargo test -p varve-bridge --test wgsl_validation` | 9 passed; 0 failed; 0 ignored |
| TS drift guards (before) | `vitest run --maxWorkers=1 packages/compositor/src/webgpu/wgsl-drift.test.ts packages/compositor/src/webgpu/effects/__tests__/wgsl-drift.test.ts` | 14 passed (5 + 9), 2 files, 0 failures |
| Install | `pnpm install --frozen-lockfile` | environment limit: `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` / "Read-only file system"; installed trees symlinked from the main checkout (23 links), not a blocker |
| Queued static gate | `pnpm check:agent` | environment limit: queue lock EROFS (`/run/user/1000/varve-validation-queue/exclusive.lock`); substituted by the same recursive tsc program run directly (result recorded below) |
| Recursive tsc substitute | direct `tsc --noEmit --pretty false` over `packages/*`, `apps/desktop`, `tests/e2e` | exit 0: `packages-fail=0` (22 package tsconfig projects; `packages/automation` has no tsconfig and is skipped by the raw program too), `desktop-exit=0`, `e2e-exit=0`; re-run after the final edits: same result |
| Staged checkpoint driver | `node scripts/quality/commit-checkpoint.mjs` with an empty index | "No staged files; commit checkpoint passed." (driver runs in this environment) |
| Queue / worktrees | `pnpm queue:status` / `pnpm worktree:status` | "exclusive free; shared 0/4 slots busy; 0 waiting"; A-07 clean, no peer writer |

## Proof plan

1. **Declaration preservation (Rust substitution for step 3):** partition the
   checkpoint blob into the 18 blocks above; prove every non-blank line belongs
   to exactly one block, each block's bytes are present in exactly one
   destination module (allowing only the ten `pub(crate) ` prefixes), and no
   destination line is unaccounted for as framing. Record the 29/29 item tally.
2. **Reachability (orphan-module guard):** for every `.rs` under
   `crates/varve-bridge/tests/wgsl_validation/` except `main.rs`, `main.rs`
   contains exactly one `mod <stem>;`; 12 declarations for 13 files, no
   duplicates. An undeclared module would be silently excluded from
   compilation, so this is checked independently of the byte matrix.
3. **Covering suite:** 9 passed / 0 failed before and after; same 9 names.
3. **Crate gates:** `cargo check -p varve-bridge` and
   `cargo check -p varve-bridge --tests` exit 0.
4. **Formatting:** `cargo fmt --all -- --check` exits 0 (CI smoke).
5. **Drift guards:** 14/14 before and after the two-spec path wiring.
6. **Generator determinism:** rerun `node
   packages/compositor/scripts/gen-wgsl-mirrors.mjs`; `git diff` empty over the
   nine generated modules (durable split).
7. **Baseline ratchet:** exactly one removed entry (957 -> 956), 0 added,
   0 grown; `pnpm audit:filesize` exit 0.
8. **Staged checkpoint:** stage the seam, regenerate `pnpm agent:map` from the
   staged tree, run `pnpm verify:commit`, and re-run the Rust + drift suites on
   the staged tree (the checkpoint driver runs no cargo tests).
9. **One ledger row, one commit** on `seam/A/A-07-wgsl-validation`; no merge,
   no push without authorization.
10. **Handoff:** regenerate `NEXT_PROMPT.md` for the next entry with fresh
    measurements; stop.

## No visual surface changed

The seam is a test-only Rust declaration move plus test-harness/generator path
wiring. It renders no UI, produces no pixels, changes no IPC/API shape, and
executes no GPU/WebGPU runtime. Proof: the 9-test offline naga suite and the
14 TS drift guards are identical before and after, and no WGSL string byte
changes. **No visual surface changed; visual validation is not triggered.**

## Verification record (measured after the split, before the commit)

- **Modules:** 13 files under `crates/varve-bridge/tests/wgsl_validation/`
  plus the deletion of the old path. Measured line counts: `main.rs` 63,
  `support.rs` 21, `render_stages.rs` 275, `blur_kernels.rs` 81,
  `rgb_split.rs` 181, `crt.rs` 311, `light_leak.rs` 171,
  `palette_snap.rs` 251, `vhs.rs` 291, `light_shafts.rs` 257,
  `caustics.rs` 287, `lens_flare.rs` 250, `bloom.rs` 291; total 2,730
  lines. Every module is under 400 (largest `crt.rs` 311).
- **Declaration preservation (substitution for prompt-02 step 3):** a
  partition/identity verifier over the checkpoint blob reported `ok: true`
  with 40/40 checks: all 29 top-level items (2 `use` + 17 `const` + 1 `fn` +
  9 `#[test]`) appear byte-identically in exactly one destination module
  (18 blocks total); every non-blank base line belongs to exactly one block;
  all top-level comment lines are present verbatim; exactly 10
  `pub(crate) ` prefixes are pure prepends of base lines; no non-framing text
  exists in any module; 12 `mod` declarations make 12 non-root modules
  reachable with no duplicates. File size hashes: base
  `b3d7f76930a20b61e3a1f20d9d8eb8c17e7febcd8973e99d6fdecbeffbc0eb15`.
- **Cargo target:** `cargo metadata --no-deps --offline` reports exactly one
  test target for `varve-bridge`: `wgsl_validation` at
  `tests/wgsl_validation/main.rs`; the old path is gone.
- **Covering suite after:** `cargo test -p varve-bridge --test wgsl_validation`
  -> **9 passed; 0 failed; 0 ignored**, names unchanged (module-qualified:
  `render_stages::*`, `blur_kernels::*`, root `effect_kernel_wgsl_compiles`).
- **Crate gates:** `cargo check -p varve-bridge` and `cargo check -p
  varve-bridge --tests` exit 0.
- **Formatting:** `cargo fmt -p varve-bridge -- --check` exit 0 (moved crate
  clean; see residual for repo-wide).
- **Drift guards after wiring:** 14 passed (5 + 9), 0 failures; assertions,
  test names and counts unchanged.
- **Generator determinism:** `node
  packages/compositor/scripts/gen-wgsl-mirrors.mjs` ran and rewrote the nine
  generated modules with **0 changed bytes** (before/after SHA-256 sets
  identical); the old root path was not recreated.
- **Static gate (substitution):** the recursive tsc program
  (`check:agent:raw` body: every `packages/*` tsconfig, `apps/desktop`,
  `tests/e2e`) run directly after the final edits -> `packages-fail=0`,
  `desktop-exit=0`, `e2e-exit=0`. The queued wrapper stays unavailable in this
  sandbox (EROFS on the validation-queue lock), so this direct run is the
  recorded substitute, not a claim that `pnpm check:agent` passed.
- **Lint:** `pnpm exec biome check --write` then `biome check` exit 0 on the
  three changed TS files.
- **Baseline ratchet:** `audit-file-size.mjs --update` -> 957 -> **956**
  frozen; "added 0, grown 0, removed 1"; the only diff line is the deleted
  `crates/varve-bridge/tests/wgsl_validation.rs` entry; `pnpm
  audit:filesize` exit 0; no new module is over cap.
- **Residuals recorded, not introduced by this seam:** (a) the checkpoint
  already fails `cargo fmt --all -- --check` on files outside this crate
  under rustfmt 1.9.0-stable (the moved crate is clean, so the seam adds no
  drift); (b) two current-state architecture docs mention the old single-file
  path in prose (not links; no gate reads them) and are left untouched because
  a pure move does not edit dated/current docs - the path move is recorded
  here; (c) `godsplit-plan --top N` remains unsupported (A-06 G18 residual,
  not edited); (d) the crate doc header's two-source list still omits the
  generated effect-kernel source (pre-existing; the 401-402 generated notice is
  preserved verbatim, and the header is moved byte-identically per the
  comment-preservation rule).
