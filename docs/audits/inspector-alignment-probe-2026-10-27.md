# Inspector three-edge alignment probe — baseline measurement (2026-10-27)

**Scope:** strict three-edge alignment of side-by-side `.insp-field` rows in
the Design tab, measured on merged master `09abac2de` with the probe added in
`b835728d9` (`tests/e2e/inspector/alignment-probe.spec.ts`). Evidence:
`reports/inspector-alignment/alignment.{json,txt}` (git-ignored).

## Definition

Two rates are recorded per sample (shape and text selections, 320px and
640px rails, all Design sections expanded, stacked rows excluded):

1. **Global three-line (informational):** all rows measured against the
   panel's own modal label-left / control-left / control-right lines
   (1px tolerance).
2. **Section-template conformity (the gate):** rows classified by template
   role — `single`, `paired-first`, `paired-second`, `field-action` — and
   graded against the modal lines of their own (section, template-role)
   peers. This catches drift from a row's own column system without
   punishing designed compositions.

## Results (merged master)

| Sample | Section-template | Global three-line | Rows |
|---|---|---|---|
| shape@320 | 100.0% | 0.0% | 8 inline (+1 stacked) |
| text@320 | 100.0% | 81.5% | 27 inline (+5 stacked) |
| shape@640 | 100.0% | 0.0% | 8 inline (+1 stacked) |
| text@640 | 100.0% | 81.5% | 27 inline (+5 stacked) |

Decomposition of the global rate:

- The **right edge already conforms everywhere**: every control ends flush
  at content-right.
- The **left edge conforms** for every first-column label; the only
  deviation is second-column labels in the two-up position grid (`Y`/`H`).
- Global middle-edge "failures" are the designed compositions: the two-up
  `X/Y`, `W/H` grid (second column starts at its own x) and the
  corner-radius `field+action` row (number field plus per-corner toggle,
  which ends short of content-right by the button's width). Shape samples
  are small (8 inline rows), so the two-up rows dominate the modal column
  and even conforming full-width rows read as global failures — the shape
  global rate is a sample-composition artifact, not drift.

## Decision (user-approved route B, 2026-10-27)

Route B — section-declared column templates plus outlier fixes — was chosen
over a global fixed control column (A) and two-up elimination (C). The
"corner-radius outlier" suspected during planning dissolved under
inspection: it is a deliberate field+action composition, so **no product CSS
change was required**. The probe now guards template conformity at 100%
today; any future row that drifts from its (section, template) peers fails
the probe guard's sample floors and shows up in `alignment.txt` with its
section, role, and edge deltas.

## Reproduction

```bash
VARVE_E2E_PORT=<free port> node scripts/quality/heavy-lease.mjs \
  "e2e: alignment probe" -- \
  npx playwright test tests/e2e/inspector/alignment-probe.spec.ts \
  --project=chromium --workers=1 --reporter=list
```
