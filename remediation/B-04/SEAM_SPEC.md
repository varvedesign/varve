# B-04 seam specification - document codec split

Phase 02 output. One seam, one worktree, one commit. This specification exists
before any source edit and carries the hand-completed declaration inventory
(the planner seeds ranges; the destination decision is a review decision).

## Resolved values

| Key | Value |
|-----|-------|
| Batch / entry | B / B-04 |
| Worktree / branch | `.worktrees/B-04` / `seam/B/B-04-document-codec` |
| Base commit | `1ee80dda64e67bf7a8f8c8a4f54a0f7677dcc9f6` |
| Target | `packages/scene/src/documentCodec.ts` - 1,874 lines, frozen at 1874 |
| Destination | `packages/scene/src/documentCodec/` (directory = one seam) plus the existing `documentCodec.ts` as a thin re-export barrel |
| Covering test | `packages/scene/src/documentCodec.test.ts` - 1,132 lines, 32 tests, frozen; not edited |
| Expected ratchet | 952 -> 951 frozen entries; exactly one entry removed; 0 added, 0 grown |
| Parent expected size | `documentCodec.ts` barrel under 40 lines |
| Module cap | every destination module <= 400 lines (target 350-400 only where the concern is naturally that large) |

## Pre-flight evidence (clean worktree, before any edit)

```
$ git rev-parse HEAD
1ee80dda64e67bf7a8f8c8a4f54a0f7677dcc9f6
$ git status --porcelain=v1 -b
## seam/B/B-04-document-codec

$ pnpm audit:filesize
File-size budget OK: 6164 source files scanned; 952 over 400 lines, all frozen
in .file-size-baseline.json (tracked content).

$ pnpm install --frozen-lockfile
ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK ... Read-only file system (os error 30)
(known environment limit; measured workflow is the 22 node_modules symlinks from
the main checkout plus the ignored onnxruntime-libs copy)

$ pnpm check:agent
EROFS: read-only file system, open '/run/user/1000/varve-validation-queue/exclusive.lock'
(known environment limit; substitute is the direct recursive tsc program - see
Execution results)

$ node scripts/quality/godsplit-plan.mjs packages/scene/src/documentCodec.ts
Lines: 1874 | imports: 27 | blocks: 30
(exit 0; the handoff's `--top 200` flag is not implemented in the checkpoint
planner and exits 2, so the supported no-flag invocation is used)

$ node scripts/quality/refactor-verify.mjs --base master \
    --target packages/scene/src/documentCodec.ts --json
{"ok": true, "baseCount": 30, "presentCount": 30, "missing": [], "missingExports": []}
(exit 0)

$ node node_modules/vitest/vitest.mjs run packages/scene/src/documentCodec.test.ts
 Test Files  1 passed (1)
      Tests  32 passed (32)
(exit 0; before-count for the seam)
```

## Single concern

Pure code motion of one module's declarations: the exported codec types, the
validation/warning layer, the load-time state migration (normalization and
sanitization) pipeline, the dependency-closure collector, the font-manifest
slice, and the `DocumentCodec` core object. No behavior, API, rendering,
error-state, or dependency change. The module path and its 5 public names stay
identical. The version-migration table itself is in `./version` /
`./version-migrations` and is not part of this file or this seam.

## Hand-completed declaration inventory

Seed: `node scripts/quality/godsplit-plan.mjs packages/scene/src/documentCodec.ts`
(30 blocks, 27 import declarations, hazards "over the 400-line cap" and
"sub-split required: collectNodeClosure lines 1124-1627"). Each block was read
in range and assigned a destination; the destination column is the review
decision. Kinds are the planner's TS AST kinds; names are verbatim.

