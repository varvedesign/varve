# Validation and Workflow

Durable validation, command, CI, and recovery detail split out of the root
`AGENTS.md` on 2026-10-28. The root file keeps only the quiet default inner
loop; load this file when you need the full policy, a specific command, or the
recovery map.

## Toolchain (confirmed working, 2026-06-29)
- Rust: `~/.cargo/bin` (rustc 1.97 / cargo 1.97). Source with `. "$HOME/.cargo/env"`.
- pnpm 11.9: `~/.local/share/pnpm/bin`. Export `PNPM_HOME="$HOME/.local/share/pnpm"` and add `$PNPM_HOME/bin` to PATH.
- just 1.58: `~/.local/bin`.
- Node 26, npm 11.16.
- wasm32 target installed.
- WebKitGTK 2.52.4 / GTK 3.24.52 / librsvg / openssl / fontconfig / fuse2 confirmed via pkg-config.
- Optional: `cmake`, `xdotool` (not needed for core build).

## Validation economy — mandatory

**Validate according to impact, not repository size.** The full suite is an
explicit escalation/final-gate operation, not the default inner loop. Canonical
policy: `docs/quality/validation-strategy.md`. Executable planner:
`scripts/quality/affected-plan.mjs`.

1. Inspect `git status` / diff first.
2. Run `pnpm verify:plan` — the planner explains exactly what it selects
   and why, and what it deliberately skips.
3. Run `pnpm verify:affected` (Tiers 0–4, dependency-aware; `pnpm verify:quick`
   for trivial edits).
4. Add feature-specific E2E/visual/perf validation when the plan indicates.
5. Do NOT run `pnpm test`, `just gate`, full Playwright, or
   `cargo test --workspace` by default.
6. Full validation (`pnpm verify:full`) is reserved for explicit escalation
   conditions — workspace/toolchain changes, test-runner configuration,
   serialization/schema migrations, cross-package foundational API changes,
   release checkpoints, explicit request — and requires a stated reason.
7. Record exactly what was run, what passed, and what was skipped as
   unrelated (the Agent Validation Report template, below).

### Failure-resolution and release candidates

For a large integration or release candidate, do not restart a broad E2E
gate after every individual repair. Run `pnpm verify:triage` once to collect
a bounded failure set. Triage still runs the affected closure when the
planner requires a final full gate, exposing downstream compile failures
before that expensive checkpoint. Classify and repair each failure, and run its affected
compiler check, exact spec, and direct unit checks after each repair. Changes
under `tests/e2e/` automatically select `pnpm typecheck:e2e` before
Playwright. For a release candidate, freeze one exact `master` SHA and run
`release-candidate.yml` in triage/final mode; keep already-green lanes when a
targeted rerun is sufficient. Shared E2E
infrastructure (`tests/e2e/shared.ts`,
`tests/e2e/helpers/**`, and fixtures), runner configuration, renderer, and
other integration surfaces deliberately retain broad validation scope.

Before restarting a failed release lane, review its complete affected
workflow and adjacent boundaries. Add missing regressions for relevant
cancellation, invalid-input, permission, timing, persistence and platform
cases; an observed defect's regression must fail against the previous behavior.
Assert actual outcomes and use production contracts/configuration in mocks.
See `docs/quality/validation-strategy.md` → user workflow coverage.

Skipping affected tests is prohibited. Running unrelated tests is
discouraged — it consumes shared developer resources and delays feedback.

### Agent Validation Report (before claiming completion)

```text
Changed scope: <files / packages / crates>
Validation plan: <summary of pnpm verify:plan output>
Commands actually run: <exact commands>
Passed: <list>
Skipped as unrelated: <list + why>
Escalations: <list>
Full suite run: yes/no
If yes, reason: <stated reason>
```

## Regression protocol (mandatory after every architecture/system change)

After ANY change that touches:
- type definitions, interfaces, or generics
- imports, re-exports, or module boundaries
- function signatures or overloads
- state shape or context values
- test files or test infrastructure

