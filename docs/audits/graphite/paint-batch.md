# Paint batch checkpoint — 2026-10-23

## Authority and scope

- Branch `graphite/paint-corpus-20261023`, fresh worktree
  `.worktrees/graphite-paint-20261023`, base `origin/master` `e11477176`.
- Previous vector batch stays in `.worktrees/graphite-20261022`, branch
  `graphite/vector-paint-interaction`, head `26ef362cf`, local-only at this
  checkpoint. Do not import its fixes or describe it as merged.
- Re-read README, findings, continuation, frontier and ledger. Re-derived
  coverage: 1,604 issues / 2,734 comments; dispositions 546 already-handled,
  589 out-of-scope, 220 uncertain, 47 duplicate, 192 applicable, 10 blocked.
- Read all source threads/comments for #2445 (1), #2524 (10), #3019 (1) with
  `node scripts/research/graphite.mjs show 2445 2524 3019`.
- `pnpm install --prefer-offline` passed; initial `pnpm verify:plan`: clean.
- Pure functional diagnosis/repair of existing paint behavior, not a UI redesign.

## Active slice: #2524 SVG user-space gradient fidelity

Parser reproduction: `svg/elements.ts` converts rect/circle/ellipse
geometry to local origins and puts x/y/cx/cy in the node transform, but copies
the SVG user-space fill matrix without compensating for that rebasing.
Paths preserve their coordinates and may already be correct. Percentage
user-space gradients explicitly warn and use the target bounds, not the SVG
viewport; do not silently claim that case is supported.

`svg-user-space-gradient.test.ts` now has 15 cases: **12 fail / 3 pass**
against unchanged production code. The failures cover rect/circle, authored
affines, ellipse/polyline/polygon/line rebasing, import scaling, nested groups
and viewBox, and `<use>`. Path coordinates, objectBoundingBox, and the existing
percentage warning are the passing controls. MDN's
[gradientUnits reference](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/gradientUnits)
(read 2026-10-23) confirms that user-space fields start in the referencing
element's user coordinates; percentages require the SVG viewport.

Repair implemented after the first real-app red baseline: the local-space
boundary now preserves objectBoundingBox and authored transforms. Focused
checks pass (53 tests across the new parser file, existing SVG tests and brush
alpha tests). Next: rendered repair verification, disabled-fix discrimination,
affected checks, image inspection, second-pass review, commit/PR.
Do not claim completion, integration or release without the corresponding proof.

Narrow implementation: carry the converter's geometry-origin offset
with its ephemeral conversion result, and subtract that offset from the
user-space fill matrix after gradientTransform. Never invert the complete node
transform (which would cancel authored transforms and fail on singular ones).
Paths retain a zero offset; objectBoundingBox keeps its existing bounds mapping.

The exact source SVG also inherits its fill from `<g>`. Source inspection found
that this importer currently propagates visibility, not inherited group paint.
That is a separate, unverified boundary; the current direct-fill fixtures must
not be represented as proof that the source SVG or all SVG gradients work.

## Queued probes

- #2445: GradientEditor stores `selectedStop` in React state; pointer-up only
  ends the gesture. Canvas handles have transient dragging state, not a
  persistent selected stop. Prove selection survives start/interior-stop clicks
  and drags in the real picker before classifying as already handled.
- #3019: `scene/rasterLayer.ts` stores straight-alpha tiles, composites normal
  dabs in premultiplied space, then divides alpha out on storage. Measure raw
  soft-edge RGBA and final canvas pixels; wet-edge darkening is intentional
  and must be disabled for the control.

## Execution checkpoint

### Restart recovery (current)

- Server restart cancelled `sh_16aad39f600177Wnmsu1kPUWTq`,
  `sh_16abfbfbd001BlOOci7Lb4nLIP` and `sh_16abfea47001fLfcukzDnunw4I`.
  The browser runs had not acquired the lease. The affected run passed touched
  format/lint, emoji/docs/claims and E2E typecheck, then was interrupted during
  importer typecheck. No later lane result is established. The separate
  docs/imports/emoji/tokens command was also interrupted without a result.
- Repository status rechecked: only this batch's eleven intended paths changed;
  no prior vector or primary-checkout changes were touched.
- Current focused browser run: `sh_16ac4e37a0019w148gXlwhunk6`, port 7491,
  all three new specs (four cases), one worker, lease-wrapped.
- Current complete affected run: `sh_16ac4e386001m3Gt0lCn3mm5GT`, port 7493,
  entire gate lease-wrapped, two unit workers/one browser worker; required
  docs/imports/emoji/tokens rechecks follow only if that gate passes.