| kind | name | lines | exported | destination module |
|------|------|-------|----------|-------------------|
| Interface | `DocumentCodecWarning` | 73-78 | yes | types |
| TypeAlias | `DocumentDecodeResult` | 80-82 | yes | types |
| Interface | `DocumentNormalizeResult` | 84-87 | yes | types |
| Interface | `DocumentClosure` | 89-123 | yes | types |
| Function | `warning` | 125-132 | no | validation |
| Function | `isRecord` | 134-136 | no | validation |
| Function | `unrecognizedVersionWarnings` | 146-162 | no | validation |
| Function | `validateShape` | 164-172 | no | validation |
| Function | `validateRuntimeCollections` | 174-223 | no | validation |
| Function | `maxNumericNodeId` | 225-234 | no | validation |
| Function | `malformedLegacyBackgroundRemovalWarnings` | 236-260 | no | validation |
| Function | `hasImageFill` | 262-269 | no | maskMigrations |
| Function | `hasDepthMaskSource` | 271-276 | no | maskMigrations |
| Function | `upgradeLegacyRasterMaskChecksum` | 283-292 | no | maskMigrations |
| Function | `sanitizeRasterMaskState` | 294-383 | no | maskMigrations |
| Function | `sanitizeIconAssetState` | 392-411 | no | assetMigrations |
| Variable | `MAX_INLINE_ASSET_BYTES` | 424 | no | assetMigrations |
| Variable | `SUPPORTED_IMAGE_MIME_TYPES` | 426-433 | no | assetMigrations |
| Function | `normalizeInlineImageFills` | 445-547 | no | assetMigrations |
| Function | `sanitizeImageAssetState` | 549-591 | no | assetMigrations |
| Function | `normalizeImageFillGeometry` | 593-636 | no | assetMigrations |
| Function | `validatePhotoSourceState` | 639-674 | no | nodeMigrations |
| Function | `validateRetouchProvenanceState` | 677-705 | no | nodeMigrations |
| Function | `normalizeRasterTiles` | 707-740 | no | nodeMigrations |
| Function | `isSupportedClipSource` | 742-751 | no | maskMigrations |
| Function | `sanitizeStructuralMaskState` | 758-797 | no | maskMigrations |
| Function | `normalizeDocument` | 799-1122 | no | normalizeDocument |
| Function | `collectNodeClosure` | 1124-1627 | no | closure (declaration; body sub-split across closureNodes + closureResources) |
| Function | `collectFontManifestClosure` | 1635-1705 | no | fontManifest |
| Variable | `DocumentCodec` | 1707-1874 | yes | codec |

Counts: 30 blocks = 30 top-level declarations (refactor-verify `baseCount: 30`).
Exported names in the target: 5 (`DocumentCodec`, `DocumentCodecWarning`,
`DocumentDecodeResult`, `DocumentNormalizeResult`, `DocumentClosure`); the
verifier's `missingExports` must stay `[]`. The 504-line `collectNodeClosure`
is the only declaration over the cap and is sub-split (next section).

## Sub-split design for collectNodeClosure (504 lines)

The declaration is preserved under its original name in `closure.ts` as a
short orchestrator. Its body moves to two modules with the original phase order
preserved; shared mutable state travels in one explicit `ClosureNodeCollection`
object instead of closures:

| module | moves | new declarations |
|--------|-------|------------------|
| `closureNodes.ts` | lines 1124-1336: root traversal (`visitNode`), fill-reference walking, the dependency-scan while loop (component/slots/path/mask/effect/mockup/style/paint/story/interaction/timeline/generative refs), and the pattern-definition closure | `ClosureNodeCollection` interface, `visitNode`, `visitFillRefs`, `scanNodeDependencies`, `collectPatternDefinitions`, `collectClosureNodes` |
| `closureResources.ts` | lines 1338-1627: component/style/paint/interaction/story/timeline/motion/variable-store slicing, raster-mask/depth-map/asset/icon-asset/mockup/generative resource closure, and the font-manifest call | `ClosureResources` type, `collectClosureResources` |
| `closure.ts` | the declaration itself and `allClosureNodes` assembly | `collectNodeClosure` (preserved name) |

Phase order is exactly the original: visit roots, then the dependency scan loop,
then the pattern-definition closure, then resource slicing, then the font
manifest. The orchestrator returns the same `DocumentClosure` shape in the same
property order (`nodeIds`, `nodes`, optional `fontManifest`, then the resource
keys with the original `undefined`-when-empty semantics).

## Destination map (review decision)

