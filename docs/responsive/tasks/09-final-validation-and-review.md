# Task 09 — Final validation and review gate

Status: not-started | Depends on: 01, 03, 04 | Rollback: —

## Scope
- whole repo (review), docs/responsive/STATE.md + COMPLETION.md

## Failure mode
A responsive campaign that stops without a full-matrix run and a diff review
leaves unverified claims and possibly a desktop regression. The review gate
is also where stale screenshots, TODO-without-ledger and STATE/log drift are
caught.

## Change
Run the complete matrix (pnpm validate:responsive --app all), the repo
responsive e2e specs, typecheck for e2e, and the docs/filesize/emoji audits;
compare desktop 1440x900 and 1536x864 frames against the pre-change baseline;
walk the final diff for scope, god functions (component <=200 lines, function
<=50), a11y and STATE accuracy; then write COMPLETION.md (only if every
non-deferred task is done) and the final Handoff block.

## Validation
- Every matrix viewport passes; committed screenshots for 1366x1024 and
  1180x820 with the side panel open exist and are referenced by report.md.
- Desktop screenshots are unchanged except for intended chrome deltas.
- git log commit list matches the STATE.md table.

## Size check
One session, but only after 01/03/04 are done. It is the campaign gate, not a
place to start implementation work.