# B-04 research and gap analysis - document codec split

Status: pre-implementation research for Batch B entry B-04. Phase 01 of the
remediation prompt sequence. No source, baseline, map, ledger, or shared doc has
been edited when this file was written. Companion: `GAP_ANALYSIS.md`; the
declaration inventory, sub-split decision, and destination map live in
`SEAM_SPEC.md`.

## Resolved values

| Key | Value |
|-----|-------|
| Batch | B |
| Entry id | B-04 |
| Package | `packages/scene` |
| Target file | `packages/scene/src/documentCodec.ts` - 1,874 lines, frozen at 1874 |
| Covering test | `packages/scene/src/documentCodec.test.ts` - 1,132 lines, 32 tests, frozen at 1132 |
| Seam | split the codec core and the validation layer from the document normalization pipeline (the load/save state migrations); one state-migration family per module; keep the current module path as the thin entry |
| Destination | `packages/scene/src/documentCodec/` - a destination directory counts as one seam (precedent: `packages/editor/src/menu/defs.ts` became an 11-line barrel plus 15 modules under `menu/defs/`) |
| Worktree | `.worktrees/B-04` |
| Branch | `seam/B/B-04-document-codec` |
| Base commit | `1ee80dda64e67bf7a8f8c8a4f54a0f7677dcc9f6` (local `master`, fast-forwarded by the Lead from `e2cf7295b`) |
| Expected ratchet | 952 -> 951 frozen entries; exactly one entry removed; 0 added, 0 grown |
| Ranking row | `docs/quality/agent-context-remediation-2026-10-28.md` row #25 |
| Batch order | `docs/plans/agent-infrastructure-campaign-2026-10-28.md`: "lib.rs command groups first (B-01), then print, clipboard, document codec, filters, ..." - B-04 is the fourth Batch B seam |

## Measured checkpoint state (worktree, before any edit)

```
$ git rev-parse HEAD
1ee80dda64e67bf7a8f8c8a4f54a0f7677dcc9f6
$ git log -1 --format=%s
refactor(editor): split clipboard entry into clipboard/ modules (Batch B/B-03)
$ git status --porcelain=v1 -b
## seam/B/B-04-document-codec

$ node scripts/quality/audit-file-size.mjs --report
Scanned 6164 source files; 952 over the 400-line cap; 952 frozen in
.file-size-baseline.json; 0 violation(s); 0 untracked WIP over-cap file(s).
Excess over cap: 308719 lines. Baseline entries: 952 (0 stale).

$ pnpm audit:filesize
File-size budget OK: 6164 source files scanned; 952 over 400 lines, all frozen
in .file-size-baseline.json (tracked content). (exit 0)

$ grep -n 'packages/scene/src/documentCodec' .file-size-baseline.json
702:    "packages/scene/src/documentCodec.test.ts": 1132,
703:    "packages/scene/src/documentCodec.ts": 1874,

$ wc -l packages/scene/src/documentCodec.ts packages/scene/src/documentCodec.test.ts
  1874 packages/scene/src/documentCodec.ts
  1132 packages/scene/src/documentCodec.test.ts
```

The checkpoint state matches the handoff exactly: 6,164 scanned, 952 frozen,
0 stale, 0 WIP, 308,719 excess lines. The checkpoint handoff is authoritative
over the older counts in the remediation doc and the campaign plan.

Measured inconsistency, recorded rather than hidden: the committed B-03 ledger
row reports "6,168 scanned" for the same 952-entry / 308,719-excess state. The
B-03 SEAM_SPEC says its split executor was scratch and not committed; a scratch
source file left in that worktree is counted by the scan but is not an
over-cap WIP entry. The clean B-04 worktree reads 6,164 on the checkpoint
commit, so 6,164 is used here and in the handoff.

The target's frozen sibling is `packages/scene/src/documentCodec.test.ts` at
1132: the covering test is frozen and may not grow. The version-migration table
is not in this file: it lives in the frozen siblings
`packages/scene/src/version.ts` (1691, baseline line 771) and
`packages/scene/src/version-migrations.ts` (877, baseline line 769), which stay
in place untouched.

