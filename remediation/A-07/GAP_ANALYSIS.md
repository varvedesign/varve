# Phase 0 gap analysis - A-07 WGSL validation split

**Status:** analysis complete 2026-10-28. A-07 is ready to execute after this
document and [RESEARCH.md](RESEARCH.md) are accepted. The baseline update and
the commit are Lead-owned; source movement starts only after
[SEAM_SPEC.md](SEAM_SPEC.md) carries the hand-completed declaration inventory.

**Inputs:** [RESEARCH.md](RESEARCH.md), [SEAM_SPEC.md](SEAM_SPEC.md), the
file-size policy, the remediation record, the campaign plan, the execution
template (prompt 02), and the worktree measured on 2026-10-28 at checkpoint
`8d1346966a7cff35c68f9ff531c58dbc100a0d29`.

**Measured state used below:**

- Target `crates/varve-bridge/tests/wgsl_validation.rs` is **2,696 lines**,
  frozen at 2,696 in `.file-size-baseline.json` (line 28); the baseline has
  **957 entries**. Tree gate: `node scripts/quality/audit-file-size.mjs`
  exit 0, "6065 source files scanned; 957 over 400 lines, all frozen ...
  (tracked content)"; `--report` adds 0 violations, 0 untracked WIP over-cap,
  327,551 excess lines, 0 stale.
- Covering Rust suite before the move: `cargo test -p varve-bridge --test
  wgsl_validation` -> **9 passed; 0 failed; 0 ignored**. The TS drift guards
  that read the same declarations -> **14 passed (5 + 9)** in 2 files.
- Worktree `.worktrees/A-07` is clean at the checkpoint on branch
  `seam/A/A-07-wgsl-validation`; `pnpm worktree:status` shows no peer editing
  the target; `pnpm queue:status` is "exclusive free; shared 0/4 slots busy;
  0 waiting". 27 unrelated entries remain dirty in the main checkout and are
  out of scope.
- Environment: `pnpm install --frozen-lockfile` fails with
  `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` ("Read-only file system"); the
  queued `pnpm check:agent` fails on the validation queue's read-only mount
  (`EROFS` on `/run/user/1000/varve-validation-queue/exclusive.lock`). The
  installed trees are symlinked from the main checkout and the recursive tsc
  program is run directly (A-06 G17 precedent). All plain `node scripts/...`
  commands, `pnpm exec biome`, and `node scripts/quality/commit-checkpoint.mjs`
  execute normally.

## Rust verification substitution (approved, recorded for prompt 02 steps 3, 4 and 6)

