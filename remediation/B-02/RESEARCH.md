# B-02 research and gap analysis — print/PDF pipeline crate-root split

Status: pre-implementation research for Batch B entry B-02. Phase 01 of the
remediation prompt sequence. No source, baseline, map, ledger, or shared doc has
been edited when this file was written.

## Resolved values

| Key | Value |
|-----|-------|
| Batch | B |
| Entry id | B-02 |
| Package | `crates/varve-print` |
| Target file | `crates/varve-print/src/lib.rs` — 6,823 lines, frozen at 6823 |
| Covering test | inline `#[cfg(test)] mod tests` in the target: lines 3893-6823 (2,931 lines), 93 `#[test]` fns; command `cargo test -p varve-print` |
| Seam | split the print/PDF pipeline crate root: options, text/font orchestration, image/colour resource embedding, plus the remaining cohesive pipeline stages, into a destination directory; `lib.rs` keeps the public entry (`export_pdf` delegating) and re-exports |
| Destination | `crates/varve-print/src/pdf/` — a destination directory counts as one seam (precedent: `packages/editor/src/menu/defs.ts` became an 11-line barrel plus 15 modules under `menu/defs/`) |
| Worktree | `.worktrees/B-02` |
| Branch | `seam/B/B-02-print-pipeline` |
| Base commit | `b6d8572e3a8b509a610feb9878f38f9cfb976b1b` (local `master`, fast-forwarded by the Lead from `67ad127cd`) |
| Expected ratchet | 954 -> 953 frozen entries; exactly one entry removed; 0 added, 0 grown |
| Ranking row | `docs/quality/agent-context-remediation-2026-10-28.md` row #3 |
| Batch order | `docs/plans/agent-infrastructure-campaign-2026-10-28.md`: "lib.rs command groups first (B-01), then print, ..." — B-02 is the second Batch B seam |

## Measured checkpoint state (worktree, before any edit)

```
$ node scripts/quality/audit-file-size.mjs --report
Scanned 6124 source files; 954 over the 400-line cap; 954 frozen in
.file-size-baseline.json; 0 violation(s); 0 untracked WIP over-cap file(s).
Excess over cap: 316710 lines. Baseline entries: 954 (0 stale).

$ grep -n 'crates/varve-print/src/lib.rs' .file-size-baseline.json
43:    "crates/varve-print/src/lib.rs": 6823,

$ wc -l crates/varve-print/src/lib.rs
6823 crates/varve-print/src/lib.rs

$ git status --short --branch
## seam/B/B-02-print-pipeline          (clean)
$ git rev-parse HEAD
b6d8572e3a8b509a610feb9878f38f9cfb976b1b
```

Crate-local frozen siblings that may not be grown, shrunk, or moved:
`cmyk.rs` 1,578, `outline.rs` 406, `resources.rs` 418, `shaper.rs` 766
(`.file-size-baseline.json` lines 42-46; the other siblings are under cap).

The target is 100 top-level items: 19 header items (10 `pub mod` declarations
including `test_fonts`, 2 `pub use` re-exports, and 7 private `use` items) and
81 declarations (7 structs, 1 enum, 1 const, 3 impls, 69 functions). The 2,931-line test module contains 93
`#[test]` functions, 14 helpers, and 3 `use` items. The non-test region is
3,802 lines including the 56-line header, so 3,746 declaration lines must leave
the crate root.

Covering baseline: `cargo test -p varve-print` — `running 198 tests`,
`test result: ok. 198 passed; 0 failed; 0 ignored` (93 target tests plus 105
tests in the untouched siblings: blend 4, cmyk 38, marks 7, outline 14,
resources 8, shaper 20, subset 13, test_fonts 1), plus 0 doc-tests.

## Destination decision (review decision, not a planner proposal)

The ranked row names three concerns — `options.rs`, `text.rs`,
`resources.rs` — but the measured inventory cannot be expressed as three
modules:

1. `crates/varve-print/src/resources.rs` is an existing 418-line frozen
   sibling ("stay in place"). A new root-level `resources.rs` is impossible,
   and adding image/colour embedding to the frozen file would grow a frozen
   entry, which the ratchet forbids.
2. Three modules at the 400-line cap can hold at most ~1,200 lines; 3,746
   declaration lines plus 2,931 test lines must leave `lib.rs` for the target
   to clear the cap, so the destination has to be a directory of cohesive
   modules (the same shape B-01 used for 7,376 -> 272 lines and A-09 used for
   1,969 -> 255).
