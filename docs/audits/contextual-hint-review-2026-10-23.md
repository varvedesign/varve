# Contextual hint review — 2026-10-23

Approved direction: **Stacked hint**, selected on 2026-10-23. Preserve the
incumbent typography, three themes and shared compact close control. A header
owns title, canonical shortcut and dismissal; instructions get the next full row.
The visible component owns one timer, paused while its controls have focus.
Explicit dismissal is immediate and native Enter/Space activation is retained.

## Research and routes

Public Community scouting found Themesberg's
[Flowbite kit](https://www.figma.com/community/file/1179442320711977498/flowbite-design-system)
and Victor Allegret's
[Radix kit](https://www.figma.com/community/file/1280428825266545105/radix-themes).
The Community frames were blocked; none were claimed as inspected.
Actual public demos inspected instead:

- [Flowbite popover](https://flowbite.com/docs/components/popover/): independent
  title/body wrapping and bounded reading measure.
- [Flowbite toast](https://flowbite.com/docs/components/toast/): dedicated close
  allocation beside content.
- [Radix callout](https://www.radix-ui.com/themes/docs/components/callout/):
  content-first wrapping.

These are pattern references, not measured editor-usability evidence. Their
branding, hover-only discovery and notification semantics do not transfer.
Three routes were presented: stacked header/body (selected; clearer but taller),
wrapping callout (more compact but less predictable scanning), and on-demand tip
(least resting chrome but an extra activation). All preserved Varve tokens and
focus-aware dismissal. Token/component rules are recorded in `DESIGN.md` and
[interface sizing](../architecture/interface-sizing-system.md#close-affordance).

## Evidence

At 900x600 the original inline body narrowed to about 44–52px. The new body is
full-width and 13px, with no horizontal overflow in all six inspected combinations
of 900x600/1440x900 and light/dark/high-contrast. The close target remains at least
24px and is visibly focused. Resizing in both directions preserves focus and the
hint. Drawing through the instruction text reaches the canvas.

The first capture attempt lost the hint at 1440px; that image is retained as a
failed capture, not a pass. Recovery installed the fake clock before application
mount and captured the missing states successfully. The original cause remains
unproved. Both captures had unchanged runtime source and no page errors.

Local original evidence lives in the common Git directory under
`shell-home-evidence/20261023/`: `hint-layout-research.md`, `hint-lifetime-red.log`,
`hint-affected.log`, `hint-validation-recovery.{json,log,exit}`,
`hint-visual-v2.log`, `hint-rendered/900-*.png`,
`hint-rendered-recovery/{1440-*.png,measurements.json}`, and `hint-audits.log`.
The recovery manifest records exact commands and source fingerprints.

## Agent validation report

- Changed scope: MicroHints, OnboardingLayer eligibility, three unit files,
  one browser spec, sizing/design documentation and the website interface guide.
- Plan: `pnpm verify:plan` selects 18 lanes, no full-suite escalation.
- `pnpm verify:affected` passed its first thirteen lanes: touched format/lint,
  emoji/docs/radius audits, E2E/editor/desktop/website compilers, direct hint and
  learning tests, and 325 website units. Website units include the same
  `apps/website/src/test` files selected by `pnpm test:website`.
- The editor lane passed 9,031 tests, with two skipped; two further suites could
  not load because temporary storage was full. Their exact recovery passed all
  fourteen tests. This is carried plus targeted recovery evidence, not a claim
  that the interrupted command exited successfully.
- Desktop recovery passed 90 tests. All seven hint browser cases passed across
  original/recovered runs; screenshots were inspected separately as above.
- Website E2E: 710 original passes, thirteen inspected snapshot recoveries and
  five protocol-error recoveries account for all 728 cases. Tolerances unchanged;
  [baseline review](website-baseline-refresh-2026-10-23.md) records accepted drift.
- `pnpm audit:docs`, `pnpm audit:imports`, `pnpm audit:emoji` and
  `pnpm audit:tokens` passed, including all 324 token contrast pairs.
- Impeccable detector over MicroHint TSX/CSS and OnboardingLayer returned no
  findings. Source review found no additional defect in this bounded slice.
- Skipped as unrelated: Rust/native, renderer benchmarks and full visual suite.
  Full suite run: no. This slice does not certify native/WASM parity or the
  separate frozen-depth integration.
