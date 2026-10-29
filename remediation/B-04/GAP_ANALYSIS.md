# B-04 gap analysis - document codec split

Phase 01 output. Companion to `RESEARCH.md`; the measured evidence, failure
modes, and edge-case register live there. This file records the decisions that
close each gap before implementation, with the owner prompt.

## Measured checkpoint state

- Worktree `.worktrees/B-04`, branch `seam/B/B-04-document-codec`, clean, HEAD
  `1ee80dda64e67bf7a8f8c8a4f54a0f7677dcc9f6` (local `master`, fast-forwarded
  by the Lead from `e2cf7295b` before the worktree was created).
- `node scripts/quality/audit-file-size.mjs --report` on the clean worktree:
  6,164 source files scanned; 956 over the 400-line cap; **952 frozen, 0 stale,
  0 violations**; 308,719 excess lines; 0 untracked WIP over-cap files.
  `pnpm audit:filesize` exit 0.
- Target `packages/scene/src/documentCodec.ts`: 1,874 lines, baseline entry
  `1874` (baseline line 703). Covering test
  `packages/scene/src/documentCodec.test.ts`: 1,132 lines, frozen at 1132
  (baseline line 702), 32 tests, unchanged by this seam.
- Planner `godsplit-plan`: 30 blocks over 1,874 lines, 27 import declarations,
  hazards "target is over the 400-line cap" and "sub-split required:
  collectNodeClosure lines 1124-1627 is 504 lines on its own". Verifier smoke:
  `{ok: true, baseCount: 30, presentCount: 30, missing: [], missingExports: []}`,
  exit 0.
- Covering suite before the move: `node node_modules/vitest/vitest.mjs run
  packages/scene/src/documentCodec.test.ts` -> 1 file, 32 tests passed, exit 0.

## Gap -> action -> owner -> prompt file

