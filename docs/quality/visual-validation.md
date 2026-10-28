# Visual validation policy

**Status:** current policy, introduced 2026-10-28. Tooling:
`pnpm visual:update`, `pnpm audit:visual-baselines`, `pnpm e2e:visual` /
`:gpu` / `:cross-runtime`, `scripts/build-visual-diff-manifest.mjs`,
`tests/e2e/visual/review.html`, and the heavy-task lease. Companion docs:
[validation-strategy.md](validation-strategy.md),
[concurrent-agents.md](concurrent-agents.md),
[tests/e2e/visual/README.md](../../tests/e2e/visual/README.md) (harness internals).

## The problem this policy fixes

The repository has two different kinds of visual test, and treating them the
same produced both false alarms and unsafe updates:

1. **The engine replay harness** (`tests/e2e/visual/replay.spec.ts`) renders
   fixed IR fixtures on a minimal page and compares pixels. It is deterministic
   and belongs in the gate.
2. **Design-surface snapshots** (inspector, dialogs, panels, canvas chrome)
   capture the real UI. An intended design change *must* change them; they are
   review artifacts, not exact-render contracts. They were environment-sensitive
   too: text rasterization differs between developer hosts and the Linux CI image
   (a measured harfbuzz upgrade shifted glyph antialiasing by 430-3262 px per
   capture, which is why one spec carries a 5000 px budget). Without global
   determinism defaults, a forgotten `animations: disabled` or a visible caret
   could also create diffs unrelated to any design change.

Observed churn before this policy: 27 commits touching 147 snapshot files in
30 days, per-spec tolerances ranging 100-5000 px with no shared rationale, and
a cross-runtime lane that advertised WebKit despite having zero WebKit
baselines. Snapshot binaries also cannot be hand-merged across concurrent agents.

## Two classes, two contracts

| | Engine replay harness | Design-surface snapshots |
|---|---|---|
| Specs | `tests/e2e/visual/replay.spec.ts` (+ `visual-compositing`, oracle specs) | UI specs calling `toHaveScreenshot` in `tests/e2e/**` |
| Project | `chromium-visual-1x/2x/3x`, `chromium-visual-gpu`, `firefox-visual`; `webkit-visual` opt-in | `chromium` (or `chromium-snapshot`) |
| Contract | Renderer output must not change unintentionally; required tiers cover DPR 1/2/3 and GPU | The reviewed appearance for a given design state; intended design changes update baselines |
| Tolerance | Per-fixture `maxDiffPixels` in `tests/e2e/visual/fixtures.ts`, scaled by DPR | Per-test measured budget with a stated reason; text-heavy captures may carry larger measured drift budgets |
| Update | `pnpm visual:update --spec tests/e2e/visual/replay.spec.ts --project chromium-visual-1x --reason ...` (each required project) | `pnpm visual:update --spec <ui spec> --project chromium --reason "<design intent>"` |
| CI | `e2e-visual` job, `--update-snapshots=none`; diffs uploaded | Ordinary browser lanes, `--update-snapshots=none` |

**Required baseline coverage:** every replay fixture has 1x/2x/3x + GPU; if any
Firefox baseline exists, every fixture needs one (the cross-runtime lane is
deterministic). WebKit is opt-in on a prepared host and may have zero baselines;
`VARVE_VISUAL_WEBKIT=1` enables the project only when its baselines are being
generated or reviewed. `pnpm audit:visual-baselines` enforces the owner, PNG
sanity, suffix, coverage and dimension rules.

## Determinism rules

- Global screenshot defaults now disable animations and hide the caret
  (`playwright.config.ts`). Do not override them to `allow`/`initial` without a
  measured reason.
- Wait for the state you are asserting: fonts loaded, images decoded, async
  previews settled, canvas frames authoritative. The replay harness waits for
  its ready flag; canvas specs use the full-redraw oracle where reuse can leave a
  stale surface.
- Mask genuinely volatile regions (clocks, cursors, presence avatars, random
  samples) with `mask:` rather than raising the budget.