Run in order:
```bash
pnpm verify:plan        # understand the impact first — never skip this
pnpm verify:affected    # Tiers 0-4. Tier 0 already covers format+lint on the
                        # touched files — no whole-repo format/lint runs per
                        # change; those belong to the full gate only.
pnpm bench              # benchmark mode for .bench.ts files (optional, perf-sensitive)
pnpm audit:docs         # docs naming/index/link drift — zero violations
pnpm audit:imports      # every committed relative import has a committed target
pnpm audit:emoji        # zero violations
pnpm audit:tokens       # WCAG-AA pairs (3 themes) + undefined-token / literal-fallback scan
```

The audits above are also auto-selected by the planner when the change
touches their domain (docs/emoji/tokens) — running them directly is a
belt-and-braces recheck, not a substitute for `verify:affected`.

Failure at any step means the change introduced a regression. Fix before committing.
Do NOT skip the affected checks — but do NOT run the full suite unless the
planner escalated (`FULL-SUITE ESCALATION: YES`) or a full-gate checkpoint
applies. When the planner escalates, run:

```bash
pnpm verify:full    # requires VARVE_FULL_GATE_REASON (see docs/quality/validation-strategy.md)
```

## Code-health check (triage gate)

After any system-level change (new context provider, new hub file, new tool system,
or any change to `context.tsx` / `CanvasArea.tsx` / `Shell.tsx`), run the
architecture audit to verify architectural metrics haven't regressed:

```bash
node scripts/audit-architecture.mjs --ci
```

