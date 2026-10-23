# Paint batch checkpoint — 2026-10-23

## Current resumable state (supersedes historical attempts below)

- Head `3b5bd3e99` on `graphite/paint-corpus-20261023`; production repairs
  are the two normal-hook commits `856fdc25f` / `3b5bd3e99`.
- **Completed, do not repeat after restart:** 105 focused unit tests;
  14/14 real-app Chromium checks (7.5 minutes, shell
  `sh_16ace39c80017ubLNxxToIPPny`, port 7491); importer-disabled control
  with both expected pixel failures; both normal commit gates; required
  docs/imports/emoji/tokens audits. Full suite not run or required by planner.
- Read the fixed linear/radial/brush screenshots from
  `test-results/run-333292-7491/` and retained them under
  `docs/screenshots/graphite-corpus/`. The rectangle has a full black-to-white
  ramp, the radial circle has a centred white core, the white Airbrush fades
  into gray without a dark fringe. PNG samples: linear quarter/three-quarter
  RGB 65/193 (alpha 255); brush patch RGB 96–154 (backdrop 96, alpha 255).
  These PNG measurements supplement, not replace, the passing raw-canvas oracles.
- #3019 is now already-handled for the tested normal soft-brush path (F17);
  no brush production repair. #2445 stays already-handled (F16). Re-derived
  ledger: 548 already-handled / 190 applicable; other counts and C1/C2 unchanged.
  #2524 remains applicable for viewport percentages, focal-point approximation
  and inherited group paint; direct-fill fixtures do not certify its full sample.
- The brush log warns of `updateDoc` outside a transaction. Source inspection
  confirms the tool opens a transaction and waits for the worker tail before
  committing, but the caller of this warning is not identified. Alpha fidelity
  is verified; brush undo/persistent-history capture is **not** certified.
- Restart cancelled `sh_16acfcce9001rgk2iJLNUUzTlk` (DPR) and
  `sh_16ad272e6001MpzG7yVeyuUmA3` (complete affected gate) **while waiting
  for the lease**, before either command started. Eight-worker normal push
  `sh_16adb4ff80014fBnXqHIxZj6Ed` passed the three direct files and was
  interrupted in the engine lane; no result established for that lane.
  This cancellation is not a second timeout/failure. Prior two-worker push
  really did hit 300 seconds and remains recorded below. No hooks bypassed.
- Recovery recheck: no owned validation/push processes survive. Remote master
  is still `e11477176`; remote paint branch absent, no PR. Previous vector
  branch and divergent primary checkout remain untouched.
- Latest complete `pnpm verify:plan --since origin/master`: **47 lanes**, 78%
  of JS tests selected due to the shared engine reverse-dependency closure;
  no full escalation. Rust, website E2E and full visual suite skipped by plan.
  Targeted gradient visuals at DPR 1/2/3 are an explicit additional check.
- Next: checkpoint inspected evidence, run only the unfinished checks under the
  lease, recover normal push (same eight-worker setting, unchanged timeout),
  open a draft PR after remote ref exists, obtain exact-SHA hosted evidence
  and independent review before merge. Verify master/deployment separately.
  Native/WASM behavior remains unverified by these TS-fallback browser runs.
- Recovery commands: `sh_16ae6dafd001uHirgV6irj42bK` owns only the unfinished
  gradient DPR cases, port 7495, one worker, lease-wrapped. Documentation-only
  `pnpm verify:plan && pnpm verify:affected` is
  `sh_16ae6db44001ddoF7JMaHdwMun`; it does not replace the 47-lane branch gate.
- Documentation-only affected check passed: docs/emoji/claims; Biome skipped
  with no compatible changed files. The ledger was parsed independently:
  1,604 rows / 2,734 comments, 548 handled / 589 out-of-scope / 220 uncertain /
  47 duplicate / 190 applicable / 10 blocked.

### Agent Validation Report (current evidence, not integration certification)

```text
Changed scope: @varve/import SVG local-space rebasing; @varve/engine gradient
constructors; 5 new regression/probe files; Graphite audit and screenshots.
Validation plan: 47 complete-branch lanes, engine/import reverse-dependent JS
checks and import/export browser domains; no full-suite escalation. Evidence-only
follow-up selects 5 Tier-0 lanes and no production tests.
Commands actually run:
  pnpm exec vitest run packages/import/src/svg-user-space-gradient.test.ts packages/import/src/svg.test.ts packages/scene/src/__tests__/brush-alpha-fidelity.test.ts --maxWorkers=1
  pnpm exec vitest run packages/engine/src/replayGradient.userSpace.test.ts packages/engine/src/replay-fill.test.ts packages/import/src/svg-user-space-gradient.test.ts --maxWorkers=1
  VARVE_E2E_PORT=7491 VARVE_LEASE_TIMEOUT=2400000 node scripts/quality/heavy-lease.mjs "e2e: graphite gradient CTM repair and neighbors" -- pnpm exec playwright test tests/e2e/import/svg-user-space-gradient.spec.ts tests/e2e/inspector/gradient-stop-selection.spec.ts tests/e2e/paint/brush-alpha-fidelity.spec.ts tests/e2e/canvas/gradient-geometry.spec.ts tests/e2e/canvas/gradient-interpolation.spec.ts --project=chromium --workers=1 --reporter=list
  VARVE_E2E_PORT=7494 VARVE_LEASE_TIMEOUT=2400000 node scripts/quality/heavy-lease.mjs "e2e: graphite origin-disabled control with corrected replay" -- pnpm exec playwright test --config /tmp/opencode/graphite-origin-red-playwright.config.ts tests/e2e/import/svg-user-space-gradient.spec.ts --project=chromium --workers=1 --reporter=list
  pnpm audit:docs; pnpm audit:imports; pnpm audit:emoji; pnpm audit:tokens
  git diff --check; pnpm verify:plan; pnpm verify:affected (evidence-only follow-up)
Passed: 53 importer/brush unit cases; 105 replay/importer unit cases; 14 real-app
browser cases; normal commit gates; docs/imports/emoji/tokens (324 pairs), claims.
Expected red controls: 12/15 parser and 5/5 replay cases before repair; two
browser pixel failures with importer rebasing disabled and corrected replay.
Incomplete: full affected closure and DPR visuals; normal push; hosted exact-SHA
certification; independent review; merge/deployment. Brush history warning
unlocalized; native/WASM not verified by the fallback browser.
Skipped as unrelated: Rust workspace; website E2E; full visual; packaging/signing.
Escalations: none. Full suite run: no (planner does not require it).
```

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

