# B-06 seam specification - snapping split

Phase 02 Step 1 output. One seam, one worktree, one commit. The declaration
inventory below was seeded by `godsplit-plan` and completed by hand after
reading every block range in `packages/editor/src/tools/snapping.ts`; the
planner gives ranges and hazards but never proposes a destination, so the
destination map is a review decision recorded here.

## Resolved values

| Key | Value |
|-----|-------|
| Batch | B |
| Entry id | B-06 |
| Package | `packages/editor` |
| Target file | `packages/editor/src/tools/snapping.ts` - 1,982 lines, frozen at 1982 |
| Covering test | `packages/editor/src/tools/__tests__/snapping.test.ts` - 827 lines, 64 tests, frozen at 827 |
| Seam | target filtering/normalization, per-snap-type strategies (grid, guides, objects), sticky-lock state; the current module path stays the thin entry |
| Destination | `packages/editor/src/tools/snapping/` - one destination directory; `tools/snapping.ts` stays the thin entry |
| Worktree | `.worktrees/B-06` |
| Branch | `seam/B/B-06-snapping` |
| Baseline | `.file-size-baseline.json` |
| Remediation doc | `docs/quality/agent-context-remediation-2026-10-28.md` (read-only) |
| Campaign plan | `docs/plans/agent-infrastructure-campaign-2026-10-28.md` (read-only) |
| Policy | `docs/quality/file-size-policy.md` |
| Gate | `pnpm audit:filesize` |
| Declaration planner | `node scripts/quality/godsplit-plan.mjs <file> [--json]` |
| Move verifier | `node scripts/quality/refactor-verify.mjs --base <git-ref> --target <path> --dest <dir> [--json]` |
| Ledger | `BACKLOG_LEDGER.md` |
| Expected ratchet | 950 -> 949 frozen entries; exactly one entry removed; 0 added, 0 grown |

## Pre-flight evidence (clean worktree, before any edit)

```
$ git -C .worktrees/B-06 rev-parse --abbrev-ref HEAD && git rev-parse HEAD
seam/B/B-06-snapping
feb9f0eb67678b6885626699219540c8ab3e44f9
$ git -C .worktrees/B-06 status --porcelain=v1 -b
## seam/B/B-06-snapping
$ pnpm audit:filesize
File-size budget OK: 6192 source files scanned; 950 over 400 lines, all frozen
in .file-size-baseline.json (tracked content).   (exit 0)
$ node scripts/quality/godsplit-plan.mjs packages/editor/src/tools/snapping.ts
God-file seam plan: .../packages/editor/src/tools/snapping.ts
Lines: 1982 | imports: 3 | blocks: 62
Hazards:
- target is over the 400-line cap: the split must leave every result at or under it
- sub-split required: snapPosition lines 702-1381 is 680 lines on its own
- sub-split required: snapSelectionBox lines 1593-1966 is 374 lines on its own
(exit 0)
$ node scripts/quality/refactor-verify.mjs --base master \
    --target packages/editor/src/tools/snapping.ts --json
{"ok": true, "baseCount": 61, "presentCount": 61, "missing": [], "missingExports": []}
(exit 0)
$ node node_modules/vitest/vitest.mjs run \
    packages/editor/src/tools/__tests__/snapping.test.ts --reporter=dot
 Test Files  1 passed (1)
      Tests  64 passed (64)
(exit 0)
```

- Baseline entries: 950 frozen, 0 stale, 0 violations, 0 untracked WIP; the
  target is baseline line 413 (1982) and the covering test is baseline line 408
  (827).
- Direct tsc substitute before the move: `PACKAGES_CHECKED=20
  PACKAGES_FAIL=0`; desktop `exit 0` with 0 diagnostics; e2e `exit 0` with
  0 diagnostics. (`pnpm check:agent` cannot run: the queue lock is on an
  EROFS mount; see the environment table in `RESEARCH.md`.)
