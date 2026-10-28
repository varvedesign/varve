# Phase 0 research — A-05 scene type aggregation seam

**Status:** research complete 2026-10-28; implementation proceeds only after
[GAP_ANALYSIS.md](GAP_ANALYSIS.md) is accepted. These documents were written in
the seam worktree before the target file was replaced; baseline update and
commit remain Lead-owned.

**Scope:** Batch A / A-05, `packages/scene/src/types.ts` (3,055 lines, frozen at
3,055, baseline line 772) to 19 modules under `packages/scene/src/types/` plus a
barrel at the original path. `packages/scene/src/index.ts` keeps `export * from
'./types'` (line 180). Reviewed plan: [SEAM_SPEC.md](SEAM_SPEC.md) and
[module-map.json](module-map.json). The move is type-only in behavior terms: 175
of 193 declarations are types; the 17 function bodies and the private const move
unchanged (section 4).

**Measured inputs (this worktree, base `b1ee0d09a`, 2026-10-28):**

- Target 3,055 lines; baseline line 772 -> `"packages/scene/src/types.ts": 3055`.
- `node scripts/quality/godsplit-plan.mjs packages/scene/src/types.ts --json`
  -> 198 blocks (193 declarations + 5 re-export statements), 2,398 declaration
  lines, 8 imports, 0 other top-level statements.
- `node scripts/quality/refactor-verify.mjs --base b1ee0d09a --target
  packages/scene/src/types.ts --json` -> `{ok: true, baseCount: 193,
  presentCount: 193, missing: [], missingExports: []}`.
- Kinds: 70 aliases, 105 interfaces, 17 functions, 1 private const
  (`CURRENT_TRACE_VERSION`); 189 exported declarations, 4 private; the five
  re-export statements add 23 names, for **212 public names**.
- Baseline pre-flight: `audit-file-size.mjs` exit 0, 959 frozen, 0 stale. The
  Lead's `--report` snapshot measured 6,031 files / 332,577 excess lines; now
  6,052 / 333,038 / 1 untracked WIP over-cap file (861-line `.scratch/
  a05-codemod.mjs`): never frozen or staged; tracked excess stays 332,577.
- Gates: `tsc -p packages/scene/tsconfig.json --noEmit` exit 0;
  `biome check packages/scene/src/types.ts` exit 0.

## 1. Planner ranges exclude doc comments: AST full-range cuts are required

`godsplit-plan.mjs` builds a block from `statement.getStart(sourceFile)` to
`statement.getEnd()` (`scripts/quality/godsplit-plan.mjs:158`); the `first doc line` column is
display only (`docFirstLine`, lines 55-64). Measured: blocks cover 2,421 lines (2,398
declarations + 23 re-export statements); 634 lines are outside every block (34
import lines, 15 docstring lines, 223 blanks, 362 comments, 0 code). AST full
ranges (`getFullStart()`..`getEnd()`, trimming only whitespace before the first
comment) cover 2,792 lines and add **394 lines**: 362 comments plus 32 blanks
inside leading trivia; 96 of 193 declarations carry leading comments (78 JSDoc,
30 section banners, 3 other). Line 109 is the banner above `ConstraintAxis`
at line 111; block 111-111 drops it.

**Failure mode:** a planner-range-only cut silently deletes 394 lines of docs
and section structure, and the name-counting verifier cannot see it.
**Guardrail:** cut by AST full range, keep comments verbatim, review the diff
for removed comment lines.

## 2. refactor-verify and `export *`: named re-exports are mandatory

The verifier's exported set comes from declaration `export` modifiers and named
export/import clauses; `export *` has no clause and contributes nothing
(`refactor-verify.mjs:124-167`, header lines 25-26). A barrel with `export *`
would report all 189 declaration exports missing. The base surface is not 189:
the five re-export statements add 23 names, for **212 total**:

| Base lines | Source | Names | Kind |
|---|---|---|---|
| 39 | `@varve/shared` | 3 | type |
| 54-66 | `./gridTypes` | 11 | type |
| 68-74 | `./gridTypes` | 5 | value |
| 76 | `./layerColor` | 2 | type |
| 78 | local re-export of names imported from `./colorManagement` | 2 | type |