## Planner and verifier pre-flight

```
$ node scripts/quality/godsplit-plan.mjs packages/scene/src/documentCodec.ts
Lines: 1874 | imports: 27 | blocks: 30
(30-row block table: lines, range, kind, name, export, first doc line)
Hazards:
- target is over the 400-line cap: the split must leave every result at or under it
- sub-split required: collectNodeClosure lines 1124-1627 is 504 lines on its own

$ node scripts/quality/refactor-verify.mjs --base master \
    --target packages/scene/src/documentCodec.ts --json
{
  "ok": true,
  "baseCount": 30,
  "presentCount": 30,
  "missing": [],
  "missingExports": []
}
```

Both tools exit 0 and parse the TypeScript target, so the standard seam
protocol applies; the A-07/B-02 Rust substitution does not.

The handoff names `--top 200`, but the checkpoint planner accepts only
`<file> [--json]`: `--top 200` prints usage and exits 2 (measured). The
supported no-flag invocation prints the full 30-block table and exits 0, which
satisfies the protocol's intent (blocks, ranges, export status, first doc line,
hazards). Recorded as a tool-flag mismatch, not a blocker.

## Required reading (source of truth)

1. `docs/quality/agent-context-remediation-2026-10-28.md` - ranked row #25,
   Batch B definition, the `menu/defs.ts` and A-04/A-08 precedents.
