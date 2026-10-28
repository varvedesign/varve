# Phase 0 research - A-07 WGSL validation split

**Status:** research complete 2026-10-28. A-07 is ready to plan after this
document and [GAP_ANALYSIS.md](GAP_ANALYSIS.md) exist; source movement is
blocked until [SEAM_SPEC.md](SEAM_SPEC.md) carries the hand-completed
declaration inventory. Worktree, baseline update, and commit are Lead-owned.

**Checkpoint:** `8d1346966a7cff35c68f9ff531c58dbc100a0d29` - *refactor(scripts):
split product screenshot pipeline into product/ modules (Batch A/A-06)*.
**Worktree:** `.worktrees/A-07` on branch `seam/A/A-07-wgsl-validation`,
created from local `master` at the checkpoint (never from `origin/main`).

**Inputs (attached):**
[agent-context-remediation-2026-10-28.md](../../docs/quality/agent-context-remediation-2026-10-28.md),
[agent-infrastructure-campaign-2026-10-28.md](../../docs/plans/agent-infrastructure-campaign-2026-10-28.md),
[file-size-policy.md](../../docs/quality/file-size-policy.md),
[.file-size-baseline.json](../../.file-size-baseline.json),
the four remediation prompts (`remediation/prompts/01..04`), and the target
`crates/varve-bridge/tests/wgsl_validation.rs` read in line ranges only.
Precedent seam documents: `remediation/A-06/{RESEARCH,GAP_ANALYSIS,SEAM_SPEC}.md`.

## 1. Measured checkpoint state

All numbers below were measured in `.worktrees/A-07` on the checkpoint tree;
older queue counts in the dated docs are stale by construction.

| Measurement | Command | Result |
|---|---|---|
| File-size gate | `node scripts/quality/audit-file-size.mjs` | exit 0: "6065 source files scanned; 957 over 400 lines, all frozen ... (tracked content)" |
| Ranked inventory | `node scripts/quality/audit-file-size.mjs --report` | 6,065 scanned; 957 over cap; **957 frozen**; 0 violations; 0 untracked WIP over-cap; **327,551 excess lines**; baseline entries 957 (0 stale) |
| Target size | `wc -l crates/varve-bridge/tests/wgsl_validation.rs` | **2,696** lines |
| Target hash | `sha256sum crates/varve-bridge/tests/wgsl_validation.rs` | `b3d7f76930a20b61e3a1f20d9d8eb8c17e7febcd8973e99d6fdecbeffbc0eb15` |
| Baseline entry | `grep -n wgsl_validation .file-size-baseline.json` | line 28: `"crates/varve-bridge/tests/wgsl_validation.rs": 2696` (957 entries total) |
| Covering suite (before) | `cargo test -p varve-bridge --test wgsl_validation` | **9 passed; 0 failed; 0 ignored** in 0.02 s after a 1m05s first build |
| TS drift guards (before) | `vitest run --maxWorkers=1 packages/compositor/src/webgpu/wgsl-drift.test.ts packages/compositor/src/webgpu/effects/__tests__/wgsl-drift.test.ts` | **14 passed (5 + 9)**, 2 files, 0 failures |
| Toolchain | `cargo --version` / `rustc --version` | cargo 1.97.1; rustc 1.97.1 |
| Worktree/queue | `pnpm worktree:status` / `pnpm queue:status` | A-07 clean at `8d1346966a7c`, 0 ahead; queue "exclusive free; shared 0/4 slots busy; 0 waiting" |
| TS planner on target | `node scripts/quality/godsplit-plan.mjs crates/varve-bridge/tests/wgsl_validation.rs` | **exit 2**: "godsplit-plan: unsupported file extension: .rs" (`--top` additionally rejected: "unknown argument: --top", the A-05 residual) |
| TS move verifier on target | `node scripts/quality/refactor-verify.mjs --base master --target crates/varve-bridge/tests/wgsl_validation.rs --json` | **exit 2**: "refactor-verify: cannot parse ...: Unexpected keyword or identifier." |

Baseline ratchet target: **957 -> 956** frozen entries, exactly one entry
removed, 0 added, 0 grown.

### Environment limits measured in this worktree (not blockers)

- `pnpm install --frozen-lockfile` fails with
  `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` / "Read-only file system (os error
  30)"; this matches the limit recorded for the A-06 worktree. The workflow
  symlinks the main checkout's installed trees into the worktree and runs the
  same recursive tsc program directly (see SEAM_SPEC pre-flight record).
