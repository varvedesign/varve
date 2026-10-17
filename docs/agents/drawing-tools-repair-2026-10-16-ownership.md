# Drawing tools / vector ink repair ownership

**Task:** `drawing-tools-repair-2026-10-16`
**Branch/worktree:** `fix/drawing-tools-repair` in
`/home/kevina/CodingProjects/varve-drawing-repair` (outside the repository so
the workspace's `**/.worktrees/**` exclusion does not hide its test files).
**Base commit:** `284ce7594`.

## Scope

This work owns the vector-ink creation path (`PencilTool`, `PenTool`,
`tools/fitting.ts`), the shared coverage-paint input helpers
(`tools/brushStroke.ts`), the brush worker host's replay-window handover
(`render/brushWorkerHost.ts`), the `createShapeAt` path-appearance branch, the
Pencil/Pen tool-options surfaces, their tests, and
`tests/e2e/canvas/vector-ink.spec.ts`.

It deliberately does **not** own the raster dab engine, the compositor, the
brush library/presets, export, the workspace system, the responsive panel work,
or `CanvasArea.tsx` / `Shell.tsx`. `context.tsx` is touched in one branch of
`createShapeAt` only, with no new imports (the file sits exactly at its
`max_imports` health-gate budget).

## Shared-file coordination

| Surface | Owner / status | Rule applied here |
|---|---|---|
| `packages/editor/src/context.tsx` | Hub owner; at the `max_imports` ceiling | Logic-only change inside the existing path branch; no imports added. |
| `CanvasArea.tsx`, `Shell.tsx` | Hub owner | Untouched. |
| `packages/scene/src/index.ts` | Another contributor (in flight) | Not edited. Its `./nodeResize` export has no tracked module at the base commit — see below. |
| `packages/codegen/**` | Another contributor (in flight) | Not edited. Same missing-module condition for `./bundle-assets`. |
| Anything in the main checkout's dirty set | Other contributors | Not modified; the isolated worktree was created instead. |

## Base-commit blockers (owned elsewhere)

`284ce7594` and `0e7f263ab` both export modules that are not tracked
(`packages/scene/src/nodeResize.ts`, `packages/codegen/src/bundle-assets.ts`).
They exist only as untracked files in the main checkout, so a clean checkout
cannot resolve `@varve/scene` or `@varve/codegen`. This work copied both into
its own worktree **to run tests only** and never staged them; they must land
from their authors before this branch can integrate.

## Validation status

Unit, tool-level and Chromium browser results are recorded in
[`docs/audits/drawing-tools-repair-2026-10-16.md`](../audits/drawing-tools-repair-2026-10-16.md)
and in the Agent Validation Report attached to the session. Physical stylus,
Tauri/WebKitGTK, PWA and non-Chromium runs remain unverified and are listed as
such.
