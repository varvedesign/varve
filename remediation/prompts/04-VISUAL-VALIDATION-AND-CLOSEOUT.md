# Visual Validation and Closeout

## When required
Mandatory if the seam changes rendered output, an API shape consumed by UI, error/empty/loading states, or the remediation workbench. For pure backend seams, run contract tests and state “no visual surface changed.”

## Before/after capture
Use Playwright or the platform’s existing visual test harness.
- Capture baseline **before** the seam in the same environment.
- Capture **after** in the same viewport, same data, same browser.
- Disable animations.
- Mask timestamps, ads, and other dynamic content.
- Use a pixel-diff threshold of **0.1–0.3**; do not accept a 0.0 threshold as a goal.
- Prefer **component-level** screenshots for changed components; use full-page screenshots only for layout-level changes.
- Store reference images in Git LFS.

## Required screenshots
- The changed component or page, before and after.
- The workbench KPI strip and entry table, before and after, if the front-end is touched.
- Responsive breakpoints: desktop and tablet.
- Empty state, error state, loading state, and gate-blocked state if applicable.

## Review rules
- Any diff above threshold must have a written explanation. “It looks fine” is not an explanation.
- If a diff is caused by dynamic data, fix the test harness, not the threshold.
- If a backend seam changed an API shape, run visual validation on every consuming page.
- If no visual change is expected, assert that the diff is zero and record the contract test that proves it.

## Closeout
Write `VISUAL_VALIDATION.md` with:
- Environment and viewport.
- Data volume used.
- Threshold and rationale.
- Screenshot paths.
- Diffs accepted/rejected and why.
- Any UI surface that remains unvalidated and why.

Do not merge until `VISUAL_VALIDATION.md` exists.