The 5 grid values are `createDefaultIsometricGrid`,
`createStandardIsometricAxes`, `normaliseAngle`, `validateIsometricAxes`,
`validateIsometricGrid`. The barrel splits 212 names into `export type` (191 =
173 moved types + 18 external types) and `export` (21 = 16 moved functions + 5
grid helpers). Lead decision: base line 78 stays verbatim and the barrel keeps
its two-name `./colorManagement` type import verbatim; no from-form rewrite, and
the 60-80-line barrel estimate is superseded (measure the barrel after the real
split). The verifier is set-based: no text identity, exactly-once, kind or
extra-name checks; its 13 tests cover `export * as ns`, not `export * from`.
Identity is therefore a separate one-off AST check (GAP G3); the surface check
is `exportedNames` over the barrel versus the 212-name reference set
(`.scratch/base-export-names.json`, untracked; regenerate, do not trust alone).

## 3. verbatimModuleSyntax, isolatedModules, noUnusedLocals: import redistribution

`tsconfig.base.json` enables `isolatedModules` (line 17), `verbatimModuleSyntax`
(line 18), `noUnusedLocals` (line 27) and `noUnusedParameters` (line 28). With
imports redistributed across 19 modules these are the strongest mechanical
gate: every type reference needs `import type` (or an inline modifier), value
imports stay separate, `noUnusedLocals` fails an import left behind and tsc
fails a missing import. The barrel needs 191 type re-exports and 21 value
re-exports, so `export type` must never carry the 16 moved functions or the 5
grid helpers. The alias `OpenTypeFeatureMap as SharedOpenTypeFeatureMap` (base
lines 30-37) must survive in `typography.ts` because declaration line 1256
references the local alias.

File-relative inline type imports are a second import class: four declarations
carry five `import('./...')` specifiers — `DocumentAsset` (`./photoSource`, line
836), `ImageFillData` (`./photoSource` line 907, `./imagePerspective` line 951),
`FrameNode` (`./mockup/types`, line 2089) and `RasterLayerNode`
(`./photoSource`, line 2332). Moving them one or two directories deeper requires
rebasing to `../photoSource`, `../imagePerspective`, `../../mockup/types`,
`../../photoSource`; the referenced modules are unchanged. A missed rebase is
TS2307, so tsc catches it, but a text-only codemod can look like a pure move.
Identity consequence: 189 declarations are byte identical, and the 4 above are
byte identical apart from those five path-only specifier rewrites.

Codemod failure modes here: import omitted or left unused, wrong relative depth,
`import type` omitted or added to a value, an inline `import('./...')` left at
the old depth, type re-export via `export {}` (isolatedModules), value re-export
via `export type {}` (silent runtime surface loss). Only the compiler and the
surface check catch these; refactor-verify does not.

## 4. Type-only cycles are erased; runtime value cycles are not allowed

References among the 175 type declarations are type-only and erased under
`verbatimModuleSyntax`, so bidirectional type imports are safe and expected.
Runtime code does move: 17 function bodies plus the private
`CURRENT_TRACE_VERSION`. Measured runtime edges: `normalizeImageCropRect` calls
`clampImageCropRect` and `isFullImageCrop`; `normalizeImageFillData` calls
`normalizeImageCropRect`, `normalizeImageRotation`, `isImageFit` (all five in
`helpers.ts`); `CURRENT_TRACE_VERSION` is read by `defaultLiveTraceParams` and
`migrateLiveTraceParams` (all in `nodes/groups.ts`, const stays private); the
only value import is `normalizeImagePerspective` (line 49), used only by
`normalizeImageFillData`, which moves into `helpers.ts` with it. No function
calls another across modules, so no destination-to-destination runtime edge is
planned; the barrel only adds barrel -> module value re-export edges. Guardrail:
zero `from '../types'` imports inside destination modules; run `node
scripts/audit-architecture.mjs --cycles` after the split (madge mode exists, not
in `verify:agent`).

## 5. Public API and consumer-surface preservation

`packages/scene/src/index.ts:180` is the only projection (`export * from
'./types'`); no consumer imports a deep path. Measured with:

