# Task 08 — Documentation and committed validation harness

Status: in-progress | Depends on: none (must be re-run after every task) | Rollback: —

## Scope
- scripts/validate-responsive.mjs, scripts/responsive/matrix.mjs,
  scripts/responsive/capture.mjs (new; each <=400 lines)
- package.json script entry validate:responsive (heavy-lease wrapped)
- docs/responsive/** (this documentation set)
- docs/responsive/screenshots/<sha>/ (committed artifacts + report.json/report.md)

## Failure mode
Responsive claims were previously verified by ad-hoc Playwright runs whose
artifacts were never committed; a fresh session could not confirm from the
repo alone that 1366x1024 or 1180x820 with a side panel open had ever been
looked at. Manual assertions also drifted from the committed e2e matrix.

## Change
One command: pnpm validate:responsive (wraps
node scripts/quality/heavy-lease.mjs 'validate:responsive' -- node
scripts/validate-responsive.mjs). It starts/reuses the Vite dev server, walks
the matrix with a single document, asserts no page-level overflow and no
clipped header chrome, optionally builds+serves the marketing site for the
selected routes, and writes screenshots + report.json/report.md under the
current short SHA. Flags: --app editor|website|all, --out, --no-screenshots,
--reuse-website-dist. Exit code is non-zero on any assertion failure.

## Validation
- Run the harness on the final tree; every assertion passes.
- report.md lists every viewport and its result; screenshots referenced by
  the report exist on disk (committed).
- Packaged commands documented in docs/responsive/README-less STATE: the exact
  command is repeated in STATE.md so resumption needs one hop.

## Size check
Three small modules + data + docs: one session for the harness; docs are
updated in the same commit as status changes.