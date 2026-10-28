# Split an over-cap source file

Split at a real seam under the 400-line budget, then move the baseline entry in
the same change. Policy: [file-size-policy.md](../../docs/quality/file-size-policy.md).

## When to use

- `pnpm audit:filesize` fails, a file you must edit is frozen (shrink-only), or
  the next backlog item from
  [agent-context-remediation-2026-10-28.md](../../docs/quality/agent-context-remediation-2026-10-28.md)
  is next.
- A hub or large test file is forcing whole-file reads. Not for new files (write
  them under 400 lines) or a pure rename with no split.

## Required context

- [file-size-policy.md](../../docs/quality/file-size-policy.md) - limits, seams,
  baseline lifecycle, generated-file exclusions.
- [agent-context-economy.md](../../docs/agents/agent-context-economy.md) -
  3-File / 1-Seam and context economics.
- [architecture-invariants.md](../../docs/agents/architecture-invariants.md) -
  hub import budgets, complexity ceilings, render hot-path rules.
- `.file-size-baseline.json` (freeze list) and `.health-baseline.json` (hub line
  and import caps). Guard: `scripts/quality/audit-file-size.mjs`.

## Steps

1. Measure first: `pnpm audit:filesize`; for inventory run
   `node scripts/quality/audit-file-size.mjs --report`. Note the frozen entry and
   the exact line count.
2. Choose one real seam: cohesive behavior, data ownership, or pipeline phase.
   Target results at 350-400 lines. Keep the change at parent + one extracted
   module + its test (3 files, 1 seam); queue further splits as separate tasks.
3. Plan the public API: the parent keeps a thin re-export until callers migrate;
   move imports with the extracted code. For hubs imports may not rise: move one
   out for each one added, and keep `CanvasArea.tsx`/`Shell.tsx` neutral.
4. Extract without behavior change. Split type-only aggregations by domain in
   one mechanical batch. Never extend a frozen file to "prepare" a split. Update
   and run the moved-module tests while the code is fresh.
5. Rewrite the baseline in the same change:
   `node scripts/quality/audit-file-size.mjs --update`. It records only
   shrink/split/rename and refuses a new freeze. Never `--force` to pass.
6. Re-run `pnpm audit:filesize` and `node scripts/audit-health.mjs` (hub lines,
   imports, complexity). An over-ceiling function still needs its first-line
   `// COMPLEXITY:` comment; a split does not lower function complexity.
7. If the split touches a hot render/replay dispatch, benchmark before merge;
   never introduce a dispatch table for the hot path.
8. Report file list, before/after lines, baseline diff, and commands run.

## Exact commands

```bash
pnpm audit:filesize
node scripts/quality/audit-file-size.mjs --report
node scripts/quality/audit-file-size.mjs --update   # only with an intentional split
node scripts/quality/godsplit-plan.mjs <file>        # declaration blocks, ranges, sub-split hazards
node scripts/quality/refactor-verify.mjs --base HEAD --target <file> --dest <dir>   # dropped-declaration proof
pnpm test:agent <spec path>                          # focused moved-module tests
pnpm check:agent
node scripts/audit-health.mjs                        # hub caps, complexity, cycles
pnpm verify:agent                                    # final structural gate
```

## Definition of done

- Every touched source file is at most 400 lines (target 350-400); the frozen
  entry is lowered or pruned and no new freeze was added.
- No behavior change: moved-behavior tests pass; the public API is preserved by
  re-export until migrated; hub import counts did not rise.
- `refactor-verify` reports every declaration preserved and the target's
  exported names intact.
- The baseline update is deterministic and part of the same change;
  `audit:filesize` and `audit-health` pass.
- Report the seam, resulting modules, line deltas, and commands. No commit.

## Do not

- Split by line count or alphabetical range; split at a real seam.
- Add lines or imports to a frozen/hub file first; move them out with the code.
- Use `--force` or hand-edit the baseline to make a failing check pass; freeze
  untracked WIP.
- Mix a mechanical type move with behavior changes, or extract a hot-path
  dispatch without a benchmark.
- Touch another session's uncommitted work; commit.
