# B-03 seam specification - clipboard entry split

Phase 02 output. One seam, one worktree, one commit. This specification exists
before any source edit and carries the hand-completed declaration inventory
(the planner seeds ranges; the destination decision is a review decision).

## Resolved values

| Key | Value |
|-----|-------|
| Batch / entry | B / B-03 |
| Worktree / branch | `.worktrees/B-03` / `seam/B/B-03-clipboard` |
| Base commit | `e2cf7295b70b7bf82a95b0d85f59eff4d8844260` |
| Target | `packages/editor/src/clipboard.ts` - 1,968 lines, frozen at 1968 |
| Destination | `packages/editor/src/clipboard/` (directory = one seam) plus the existing `clipboard.ts` as a thin re-export barrier |
| Covering test | `packages/editor/src/clipboard.test.ts` - 1,432 lines, 40 tests, frozen; not edited |
| Expected ratchet | 953 -> 952 frozen entries; exactly one entry removed; 0 added, 0 grown |
| Parent expected size | `clipboard.ts` barrel under 150 lines (target < 120) |
| Module cap | every destination module <= 400 lines (target 350-400 where the concern is naturally that large) |

## Pre-flight evidence (clean worktree, before any edit)

```
$ git rev-parse HEAD
e2cf7295b70b7bf82a95b0d85f59eff4d8844260
$ git status --porcelain=v1 -b
## seam/B/B-03-clipboard

$ pnpm audit:filesize
File-size budget OK: 6155 source files scanned; 953 over 400 lines, all frozen
in .file-size-baseline.json (tracked content).

$ pnpm install --frozen-lockfile
ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK ... Read-only file system (os error 30)
(known environment limit; measured workflow is the 22 node_modules symlinks from
the main checkout plus the ignored onnxruntime-libs copy)

$ pnpm check:agent
EROFS: read-only file system, open '/run/user/1000/varve-validation-queue/exclusive.lock'
(known environment limit; substitute is the direct recursive tsc program - see
Execution results)

$ node scripts/quality/godsplit-plan.mjs packages/editor/src/clipboard.ts
Lines: 1968 | imports: 7 | blocks: 92
(exit 0; the handoff's `--top 200` flag is not implemented in the checkpoint
planner and exits 2, so the supported no-flag invocation is used)

$ node scripts/quality/refactor-verify.mjs --base master \
    --target packages/editor/src/clipboard.ts --json
{"ok": true, "baseCount": 91, "presentCount": 91, "missing": [], "missingExports": []}
(exit 0)

$ node node_modules/vitest/vitest.mjs run packages/editor/src/clipboard.test.ts
 Test Files  1 passed (1)
      Tests  40 passed (40)
(exit 0; before-count for the seam)
```

## Single concern

Pure code motion of one module's declarations: MIME/format constants and
serializers, clipboard parsing/validation, the font-dependency closure, the
serialized write queue, the read/snapshot helpers, and the transfer-request /
captured-snapshot state. No behavior, API, rendering, error-state, or
dependency change. The module path and its public names stay identical.
`clipboardRichText.ts` stays in place and the barrel keeps re-exporting its two
public names.

## Hand-completed declaration inventory

Seed: `node scripts/quality/godsplit-plan.mjs packages/editor/src/clipboard.ts`
(92 blocks, 7 import declarations, hazard "over the 400-line cap"). Each block
was read in range and assigned a destination; the destination column is the
review decision. Kinds are the planner's TS AST kinds; names are verbatim.
"barrel (stays)" is the original rich-text export statement at line 49, which
stays in the barrel verbatim.