These numbers drift with everyday merges — treat the recorded values as
orientation and inspect the audit output plus the committed baselines.
`audit-architecture.mjs --ci` enforces cycle identities and the global
`max_cycles` and `max_layer_violations` ceilings. The stored instability and
unused-export thresholds are currently reported only, as documented in the
[August 25 baseline commit](https://github.com/K-Arthur/varve/commit/1266f7fc3647c9e03ac142516e5d6c07f2b2d1d5).

| Metric | Recorded (2026-08-22) | Current CI treatment |
|--------|----------------------|----------------------|
| Dependency cycles (madge, total distinct) | 15 | Enforced: cycle identities and 17 (`max_cycles`) |
| Unstable modules (I > 0.9, all packages) | 49 | Reported only; stored ceiling 55 (`max_unstable`) |
| Layer violations | 0 | Enforced: 0 (`max_layer_violations`) |
| Unused exports | 0 | Reported only; stored ceiling 10 (`max_unused_exports`) |

The [0.5.0 architecture comparison](../quality/validation-strategy.md#architecture-audit-finding)
records 75 unstable modules at committed SHA `dde0141d1` and in the pending
interface repairs, with identical module identities. This existing excess
remains architecture debt; a passing audit does not establish compliance with
the stored instability ceiling. Keep the ceilings unchanged, add regression
coverage for the omitted checks, and reduce the excess before enabling their
enforcement. This finding grants no release-certification exemption.

Also reported but not enforced by `--ci`: per-package average/max cyclomatic
complexity and per-hub import budgets — Shell (56), Menubar (18), and context
(76) print OVER BUDGET warnings against the script's hardcoded budgets. Hub
line/import *enforcement* lives in the
pre-commit health gate (`.health-baseline.json` via
`scripts/audit-health.mjs --staged`). Function-level complexity ceilings for
over-ceiling files (context.tsx 847, CanvasArea 630, …) live in
`scripts/audit-health.mjs` and are guarded by each file's first-line
`// COMPLEXITY:` comment.

See `docs/audits/architecture-health-baseline-2026-07-25.md` for the original
measurement methodology. If an enforced threshold is breached, stop and
investigate.
Use `node scripts/audit-architecture.mjs --update` to reset the baseline after
intentional improvements.

## Quality gates — selected by impact and profile

Every task starts with `pnpm verify:plan` and runs the affected checks required
by that plan. The commit and push checkpoints remain bounded. Browser visual,
native multi-OS, benchmark, model-quality, packaging, and release checks belong
to the selected integration/candidate profile; they are not an automatic
requirement for every localized edit. A full local gate requires an explicit
`VARVE_FULL_GATE_REASON` and is never a substitute for exact-SHA remote
certification.

## Multi-agent coordination

| Scenario | Strategy |
|---|---|
| Different crates/packages | Safe in parallel |
| Same package, different files | Safe in parallel if independent |
| Same file | **Must be sequential** — use `git worktree add` |
| Hub files intersect | After parallel agents, coordinator runs `pnpm verify:plan` and `pnpm verify:affected`; use an explicitly justified full gate only when the plan escalates |

**Gate scripts self-queue machine-wide.** `pnpm check:agent`,
`pnpm check:rust`, `pnpm test:agent`, and `pnpm verify:affected` take a
local-validation-queue slot (`exclusive` for compilers/affected validation,
`shared` for focused tests) and write a receipt under
`$XDG_CACHE_HOME|~/.cache/varve/validation-queue/`. A passed receipt is
reused only for the same clean tree, HEAD, command, class, and tool versions
within six hours; dirty trees always run. Inspect with `pnpm queue:status`
/`pnpm queue:history`; `CI`, `VARVE_VALIDATION_QUEUE=0`, and
`VARVE_HEAVY_TASK_PARALLELISM=0` bypass. Decision record:
`docs/quality/local-validation-queue.md`.

**Heavy tasks outside those scripts (full vitest, Playwright, cargo workspace,
desktop/WASM builds) acquire a cross-worktree lease** before starting
(`scripts/quality/heavy-lease.mjs`) so concurrent agents do not saturate
the machine. Browser/Playwright runs stay on this lease; do not nest a direct
heavy-lease invocation inside a queue-exclusive run. Opt out deliberately with
`VARVE_HEAVY_TASK_PARALLELISM=0`.

**Worktree protocol:** `git worktree add .worktrees/<feature> -b <feature>`,
work, commit, merge sequentially. Verify each merge with `pnpm verify:plan`
followed by `pnpm verify:affected`; use `pnpm verify:push` for the exact refs
leaving the machine, and reserve `pnpm verify:full` for explicit escalations.
Full operating model (worktree isolation, single-writer generated surfaces,
staged-only pre-commit validation, merge protocol, storage/performance and
rejected alternatives): [concurrent-agents.md](../quality/concurrent-agents.md).
Inspect the registered worktrees with `pnpm worktree:status`; reclaim clean,
merged, old repo-local worktrees with `pnpm worktree:prune` (dry run), then
`--apply`. External worktrees (`~/.codex/...`, sibling checkouts) are never
touched.

## Commands (run from repo root)
- `pnpm install` — install JS deps
- `just check-env` — verify toolchain on PATH
- `pnpm verify:plan` — print the impact-aware validation plan for current changes (dry run; never skips silently — it explains what it selects and why)
- `pnpm verify:quick` — Tier 0 + Tier 1: format/lint on touched files + directly related tests
- `pnpm verify:affected` — Tiers 0–4, dependency-aware affected validation. **Default inner loop — use this instead of `pnpm test`.** Queued machine-wide.
- `pnpm check:agent` / `pnpm check:rust` / `pnpm test:agent <paths>` — quiet gate scripts that self-queue (exclusive for compilers, shared for focused tests); `--no-cache` forces execution, and raw `*:raw` variants exist for CI/diagnosis
- `pnpm queue:status` / `pnpm queue:history` / `pnpm queue:prune` — admission holders/waiters, recent receipts, and receipt pruning
- `pnpm worktree:status` / `pnpm worktree:prune` — cross-worktree diagnostics (branch, dirty/merged, stale candidates, queue holder) and safe pruning of clean merged repo-local worktrees (dry run by default)
- `pnpm visual:update --spec <tests/e2e/...spec.ts> --project <project> --reason "<intent>"` — scoped, reviewed visual baseline update (heavy lease, `--update-snapshots=changed`, local review artifact); policy and decision tree: `docs/quality/visual-validation.md`
- `pnpm audit:visual-baselines` — baseline hygiene: owner spec, PNG sanity, project/platform suffixes, DPR/GPU/Firefox coverage, tier dimension consistency
- `pnpm verify:push` — exact outgoing-ref bounded push checkpoint; reports CI deferrals and never invokes the full suite automatically
- `pnpm workflow:status` / `pnpm workflow:doctor` — inspect synchronization, worktree, hook, and in-progress-operation state without mutating Git
- `pnpm workflow:history` / `pnpm workflow:report` — inspect or export durable local workflow attempts and sanitized evidence
- `pnpm verify:full` — exact-SHA hosted full-gate verification (Tier 5), the default release path. Requires `VARVE_FULL_GATE_REASON` or `VARVE_FULL_GATE=1`; absent remote evidence remains incomplete, never a local fallback.
- `pnpm verify:full --local` — deliberate local full gate; policy-sized browser shards have separate resumable receipts. Use `--local --resume` only at unchanged inputs. Do not duplicate this with a complete hosted gate during routine release work.
- `just check-plan` / `just check-quick` / `just check-affected` — just wrappers for the verify commands
- `just gate-full` — human-facing full gate (requires `VARVE_FULL_GATE_REASON`)
- `just test` — Rust (`cargo test --workspace`) + JS (`pnpm test` = Vitest). **Full-suite operation — not the default inner loop**
- `just lint` — `cargo clippy -D warnings` + `pnpm lint` (Biome)
- `just format` — `cargo fmt` + `pnpm format`
- `pnpm typecheck` — `tsc --noEmit` across packages/* (full workspace — `pnpm verify:affected` runs only the affected closure)
- `pnpm audit:tokens` — WCAG 2.2 AA token gate (315 pairs across 3 themes) plus
  `scripts/quality/audit-token-usage.mjs`, which fails on `var()` references to
  undefined custom properties and on literal fallbacks attached to defined
  tokens. Override hooks that are undefined by design are listed in that script
  with a reason.
- `pnpm audit:emoji` — zero-emoji gate
- `pnpm audit:imports` — `scripts/quality/audit-committed-imports.mjs` reads
  the committed tree and fails when a relative import has no committed target.
  It exists because `packages/scene/src/index.ts` once barrelled
  `./nodeResize` and `packages/codegen` imported `./bundle-assets` while
  neither module was tracked: the working tree that produced the commits
  resolved them, a fresh clone did not, and nothing noticed until typecheck
  ran. Reading `HEAD` rather than the working tree keeps it from failing on
  in-flight edits.
- `pnpm webkit:prepare` — one-time, userland provisioning so Playwright's
  bundled WebKit can launch on a distribution newer than its build. Playwright's
  headless WebKit is the WPE build and needs a WPE stack that rolling
  distributions do not ship; the GTK build is the engine the Tauri app embeds
  and runs headed. The archive is linked against ICU 74 (symbol-versioned, so a
  symlink to ICU 78 fails at symbol lookup) and several CMU flite voices, so the
  script downloads an ICU 74 build into `~/.cache/varve`, builds stand-ins for
  the unused TTS voices, and links them into the bundle's own `sys/lib`. No root,
  no package manager.
- `pnpm e2e:webkit-gtk` — the opt-in WebKit GTK lane (`VARVE_WEBKIT_GTK=1`,
  headed under `xvfb-run`). Use it for engine-family questions the Chromium lane
  cannot answer, such as font availability, because WebKitGTK is what the
  desktop app actually runs.
- `pnpm audit:docs` — docs drift gate (stale retired-product-name/dead-path references in current-state docs, ADR index coverage, broken internal links). Historical docs (dated audits/plans/perf/session history/ADRs/CLA/licensing, and files under `docs/implementation-memory/`) may reference the old name; current-state docs must not.
- `pnpm --filter @varve/ui tokens:generate` — regenerate `tokens.css` from `color.ts`
- `just gate` — full Cascade Review gate (format-check + lint + test + audits) — **full-suite operation, kept as the compatibility alias**
- `pnpm e2e:visual` — visual regression projects only
- `pnpm e2e:all` — full Playwright suite
- Environment overrides: `VARVE_TEST_WORKERS` (vitest), `VARVE_E2E_WORKERS` (playwright), `VARVE_HEAVY_TASK_PARALLELISM=0` (opt out of heavy-task lease and validation queue), `VARVE_VALIDATION_QUEUE=0` (bypass the queue), `VARVE_VALIDATION_QUEUE_TIMEOUT_MS` / `VARVE_VALIDATION_QUEUE_SHARED_SLOTS` / `VARVE_VALIDATION_QUEUE_TTL_MS` (queue admission and receipt bounds), `VARVE_E2E_PORT` (isolated dev-server port)

Release lifecycle: `pnpm release:prepare <version>`, `pnpm release:status`,
`pnpm release:certify`, and `pnpm release:resume`. These helpers never create
tags, publish releases, change GitHub settings, or deploy production.

## CI/CD Commands
- `just install-ci-tooling` — install GitHub CLI, act, and Docker for local CI/CD
- `just install-ci-tooling` (with `bash scripts/install-ci-tooling.sh --check`) — verify act/container-engine parity for local runs
- `just pin-actions` — check for unpinned GitHub Actions (supply chain security)
- `just pin-actions-fix` — pin all GitHub Actions to commit SHAs
- `just validate-workflows` — validate all workflow YAML files
- `just validate-workflows-staged` — validate only staged workflow files
- `just act-list` — list available GitHub Actions jobs for local testing (no container engine needed)
- `just act-dry <workflow>` — dry-run a workflow to check execution plan (no container engine needed)
- `just act-run <job>` — run a specific GitHub Actions job locally (requires docker/podman running)
- `just ci-debug <run-id>` — generate the automated failure-debug report for a run
- `just ci-health` — classify recent run failures (billing-block / never-started / real-failure)
- `just ci-tools-test` — regression tests for the CI tooling itself

## Remote CI health (billing blocks and runner outages)

GitHub can block job startup for account-level reasons (failed payments,
spending limits) — every run fails in ~3s with zero steps recorded and
*"The job was not started because recent account payments have failed..."*.
This is NOT a code failure; no workflow edit fixes it. Diagnose with
`just ci-health` (prints `BILLING` per run) and resolve at
https://github.com/settings/billing. `ci-debug.mjs` classifies such jobs as
`billing-block` / `never-started` / `real-failure` (see `docs/CI_CD_RESILIENCE.md`).

## Automated UI/canvas testing

**If a bug involves the canvas, pointer/drag interaction, or "something doesn't
render/respond" — write and run a Playwright E2E test before declaring a fix verified.**
Vitest/RTL unit tests never dispatch real `PointerEvent`s through the real DOM and
never hit real browser APIs. A whole class of real bugs — broken CSS layout, overlays
eating pointer events, browser API throwing — is invisible to unit tests.

### Running E2E tests
```bash
npx playwright install chromium
npx playwright test tests/e2e --project=chromium --reporter=list
npx playwright test tests/e2e/canvas/tools.spec.ts --project=chromium --reporter=list
```

### Running E2E under memory pressure — use the lease, not raw `npx playwright`

This is a shared, frequently-oversubscribed machine: other agent sessions,
other worktrees, and the operator's own browser all compete for RAM at once.
Running `npx playwright test` directly, unwrapped, has repeatedly hit two
concrete failure modes here — the kernel OOM-killer taking the Chromium
process outright (confirmed via `journalctl | grep -i oom`), and a "Page
crashed" error on the very first `page.goto()` in `global-setup.ts` — both
observed with the heavy-task lease free, because the pressure came from
processes (another session's raw Playwright call, a browser with many tabs)
that never touched the lease at all.

**Always wrap Playwright runs through the lease**, which now also gates on
actual `MemAvailable` (not just serializing against other lease users):

```bash
node scripts/quality/heavy-lease.mjs "e2e: <what you're testing>" -- \
  npx playwright test tests/e2e/inspector/some.spec.ts --project=chromium --workers=1 --reporter=list
```

If available memory is under the floor (default 1536MB, `VARVE_LEASE_MIN_MEM_MB`
to change it), the wrapper waits and polls rather than launching straight into
a likely crash — this is strictly better than eyeballing `free -h` yourself
before every run. It still respects `VARVE_HEAVY_TASK_PARALLELISM=0` as a full
opt-out (lease and memory gate both) for a deliberate override.

Prefer `--workers=1` for Playwright regardless — one Chromium instance at a
time keeps the peak memory footprint predictable and matches how the lease
serializes everything else. If a run is going to cover many spec files,
split it into a few smaller lease-wrapped invocations rather than one very
long one: a mid-run crash on file 3 of 6 then costs re-running only that
slice, not starting over, and each invocation gets its own fresh memory
check at start.

Active leases are never reclaimed by age. A large build can legitimately run
for more than 30 minutes; reclaim only after its recorded owner PID exits. Do
not delete a live lease to make room for another validation task.

### Standard nav helper for canvas specs
```ts
async function navigateToEditor(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page.locator('dialog').getByRole('button', { name: /create/i }).waitFor({ timeout: 5000 });
  await page.locator('dialog').getByRole('button', { name: /create/i }).click();
  await page.locator('.layers-panel').waitFor({ timeout: 10000 });
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (await welcomeClose.first().isVisible({ timeout: 1000 }).catch(() => false)) {
    await welcomeClose.first().click();
  }
}
```

### Debugging recipe: collapsed or zero-size elements
Use `page.evaluate()` to pull real computed layout:
```ts
const info = await page.evaluate(() => {
  const el = document.querySelector('.some-element') as HTMLElement;
  const cs = getComputedStyle(el);
  return {
    rect: el.getBoundingClientRect().toJSON(),
    display: cs.display, height: cs.height, contain: cs.contain,
    parentClass: el.parentElement?.className,
  };
});
```

**Known trap — `<ErrorBoundary>` breaks CSS Grid/Flex placement.** Wrapping
something in `<ErrorBoundary>` that relies on being a direct grid/flex item
(such as `.editor-canvas`) collapses it to 0 height. Fixed by `display: contents`
on the ErrorBoundary wrapper.

### For future sessions
If the user reports "X doesn't work when I click/drag/interact," and X touches
CanvasArea, pointer events, or CSS layout:
1. Write a Playwright spec that drives the actual interaction
2. Run it. If it fails, use `page.evaluate()` to find the real DOM/CSS state
3. Only report a fix as done once the E2E test passes

## Ephemeral tree recovery

Recover with:

```bash
git checkout master
git log --oneline -3
```

| Artifact | Location |
|---|---|
| Working branch | `master` |
| Canvas responsiveness work | `perf/canvas-responsiveness` (6 commits ahead of master, merged 2026-07-27) |
| Deferred plan | `docs/plans/layers-panel-deferred.md` |
| Export deferred | `docs/plans/archived/export-system-deferred.md` |
| Home/Workspace System | `docs/plans/archived/projects-home-workspace-completed.md` |
| Packaging (0.11) | `docs/plans/archived/session-04-packaging.md` (historical; current release pipeline lives in `docs/release/` and `scripts/release/`) |
| Loading Experience System | `docs/architecture/loading-system.md`, `docs/audits/loading-experience-audit-2026-07-08.md` |
| Marketing Website | `apps/website/` - Astro 7 static site, 116 routes at the 2026-10-02 build, GitHub Pages deploy. See `docs/release/website.md` |
| CI/CD pipeline memory (local, gitignored) | `GITHUB_PIPELINE_MEMORY.md` — session-survivable tracker for billing blocks, run classifications, and tooling state |
