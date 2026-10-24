# DECISION — is a front end needed, and which one?

**Yes, but no new surface and no new visual direction.** The task is to fix
existing screens, and the measured defects are semantic/layout conformance
issues, not missing capability.

## Does the task need UI at all?

The defects found are in the UI itself (document outline, landmark structure,
control composition, mobile field sizing). No amount of backend, notification,
or automation work removes them. The one "no-UI" alternative — dropping the
close affordance and relying on the Delete key — was rejected because it removes
an affordance users rely on (see RESEARCH, rejected ideas).

## Which kind of UI work?

1. **Improve the existing screen** — Home and the editor shell. Chosen.
2. Extend an existing screen — not needed; no capability gap was measured.
3. New screen — not needed.
4. New surface (admin/console/widget) — not needed.

## Interaction style

Existing direct-manipulation desktop UI is correct for the users (expert design
work, high frequency, keyboard-heavy). Nothing here argues for a command
palette, wizard, or natural-language layer.

## Is the existing front end fit for the task?

Yes for experts (keyboard shortcuts, roving tabindex, dockable panels). The
gaps are conformance gaps that affect assistive-technology users and mobile
browser users disproportionately, which is exactly the WCAG 2.2 AA floor.

## Tooling front end for verification

`audit-kit/setup.mjs` + the `--setup` hook in the local `ui-audit.mjs` copy are
**development-only measurement tooling**. They are untracked, excluded from
git, and never shipped. No kitchen-sink route was added to the product.

## Approval status

- No tokens, colours, spacing, typography, or component visuals were changed.
- The shipped fix changes an HTML heading level only; the retained 1440px
  pair differs in 51 pixels (0.003935 %), confined to a 7×8 px corner region
  (2026-10-23 correction; see EVIDENCE).
- Therefore this session did not cross the "design implementation" gate that
  requires route approval.
- The items that *would* require a product/design decision (F-01, F-03, F-04,
  F-05, F-06) are specified in `PLAN.md` and left unapplied.
