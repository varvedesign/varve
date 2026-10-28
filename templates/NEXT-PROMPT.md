# NEXT_PROMPT — Frozen god-file remediation (Batch {{BATCH}}, {{ENTRY_ID}})

Generated {{TIMESTAMP}} after completing seam {{COMPLETED_ENTRY_ID}}.
The next session starts from this file plus the remediation doc; do not scan
the repository.

## State

- FROZEN_COUNT (measured): {{FROZEN_COUNT}} tracked frozen entries; excess
  over-cap lines {{EXCESS_LINES}}. Ratchet is monotone non-increasing.
- Last completed seam: {{COMPLETED_ENTRY_ID}} — {{COMPLETED_SUMMARY}}
  (commit {{COMMIT_SHA}}, PR {{PR_URL}}).
- Next queue entry: Batch {{BATCH}} / {{ENTRY_ID}} =
  `{{TARGET_FILE}}` ({{TARGET_LINES}} lines, frozen at {{FROZEN_LINES}}).
- Covering tests: {{COVERING_TEST_FILES}}.

## Inputs (attach only these)

- {{REMEDIATION_DOC}}
- .file-size-baseline.json
- scripts/quality/godsplit-plan.mjs
- {{TARGET_FILE}}
- only the test files that directly cover the moved declarations

## Per-seam loop

1. Read the next unfrozen entry from the remediation doc.
2. Run remediation/prompts/01-RESEARCH-AND-GAP-ANALYSIS.md for that entry
   (Varve adapter: remediation/prompts/00-VARVE-ADAPTER.md).
3. Run remediation/prompts/02-SEAM-EXECUTION-TEMPLATE.md in a worktree based on
   `master` (the campaign checkpoint), not `origin/main`.
4. If the seam can change rendered output or an API shape consumed by UI, run
   remediation/prompts/04-VISUAL-VALIDATION-AND-CLOSEOUT.md; otherwise record
   "no visual surface changed" and the contract tests that prove it.
5. Ratchet the baseline down (960 -> 959 style), update BACKLOG_LEDGER.md,
   commit the seam files plus baseline plus generated agent map, open the PR.
6. Generate the next NEXT_PROMPT.md from this template.
7. Stop after one seam.

## Hard rules

- Never add a baseline entry, raise a ceiling, widen slack, or freeze new WIP.
- One seam: one cohesive declaration set and one extraction destination.
- Do not start implementation before RESEARCH.md, GAP_ANALYSIS.md and
  SEAM_SPEC.md exist.
- Before commit: `node scripts/quality/refactor-verify.mjs --base master --target
  {{TARGET_FILE}} --dest {{DEST_DIRECTORY}}`, focused tests before and after,
  `pnpm exec biome check` on changed files, `pnpm check:agent`,
  `pnpm audit:filesize`, `node scripts/audit-health.mjs`, and a regenerated
  `pnpm agent:map`.
- Never `--force` the baseline. Never bypass the pre-commit checkpoint.

## Stop conditions

Stop and report instead of improvising when the baseline would grow, a
declaration is dropped, the seam needs two unrelated concerns, the real-world
scenario cannot be reproduced, visual validation shows an unexplained diff, or
the next entry is ambiguous in the remediation doc.
