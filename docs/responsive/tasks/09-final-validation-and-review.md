# Task 09 — Final validation and review gate

Status: done (39e9be06e) | Depends on: 01a, 03a, 03b, 04a | Rollback: — (validation gate; no production change)

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

## Final gate record (2026-10-29, HEAD 39e9be06e)

| Gate | Command | Result |
|---|---|---|
| Full responsive matrix | pnpm validate:responsive --app all --reuse-website-dist | PASS 152/152 checks, 41 screenshots (17,962,619 bytes) in docs/responsive/screenshots/1009de823/ |
| Safe-area harness | pnpm validate:safe-area | PASS 134/134 checks, 0 skipped, 12 screenshots in docs/responsive/screenshots/1009de823/safe-area/ |
| Deadline devices | matrix includes 13in-125pct 1093x614, 13in default 1180x720, 1180x820, 1366x1024, 1024x1366, 1440x900, 1512x982, 1536x864 | all PASS |
| States with panel open | matrix captures layers-open frames at every viewport | PASS |
| Desktop equivalence | 7d81006e6 vs final: 16/16 editor viewports within 1px shell registration; website 18/20 screenshots byte-identical, 2 differ only in animated regions (<0.6% AE) | accepted, documented in review round 2 |
| Independent review | cdp-scout round 1 (blocker + coverage gaps) and round 2 (coverage gaps) — all findings fixed and re-verified; repro-broker verified task 03a/04a | resolved |
| Timeline fix verification | repro-broker re-measured label authority/keyframe overlap/docked controls; evidence under screenshots/39e9be06e/timeline/ | verified (see task 03a) |
| Layers/targets verification (03b) | drawer-aware probe at 1180/1366/1024, fine+coarse; evidence under screenshots/1009de823/dense/ | verified (see task 03b) |
| Docs / size / emoji | pnpm audit:docs, audit:filesize, audit:emoji | clean |
| STATE accuracy | every done row has a commit in git log; deferred rows have reasons; no in-progress rows | verified |

Deferred tasks after this gate: 01b (no user-visible defect), 04b (real
dialog grids unreproduced), 05 (no defect reproduced). Task 03b was completed
after the first gate and re-validated (see task 03b and STATE.md).
COMPLETION.md remains valid because every non-deferred task is done.