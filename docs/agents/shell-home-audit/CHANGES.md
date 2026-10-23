# CHANGES

| Finding | Change | Level | File / area | Evidence | Status |
|---|---|---|---|---|---|
| F-02 | `EmptyState` takes `headingLevel?: 2 \| 3 \| 4` (default 3); Home's empty states pass 2 so the outline is h1 → h2, not h1 → h3 | shared component + screen | `packages/ui/src/components/EmptyState.tsx`; `packages/home/src/EmptyStates.tsx` | axe `heading-order` 6 → 0 at 320/1440/1920 × light/dark; pixel diff 0.006 % in a 7×8 px corner region | **shipped** `dcf080c32` |
| F-02 | Regression tests: default stays h3; `headingLevel={2}` renders h2 | test | `packages/ui/src/components/EmptyState.test.tsx` | 5/5 pass | **shipped** |
| F-04 | Attempted sibling close-button layout (**reverted**) | shell component | `TabStrip.tsx`, `TabStrip.css` | fixed `nested-interactive` (4→0) but added `aria-required-children` (0→4) and `occluded-control` (0→4); reverted, editor pixel diff 0 | **reverted** |
| F-01, F-03, F-04, F-05, F-06 | Diagnosed and specified only | — | see `PLAN.md` | `FINDINGS.md` | open |

## Commit

```
dcf080c32 fix(ui,home): give empty-state headlines a document-outline level
```

Branch `agent/opencode/shell-home`, based on `master` `41ce72061`. Not pushed,
not merged.

## Instrumentation (development-only, not shipped)

| Item | Why | Tracked? |
|---|---|---|
| `ui-audit.mjs` copy in the worktree | measurement | no (excluded) |
| `--setup` hook (≈12 lines) + `audit-kit/setup.mjs` | the editor shell is state, not a route; needed to reach it | no (excluded) |
| `axe-core@4.11.0` in `node_modules/axe-core` | the tool silently skips all contrast/ARIA checks without it | no — **no manifest or lockfile change** |
| `audit-kit/debug-*.mjs` | DOM probes used to confirm/reject candidates | no (excluded) |
