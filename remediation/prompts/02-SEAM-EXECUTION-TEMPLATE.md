# Seam Execution — Batch {{BATCH}}, Entry {{ENTRY_ID}}

## Inputs (attach only these)
- `@{{REMEDIATION_DOC}}`
- `@{{BASELINE_FILE}}`
- `@{{GODSPLIT_PLAN_TOOL}}`
- `@{{TARGET_FILE}}`
- `@{{COVERING_TEST_FILE_1}}` … only the tests that directly cover the target declarations

## Step 1 — Re-verify the seam hypothesis
Before coding, answer in `SEAM_SPEC.md`:
- Which top-level declarations form this seam?
- What is the single concern?
- What is the extraction destination file?
- What is the exact declaration set before extraction?
- Which edge cases from `GAP_ANALYSIS.md` apply?
- What is the expected line reduction for the target and the expected new file size?
- What is the proof that this is behavior-preserving?

If the seam requires two concerns, stop. Write a continuation prompt for the second seam and execute only the first.

## Step 2 — Create an isolated worktree
```bash
git fetch origin
git worktree add .worktrees/{{ENTRY_ID}} -b seam/{{BATCH}}/{{ENTRY_ID}}-{{SLUG}} origin/main

Work only inside that worktree. Do not edit the main checkout. If another active worktree touches the same file, stop and record the conflict; do not “merge carefully” by hand.

Step 3 — Run the baseline gate before editing
bash

go build ./...
go vet ./...
go test ./{{PACKAGE}}/...
{{GATE_COMMAND}}   # e.g. fak hygiene --gates GOD_FILE_GROWTH

Record the output in SEAM_SPEC.md. Do not edit if the baseline is already red for an unrelated reason; record the blocker instead.
Step 4 — Plan boundaries, do not hand-cut

Run the planner:
bash

{{GODSPLIT_PLAN_COMMAND}} {{TARGET_FILE}}

Use its doc-comment-aware block_start..block_end ranges. Do not invent cut lines. If the planner flags a hazard, resolve it before extraction:

    per-file build tags

    init() order

    aliased imports

    raw strings

    receiver-qualified function identity

Step 5 — Extract one seam

    Move only the planned declarations to the destination file.

    Preserve comments and doc comments verbatim.

    Do not reformat unrelated code.

    Do not rename declarations unless required for package-level uniqueness.

    Do not add new behavior.

Step 6 — Prove no declaration was dropped
bash

{{REFACTOR_VERIFY_COMMAND}} {{PACKAGE}}

This must pass before tests. If it fails, the cut is incomplete; fix the extraction, do not suppress the verifier.
Step 7 — Real-world verification

Run, in this order:
bash

gofmt -w {{TARGET_FILE}} {{DEST_FILE}}
goimports -w {{TARGET_FILE}} {{DEST_FILE}}
go build ./...
go vet ./...
go test ./{{PACKAGE}}/... -count=1
go test ./... -count=1          # only if package tests do not cover callers
{{GATE_COMMAND}}

Additionally write and run at least one real-world scenario test that uses the full target file, not a toy fixture. For Go seams, include a test that exercises the moved declarations through the package’s public entry point and asserts the same output before/after. For non-Go, use the platform’s equivalent end-to-end harness.
Step 8 — Ratchet down

    Regenerate the baseline only if the target file genuinely shrank.

    The regenerated baseline must have one fewer entry or a smaller ceiling for this entry. If it adds an entry or raises a ceiling, stop and report.

    Confirm FROZEN_COUNT in BACKLOG_LEDGER.md is non-increasing.

    Remove the entry if the file is now under the cap; shrink it if it remains above the cap.

Step 9 — Commit and review

Commit only the seam files and the baseline change:
bash

git add {{TARGET_FILE}} {{DEST_FILE}} {{BASELINE_FILE}} {{TEST_FILES}}
git commit -m "refactor({{PACKAGE}}): split {{SEAM_NAME}} seam from {{TARGET_FILE}} (Batch {{BATCH}}/{{ENTRY_ID}})"

The commit must not include unrelated formatting or generated noise. Open the PR against main. Record the commit SHA and PR link in BACKLOG_LEDGER.md.
Step 10 — Clean up and continue

Remove the worktree only after the PR is merged or explicitly closed:
bash

git worktree remove .worktrees/{{ENTRY_ID}}

Generate NEXT_PROMPT.md from templates/NEXT-PROMPT.md. Do not start the next seam in this session.
Definition of Done

    REFACTOR_VERIFY passes.

    go build, go vet, and package tests pass.

    Real-world scenario test passes.

    Gate passes and FROZEN_COUNT decreased.

    Baseline contains no new entry and no raised ceiling.

    PR is linked in BACKLOG_LEDGER.md.

    NEXT_PROMPT.md exists.