`packages/scene/src/documentCodec.ts` becomes a thin barrel: the original file
docblock (lines 1-11) plus an explicit named re-export table for the 5 public
names. It declares nothing. The new source modules, all under
`packages/scene/src/documentCodec/`:

| module | responsibility | moved lines | expected total |
|--------|----------------|-------------|----------------|
| `types.ts` | the 4 exported codec types plus `DocumentClosure` | 51 | ~60 |
| `validation.ts` | warning constructor, record guard, version/shape/runtime validation, node-id counter, legacy background-removal warnings | 131-136 | ~150 |
| `maskMigrations.ts` | raster-mask state migration (legacy checksum upgrade, asset validation, mask-source repair) and structural-mask migration | ~177 | ~200 |
| `assetMigrations.ts` | icon-asset sanitizing, inline image-fill registration (bounds + MIME policy), image-asset/ICC validation and pruning, image-fill geometry normalization | ~249 | ~275 |
| `nodeMigrations.ts` | photo-source and retouch-provenance validation, raster-tile deserialization/repair | ~103 | ~120 |
| `normalizeDocument.ts` | the ordered load/save normalization pipeline (`normalizeDocument`, 324 lines) | 324 | ~365 |
| `closureNodes.ts` | closure traversal, dependency scan, pattern closure | ~213 | ~260 |
| `closureResources.ts` | closure resource slicing and font-manifest invocation | ~290 | ~315 |
| `fontManifest.ts` | `collectFontManifestClosure` | 77 | ~90 |
| `closure.ts` | `collectNodeClosure` orchestrator | new | ~35 |
| `codec.ts` | the `DocumentCodec` decode/encode/normalize/collect object | 168 | ~190 |
| `documentCodec.ts` (barrel) | docblock plus explicit named re-exports | 11 | ~20 |

Every module is expected at or under 400 lines. The largest expected modules are
`normalizeDocument` (~365) and `closureResources` (~315); both have measured
headroom against the cap. No declaration body other than `collectNodeClosure`
is sub-split.

## Before and expected-after declaration sets

- Before: 30 top-level declarations in `packages/scene/src/documentCodec.ts`
  (verifier `presentCount: 30`, `missing: []`), 1,874 lines, 5 exported names.
- After: the same 30 declarations in the destination tree (the `DocumentCodec`
  object in `codec.ts`, `normalizeDocument` in `normalizeDocument.ts`,
  `collectNodeClosure` in `closure.ts`, and the remaining 27 in the modules
  above), plus new internal closure helpers in `closureNodes.ts` /
  `closureResources.ts` / `closure.ts`. `refactor-verify --dest
  packages/scene/src/documentCodec/` must report
  `{ok: true, baseCount: 30, missing: [], missingExports: []}` (presentCount
  grows by the new helpers).
- Parent: 20-line barrel, target entry removed from the baseline. Covering test
  unchanged at 1,132 lines / 32 tests.

## Planned non-move edits (counted; no behavior change)

1. Import preambles per destination module, derived from the original block
   (lines 13-71); sibling specifiers rebased one level (`./assets` ->
   `../assets`), new internal specifiers point at the destination modules, and
   the inline type import at line 838 becomes `import('../types').Stroke`.
2. Barrel wiring: file docblock kept verbatim; explicit named re-exports added
   for `DocumentCodec` and the 4 types (type-only for the interfaces/alias).
3. Internal visibility promotions (export keyword only, one home each, not
   re-exported by the barrel):
   - `validation.ts`: `warning`, `isRecord`,
     `malformedLegacyBackgroundRemovalWarnings`, `maxNumericNodeId`,
     `unrecognizedVersionWarnings`, `validateShape`,
     `validateRuntimeCollections` (7).
   - `maskMigrations.ts`: `hasImageFill`, `sanitizeRasterMaskState`,
     `sanitizeStructuralMaskState` (3); `hasDepthMaskSource`,
     `upgradeLegacyRasterMaskChecksum`, `isSupportedClipSource` stay private.
   - `assetMigrations.ts`: `normalizeInlineImageFills`,
     `sanitizeImageAssetState`, `normalizeImageFillGeometry`,
     `sanitizeIconAssetState` (4).
   - `nodeMigrations.ts`: `validatePhotoSourceState`,
     `validateRetouchProvenanceState`, `normalizeRasterTiles` (3).
   - `normalizeDocument.ts`: `normalizeDocument` (1).
   - `closureNodes.ts`: `ClosureNodeCollection` (type), `collectClosureNodes`
     (new helper declarations).
   - `closureResources.ts`: `ClosureResources` (type),
     `collectClosureResources`.
   - `fontManifest.ts`: `collectFontManifestClosure` (1).
   - `closure.ts`: `collectNodeClosure` (original name, preserved).
   - `codec.ts`: `DocumentCodec` (original export).
