# B-03 research and gap analysis - clipboard entry split

Status: pre-implementation research for Batch B entry B-03. Phase 01 of the
remediation prompt sequence. No source, baseline, map, ledger, or shared doc has
been edited when this file was written. Companion: `GAP_ANALYSIS.md`; the
declaration inventory and destination decision live in `SEAM_SPEC.md`.

## Resolved values

| Key | Value |
|-----|-------|
| Batch | B |
| Entry id | B-03 |
| Package | `packages/editor` |
| Target file | `packages/editor/src/clipboard.ts` - 1,968 lines, frozen at 1968 |
| Covering test | `packages/editor/src/clipboard.test.ts` - 1,432 lines, 40 tests |
| Seam | split MIME serializers (varve/legacy/web), clipboard parsing, and transfer-request/snapshot state into cohesive modules; keep the current module path as the thin entry |
| Destination | `packages/editor/src/clipboard/` - a destination directory counts as one seam (precedent: `packages/editor/src/menu/defs.ts` became an 11-line barrel plus 15 modules under `menu/defs/`) |
| Worktree | `.worktrees/B-03` |
| Branch | `seam/B/B-03-clipboard` |
| Base commit | `e2cf7295b70b7bf82a95b0d85f59eff4d8844260` (local `master`, fast-forwarded by the Lead from `b6d8572e3`) |
| Expected ratchet | 953 -> 952 frozen entries; exactly one entry removed; 0 added, 0 grown |
| Ranking row | `docs/quality/agent-context-remediation-2026-10-28.md` row #22 |
| Batch order | `docs/plans/agent-infrastructure-campaign-2026-10-28.md`: "lib.rs command groups first (B-01), then print, clipboard, document codec, ..." - B-03 is the third Batch B seam |

## Measured checkpoint state (worktree, before any edit)

```
$ git rev-parse HEAD
e2cf7295b70b7bf82a95b0d85f59eff4d8844260
$ git log -1 --format=%s
refactor(print): split PDF pipeline crate root into pdf/ modules (Batch B/B-02)
$ git status --porcelain=v1 -b
## seam/B/B-03-clipboard

$ node scripts/quality/audit-file-size.mjs --report
Scanned 6155 source files; 953 over the 400-line cap; 953 frozen in
.file-size-baseline.json; 0 violation(s); 0 untracked WIP over-cap file(s).
Excess over cap: 310287 lines. Baseline entries: 953 (0 stale).

$ grep -n 'packages/editor/src/clipboard' .file-size-baseline.json
131:    "packages/editor/src/clipboard.test.ts": 1432,
132:    "packages/editor/src/clipboard.ts": 1968,

$ wc -l packages/editor/src/clipboard.ts packages/editor/src/clipboard.test.ts \
         packages/editor/src/clipboardRichText.ts
  1968 packages/editor/src/clipboard.ts
  1432 packages/editor/src/clipboard.test.ts
   181 packages/editor/src/clipboardRichText.ts
```

`pnpm audit:filesize` on the clean worktree: exit 0, "File-size budget OK:
6155 source files scanned; 953 over 400 lines, all frozen ... (tracked
content)." The checkpoint state matches the handoff exactly: 6,155 scanned,
953 over cap, 953 frozen, 310,287 excess lines, 0 stale, 0 WIP.

The target's frozen sibling is `packages/editor/src/clipboard.test.ts` at
1432: the covering test is frozen and may not grow. `clipboardRichText.ts`
(181 lines) is out of scope and stays in place; the barrel keeps re-exporting
its two public names from the original line 49.

## Planner and verifier pre-flight

```
$ node scripts/quality/godsplit-plan.mjs packages/editor/src/clipboard.ts
Lines: 1968 | imports: 7 | blocks: 92
...
Hazards:
- target is over the 400-line cap: the split must leave every result at or under it

$ node scripts/quality/refactor-verify.mjs --base master \
    --target packages/editor/src/clipboard.ts --json
{
  "ok": true,
  "baseCount": 91,
  "presentCount": 91,
  "missing": [],
  "missingExports": []
}
```

Both tools exit 0 and parse the TypeScript target, so the standard seam
protocol applies; the A-07/B-02 Rust substitution does not.

Measured handoff/tool discrepancy: the handoff's command reference and step 4
name `--top 200`, but the checkpoint planner accepts only `<file> [--json]`
(`--help`/no arguments print usage); `--top` prints "unknown argument: --top"
and exits 2. The supported invocation (no flag, full table) exits 0 and prints
all 92 blocks, which satisfies the protocol's intent (blocks, ranges, export
status, first doc line, hazards). Recorded here rather than treated as a
blocker because the planner's actual output is the required evidence and no
gate is red.

