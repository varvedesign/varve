# Task 07 — Marketing site dense tables and route reflow

Status: done | Depends on: none | Rollback: 26e8dc5a6 (revert removes the scroll regions; tables remain readable but can widen at high text zoom)

## Scope
- apps/website/src/pages/about/license.astro
- apps/website/src/pages/docs/performance.astro
- (validation) scripts/validate-responsive.mjs website routes

## Failure mode
Audit D5: .license-table (license.astro:80) and .perf-table
(performance.astro:41) render without the shared .scroll-x scroll region
used by compare.astro:109 and download.astro:655 (overflow-x: auto;
tabindex=0; role=region; aria-label). The site body has no overflow-x guard
(global.css:176-184), so at 375/320 a table that cannot wrap pushes the
document wider than the viewport. Neither route is covered by
apps/website/tests/e2e/reflow.spec.ts ROUTES.

## Change
Wrap each dense table in the existing .scroll-x recipe with
tabindex='0', role='region' and a route-specific aria-label, matching the
compare/download pattern exactly (no new CSS). No table min-width is needed
for these two tables; the wrapper is the guarantee. Do not restyle the
tables and do not add a global overflow-x guard (it would mask future
overflow instead of fixing it).

## Validation
- Routes /about/license and /docs/performance at 320, 375, 768, 1366; assert
  documentElement.scrollWidth <= innerWidth; table region scrollWidth >= its
  clientWidth at 375 (i.e. scrolling is available) and keyboard-scrollable
  (tabindex=0).
- Existing routes in the harness (/, /product, /download) must stay clean.
- Screenshots: website/license-375x800.png, website/license-768x900.png,
  website/performance-375x800.png, website/performance-1366x900.png.
- Website dev/prod build must still typecheck (astro check is covered by the
  repo build script; run the website build or the route-render harness).

## Size check
Two page wrappers + harness routes: one session.