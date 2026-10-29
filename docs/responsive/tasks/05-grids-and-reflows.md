# Task 05 — Grids and landing-page reflow

Status: deferred | Depends on: 02 | Rollback: —

## Scope
- packages/home/src/home.css grid ladders
- apps/website landing grids (index.astro:538-560, TrustStrip, ProductShowcase,
  SiteFooter ladders)

## Failure mode
None reproduced. The bounded audit found deliberate 4-step ladders on the
site (TrustStrip <=900/<=480, footer <=1100/<=720/<=480/<=420/<=330, bento
<=640) and the Home shell already drops to 1fr at <=768 (home.css:3323).
Deferring avoids rewriting working grids without evidence.

## Change
Re-open only with a reproduced screenshot defect (e.g. a specific grid at a
specific width). Then make the smallest additive collapse rule, not a
redesign.

## Validation
- Harness matrix (task 08) must keep reporting 0 overflow for Home and site
  routes; 320/375/768/1366 screenshots per changed surface.

## Size check
Not scheduled. Mark deferred until evidence exists.