- `node scripts/quality/validation-queue.mjs status`:
  `validation-queue: exclusive free; shared 0/4 slots busy; 0 waiting`.
- `pnpm worktree:status`: 43 worktrees, 20 dirty, 0 unmerged, 0 stale;
  current row `seam/B/B-06-snapping feb9f0eb6767 0d 0+0 505/149`.
- GAP_ANALYSIS.md and RESEARCH.md existed before this file and before any
  source edit.

## Single concern

Pure code motion of the snapping solver declarations. No behavior, API,
rendering, error-state, or test change. The only structural edit is the
`snapPosition` sub-split, whose moved candidate families are parameterized
against the same accumulator values and called in the original order.

## Hand-completed declaration inventory

Seed: `godsplit-plan` 62 blocks / 1,982 lines / 3 imports. Every block was
read in range. "entry" means the declaration stays in `tools/snapping.ts`
(the thin barrel); the inventory row for the barrel is the original import/
re-export block.

| # | range | lines | kind | name | export | destination |
|---|---|---|---|---|---|---|
| 1 | 10-10 | 1 | Export | (isometric type re-export) | no | entry (barrel re-export) |
| 2 | 12-44 | 33 | Interface | SnapGuide | yes | types.ts |
| 3 | 46-53 | 8 | Interface | GridSnapConfig | yes | types.ts |
| 4 | 55-73 | 19 | Interface | SnapBoxOptions | yes | types.ts |
| 5 | 75-81 | 7 | Interface | SnapResult | yes | types.ts |
| 6 | 83-90 | 8 | Interface | SnapMatch | yes | types.ts |
| 7 | 93-98 | 6 | Interface | SnapLineTarget | yes | types.ts |
| 8 | 101-106 | 6 | Interface | SnapSegmentTarget | yes | types.ts |
| 9 | 108-113 | 6 | Interface | SnapTarget | yes | types.ts |
| 10 | 116-124 | 9 | Interface | SnapLock | yes | types.ts |
| 11 | 126-129 | 4 | Interface | SnapSession | yes | types.ts |
| 12 | 131-165 | 35 | Interface | SnapOptions | yes | types.ts |
| 13 | 167-167 | 1 | Variable | SNAP_RANGE_PX | yes | types.ts |
| 14 | 168-168 | 1 | Variable | DEFAULT_SNAP_TOLERANCE_PX | yes | types.ts |
| 15 | 169-169 | 1 | Variable | SNAP_TOLERANCE_MIN_PX | yes | types.ts |
| 16 | 170-170 | 1 | Variable | SNAP_TOLERANCE_MAX_PX | yes | types.ts |
| 17 | 172-172 | 1 | TypeAlias | SnapTargetInput | yes | types.ts |
| 18 | 174-177 | 4 | Interface | NormalizedSnapTarget | no | types.ts |
| 19 | 179-190 | 12 | Function | snapTargetSearchRect | yes | targets.ts |
| 20 | 192-197 | 6 | Function | resolvedTolerancePx | no | targets.ts |
| 21 | 199-201 | 3 | Function | thresholdWorld | no | targets.ts |
| 22 | 203-205 | 3 | Function | releaseThresholdWorld | no | targets.ts |
| 23 | 208-218 | 11 | Function | screenBounds | no | targets.ts |
| 24 | 220-228 | 9 | Function | intersect | no | targets.ts |
| 25 | 230-251 | 22 | Function | filterSnapTargets | yes | targets.ts |
| 26 | 259-295 | 37 | Function | filterSnapTargetEntries | yes | targets.ts |
| 27 | 297-327 | 31 | Function | isInMovingHierarchy | no | targets.ts |
| 28 | 329-331 | 3 | Function | isSnapTarget | no | targets.ts |
| 29 | 333-360 | 28 | Function | normalizeSnapTargets | no | targets.ts |
| 30 | 362-372 | 11 | Function | snapLockForGuide | no | stickyLock.ts |
| 31 | 374-390 | 17 | Function | lockMatchesGuide | no | stickyLock.ts |
| 32 | 392-402 | 11 | Function | guideFromLock | no | stickyLock.ts |
| 33 | 404-420 | 17 | Function | stickyTargetIsInScope | no | stickyLock.ts |
| 34 | 422-442 | 21 | Function | tryStickyAxis | no | stickyLock.ts |
| 35 | 444-452 | 9 | Variable | SNAP_PRIORITY | no | candidates.ts |
| 36 | 454-459 | 6 | Function | formatSnapValue | no | candidates.ts |
| 37 | 462-469 | 8 | Function | compete | no | candidates.ts |
| 38 | 477-498 | 22 | Function | findClosest | no | candidates.ts |
| 39 | 505-540 | 36 | Function | findClosestGap | no | candidates.ts |
| 40 | 542-545 | 4 | Function | snapCoordToGrid | no | grid.ts |
| 41 | 547-569 | 23 | Function | snapPointToRotatedGrid | no | grid.ts |
| 42 | 571-577 | 7 | Interface | LineSnapCandidate | no | guides.ts |
| 43 | 579-579 | 1 | Variable | VERTICAL_SOURCE_FEATURES | no | guides.ts |
| 44 | 580-580 | 1 | Variable | HORIZONTAL_SOURCE_FEATURES | no | guides.ts |
| 45 | 582-637 | 56 | Function | closestLineSnapCandidate | no | guides.ts |
| 46 | 639-700 | 62 | Function | closestSegmentSnapCandidate | no | guides.ts |
| 47 | 702-1381 | 680 | Function | snapPosition | yes | position.ts (orchestrator) + grid.ts / guides.ts / objects.ts (extracted families) |
| 48 | 1383-1410 | 28 | Function | snapSize | yes | resize.ts |
| 49 | 1413-1415 | 3 | Function | createSnapSession | yes | stickyLock.ts |
| 50 | 1417-1417 | 1 | TypeAlias | ResizeSide | no | resize.ts |
| 51 | 1419-1422 | 4 | Interface | ResizeAxisTarget | no | resize.ts |
| 52 | 1424-1433 | 10 | Function | lineTargetPriority | no | resize.ts |
| 53 | 1435-1443 | 9 | Function | lineAxisTargets | no | resize.ts |
| 54 | 1445-1450 | 6 | Interface | ResizeAxisSnap | no | resize.ts |
| 55 | 1452-1461 | 10 | Function | preferResizeAxis | no | resize.ts |
| 56 | 1463-1502 | 40 | Function | preserveProportionalResize | no | resize.ts |
| 57 | 1504-1513 | 10 | Function | resizeSideForHandle | no | resize.ts |
| 58 | 1520-1552 | 33 | Function | snapResizeAxis | no | resize.ts |
| 59 | 1554-1569 | 16 | Function | objectAxisTargets | no | resize.ts |
| 60 | 1571-1590 | 20 | Function | snapResizeAxisToGrid | no | resize.ts |
| 61 | 1593-1966 | 374 | Function | snapSelectionBox | yes | selectionBox.ts |
| 62 | 1973-1982 | 10 | Function | pageSnapTargets | yes | pageTargets.ts |

