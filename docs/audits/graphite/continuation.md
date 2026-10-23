# Continuation record

Read this first when resuming. It records what is done, what is verified, and
the exact next operation. Repository state can change; re-check `git status`
and the branch before acting.

## Where the work lives

- Worktree for the vector path/paint batch: `.worktrees/graphite-20261022`
- Branch: `graphite/vector-paint-interaction`, based on the actual remote
  `master` `eb1d23afd`
- Earlier corpus work: `.worktrees/graphite-corpus`, branch
  `feat/graphite-corpus`, base `origin/master`
  `2e8c5b018b00a85fde341a0acc3dc80cde042f83` (`varvedesign/varve`;
  `K-Arthur/varve` redirects here)
- The pre-existing main checkout was never modified by this work. It remains
  on local `master` with its own divergent history and uncommitted changes.

## Corpus state (frozen)

- C1 `2026-10-21T19:12:39Z`, C2 `2026-10-21T20:31:38Z`.
- 1,604 issues (1,603 from the REST listing plus `#426`, recovered from the
  single-issue endpoint because the listing and search omit it).
- 2,734 comments across all 1,604 threads; no unresolved access failures.
- C2 reconciliation: 0 new issues, 0 comment-count changes.
- Issue-set SHA-256:
  `2e93c325c8b1ade2aa0b73cdde3f94583ccc9ae89a83b13bc24c274475366921`.
- Raw cache: `~/.cache/varve/graphite` (not committed).

## Review state

- `issue-ledger.jsonl` holds one row per issue with research status and
  engineering status kept separate.
- Reviewed rows carry a disposition and reason from a full read of the body
  and every retrievable comment. Unreviewed rows are `unreviewed`; they are
  the resumable frontier.
- Per-issue reasons for large volumes of Graphene/node-graph/GPU-queue issues
  cite the absent subsystem rather than a blanket exclusion.
- Packets of 100 issues and their raw inputs are in the cache; the same
  packets can be regenerated with
  `node scripts/research/graphite.mjs packet --from <position> --size 100`.

## Engineering state

| Finding | Status |
|---|---|
| F1 Shift constrains movement to 45° steps (plus the Shift-press selection bug it exposed) | Implemented; unit + E2E evidence recorded in `findings.md` |
| F2 Enter confirms the New Design dialog | Implemented; jsdom evidence recorded |
| F2b Enter in the preset search must not create | Implemented after independent review found it |
| F3 Repeated nudges cost one undo each | **Blocked** on an amend/coalesce capability in the persistent revision store |
| F4 existing protections (zero-size geometry, marquee abort, Delete with a tool active) | Verified, no change needed |
| F10 stroke alignment reaches click targets | Implemented; unit + browser evidence recorded in `findings.md` |
| F11 clicking a selected anchor narrows the point selection | Implemented; unit evidence recorded in `findings.md` |
| F12 a pen draft never writes into changed geometry | Implemented; unit evidence recorded in `findings.md` |
| #2549 axis-aligned lines are directly manipulable | Verified already handled; browser evidence recorded in `README.md` and `findings.md` |
| Decorations-off Tauri window resize on KDE/Wayland | **Unverified**: needs a native build and interactive resize test |

## Next operation

The vector path batch (F10–F12, #2549) is integrated. Remaining queued work,
in the order the corpus prioritises it:

1. **Paint rows (~27).** Start with #2445 (a gradient click/pointer-up must not
   re-select the end stop), #2524 (SVG `gradientUnits="userSpaceOnUse"` must
   resolve against the document, not `objectBoundingBox`), #3019 (dark fringing
   on semi-transparent brush strokes — measure the composited pixels, do not
   eyeball). For #2524 the importer already branches on `gradientUnits`
   (`packages/import/src/svg/elements.ts`), so the open question is narrower:
   user-space coordinates are used as if they were local to the node, and every
   current test places its target at the origin. A fixture with a rectangle at
   (200, 100) and a gradient from user-space x=200 to x=300 decides it.
2. **Interaction rows (~30).** #1107 (Inspector bindings after a saved-document
   reload — needs a real save/open round trip), #1851 (image gamma after reload;
   compare decoded pixels, not screenshots), #2372 (Shift-resize must keep its
   aspect ratio when snapping engages; the snap and the constraint currently
   compete in `SelectTool`'s resize path).
3. **UI/a11y rows (~13).** #1855/#1854 (tab reorder by dragging, rename from the
   tab — `TabStrip.tsx` has no drag state and renaming is Home-only), #2246
   (Ctrl-click in shallow-select mode must reach the deepest target when an
   ancestor is selected), #2383 (a preference for anchor/handle manipulator
   size; `NodeEditTool` draws fixed-size overlays today).
4. **The 220 `uncertain` rows.** Batch 20–30 at a time: inspect the Varve path,
   then promote with evidence or downgrade with a concrete reason. Do not mark a
   row `applicable-work-required` without naming the code path.
5. Re-run `pnpm verify:plan` then `pnpm verify:affected` for each batch, and
   record the Agent Validation Report in `README.md`.
6. After a merge is confirmed on `origin/master`, record the merge SHA in the
   ledger rows for that batch and verify the deploy when the change is
   user-facing.

## Known blockers and caveats

- **Pre-existing `@varve/editor` unit failures on `origin/master`** (verified on
  a pristine `6eebb9581` checkout, not caused by this batch):
  `components/IconBrowser/IconBrowserDialog.test.tsx` ("drops remote results
  and makes no further fetch after consent is revoked" — the fetch mock is
  called once more) and `__tests__/openFileDedupe.test.tsx` ("still opens a
  genuinely different file in its own tab" — one session instead of two).
  `components/LayersPanel/__benchmarks__/layers10k.bench.test.ts` also has a
  100 ms budget that this machine misses under multi-agent load (133-314 ms);
  it passes when run alone. Recorded so a later session does not attribute them
  to its own change.
- **Canvas coordinates are not stable across Inspector changes.** Selecting an
  object opens the contextual-properties row, which shortens the canvas
  viewport and shifts canvas-relative coordinates up by the same amount. A
  spec that samples pixels before and after a selection must re-anchor its
  expected rows against the canvas box measured in each state (see
  `tests/e2e/canvas/axis-aligned-line-drag.spec.ts`).
- **Repeated clicks on an already-selected object are a depth cycle.** A test
  that clicks to select and then presses immediately at the same point gets a
  cycle, not a move. Drag with one continuous press, or click empty space in
  between.
- Heavy browser validation shares one cross-worktree lease. Other sessions
  hold it for long lanes; queue with `VARVE_LEASE_TIMEOUT` rather than
  bypassing it.
- `apps/website/src/test/changelog.test.ts` fails on `origin/master` before any
  change in this branch (changelog parser drops the release summary and lets
  Unreleased entries leak into the next release). Pre-existing; recorded, not
  fixed here.
