# RECON — shell + Home

## Stack and rendering

- React 19 + Vite dev server; Tauri 2 desktop shell, same frontend in browser.
- Monorepo: `apps/desktop` (entry `src/App.tsx`), `packages/editor`
  (`Shell.tsx`, `TabStrip.tsx`, `CanvasArea.tsx`, `components/Shell/*`),
  `packages/home` (`HomeShell.tsx` + feature components), `packages/ui`
  (tokens + primitives).
- App root owns `view: 'home' | 'editor'` as React state. There is **no router**;
  Home and the editor are not URL-addressable. Home is the default surface.
- Demo mode: `?try=1` (or `/try`) seeds a sample document and opens the editor.

## Design-system inventory

- `packages/ui/src/tokens/tokens.css`: **1225 custom properties**, generated
  from `color.ts` / `sizing.ts` / `spacing.ts` / `typography.ts`.
- Themes: `:root`, `[data-theme="dark"]`, `[data-theme="high-contrast"]`,
  `@media (prefers-contrast: more)`, plus a no-attribute dark fallback.
- Primitives in use in scope: `Button`, `CloseButton`, `IconButton`, `Tooltip`,
  `Dialog`, `EmptyState`, `SearchField`, `Disclosure`, `Select`.
- Component documentation lives as `*.stories.tsx` next to sources; no separate
  Storybook deployment in scope.

## Conflict scan (competing style sources)

| Surface | hex/rgb/hsl | `!important` | `z-index ≥ 100` | raw px |
|---|---|---|---|---|
| `packages/home/src/home.css` | 1 | 0 | 1 | 221 |
| `packages/editor/src/editor.css` | 7 | 0 | 3 | 509 |
| `packages/ui/src/components/components.css` | 2 | 0 | 0 | 171 |

No legacy framework, no CSS-in-JS, no Shadow DOM, no Tailwind. One token
system, one component stylesheet. Drift is low; the remaining literals are
concentrated in canvas/ruler geometry.

## Route / screen inventory in scope

Home (`HomeShell`) sections: Recent, All Files, Drafts, Favorites, Templates,
Assets, Activity, Trash, plus per-project sections and saved searches.
Landmarks: page `<h1 class="sr-only">` = section label; `<aside aria-label="Navigation">`;
`<main id="home-main" tabIndex={-1}>`; root `<section aria-label="File drop zone">`.

Editor shell (`Shell.tsx`): menubar `<header>`, tab strip, canvas `<main
className="editor-shell__main" style="display: contents">`, docked panels
(`aside` Layers, `aside` Inspector, Resources, Codegen, Logo, History),
status bar, floating toolbar, collab presence layer.

## Blast radius of the changed pieces

| Piece | Used by |
|---|---|
| `EmptyState` (`@varve/ui`) | Home empty states (recent/all/drafts/favorites/templates/trash/project/collections/activity/missing/savedSearch), TemplatesGallery |
| `EmptyStates` (`@varve/home`) | `HomeShell` (4 call sites), `TemplatesGallery` |
| `TabStrip` | editor shell only (reverted change) |

## Data and integration contracts

- Files come from `@varve/platform` (IndexedDB + File System Access in the
  browser, Tauri commands natively). Thumbnails have their own capability and
  cache identity contract (`docs/architecture/thumbnail-system.md`).
- Home's states are derived from that store; the empty state is the true
  first-run state, not a fixture.
- Demo seed (`apps/desktop/src/demo/sampleDocument.ts`) is the only built-in
  realistic dataset.

## Existing quality gates

- Vitest per package; Playwright E2E in `tests/e2e/home/*` (19 specs) and
  `tests/e2e/*` shell specs.
- `pnpm audit:tokens` (WCAG pairs, 3 themes), `audit:radius`, `audit:emoji`,
  `audit:docs`, `audit:imports`, `audit:spacing`, `audit:sizing`.
- Pre-commit health/complexity gate; `scripts/audit-architecture.mjs`.
- No existing automated check for heading order, landmark nesting, or nested
  interactive controls on Home/shell.

## Feature-parity inventory (must not be lost)

Home: create/import/open, drag-and-drop, multi-select + range select, rename
(inline), favorite, pin, duplicate, delete → Trash, restore, sort, filter,
search, saved searches, projects, templates, workspaces, activity, asset
browser, keyboard shortcuts + help, resume editing, sidebar collapse, storage
error alert, skip link.

Shell: tabs (roving tabindex, arrow keys, Enter/Space, Delete close, middle-click
close, dirty indicator, close confirmation), menubar, workspace modes, docked
panel show/hide/resize, floating toolbar, status bar, command palette,
distraction-free mode.

The shipped change touches none of these. The reverted change preserved them
but traded one accessibility violation for another (FINDINGS F-04).