## Required reading (source of truth)

1. `docs/quality/agent-context-remediation-2026-10-28.md` - ranked row #22,
   Batch B definition, the `menu/defs.ts` and A-04/A-08 precedents.
2. `docs/plans/agent-infrastructure-campaign-2026-10-28.md` - per-split task
   protocol, worker rule, Batch B order ("then print, clipboard, document
   codec, ...").
3. `docs/quality/file-size-policy.md` - 400-line cap, 350-400 split target,
   shrink-only baseline, `--update`/`--force` rules, seam-tooling scope.
4. `remediation/prompts/01-RESEARCH-AND-GAP-ANALYSIS.md`,
   `02-SEAM-EXECUTION-TEMPLATE.md` - phase contract and required artifacts.
5. `packages/editor/src/clipboard.ts` in line ranges (eight ranges, 1-1968);
   never one whole-file read.
6. The covering test `packages/editor/src/clipboard.test.ts` imports and
   `describe`/mock structure; the test body is frozen and not edited.
7. The consumers of the module's exports: `context.tsx`, `Shell.tsx`,
   `actions/createActionHandlers.ts`, `shortcuts/useShortcuts.ts`,
   `components/Shell/ExportLayer.tsx`, `context.import.test.tsx` (plus
   unrelated `packages/help` clipboard-copy content, which is not this
   module).

## Research themes

1. **Module-evaluation side effects - applies, low risk.** The target has five
   module-scope mutable state groups: the write queue (`clipboardWriteTail`
   `Promise.resolve()` and `latestClipboardWrite` at lines 1027-1028) and the
   transfer-request/snapshot state (`transferSequence`,
   `latestTransferRequest`, `pendingTransferRequests`,
   `capturedClipboardSnapshots`, `pendingPasteFallbacks` at lines 1682-1686).
   These must remain exactly one instance each after the move, or supersession
   and gesture-ownership behavior changes. Each group moves into exactly one
   leaf module (`write.ts`, `transfer.ts`) and no other module defines a
   second copy; the barrel re-exports functions, never state. There are no
   side-effect imports (no CSS) in this module.
2. **tsconfig project boundaries and package exports - applies, low risk.**
   The destination stays inside `packages/editor/src`, so it stays in the same
   tsconfig project (`packages/editor/tsconfig.json`) and the same published
   entry surface (`@varve/editor` exports `.` and `./auxiliary`). No new
   package entry point, no cross-package import, no tsconfig edit.
3. **Path aliases and import ordering - applies.** Workspace imports use
   `@varve/*` aliases (engine, scene, platform, shared) and stay unchanged;
   relative imports inside the barrel (`./clipboard/mime` etc.) are new.
   Each destination module gets the subset of the original import block it
   uses; the original single block cannot be moved verbatim because sixteen
   moved declarations distribute the imports across nine modules. Biome orders
   and formats the import blocks; it must not rewrite moved logic.
4. **Template literals, regexes and code-like text - applies.** The file is
   dense with MIME strings, `TextEncoder`/`base64` bounds, SVG/HTML regexes,
   long doc comments, and `globalThis`/`navigator` probing. The cut is by
   planner declaration boundaries (line ranges), never by brace or line
   counting; every moved range is copied verbatim.
5. **Identity-sensitive declarations - applies.** The module exports 35 named
   declarations plus the two rich-text re-exports; the covering test imports 16
   of them from `./clipboard` and four sibling modules import from
   `./clipboard`/`../clipboard`/`../../clipboard`. The path keeps resolving
   to the same module file (a `.ts` file wins over the sibling directory), and
   the barrel re-exports every original name explicitly. No declaration is
   renamed, no runtime value identity changes.
6. **Same-named private helpers - applies, planned visibility only.** Several
   helpers are used across the new module boundaries (`isRecord`,
   `base64ToBytes`, `isSvgText`, `hasRichClipboardContent`,
   `hydrateClipboardFonts`, `snapshotClipboardData`,
   `prepareClipboardFontDependencies`, the validation helpers). Each has
   exactly one home; helpers gain an `export` keyword only on the internal
   destination path so a sibling module can import them. No duplicate copy is
   created, and no helper is added to the public barrel beyond the original
   export list.
7. **Dropped declarations - applies.** The base set is 91 declarations
   (refactor-verify `baseCount: 91`); the complete inventory is the 92 planner
   blocks in `SEAM_SPEC.md` (91 declarations plus the original rich-text export
   statement). Every declaration must appear exactly once in the destination
   tree, and the verifier must exit 0 before tests.
8. **Tracked-versus-untracked baseline policy - applies.** The worktree is
   clean; new destination modules are untracked until staged but are measured
   before staging. `--update` never freezes WIP; the staged-blob check inside
   `pnpm verify:commit` judges each new module against the 400-line cap.
9. **Stale or grandfathered entries - applies.** Exactly
   `packages/editor/src/clipboard.ts` must leave the baseline (1968 -> gone);
   no entry may be added or grown. `packages/editor/src/clipboard.test.ts`
   (frozen at 1432) is not edited and therefore does not grow. `--update
   --force` is forbidden.
10. **Concurrent worktree conflict - applies, low.** The baseline, repo map,
    and ledger are single-writer surfaces; this session is the only writer in
    `.worktrees/B-03`. The queue-backed gates are unavailable machine-wide in
    this environment (EROFS, measured below), so no other queued holder can be
    observed or contended with; the worktree-per-task and one-writer rules are
    the controls.
11. **Rollback - applies.** The seam is uncommitted until the final step; a
    failed extraction is discarded only inside `.worktrees/B-03`. The shared
    main checkout's dirty WIP belongs to other sessions and is never reset.
12. **Rust-crate equivalents - does not apply.** This is a TypeScript module
    seam; both seam tools parse it (exit 0 above), `audit:ipc` and cargo are
    untouched, and there is no `mod`/`generate_handler!` wiring to verify.

## Environment limits measured on this checkpoint (substitutions)

| Limit | Measured evidence | Substitution used |
|---|---|---|
| Read-only pnpm store | `pnpm install --frozen-lockfile` -> `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK ... Read-only file system (os error 30)`, exit 1 | 22 `node_modules` symlinks from the main checkout plus an ignored copy of `apps/desktop/src-tauri/onnxruntime-libs` (not committed) |
| Validation queue EROFS | `pnpm check:agent` -> `EROFS: read-only file system, open '/run/user/1000/varve-validation-queue/exclusive.lock'`, exit 1 | direct recursive tsc program (the same three stages `check:agent:raw` runs: `packages/*`, `apps/desktop`, `tests/e2e`), run directly through `node node_modules/typescript/bin/tsc` to avoid the pnpm pre-script install attempt |
| Planner `--top` mismatch | `godsplit-plan.mjs <file> --top 200` -> usage text, exit 2 | supported `godsplit-plan.mjs <file>` (full table, exit 0); recorded above |
| Desktop tsc pre-existing diagnostics | measured baseline direct stage: desktop exit 2 with diagnostics caused by the main checkout's stale `@varve` resolution (same as B-02) | compare the identical baseline/after diagnostic count; packages stage must stay 0 fail, e2e 0 |

## Failure modes -> guardrails

| Failure mode | Evidence / risk here | Guardrail | Owner prompt |
|---|---|---|---|
| Silent declaration drop or rename | 91 base declarations + 2 rich-text exports; a cut script can skip a block | Complete inventory; range-partition assertion before writing; `refactor-verify` exit 0 before tests; biome then re-verify | 02 Step 1/3 |
| Second copy of module-scope state | write queue and transfer maps are stateful and behavior-critical; a duplicated state module changes supersession and gesture ownership | One home per state group; barrel exports no state; no module re-imports the barrel | 02 Step 2 |
| Cut through a string/regex/comment | MIME templates, HTML/SVG regexes, long doc comments | Cut only at planner declaration boundaries; moved ranges copied verbatim; byte-identity check over moved lines | 02 Step 2/3 |
| Behavior change hidden in a move | clipboard writes/pastes are a data-loss surface (Cut depends on `writeClipboardOutcome`) | Move-only diff; no logic edits; covering test 40/40 before and after; package tsc | 02 Step 4 |
| New module over cap | 1,814 declaration/comment/blank lines move into a directory | Destination map keeps every module <= 400 (target ~350); measured before staging | 01/02 |
| Partial extraction (target stays frozen) | 1,968 lines must leave; path must stay a thin entry | Barrel expected < 150 lines; baseline entry removed; report no longer lists the target | 02 Step 5 |
| Broken import/export surface | 16 names imported by the covering test and multiple sibling modules | Explicit named barrel exports; direct recursive tsc; biome; consumer compile via packages stage | 02 Step 2/4 |
| Frozen covering test grows | `clipboard.test.ts` frozen at 1432 | Do not edit the test; staging check rejects growth | 02 Step 4 |
| Unrelated reformatting | Biome is available and will sort imports | Moved bodies verbatim; only import preambles and barrel wiring are new; comments preserved verbatim | 02 Step 2 |
| Baseline growth / WIP freeze | `--update` conservative | Never `--force`, never hand-edit; diff exactly one removed entry; `pnpm audit:filesize` green | 02 Step 5 |
| Stale generated surfaces | repo map is generated from staged tree | `pnpm agent:map` after staging; `pnpm verify:commit` staged-only | 02 Step 6 |

## Reference-tool failure-mode analysis

Codemod-style refactors fail by silently skipping a declaration, reporting
success after a partial edit, leaving the tree type-broken, and producing an
unreviewable changeset. Existing machinery already prevents most of that here:

- `refactor-verify` is an independent AST check on the base/target/destination
  union; it exits 1 on a missing declaration or exported name, and this session
  runs it before tests and again after biome.
- The covering Vitest suite (40 tests) exercises the data-loss surface:
  parse/serialize round-trips, world-pose policy, superseded writes, gesture
  ownership, native/browser read fallbacks, and font restore.
- The direct recursive tsc substitute type-checks every package (plus desktop
  and e2e) after the move.
- `pnpm audit:filesize` is shrink-only and `--update` refuses growth, so a
  partial split cannot silently reduce the ratchet.
- `pnpm verify:commit` judges only the staged tree (emoji, map, staged size,
  health, docs, staged tests).

Residual risks that stay explicit checks in `SEAM_SPEC.md`: (a) module-scope
state ownership is not machine-verified beyond the test suite and
single-instance review; (b) helper visibility promotion is a planned edit set
that must be counted (it changes no behavior); (c) the new directory/file
resolution for `./clipboard` (file wins over directory) is validated by the
unchanged test imports and the tsc stages; (d) desktop tsc is already red from
a pre-existing environment resolution defect, so the comparison is
diagnostic-count equality, not exit 0.

## Edge-case register

| Edge case | Verdict for B-03 |
|---|---|
| Module-eval side effects (state, CSS, pools) | Applies: two mutable state groups; one home each; barrel exports functions only; no side-effect imports exist. |
| tsconfig project boundaries / package entry points | Applies, no change: destination stays inside `packages/editor/src`; `@varve/editor` exports untouched. |
| Path aliases and import ordering | Applies: `@varve/*` unchanged; per-module subsets of the original import block; biome sorts only import preambles. |
| Template-literal / regex / code-like text | Applies: MIME templates, SVG/HTML regexes, base64 bounds; cuts on planner ranges only. |
| Overloaded / identity-sensitive declarations | Applies: 35 exported names plus 2 rich-text re-exports; same path, explicit re-export list, no renames. |
| Same-named private helpers in sibling modules | Applies, planned: cross-module helpers gain internal `export`; one home each; no duplicate definitions; not added to the public barrel. |
| Dropped declaration | Applies: 91/91 base declarations must survive; refactor-verify exit 0 before tests. |
| Parse failure in the target or destination | Applies: planner and verifier parse the target today (exit 0); tsc parses every new module. |
| Tracked-vs-untracked baseline policy | Applies: clean worktree; new modules untracked until staging but measured first; no WIP freeze. |
| Stale / grandfathered / slack-band baseline entry | Applies: exactly the clipboard.ts entry leaves; the frozen covering test is not edited; 0 added, 0 grown. |
| Test-file exemption from the ratchet | Does not apply: tests count as source; the covering test is frozen and untouched. |
| Generated files and exclusions | Not applicable: no `vendor/**` or generated-table path is touched. |
| Concurrent worktree conflict on peer-hot files | Applies low: single writer in `.worktrees/B-03`; shared surfaces regenerated, never hand-merged. |
| Rollback path | Applies: uncommitted seam, discard only this worktree's changes; never reset the shared checkout. |
| Unknown / unresolved tools | Resolved: planner and verifier parse the target (exit 0); planner `--top` flag mismatch recorded. |

## Front-end necessity gate

Verdict: **does not fire**. The seam is a pure TypeScript code move inside
`packages/editor/src`; it renders nothing, changes no API response shape, no
error/empty/loading state, and no remediation workbench exists. The proof is
the unchanged covering suite: `packages/editor/src/clipboard.test.ts`, 40
tests, run before and after the move with the identical pass count and 0
failures. Statement for `SEAM_SPEC.md`: no visual surface changed; visual
validation is not triggered, so prompts 03 and 04 are not opened.

