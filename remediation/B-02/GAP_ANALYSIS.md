# B-02 gap analysis — print/PDF pipeline crate-root split

Phase 01 output. Companion to `RESEARCH.md`; the measured evidence and guardrail
table live there. This file records the decisions that close each gap before
implementation, with the owner prompt.

## Measured checkpoint state

- Worktree `.worktrees/B-02`, branch `seam/B/B-02-print-pipeline`, clean, HEAD
  `b6d8572e3a8b509a610feb9878f38f9cfb976b1b` (= local `master`, fast-forwarded
  by the Lead from `67ad127cd` before the worktree was created).
- `node scripts/quality/audit-file-size.mjs --report`: 6,124 source files
  scanned; 954 over the 400-line cap; **954 frozen, 0 stale, 0 violations**;
  316,710 excess lines; 0 untracked WIP over-cap files.
- Target `crates/varve-print/src/lib.rs`: 6,823 lines, baseline entry 6823;
  covering test is the inline `#[cfg(test)] mod tests` (lines 3893-6823,
  2,931 lines) with 93 `#[test]` fns; `cargo test -p varve-print` runs 198
  tests (198 passed, 0 failed, 0 ignored) before any edit.
- Frozen crate siblings that must not change: `cmyk.rs` 1,578,
  `outline.rs` 406, `resources.rs` 418, `shaper.rs` 766.

## Gap -> action -> owner -> prompt file