4. The `collectNodeClosure` sub-split described above. It adds helper functions
   and a state interface; every moved statement keeps its original order and
   identifiers are preserved through destructuring so moved bodies stay
   line-identical wherever the state object permits.
5. Nothing else: no behavior edit, no comment rewrite, no test edit, no config
   or docs edit.

## Edge-case answers (from GAP_ANALYSIS.md)

- Module evaluation: the only module-scope values are two constants and the
  `DocumentCodec` object; each has exactly one home and the barrel exports no
  state. No child module imports the barrel, so the import graph is acyclic
  (types -> validation -> {mask,asset,node}Migrations -> normalizeDocument;
  types -> closureNodes -> closureResources -> fontManifest -> closure; codec
  last).
- Import-time ordering: no module performs work at evaluation time; the
  `SUPPORTED_IMAGE_MIME_TYPES` Set and the `DocumentCodec` object are the only
  constructions (as before), so evaluation order among child modules is
  unobservable.
- Exports/identity: same module path (`./documentCodec` resolves to
  `documentCodec.ts`, which wins over the sibling directory), explicit named
  re-exports, no renames; `DocumentCodec.normalize` and
  `DocumentCodec.collectNodeClosure` are the same function references as
  before, because the object imports the single declarations.
- Frozen test: not edited; 1,132 lines / 32 tests stay identical.
- Cap: all modules <= 400; parent under cap; no new over-cap path is staged.
- Baseline: exactly the target entry leaves; 0 added, 0 grown; no `--force`.

## Proof plan

1. `refactor-verify --base master --target packages/scene/src/documentCodec.ts
   --dest packages/scene/src/documentCodec/` exits 0 with `missing: []`,
   `missingExports: []` (required before tests).
2. Covering test run before (32/32) and after the move: identical pass count,
   0 failures, same test names.
3. Direct recursive tsc substitute (packages stage, desktop stage, e2e stage):
   packages 0 fail, e2e exit 0, desktop exit/diagnostic list identical to the
   pre-move baseline (pre-existing environment diagnostics only).
4. `pnpm exec biome check --write` then `pnpm exec biome check` on every
   changed file; moved bodies verbatim apart from import preambles, the
   enumerated visibility edits, and the declared sub-split.
5. Baseline: `audit-file-size.mjs --update`, diff exactly one removed entry,
   then `pnpm audit:filesize` exit 0 at 951.
6. Staged seam: `pnpm agent:map` from the staged tree, `pnpm verify:commit`
   pass, one commit with no AI attribution.

## Visual surface statement

No visual surface changed. The covering test
`packages/scene/src/documentCodec.test.ts` (32 tests, unchanged before and
after) proves the document persistence contract; no rendered surface, style
file, snapshot, or E2E visual spec is touched. The front-end necessity gate does
not fire and prompts 03/04 stay unopened.

## Rollback

The seam is uncommitted until the final step; discard only `.worktrees/B-04`
changes if the extraction fails. Never reset the shared main checkout, never
commit a partial seam, and never use `--update --force` to make the ratchet
pass.

## Execution results (measured after the move)

Split executor (scratch, not committed) asserted a complete partition of all
1,874 base lines before writing: 11 docblock lines stay in the barrel, the 59
import lines are replaced by per-module preambles, 12 blank separators are
redistributed, 1,289 lines move into the eight plain destination modules, the
213-line traversal block and the 290-line resource block move into the closure
modules (193 traversal lines and 286 resource lines byte-verbatim; 20
structural traversal lines are replaced by the collection object and function
signatures, and the two `nodeIds,`/`nodes,` return lines are supplied by the
orchestrator instead), and the font-manifest (77) and `DocumentCodec` (168)
declarations move verbatim.