- The queue-backed `pnpm check:agent` is unavailable in the sandbox: the
  validation queue's exclusive lock under `/run/user/1000/varve-validation-queue`
  is on a read-only mount (`EROFS`). Its script body
  (`pnpm run --silent check:agent:raw`) is substituted by the same recursive
  `tsc --noEmit --pretty false` program run directly, exactly as the A-06 handoff
  recorded, and the substitution is written into GAP_ANALYSIS.md.
- `pnpm exec biome`, `pnpm run audit:emoji`, plain `node scripts/...` and
  `node scripts/quality/commit-checkpoint.mjs` remain executable, so
  `pnpm verify:commit`'s staged lanes are still available.

## 2. What the target is

`crates/varve-bridge/tests/wgsl_validation.rs` is the whole Rust integration
test crate for WGSL compilation validation. It has no production code and no
public API: Cargo compiles it only as the `wgsl_validation` test target of
`crates/varve-bridge`. Cargo.toml declares the dev-dependency
`naga = { version = "30", default-features = false, features = ["wgsl-in", "stderr"] }`
and the crate itself has no `[[test]]` entry, so the target is
auto-discovered from the file path.

The file is 2,696 lines but only 23 top-level declarations: two `use` items,
eleven `const ... : &str` WGSL raw strings, one shared `fn validate`, and nine
`#[test]` functions. 2,449 of the 2,696 lines are WGSL payload inside
`r#"..."#` raw strings. The declaration boundary map (from the top-level scan in
section 5) is: doc header 1-23, imports 25-26, `shaders.ts` six consts 28-266,
`gpuAccelerator.ts` two consts 268-328, helpers 330-347, eight per-shader tests
349-381, generated effect-kernel notice 401-402, nine effect consts 404-2683,
and the single effect-kernel meta-test 2685-2696.

### 2.1 Cross-cutting consumers of the moved declarations (measured)

Two TypeScript drift suites and one generator script hard-code the target path
and the Rust declaration marker. They are not optional for a green, durable
seam, and they are part of this seam's approved scope (A-06 precedent G7:
covering-test harness wiring rides with a pure move):

| Consumer | Coupling | Effect if untouched | Required seam wiring |
|---|---|---|---|
| `packages/compositor/src/webgpu/wgsl-drift.test.ts` (5 tests) | `rustPath` points at the single `wgsl_validation.rs`; `extractRustWgsl()` does `src.indexOf('const <NAME>: &str = r#"')` | all 5 tests fail after the consts move: "missing ... in wgsl_validation.rs" | read the `.rs` files of `tests/wgsl_validation/`, sort by filename, concatenate, keep the same marker; assertions untouched |
| `packages/compositor/src/webgpu/effects/__tests__/wgsl-drift.test.ts` (9 tests) | same, for the nine generated effect consts | all 9 tests fail | same directory-read wiring with its one-extra-`../` relative path |
| `packages/compositor/scripts/gen-wgsl-mirrors.mjs` | `mirrorPath` is the single file; it splits it at `// ---- effect kernels (generated) ----` and appends the generated 2,282-line block | the next regeneration recreates a >400-line root file, so the split is not durable and the baseline would regrow | write each generated `pub(crate) const` into its family module; a rerun must produce an empty `git diff` over the generated modules |

The extraction marker stays compatible with the planned
`pub(crate) const NAME: &str = r#"..."#;` line because the marker text
`const NAME: &str = r#"` remains a substring; no assertion or test name changes.
Baseline: 14/14 drift tests passed before the move (measured above).

## 3. Research themes (declaration-level move, repository-native)

For each theme: what it means for this seam, the concrete failure mode, the
guardrail, and evidence.

1. **Module-evaluation side effects: does not apply (Rust, no runtime).** The
   move is compile-time constant definitions and plain `#[test]` functions; Rust
   has no import-time evaluation order for `const` items, no statics, no lazy
   initialization, no filesystem/network work at module scope. The existing tests
   are the only side effects and they stay in the same order. Guardrail: the
   covering suite is executed before and after with the same count. The
   TS-specific analogue (constructor side effects at module scope) is recorded as
   not applicable rather than inherited silently.