| kind | name | lines | exported | destination module |
|------|------|-------|----------|-------------------|
| Export | `-` | 49 | no | barrel (stays) |
| Variable | `VARVE_MIME` | 51 | yes | mime |
| Variable | `LEGACY_MIME` | 52 | yes | mime |
| Variable | `WEB_VARVE_MIME` | 64 | yes | mime |
| Variable | `WEB_LEGACY_MIME` | 65 | yes | mime |
| Variable | `NATIVE_CLIPBOARD_READ_TYPES` | 66-79 | no | transfer |
| Variable | `VARVE_CLIPBOARD_FORMAT` | 80 | no | mime |
| Variable | `VARVE_CLIPBOARD_VERSION` | 82 | no | mime |
| Variable | `LEGACY_CLIPBOARD_VERSION` | 83 | no | mime |
| Variable | `MAX_CLIPBOARD_JSON_BYTES` | 84 | no | mime |
| Variable | `MAX_CLIPBOARD_NODES` | 85 | no | mime |
| Variable | `MAX_CLIPBOARD_DEPTH` | 86 | no | mime |
| Variable | `MAX_CLIPBOARD_FONT_DEPENDENCIES` | 87 | no | mime |
| Variable | `MAX_CLIPBOARD_FONT_BYTES` | 88 | no | mime |
| Function | `isVarvePayloadType` | 91-98 | no | mime |
| Interface | `ClipboardData` | 100-155 | yes | types |
| Function | `canPreserveClipboardWorldPose` | 162-196 | yes | selection |
| Interface | `ClipboardFontDependency` | 198-210 | yes | types |
| Interface | `ClipboardSelectionSnapshot` | 213-220 | yes | types |
| Interface | `ClipboardImportItem` | 222-226 | yes | types |
| Interface | `UnifiedClipboardResult` | 228-235 | yes | types |
| TypeAlias | `TransferIntent` | 237 | yes | types |
| Interface | `TransferRequest` | 239-245 | yes | types |
| TypeAlias | `ClipboardRequest` | 247 | yes | types |
| Function | `orderClipboardRoots` | 259-296 | yes | selection |
| Interface | `ClipboardCapabilities` | 298-305 | yes | types |
| Interface | `ClipboardSnapshot` | 307-313 | yes | types |
| Interface | `TransferOutcome` | 315-321 | yes | types |
| TypeAlias | `ClipboardWriteOutcome` | 323-329 | yes | types |
| Function | `isRecord` | 331-333 | no | validation |
| Interface | `ClipboardFontRequest` | 335-338 | no | fonts |
| Function | `clipboardFontRequestKey` | 340-344 | no | fonts |
| Function | `collectClipboardFontRequests` | 346-381 | no | fonts |
| Function | `bytesToBase64` | 383-396 | no | fonts |
| Function | `base64ToBytes` | 398-416 | no | fonts |
| Function | `isEmbeddingPermitted` | 418-420 | no | fonts |
| Function | `prepareClipboardFontDependencies` | 423-483 | no | fonts |
| Function | `restoreClipboardFontDependencies` | 486-527 | yes | fonts |
| Function | `serializeClipboardNode` | 529-534 | no | parse |
| Function | `parseClipboardNode` | 536-577 | no | validation |
| Function | `validateNodeGraph` | 579-607 | no | validation |
| Function | `validResourceMap` | 609-613 | no | validation |
| Function | `validFrameGuideLayouts` | 615-628 | no | validation |
| Function | `validClipboardFontReference` | 630-639 | no | validation |
| Function | `validClipboardFontDependencies` | 641-682 | no | validation |
| Function | `validClipboardFontManifest` | 684-688 | no | validation |
| Function | `validClipboardPatternDefinitions` | 690-772 | no | validation |
| Function | `finitePayload` | 775-795 | no | validation |
| Function | `parseClipboardData` | 798-958 | yes | parse |
| Function | `serializeClipboardData` | 960-1021 | no | parse |
| Function | `isPermissionError` | 1023-1025 | no | write |
| Variable | `clipboardWriteTail` | 1027 | no | write |
| Variable | `latestClipboardWrite` | 1028 | no | write |
| Function | `enqueueClipboardWrite` | 1030-1040 | no | write |
| Function | `writeClipboardOutcome` | 1043-1100 | yes | write |
| Function | `writeClipboardRepresentation` | 1107-1116 | yes | write |
| Function | `writeClipboardRepresentationNow` | 1118-1166 | no | write |
| Function | `writeClipboardOutcomeNow` | 1168-1315 | no | write |
| Function | `writeClipboard` | 1321-1377 | yes | write |
| Function | `createClipboardResult` | 1379-1381 | no | read |
| Function | `hydrateClipboardFonts` | 1383-1391 | no | read |
| Function | `isSvgText` | 1393-1397 | no | read |
| Function | `hasRichClipboardContent` | 1399-1401 | no | read |
| Function | `extractSvgFromHtml` | 1405-1416 | no | read |
| Function | `addSvgItem` | 1418-1439 | no | read |
| Function | `addImageItem` | 1441-1452 | no | read |
| Function | `readClipboardItem` | 1454-1527 | no | read |
| Function | `readClipboardUnified` | 1529-1538 | yes | read |
| Function | `readFromClipboardEvent` | 1550-1557 | yes | read |
| Interface | `ClipboardFileSnapshot` | 1559-1562 | no | read |
| Interface | `ClipboardDataSnapshot` | 1564-1570 | no | read |
| Function | `snapshotClipboardData` | 1572-1628 | no | read |
| Function | `readClipboardSnapshot` | 1630-1675 | no | read |
| Interface | `OwnedClipboardSnapshot` | 1677-1680 | no | transfer |
| Variable | `transferSequence` | 1682 | no | transfer |
| Variable | `latestTransferRequest` | 1683 | no | transfer |
| Variable | `pendingTransferRequests` | 1684 | no | transfer |
| Variable | `capturedClipboardSnapshots` | 1685 | no | transfer |
| Variable | `pendingPasteFallbacks` | 1686 | no | transfer |
| Function | `createTransferRequest` | 1688-1704 | yes | transfer |
| Function | `getLatestTransferRequest` | 1706-1708 | yes | transfer |
| Function | `claimPendingTransferRequest` | 1716-1718 | yes | transfer |
| Function | `removePendingRequest` | 1720-1728 | no | transfer |
| Function | `capabilitiesForSnapshot` | 1730-1741 | no | transfer |
| Function | `contractForSnapshot` | 1743-1761 | no | transfer |
| Function | `getClipboardSnapshot` | 1763-1766 | yes | transfer |
| Function | `captureClipboardEvent` | 1769-1786 | yes | transfer |
| Function | `clearCapturedClipboardEvent` | 1789-1798 | yes | transfer |
| Function | `isNativeClipboardTarget` | 1801-1817 | yes | transfer |
| Function | `schedulePasteFallback` | 1832-1852 | yes | transfer |
| Function | `cancelPasteFallback` | 1854-1864 | yes | transfer |
| Function | `readClipboardUnifiedWithFallback` | 1877-1968 | yes | transfer |

