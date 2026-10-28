# Update visual baselines for a design change

Accept an intended design change in the visual suites without blessing unrelated
pixel regressions. Policy:
[visual-validation.md](../../docs/quality/visual-validation.md).

## When to use

- A visual/screenshot spec fails and the differences are a deliberate design
  change you intend to ship.
- Reviewing another agent's baseline update or a visual-diff report; not for text
  raster drift or engine replay parity (those are regressions unless policy says
  otherwise).

## Required context

- [visual-validation.md](../../docs/quality/visual-validation.md) - intended vs
  regression, review workflow, determinism, ownership.
- [tests/e2e/visual/README.md](../../tests/e2e/visual/README.md) - replay harness,
  diff manifest, review UI, snapshot namespaces.
- [local-validation-queue.md](../../docs/quality/local-validation-queue.md) and
  [concurrent-agents.md](../../docs/quality/concurrent-agents.md) - heavy-lease
  boundary, single-writer generated surfaces.
- [.ai/skills/README.md](README.md) - sibling playbooks.

## Steps

1. Identify the exact spec and project: `chromium` for UI/design-surface snapshots,
   `chromium-visual-1x/2x/3x` for the engine replay harness; never widen.
2. Reproduce read-only under the heavy lease: one spec, one project,
   `--workers=1 --retries=0 --update-snapshots=none`; note `test-results/<run>/` artifacts.
3. Build the review report: `node scripts/build-visual-diff-manifest.mjs` writes
   `visual-diff-report/manifest.json` plus images; open `tests/e2e/visual/review.html` and compare.
4. Classify: intended design change (state the intent); regression (fix code, leave
   baselines); text raster drift (replay harness CI-canonical; UI text tolerances are budgets).
5. Keep determinism: global `toHaveScreenshot` defaults stay (animations disabled,
   caret hidden); wait for fonts/images/frames to settle; never capture mid-animation;
   mask volatile regions instead of widening tolerances.
6. Intended only: `pnpm visual:update --spec <tests/e2e/...spec.ts> --project <project> --reason "<intent>"`
   - heavy-lease and `--update-snapshots=changed`, reason required, artifact under
   `reports/visual-baseline-updates/`; `--dry-run` previews; no broad updates.
7. Review `git status` / `git diff --stat` for `*-snapshots/`; keep only intended baselines.
   Baselines are single-writer binary surfaces: never two updates at once; take one PNG side and regenerate.
8. Confirm: re-run read-only, `pnpm audit:visual-baselines`, `pnpm verify:agent`; put the reason in the commit message.

## Exact commands

```bash
node scripts/quality/heavy-lease.mjs "visual: <spec> read-only" -- \
  npx playwright test tests/e2e/<spec>.spec.ts --project=<project> \
  --workers=1 --retries=0 --update-snapshots=none --reporter=list
node scripts/build-visual-diff-manifest.mjs
pnpm visual:update --spec tests/e2e/<spec>.spec.ts --project <project> \
  --reason "<stated design intent>"
git status --short -- 'tests/e2e/**-snapshots/**'
pnpm audit:visual-baselines && pnpm verify:agent
```

## Definition of done

- Reproduced on one spec/project under the lease at retries=0; the diff was
  reviewed in the manifest/review report.
- Classification recorded; intended update scoped with a reason, or code fixed
  with baselines untouched.
- Only intended baselines changed; `audit:visual-baselines` and `verify:agent`
  pass (report unrelated pre-existing findings rather than hiding them); a
  read-only re-run passes; determinism and single-writer rules held.
- Report spec, project, changed baselines, review artifact, and reason. No commit
  unless the task explicitly asks.

## Do not

- Run `pnpm e2e:all`, full Playwright, or broad `--update-snapshots` runs.
- Update WebKit/Firefox/other-platform baselines without that runtime running and
  a documented review.
- Treat text raster drift as a design change, or widen tolerances to mask a real
  regression.
- Hand-merge PNG conflicts, run two visual updates concurrently, or delete
  another session's baselines.
- Commit without an explicit request.
