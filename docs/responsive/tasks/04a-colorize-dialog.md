# Task 04a — Colorize dialog phone fit

Status: done — NO DEFECT; dead-CSS cleanup only | Depends on: 02 (done) | Rollback: revert the 04a cleanup commit (restores dead rules; no behavior change)
Split from: tasks/04-forms-and-modals.md on 2026-10-29T15:59:01-07:00

## Scope
- packages/editor/src/components/Inspector/sections/ColorizeSection.css:322
  (the min-width: 420px floor)
- the same dialog's 2-column grid rules only if the reproduction shows they do
  not collapse at <=480px
- no shared varve-dialog primitive edits (it is already fluid:
  min(90vw, 32rem) and keyboard-capped)

## Failure mode
Audit D4: the Colorize dialog body has min-width: 420px, wider than a 375px
viewport, so the dialog cannot fit a phone. This was never exercised in a
screenshot; reproduce through the real UI first.

## Change
Reproduce the Colorize dialog at 375x812 and 320x640 first (open through the
real UI). Replace the fixed floor with a capped one
(min(420px, calc(100vw - 2rem))) and add container/width rules that collapse the
affected 2-column grids at <=480px. Body must scroll; footer actions must stay
reachable. One dialog per commit.

## Validation
- 320x640, 375x812, 390x844, 768x1024, 1180x820, 1366x1024.
- Dialog fits the viewport, body scrolls, footer actions reachable and
  hit-testable, no horizontal document overflow; keyboard focus order unchanged.
- Screenshots committed per dialog at 375 and 1180 under
  docs/responsive/screenshots/<sha>/.

## Rollback
Revert the task 04a commit; CSS-only.

## Outcome (2026-10-29) — NO DEFECT, dead-CSS cleanup only

Reproduction (repro-broker, independent agent):
- `rg -n 'colorize-dialog|ColorizeDialog' packages apps tests` => 9 hits, all
  inside ColorizeSection.css; zero TS/TSX consumers, no rendered element
  (dialog[open]=0, [class*='colorize-dialog']=0) at 1180x820 / 375x812 / 320x640,
  so the 420px floor could never apply.
- The real surface is the inspector disclosure
  .insp-disclosure[data-section-id="colorize"]: document scrollWidth ==
  innerWidth at 375/320, both preview and full-resolution actions inside the
  viewport and elementFromPoint-hittable after scrolling .insp-panel.
- Action taken: deleted the 9 dead .colorize-dialog__* rules (68 lines). No
  capped min-width was added because nothing consumes it. Evidence screenshots
  / measurements are committed under
  docs/responsive/screenshots/<cleanup-commit>/colorize/.
- Task 04b remains: real dialog 2-column grids (ContentAwareFill etc.) were not
  reproduced at phone width in this campaign.

## Size check
Fits one session (one dialog family). The remaining dialog grids are split out
to task 04b.