| Gap | Action | Owner | Prompt file |
|---|---|---|---|
| Batch definitions/order | B-04 is the document-codec seam, fourth Batch B entry after B-01 (lib.rs), B-02 (print) and B-03 (clipboard); the campaign plan fixes Batch B order "then print, clipboard, document codec, filters, ...". The ledger's last row is B-03 at 952 frozen, matching the checkpoint. No other queue entry is opened in this session. | This session (Lead) | 01 |
| Seam text vs measured file content | The ranked row's seam text ("split migration registry from codec core and validation; one migration per module") describes a version-migration registry that is not in this file: the migration table lives in the frozen siblings `packages/scene/src/version.ts` (migrateDocumentDetailed, line 1589) and `packages/scene/src/version-migrations.ts`, which stay untouched. The codec's own "migrations" are the load/save state normalizers it applies. Review decision: split the file's measured concerns - validation layer, per-state migration/normalization pipeline, closure collection, codec core - and group one state-migration family per module. Recorded in `SEAM_SPEC.md`. | This session | 01 -> 02 Step 1 |
| Destination ambiguity | 1,874 lines cannot fit the 400-line cap, so the destination is a directory `packages/scene/src/documentCodec/` (one seam) with cohesive leaf modules plus a thin `documentCodec.ts` re-export barrel. The path `./documentCodec` keeps resolving to `documentCodec.ts` (file wins over the sibling directory). | This session | 01 -> 02 Step 1 |
| Declaration over 400 lines | `collectNodeClosure` (1124-1627, 504 lines) exceeds the cap on its own. It is sub-split into a node/dependency/pattern traversal module plus a resource-closure module plus a thin `collectNodeClosure` orchestrator, with shared state carried in one explicit collection object and the original phase order preserved. No other declaration exceeds 400 (next largest `normalizeDocument` 324). | This session | 02 Step 1/2 |
| Baseline regeneration | Single writer: this session runs `node scripts/quality/audit-file-size.mjs --update` in `.worktrees/B-04` after the split is green, no `--force`; diff must remove exactly `packages/scene/src/documentCodec.ts`, 0 added, 0 grown; `pnpm audit:filesize` then exits 0 at 951. | This session | 02 Step 5 |
| Seam tooling scope | Both seam tools parse TypeScript and exit 0 on this target, so the standard protocol applies. The handoff's `--top 200` flag is not implemented in the checkpoint planner; use the supported no-flag invocation (full table) and record the mismatch. | This session | 01/02 |
| Module-scope state | `SUPPORTED_IMAGE_MIME_TYPES`, `MAX_INLINE_ASSET_BYTES` and the `DocumentCodec` object each get exactly one home (`assetMigrations.ts`, `codec.ts`). No second copy anywhere; the barrel exports no state. | This session | 02 Step 2 |
| Import distribution | The original single import block (lines 13-71) cannot move verbatim; each new module gets the subset it uses, rebased one directory deeper. The one inline type import at line 838 is rebased to `../types`. Biome sorts and formats import preambles; moved declaration bodies stay verbatim. | This session | 02 Step 2/4 |
| Private-helper visibility | Cross-module helpers gain `export` on their internal module only (list in `SEAM_SPEC.md`); they are not re-exported from the public barrel. The closure sub-split adds new internal helper declarations. Planned edit set is counted; no rename, no logic change. | This session | 02 Step 2/3 |
| Public API preservation | The barrel explicitly re-exports all 5 original exported names (`DocumentCodec` plus the 4 types). The covering test imports `./documentCodec` unchanged; 28 importing files (including `index.ts` `export *`) compile through the unchanged path. | This session | 02 Step 1/2/4 |
| Rollback | The seam is uncommitted until step 8; a failed extraction is discarded only inside `.worktrees/B-04`. Never reset the shared main checkout and never commit a partial seam. | This session | 02 Step 8 |
| Observability | Progress is the frozen count (952 -> 951), one ledger row, the baseline diff, the verifier JSON, and the before/after test counts; there is no dashboard. | This session | 02 Step 5/7 |
| Front-end / accessibility / i18n / dark mode | Does not apply: pure TypeScript code move, no rendered UI. Verdict: the front-end necessity gate does not fire; 03/04 are not opened. | This session | 01 Section D |
| Testing sufficiency | `packages/scene/src/documentCodec.test.ts` is the real covering suite: 32 Vitest tests that round-trip documents, migrate legacy payloads, reject parent cycles, repair references, collect dependency closures, normalize image assets and geometry, and reopen current-version saves. It does not cover a desktop E2E open path; that is out of scope for a declaration move and is recorded as a residual. | This session | 02 Step 4 |
| Docs index | This entry adds only `remediation/B-04/*`, outside `docs/`; `pnpm audit:docs` does not require a `docs/README.md` row for it. The regenerated repo map and the ledger row are the only shared surfaces edited. | This session | 02 Step 6/7 |
| Concurrency | One writer in `.worktrees/B-04`; baseline/map/ledger are regenerated, never hand-merged. Claiming is advisory and not required by this entry's protocol. | This session | 02 Step 6 |
| Environment limits | Read-only pnpm store -> 22 node_modules symlinks + ignored onnxruntime-libs copy; queue EROFS -> direct tsc program substitute for `check:agent`; planner `--top` unsupported; all recorded in `RESEARCH.md` and `SEAM_SPEC.md`. | This session | 01 environment table |
| Push/PR | Not authorized. Leave the one commit on `seam/B/B-04-document-codec` unmerged for review; do not push, merge, or prune. | Orchestrator/Lead | 02 Step 9 |
| Handoff | Re-instantiate `templates/NEXT-PROMPT.md` for the following unblocked Batch B entry (filters) with fresh checkpoint measurements; write `NEXT_PROMPT.md` untracked at the main repo root; do not start that entry. | This session | 02 Step 10 |

## Front-end necessity gate

**No front-end work; the necessity gate does not fire.** The seam moves
TypeScript declarations only; no operator-visible surface, API response shape,
error/empty state, or remediation workbench is touched. The proof is the
unchanged 32/32 covering test result and the unavailable visual surface: no
renderer, canvas, DOM output, or style file is in the moved set. Statement for
`SEAM_SPEC.md`: no visual surface changed; visual validation is not triggered.

## Decisions resolved before implementation

1. Destination directory `packages/scene/src/documentCodec/` (one seam) because
   the target must end under the 400-line cap; the version-migration siblings
   stay in place.
2. Twelve destination modules plus the barrel: `types`, `validation`,
   `maskMigrations`, `assetMigrations`, `nodeMigrations`,
   `normalizeDocument`, `closureNodes`, `closureResources`, `fontManifest`,
   `closure`, `codec`, plus the thin `documentCodec.ts`; every module expected
   at or under 400 lines.
3. The barrel uses an explicit named re-export list (no `export *`), matching
   the A-05/A-04/B-03 precedent and making the export-preservation proof
   auditable.
4. `collectNodeClosure` sub-split: state in one collection object; original
   phase order (roots traversal -> dependency scan -> pattern closure ->
   resource slicing including the font manifest) preserved; the orchestrator
   returns the same `DocumentClosure` shape in the same property order.
5. Helper visibility promotions and import preambles are the only non-move
   token edits outside the sub-split; they are enumerated in `SEAM_SPEC.md`
   and add no behavior.
6. No docs under `docs/` are edited; the dated remediation record and campaign
   plan are read-only for this session.