3. `render_fills` is a single 726-line declaration, over the 350-line
   sub-split hazard threshold; it must be split into helper functions to fit a
   module. `export_pdf` is 362 lines and fits one module file with its
   imports, but not `lib.rs` alongside the re-export barrel.

Decision: destination directory `crates/varve-print/src/pdf/`, with the
ranked row's named concerns preserved as `pdf/options.rs`, `pdf/text.rs`,
and `pdf/resources.rs` (the last one inside the destination directory, since
the frozen root-level `resources.rs` stays in place). Existing siblings
`blend.rs`, `cmyk.rs`, `icc.rs`, `marks.rs`, `outline.rs`,
`profiles.rs`, `resources.rs`, `shaper.rs`, `subset.rs`, `test_fonts.rs`
are untouched. `lib.rs` keeps the crate docs, inner lint attributes, the
existing `pub mod` surface, the existing `pub use outline` / `pub use
blend` re-exports, a private `mod pdf`, the moved public names re-exported at
the same crate-root paths, and a thin `pub fn export_pdf` delegating to
`pdf::export::export_pdf`.

## Required reading (source of truth)

1. `docs/quality/agent-context-remediation-2026-10-28.md` — ranked row #3,
   Batch A/B definitions, the `menu/defs.ts` and A-08 precedents.
2. `docs/plans/agent-infrastructure-campaign-2026-10-28.md` — per-split
   protocol, worker rule, Batch B order ("then print").
3. `docs/quality/file-size-policy.md` — 400-line cap, 350-400 split target,
   shrink-only baseline, `--update`/`--force` rules, seam tooling scope
   (TypeScript/JavaScript only; Rust is verified by package tests).
4. `remediation/prompts/01-RESEARCH-AND-GAP-ANALYSIS.md`,
   `02-SEAM-EXECUTION-TEMPLATE.md` — phase contract and required artifacts.
5. `crates/varve-print/src/lib.rs` in line ranges; the sibling module list
   and test counts in the crate.
6. The crate's own tests and goldens: `crates/varve-print/fixtures/` and
   `crates/varve-print/profiles/` are compared unchanged.

## Research themes

1. **Module-evaluation side effects — applies, low risk.** The crate root has no
   runtime initialization: only `use` items, type/trait definitions, and pure
   functions. No statics, no lazy singletons, no constructors. Moving
   declarations into child modules cannot change evaluation order, but the new
   modules must move their `use` items with them and must not add a
   crate-root-side-effect. Guardrail: the partition matrix records every moved
   line; the package test suite compares PDF bytes.
2. **Rust privacy across the new module boundary — applies, planned edits.**
   Items were private in the crate root, where sibling declarations and the
   inline `mod tests` could call them without qualification. After the split,
   items called from another module or from the `pdf/tests/` tree must be
   `pub(crate)`; items that are public API stay `pub` and are re-exported from
   `lib.rs` at their old paths. These visibility prefixes are planned,
   count-limited edits, not renames; every one is recorded in the byte-identity
   matrix. Guardrail: `cargo test -p varve-print` plus the consumer crate
   (`cargo check` of the desktop crate path if needed) and the external API
   inventory (only `PdfOptions`, `export_pdf`, and the existing modules are
   used outside the crate).
3. **Path rebasing for crate-internal references — applies.** Moved code uses
   bare module names (`resources::ExportManifest`, `blend::...`) and a few
   absolute paths (`crate::cmyk::...`, `crate::profiles::...`). A shared
   `pdf/prelude.rs` re-exports the original external imports and the crate
   module aliases once; each module uses the prelude instead of duplicating
   import blocks. File-relative `super::`/absolute `crate::` specifiers are
   checked by the compiler.
4. **Declaration-boundary cuts — applies.** `render_fills` is 726 lines; a
   regex or brace-based cut risks corrupting its nested match, raw byte-string
   literals (`b"..."`), and format macros. The cut is by the inventory's
   declaration ranges from a raw-string-aware scanner, and the two large match
   arms are lifted into helper functions with explicit parameter lists.
5. **Dropped or renamed declarations — applies.** Every one of the 81 moved
   declarations and 93 tests must exist exactly once in the destination tree.
   `refactor-verify` cannot parse Rust (exit 2, see below), so the A-07 Rust
   substitution applies: a hand-built inventory plus a line-partition and
   byte-identity matrix against `git show b6d:...`, plus the package test
   suite.
