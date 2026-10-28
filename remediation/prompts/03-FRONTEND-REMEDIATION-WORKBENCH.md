# Front-end gate - bounded UI-surface changes (repo-native)

This is a **gate**, not a workstream. The repository has **no remediation
workbench**: there is no dashboard, queue UI, or admin panel for the god-file
backlog, and none is in scope for Batch A. The frozen queue is
`.file-size-baseline.json` plus `BACKLOG_LEDGER.md` plus the dated docs, read
by agents through `pnpm audit:filesize` and
`node scripts/quality/audit-file-size.mjs --report`. Do not plan, design, or
build a workbench from this prompt, and do not port the frozen-count table into a
new front end.

## Trigger

Run this gate only when the seam or a linked task changes a rendered surface or
the contract behind one:

- a component, inspector section, panel, menu, dialog, popover, drawer, toolbar,
  tablist, or canvas-adjacent surface;
- an API (IPC) response shape, error state, empty state, loading state, or
  permission state consumed by the UI;
- a visual design change that a user can see.

A-04 does **not** trigger it: the IntelligencePanel split is a pure move that
must render identical UI. The gate is answered "not triggered" in
`remediation/A-04/GAP_ANALYSIS.md` and `SEAM_SPEC.md`; no UI code is written.

## Necessity questions (answer with evidence first)

1. Does the change alter anything an operator sees or does in an existing
   surface? No means stop here.
2. Does it change an API/IPC response shape the UI consumes? Use the typed
   contract in `docs/architecture/ipc-type-contract.md` as evidence.
3. Does it change error, empty, loading, or permission states? These are
   behavior, not styling; they need component coverage.
4. Is the change only internal (module boundary, export path, implementation)?
   If yes, the required proof is the unchanged component test plus a "no visual
   surface changed" statement; do not open a visual-baseline task.

If the answer to any of 1-3 is yes, link
`04-VISUAL-VALIDATION-AND-CLOSEOUT.md` in the same task before merge. Do not
silently fold UI work into a refactor seam.

## Rules when the gate fires

- **Reuse existing surfaces.** Improve the existing component, section, or
  dialog; do not add a configuration-heavy admin UI, a new navigation layer, or
  a new global stylesheet. Respect the 3-File / 1-Seam budget and the hub import
  rules in `AGENTS.md` (no new import in `CanvasArea.tsx` or `Shell.tsx`
  unless one of equal weight is removed).
- **Component behavior first.** Extend or run the nearest existing component
  test (`pnpm test:agent <spec>`). jsdom + Testing Library is the unit surface;
  real pointer/canvas/browser-API behavior needs a Playwright E2E spec under the
  heavy lease (`node scripts/quality/heavy-lease.mjs "e2e: <surface>" -- npx
  playwright test <spec> --project=chromium --workers=1 --reporter=list`).
- **Accessibility is part of the gate.** Follow `.ai/skills/review-accessibility.md`
  and the hard rules in `AGENTS.md`: tokens only (no hardcoded color, space, or
  type values; never hand-edit generated tokens), no native `<select>`, no raw
  `varve-btn`, no emoji, no color-only status. Keyboard model must follow APG
  (one tab stop, arrows/Home/End where applicable, Escape dismissal, focus
  containment and restore), the forced-colors block and reduced-motion behavior
  keep working, and 24 CSS px pointer targets and type floors hold. Run
  `pnpm audit:tokens`; add a targeted axe spec only for genuinely new states,
  and run it under the heavy lease. Never claim WCAG conformance or
  certification from axe.
- **States are required.** For any new or changed surface, cover default,
  empty, loading, error, disabled, and permission-denied states that can occur,
  plus desktop and tablet widths. No color-only status; no count-only total
  without a breakdown if a queue/count is displayed.
- **No data-shape shortcuts.** Do not add a UI to work around a missing API or
  to expose internal file paths; fix the adapter or the command instead. Payload
  changes follow the IPC contract and `pnpm audit:ipc`.
- **Visual change goes through 04.** If pixels change intentionally, run
  `04-VISUAL-VALIDATION-AND-CLOSEOUT.md` and update only the affected
  spec/project with `pnpm visual:update --spec <spec> --project <project>
  --reason "<design intent>"`. A pure code move never updates a visual baseline.

## A-04 application (record verbatim in SEAM_SPEC.md)

- Necessity gate: **not triggered**.
- No remediation workbench exists and none is created.
- Rendered UI, DOM structure, class names, props, API shapes, and error/empty/
  loading states are unchanged by a declaration move.
- Proof: `pnpm test:agent packages/editor/src/panels/IntelligencePanel.test.tsx`
  passes 9/9 before and 9/9 after, unchanged.
- Visual statement: "no visual surface changed"; no visual baseline update, no
  Playwright lane, no screenshot review.

## Do not

- Do not build a remediation workbench, dashboard, backlog admin panel, or a
  generated UI over `.file-size-baseline.json`.
- Do not add a config-heavy UI, a new global CSS file, or a new hub import.
- Do not use color alone for status, hide required empty/error/loading states,
  or add literal colors, spacing, or type values.
- Do not update visual snapshots, run broad `--update-snapshots`, or add new
  Playwright captures for a pure refactor.
- Do not claim accessibility conformance, certification, or full coverage from
  automated checks.
- Do not commit.
