# Task 08 — Documentation and committed validation harness

Status: done | Depends on: none (must be re-run after every task) | Rollback: 7d81006e6 (harness) + final artifact commit

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
- Result (2026-10-29): PASS 152/152 checks (16 editor viewports incl. the two
  13in window entries, 20 website route-viewport pairs), 41 screenshots in
  docs/responsive/screenshots/7d81006e6/, report.json + report.md;
  `pnpm validate:responsive` entry added to package.json.
- Carried review finding R1: the orchestrator functions exceed the 50-line
  ceiling and the files sit at the hard 400-line cap (a COMPLEXITY marker was
  rejected by audit:filesize:staged at 403/404). Splitting the orchestrator is
  the first action of this task's follow-up.

## Session-2 follow-ups (2026-10-29)
- R1 resolved: scripts/responsive/server.mjs (editor/website lifecycle) and
  scripts/responsive/editorProbe.mjs (serialized probes + checks) extracted;
  validate-responsive.mjs 400 -> 287 lines, capture.mjs 400 -> 207. Follow-up
  fix 8adaf3377 restores ROOT resolution after the move. Full matrix re-run
  PASS 152/152.
- Dense-data probe added: scripts/responsive/dense-data.mjs + dense/ modules
  (replaces the scratch .tmp-resp-repro probe), wired as `pnpm validate:dense`;
  assertions-only PASS 121/121. Evidence JSON/PNGs are committed under
  docs/responsive/screenshots/<sha>/dense/.

## Size check
Three small modules + data + docs: one session for the harness; docs are
updated in the same commit as status changes.