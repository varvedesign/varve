# Home integration review — 2026-10-23

Source: `0284785ef46cb48d33bfd187e470b0522df54b31`, integrated onto
`f607059a7918a341a6c784d76fdc10428c08b706`. Review found no implementation
defect in the three-file semantic-heading change: `EmptyState` accepts a
heading level and Home chooses the level appropriate to its outline.
Existing styles are retained. Original source branches and audit images remain
preserved; concurrent main-checkout work is outside this integration.

## Corrected historical evidence

The original [audit evidence](../agents/shell-home-audit/EVIDENCE.md) now
distinguishes ImageMagick's weighted error units from distinct changed pixels.
The retained Home pair differs in 51 pixels (0.003935%) in a 7x8 corner box;
the retained editor images are identical at their actual 1440x901 dimensions.
The unretained sizes cannot be independently recounted. Splitter-to-splitter
distance alone did not establish a target-spacing exception; that conclusion
has been withdrawn. Fresh keyboard probes exercised arrows, Home/End and reset,
but do not establish global adjacent-target spacing compliance.

The learning visual's old A/B description named the wrong source SHA and
incorrectly attributed hint dismissal to tool reset. Its comment now states
only the observed timer behavior. The empty-canvas baseline disables idle
contextual tips through its existing preference; dedicated tip scenarios stay
enabled.

## Presentation fixture recovery

Three stale `.presentation-audience__image` selectors now address the actual
canvas surface, matching the already-present main-checkout correction without
altering that checkout. Creation and the populated PDF/PNG export case passed.
The 100-slide case retains its original budget, real duplications, assertions,
screenshot and timing/heap output. Tracing is disabled only for that stress
case: an unchanged-source trace-off probe passed (107108ms authoring, 1629ms
last-slide navigation/presentation), whereas the traced run timed out during
authoring. Instrumentation overhead is a supported contributor, not a controlled
exclusion of shared-machine contention. Its first normal-command confirmation
failed during discovery because Playwright forbids worker-scoped trace options
inside a describe group. The identical stress body now has its own
`presentation-authoring-stress.spec.ts`, with trace off at file scope;
ordinary authoring stays traced. A lexical token comparison confirms the moved
body matches the original after the established audience-selector repair, and
the shared 180000ms timeout is inherited. The canonical confirmation passed:
discovery listed both specs, the stress case completed in 84.6s wall time
(59226ms authoring, 685ms last-slide navigation/presentation, 304MB used heap,
screenshot captured), and all four required audits passed afterward with the
source fingerprint unchanged (`cd1fb3ba4fe5…`).

## Agent validation report

- Changed scope: Home/shared EmptyState semantics and test; historical audit
  corrections; learning visual stabilization and presentation fixture repair
  plus the isolated stress spec.
- Plan: the final affected plan selects 23 lanes with no full-suite
  escalation; the two browser-spec repairs add their direct ownership and E2E
  compiler checks.
- Commands actually run: `pnpm verify:plan`; the interrupted
  `VARVE_TEST_WORKERS=2 VARVE_E2E_WORKERS=1 VARVE_E2E_PORT=5387 pnpm verify:affected --staged`;
  selective compiler, unit, browser and audit commands recorded verbatim in the
  manifests below. An interrupted executor is not an aggregate pass.
- Passed: seventeen initial affected lanes, including touched checks, selected
  audits, six compiler lanes, Home 211/UI 726/desktop 90 unit tests and the direct
  EmptyState tests. Subsequent website units passed 325 tests; eight editor
  batches passed 9037 with two existing skips.
- Browser evidence retained: groups 1–2; four original group-3 passes; eleven
  launch-blocked group-3 recoveries; seventeen group-4 recoveries; the creation
  and populated export reruns. Four original learning visuals plus the exact
  empty-canvas recovery passed. The file-scope stress confirmation passed with
  discovery, E2E compiler, both spec files' Biome and four audits green under
  one unchanged fingerprint.
- `pnpm audit:docs`, `pnpm audit:imports`, `pnpm audit:emoji` and
  `pnpm audit:tokens` passed both after the learning run and again in the
  file-scope stress confirmation.
- Skipped as unrelated: Rust workspace, native GUI, renderer benchmarks and
  website browser suite for the heading-only Home change. The heading has no
  style/marketing capability change; the browser demo consumes its markup.
- Full suite run: no. Escalations: none for this Home slice. Separate depth
  tokens/layout and whole-snapshot certification retain their own obligations.
- Browser evidence is TS fallback; no native/WASM parity claim.

Exact local commands, source fingerprints, reports and original failures live
in the common Git directory under `shell-home-evidence/20261023/`:
`home-affected.log`, `home-unit-batches.json`, `home-e2e-results.json`,
`home-browser-recovery.json`, `home-focused-recovery.log`,
`home-learning-audits.log`, `home-empty-canvas-recovery.{log,exit}`,
`presentation-stress-diagnosis.md`, `presentation-stress-canonical.{log,exit}`
(preserved failure), `presentation-stress-move-equivalence.json` and
`presentation-stress-file-scope.{json,log,exit}` (passing confirmation).