The two TypeScript seam tools are out of scope for Rust by policy
(`docs/quality/file-size-policy.md` "Seam tooling": "Rust seams are verified by
their package test suites instead"), and this was measured on the target:

- `node scripts/quality/godsplit-plan.mjs crates/varve-bridge/tests/wgsl_validation.rs`
  -> exit 2, "godsplit-plan: unsupported file extension: .rs" (`--top N` is
  not implemented at all: "unknown argument: --top", the A-06 G18 residual).
- `node scripts/quality/refactor-verify.mjs --base master --target
  crates/varve-bridge/tests/wgsl_validation.rs --json` -> exit 2,
  "refactor-verify: cannot parse ...: Unexpected keyword or identifier."

Neither tool is edited, and neither exit 2 is reported as a pass. The
substitution for the protocol steps is:

| Prompt 02 step | TypeScript proof | A-07 Rust proof |
|---|---|---|
| Step 3 - prove no declaration was dropped, before tests | `refactor-verify` exit 0 with `missing: []` | (a) the hand-completed 29-item inventory in SEAM_SPEC.md; (b) a byte-identity matrix of every top-level item against `git show 8d1346966:crates/varve-bridge/tests/wgsl_validation.rs` (each item present byte-identically in exactly one destination module; only the ten recorded visibility prefixes and new framing lines may differ); (c) `cargo test` compilation (a dropped/renamed referenced const or missing `mod` fails the build); (d) test count 9 = 9 and the inventory (a dropped `#[test]` would still compile, so the count and inventory are the guard) |
| Step 4 - focused tests before/after | `pnpm test:agent <spec>` | `cargo test -p varve-bridge --test wgsl_validation` before and after, 9 passed / 0 failed both times; plus `cargo check -p varve-bridge` and `cargo check -p varve-bridge --tests` (plain `cargo check` does not compile integration-test targets); plus `cargo fmt --all -- --check`; plus the two TS drift specs (14/14) because they read the moved consts |
| Step 6 - generated surfaces and staged checkpoint | `refactor-verify` + `pnpm verify:commit` | `pnpm agent:map` from the staged tree and `pnpm verify:commit` (which runs no cargo tests - the 9/9 is run explicitly on the staged tree); `audit:filesize --staged` enforces the 400-line cap on the new modules |

## Gap -> action -> owner -> prompt file

| ID | Gap | Action | Owner | Prompt file |
|----|-----|--------|-------|-------------|
| G1 | One destination directory could be read as 13 separate tasks | `crates/varve-bridge/tests/wgsl_validation/` = one seam; the family split is the design inside that destination (precedent: `menu/defs.ts` -> 11-line barrel + 15 modules; A-04, A-05, A-06) | Lead | 02 Step 1 |
| G2 | Protocol requires RESEARCH/GAP_ANALYSIS before source edits | These two documents are the gate; source work starts only after SEAM_SPEC.md exists | Lead | 01 |
| G3 | The generated block is 2,272 lines; a single const can be 309 lines | One generated const per family module (9 modules); no raw string is split; CRT 309 is the largest and every module stays under 400 | Lead | 02 Step 1/2 |
| G4 | Cargo test-target layout: crate root must move without losing the target | Move the crate root to `tests/wgsl_validation/main.rs` (Cargo auto-discovers `tests/<name>/main.rs` as target `<name>`; verified in a scratch crate) and delete the old `tests/wgsl_validation.rs` in the same commit; no manifest edit, no duplicate target | Lead | 02 Step 1/2 |
| G5 | Module registration is the Rust registration surface | `main.rs` declares all 12 modules; a missing or stale `mod` fails compilation; the hand inventory cross-checks every file | Lead | 02 Step 2 |
| G6 | Moving declarations across modules needs visibility | `fn validate` and the nine effect consts gain a `pub(crate) ` prefix (10 one-word edits, enumerated in SEAM_SPEC); no rename, no logic edit | Lead | 02 Step 2 |
| G7 | The two TS drift guards read `crates/varve-bridge/tests/wgsl_validation.rs` by literal path and search `const <NAME>: &str = r#"` in that one file (5 + 9 tests) | Update both specs to read + sort + concatenate the `.rs` modules in the destination directory; assertions, names and counts unchanged: 14/14 before and after. Harness wiring rides with the move (A-06 G7 precedent) | Lead | 02 Step 2/4 |
| G8 | `packages/compositor/scripts/gen-wgsl-mirrors.mjs` writes only the old root path; the next regeneration would recreate a >400-line root file | Repoint the generator at the family module files, writing `pub(crate) const` into each; a rerun must leave `git diff` empty over the generated modules (durability proof) | Lead | 02 Step 2/8 |
| G9 | The target is a tracked frozen entry that will be deleted | After the split the path no longer exists, so `--update` prunes its baseline entry: 957 -> 956, exactly one removed, 0 added, 0 grown; no hand edit, no `--force` | Lead | 02 Step 5 |
| G10 | New modules are untracked WIP until staged | Never frozen by `--update`; every module is measured under 400 before staging, and `audit:filesize --staged` enforces the cap in `verify:commit` | Lead | 02 Step 5/6 |
| G11 | Covering-test count must not decrease, and no test may be weakened | Rust 9/9 and TS drift 14/14 before and after; no test body or assertion edit, only the two drift files' read wiring | Lead | 02 Step 4 |
| G12 | `cargo check -p varve-bridge` does not compile integration-test targets | Record both commands: `cargo check -p varve-bridge` (crate gate) and `cargo check -p varve-bridge --tests` (test-target gate); the real proof is the 9-test run | Lead | 02 Step 4 |
| G13 | CI runs `cargo fmt --all -- --check`; biome ignores `.rs` | `cargo fmt --all -- --check` must pass; rustfmt may only reorder the new framing (`mod`/`use`) lines - the byte-identity matrix proves moved content unchanged; biome runs only on the changed non-Rust files | Lead | 02 Step 4 |
| G14 | A pure move still changes three TypeScript consumer files | Declared seam scope: the two drift specs and the generator are committed with the seam and named in SEAM_SPEC, GAP_ANALYSIS, the ledger notes and the commit body; no behavior change | Lead | 02 Step 2/8 |
| G15 | Baseline, repo map, ledger are single-writer surfaces | One worktree, one writer; `--update` once; `pnpm agent:map` from the staged tree; one ledger row; no merge, no push without authorization | Lead | 02 Steps 5-8 |
| G16 | Rollback of a move that also deletes a frozen file and ratchets the baseline | Before commit: restore the target from the checkpoint and delete the destination directory (baseline untouched until green). After commit before merge: revert the single commit; the baseline entry returns with it. Never reset the shared checkout or revert another session | Lead | 02 closeout |
| G17 | No dashboard; progress is readable from commands/ledger | Record `--report` and `--update` evidence plus one ledger row; no workbench work | Lead | 02 Step 7 |
| G18 | Front-end/workbench/a11y/visual gates could be misread as triggered | Measured answers: no rendered surface, no IPC/API shape, no error/empty/loading/permission state, no workbench; prompts 03/04 do not fire | Reviewer | 03/04 |
| G19 | The queue-backed gates cannot run in this sandbox | `check:agent` fails with EROFS on the queue lock; substitute the same recursive `tsc --noEmit --pretty false` program run directly (evidence in SEAM_SPEC pre-flight record); `verify:commit` still runs because its lanes are plain node/pnpm-exec commands | Lead | 02 Step 0/4 |
| G20 | `pnpm install --frozen-lockfile` fails on the read-only pnpm store | Symlink the main checkout's installed trees into the worktree (23 links, git-ignored paths) and record the limitation, not a blocker | Lead | 02 Step 0 |
| G21 | Documentation references to the old path | The path `crates/varve-bridge/tests/wgsl_validation.rs` ceases to exist, but existing docs references (architecture docs, dated audits) are historical/contextual and are not edited by a pure move; `remediation/A-07/` is outside `docs/`, so no `docs/README.md` row is added and `audit:docs` runs in `verify:commit` because Markdown is staged | Lead | 02 Step 6/7 |

## 1. Batch definitions, disjointness and order

Batch A (remediation record lines 68-74) is path-disjoint. A-04
(`IntelligencePanel.tsx`), A-05 (`scene/src/types.ts`), A-06
(`scripts/screenshots/product.mjs`) and A-08 (`replay-fill.test.ts`) are
complete and recorded; A-07 is the next queued Batch A entry (campaign plan
Batch A table, "shader-family modules plus shared fixtures"). A-09 is the perf
runner and is untouched here. This session executes exactly one entry.

## 2. Baseline regeneration

The seam worker (Lead) runs `node scripts/quality/audit-file-size.mjs --update`
once in `.worktrees/A-07` after the split is green. The diff must remove
exactly `crates/varve-bridge/tests/wgsl_validation.rs` and change no other
entry (0 added, 0 grown); 957 -> **956** frozen entries; `pnpm audit:filesize`
then exits 0. The update is never run before the split and never with
`--force`. After a future merge the orchestrator regenerates on the merged
tree.

## 3. Seam tooling and the Rust substitution

`godsplit-plan` gives ranges and hazards but never destinations, and it does
not parse Rust (exit 2 measured); the declaration inventory and module map in
SEAM_SPEC.md are the hand-built, reviewed decision. `refactor-verify` proves
declaration preservation for TS/JS only (exit 2 measured on .rs); the approved
substitution table above is the proof stack. Neither tool is edited and no
suppressed check is claimed as a pass.

## 4. Generated-mirror durability and drift-test wiring

The nine effect-kernel consts are generated from
`packages/compositor/src/webgpu/effects/kernels/*.ts` by
`packages/compositor/scripts/gen-wgsl-mirrors.mjs`, and the mirror must stay
drift-guarded. The seam therefore (a) repoints the generator at the family
module files and requires a diff-free rerun, and (b) repoints the two drift
specs at the module directory with unchanged assertions and test counts. This
is harness wiring, not a behavior change; the WGSL bytes are not edited by hand.

## 5. Rollback

Discard the uncommitted seam by restoring
`crates/varve-bridge/tests/wgsl_validation.rs` from the checkpoint, deleting
`crates/varve-bridge/tests/wgsl_validation/`, and reverting the three
compositor files; the baseline is untouched until the ratchet runs. If the
ratchet cannot go down, stop and report before committing. Never reset the
shared checkout or touch another session.

## 6. Observability

Progress is measured by `--report` (frozen count, excess lines, WIP), the one
ledger row, and the monotone ratchet. There is no dashboard and none is in
scope.

## 7. Testing sufficiency

The Rust suite is the real gate for these declarations: it compiles all 17 WGSL
mirrors through naga v30 offline and validates every one with
`Validator::new(ValidationFlags::all(), Capabilities::all())`; 9/9 before and
after is the behavior proof. The two TS drift suites prove the Rust mirrors
still equal the TypeScript sources of truth (14/14). What is not covered, by
design: no GPU/WebGPU runtime execution, no browser shader compilation, no
visual rendering - the target is an offline compile/validation gate. That is
sufficient for a pure declaration move.

## 8. Docs index

The seam adds only `remediation/A-07/` (outside `docs/`), so no
`docs/README.md` row is needed; `pnpm audit:docs` still runs inside
`verify:commit` because Markdown files are staged. Dated docs that mention the
old path are not edited (single-writer dated records; the path reference is
historical), and the root path move is recorded in SEAM_SPEC.md.

## Front-end necessity gate - not triggered

- Does the seam change what an operator sees or does in a remediation
  workbench? **No** - no workbench exists and none is in scope.
- Does it change an API/IPC response shape consumed by the UI? **No** - the
  target is a test-only Rust crate with no binary, no IPC command and no TS
  runtime surface; the only TS changes are test-harness and generator paths.
- Does it change error, empty, loading or permission states? **No** - code
  moves verbatim; any such change is a defect.
- Does it make the 957-entry queue harder to understand? **Not applicable** -
  the queue is the baseline, the ledger and the report commands, not a UI.

**Verdict: no front-end work; the necessity gate does not fire; visual
validation is not triggered (no rendered output).** Evidence: 9/9 Rust tests
and 14/14 TS drift tests before and after, plus the "no visual surface changed"
statement in SEAM_SPEC.md.