2. **Crate and target boundaries: stay inside the same crate, same test target
   name.** The destination is inside the same crate
   (`crates/varve-bridge/tests/wgsl_validation/`). The only boundary risk is
   Cargo's auto-discovery: moving the crate root from
   `tests/wgsl_validation.rs` to `tests/wgsl_validation/main.rs` must keep the
   target named `wgsl_validation`, or the covering command
   `cargo test -p varve-bridge --test wgsl_validation` stops resolving. An
   experiment in the worktree (scratch crate, deleted before staging) confirmed
   that Cargo auto-discovers `tests/<name>/main.rs` as test target `<name>` and
   that `mod support;` in that crate root resolves to
   `tests/wgsl_validation/support.rs` (the crate root's containing directory).
   No `[[test]]` manifest entry or `Cargo.toml` edit is needed; package
   manifests stay out of the commit.
3. **Module path and import resolution: no relative import rebase.** Rust module
   paths are crate-absolute. The two naga imports move with the shared helper to
   `support.rs`; consumers add `use crate::support::validate;`, and the crate
   root imports the nine effect constants for the meta-test. There is no depth
   rebasing, no path alias, and no side-effect import ordering. Guardrail: a
   full `cargo test` compile plus `rustfmt --check` and the byte-identity check
   (moved items are untouched apart from the recorded visibility prefixes).
4. **Raw-string and code-like text: the highest mechanical risk.** About 91% of
   the file is WGSL inside `r#"..."#` raw strings containing braces, `fn`, `if`,
   `for`, comments, and lines that begin with Rust comment syntax
   (`// ── ...`). A regex, brace-matching, or line-count cut would corrupt a
   shader string, and a mis-detected string terminator would splice two shaders
   together. Guardrail: cut only on whole top-level declaration blocks whose
   ranges were derived by tracking raw-string state (not by grepping for
   `const`/`fn`), and prove every block byte-identical in the destination
   (SEAM_SPEC proof plan). The generated effect consts are themselves produced
   by `packages/compositor/scripts/gen-wgsl-mirrors.mjs`; the file's own notice
   says "do not edit", so no WGSL byte is touched.
5. **Identity-sensitive declarations and test names.** The nine `#[test]` names
   are the test identity and the covering suite's pass count is the behavior
   proof; none may be renamed. The only non-test shared declaration is
   `validate`; it moves to `support.rs` and gains a `pub(crate)` visibility
   prefix (module plumbing, the Rust analogue of A-06's added `export`
   keywords — recorded, not hidden). No other declaration is renamed.
6. **Same-named private helpers in sibling modules.** There is exactly one helper
   (`validate`) and no per-shader helpers; the move must not create copies of it
   or duplicate the naga imports in every effect module. One home:
   `support.rs`, imported by the two modules that run tests in-file and by the
   crate root's meta-test.
7. **Dropped declarations.** `refactor-verify` cannot parse Rust (exit 2,
   measured above), so the proof is the recorded substitution: the hand inventory
   in SEAM_SPEC.md, the byte-identity check of every moved block against the
   checkpoint blob, and the unchanged 9/9 test count. A dropped `mod` line or a
   const left out of a module shows up as a compile error; a dropped test shows up
   as a lower pass count; a dropped shader const with no test would be invisible
   without the inventory check.
8. **Tracked-versus-untracked baseline policy.** The new modules are untracked
   until staged, so they are WIP-reported and never frozen by `--update`; the
   staged `audit:filesize --staged` lane (inside `pnpm verify:commit`) enforces
   the 400-line cap on them as soon as they are staged. The deleted target path
   is pruned from the baseline by `--update` because it is no longer tracked.
9. **Stale and grandfathered entries.** The target's baseline entry must leave
   entirely (the file path is deleted in this seam), not merely shrink: after the
   split no `crates/varve-bridge/tests/wgsl_validation.rs` exists. `--update` must
   produce exactly that one removal and no growth; a different stale entry or a
   grown frozen file is a stop condition, never a reason for `--force`.
10. **Concurrent worktree conflict on peer-hot files.** The baseline,
    `docs/agents/repo-map.generated.md`, and `BACKLOG_LEDGER.md` are single-writer
    surfaces. `pnpm worktree:status` shows A-07 clean and no peer is editing the
    target; `pnpm queue:status` is idle. The advisory claims path is unavailable
    in this sandbox (the claim command is not exercised by any prior seam and the
    queue lock mount is read-only), so the isolation is enforced by the worktree
    itself and by not touching other sessions' trees.
11. **Rollback.** The seam is uncommitted until the commit step. Before commit a
    failed extraction is discarded by restoring
    `crates/varve-bridge/tests/wgsl_validation.rs` from the checkpoint, deleting
    `crates/varve-bridge/tests/wgsl_validation/`, and leaving the baseline alone
    (the ratchet runs only after the extraction is green). Never reset the shared
    checkout, never revert another session. After commit but before merge, revert
    the single commit; the removed baseline entry returns with it.
12. **Rust-crate equivalents: applies to A-07 (unlike A-04).** The generic
    hazards are module registration (`mod` declarations), test-target
    discovery/name, and crate-root growth. Registration: the crate root keeps the
    complete `mod` list; a missing `mod` fails compilation, a stale one fails too.
    Growth: the new crate root is a framing file (doc header + modules + imports +
    one meta-test), far under the cap. Verification: the package test suite plus
    `cargo check -p varve-bridge` and a test-target check, not the TS seam tools
    (which exit 2 on Rust by design). This is recorded in GAP_ANALYSIS.md as the
    approved substitution for prompt 02 steps 3, 4 and 6.

## 4. Reference-tool and failure-mode analysis

Codemod/batch-refactoring tools fail here in five ways: silent skips of a
declaration; false-success reporting because the moved code compiles while a
test silently stops existing; type-check failures after automated edits;
unreviewable huge changesets; and corruption of string literals that look like
code. The existing machinery covers most of that:

- the compiler (`cargo test`, `cargo check`) fails on any missing module,
  missing import, or duplicate target;
- the 9-test covering suite fails if a test or shader is dropped or altered;
- the byte-identity inventory check against the checkpoint blob fails on any
  silent edit inside a moved block;
- `pnpm audit:filesize` + `--staged` keeps the ratchet monotone and judges the
  staged blobs only;
- `pnpm verify:commit` runs the staged-only checks (emoji, map, staged size,
  health, docs, direct staged tests);
- the A-06 precedent shows the exact seam-document and proof shape.

Risks that remain and become explicit checks in SEAM_SPEC: (a) Cargo
auto-discovery of `tests/wgsl_validation/main.rs` (verified experimentally and
by the actual covering command before/after); (b) rustfmt reordering only the
new framing lines (`mod`/`use`) — moved content must stay byte-identical, which
the identity check enforces; (c) visibility prefixes are the only allowed
inline edits (ten lines) and are enumerated; (d) no local `pnpm` queue means
`check:agent` is substituted by the same recursive tsc program, recorded as an
environment limit.

## 5. Failure modes -> guardrails

| Failure mode | Evidence | Guardrail | Owner prompt |
|---|---|---|---|
| A WGSL raw string is corrupted by a mechanical cut | 2,449/2,696 lines are raw-string payload; shader bodies contain braces and `//` lines | Cut only whole top-level blocks; byte-identity check of every block vs the checkpoint blob | 02 step 2/3 |
| A declaration is dropped or silently edited | `refactor-verify` exit 2 on Rust; a dropped const may have no per-const test | Hand inventory + partitioned byte identity + `cargo test` 9/9 | 02 step 1/3 |
| The test target stops resolving after the crate root moves | Cargo auto-discovers `tests/*/main.rs`; target name must stay `wgsl_validation` | Scratch-crate experiment + run the covering command before and after | 02 step 4 |
| A test is renamed or its assertion changed | 9 `#[test]` names are the count identity | Test count/names before == after; no test edits allowed in this seam | 02 step 4 |
| Unused/duplicate helper after the move | only `validate` is shared | One home in `support.rs`; `cargo check` warning gate; no duplicate copy | 02 step 2 |
| `mod` registration incomplete | 11 shader modules + support + main | Crate root lists every module; compile fails otherwise; inventory cross-checks | 02 step 2 |
| Baseline grows or freezes the wrong thing | A-06 precedent (958 -> 957) | `--update` once after green; diff = exactly one removed entry; `pnpm audit:filesize` exit 0 | 02 step 5 |
| New modules over 400 lines | policy hard cap | Measured per file before staging; largest moved const is 310 lines | 02 step 5/6 |
| Concurrent writer on the baseline/map/ledger | single-writer surfaces | One worktree, one writer; regenerate from staged tree; `verify:commit` | 02 step 6 |
| TS drift guards hard-code the single .rs path | 2 specs / 14 tests read the file by literal path and marker | Directory-read wiring; 14/14 before and after; assertions untouched | 02 step 4 |
| Generator recreates the god file | `gen-wgsl-mirrors.mjs` writes only the old path and appends 2,282 lines | Repoint generator at the module files; rerun must be diff-free | 02 step 2/8 |
| Queue-backed gates unavailable | `check:agent` exit 1 with EROFS on the queue lock; `pnpm install` blocked by a read-only store | Recorded environment limit; recursive tsc program run directly; everything else runs by name | GAP_ANALYSIS |
| Partial seam committed | - | Stop rule: no commit unless covering count unchanged and baseline diff exactly one removal; unmerged worktree left for review | 02 steps 5-8 |

## 6. Edge-case and gap register

| Edge case | A-07 answer | Evidence | Guardrail |
|---|---|---|---|
| Module-eval side effects | Does not apply: consts + tests, no runtime module initialization | target is test-only; no statics/lazy | test count before/after |
| Crate/target boundary | Stays in `crates/varve-bridge`; test target name must stay `wgsl_validation`; no manifest edit | Cargo auto-discovery experiment in worktree scratch crate | covering command before/after |
| Test-target layout (`tests/<name>/main.rs`) | Applies and is decided: crate root moves inside the destination directory; old file deleted in the same seam | experiment: target discovered as `wgsl_validation`; `mod support;` resolved | compile + `--test wgsl_validation` |
| Path aliases / import ordering | Does not apply; Rust crate-absolute paths | section 3.3 | `cargo test` compile |
| Raw-string / code-like text | Applies: 2,449 payload lines; WGSL comments and braces | top-level scan | whole-block cuts + byte identity |
| Overloaded/identity declarations | Does not apply (no overloads); test names are identity | 9 test fns | names unchanged; count unchanged |
| Same-named helpers in siblings | One helper only; one home in `support.rs` | section 3.6 | byte identity + compile |
| Dropped declaration | Applies: TS verifier cannot parse Rust | verifier exit 2 measured | hand inventory + byte identity + 9/9 |
| Parse failure in target/new module | Compiler is the parse gate; every module is compiled by the target | - | `cargo test`, `cargo check --tests` |
| Tracked-vs-untracked baseline | New modules WIP until staged; `--staged` lane enforces cap | policy section | `audit:filesize --staged` |
| Stale / grandfathered / slack-band entries | Target entry pruned because path is deleted; no other entry may change | baseline entry line 28 | `--update` diff reviewed |
| Baseline refuses to add or raise | Required outcome: 957 -> 956, 0 added, 0 grown | policy | `git diff .file-size-baseline.json` |
| Test-file exemption from ratchet | Test files count as source; every new module stays under the cap | policy | staged size gate |
| Generated files and exclusions | Target is hand-maintained despite the generated-shader notice; the notice is preserved, no generated file is touched | file header lines 401-402 | commit path list |
| Concurrent worktree conflict | A-07 is the only writer of the baseline/map/ledger for this seam; queue idle | worktree/queue status | one worktree, one commit |
| Rollback path | Uncommitted seam only; restore target + delete dir; baseline untouched pre-ratchet | section 3.11 | stop, report |
| Unknown/unresolved tools | `godsplit-plan` and `refactor-verify` exit 2 on Rust by design; approved substitution recorded | measured exit 2 | cargo suite + hand inventory + byte identity |
| TS drift guards / generator path coupling | Applies: 3 consumers hard-code the old single-file path (2 specs + generator) | section 2.1 | update wiring; 14/14 before/after; generator rerun diff-free |
| rustfmt touching moved content | Allowed only for framing lines; rustfmt must not change WGSL raw strings | `cargo fmt --check` vs byte identity | identity check after fmt |
| `cargo check -p varve-bridge` scope | Plain check misses the test target; add `--tests` or rely on the test run | Cargo behavior | both commands recorded |

## 7. Front-end necessity gate - not triggered

- Does the seam change what an operator sees or does in a remediation
  workbench? **No** - no workbench exists and none is in scope; the target is a
  Rust test crate.
- Does it change an API/IPC response shape consumed by the UI? **No** - the
  target is not part of any binary; no Rust API, IPC command, or TS surface is
  touched.
- Does it change error, empty, loading or permission states? **No** - code
  moves verbatim; any such change is a defect.
- Does it make the 957-entry queue harder to understand? **Not applicable** -
  the queue is the baseline, the ledger, and the report commands, not a UI.

**Verdict: no front-end work; the necessity gate does not fire; visual
validation is not triggered (no rendered output).** The covering test (9/9
before and after) plus the "no visual surface changed" statement in
SEAM_SPEC.md is the required evidence.