2. `docs/plans/agent-infrastructure-campaign-2026-10-28.md` - per-split task
   protocol, worker rule, Batch B order ("then print, clipboard, document
   codec, filters, ...").
3. `docs/quality/file-size-policy.md` - 400-line cap, 350-400 split target,
   shrink-only baseline, `--update`/`--force` rules, seam-tooling scope.
4. `remediation/prompts/01-RESEARCH-AND-GAP-ANALYSIS.md`,
   `02-SEAM-EXECUTION-TEMPLATE.md` - phase contract and required artifacts.
5. `packages/scene/src/documentCodec.ts` in line ranges (eight ranges, 1-1874);
   never one whole-file read.
6. The covering test `packages/scene/src/documentCodec.test.ts` imports and
   `describe` structure; the test body is frozen and not edited.
7. The consumers of the module's exports: `packages/scene/src/index.ts`
   (`export * from './documentCodec'`), `packages/scene/src/newDocument.ts`
   (`DocumentCodec`), and the 27 sibling test files that import the same path.

## Research themes

1. **Module-evaluation side effects - applies, low risk.** The target has no
   module-scope mutable state, no side-effect import, no worker pool, and no
   `navigator`/`document` access. Its only module-scope values are
   `MAX_INLINE_ASSET_BYTES` (line 424), the `SUPPORTED_IMAGE_MIME_TYPES` Set
   (line 426), and the `DocumentCodec` object literal (line 1707). They move to
   exactly one module each (`assetMigrations.ts`, `codec.ts`); no other module
   may construct a second copy. The `DocumentCodec` object must stay one object
   and keep `normalize`/`collectNodeClosure` bound to the same functions, which
   an import of the single declaration preserves.
2. **tsconfig project boundaries and package exports - applies, no change.**
   The destination stays inside `packages/scene/src`, so it stays in the same
   tsconfig project (`packages/scene/tsconfig.json`, `include: ["src"]`,
   `composite: false`) and the same published entry surface (`@varve/scene`
   exports only `.`, `./export`, `./tokens`; `src/index.ts` re-exports the
   codec with `export *`). No new package entry point, no cross-package import,
   no tsconfig edit.
3. **Path aliases and import ordering - applies.** The original file's 27
   imports are relative (`./assets`, `./document`, ...) plus no aliases. From
   `documentCodec/` every sibling specifier is rebased one level (`./assets` ->
   `../assets`, `./types` -> `../types`), new internal imports are `./types`,
   `./validation`, `./maskMigrations`, `./assetMigrations`,
   `./nodeMigrations`, `./normalizeDocument`, `./closureNodes`,
   `./closureResources`, `./fontManifest`, `./closure`, `./codec`, and the
   one inline type import at line 838 (`import('./types').Stroke`) becomes
   `import('../types').Stroke`. Biome orders and formats import preambles only.
4. **Template literals, regexes and code-like text - applies.** The file is
   dense with warning copy, dotted path strings built from template literals,
   and regexes that must move byte-verbatim: `/^n(\d+)(?:_[0-9a-f]+)?$/`
   (line 230), `/^[a-f0-9]{16}$/` (line 285), and `/\{([^}]+)\}/g` (line
   1438), plus the `\u0000` font-key separator in two templates (lines 1656,
   1690). Cuts are made on planner declaration boundaries only, never by brace
   or line counting.
5. **Identity-sensitive declarations - applies.** The module exports 5 names:
   the `DocumentCodec` const object and the 4 types `DocumentCodecWarning`,
   `DocumentDecodeResult`, `DocumentNormalizeResult`, `DocumentClosure`.
   `src/index.ts` re-exports all of them through `export *`; `newDocument.ts`
   and 27 test files import the path. The path keeps resolving to the same
   module file (`documentCodec.ts` wins over the sibling directory) and the
   barrel re-exports every original name explicitly. No declaration is renamed.
6. **Same-named private helpers - applies, planned visibility only.** Helpers
   used across the new module boundaries gain an `export` keyword on their
   internal module only: `warning`, `isRecord`,
   `malformedLegacyBackgroundRemovalWarnings`, `maxNumericNodeId`,
   `unrecognizedVersionWarnings`, `validateShape`,
   `validateRuntimeCollections` (validation); `hasImageFill`,
   `sanitizeRasterMaskState`, `sanitizeStructuralMaskState`
   (maskMigrations); `normalizeInlineImageFills`, `sanitizeImageAssetState`,
   `normalizeImageFillGeometry`, `sanitizeIconAssetState`
   (assetMigrations); `validatePhotoSourceState`,
   `validateRetouchProvenanceState`, `normalizeRasterTiles`
   (nodeMigrations); `normalizeDocument`; `collectClosureNodes`;
   `collectClosureResources`; `collectFontManifestClosure`;
   `collectNodeClosure`; `DocumentCodec`. Each helper has exactly one home,
   the barrel does not re-export internals, and no declaration is renamed.
7. **Dropped declarations - applies.** The base set is 30 declarations
   (refactor-verify `baseCount: 30`); the complete inventory is in
   `SEAM_SPEC.md`. The 504-line `collectNodeClosure` must be sub-split to obey
   the 400-line cap; the sub-split adds internal helper declarations but keeps
   `collectNodeClosure` present and behavior-identical. The verifier must exit 0
   before tests.
8. **Tracked-versus-untracked baseline policy - applies.** The worktree is
   clean; new destination modules are untracked until staged but are measured
   before staging. `--update` never freezes WIP; the staged-blob check inside
   `pnpm verify:commit` judges each new module against the 400-line cap.
9. **Stale or grandfathered entries - applies.** Exactly
   `packages/scene/src/documentCodec.ts` must leave the baseline (1874 ->
   gone); no entry may be added or grown. `documentCodec.test.ts` (frozen at
   1132) is not edited and therefore does not grow, and 0 entries are stale at
   the checkpoint. `--update --force` is forbidden.
10. **Concurrent worktree conflict - applies, low.** The baseline, repo map,
    and ledger are single-writer surfaces; this session is the only writer in
    `.worktrees/B-04`. `pnpm worktree:status` measured 41 worktrees (19 dirty,
    0 unmerged), so other sessions are live; `pnpm claims status` measured
    "no matching claims". Claims are advisory and not required by this entry's
    protocol; the worktree-per-task and one-writer rules are the controls.
11. **Rollback - applies.** The seam is uncommitted until the final step; a
    failed extraction is discarded only inside `.worktrees/B-04`. The shared
    main checkout's dirty WIP belongs to other sessions and is never reset.
12. **Rust-crate equivalents - does not apply.** This is a TypeScript module
    seam; both seam tools parse it (exit 0 above), `audit:ipc` and cargo are
    untouched, and there is no `mod`/`generate_handler!` wiring to verify.

## Environment limits measured on this checkpoint (substitutions)

| Limit | Measured evidence | Substitution used |
|---|---|---|
| Read-only pnpm store | `cd .worktrees/B-04 && pnpm install --frozen-lockfile` -> `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK ... Read-only file system (os error 30)`, exit 1 | 22 `node_modules` symlinks from the main checkout plus an ignored copy of `apps/desktop/src-tauri/onnxruntime-libs` (not committed) |
| Validation queue EROFS | `pnpm check:agent` -> `EROFS: read-only file system, open '/run/user/1000/varve-validation-queue/exclusive.lock'`, exit 1 | direct recursive tsc program (the same three stages `check:agent:raw` runs: `packages/*`, `apps/desktop`, `tests/e2e`), run directly through `node node_modules/typescript/bin/tsc` to avoid the pnpm pre-script install attempt |
| Planner `--top` mismatch | `godsplit-plan.mjs <file> --top 200` -> usage text, exit 2 | supported no-flag full-table invocation (exit 0); recorded above |
| Desktop tsc pre-existing diagnostics | measured baseline direct stage: desktop exit 2 with 228 `error TS` diagnostics caused by the main checkout's stale `@varve` resolution into other worktrees (same as B-02/B-03) | compare the identical baseline/after diagnostic list; packages stage must stay 0 fail, e2e 0 |

## Failure modes -> guardrails

| Failure mode | Evidence / risk here | Guardrail | Owner prompt |
|---|---|---|---|
| Silent declaration drop or rename | 30 base declarations; a cut script can skip a block | Complete inventory; range partition of lines 1-1874 before writing; `refactor-verify` exit 0 before tests; biome then re-verify | 02 Step 1/3 |
| Sub-split changes behavior | `collectNodeClosure` is 504 lines and must be split; the traversal/dependency/pattern phases share mutable state | State carried in one explicit collection object; phase order (visit roots -> dependency scan -> pattern closure) preserved; moved bodies kept line-identical through identifier-preserving destructuring; covering suite 32/32 before and after | 02 Step 2/3 |
| Second copy of module-scope state | `SUPPORTED_IMAGE_MIME_TYPES`, `MAX_INLINE_ASSET_BYTES`, `DocumentCodec` object | One home per value; no re-definition anywhere; barrel exports functions/types only | 02 Step 2 |
| Public API drift | `export * from './documentCodec'` makes 5 names public; 28 importing files | Barrel with explicit named re-exports of all 5 original names; no internal helper exported from the barrel | 02 Step 1/2 |
| Cut through a string/regex/comment | warning copy, dotted paths, n-id/checksum/alias regexes, `\u0000` keys | Cut only at planner declaration boundaries; moved ranges copied verbatim; independent line-identity check | 02 Step 2/3 |
| Behavior change hidden in a move | codec is the persistence boundary (save/reopen data loss surface) | Move-only diff; 32/32 covering tests before and after; packages tsc; no logic edits beyond the declared sub-split | 02 Step 4 |
| New module over cap | ~1,800 declaration lines redistribute into 12 files | Destination map keeps every module <= 400 (target ~350); measured before staging | 01/02 |
| Partial extraction (target stays frozen) | 1,874 lines must leave; path must stay a thin entry | Barrel expected ~20 lines; baseline entry removed; report no longer lists the target | 02 Step 5 |
| Frozen covering test grows | `documentCodec.test.ts` frozen at 1132 | Do not edit the test; staging check rejects growth | 02 Step 4 |
| Baseline growth / WIP freeze | `--update` conservative | Never `--force`, never hand-edit; diff exactly one removed entry; `pnpm audit:filesize` green | 02 Step 5 |
| Stale generated surfaces | repo map is generated from the staged tree | `pnpm agent:map` after staging; `pnpm verify:commit` staged-only | 02 Step 6 |

## Reference-tool failure-mode analysis

Codemod-style refactors fail by silently skipping a declaration, reporting
success after a partial edit, leaving the tree type-broken, and producing an
unreviewable changeset. Existing machinery already prevents most of that here:

- `refactor-verify` is an independent AST check on the base/target/destination
  union; it exits 1 on a missing declaration or exported name, and this session
  runs it before tests and again after biome.
- The covering Vitest suite (32 tests) exercises the persistence contract:
  round-trips, malformed-reference repair, cycle rejection, legacy migration,
  closure collection, image asset normalization, geometry normalization, and
  current-version reopen.
- The direct recursive tsc substitute type-checks every package (plus desktop
  and e2e) after the move.
- `pnpm audit:filesize` is shrink-only and `--update` refuses growth, so a
  partial split cannot silently reduce the ratchet.
- `pnpm verify:commit` judges only the staged tree (emoji, map, staged size,
  health, docs, staged tests).

Residual risks that stay explicit checks in `SEAM_SPEC.md`: (a) the
`collectNodeClosure` sub-split is the only structural edit, so its phase order
and shared state are reviewed line by line and covered by the closure tests;
(b) helper visibility promotion is a planned edit set that must be counted (it
changes no behavior); (c) the new directory/file resolution for
`./documentCodec` (file wins over directory) is validated by the unchanged test
imports and the tsc stages; (d) desktop tsc is already red from a pre-existing
environment resolution defect, so the comparison is diagnostic-list equality,
not exit 0.

## Edge-case register

| Edge case | Verdict for B-04 |
|---|---|
| Module-eval side effects (state, CSS, pools) | Applies low: one Set, two numeric constants, one object literal; single home each; no side-effect imports. |
| tsconfig project boundaries / package entry points | Applies, no change: destination stays inside `packages/scene/src`; `@varve/scene` exports untouched. |
| Path aliases and import ordering | Applies: all specifiers rebased one level; inline `import('./types')` rebased; biome sorts only preambles. |
| Template-literal / regex / code-like text | Applies: warning copy, dotted paths, three regexes, `\u0000` font keys; cuts on declaration boundaries only. |
| Overloaded / identity-sensitive declarations | Applies: 5 exported names; same path, explicit re-export list, no renames; `DocumentCodec` object identity preserved. |
| Same-named private helpers in sibling modules | Applies, planned: cross-module helpers gain internal `export`; one home each; not added to the public barrel; new closure helpers are new declarations, not copies. |
| Dropped declaration | Applies: 30/30 base declarations must survive; refactor-verify exit 0 before tests. |
| Parse failure in the target or destination | Applies: planner and verifier parse the target today (exit 0); tsc parses every new module. |
| Tracked-vs-untracked baseline policy | Applies: clean worktree; new modules untracked until staging but measured first; no WIP freeze. |
| Stale / grandfathered / slack-band baseline entry | Applies: exactly the `documentCodec.ts` entry leaves; the frozen covering test is not edited; 0 added, 0 grown. |
| Test-file exemption from the ratchet | Does not apply: tests count as source; the covering test is frozen and untouched. |
| Generated files and exclusions | Not applicable: no `vendor/**` or generated-table path is touched. |
| Concurrent worktree conflict on peer-hot files | Applies low: single writer in `.worktrees/B-04`; shared surfaces regenerated, never hand-merged. |
| Rollback path | Applies: uncommitted seam, discard only this worktree's changes; never reset the shared checkout. |
| Unknown / unresolved tools | Resolved: planner and verifier parse the target (exit 0); planner `--top` flag mismatch recorded. |

## Front-end necessity gate

Verdict: **does not fire**. The seam is a pure TypeScript code move inside
`packages/scene/src`; it renders nothing, changes no API response shape, no
error/empty/loading state, and no remediation workbench exists. The proof is
the unchanged covering suite: `packages/scene/src/documentCodec.test.ts`,
32 tests, run before and after the move with the identical pass count and 0
failures. Statement for `SEAM_SPEC.md`: no visual surface changed; visual
validation is not triggered, so prompts 03 and 04 are not opened.