Latest evidence supersedes the pending-run entries below:

- Head `3b5bd3e99` contains both local repair commits (`856fdc25f` and
  `3b5bd3e99`). Both normal commit checkpoints passed. No remote branch/PR,
  merge or deployment has been established.
- Complete exact-branch affected gate is now queued/running as
  `sh_16ad272e6001MpzG7yVeyuUmA3`, port 7493, explicit
  `verify:affected --since origin/master`. Do not substitute a working-diff
  plan for this two-commit scope.
- Origin-disabled control `sh_16ace5294001Ub8kNQAgEAyQpy` completed with
  **two expected pixel failures** and the mutation log. Both samples were
  opaque; linear quarter and radial centre remained black. Both screenshots
  were read, showing the field displaced from the shapes. The linear control
  is retained as `svg-gradient-no-origin-linear.png` under
  `docs/screenshots/graphite-corpus/`. The parser-fixed/replay-broken image is
  retained there as `svg-gradient-double-ctm-linear.png`.
- Normal push attempt `sh_16ad3f102001fg2YncGyp1EoqJ` failed its hook: all
  three direct regression files passed, then `js-unit:@varve/engine` exceeded
  the fixed 300s lane deadline with two workers. Owned-process cleanup passed;
  no hooks were bypassed, no refs pushed. CI health reported no current
  infrastructure blocks. Diagnostics: common Git directory
  `varve-validation/plans/696cdadde45c25029f58c59be4a32f4b696ac091fcadaae969524d9181379422.json`.
- One normal retry at the hook's standard eight-worker setting is queued as
  `sh_16adb4ff80014fBnXqHIxZj6Ed`, wrapped in the shared lease so it cannot
  overlap our browser runs. If it fails again, diagnose/report rather than
  bypass the timeout. Draft PR body is prepared at
  `/tmp/opencode/graphite-paint-pr.md`; create it only after a successful push.

- Local checkpoint `856fdc25f` committed the importer repair and probes. All
  pre-commit gates passed, including 17 new unit cases and E2E typechecking.
  `verify:push --since origin/master --dry-run` found the outgoing scope ready;
  it did not execute validation or write a receipt, and no push occurred.
- Focused browser run `sh_16ac4e37a0019w148gXlwhunk6` completed: **1 passed /
  3 failed**. #2445 selection passed and its screenshot was read. Both SVG pixel
  tests still painted opaque black despite correct handles; their screenshots
  were read and exposed F15, the independent replay double-CTM defect. The
  brush probe stopped before painting because a warning-free solid SVG does
  not open Import Results; its fixture now dismisses that report only if present.
- Added five nonidentity-CTM gradient-constructor/cache tests: all five failed
  against the old replay. Removed the redundant CTM projection in
  `packages/engine/src/replayGradient.ts`. Focused fixed run of that file,
  `replay-fill.test.ts`, and parser regressions: **105 tests / 3 files passed**.
- Cancelled only our queued affected/control supervisors (259305 and 268579)
  before changing renderer scope. Neither had started its command. Their
  SIGTERM results are interruptions, not validation failures or passes.
- New fixed browser run: `sh_16ace39c80017ubLNxxToIPPny`, port 7491, three
  new specs plus existing gradient geometry/interpolation neighbours.
- New origin-disabled browser control: `sh_16ace5294001Ub8kNQAgEAyQpy`,
  port 7494. It keeps the repaired replay and disables only importer rebasing.
- Gradient replay visual cases at DPR 1/2/3: `sh_16acfcce9001rgk2iJLNUUzTlk`,
  port 7495, `tests/e2e/visual/replay.spec.ts --grep gradient`, no baseline
  updates. This is a targeted manual addition for the shared gradient helper,
  not an unrelated full visual run.
- After the replay repair, `pnpm audit:docs`, `pnpm audit:imports`,
  `pnpm audit:emoji`, `pnpm audit:tokens` all passed (324 contrast pairs across
  three themes; token-usage check clean). `git diff --check` passed.
- The #2445 screenshot is retained as
  `docs/screenshots/graphite-corpus/gradient-stop-selection.png`; its ledger
  disposition is now already-handled. Re-derived current counts are 547
  already-handled / 191 applicable, with other dispositions unchanged.
- Renderer working-diff plan: 39 lanes / 77% of repository test files selected,
  no full-suite escalation. Validate the complete committed branch with
  `--since origin/master` after the next checkpoint; default scope otherwise
  sees only uncommitted files and can omit the first commit. No broad gate is
  running now. Keep the explicit extra gradient visual checks at DPR 1/2/3.

Earlier recovery attempts (historical, not active):

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