Counts: 61 declarations (62 blocks minus the import/re-export block): 24
exported (12 types, 4 constants, 8 functions) and 37 private. The two
isometric types are re-exported by the barrel from the original specifier, so
the module identity is unchanged.

## Destination map (review decision)

| Module | Contents | Projected lines |
|---|---|---|
| `tools/snapping.ts` (entry) | explicit re-export of the 24 original names + the two isometric type re-exports | 65 |
| `snapping/types.ts` | 12 interfaces/types, 4 constants, `SnapTargetInput`, `NormalizedSnapTarget` | 178 |
| `snapping/targets.ts` | broad-phase/filter/normalize plus the tolerance helpers | 195 |
| `snapping/stickyLock.ts` | lock construction/matching/scope, `tryStickyAxis`, `resolveAxisSticky`, `createSnapSession` | 125 |
| `snapping/candidates.ts` | `SNAP_PRIORITY`, `compete`, `findClosest`, `findClosestGap`, `formatSnapValue`, `SnapCandidateState` + factory | 130 |
| `snapping/grid.ts` | `snapCoordToGrid`, `snapPointToRotatedGrid`, grid/layout-grid/pixel-grid candidate families | 160 |
| `snapping/guides.ts` | line/segment candidate builders + ruler-guide and authored-layout-guide families, source-feature constants | 245 |
| `snapping/objects.ts` | midpoint, object edge/centre, and spacing candidate families | 255 |
| `snapping/position.ts` | `snapPosition` orchestrator: init, joint-layout collection, isometric, sticky resolution, joint override, matches | 170 |
| `snapping/resize.ts` | `snapSize` plus the resize-axis resolver family | 215 |
| `snapping/selectionBox.ts` | `snapSelectionBox` verbatim | 386 |
| `snapping/pageTargets.ts` | `pageSnapTargets` | 14 |