- Disabled-fix browser control: `sh_16ac5f907001G4gYM1oqqPd0Iq`, port 7494,
  same SVG spec and assertions. A temporary Vite plugin removes only the two
  `- geometryOrigin[...]` terms from the served module; repository source is
  never edited. Configs are `/tmp/opencode/graphite-origin-red-{vite.config.mjs,playwright.config.ts}`.
  `--list` successfully discovered both cases; actual execution is pending.
  Accept only expected pixel failures with the mutation log, not setup errors.
- Two-pass self-review of the production diff found no high-confidence defect:
  it enforces `A * T(origin) * T(-origin) * G = A * G`, adds no scene/schema
  fields, changes no renderer or history behavior, and adds no module imports.
  This is a self-review, not an independent external sign-off. Compiler,
  rendered, integration and deployment evidence remain pending.

### Earlier attempts (retained evidence)

- `packages/import/src/svg/elements.ts` now carries ephemeral geometry-origin
  metadata through style conversion and rebases only user-space fill matrices.
  All changes remain local; implementation, verification and integration are
  separate states.
- `pnpm verify:plan`: 11 lanes, no full-suite escalation. Selected format/lint,
  emoji/docs/claims, E2E compiler, both direct unit files, three E2E files.
  Rust, website E2E and full visual suites skipped as unrelated.
- `pnpm exec biome check --write` on the five test files passed.
- `pnpm typecheck:e2e` passed after the initial probes; the queued probe command
  runs it again after the latest fixture improvements.
- `pnpm exec vitest run packages/scene/src/__tests__/brush-alpha-fidelity.test.ts`:
  2 passed (soft straight RGB with and without overlap).
- SVG browser baseline `sh_16aa7a8b8001jJ6URBED20fenT` completed after the
  lease wait: 1 failed, the quarter-width red-channel sample was 0 (expected
  45–85). Screenshot read at
  `test-results/run-174592-7491/import-svg-user-space-grad-39177-ear-gradient-on-its-artwork-chromium/test-failed-1.png`:
  artwork/handles present but Import Results obscures the rectangle. The run
  logged a WASM-load fallback to the TS renderer; native/WASM is not verified.
- Strengthened the same baseline: opens File → Import, closes Import Results,
  asserts opaque alpha, attaches quarter/three-quarter RGBA and screenshots
  before colour assertions. Queued under `sh_16ab51ffe0019ohR10jSfhstEn`,
  port 7491, one worker, lease timeout 2400000. Cancelled only this owned
  waiting process (PID 186090, SIGTERM) before editing production, so its
  interrupted attempt is not red or green evidence.
- Focused fixed run: `pnpm exec vitest run
  packages/import/src/svg-user-space-gradient.test.ts packages/import/src/svg.test.ts
  packages/scene/src/__tests__/brush-alpha-fidelity.test.ts --maxWorkers=1`:
  **3 files / 53 tests passed**.
- Direct importer typecheck attempt hit its 180s tool deadline under contention;
  no compiler outcome established. Do not call it a pass or a compiler defect.
- Fixed SVG browser run queued under `sh_16abfea47001fLfcukzDnunw4I`, port
  7491; includes the new centred-circle radial pixel check.
- Updated `pnpm verify:plan`: 19 lanes, no full escalation; adds import package
  checks, editor/desktop reverse-dependent checks, import/export E2E domains.
  `verify:affected` plus required docs/imports/emoji/tokens audits is running
  under `sh_16abfbfbd001BlOOci7Lb4nLIP`, with one unit/browser worker and
  isolated browser port 7493. Await its result instead of launching a duplicate.
- Stop/brush probes queued together under shell `sh_16aad39f600177Wnmsu1kPUWTq`,
  port 7492, same lease timeout, one worker. Brush fixture uses an imported
  opaque #606060 backdrop, not an assumed theme background.
- `pnpm verify:affected` completed its red baseline: format/lint, emoji/docs/
  claims and E2E typecheck passed; stopped at the SVG unit file's expected
  10 failures / 3 passes. The later brush/browser lanes were not reached.
- Stop/brush fixtures now also dismiss Import Results before interacting;
  confirmed they were still waiting when this harness correction was applied.
- One failure screenshot inspected; unobscured pixel proof pending. Full suite: not run.
  Review, commit, PR, merge, deployment: not done for this batch.
- Remote recheck: `origin/master` remains `e11477176`; no paint-branch PR.

## Acceptance and integration

Keep research disposition separate from engineering status. A new regression
must fail against old behavior; pixel assertions must use the content canvas,
not geometry alone. For unchanged behavior record the concrete existing
mechanism. Use lease-wrapped single-worker Playwright, isolated port, no E2E
while pushing. Preserve all foreign work. Findings F10–F13 are reserved by the
unmerged vector branch; use F14 onward for verified new findings.