```bash
rg -l "from '@varve/scene'" packages apps scripts tests --glob '*.ts' --glob '*.tsx' --glob '*.mts' --glob '*.mjs' | wc -l
```

- **1,223 files / 1,589 import statements** import the `@varve/scene` entry.
- **223 files / 240 import statements** reach the root file by relative
  `./types`/`../types` (TS resolution): 217 type-only, 23 runtime, 88 tests, 1
  outside the package; **0** use a deep path.
No consumer changes, no rename, `index.ts` untouched, no export added. Package
tsc compiles only the package; the consumer gate is `pnpm check:agent` (432 s in
the record), run once by the Lead.

## 6. Baseline ratchet mechanics

`--update` refuses to freeze a new over-cap path or record growth, records
splits/deletes/renames-with-split, prunes stale entries, is deterministic, and
`--force` is forbidden (policy lines 153-191). The target becomes a small barrel,
so its entry is stale and `--update` must remove exactly one entry: added 0,
grown 0, lowered 0, 959 -> 958. New modules stay untracked and unfrozen until
staged; `pnpm verify:commit` enforces their cap via `audit-file-size --staged`.
The Lead runs `--update` in the seam worktree on the green tree, reviews the
JSON diff, and never uses `--force`.

## 7. Codemod silent-failure checklist

No committed codemod is needed; the untracked `.scratch/a05-codemod.mjs` is
scratch, not the shipped mechanism. Check fail-closed: (1) dropped doc comment
or banner, 394 lines over 96 declarations; (2) dropped declaration, 193 names,
`missing: []`; (3) duplicated declaration, invisible to set checks; (4) kind
drift, invisible to name-only checks; (5) lost export, 189 + 23 = 212,
`missingExports: []` plus surface equality; (6) extra export, compare to 212;
(7) private names re-exported, the 4 private declarations; (8) aliased import
lost or renamed; (9) inline `import('./...')` not rebased (5 specifiers/4
declarations); (10) missing or unused import, tsc; (11) wrong import/export
form, tsc plus surface check; (12) re-export blocks changed; (13) barrel
wildcard, forbidden; (14) ordering/format churn, one scoped biome pass; (15)
destination overshoot, at most 400 lines per file (preview maximum 315,
in-flight; re-measure after the split).

## 8. tsc as the covering gate, and what it cannot prove

No runtime test covers the seam: no test imports the barrel to assert module
structure, and 175 of 193 declarations are type-only. The compiler is the
primary gate: it proves every moved name is imported/exported somewhere in the
graph and that types stay assignable at consumer sites once `check:agent` runs.
Incidental runtime coverage is not seam coverage: 23 direct import statements
carry value bindings used by 6 package test files, and 5 editor test/benchmark
files import moved function values through `@varve/scene`; they would catch a
broken function body, not a wrong module identity or missing barrel name. Moving
the 17 function bodies and the const unchanged is part of the no-behavior-change
proof. Residual risks tsc cannot catch: comment loss, declaration duplication or
kind drift, an extra barrel export, a wrong-but-structurally-compatible type
origin, and consumer breakage unless `check:agent` runs. Proof stack:
refactor-verify parity, identity check, 212-name surface equality, package
tsc, `pnpm check:agent` (Lead), biome, baseline diff, cycle audit, staged
checkpoint.

## Failure modes -> guardrails

