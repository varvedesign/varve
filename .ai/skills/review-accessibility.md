# Review accessibility

Review a UI change against the repository's accessibility evidence contract:
tokens and contrast, APG keyboard semantics, forced-colors, and targeted browser
axe scans. Evidence matrix:
[accessibility-validation-matrix.md](../../docs/quality/accessibility-validation-matrix.md).

## When to use

- A task adds or changes a component, menu, dialog, popover, drawer, toolbar,
  tablist, tree, or canvas-adjacent surface.
- An axe, keyboard, contrast, or High Contrast failure must be fixed, or a
  change claims an accessibility improvement.
- Not for export/output conformance claims beyond the named evidence, or the manual AT pass.

## Required context

- [accessibility-validation-matrix.md](../../docs/quality/accessibility-validation-matrix.md) -
  what automation covers and what it does not.
- [focus-navigation.md](../../docs/architecture/focus-navigation.md) and [overlay-system.md](../../docs/architecture/overlay-system.md): APG patterns, focus containment.
- [design-token-system.md](../../docs/architecture/design-token-system.md) -
  tokens, theme/contrast/forced-colors blocks, generated `tokens.css` rule.
- [systems-editing-and-ui.md](../../docs/agents/systems-editing-and-ui.md) -
  toolbar/workspace/disclosure invariants, forced-colors block.
- [output-accessibility-guidance.md](../../docs/architecture/output-accessibility-guidance.md) for exported output.

## Steps

1. Scope the surface and states, look up the APG pattern in `focus-navigation.md` /
   `overlay-system.md`, and note the expected keyboard model before reading code.
2. Tokens and contrast: theme tokens only; no hardcoded color, space, or type
   values; never hand-edit generated `tokens.css`. Run `pnpm audit:tokens`
   (WCAG 2.2 AA pairs across three themes plus undefined `var()` references).
3. Keyboard: one tab stop with roving focus where APG requires it; Tab/Shift+Tab
   order; arrows, Home, End; Escape dismissal; focus contained while open and
   restored to the trigger; no positive `tabindex`; named canvas alternatives.
4. Forced colors and motion: keep the `forced-colors: active` block and High
   Contrast behavior; verify the `prefers-contrast` theme lifecycle and
   `prefers-reduced-motion` still hold for the changed surface.
5. Semantics: accessible names, `aria-checked`/`aria-expanded`/`aria-selected`
   state, no stale announcements, 24 CSS px pointer target and type floors.
6. Extend a targeted axe spec with `AxeBuilder` (`@axe-core/playwright`) for new
   states; run existing a11y/axe specs under the heavy lease; fix real violations.
7. Update the evidence matrix row when coverage or claims change; upgrade no claim without a passing named path.

## Exact commands

```bash
pnpm audit:tokens
node scripts/quality/heavy-lease.mjs "a11y: <surface>" -- \
  npx playwright test tests/e2e/a11y --project=chromium --workers=1 --reporter=list
node scripts/quality/heavy-lease.mjs "a11y: <spec>" -- \
  npx playwright test tests/e2e/a11y/prompt-dialogs-axe.spec.ts \
  --project=chromium --workers=1 --reporter=list
pnpm test:agent <component test path>     # roving focus / ARIA logic
pnpm check:agent
```

## Definition of done

- The token audit passes and no hardcoded visual values were introduced.
- Keyboard path, focus containment and restore, forced-colors/High Contrast, and
  reduced-motion behavior are verified on the changed states.
- A targeted axe spec passes for new states (or an existing one was extended);
  a11y Playwright specs pass under the heavy lease.
- The evidence matrix is updated when coverage or claims change; wording stays
  "named path verified", never "WCAG compliant" or "certified".
- Report exact commands, spec paths, and any manual check not run.

## Do not

- Claim WCAG 2.2 AA conformance or certification from axe or from these specs.
- Hide nodes, add `aria-hidden`, or disable axe rules to quiet a failure.
- Remove forced-colors/theme blocks, add literal colors/spacing/type, or
  hand-edit generated `tokens.css`.
- Fake interaction with DOM unit tests; verify keyboard and focus in a real
  browser.
- Run full Playwright unwrapped, update visual snapshots to pass, or skip the
  keyboard pass for an interactive surface.
- Commit.
