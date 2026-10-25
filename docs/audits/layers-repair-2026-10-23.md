# Layers workflow repair — 2026-10-23

Status: **in progress, not integration-certified**. Working branch
`fix/layers-panel-repair`, isolated worktree `.worktrees/layers-repair`, base
`f607059a7918a341a6c784d76fdc10428c08b706`. Do not clean up or merge before the
browser, affected-validation, and review evidence below is complete.

## Scope and approved direction

Repair the complete find → understand → select → organize workflow, not only
individual controls. Preserve the existing tokens, themes, scene, history,
camera-navigation policy, and unrelated work. Include in-app help, public docs,
marketing claims, reviewed imagery, progressive commits, code review, integration
into `master`, and removal of only the clean, confirmed-integrated task worktree.

The user explicitly approved **Row-first + selection check** in this task:
remove the hover grip; direct row drag for structure, Shift+drag for a range;
one thumbnail-or-type identity slot with a selected check. Keyboard and tap/menu
alternatives remain. No rebrand or new design tokens are authorized.

## Research (2026-10-23)

Captured with Playwright and inspected as images, under the ignored
`reports/layers-repair/reference/` directory:

- [Cloudscape tree playground](https://cloudscape.design/components/tree-view/?tabId=playground):
  visible disclosure + type + name; no separate grip. Useful hierarchy anatomy,
  not an artwork editor or evidence for Varve's drag semantics.
- [Photopea editor](https://www.photopea.com/): created a blank local document and
  inspected the actual Layers panel (one selected Background row). Eye +
  thumbnail + name + lock, no grip. Do not transfer its density, platform
  shortcuts, or raster-only workflow.
- [Krita Layers docker](https://docs.krita.org/en/reference_manual/dockers/layers.html):
  inspected the vendor's illustrated panel and operations sections. Useful
  separation of state, hierarchy and operations. Do not transfer raster-only
  controls or interpret a documentation image as a current interactive test.
- [Penpot Layers guide](https://help.penpot.app/user-guide/designing/layers/):
  page captured; full-page image is too reduced for exact row-property claims.
  Its text is supplemental workflow evidence, not measured spacing.
- Figma Community public scouting ([Alternate Layers Panel](https://www.figma.com/community/file/1072151673138050560/alternate-layers-panel-figma)
  and [ThumbLayer](https://www.figma.com/community/plugin/1425904716752106703/thumblayer-layers-with-thumbnails-preview))
  returned CloudFront **403** in Playwright. No unseen Community frame or
  inaccessible Figma behavior is claimed as inspected.
- [dnd-kit PointerSensor guidance](https://github.com/dnd-kit/docs/blob/master/api-documentation/sensors/pointer.md)
  and [TouchSensor guidance](https://github.com/dnd-kit/docs/blob/master/api-documentation/sensors/touch.md):
  touch scrolling requires a distinct delayed touch sensor for full-row drag.

Presented routes: (1) row-first + check (approved); (2) selection rail, keeps
space cost; (3) persistent grip, smallest change but no recovered width. The
approved route preserves Varve typography/color/density and its existing
navigation; it changes gesture ownership and the row composition. Reference
patterns are inspiration, not proof of usability or permission to copy assets.

## Acceptance / remaining evidence

| ID | Acceptance | Status |
| --- | --- | --- |
| L1 | Search, counts, result selection agree, including Unicode and ancestry | **Verified** — workflow journey green (`workflow-spec-rerun3` 3/3: multilingual search, count agreement, Select-matches excluding ancestors, bulk undo);12 unit-file lanes green in `affected-final` |
| L2 | Filter membership updates after node and document-metadata edits | **Verified** — live-change tests red on baseline, green here; animated-asset membership green in `affected-final` |
| L3 | Focus/selection/rename/arrange preserve identity and one-step history | **Verified** — rename journey green after the roving-focus guard (rename cycle, blur commit, filtered bulk undo); `layers.spec` keyboard-reorder green |
| L4 | Row dragging and Shift-range do not compete; touch scroll and hold-drag work | **Verified** — plain/Shift pair green (`9776654eb` lanes re-run in chains); touch3/3 (`touch-spec7`) |
| L5 | Preview/commit agreement on master/isolation and bounded thumbnail work | **Verified** — resolver/unit suites green incl. master empty-space root; preview budget tests green; browser invariant/dnd suites green |
| L6 | Readable responsive hierarchy and visible states across themes/content | **Verified** — matched before/after matrix captured and inspected (evidence table above); row overflow strictly reduced |
| L7 | Truthful docs/help/marketing, reviewed screenshots/provenance | **Verified** — docs/help/website assertions green (`website-feature`2/2, `audit:docs` clean); product capture promoted and validated |
| L8 | Affected validation, separate code review, integrated SHA and clean cleanup | `verify:affected` **exit0** on final state; architecture audit exit0; requirements + standards review passes recorded. **Open:** merge, integrated-SHA validation, worktree cleanup |

## Evidence already obtained

- First functional commit: 451 tests in 35 Layers files passed before the
  row-composition change; not evidence for the final branch.
- Commit checkpoints passed on six progressive commits through `6f5ff78e1`.
  These are bounded checks, not a substitute for `verify:affected`.
- Editor typecheck and E2E typecheck have passed at intermediate states.
- `layers-dnd.spec.ts`: 6 passed, 1 failed against the former unmodified-scrub
  expectation. That expectation was explicitly replaced with the approved
  plain-drag / Shift-drag pair; the replacement has not yet run successfully.
- Both website builds completed (126 routes); no website browser pass yet.
- Token, radius, emoji, docs, committed-import audits passed at intermediate
  states. Fresh audits are required after remaining edits.
- `verify:affected` was interrupted by server restart; **no pass claimed**.

## Recovery / current slice

### Resumed checkpoint

- Additional unit checks for normalized/punctuation-aware search, stale kind
  entries, animated assets, and lazy wide-child traversal have been added.
  Do not claim their results before the affected run reports them.
- `layers-touch.spec.ts` drives Chromium's real touch input via CDP: swipe
  scrolling, hold/reorder/undo, touch cancellation, and nested-control ownership.
  This is a new spec, not yet verified. Pen activation has unit coverage only.
- `layers-feature.spec.ts` now asserts the approved row/Shift-drag wording and
  the `master` documentation link. The previous test did not actually assert an
  obsolete range heading; the earlier handoff's claim was inaccurate.
- Docs now distinguish Varve's approved Shift gesture from observed reference
  anatomy, retain pen activation, and describe Select matches as actual matches
  rather than all context rows. No claim of universal reference-tool gestures.
- `git diff --check` passed in this resumed slice.

### Review follow-ups — implemented, tests added, run pending

1. **Count scope.** `resolveTreeRootIds` in `useFlatTree.ts` is now the single
   root-resolution contract for `flattenTree`, the badge counts, and the batch
   rename list; `resolveLayerTreeScope` (in `layerCounts.ts`) is the single
   derivation shared by `index.tsx` and `LayersTree.tsx` (it replaced the
   tree's inline `pageSurface` rule and the count's separate
   `workspaceMode !== 'print'` rule). Scope now includes isolation and master
   editing. Tests: `layerCounts.test.ts` — isolation subtree, master source,
   derivation, and a count-equals-treerows agreement assertion per scope.
2. **Master empty-space drop.** `rootParentId` threads LayersTree →
   `useLayersDnD` → `resolveLayerDropTarget`, so empty space below the last
   row lands at the master content root (raw index 0, visual bottom) instead
   of a null parent that commits to the page/canvas root. Isolation
   blank-space semantics were deliberately left unchanged (separate existing
   contract). DnD `designCanvasId` now reads the same projection scope.
   Test: `layerDropResolver.test.ts` — "keeps an empty-space drop below the
   rows inside the master", plus the default page-root contract.
3. **Reserved search namespace.** Full authored names moved out of
   `wordIndex` into `LayerSearchIndex.fullNames`, so punctuation-bearing
   queries (`icon/24`) still match while a layer named `kind:text` can never
   answer the `kind:` metadata query. `matchesLayerSearch` and `searchIndex`
   consult the same two sources. Tests: `layerSearchIndex.test.ts` —
   namespace-collision case and the index/predicate alignment matrix.

Active commands:

| Operation | Command / evidence | State |
| --- | --- | --- |
| Committed-delta validation | `pnpm verify:affected --since f607059a7…` → `reports/layers-repair/affected-since-base.log` | Cancelled by a server restart mid-`js-unit:@varve/editor` (no `.exit` receipt). Lanes with individually logged `[PASS]` in that attempt: all Tier 0 audits, typecheck:e2e/@varve/website/@varve/editor/@varve/desktop, and the10 `js-unit:file:` Layers lanes through `world.test.ts`, plus `js-unit:@varve/website`. Its six committed-delta E2E files were instead completed by the dedicated browser chains below (all green). |
| Working-tree validation, attempt1 | `pnpm verify:affected` → `reports/layers-repair/affected-default.log` / `.exit` | **FAILED at `js-unit:@varve/editor` with `Error: ENOSPC: no space left on device, write`** — environment, not code:915 test files passed,5 unrelated files failed on writes. All Tier 0, all typechecks and all12 unit-file lanes logged `[PASS]` first. |
| Working-tree validation, attempt2 | `pnpm verify:affected` → `reports/layers-repair/affected-default-2.log` / `.exit` | FAILED only at `e2e:file:layers-repair.spec.ts` (the rename-cycle investigation below); everything else green including `js-unit:@varve/editor` (920 files) and the visual spec. |
| **Working-tree validation, FINAL** | `pnpm verify:affected` → `reports/layers-repair/affected-final.log` / **`.exit = 0`** | **PASSED — all 27 lanes,3179.0s**: Tier 0 (format, lint, emoji, docs, radius), five typechecks,12 unit-file lanes, `js-unit:@varve/editor/help/desktop`, browser lanes `layers-panel-real-world`, `layers-repair-visual`, `layers-repair`, `layers-touch`, and `website-e2e:files` (2 passed). This is the single clean receipt over the final source state. |
| Committed-delta browser chain | `playwright` ×6 files → `reports/layers-repair/committed-e2e.log` / `.exit` | 35 passed before `layers-panel-real-world` hit the Missing Fonts overlay (classified pre-existing/device-dependent); `layers-dnd-demo`, `layers-dnd-invariant`, `layers-dnd`, `layers-drag-drop` **fully green** |
| Real-world + core follow-up | → `committed-e2e-2.log` / **`.exit = 0`** | **27/27 passed** after the conditional overlay dismissal (real-world's remaining12 tests incl. row-drag reorder + the full APG `layers.spec`) |
| Touch input evidence | → `touch-spec7.log` / **`.exit = 0`** | **3/3 passed**: swipe, hold/reorder/undo, cancel + control ownership |
| Website feature E2E | → `website-feature.log` / **`.exit = 0`** | **2/2 passed** (ghpages + custom-domain) |
| Original responsive capture | Baseline worktree, phase=baseline, port1465 → `reports/layers-repair/baseline-visual.*` | **PASSED (exit0,59.7s)** after the import-overlay fix;25 artifacts archived |
| Repaired responsive capture | Repair worktree, port1463 → `reports/layers-repair/after-visual.*` | **PASSED (exit0,1.4m)** including grip-absent + check-present assertions;25 artifacts archived |
| Architecture audit | `node scripts/audit-architecture.mjs --ci` → `reports/layers-repair/architecture.*` | **PASSED (exit0)**:14 distinct cycles (ceiling17), cycle identities hold,0 layer violations; unstable/unused reported-only; Shell/Menubar/context budget warnings are known pre-existing (no hub file in this change set). One allowlisted engine cycle (`replay.ts → shadowSource.ts`) no longer present — noted for a future `--update`, not run here. |

**Sequencing — completed stages:** (1) committed-delta E2E chains: green
(receipts `committed-e2e.*`35 passed for the dnd family + `committed-e2e-2.*`
27 passed for real-world/`layers.spec`); (2) product imagery: captured,
inspected, promoted (below); (3) remaining: commits → integration →
integrated-SHA validation → cleanup.

### Master merge — parallel Layers work and the approved resolution

While this task ran, master received a parallel Layers overhaul (10-22→10-23:
`0cb323090` tree height of the rail, `96b28bc5c` keyboard-find search with one
filter menu, `8e27ed4a9` name-room row toggles, `416da8059` auto-reveal
duplicate removal, `bba8a84a7` **type icon as the reorder handle**, plus
colour-vision, rail-alignment, scrollbar, responsive filter bar, preview zoom
and 13px text scale). A user decision was sought rather than silently picking
a side: **the approved Row-first model stands**; master's compatible polish is
kept.

Merge `106add5b7` resolved 16 conflicts: row-first everywhere the models
collided (row drag, Shift-range, selection check, identity slot, docs and
specs), master's polish kept (responsive filter bar, preview dblclick zoom,
text scale, colours, tree height, rail alignment, auto-reveal duplicate
removed — superseding the crosshair icon change), and one search contract:
`nodeMatchesSearch` now delegates to `matchesLayerSearch`, with `ownMatchIds`
aliased to the tested `selectMatchingEntryIds` list so master's find-stepping
reads the same matches. Master advanced again during validation (`e6a7f154b`,
zero overlap); merge `32e5ba369` brought it in cleanly. An intermediate run was
deliberately superseded (not failed) so a single validation would certify the
final tree.

### Final-tree validation and the two pre-existing test defects

`pnpm verify:affected --since e6a7f154b` (`final-affected.log`) passed every
lane — Tier 0 audits, all five typechecks, all 14 unit-file lanes,
`js-unit:@varve/editor/help/desktop/website`, `website-unit`, and the
`layers-dnd-demo`, `layers-dnd-invariant`, `layers-dnd`, `layers-drag-drop`
browser files — before failing only on `layers-panel-real-world.spec.ts`.

That file's two failures were diagnosed with a master-check worktree
(`.worktrees/layers-master-check` at `e6a7f154b`) and a drag probe, and both
are **pre-existing test defects, not product defects**:

1. **Row toggles (target size)** — master's name-room CSS collapses idle
   fine-pointer toggles to zero width *by design* (revealed on hover), while
   master's own probe measured idle rows and demanded 24px. The probe now
   hovers an idle row first and measures the revealed state (the state a
   pointer user reaches). The follow-on focus probe was likewise stale against
   master's own filter-bar refactor (chips now precede the options toggle) and
   now asserts focus stays inside the filter bar with a visible 2px ring.
2. **Drag reorder** — the drag probe proved the product correct:
   `elementAtDown: layers-row__label`, overlay activates, resolver returns
   `drop-after + invalid` because the old target (fourth row) is a
   *descendant* of the dragged container — a cycle refusal exactly as
   documented. The test now reorders two root siblings and asserts the exact
   result *including subtree interleaving* (Tab Bar first, its Profile/Saved
   children intact, photo following the subtree).

Both master and repair reproduced these reds (master additionally behind the
Missing Fonts overlay that this branch's spec already dismisses); their shared
test/CSS/feature commits were never exercised by a complete E2E pass because
CI has been unavailable. Evidence: `master-check.*`, `classify-repair.*`,
`drag-probe.*`, `fixed-pair.*` receipts.

Full-directory result (`all-layers-e2e.*`): **28 passed / 3 failed** —
including the repaired real-world lane (all 14 green) and this branch's whole
new suite; the three failures are all in master-owned, never-fully-run specs:

- `context-menu.spec` scrollbar `'thin'` assertion — stale against master's
  own `570ffa383` (retired `scrollbar-width` on WebKit/Chromium). Fixed to
  measure the real ::-webkit-scrollbar track; committed in `74ae1913c`.
- `effect-stack-transfer.spec` ×2 — **resolved after root-cause** (below);
  verified green.

**Classification receipts:** `verify-contextmenu.*` (my scrollbar fix, exit 0),
`effect-classify-repair.*` and `master-check-effect.*` (both trees failed
identically at activation → pre-existing shared defect, not branch-introduced).

### Effect-stack transfer — root cause and fix (pre-existing on master)

The badge drag never activated: probes (`effect-probe*.log`) showed the press
point resolved to the **visibility toggle**, not the badge, so the badge's
dnd-kit handler and `handleDragStart` never ran (`badgeProbe: null`,
`dragStartProbe: null`, no overlay, no page errors). The wiring itself was
sound — `Tooltip`'s `composeHandlers` runs the badge handler first and its
`stopPropagation` cleanly suppresses Tooltip's own handler; `DesktopPointerSensor`
declines only touch.

The cause is master's **name-room design** (`8e27ed4a9`): an idle fine-pointer
row collapses its default-state toggles, and they expand to 24px on hover,
shifting the badge ~57px left (geometry: badge `x=137`, press point landed on
toggle `x=194`; `hovered: true`). The spec measured `badge.boundingBox()` while
idle, then `mouse.move` to that point triggered the reveal, moving the badge
out from under the stale coordinate. Master's own change broke this older spec,
and it never failed visibly before because the tests failed at activation
earlier (CI unavailable), so the later snapshot line was never reached.

Fixed in `dragEffectStack`: hover the badge and settle first, then measure;
additionally re-verify via `elementFromPoint` that the measured center is the
badge before pressing. This is the same measure-after-hover-settle guard that
fixed the touch suite. The drag then activates fully — overlay shows
`Copy`/`Append`, the target gets `layers-row--effect-stack-drop`, and the
`Replace/Append <Stack>` label appears.

That advance exposed **stale `toHaveScreenshot` baselines** (expected 592px, got
620px): master's intentional tree-height (`0cb323090`) + 13px text scale
(`4bdd70eb6`) grew the panel, and since activation was always broken the
snapshot line never regenerated. Regenerated 3 baselines at 620px and
**inspected them**: correct mid-drag state (source selected with hover-revealed
toggles + badge, target with orange drop indicator, `Copy 1 Object Filter`
overlay). `effect-stack-transfer.spec` now **6/6 green** (`effect-regen.*`,
`effect-verify.*`, exit 0).

### Full-directory run surfaced three more pre-existing/master-owned failures

An unfiltered full-directory pass (`all-layers-e2e-2.*`) ran **160 passed /
3 failed** (earlier `--max-failures=3` runs had stopped at the context-menu/
effect-stack failures, so `layer-workflows` and `layers-search` never ran).
All three were classified against the master-check worktree — **all pass on
master** — then diagnosed and fixed:

1. **`layer-workflows` reorder (`Control+[` expected forward)** — the Layers
   tree intercepts `Ctrl+[`/`Ctrl+]`. Master's tree had the two **reversed**
   (`[` → front-most), contradicting its own global registry
   (`bringForward: Ctrl+]`, `sendBackward: Ctrl+[` — `ShortcutManager.ts:192-193`)
   and the Arrange menu. This branch **aligned the tree to the registry**
   (recorded earlier as a fix: "the previous branch had the two keys
   reversed"). `layers-dnd.spec` + `layers.spec` (both green) already encode
   `]`=forward / `[`=backward; `layer-workflows` was the lone stale spec
   using `[` for forward. **Fixed the test to `Control+]`** (the real Bring
   Forward binding). Verified green (`fix3-verify.log` #4).
2. **`layer-workflows` inherited-lock name** — this branch added ancestor
   naming (`lockingAncestorName` → "locked by Group"), an a11y improvement
   mirroring inherited-visibility naming; master only ever said the generic
   "locked by an ancestor". **Test regex widened to
   `/locked by (an ancestor|Group)/i`.** Verified green (#6).
3. **`layers-search` `'ard'` fragment** — master's `96b28bc5c` test hardcodes
   the **prefix** rule (mid-word fragment → 0 rows, F-51); this branch's
   approved **substring** contract makes `'ard'` match every "Card" name (the
   fixture is all `Card N …`, so all 320 match — count `320 of 320`). Same
   prefix-vs-substring conflict already resolved in `layerFilterTypes.test.ts`
   at the unit level. **Test rewritten to assert substring** (parse leading
   count > 0 for `'ard'`, `^0 of` for an absent fragment — the old
   `.not.toContain('0 of')` false-positived on `"320 of"`). Verified green
   (`search-fix.*`, exit 0).

The `layers-search` latency test (~320 layers, median < 100 ms) failed once at
118 ms under load but is **green in both the full run and the isolated re-run**
(`search-fix.*` #4) — load-dependent flakiness, not a regression.

**Validation of the final merged tree — green.** Master advanced again to
`6eca219c8` (an Inspector-pass merge); merged in as `dede4b943` (single
conflict in `getting-started.astro`, resolved by keeping this branch's
"Layers panel (left rail)" wording and master's inspector shortcut line; the
other overlaps — `layers.css` text-scale, `layers-drag-drop.spec`
`getByLabel`→`getByTestId`, `DESIGN.md` — auto-merged as compatible polish,
no icon-handle collision). Post-merge:

- **`pnpm verify:affected` → exit 0** (`affected-post-cache.*`): Tier 0
  audits, typecheck:e2e/editor/desktop, `layerFilterTypes` +
  `layerSearchIndex` units, full `js-unit:@varve/editor` + desktop, and the
  effect-stack browser lane.
- **Full-directory Layers pass → 164 passed / 0 failed, exit 0**
  (`all-layers-definitive.*`) — all 28 spec files green together on the tree
  that will be integrated.

Two post-merge issues were found and fixed:

1. **effect-stack snapshots stale again (×4)** — master's `layers.css`
   text-scale/padding changes altered the panel after the first regeneration.
   Regenerated on the merged tree and verified 6/6 (`effect-regen-merged.*`,
   `effect-verify-merged.*`).
2. **Search typing latency — a real regression this branch introduced.**
   The merge unified the predicate on `matchesLayerSearch`, which recomputed
   `extractWords` for *every* node on *every* keystroke — losing master's
   WeakMap word cache. Classified against master under the same load (master
   median **93**/pass vs this branch **139**/fail, `master-latency.*` vs
   `latency-iso.*`), then fixed: `nodeMatchesSearch` now WeakMap-caches words
   + normalized name per node (the scene model is immutable, so renames
   recompute automatically) and both entry points share one `matchTerms` rule
   so substring and prefix paths cannot drift. Latency dropped to **86**
   (`latency-fixed.*`), matching master; 63 search/parity unit tests green.

### Integration — complete

- **Product imagery**: recaptured on the merged UI (`product-capture-merged.*`,
  exit 0; panel grew 539px → 831px with master's text-scale/tree-height
  changes), inspected (row-first model intact: check overlay, single identity
  slot, no grip, Multiply blend badge, opacity badges, responsive filter bar),
  promoted via `--sync-reviewed` + fresh 288-wide variants copied to both
  published dirs; `screenshots/validate.mjs` → **49/49 verified, zero
  layers-scoped violations**.
- **Three progressive commits landed**: `afb7aae3f` (search word cache),
  `7d7183c04` (regenerated effect-stack baselines + this checkpoint), and
  `3918d66ba` (product imagery), after `4d81e73dc` (four spec alignments) and
  merge `dede4b943`.
- **Integrated** into the shared checkout: `git merge --ff-only
  fix/layers-panel-repair` moved master `6eca219c8` → `3918d66ba` (= branch
  tip), exit 0, `HEAD == fix/layers-panel-repair`. Pre-checks: no in-progress
  git operation, index clean, shared dirty set **untracked-only** with **empty
  overlap** against the merge-touched files, and this branch does not change
  `pnpm-lock.yaml` vs master (so the shared checkout's `+9` automation-entry
  churn could not block the FF).
- **Integrated-SHA validation** `pnpm verify:affected --since 6eca219c8`
  (47 lanes): **46 green** — Tier 0 audits, all six typechecks, all 16
  unit-file lanes — failing only `js-unit:@varve/website` on
  `pages/features/realtime-collaboration.astro`, which is the **other agent's
  untracked WIP** (confirmed: never committed by this branch, absent from the
  integration diff, `??` in shared status) and is tripped only because the
  token scan reads files on disk in the shared checkout. Proven not ours by
  running the exact `tokens.test.ts` in this worktree (my committed code,
  their WIP absent): **119/119 pass, exit 0**. So the committed integration is
  green end-to-end.

**Next:** remove the three integrated task worktrees (`layers-repair`,
`layers-repair-baseline`, `layers-master-check`).

Also restored `pnpm-lock.yaml` after an environment-driven rewrite: another
agent's untracked `packages/automation` exists only in the shared checkout, so
a pnpm run in this worktree dropped its importer entry — committing that would
have damaged their work.

### Product imagery — captured, inspected, promoted

`pnpm screenshots:product -- --scenes layers --review-dir
reports/layers-repair/product-review` (exit0) re-captured `layers-light.png`
(288×539 panel crop, `capturedAt` 2026-10-24T14:55:46Z). Inspected before
promotion: selected Disc row carries the check overlay on its identity slot,
one identity slot per row, no grip column, eye/lock pinned, ellipsis
truncation, opacity chips intact — the approved model, truthful for the new UI.

Promoted via `--sync-reviewed --scenes layers` ("Synced1 reviewed captures;
other scenes preserved"). The sync copies the PNG + manifest only, so the
manifest's new288-wide variants were then copied to both published
directories and the four stale tracked `layers-light-317.*` files removed —
`screenshots/validate.mjs` afterwards reports **49/49 captured verified and
zero layers-scoped violations**. Residual validate findings are pre-existing
and out of scope: three `layout-native-dashboard-grid-*` references from
another task's audit (`docs/audits/layout-browser-visual-validation-2026-10-16.md`,
files this task never touched) and the cumulative-PNG-size WARN.

### Responsive before/after evidence (captured and inspected)

Both phases ran the same `layers-repair-visual.spec.ts` to completion against
real artwork (`layers-mobile-app.svg`), one worker, isolated ports:

- **Baseline** (`VARVE_LAYERS_PHASE=baseline`, exit 0, 59.7s): 25 artifacts
  archived at `reports/layers-repair/baseline/` (18 viewport×theme frames,
  5 rail widths, 200% text frame, `before-metrics.json`).
- **Repair** (exit 0, 1.4m): 25 artifacts at `reports/layers-repair/after/`,
  including the functional assertions `drag-handle count === 0` and a visible
  `.layers-row__selection-check`.

Inspected pairs and findings:

| Check | Result |
| --- | --- |
| Selection check | Present as an overlay on the identity slot of the selected row at every width (1280/899/375/rail); no name-column shift; the name gained ~4px (1280: `CTA Background` name box 72→76px) |
| Row capacity (metrics) | Baseline overflowed rows (`scrollWidth > clientWidth`): 14 at 768, 6 at 899, 5 at 900, 3 at 1280. Repair: **0** at 375/768/900/1024/1280 and 1 at 899 (`CTA Background` 249/242 — down from 269/242). Strictly better at every width |
| Residual 7px at 899 | Visually inspected: eye and lock remain fully visible on every row; the excess lands in self-clipping name/badge space, not on a control |
| Narrow drawer (375) | Opens via the `Show layers panel` FAB, names ellipsize, controls stay inside the panel, check visible |
| Minimum rail (180px, HC theme) | Identity + eye + lock reachable; name collapses per the documented ≤219px label-floor rule (same as baseline) |
| High contrast | Yellow-green accents correct; check renders black-on-yellow via `text-on-accent` |
| 200% text zoom | No broken chrome; scaled panel scrolls (same structural behavior as baseline) |

Capture noise (honest note, not panel defects): the repair 1280 frame contains
a first-run "Design workspace" toast and the 375 frame a lingering minimap
tooltip — timing-dependent first-run tips outside the Layers panel, present in
one phase's full-viewport frames only. The panel states themselves are matched
and unobstructed; no capture round was spent suppressing them.



### Rename dblclick investigation (workflow spec test 2) — resolved

Symptom evolution across reruns: (a) `dblclick` on Primary's name opened the
rename editor on **Secondary** (one row up); (b) after hardening, rename opened
correctly on Primary but Tab-cycle closed the editor entirely.

Evidence and classification:

- **Wrong-row: pre-existing, not branch-introduced.** Probe runs
  (`reports/layers-repair/rename-probe*.log`) reproduce the identical +44px
  shift and Secondary rename in the **baseline worktree**
  (`baseline-rename-probe.log`), and show it does not reproduce with a
  pre-click settle (`rename-probe4.log`, layout dumps identical before/after).
  Mechanism: the target row starts below the short (160px) tree fold; the
  dblclick's own scroll-into-view and a layout settle occur between its two
  clicks, so the second click lands one row off. The spec now **pre-selects the
  row (scroll + selection-driven layout settle) and waits for it to be in
  viewport** before the dblclick, and asserts the editor through the captured
  `data-node-id` — a name-based row filter stops matching its own row while
  editing, because the row renders the input *instead of*
  `.layers-row__name`.
- **Tab-cycle cancellation: real product defect, fixed.** The tree's roving
  focus-sync effect (and its retry loop) stole DOM focus from the freshly
  mounted rename input — child focus effects run before the tree's — firing
  the input's `onBlur={commitRename}` and closing the editor the instant the
  cycle moved `focusIdx` onto the editing row. Latent consequence of the
  earlier rename-cycle fix (which made Tab cycle at all). Fixed in
  `LayersTree.tsx`: the sync effect now yields while
  `.layers-row__name-input` owns focus. Verified:104 tests across
  renameCycle/renamePersistence/LayersRow/useFlatTree green, then the full
  workflow spec **3/3 green**
  (`reports/layers-repair/workflow-spec-rerun3.*`, exit0).

Temporary `_rename-probe.spec.ts` deleted after diagnosis.



### Touch gesture evidence — 3/3 green (with diagnosis trail)

`tests/e2e/layers/layers-touch.spec.ts` **passed 3/3**
(`reports/layers-repair/touch-spec7.*`, exit 0): swipe scrolls without
reordering (plus Home-key return to the first row), hold → preview → commit →
single undo, and touch-cancel + nested-control ownership (held visibility
control toggles instead of dragging).

The road to green was diagnostic, each finding recorded in
`rename-probe*/touch-probe*/touchmove-probe*` logs:

1. **Sticky bulk bar + squeezed sidebar** — `.layers-bulk-bar` is
   `position: sticky` and overlaps the tree's lower rows; in the desktop
   sidebar with touch-sized chrome the tree collapsed to ~0–40px, so measured
   touch points landed on the bar/panel background and never reached the row
   (`elementFromPoint` evidence; `hits: []`, no 250ms sensor timer armed).
2. **Touch path premise corrected** — gestures now run on the product's touch
   path (tablet layout, `layoutPreference: 'tablet'`, Layers panel opened via
   its FAB, 1024×768), where the tree is genuinely usable (~138px — the real
   product state, guarded at ≥100px fail-fast rather than an idealized 150).
3. **Hit-target verification** — `clearRowHitTarget` centers the row across
   all scrollable ancestors, then re-verifies with `elementFromPoint` until the
   point resolves *into* a treeitem (nudging tree scroll for the bar's band).
   Sources moved to the top rows, which sit clear of the bar.
4. **Correct multi-selection semantics** — the import leaves all roots
   selected; dragging then carries the whole selection and every row is a
   (correctly) cycle-invalid target (`zone: 'into', reason: 'cycle'` — the
   self-selection branch), so no valid drop ever existed. The spec now selects
   the source alone first — the same setup the mouse drag suites use. This was
   product-correct behavior, not a defect.

Unit coverage for sensor split/coordinates (`dragInput.test.ts`) plus these
three browser journeys together close acceptance L4's touch half.

### Committed-delta browser suite

- `layers-dnd-demo`, `layers-dnd-invariant`, `layers-dnd`,
  `layers-drag-drop`: **all green** (32 tests in
  `reports/layers-repair/committed-e2e.log` up to the stop).
- `layers-panel-real-world`: first3 tests green; two failed with the
  **Missing Fonts dialog** intercepting pointers. Classified **pre-existing
  and device-dependent** (the fixture references fonts absent on this device;
  the dialog machinery predates this branch at `eddccf1da`, and this branch's
  only change to the spec swapped grip→row wording). Fixed with the same
  conditional `dismissImportOverlays` inside `importFixture` — rerun of
  `layers-panel-real-world` + `layers.spec` in progress
  (`committed-e2e-2.*`).
- Website `layers-feature` E2E: **2/2 green across ghpages and custom-domain**
  (`website-feature.*`).



### Import overlays found via baseline capture (now dismissed by all three specs)

The first baseline capture failed because `tests/e2e/fixtures/layers-mobile-app.svg`
imports with fidelity changes and warnings, so the modal **Import Results**
dialog opens (screenshot: `test-results/run-651284-1465/.../test-failed-1.png`
in the baseline worktree: "6 layers inserted / 1 file imported with fidelity
changes / 1 file with warnings"). Closing it then revealed a second modal, the
**Missing Fonts** dialog (`.missing-font-dialog__overlay`, `role="dialog"`
label "Missing Fonts" — the fixture references families absent on this device).
Either backdrop intercepts every pointer event behind it. All three new specs
now run `dismissImportOverlays(page, timeout)`: conditional wait for Import
Results → footer **Close**, conditional wait for Missing Fonts → **Dismiss**,
then a straggler re-check and a final both-hidden assertion (5s timeouts for
the text-free workflow/touch fixtures, 15s for the complex visual fixture).

The touch spec additionally had two review-found defects fixed before it ever
ran: it asserted on `.layers-filter-bar__count`, which only exists while a
filter is active (now the always-present `.layers-panel__count` header), and
its post-swipe Home check assumed the unscrolled first mounted row without
scrolling first (now focuses a mounted row, presses Home, waits for
`scrollTop === 0`, then asserts `item-59`). Biome + `pnpm typecheck:e2e`
pass on the fixed specs.

Both capture phases subsequently passed end to end with this dismissal
(baseline exit 0, repair exit 0 — see the evidence table above).

**Consequence for validation ordering:** these spec fixes happened after job 1
computed its plan, but job 1 never reads them (untracked, outside `--since`),
so its inputs are unchanged. The default-scope run that follows will validate
the fixed versions.

Historical context checked: the dialog publish path
(`importReportHasIssues` gating, commit `eddccf1da`, 2026-09-13) predates this
task and is identical on baseline and repair — it is not branch-induced.
`layers-panel-real-world.spec.ts` imports the same fixture without dismissing
the dialog; job 1 will report whether that is currently red (pre-existing) or
whether some other path in it dismisses the report.

The first affected attempt stopped at `format:touched`: the ternary in
`LayersPanel/index.tsx` needed formatting. That formatting-only repair was
applied and `pnpm verify:plan` rerun; the plan selects 27 lanes with no
full-suite escalation. `--since f607059a7` selects the committed branch delta,
not pending/untracked files: both scopes must be covered before integration.

Frequent harness restarts and concurrent heavy-task owners interrupted captures
and validation. Keep command output in `reports/layers-repair/` and use a
task-owned disk-backed `TMPDIR`; never delete shared temporary caches or live
leases. Avoid piped `tail` commands that hide exit status and lose failure logs.

Current slice: the three review follow-ups are implemented with tests added.
Next: run format/lint/typecheck plus the plan's targeted unit files in the
foreground, then relaunch the lease-wrapped browser batch (workflow, touch,
responsive, baseline capture) and `verify:affected` with frozen inputs — no
production edits while any of them runs. After they report, inspect generated
images, update this record, and review the exact branch delta.

The shared `master` checkout remains separately dirty. Integration must preserve
its work; do not reset, stash or sweep its changes. Use an exact recorded base
for task validation (`--since f607059a7`) rather than the diverged remote range.