6. **Byte-identical PDF output — applies.** Tests compare PDF structure and
   some byte substrings/goldens; the split must not change emitted bytes.
   Guards: `cargo test -p varve-print` before/after (198 -> 198 passed) and the
   untouched `fixtures/` and `profiles/` inputs.
7. **Frozen siblings — applies.** `resources.rs` (418), `outline.rs` (406),
   `cmyk.rs` (1,578), `shaper.rs` (766) may not grow or be moved. The new
   `pdf/resources.rs` is a different path; `lib.rs`'s image/colour
   embedding goes there. No sibling file is edited.
8. **Test relocation with unchanged names — applies.** The 93 tests and 14
   helpers move into `pdf/tests/` child modules. Test names, assertions, and
   helper bodies are preserved verbatim; only `use` preambles are re-derived
   and `#[cfg(test)] mod tests;` wiring is added to `pdf/mod.rs`. The test
   count must stay 198 and 0 failures.
9. **Planner/verifier tooling scope — applies.** Both seam tools parse
   TypeScript/JavaScript only and exit 2 on the `.rs` target (measured below).
   The A-07 Rust substitution is mandatory: inventory by hand/tooling plus the
   matrix, with `cargo test` as the covering gate.
10. **Baseline freshness and untracked WIP — applies.** The worktree is clean
    at the checkpoint; the report reads 0 untracked WIP. New modules are
    untracked until staged but are held to the cap before staging by measuring
    their worktree line counts. `--update` must remove exactly the target.
11. **Concurrent worktree conflict — applies, low.** Baseline, repo map, and
    ledger are single-writer surfaces; this session is the only writer in
    `.worktrees/B-02`. `pnpm worktree:status` shows no other validation/queue
    holder; the queue is idle.
12. **Rollback — applies.** The seam is uncommitted until step 8; a failed
    extraction is discarded inside `.worktrees/B-02` only. The main checkout's
    dirty WIP belongs to other sessions and is not touched.

## Environment limits measured on this checkpoint (substitutions)

| Limit | Measured evidence | Substitution used |
|---|---|---|
| Read-only pnpm store | `pnpm install --frozen-lockfile` -> `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK ... Read-only file system (os error 30)` | 22 `node_modules` symlinks from the main checkout plus an ignored copy of `apps/desktop/src-tauri/onnxruntime-libs` (not committed) |
| Validation queue EROFS | `pnpm check:agent` -> `EROFS: read-only file system, open '/run/user/1000/varve-validation-queue/exclusive.lock'` | direct recursive tsc program (`node node_modules/typescript/bin/tsc -p packages/*/tsconfig.json`, desktop, e2e), the same command `check:agent:raw` runs; result recorded in `SEAM_SPEC.md` |
| Seam tools are TS/JS only | `node scripts/quality/godsplit-plan.mjs crates/varve-print/src/lib.rs` -> `godsplit-plan: unsupported file extension: .rs`, exit 2; `node scripts/quality/refactor-verify.mjs --base master --target crates/varve-print/src/lib.rs --json` -> `refactor-verify: cannot parse ...: '#!' can only be used at the start of a file.`, exit 2 | A-07 Rust substitution: raw-string-aware inventory, partition/byte-identity matrix vs `git show b6d:...`, covering `cargo test -p varve-print` |

## Failure modes -> guardrails

