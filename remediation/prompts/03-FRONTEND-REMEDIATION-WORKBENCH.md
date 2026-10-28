# Front-End — Remediation Workbench

## Trigger
Run this only when `GAP_ANALYSIS.md` answers yes to any front-end necessity gate question, or when the platform has no workbench for the 964-entry queue.

## Goal
Build or improve a **remediation workbench** that helps an operator drive the queue down. Do not just port a frozen-count table. Improve on the common failures of backlog dashboards.

## Research first
Write `FRONTEND_RESEARCH.md` covering:
- Dashboard complaints: count-only views hide stale risk; users want aging buckets, SLA standing, changed-line visibility, filters, and less configuration overload.
- Large-batch UI complaints: managing thousands of changesets becomes clumsy; per-item review and bulk actions degrade.
- Visual diff complaints: color-only highlights are ambiguous; screenshots are confusing without context.
- What the platform’s current UI does well and what must not regress.

## Required capabilities
- KPI strip: frozen count, entries paid down this week, net backlog change, median time-to-seam, batch progress A/B/C/D.
- Aging buckets per batch: 0–7, 8–30, 31–90, 90+ days. Do not let the 964 count hide a 90-day tail.
- Entry table: path, batch, frozen ceiling, current lines, seam status, worktree, PR, last action, owner.
- Ratchet-down trend: a sparkline or small chart that shows the count only going down. Flag any non-decrease.
- Baseline drift alert: if regeneration would add an entry or raise a ceiling, block the action in the UI and explain why.
- Per-entry action: “Plan seam” opens the generated `SEAM_SPEC.md`; “Start seam” creates the worktree and emits the prompt; “Visual diff” opens before/after if UI was touched.
- Empty, error, loading, and permission states for every panel.
- Accessibility: keyboard navigation, visible focus, screen-reader labels, no color-only status.
- Responsive layout at desktop and tablet breakpoints; dark mode only if the platform already supports it.

## What not to do
- Do not build a configuration-heavy admin panel.
- Do not show a single total without aging and batch breakdown.
- Do not use color alone to communicate ratchet status.
- Do not hide changed-line counts in the PR view.
- Do not add a front-end if the platform already has an adequate workbench; improve the existing one instead.

## Visual validation
Run `04-VISUAL-VALIDATION-AND-CLOSEOUT.md`. Capture:
- Workbench with 964 synthetic entries, including long paths and stale entries.
- Entry detail with a seam plan.
- Empty state and gate-blocked state.
- Before/after for every changed component.

## Real-world test scenario
Seed the workbench with 964 entries across Batch A–D, 15% stale entries, 10% entries with names longer than 120 characters, and at least one entry whose regeneration is blocked. Verify the KPI, aging buckets, filters, and ratchet trend all render correctly. Do not use only five fixtures.

## Output
- Front-end code in a dedicated worktree.
- `FRONTEND_RESEARCH.md`, `VISUAL_VALIDATION.md`, and before/after baseline images in Git LFS.
- A `NEXT_PROMPT.md` if the workbench needs a second slice.
