# B-03 gap analysis - clipboard module split

Phase 01 output. Companion to `RESEARCH.md`; the measured evidence, failure
modes, and edge-case register live there. This file records the decisions that
close each gap before implementation, with the owner prompt.

## Measured checkpoint state

- Worktree `.worktrees/B-03`, branch `seam/B/B-03-clipboard`, clean, HEAD
  `e2cf7295b70b7bf82a95b0d85f59eff4d8844260` (local `master`, fast-forwarded
  by the Lead from `b6d8572e3` before the worktree was created).
- `node scripts/quality/audit-file-size.mjs --report`: 6,155 source files
  scanned; 953 over the 400-line cap; **953 frozen, 0 stale, 0 violations**;
  310,287 excess lines; 0 untracked WIP over-cap files.
- Target `packages/editor/src/clipboard.ts`: 1,968 lines, baseline entry
  `1968` (baseline line 132). Covering test
  `packages/editor/src/clipboard.test.ts`: 1,432 lines, frozen at 1432
  (baseline line 131), 40 tests, unchanged by this seam.
- Planner `godsplit-plan`: 92 blocks over 1,968 lines, 7 import declarations,
  hazard "target is over the 400-line cap". Verifier smoke:
  `{ok: true, baseCount: 91, presentCount: 91, missing: [], missingExports: []}`,
  exit 0.

## Gap -> action -> owner -> prompt file

| Gap | Action | Owner | Prompt file |
|---|---|---|---|
| Batch definitions/order | B-03 is the clipboard seam, third Batch B entry after B-01 (lib.rs) and B-02 (print); the campaign plan fixes Batch B order "then print, clipboard, document codec, ...". Ledger's last row is B-02 at 953 frozen, matching the checkpoint. No other queue entry is opened in this session. | This session (Lead) | 01 |
| Destination ambiguity | The ranked row names three concerns that cannot fit three capped files: 1,814 moved declaration lines must leave a 1,968-line target, so the destination is a directory `packages/editor/src/clipboard/` (one seam) with one leaf module per cohesive concern plus a thin `clipboard.ts` re-export barrel. The path `./clipboard` keeps resolving to `clipboard.ts` (file wins over the sibling directory). Recorded in `SEAM_SPEC.md`. | This session | 01 -> 02 Step 1 |
| Baseline regeneration | Single writer: this session runs `node scripts/quality/audit-file-size.mjs --update` in `.worktrees/B-03` after the split is green, no `--force`; diff must remove exactly `packages/editor/src/clipboard.ts`, 0 added, 0 grown; `pnpm audit:filesize` then exits 0 at 952. | This session | 02 Step 5 |
| Seam tooling scope | Both seam tools parse TypeScript and exit 0 on this target (unlike the B-02 Rust seam), so the standard protocol applies. The handoff's `--top 200` flag is not implemented in the checkpoint planner; use the supported no-flag invocation (full table) and record the mismatch. | This session | 01/02 |
| Declaration > 350/400 lines | No single declaration exceeds 400 lines; the largest is `parseClipboardData` at 161 lines. The split is by concern, not by size pressure inside a declaration, so no declaration body is sub-split. | This session | 02 Step 1/2 |
| Module-scope state | Two state groups must each get exactly one home: the clipboard write queue (`write.ts`) and the transfer-request/snapshot state (`transfer.ts`). The barrel exports functions only; no module re-imports the barrel (checked import graph is acyclic). | This session | 02 Step 2 |
| Import distribution | The original single import block (lines 16-47) cannot move verbatim; each new module gets the subset it uses. New relative imports point at the destination modules. Biome sorts and formats import preambles; moved declaration bodies stay verbatim. | This session | 02 Step 2/4 |
| Private-helper visibility | Helpers used across the new boundaries (`isRecord`, `base64ToBytes`, `isSvgText`, `hasRichClipboardContent`, `hydrateClipboardFonts`, `snapshotClipboardData`, `prepareClipboardFontDependencies`, validation helpers) gain `export` on their internal module only; they are not re-exported from the public barrel. Planned edit set is counted in `SEAM_SPEC.md`; no rename, no logic change. | This session | 02 Step 2/3 |
| Public API preservation | The barrel explicitly re-exports all 35 original exported names plus the two `clipboardRichText` re-exports from the original line 49. The covering test imports `./clipboard` unchanged; consumer modules (`context.tsx`, `Shell.tsx`, `actions/createActionHandlers.ts`, `shortcuts/useShortcuts.ts`, `components/Shell/ExportLayer.tsx`, `context.import.test.tsx`) compile through the unchanged path. | This session | 02 Step 1/2/4 |
| Rollback | The seam is uncommitted until step 8; a failed extraction is discarded only inside `.worktrees/B-03`. Never reset the shared main checkout and never commit a partial seam. | This session | 02 Step 8 |
| Observability | Progress is the frozen count (953 -> 952), one ledger row, the baseline diff, the verifier JSON, and the before/after test counts; there is no dashboard. | This session | 02 Step 5/7 |
| Front-end / accessibility / i18n / dark mode | Does not apply: pure TypeScript code move, no rendered UI. Verdict: the front-end necessity gate does not fire; 03/04 are not opened. | This session | 01 Section D |
| Testing sufficiency | `packages/editor/src/clipboard.test.ts` is the real covering suite: 40 jsdom tests that mock the Clipboard API/DataTransfer, round-trip parse/serialize, world-pose policy, superseded writes, gesture ownership, native fallbacks, raster-mask closure, pattern definitions, and font restore. Not covered: an end-to-end desktop copy/paste in a running Tauri build (out of scope for a pure move; the platform adapter types are unchanged and compile-checked). | This session | 02 Step 4 |
| Docs index | This entry adds only `remediation/B-03/*`, outside `docs/`; `pnpm audit:docs` does not require a `docs/README.md` row for it. The regenerated repo map and the ledger row are the only shared surfaces edited. | This session | 02 Step 6/7 |
| Concurrency | One writer in `.worktrees/B-03`; baseline/map/ledger are regenerated, never hand-merged. Claiming is advisory and not required by this entry's protocol. | This session | 02 Step 6 |
| Environment limits | Read-only pnpm store -> 22 node_modules symlinks + ignored onnxruntime-libs copy; queue EROFS -> direct tsc program substitute for `check:agent`; both recorded in `RESEARCH.md` and `SEAM_SPEC.md`. | This session | 01 environment table |
| Push/PR | Not authorized. Leave the one commit on `seam/B/B-03-clipboard` unmerged for review; do not push, merge, or prune. | Orchestrator/Lead | 02 Step 9 |
| Handoff | Re-instantiate `templates/NEXT-PROMPT.md` for the following unblocked Batch B entry (document codec) with fresh checkpoint measurements; write `NEXT_PROMPT.md` untracked at the main repo root; do not start that entry. | This session | 02 Step 10 |