Planned non-move edits: 19 single-line `export` prefixes (7 validation, 3 mask,
4 asset, 3 node, 1 normalizeDocument, 1 fontManifest), one inline import rebase
(`import('./types')` -> `import('../types')`), and one call-site rename inside
`visitFillRefs` (`visit(...)` -> `visitNode(doc, collection, ...)`). No other
moved line changed; the closure sub-split adds the `ClosureNodeCollection`
state interface and four traversal helper declarations.

Measured modules (`wc -l`, after biome): barrel `documentCodec.ts` 19;
`types` 54; `validation` 140; `maskMigrations` 194; `assetMigrations` 271;
`nodeMigrations` 116; `normalizeDocument` 371; `closureNodes` 255;
`closureResources` 310; `fontManifest` 80; `closure` 14; `codec` 189. Every
module is at or under 400 lines; the largest is `normalizeDocument` 371.

Biome: `biome check --write` checked 12 files and fixed 11 (import ordering in
the preambles, plus the four signatures whose planned `export` prefix crossed
the print width: `maskMigrations` 1, `assetMigrations` 1, `nodeMigrations` 2,
and one long `codec.ts` import reflowed). Re-running `biome check` reports no
fixes. A line-level diff against the base ranges confirms the only non-preamble
changes are those planned edits; no moved body line changed.

Proof results:

```
$ node scripts/quality/refactor-verify.mjs --base master \
    --target packages/scene/src/documentCodec.ts --dest packages/scene/src/documentCodec/ --json
{"ok": true, "baseCount": 30, "presentCount": 38, "missing": [], "missingExports": []}
(exit 0, run before tests and again after biome; presentCount 38 = 30 base
declarations + 8 new closure helper declarations)

$ node node_modules/vitest/vitest.mjs run packages/scene/src/documentCodec.test.ts
before: 32 passed (32), 1 file, exit 0
after:  32 passed (32), 1 file, exit 0 (same file, untouched)

direct recursive tsc substitute, before (stashed tree) and after the move:
  before: packages 20 checked / 20 pass / 0 fail; desktop exit 0 / 0 diagnostics; e2e exit 0 / 0
  after:  packages 20 checked / 20 pass / 0 fail; desktop exit 0 / 0 diagnostics; e2e exit 0 / 0
  desktop and e2e diagnostic files byte-identical before/after
```

Environment note: the direct tsc substitute was measured clean in this worktree
(desktop exit 0, 0 diagnostics both before and after), unlike the handoff's
pre-existing 228-diagnostic note; the 22 symlinked `node_modules` trees resolve
`@varve/*` correctly here. The measured before/after comparison is therefore
0/0, not a red baseline.

Baseline ratchet:

```
$ node scripts/quality/audit-file-size.mjs --update
Wrote .file-size-baseline.json: 951 frozen file(s) over 400 lines.
added 0, grown 0, removed 1 (splits/deletes/untracked-pruned).
11 untracked file(s) scanned; over-cap WIP is never frozen.
$ git diff -- .file-size-baseline.json
one line removed: "packages/scene/src/documentCodec.ts": 1874,
$ pnpm audit:filesize
File-size budget OK: 6175 source files scanned; 951 over 400 lines, all frozen
in .file-size-baseline.json (tracked content).
$ node scripts/quality/audit-file-size.mjs --report
Scanned 6175 source files; 951 over the 400-line cap; 951 frozen in
.file-size-baseline.json; 0 violation(s); 0 untracked WIP over-cap file(s).
Excess over cap: 307245 lines. Baseline entries: 951 (0 stale).
```

952 -> 951 frozen entries; excess 308,719 -> 307,245 (-1,474, i.e. the
1,874-line target minus its 400-line cap allowance); scanned 6,164 -> 6,175
(the barrel replaces the old path and 11 modules are added). The report no
longer lists `packages/scene/src/documentCodec.ts`. No entry was added or
grown; `--force` was not used.