Every file is expected under the 400-line cap; the entry is thin. If any final
file exceeds 400 lines, the extraction is rejected and re-cut before staging.

## snapPosition sub-split design (680 lines)

The function is a flat sequence of candidate families writing eight accumulator
locals (`bestXDiff/bestXSnap/bestXGuide/bestXPriority` and the Y equivalents),
then sticky resolution, a joint-layout override, and a matches projection. The
split preserves the exact family order and accumulator semantics:

1. `candidates.ts` introduces `SnapCandidateState` (immutable `x/y/w/h/thresh/
   cx/cy/edges` plus the eight mutable accumulator fields) and
   `createSnapCandidateState(x, y, w, h, thresh)`, which initializes the
   fields exactly as lines 740-751 do (`bestXSnap = x`, `bestYSnap = y`,
   diff `Infinity`, priority `-1`).
2. Extracted in the original execution order, each mutating the same state:
   - `grid.ts` `applyGridCandidate` (from lines 761-802),
     `applyLayoutGridStepCandidate` (804-842), `applyPixelGridCandidate`
     (896-935);
   - `guides.ts` `applyLayoutGridLineCandidates` (844-881),
     `applyRulerGuideCandidates` (937-996);
   - `objects.ts` `applyMidpointCandidates` (998-1070),
     `applyObjectEdgeCandidates` (1072-1128),
     `applySpacingCandidates` (1207-1314).
3. `stickyLock.ts` `resolveAxisSticky(axis, rawCoord, proposedCoord, guide,
   lock, release, sticky, activeTargets)` is a 1:1 mapping of the original
   X/Y resolution branches (1175-1201) and the spacing re-resolution
   (1316-1331), returning `{ coord, lock, pushGuide }`.
4. `position.ts` keeps: signature and initialization, raw-intent override,
   normalization/active-target filtering, the joint-layout segment collection
   (883-894), the isometric block (1130-1173), the joint-layout override
   (1333-1354), the matches projection (1356-1372), and the return.
5. The literal candidate code is copied verbatim except for the mechanical
   parameterization `x -> state.x`, `y -> state.y`, `w -> state.w`,
   `h -> state.h`, `thresh -> state.thresh`, `cx -> state.cx`,
   `cy -> state.cy`, `edges -> state.edges`, and
   `bestXDiff -> state.bestXDiff` (and siblings). Order, comparisons,
   priorities, labels, and return objects are unchanged.

New internal declarations added by the extraction (not re-exported): 1 interface
`SnapCandidateState` and 10 functions (`createSnapCandidateState`,
`applyGridCandidate`, `applyLayoutGridStepCandidate`,
`applyPixelGridCandidate`, `applyLayoutGridLineCandidates`,
`applyRulerGuideCandidates`, `applyMidpointCandidates`,
`applyObjectEdgeCandidates`, `applySpacingCandidates`,
`resolveAxisSticky`). Each has exactly one home.