## Front-end necessity gate

**No front-end work; the necessity gate does not fire.** The seam moves
TypeScript declarations only; no operator-visible surface, API response shape,
error/empty state, or remediation workbench is touched. The proof is the
unchanged 40/40 covering test result and the unavailable visual surface: no
renderer, canvas, DOM output, or style file is in the moved set. Statement for
`SEAM_SPEC.md`: no visual surface changed; visual validation is not triggered.

## Decisions resolved before implementation

1. Destination directory chosen as `packages/editor/src/clipboard/` (one seam)
   because the named concerns cannot hold 1,814 moved lines in three capped
   files and the parent must end under the cap. The existing
   `clipboardRichText.ts` stays in place.
2. Ten destination files: `mime.ts`, `types.ts`, `selection.ts`,
   `fonts.ts`, `validation.ts`, `parse.ts`, `write.ts`, `read.ts`,
   `transfer.ts` plus the `clipboard.ts` barrel; every module expected at or
   under 400 lines.
3. The barrel uses an explicit named re-export list (no `export *`), matching
   the A-05/A-04 precedent and making the export-preservation proof auditable.
4. Helper visibility promotions are the only non-move token edits besides
   import preambles and barrel wiring; they are enumerated in `SEAM_SPEC.md`
   and add no behavior.
5. No docs under `docs/` are edited; the dated remediation record and campaign
   plan are read-only for this session.

