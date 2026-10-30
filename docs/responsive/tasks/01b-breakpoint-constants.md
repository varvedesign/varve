# Task 01b — Breakpoint constants (JS matchMedia values)

Status: deferred — no user-visible defect and no remaining session window; the module split is ready to execute in a spare session (see this file) | Depends on: none | Rollback: — (not started)
Split from: tasks/01-global-viewport-foundation.md on 2026-10-29T15:59:01-07:00

## Scope
- NEW packages/editor/src/workspace/breakpoints.ts (one exported constant object)
- the six JS/TS files that repeat the 899 matchMedia literal
- packages/home 768 literal and the --bp-* token group in
  packages/ui/src/tokens/tokens.css (436-440) if it can be wired without a
  generated-token change (tokens.css is generated: do not hand-edit)
- tests that pin the old literals

## Failure mode
Audit D8: breakpoints are literal values — 229 app @media blocks with 44
distinct viewport values, 124 site blocks with 35 values; JS repeats the 899
literal in 6 files and Home repeats 768; the --bp-* token group has zero
consumers. Drift risk, not a user-visible defect. CSS @media cannot consume
custom properties, so the CSS literal migration needs its own generated-CSS
plan and is explicitly out of scope here.

## Change
Extract the repeated JS matchMedia values into one exported constant module and
replace the literals without changing any value. No CSS changes. No behavior
change: grep must show the same resolved numbers.

## Validation
- grep: no remaining duplicated literal outside the constant module (list the
  accepted CSS exceptions).
- `pnpm check:agent` passes; the specs that toggle at 899/768 still pass.
- No visual change, so no new screenshots; note in STATE.md.

## Rollback
Revert the task 01b commit (pure TS refactor, no behavior change).

## Size check
Fits one session; independent of 01a. Run only when there is a session to
spare, because it has no user-visible payoff.