| Gap | Action | Owner | Prompt file |
|---|---|---|---|
| Batch definitions/order | B-02 is the print seam, second Batch B entry after B-01; campaign plan fixes "lib.rs command groups first (B-01), then print"; ledger's last row is B-01 at 954 frozen, matching the checkpoint. No other Batch B entry is opened in this session. | This session (Lead) | 01 |
| Destination ambiguity | The ranked row's three named modules cannot hold 6,823 lines and `src/resources.rs` already exists frozen. Decision: destination directory `crates/varve-print/src/pdf/` (one seam) with `options.rs`, `text.rs`, `resources.rs` plus one module per remaining cohesive pipeline stage; existing siblings stay untouched; `lib.rs` is a thin entry. Recorded in `SEAM_SPEC.md`. | This session | 01 -> 02 Step 1 |
| Baseline regeneration | Single writer: this session runs `node scripts/quality/audit-file-size.mjs --update` in `.worktrees/B-02` after the split is green, with no `--force`; diff must remove exactly `crates/varve-print/src/lib.rs`, 0 added, 0 grown; `pnpm audit:filesize` then exits 0 at 953. | This session | 02 Step 5 |
| Seam tooling scope | Both `godsplit-plan` (exit 2: unsupported extension `.rs`) and `refactor-verify` (exit 2: cannot parse; `--dest` must exist) do not apply to Rust. Use the A-07 Rust substitution: raw-string-aware inventory, partition/byte-identity matrix vs `git show b6d:crates/varve-print/src/lib.rs`, and `cargo test -p varve-print` as the covering gate. | This session | 01/02 (recorded caveat)
| Declaration > 350/400 lines | `render_fills` is 726 lines and cannot fit a module; sub-split its `FillIR::Image` (arm body 314 lines) and `FillIR::Pattern` (266 lines) arms into two helper functions in `pdf/fills_image.rs` / `pdf/fills_pattern.rs`, keeping the dispatcher, Solid, Gradient, and fallback in `pdf/fills.rs`. The three `continue` statements in the Pattern arm become early `return`s (same behavior). `export_pdf` is 362 lines and fits `pdf/export.rs` with its imports. | This session | 02 Step 1/2 |
| Test relocation | 93 tests + 14 helpers move under `pdf/tests/` (10 files, each <= 400 lines) and `pdf/tests/support/` (3 files); `pdf/mod.rs` declares `#[cfg(test)] mod tests;`. Test names, bodies and assertions are verbatim; `cargo test` must collect 198 and pass 198. | This session | 02 Step 3/4 |
| Public API preservation | Only `PdfOptions` and `export_pdf` are used outside the crate (desktop printing code); all previously public root names (`PdfOptions`, `embed_image`, `embed_image_with_colorspace`, `rgba_extract_alpha`, `rgba_to_rgb`, `blend_is_representable`, `unrepresented_blend_modes`, `requires_outline`, `has_non_winansi`, `export_pdf`) are re-exported at the same crate-root paths; the existing `pub mod`/`pub use` surface is unchanged. `pub(crate)` paths used only inside the crate are re-exported as `pub(crate)`. | This session | 02 Step 1/2 |
| Import/visibility edits | A `pdf/prelude.rs` re-exports the original external imports and crate-module aliases once; each moved module uses it. Items referenced across modules/tests get planned `pub(crate)` prefixes, counted in the byte-identity matrix as the only non-mechanical line edits besides the `render_fills` extraction. | This session | 02 Step 2/3 |
| Rollback | The seam is uncommitted until step 8; a failed extraction is discarded only inside `.worktrees/B-02`. Never reset the shared main checkout and never commit a partial seam. | This session | 02 Step 8 |
| Observability | Progress is the frozen count (954 -> 953), one ledger row, the baseline diff, the matrix totals, and the before/after `cargo test` counts; there is no dashboard. | This session | 02 Step 5/7 |
| Front-end / accessibility / i18n / dark mode | Does not apply: pure Rust code move, no rendered UI. Verdict: the front-end necessity gate does not fire; 03/04 are not opened. | This session | 01 Section D |
| Testing sufficiency | `cargo test -p varve-print` is the real covering suite: 93 inline pipeline tests (byte-level PDF assertions, image/pattern/CMYK/blend/text paths) plus 105 sibling-module tests, with the crate's `fixtures/` and `profiles/` goldens. Not covered: a running desktop print dialog (out of scope for a pure move; consumer paths are unchanged and compile-checked by the crate graph). The test file count stays 198/198. | This session | 02 Step 4 |
| Docs index | This entry adds only `remediation/B-02/*`, outside `docs/`; `pnpm audit:docs` does not require a `docs/README.md` row for it. The regenerated repo map and the ledger are the only shared surfaces edited. | This session | 02 Step 6/7 |
| Concurrency | One writer in `.worktrees/B-02`; `pnpm worktree:status` and `pnpm queue:status` were checked (queue idle). Baseline/map/ledger are regenerated, never hand-merged. Claiming is advisory and not required by this entry's protocol. | This session | 02 Step 6 |
| Environment limits | Read-only pnpm store -> 22 node_modules symlinks + ignored onnxruntime-libs copy; queue EROFS -> direct tsc program substitute for `check:agent`; both recorded in `RESEARCH.md` and `SEAM_SPEC.md`. | This session | 01 environment table |
| Push/PR | Not authorized. Leave the one commit on `seam/B/B-02-print-pipeline` unmerged for review; do not push, merge, or prune. | Orchestrator/Lead | 02 Step 9 |
| Handoff | Re-instantiate `templates/NEXT-PROMPT.md` for the following unblocked Batch B entry with fresh checkpoint measurements; write `NEXT_PROMPT.md` untracked at the main repo root; do not start that entry. | This session | 02 Step 10 |

## Front-end necessity gate

**No front-end work; the necessity gate does not fire.** The seam moves Rust
declarations only; no operator-visible surface, API response shape, error/empty
state, or remediation workbench is touched. The proof is the unchanged
`cargo test -p varve-print` result (198/198) and the untouched fixture/profile
goldens. Statement for `SEAM_SPEC.md`: no visual surface changed; visual
validation is not triggered.

## Decisions resolved before implementation

1. Destination directory chosen as `crates/varve-print/src/pdf/` (not the root
   `src/`) because `src/resources.rs` exists frozen and the three named
   modules cannot hold the inventory; this is a review decision, not a tool
   output.
2. `render_fills` must be sub-split; no other declaration exceeds 400 lines
   (`export_pdf` 362 fits one module).
3. A `pdf/prelude.rs` is introduced to keep import blocks from duplicating 15
   times; it is a wiring module, not behavior.
4. The 93 tests are distributed by the source's own section comments (path ops,
   fills, fills image, pattern, strokes/effects, embed/export, text, CMYK, blend)
   into 10 test files, with helpers in `pdf/tests/support/`.
5. No docs under `docs/` are edited; the dated remediation record and campaign
   plan are read-only for this session.
