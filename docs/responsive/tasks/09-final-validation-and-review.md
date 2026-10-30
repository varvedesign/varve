# Task 09 — Final validation and review gate

Status: done (first gate 39e9be06e/1009de823; session-2 re-gate at 8adaf3377) | Depends on: 01a, 03a, 03b, 04a | Rollback: — (validation gate; no production change)

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

## Final gate record (first gate, 2026-10-29, HEAD 39e9be06e / code 1009de823)

| Gate | Command | Result |
|---|---|---|
| Full responsive matrix | pnpm validate:responsive --app all --reuse-website-dist | PASS 152/152 checks, 41 screenshots (17,962,619 bytes) in docs/responsive/screenshots/1009de823/ |
| Safe-area harness | pnpm validate:safe-area | PASS 134/134 checks, 0 skipped, 10 PNG screenshots (12 files incl. reports) in docs/responsive/screenshots/1009de823/safe-area/ |
| Deadline devices | matrix includes 13in-125pct 1093x614, 13in default 1180x720, 1180x820, 1366x1024, 1024x1366, 1440x900, 1512x982, 1536x864 | all PASS |
| States with panel open | matrix captures layers-open frames at every viewport | PASS |
| Desktop equivalence | 7d81006e6 vs 1009de823: 16/16 editor viewports within 1px shell registration; website 19/20 byte-identical, 1 differs only in an animated region (<0.6% AE) | accepted, documented in review round 2 |
| Independent review | cdp-scout round 1 (blocker + coverage gaps) and round 2 (coverage gaps) — all findings fixed and re-verified; repro-broker verified task 03a/04a | resolved |
| Timeline fix verification | repro-broker re-measured label authority/keyframe overlap/docked controls; evidence under screenshots/39e9be06e/timeline/ | verified (see task 03a) |
| Layers/targets verification (03b) | drawer-aware probe at 1180/1366/1024, fine+coarse; evidence under screenshots/1009de823/dense/ | verified (see task 03b) |
| Docs / size / emoji | pnpm audit:docs, audit:filesize, audit:emoji | clean |
| STATE accuracy | every done row has a commit in git log; deferred rows have reasons; no in-progress rows | verified |

Deferred tasks after this gate: 01b (no user-visible defect), 04b (real
dialog grids unreproduced), 05 (no defect reproduced). Task 03b was completed
after the first gate and re-validated (see task 03b and STATE.md).
COMPLETION.md remains valid because every non-deferred task is done.

## Session-2 re-gate (2026-10-29, code HEAD 8adaf3377)

Fresh-session re-run after closing R1 (757e304be + 8adaf3377) and the
dense-data probe (441bf1127). Evidence: screenshots/8adaf3377/.

| Gate | Command | Result |
|---|---|---|
| Full responsive matrix | pnpm validate:responsive --app all --reuse-website-dist | PASS 152/152 checks, 0 failed, 41 PNGs (18,029,601 bytes) in screenshots/8adaf3377/ |
| Safe-area harness | pnpm validate:safe-area | PASS 134/134 checks, 0 skipped, 10 PNG (12 files) in screenshots/8adaf3377/safe-area/ |
| Dense-data probe | pnpm validate:dense | PASS 121/121 checks, 0 failed, 10 PNG (12 files) in screenshots/8adaf3377/dense/ |
| Drift checks (assertions only) | matrix/safe-area/dense on a3796c0ba | PASS 152/152, 134/134, 121/121 |
| Desktop equivalence | 1009de823 vs 8adaf3377 | editor 20/21 byte-identical (desktop-1536x864 AE 0.33%); website 18/20 byte-identical (AE 0.17%/0.019%); no layout delta |
| Completion-claim audit | independent read-only auditor | PASS task rows vs git, evidence dirs, audits; stale doc counts corrected in this commit |
| Docs / size / emoji / biome | audit:docs, audit:filesize, audit:emoji, biome changed set | clean |
| STATE accuracy | every done row has a commit; deferred rows have reasons; no in-progress | verified |

Deferred after the re-gate: 01b, 04b, 05 (reasons updated by session-2 recon)
and 10 (notch-safe floating overlays, implementation recipe in tasks/10).