- Prefer element-scoped captures over full-page screenshots for new tests.
- DPR tiers use Playwright css scale: baselines are the same pixel dimensions
  across 1x/2x/3x but differ in rasterization. Dimension mismatches across tiers
  are a baseline mistake, not a rendering change.
- The Linux CI image is the canonical text-rendering environment. Baselines
  carry the `-linux` suffix; new OS baselines must be generated and reviewed on
  that OS before that platform is enabled as a gate.

## Tolerances

- Every budget must be measured and explained in the spec (the upscale spec
  documents the harfbuzz drift measurement). Do not raise a budget to make a red
  test green; mask or fix instead, and split the assertion if it mixes stable and
  volatile regions.
- Engine fixtures keep tight per-fixture budgets; a structural renderer change
  fails, a negligible AA delta does not.
- Budgets are not a substitute for review: a 5000 px budget on a 690x544 capture
  is about 1.3%, enough for glyph raster but far below layout/color regressions.

## Intended design change or regression?

1. Read the failing spec, the diff images in `test-results/`, and the review page
   (`node scripts/build-visual-diff-manifest.mjs` then open
   `tests/e2e/visual/review.html` with `visual-diff-report/manifest.json`).
2. Ask: did this task intentionally change the rendered UI or renderer output?
   If yes, update **only** the affected spec/project with
   `pnpm visual:update ... --reason "<design intent>"`. Review the before/after
   snapshot list and the local `reports/visual-baseline-updates/` artifact, then
   commit the baselines with the design change and put the reason in the commit
   message.
3. If no, fix the code. Never accept a baseline change you did not intend; never
   run a broad `--update-snapshots` across a suite.
4. A text-raster-only difference inside a documented budget is environment drift,
   not a design change: do not update baselines for it. If it exceeds the budget,
   capture where it was produced (host, engine, font versions) before changing the
   budget.

## Commands

```bash
pnpm e2e:visual                 # CPU replay tiers 1x/2x/3x (heavy-lease in CI)
pnpm e2e:visual:gpu             # GPU replay project
pnpm e2e:visual:cross-runtime   # Firefox replay project
pnpm e2e:visual:webkit          # opt-in WebKit project (prepared host only)
pnpm visual:update --spec <tests/e2e/...spec.ts> [--project chromium] --reason "<intent>" [--dry-run]
pnpm audit:visual-baselines     # baseline hygiene + coverage/dimension rule
node scripts/build-visual-diff-manifest.mjs   # build the local review report after a failure
```

All browser runs go through the heavy-task lease and the shared validation queue
rules; never launch two visual updates or two browser suites at once.

## Concurrency and conflicts

Visual baselines are **binary single-writer generated surfaces**:

- one agent owns an intended design change per spec/project and merge window;
- never hand-merge `.png` conflicts; take one side and re-run the update for the
  merged code, then review the regenerated baseline;
- after merging design work, re-run the affected visual spec on the merged tree
  and regenerate any baseline both sides touched;
- baseline files are large binaries; keep the updated set minimal and in the same
  commit as the design change.

## CI and release behavior

CI never updates snapshots (`--update-snapshots=none`) and uploads
`visual-diff-report/` plus the Playwright report on failure. The visual job runs
only when the planner selects visual coverage or a full gate runs. Baseline
changes are therefore explicit commits, not an artifact of CI.

## Known gaps / follow-ups

- `chromium` and `chromium-snapshot` projects captured different dimensions for
  four `guides-visual`/`visual` fixtures (e.g. 690x544 vs 740x544). They are not
  compared by the tier rule; treat `chromium-snapshot` as a separate review lane
  unless its purpose is redefined.
- WebKit replay baselines do not exist yet; the project is gated and the lane is
  opt-in until a prepared host generates and reviews them.
- Firefox coverage is now complete and enforced by the audit; keep it complete
  when adding replay fixtures.
- The replay `multilingual-text` fixture keeps the only host-font allowance
  (4,096 px at 1x, scaled by DPR squared). It was measured at 3,706 differing
  pixels on 2026-10-28; do not widen it for any other fixture.