`snapSelectionBox` (374 lines) is not sub-split: with its module header and
imports it is expected at about 386 lines, in the 350-400 target band and under
the cap. `snapSize` stays reachable through the barrel and is imported by
`selectionBox.ts` (same module graph, no duplicated body).

## Before and expected-after declaration sets

Before: 61 top-level declarations (24 exported, 37 private) in one 1,982-line
file; the barrel path `tools/snapping` exports 24 names plus 2 re-exported
isometric types.

After: the same 61 declarations exist exactly once across the destination; the
barrel at `tools/snapping.ts` exports exactly the same 24 names plus the same
2 type re-exports; 11 new internal declarations exist (one home each, not
re-exported); no declaration is renamed, deleted, or duplicated.

## Planned non-move edits (counted; no behavior change)

1. Import preambles in the 11 new modules and the barrel; `@varve/*`
   specifiers unchanged, `./isometricSnapping` rebased to
   `../isometricSnapping` inside the destination directory.
2. `snapPosition` inline candidate families replaced by the strategy calls in
   the same order, and accumulator references rewritten to
   `state.`-qualified fields as listed above.
3. The duplicated X/Y sticky-resolution branches and the spacing re-resolution
   replaced by `resolveAxisSticky` calls with identical branch semantics.
4. Barrel re-export list (explicit named exports, no wildcard).
5. Private helpers that a sibling module imports gain a module-level `export`
   (the targets tolerance helpers and `normalizeSnapTargets`, the candidates
   utilities, the grid coordinate helpers, `closestSegmentSnapCandidate`, the
   resize helpers/types, and `NormalizedSnapTarget`); none is re-exported by
   the barrel, so the public surface is unchanged. This is the only visibility
   change.
6. No test edit, no name/string/behavior edit, no new feature or state.

## Edge-case answers (from GAP_ANALYSIS.md)

- Module-scope constants: `SNAP_PRIORITY` -> `candidates.ts`;
  `VERTICAL_SOURCE_FEATURES` / `HORIZONTAL_SOURCE_FEATURES` -> `guides.ts`;
  exactly one copy each.
- tsconfig/package surface: destination stays in `packages/editor/src`; the
  editor package exports are unchanged; `./tools/snapping` resolves to the
  file, not the directory.
- Imports: rebased only where the directory depth changed; biome sorts
  preambles only.
- Identity: the 24 exported names and the 2 isometric types remain importable
  from the same specifier; the solver return shape and guide fields are
  unchanged.
- Helpers: one home per helper; no duplicated bodies between `position.ts`,
  `grid.ts`, `guides.ts`, and `objects.ts`.
- Baseline: exactly `packages/editor/src/tools/snapping.ts` leaves; the
  covering test is untouched; no `--force`.
- Rollback: the seam is uncommitted until step 8; discard only this worktree.

## Proof plan

1. `refactor-verify --base master --target tools/snapping.ts --dest
   tools/snapping/` exits 0 with `missing: []` and `missingExports: []`
   before tests run.
2. Covering suite: 64 tests passed before and after, 0 failures, no test edit.
3. Direct tsc: 20/20 packages pass, desktop 0 diagnostics, e2e 0 diagnostics.
4. `pnpm exec biome check --write` then `pnpm exec biome check` on the
   changed files.
5. `wc -l`: the entry and every destination module at or under 400 lines.
6. `audit-file-size --update`: 950 -> 949, exactly one removed entry, 0 added,
   0 grown; then `pnpm audit:filesize` exit 0.
7. Stage, `pnpm agent:map`, `pnpm verify:commit`, one commit.

## Visual surface statement

**No visual surface changed.** This is a pure TypeScript module move in
`packages/editor/src/tools`; it renders nothing and changes no DOM, canvas,
style, or snapshot output. The proof is the unchanged
`packages/editor/src/tools/__tests__/snapping.test.ts` suite (64/64 pass
before and after) plus the `snapParity` solver parity test. Visual validation
(prompts 03/04) is not triggered.

