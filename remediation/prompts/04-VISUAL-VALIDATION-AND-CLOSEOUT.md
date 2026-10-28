# Visual validation and closeout (repo-native)

Canonical policy: `docs/quality/visual-validation.md`. Harness internals:
`tests/e2e/visual/README.md`. Determinism defaults live in
`playwright.config.ts`. Tooling: `pnpm visual:update`,
`pnpm audit:visual-baselines`, `pnpm e2e:visual` / `:gpu` /
`:cross-runtime` / `:webkit`, and the heavy-task lease.

## When this is required

Required when the seam changes:

- renderer output covered by the engine replay harness
  (`tests/e2e/visual/replay.spec.ts` and the oracle specs) - the deterministic
  contract, plus the GPU and Firefox coverage;
- the reviewed appearance of a design surface (inspector, dialogs, panels,
  canvas chrome) captured with `toHaveScreenshot` in `tests/e2e/**`;
- an API shape, error state, empty state, loading state, or permission state
  consumed by the UI;
- the bounded UI surface admitted by `03-FRONTEND-REMEDIATION-WORKBENCH.md`.

**Not required for a pure code move.** A declaration-level extraction that
preserves DOM, class names, props, state transitions, and API shapes must not
change pixels. In that case the required closeout statement is:

> No visual surface changed. Proof:
> `pnpm test:agent packages/editor/src/panels/IntelligencePanel.test.tsx`
> passes 9/9 before and 9/9 after the move, unchanged.

Record that statement in `remediation/A-04/SEAM_SPEC.md` (or the entry's
`VISUAL_VALIDATION.md` only if visual validation actually ran). Do not update a
baseline and do not start a browser lane for a pure move.

## Two contracts, two update paths

| | Engine replay harness | Design-surface snapshots |
|---|---|---|
| Specs | `tests/e2e/visual/replay.spec.ts` and oracle specs | UI specs calling `toHaveScreenshot` in `tests/e2e/**` |
| Projects | `chromium-visual-1x/2x/3x`, `chromium-visual-gpu`, `firefox-visual`; `webkit-visual` opt-in | `chromium` (or `chromium-snapshot`) |
| Contract | Renderer output must not change unintentionally; required tiers cover DPR 1/2/3 and GPU | Reviewed appearance for a design state; an intended design change updates baselines |
| Update | `pnpm visual:update --spec tests/e2e/visual/replay.spec.ts --project chromium-visual-1x --reason "..."` for each required project | `pnpm visual:update --spec <ui spec> --project chromium --reason "<design intent>"` |

Every fixture must keep 1x/2x/3x plus GPU coverage; if one Firefox baseline
exists, all fixtures need one. The Linux CI image is canonical and baselines
carry the `-linux` suffix. WebKit stays opt-in
(`VARVE_VISUAL_WEBKIT=1`) on a prepared host.

## Determinism rules (do not override)

- `playwright.config.ts` sets `toHaveScreenshot: { animations: 'disabled',
  caret: 'hide' }`. Do not override to `allow`/`initial` without a measured
  reason.
- Wait for the asserted state: fonts loaded, images decoded, async previews
  settled, canvas frames authoritative.
- Mask genuinely volatile regions (clocks, cursors, presence, random samples)
  with `mask:` instead of raising a budget.
- Prefer element-scoped captures over full-page screenshots for new tests.
- Budgets are per-test, measured, and explained in the spec. Never widen a
  budget to make a red test green; mask or fix instead, and split stable from
  volatile regions. There is no "0.0 threshold" goal and no universal
  percentage; engine fixtures stay tight, design surfaces use measured budgets.

## Procedure when a visual surface actually changes

1. Identify the failing spec and read the diff images in `test-results/` plus
   the review page: `node scripts/build-visual-diff-manifest.mjs`, then open
   `tests/e2e/visual/review.html` with `visual-diff-report/manifest.json`.
2. Decide intended design change versus regression. If no rendered change was
   intended, fix the code; do not accept the diff.
3. Intended update: update only the affected spec and project:
   `pnpm visual:update --spec <tests/e2e/...spec.ts> --project <project>
   --reason "<design intent>"`. Review the before/after snapshot list and the
   local `reports/visual-baseline-updates/` artifact, then commit the baselines
   in the same commit as the design change and put the reason in the commit
   message.
4. `pnpm audit:visual-baselines` must exit 0 (owner spec, PNG sanity,
   project/platform suffixes, DPR/GPU/Firefox coverage, tier dimensions).
5. All browser runs go through the heavy-task lease and one-at-a-time browser
   policy:
   `node scripts/quality/heavy-lease.mjs "visual: <what>" -- npx playwright test
   <spec> --project=<project> --workers=1 --reporter=list`.
   CI always runs with `--update-snapshots=none`.
6. Baselines are binary single-writer surfaces: one owner per design change per
   spec/project per merge window; never hand-merge `.png` conflicts; take one
   side, re-run the update on the merged code, and review the regenerated
   baseline. Keep the updated set minimal.

## Closeout file

When the gate fires, write `remediation/A-04/VISUAL_VALIDATION.md` (or the
current entry's directory) with:

- environment (OS, host, browser/engine, font-rendering notes), viewport, and
  project;
- data volume and fixtures used;
- which contract ran (engine replay or design surface) and the spec/project;
- the measured budget and its rationale;
- snapshot paths reviewed, and diffs accepted or rejected with the reason;
- any surface left unvalidated and why.

Do not merge a visual change without this file. For a pure move, the
`SEAM_SPEC.md` "no visual surface changed" statement replaces it.

## A-04 application

- Pure code move: `IntelligencePanel.tsx` split into
  `packages/editor/src/panels/intelligence/` modules.
- No rendered output, DOM, class names, props, API shape, or error/empty/loading
  state changes.
- Required statement and proof: "no visual surface changed; the covering
  component test passes 9/9 before and after".
- No `pnpm visual:update`, no `pnpm audit:visual-baselines` change, no
  Playwright lane, no screenshots.
- If the move were to change pixels, the seam would be wrong: stop and report
  instead of updating baselines.

## Do not

- Do not update snapshots to make a failing test pass, run broad
  `--update-snapshots`, or hand-merge PNG baselines.
- Do not run raw Playwright outside the heavy lease, or two visual updates at
  once.
- Do not raise a budget, mask a stable region, or accept an unexplained diff.
- Do not add visual captures or baseline updates for a pure refactor.
- Do not hand-edit generated token CSS or design tokens as part of visual work.
- Do not commit.