| # | Theme | Failure mode | Guardrail | Varve enforcement | A-05 |
|---|-------|--------------|-----------|-------------------|------|
| 1 | Planner | Doc comments cut off | AST full-range cut, verbatim | Review diff; no automated check | Applies (394 lines) |
| 2 | Verifier | `export *` unresolved | Named re-exports per module | refactor-verify missingExports | Applies (212) |
| 3 | Verifier | Duplicated/kind-shifted declaration | Identity check, review | None today (G3) | Applies |
| 4 | Verifier | Extra exported name | Barrel set equality vs 212 | `exportedNames` comparison | Applies |
| 5 | Imports | Inline relative specifier not rebased | Rebase 5, tsc | tsc TS2307 | Applies |
| 6 | Modules | Missing/unused import | tsc two-sided check | `tsc -p packages/scene` | Applies |
| 7 | Modules | Type/value form erosion | `export type` vs `export` split | isolatedModules + verbatimModuleSyntax | Applies (191/21) |
| 8 | Modules | Runtime cycle | No cross-module value imports; cycle audit | `audit-architecture --cycles` | Applies (low) |
| 9 | API | Consumer surface change | `index.ts` untouched; 212 equality | 1,223 consumers via `check:agent` | Applies |
| 10 | Ratchet | Update adds/grows an entry | Review JSON diff; `--force` banned | audit-file-size refusal | Applies |
| 11 | Ratchet | WIP over-cap file staged | Stage all modules, staged check | verify:commit `--staged` | Applies |
| 12 | Tests | Structural regression untested | Compiler + verifier + surface equality | tsc, refactor-verify, set check | Applies (no covering test) |

## 9. Edge-case register (A-05)

| # | Edge case | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Per-file build tags / test directives | does not apply | One tsconfig; no tests edited. |
| 2 | Module-evaluation side effects | does not apply | 206 statements = 8 imports + 5 re-exports + 193 declarations; const is a literal. |
| 3 | Doc comments and section banners | applies | 394 lines outside planner ranges; 96 declarations. |
| 4 | Aliased imports | applies | `OpenTypeFeatureMap as SharedOpenTypeFeatureMap` (30-37, declaration 1256). |
| 5 | File-relative inline type imports | applies | 5 `import('./...')` in 4 declarations (lines 836, 907, 951, 2089, 2332); rebase by depth; TS2307. |
| 6 | `export *` in barrel | applies (forbidden) | refactor-verify cannot resolve it; named re-exports required. |
| 7 | Type vs value re-exports | applies | 191 type names and 21 value names. |
| 8 | Type-only import cycles | allowed | Erased under verbatimModuleSyntax; type graph is bidirectional. |
| 9 | Runtime value-import cycles | applies (must not add) | All measured function edges are intra-module. |
| 10 | Private declarations | applies | 4 private names; tsc blind to a dropped private declaration. |
| 11 | Declaration identity/duplication | applies | Set verifier cannot detect duplicates; one-off identity check. |
| 12 | Consumer surface | applies | 1,223 files / 1,589 statements via entry; 223 / 240 direct. |
| 13 | Package boundary | does not apply | Destination stays in `packages/scene/src`; same tsconfig/entry. |
| 14 | `types.ts` file vs `types/` directory | applies (weak) | No `types/index.ts`; keep it so `./types` resolves to the barrel. |
| 15 | Baseline stale entry | applies | 3,055-line entry pruned; 959 -> 958. |
| 16 | Concurrent worktree / same-tree peer | applies | 32 worktrees; peer runs here with disjoint scope; claims overlap []. |
| 17 | Scratch WIP over-cap file | applies | `.scratch/a05-codemod.mjs` 861 lines: WIP, never staged. |
| 18 | Rollback | applies | Uncommitted seam; baseline restored by git revert, never `--force`. |

## 10. Front-end necessity gate

1. Operator-visible workbench change? **No.** No workbench exists (0 such files); a move.
2. API response shape consumed by the UI? **No.** No IPC/Tauri/store contract.
3. Error/empty/loading/permission states? **No.** No JSX/CSS/DOM access (one prose hit).
4. Makes the 959-entry queue harder to understand? **No.** Baseline/ledger are not a UI.

**Verdict: the gate does not fire.** No UI, visual baseline, accessibility, i18n
or dark-mode work belongs to A-05; the move must not change rendered output.

## 11. Gaps and blocking risks

Details and owners are in [GAP_ANALYSIS.md](GAP_ANALYSIS.md). Actionable gaps:
the identity proof needs a separate one-off AST check (G3); the A-04-specific
template and its `--top` exit 2 are a known residual outside this commit (G6);
the Lead runs `pnpm check:agent` once as the consumer gate (G8); line 78 stays
verbatim with a two-name barrel import (G13); scratch WIP must never be staged
(G22). The reviewed decomposition is unchanged: 19 modules, 193 declarations,
2,398 declaration lines, one barrel, one baseline entry removed.