| Failure mode | Evidence / risk here | Guardrail | Owner prompt |
|---|---|---|---|
| Silent declaration drop or rename | 81 declarations, 93 tests; TS verifier cannot parse Rust | Complete inventory; every base line 1-6823 classified exactly once; byte-identity matrix; `cargo test` 198 -> 198 | 02 Step 1/3 |
| Cut through a string/comment/raw byte literal | `render_fills` has nested `match` and `b"..."`/format macros | Cuts only at scanner-reported declaration/arm boundaries; scanner is raw-string aware | 02 Step 2 |
| Behavior change hidden in a "move" | PDF byte output is the contract | Move-only diff; helper extraction is behavior-preserving; `cargo test` before/after; fixtures/profiles unchanged | 02 Step 4 |
| Frozen sibling grows | `resources.rs` 418, `outline.rs` 406, `cmyk.rs` 1578, `shaper.rs` 766 | Destination directory; siblings untouched; baseline diff exactly one removed entry | 02 Step 5 |
| New module over cap | 3,746 declaration lines + 2,931 test lines | Measured module sizes all <= 400; `render_fills` sub-split; test files <= 400 | 01/02 |
| Partial extraction (target stays frozen) | 6,823 -> thin root required | `lib.rs` expected < 120 lines with all declarations moved; baseline entry leaves | 02 Step 5 |
| Broken external API | desktop crate uses `PdfOptions`, `export_pdf`, existing modules | Re-export every previously public root name; consumer paths unchanged | 02 Step 1 |
| Unrelated reformatting | rustfmt is available and may reflow moved lines | Preserve comments verbatim; record any rustfmt-only reflows; crate-scoped `cargo fmt --check` | 02 Step 2 |
| Baseline growth / WIP freeze | `--update` is conservative | Never `--force`, never hand-edit; diff review exactly one removed entry | 02 Step 5 |
| Stale generated surfaces | repo map is generated | `pnpm agent:map` from the staged tree; `pnpm verify:commit` | 02 Step 6 |

## Edge-case register

| Edge case | Verdict for B-02 |
|---|---|
| Module-eval side effects (statics, CSS, pools) | Does not apply: no statics/side-effect imports in this crate root. |
| Rust privacy / re-export surface | Applies: planned `pub(crate)` prefixes for cross-module callers; public names re-exported at old crate-root paths. |
| Path aliases / reference rebasing | Applies: prelude module for external imports + crate module aliases; compiler-checked. |
| Raw strings / byte strings / format macros | Applies: scanner is raw-string aware; no braces cut inside strings; `b"..."` payloads move verbatim. |
| Overloaded/identity-sensitive declarations | Applies mildly: `impl Default for PdfOptions` must stay with the type; `export_pdf` keeps its signature in `lib.rs`. |
| Same-named private helpers in siblings | Does not apply: names are unique in the crate root; no duplicate helpers are introduced. |
| Dropped declaration | Applies: covered by the full inventory + matrix; `cargo test` must collect 198. |
| Parse failure in the target/destination | Applies: `cargo check`/`cargo test` parse every module; `refactor-verify` is expected to fail with exit 2 (tool scope). |
| Tracked-vs-untracked baseline policy | Applies: worktree clean; new modules are untracked until staged but measured before staging; no WIP freeze. |
| Stale / grandfathered baseline entry | Applies: exactly `crates/varve-print/src/lib.rs` leaves; no sibling entry may leave or grow. |
| Test-file exemption | Does not apply: tests count as source; relocated test files are kept <= 400 lines. |
| Generated files/exclusions | Not applicable to this crate; the seam does not touch `vendor/` or generated tables. |
| Concurrent worktree conflict | Applies low: single writer in `.worktrees/B-02`; queue idle; shared surfaces regenerated only here. |
| Rollback | Applies: seam uncommitted until step 8; discard only within the worktree. |
| Unknown/unresolved tools | Applies: both TS tools exit 2 on Rust; substitution recorded above. |

## Reference-tool failure modes and residual risks

Codemod and batch-refactoring tools commonly fail by silently skipping files,
reporting success after a partial edit, leaving type/borrow errors behind, and
producing unreviewable changesets. Here: `refactor-verify` and
`godsplit-plan` are out of scope for `.rs`; relying on them would be a
false-success path, so the Rust substitution is mandatory. `cargo test`
prevents behavior drift, the matrix prevents silent drops, and the file-size
guard prevents accidental freezing/growth. Remaining unknowns: (a) visibility
edits are the largest planned diff after the move; they are compiler-verified
and behavior-free but must be counted; (b) the `render_fills` arm extraction
is the one planned structural edit inside a function body - the 14 view/rendering
helpers and 93 tests are the regression net; (c) rustfmt may reflow moved
lines, recorded separately from the byte-identity matrix.

## Front-end necessity gate

Verdict: **does not fire**. No operator-visible UI exists in this crate; the
seam is a Rust code move. The rendered surface is desktop print/PDF output, and
the existing crate tests plus the untouched fixture/profile goldens govern PDF
bytes; the front-end workbench prompt (03) and the visual validation prompt (04)
are not opened. Statement for `SEAM_SPEC.md`: **no visual surface changed**;
backend PDF bytes are covered by `cargo test -p varve-print`.