Counts: 92 blocks; 91 top-level declarations (refactor-verify `baseCount: 91`)
plus the original `export { clipboardRichTextWarning, parseClipboardRichText }
from './clipboardRichText';` statement. Exported names in the target: 35 (the
verifier's `missingExports` must stay `[]`), plus the two rich-text names from
line 49.

## Destination map (review decision)

`packages/editor/src/clipboard.ts` becomes a thin barrel: the original file
docblock (lines 1-14), the original rich-text re-export (line 49), and an
explicit named re-export table for every other public name. It declares nothing.
The new source modules, all under `packages/editor/src/clipboard/`:

| module | responsibility | moved range lines | measured total |
|--------|----------------|-------------------|----------------|
| `mime.ts` | Varve/legacy/web MIME constants, clipboard format and version constants, all transport bounds, `isVarvePayloadType` | 33 | 35 |
| `types.ts` | `ClipboardData`, font-dependency/selection-import snapshot types, capabilities/snapshot/outcome/request types | 129 | 150 |
| `selection.ts` | `canPreserveClipboardWorldPose` and `orderClipboardRoots` | 88 | 93 |
| `fonts.ts` | font request collection, base64 codec, embedding-permission policy, portable font closure preparation, font restore | 186 | 200 |
| `validation.ts` | record/node-graph/resource/font-manifest/pattern-definition validation and the iterative finite-value walk | 255 | 274 |
| `parse.ts` | `parseClipboardData` and `serializeClipboardData` (plus the raster-tile node codec) | 230 | 265 |
| `write.ts` | permission classification, serialized write queue and supersession generation, Varve/legacy/web write pipelines, boolean compatibility wrapper | 348 | 373 |
| `read.ts` | async Clipboard API item reader, DOM event snapshot/read path, SVG/HTML/image representation helpers | 284 | 297 |
| `transfer.ts` | transfer-request lifecycle, captured snapshots, native clipboard read targets, paste fallback timers, unified read with fallback | 292 | 321 |

Moved range lines sum to 1,845 (1,843 non-blank, including the 29 planned
single-line export-prefix edits, plus 2 preserved blank lines). Every module is
at or under 400 lines (largest `write.ts` 373, then `transfer.ts` 321,
`read.ts` 297); the barrel is 57 lines. No declaration body is sub-split
(largest single declaration is `parseClipboardData`, 161 lines).

## Before and expected-after declaration sets

- Before: 91 top-level declarations in `packages/editor/src/clipboard.ts`
  (verifier `presentCount: 91`, `missing: []`), 1,968 lines, 35 exported names
  plus 2 rich-text re-exports.
- After: the same 91 declarations distributed across the nine destination
  modules (inventory above), the rich-text export statement in the barrel, and
  the barrel's named re-export table. `refactor-verify --dest
  packages/editor/src/clipboard/` must report
  `{ok: true, baseCount: 91, presentCount: 91, missing: [], missingExports: []}`.
- Parent: barrel expected under 150 lines; target entry removed from the
  baseline. Covering test unchanged at 1,432 lines / 40 tests.

## Planned non-move edits (counted; no behavior change)

1. Import preambles per destination module, derived from the original block
   (lines 16-47); workspace `@varve/*` specifiers unchanged, new relative
   specifiers point at the destination modules.
2. Barrel wiring: file docblock and line-49 re-export kept verbatim; explicit
   named re-exports added for the 35 public names plus type-only re-exports.
3. Private declarations that a sibling module needs gain `export` on their
   internal module only and are not re-exported by the barrel:
   - `mime.ts`: `VARVE_CLIPBOARD_FORMAT`, `VARVE_CLIPBOARD_VERSION`,
     `LEGACY_CLIPBOARD_VERSION`, `MAX_CLIPBOARD_JSON_BYTES`,
     `MAX_CLIPBOARD_NODES`, `MAX_CLIPBOARD_DEPTH`,
     `MAX_CLIPBOARD_FONT_DEPENDENCIES`, `MAX_CLIPBOARD_FONT_BYTES`,
     `isVarvePayloadType` (9).
   - `fonts.ts`: `prepareClipboardFontDependencies`, `base64ToBytes` (2).
   - `validation.ts`: `isRecord`, `parseClipboardNode`,
     `validateNodeGraph`, `validResourceMap`, `validFrameGuideLayouts`,
     `validClipboardFontReference`, `validClipboardFontDependencies`,
     `validClipboardFontManifest`, `validClipboardPatternDefinitions`,
     `finitePayload` (10).
   - `parse.ts`: `serializeClipboardData` (1).
   - `read.ts`: `hydrateClipboardFonts`, `isSvgText`,
     `hasRichClipboardContent`, `snapshotClipboardData`,
     `readClipboardSnapshot`, and the `ClipboardFileSnapshot` /
     `ClipboardDataSnapshot` interfaces (5 functions + 2 types).
   - `transfer.ts`: `NATIVE_CLIPBOARD_READ_TYPES` moves here and stays
     module-private (0 new exports).
   No declaration is renamed and no body line changes.
4. Nothing else: no behavior edit, no comment rewrite, no test edit, no config
   or docs edit.

## Edge-case answers (from GAP_ANALYSIS.md)

- Module evaluation: the write-queue state lives once in `write.ts`; the
  transfer-request/snapshot state lives once in `transfer.ts`; the barrel
  exports functions only and no destination module imports the barrel, so the
  import graph is acyclic (types/mime/selection -> fonts -> validation ->
  parse -> read/write -> transfer).
- Import-time ordering: the only import-time constructions are
  `Promise.resolve()` (write queue tail) and empty `Map`/`Array` state; they do
  not interact, so evaluation order among the child modules is unobservable.
- Exports/identity: same module path (`./clipboard` resolves to `clipboard.ts`,
  which wins over the sibling directory), explicit named re-exports, no renames;
  the 16 names imported by the test and the consumer imports stay valid.
- Frozen test: not edited; 1,432 lines / 40 tests stay identical.
- Cap: all modules <= 400; parent under cap; no new over-cap path is staged.
- Baseline: exactly the target entry leaves; 0 added, 0 grown; no `--force`.

## Proof plan

1. `refactor-verify --base master --target packages/editor/src/clipboard.ts
   --dest packages/editor/src/clipboard/` exits 0 with
   `missing: []`, `missingExports: []` (required before tests).
2. Covering test run before (40/40) and after the move: identical pass count,
   0 failures, same test names.
3. Direct recursive tsc substitute (packages stage, desktop stage, e2e stage):
   packages 0 fail, e2e exit 0, desktop exit/diagnostic count identical to the
   pre-move baseline (pre-existing environment diagnostics only).
4. `pnpm exec biome check --write` then `pnpm exec biome check` on every
   changed file; moved bodies verbatim apart from import preambles and the
   enumerated visibility edits.
5. Baseline: `audit-file-size.mjs --update`, diff exactly one removed entry,
   then `pnpm audit:filesize` exit 0 at 952.
6. Staged seam: `pnpm agent:map` from the staged tree, `pnpm verify:commit`
   pass, one commit with no AI attribution.

## Visual surface statement

No visual surface changed. The covering test
`packages/editor/src/clipboard.test.ts` (40 tests, unchanged before and after)
proves the clipboard behavior contract; no rendered surface, style file,
snapshot, or E2E visual spec is touched. The front-end necessity gate does not
fire and prompts 03/04 stay unopened.

## Rollback

The seam is uncommitted until the final step; discard only
`.worktrees/B-03` changes if the extraction fails. Never reset the shared main
checkout, never commit a partial seam, and never use `--update --force` to make
the ratchet pass.

## Execution results (measured after the move)

Pre-flight baseline (clean worktree, before the edit), direct tsc substitute for
the queue-backed `pnpm check:agent`:

```
packages stage: 20 packages checked, 20 pass, 0 fail (85 s)
desktop stage:  exit 2, 228 `error TS` diagnostics (pre-existing environment
               resolution; matches the B-02 measured 228)
e2e stage:      exit 0, 0 lines
editor package: exit 0
```

Split execution (scratch executor, not committed). The script asserted a
complete partition of all 1,968 base lines before writing: 14 file-doc lines and
the line-49 rich-text re-export stay in the barrel verbatim, 32 import lines are
replaced by per-module preambles, 1,845 range lines are moved (1,843 non-blank +
2 blank), and the remaining 73 base lines are blank separators. The ranges are
the planner's declaration boundaries; no cut crosses a string, regex, template,
or comment.

Measured modules (after one `biome check --write` pass that only reordered
import preambles): `mime.ts` 35, `types.ts` 150, `selection.ts` 93,
`fonts.ts` 200, `validation.ts` 274, `parse.ts` 265, `write.ts` 373,
`read.ts` 297, `transfer.ts` 321; barrel `clipboard.ts` 57. All under the
400-line cap.

Move identity (independent line-mapping check against `git show
HEAD:packages/editor/src/clipboard.ts`):

```
1,843 non-blank moved lines present in destination order:
  1,814 byte-identical verbatim lines
   29 planned single-line export-prefix edits (listed in the executor map)
0 mismatches, 0 missing, 2/2 blank lines preserved
Biome changed only import preambles (7 files fixed); no moved declaration,
comment, string, regex, or template line changed.
```

Execution corrections (recorded, import-level only): (a) `types.ts` needs a
value import of `VARVE_CLIPBOARD_FORMAT`/`VARVE_CLIPBOARD_VERSION` from
`./mime` because the moved `ClipboardData` interface uses `typeof` on them
(they were same-module constants before); (b) `selection.ts` dropped the
`SceneNode` type specifier that its two moved functions never used. Neither
changes a declaration, signature, or behavior.

Proof results:

```
$ node scripts/quality/refactor-verify.mjs --base master \
    --target packages/editor/src/clipboard.ts --dest packages/editor/src/clipboard/ --json
{"ok": true, "baseCount": 91, "presentCount": 91, "missing": [], "missingExports": []}
(exit 0, run before tests and again after biome)

$ node node_modules/vitest/vitest.mjs run packages/editor/src/clipboard.test.ts
before: 40 passed (40), 1 file, exit 0
after:  40 passed (40), 1 file, exit 0 (same file, untouched)

$ ./node_modules/.bin/biome check --write <10 changed files>; check
exit 0 both: "Checked 10 files", write fixed 7 (imports only), check no fixes

direct tsc substitute after the move:
  packages stage: 20 checked, 20 pass, 0 fail (91 s)
  editor package: exit 0
  desktop stage:  exit 2, 228 diagnostics - normalized diagnostic list
                  byte-identical to the before list (diff empty)
  e2e stage:      exit 0, 0 lines
```

Baseline ratchet:

```
$ node scripts/quality/audit-file-size.mjs --update
Wrote .file-size-baseline.json: 952 frozen file(s) over 400 lines.
added 0, grown 0, removed 1 (splits/deletes/untracked-pruned).
$ git diff -- .file-size-baseline.json
one line removed: "packages/editor/src/clipboard.ts": 1968,
$ pnpm audit:filesize
File-size budget OK: 6168 source files scanned; 952 over 400 lines, all frozen
$ node scripts/quality/audit-file-size.mjs --report
Scanned 6168 source files; 952 over the 400-line cap; 952 frozen; 0 violations;
0 untracked WIP over-cap; excess over cap 308719 lines; 0 stale.
```

953 -> 952 frozen entries; 310,287 -> 308,719 excess lines (-1,568, i.e. the
1,968-line target minus its 400-line cap allowance). The report no longer lists
`packages/editor/src/clipboard.ts`. No entry was added or grown; `--force`
was not used.
