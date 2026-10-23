# PLAN — shell + Home

Ordered by severity, then by whether the file is free. Nothing below crosses the
"design implementation" gate: no token, colour, spacing, type, or component
visual changes are proposed. Items marked **blocked** touch files that the live
agent `claude-ui-depth` has dirty or exclusive; they need that agent's branch to
land first, or an explicit decision to take ownership.

## Shipped

### E0 · F-02 — heading level of empty states
- Level: shared component + one screen.
- Change: `EmptyState.headingLevel` (default 3); Home passes 2.
- Alternatives rejected: hard-code `h2` in `EmptyState` (would regress callers
  nested under an `h2`); add a visually hidden `h2` on Home (adds an empty
  heading to the outline).
- Blast radius: 11 Home empty states + TemplatesGallery; default preserves all
  other callers.
- Acceptance: axe `heading-order` = 0 on Home at 320/1440/1920 × light/dark;
  `nested-interactive`/`region` counts unchanged; pixel diff < 0.01 %.
- Verified: yes — see `EVIDENCE.md`.
- Rollback: revert `dcf080c32`.

## Blocked / awaiting a decision

### E1 · F-01 — Home landmark nesting (**blocked**: `HomeShell.tsx` dirty)
- Level: screen.
- Preferred: change the drop-zone wrapper from `<section aria-label="File drop
  zone">` to a plain `<div>` (same class, same handlers). `.varve-home` is
  styled by class only, so no CSS change.
- Alternative: keep `<section>` and drop `aria-label`, moving the drop hint to a
  `role="status"` announcement while dragging.
- Blast radius: Home only. Check `HomeShell.test.tsx` for `section` queries.
- Acceptance: `landmark-main-is-top-level` and
  `landmark-complementary-is-top-level` = 0 at 320/1440/1920 × light/dark; drop
  still imports a file (Playwright `home/file-ingestion.spec.ts`).
- Rollback: single-line revert.

### E2 · F-03 — iOS field zoom (**blocked**: `components.css` exclusive)
- Level: shared component stylesheet.
- Preferred: `.varve-search__input { font-size: max(16px, var(--type-interface-control-size)); }`
  with a comment stating this is the WebKit focus-zoom floor, not a design value.
- Alternative (wider): raise `--type-interface-control-size` to 16 px — affects
  every control; requires a design-system decision and a full visual re-baseline.
- Rejected: `maximum-scale=1` / `user-scalable=no` (RESEARCH A3).
- Acceptance: no `input-zoom-ios` finding on Home at 375 with touch emulation;
  axe `color-contrast` unchanged; no layout shift in the sidebar (CLS ±0.01).
- Rollback: one declaration.

### E3 · F-04 — tab close control (**blocked**: design decision)
- Level: shared shell component.
- Option A (recommended, conformant): keep `tablist > tab` pure, render the close
  buttons in a sibling layer outside the tablist, positioned over each tab and
  kept in sync with scroll/resize. Preserves the affordance and the APG tabs
  pattern. Cost: layout sync code + visual review.
- Option B: keep the current structure and track the violation as accepted debt.
  Rejected as a default: it leaves a WCAG A failure on the most-used control in
  the shell.
- Option C: remove the visible close, close via `Delete` + context menu.
  Rejected: removes an affordance (parity; RESEARCH B1).
- Option D: `aria-hidden` on the close button. Rejected: hides a working control.
- Measured evidence that the "obvious" sibling fix is not enough: it fixes
  `nested-interactive` but breaks tablist ownership (`aria-required-children`).
- Acceptance (Option A): axe `nested-interactive` = 0 **and**
  `aria-required-children` = 0; TabStrip unit tests (roving tabindex, Delete,
  middle-click, close confirmation) still pass; close button visible on
  hover/active/touch; tab width and ellipsis unchanged within 1 px.
- Rollback: feature-flag the close layer or revert the commit.

### E4 · F-05 — editor chrome outside landmarks (**blocked**: `Shell.tsx` dirty)
- Level: shell structure.
- Preferred: give the tab strip a labelled `role="navigation"` (or place it
  inside the existing `<header>`), and wrap the floating toolbar + status
  diagnostic in a labelled region.
- Acceptance: axe `region` = 0 in the editor; no new `landmark-unique`.
- Rollback: structural, single commit.

### E5 · F-06 — duplicate panel landmark (**blocked**: `Shell.tsx` dirty)
- Level: shell structure.
- Preferred: make the two docked panel names distinct (include dock position).
- Acceptance: axe `landmark-unique` = 0.

### E6 · F-07 — presence layer (**needs human check**: collaboration owner)
- Verify paint order with two clients before changing anything.

## Not planned

- Any restyle of Home/shell (owned by the live agent's direction).
- New tokens, new components, new routes.
- Removing or hiding any existing control.
