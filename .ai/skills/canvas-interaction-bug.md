# Fix a canvas interaction bug

Diagnose and fix a canvas/pointer/drag/hover bug in a real browser, then prove
the fix with a Playwright E2E spec. Procedure source:
[validation-and-workflow.md](../../docs/agents/validation-and-workflow.md)
("Automated UI/canvas testing" and "Running E2E under memory pressure").

## When to use

- "Clicking or dragging does nothing", pointer/hit-test/selection/marquee bugs,
  stale frames after zoom or pan, overlays eating input, any "does not
  render/respond" report touching `CanvasArea.tsx`, pointer events, or CSS.
- Not for pure state/reducer logic with no browser behavior, or an already-diagnosed style edit.

## Required context

- [validation-and-workflow.md](../../docs/agents/validation-and-workflow.md) -
  E2E-first rule, heavy-lease command, nav helper, `page.evaluate` recipe,
  ErrorBoundary layout trap.
- [architecture-invariants.md](../../docs/agents/architecture-invariants.md) -
  fresh-frame rule, screen-space CSS px, `screenToWorld`/`worldToScreen`,
  hot-path benchmark rule.
- `tests/e2e/shared.ts` (`navigateToEditor`, `dragOnCanvas`),
  `tests/e2e/helpers/canvasGesture.ts`, `tests/e2e/canvas/drag-precision.spec.ts`;
  `playwright.config.ts` - chromium project, serial default, snapshot policy.

## Steps

1. Reproduce first in a real browser: write or extend a Playwright spec that
   drives the interaction with real pointer input (move/down/up, keyboard,
   wheel). Unit tests never dispatch real `PointerEvent`s.
2. Run it through the heavy lease with `--workers=1`. A failing run is the
   baseline; if intermittent, re-run with `--repeat-each=3`.
3. Diagnose with `page.evaluate` on real state: bounding rects,
   `getComputedStyle` (`display`, `height`, `contain`, `pointer-events`),
   `document.elementFromPoint`, and whether an overlay or ErrorBoundary wrapper
   is stealing events or collapsing layout (ErrorBoundary needs `display:
   contents`). Check safe-mode and first-run overlay interference.
4. Read only relevant line ranges: `packages/editor/src/CanvasArea.tsx`,
   `packages/editor/src/canvas/*` (input/render pipelines), the render worker
   (`render/workerHost.ts`), or the overlay/CSS path that owns the failure.
5. Fix the smallest root cause. Keep screen-space thresholds in CSS pixels,
   convert overlay geometry with `screenToWorld`/`worldToScreen`, make worker
   refusals synchronous, and never show pixels a fresh frame will not replace.
6. If the fix changes per-node render/replay dispatch, benchmark before merge;
   keep hot dispatches monomorphic.
7. Keep the spec as the regression test. Re-run it and one neighbouring canvas
   spec sharing the helper; report the failing and passing commands.

## Exact commands

```bash
node scripts/quality/heavy-lease.mjs "e2e: <bug> regression" -- \
  npx playwright test tests/e2e/canvas/<spec>.spec.ts --project=chromium \
  --workers=1 --reporter=list
pnpm test:agent <related unit spec>       # only if pure logic moved
pnpm check:agent
pnpm verify:affected                      # editor state/pipeline changes
```

## Definition of done

- A Playwright spec drives the real interaction, fails on the old behavior
  (recorded), and passes on the fix; no `test.skip`, retry, or snapshot change
  masks it.
- The root cause is named (input admission, overlay hit-testing, CSS layout,
  stale frame replacement, or worker boundary), not "pointer events".
- Fresh-frame, screen-space, and hot-path invariants hold; overlay fixes use
  camera transforms, not magic constants.
- Neighbouring spec and `pnpm check:agent` pass; `verify:affected` ran for
  editor state/pipeline changes. Report files, commands, evidence. No commit.

## Do not

- Declare a canvas fix verified from Vitest/RTL or jsdom (they never hit real
  browser APIs or CSS), or run raw `npx playwright test` unwrapped here.
- Update snapshots, add retries, use `waitForTimeout` guesses, or skip the spec
  to force green; hide overlays with CSS instead of fixing hit-testing.
- Change render/replay dispatch without a benchmark; move thresholds to world
  space; add imports to `CanvasArea.tsx`/`Shell.tsx`; commit.