## Rollback

The seam is uncommitted until the commit step. A failed extraction is abandoned
by discarding only `.worktrees/B-06` changes for the paths this task created or
edited, or by leaving the worktree unmerged for review. The shared main checkout
is never reset and a partial seam is never committed. If the baseline cannot
ratchet down, stop before committing.

## Execution results (measured after the move)

- **Verifier.** `node scripts/quality/refactor-verify.mjs --base master
  --target packages/editor/src/tools/snapping.ts --dest
  packages/editor/src/tools/snapping --json` -> `{"ok": true, "baseCount": 61,
  "presentCount": 72, "missing": [], "missingExports": []}`, exit 0. It was run
  before tests and again after biome; both runs identical. The 11 extra present
  declarations are the planned internal extraction helpers.
- **Covering suite.** Before: 64 passed / 0 failed (27.33s). After: 64 passed /
  0 failed (first post-move run 10.99s, post-biome run 9.75s). The covering test
  file is unmodified and still frozen at 827 lines.
- **Regression suites.** `isometricSnapping.test.ts` 15 passed / 0 failed
  after the fix described below; `snapParity.bench.test.ts` 4 passed /
  0 failed. The isometric suite caught one extraction regression: the first cut
  let the new sticky resolver fallback overwrite the joint isometric translation
  with the raw coordinate. Fixed by returning an `applied` flag from
  `resolveAxisSticky` and only assigning the resolved coordinate/session when a
  branch applied (the original inline branches left `snappedX`/`snappedY`
  untouched in the fallback); all three suites then passed.
- **Differential fuzz vs the pre-split module.** A temporary test imported the
  pre-split `snapping.ts` from `HEAD` and the new barrel and compared outputs
  with deep equality: 400 random `snapPosition` cases (grid, layout grid, layout
  guide segments, pixel grid, ruler guides, authored layout targets, random
  sticky sessions/raw intents/exclusions, identified and legacy targets), 400
  random `snapSelectionBox` cases (all handles, centred/proportional resize,
  grids, line targets, segments, rotation), and 300 random cases for
  `snapSize`, `snapTargetSearchRect`, `filterSnapTargets`, and
  `filterSnapTargetEntries` - all output-identical, 0 mismatches. The temporary
  test and the pre-split copy were deleted; neither is staged or committed.
- **Static checks.** Direct tsc substitute for the queue-EROFS `check:agent`:
  before 20/20 packages pass, desktop exit 0 with 0 diagnostics, e2e exit 0 with
  0 diagnostics; after 20/20 packages pass, 0 fail, desktop exit 0 with 0
  diagnostics, e2e exit 0 with 0 diagnostics (diagnostic logs empty both times).
  Biome: `check --write` fixed 9 files (formatting/import order only), then
  `check` reported 12 files checked with no fixes.
- **Final module sizes (wc -l).** entry 31; types 169; targets 195; stickyLock
  123; candidates 159; grid 155; guides 240; objects 244; position 292; resize
  213; selectionBox 394; pageTargets 17. Total 2,232 lines including the barrel;
  every file at or under 400 lines, the entry is thin.
- **Ratchet.** `node scripts/quality/audit-file-size.mjs --update` wrote 949
  frozen files: added 0, grown 0, removed 1. The baseline diff removes exactly
  `packages/editor/src/tools/snapping.ts: 1982` and nothing else.
  `pnpm audit:filesize` exit 0 at 949. Report after the move: 6,203 source
  files scanned; 949 over the 400-line cap; 949 frozen; 0 stale; 0 violations;
  0 untracked WIP over-cap; 303,929 excess lines (305,511 -> 303,929; the
  1,582-line drop is the removed entry's over-cap contribution 1,982 - 400).
  The covering test remains frozen at 827 and untouched.
- **Public API.** The barrel at the same specifier exports exactly the original
  24 names (12 types, 4 constants, 8 functions) plus the 2 isometric type
  re-exports; every importer and the covering test keep the same import path.
