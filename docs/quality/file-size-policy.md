# Varve source-file size policy

**Status:** current policy, measured 2026-10-28. Guard:
`pnpm audit:filesize` (`scripts/quality/audit-file-size.mjs`). Baseline:
`.file-size-baseline.json`. Regression tests:
`scripts/quality/audit-file-size.test.mjs`.

## Why

Varve's largest files are not just hard to review: they are the single largest
recurring context cost in agent-assisted work, and the context defect they cause
is self-reinforcing.

- **Token cost.** The guard currently scans 6,035 hand-maintained source files
  (including untracked WIP). 966 exceed 400 lines: 961 tracked files are frozen
  (722,287 lines) and 5 untracked WIP files are reported separately. 340,081
  lines sit above the cap (337,887 of them in frozen tracked files). The first
  split batch on 2026-10-28 removed three entries and 5,621 over-cap lines.
  The largest file,
  [`packages/editor/src/context.tsx`](../architecture/overview.md), is 11,435
  lines. At a rough 8-12 tokens per source line, a single read of that file is
  100,000+ tokens before any reasoning starts - a large fraction of a working
  session spent on one module. A 400-line module is about 4,000 tokens.
- **Edit accuracy.** `str_replace`-style edits need unique anchor text. In an
  oversized file the same patterns repeat (handlers, providers, test cases), so
  the anchor either fails to match or matches the wrong site; larger edits also
  cost more tokens and more retries. Splitting gives each seam its own small,
  unambiguous file.
- **Review, blame, and test isolation.** A 3,000-line change surface hides
  unrelated edits, makes blame noisy, and forces tests to import a hub to reach
  one leaf behavior. Small modules let review and validation follow ownership.

The cap is a **context and review budget**, not a style metric. It says nothing
about code quality and does not replace the hub budgets or complexity ceilings
below; a 400-line file can still be wrong and a 350-line file can still be
complex.

## Limits

| Rule | Value | Enforcement |
|------|-------|-------------|
| New file cap | 400 lines, hard | default check fails |
| Frozen offenders | measured size at adoption, shrink-only | any growth fails |
| Split point | 350-400 lines | target when extracting; 350 leaves headroom |
| Scope | `.ts .tsx .js .mjs .cjs .py .rs` | all hand-maintained source, including tests |
| Scan | `git ls-files --cached --others --exclude-standard` | working-tree content; untracked WIP measured |
| Untracked WIP | reported as `WIP`, not enforced | enforced as soon as the path is tracked/staged |
| Excluded: third-party | `vendor/**` | not ours to split |
| Excluded: generated data | explicit list below | reproducible from a committed generator |

**Enforcement scope is tracked source.** A tracked file absent from the baseline
is a new violation, and a tracked baselined file that grows is a violation.
Untracked WIP is measured and printed as `WIP` but does not fail the run: on a
shared workstation, one agent's in-flight scratch file must not turn every other
session's gate red. It is enforced the moment it is tracked or staged, so an
over-cap module still cannot be committed. `--update` never freezes untracked
WIP and prunes baseline entries that are no longer tracked. Tracked files are
measured from the working tree, so an in-flight edit that crosses the cap is
caught by the same run.

### Exclusions

`vendor/**` contains vendored third-party sources (151 tracked files, 32 of them
over the cap). Splitting vendored crates is not our call and every patch would
have to be carried.

Three machine-generated data tables are committed as source so the build and
tests stay offline-safe. They are excluded because the committed generator is the
source of truth, not the emitted table:

| File | Lines | Generator |
|------|-------|-----------|
| `packages/engine/src/text/lineBreakClassesData.ts` | 3,870 | `scripts/generate-line-break-data.mjs` (Unicode UAX #14 tables) |
| `packages/engine/src/inference/models/siglipT5Charmap.ts` | 4,866 | `scripts/semantic-corpus/generate-siglip-charmap.py` (derived tokenizer charmap) |
| `packages/shared/src/verticalOrientationData.ts` | 892 | `scripts/generate-vertical-orientation.mjs` (Unicode vertical orientation tables) |

The three files hold 9,628 lines together. They stay out of the count on the
condition that they remain generated; a hand-edited copy is a review failure.
Any future generated artifact (for example the tauri-specta bindings file in
[`ipc-type-contract.md`](../architecture/ipc-type-contract.md)) must be added to
`GENERATED_FILES` with its generator in the same change.

## How to split

Split at a **real seam**: a cohesive behavior or data ownership boundary, not an
even line count. The target is 350-400 lines per result. Extract one seam per
task (the repository's 3-File / 1-Seam discipline) and keep the parent's public
API as a thin re-export until callers migrate.

### Canvas and render hot paths

`canvas/inputPipeline.ts`, `canvas/renderPipeline.ts`, and
`engine/src/replay.ts` split by pipeline phase or primitive family, not by
alphabetical ranges: admission/gesture state, then per-primitive rendering, then
overlay/measurement helpers. Keep the per-node/per-frame dispatch in one
monomorphic `switch` - extracting it into a dispatch table can make the hot path
slower. Any structural split of `replaySubtreeToCtx`, `replayIr`, or an
equivalent per-node dispatch function must be benchmarked (100 / 1k / 10k / 50k
nodes, full and incremental frames) before merge, per the render guidance in
`AGENTS.md`.

### WebGPU and compositor seams

Split device/admission logic from pipeline creation, shader wrappers, and
per-frame passes. Capability reporting stays truthful (discovered vs
runtime-loadable vs device-usable vs execution-verified): splitting must not
create a second capability source. New hub-style files must target instability
I < 0.85.

### State and React hub files

`context.tsx` and `Menubar.tsx` are hubs under explicit import budgets. Extract
hooks into `packages/editor/src/context/useX.ts` following the documented
hook-ordering and sub-context `onReady` patterns; never split a hook call across
conditionals. **Import-neutral extraction:** moving code out must move its
`import` line out too, because `.health-baseline.json` caps hub imports
(`context.tsx` 78/78, `Menubar.tsx` 21/21 today) and `CanvasArea.tsx` /
`Shell.tsx` may not gain an import without losing one of equal weight. Splitting
lines does not relax the complexity ceilings either: an over-ceiling function
still needs its first-line `// COMPLEXITY:` comment and still cannot grow.

### Type and data modules

`packages/scene/src/types.ts` and similar type aggregations split by domain
(document nodes, layout, effects, presentation) into `types/` modules with one
barrel. Do this as a single mechanical, type-only batch: the import graph churn
is the main risk, not the code.

### IPC / Tauri commands

Split `apps/desktop/src-tauri/src/lib.rs` by domain into sibling modules
(`home_store.rs`, `printing.rs`, `inference.rs`, `fonts.rs`, `stubs.rs`, ...)
and register each module's commands in `generate_handler!`. Behavior and wire
names must not change; `pnpm audit:ipc` fails on an unregistered command or a
caller that names a missing one. Payload structs belong in `varve-bridge` or the
command module with explicit `#[serde(rename_all = "camelCase")]`, as
[the IPC contract](../architecture/ipc-type-contract.md) requires.

### Tests and fixtures

Split large test files by scenario group; move large inline fixtures into
`fixtures/` files. Tests are source and count toward the same cap.

## Guard usage

```bash
pnpm audit:filesize                                  # check (exit 1 on drift)
pnpm audit:filesize:staged                           # staged content only (pre-commit)
node scripts/quality/audit-file-size.mjs --report    # ranked inventory, always exit 0
node scripts/quality/audit-file-size.mjs --update    # rewrite baseline after splits
```

### Seam tooling

The execution template requires a planner and a declaration-preservation proof.
The repo-native tools are:

```bash
node scripts/quality/godsplit-plan.mjs <file>          # top-level blocks, ranges, sub-split hazards
node scripts/quality/refactor-verify.mjs --base <git-ref> --target <path> --dest <dir>
```

`godsplit-plan` prints the top-level declarations with line ranges, export
status and first doc line, and flags a declaration that is over 350 lines on its
own (it must be sub-split). `refactor-verify` fails when a declaration of the
base version is missing from the current target plus destination tree, or when
an exported name of the target disappears. It parses TypeScript/JavaScript;
Rust seams are verified by their package test suites instead.

- The default check prints a counted, capped summary (25 violations), the WIP
  list, and exits non-zero only for tracked content. `--report` prints
  scanned/frozen/violation/WIP counts, total excess lines, and the top 40
  offenders by line count.
- `--staged` measures the **staged blobs only** and is wired into the pre-commit
  checkpoint (`pnpm verify:commit`). It judges the commit you are about to make,
  so another session's dirty worktree cannot fail your commit, and your staged
  growth cannot hide behind a clean-looking worktree. It cannot be combined with
  `--update`/`--report`.
- `--update` is conservative once a baseline exists: it refuses to freeze a new
  over-cap path or to record growth of a frozen file. It only records splits,
  deletes, and renames-with-split. `--force` exists for an intentional
  repository-wide re-adoption (for example a path rename) and must never be used
  to make a failing check pass.
- The baseline is deterministic: paths sorted, 2-space JSON, trailing newline, no
  timestamp. Running `--update` twice on the same tree produces byte-identical
  output.
- Baseline entries that fall at or under the cap, or disappear, are stale; the
  check notes them and `--update` prunes them. Run the update in the same change
  as the intentional split.
- The guard runs in `pnpm verify:agent` and its tests run in
  `pnpm test:ci:tools`.

### Baseline lifecycle

1. **Adoption (2026-10-28).** Every tracked source file already over 400 lines
   was frozen at its measured working-tree size: 964 entries, 729,101 lines. The
   initial snapshot also captured then-untracked WIP; that policy was corrected
   the same day (untracked WIP is reported, never frozen), so the five untracked
   entries were pruned and the ratchet now covers committed content only. The
   first split batch later the same day removed three entries
   (`menu/defs.ts`, `replay.test.ts`, `halftone.test.ts`), lowering the frozen
   total to 961 entries / 722,287 lines.
2. **Shrink.** A split lowers the entry; a file split below 400 lines leaves the
   baseline. Removing entries is progress.
3. **Growth.** Never. Split first, then extend one of the smaller files. If an
   edit must add lines to a frozen file, the correct change is the split that
   brings the edited file under the cap plus the behavior change - reviewed
   together or as a lead-in task.

## Relationship to the other architecture ceilings

These rules are complementary and all enforced; a change must satisfy all of
them.

| System | Scope | Rule |
|--------|-------|------|
| This policy | every source file | 400-line cap; frozen offenders shrink-only |
| `.health-baseline.json` | 5 hub files (`context.tsx`, `CanvasArea.tsx`, `Shell.tsx`, `Menubar.tsx`, `HomeShell.tsx`) | line and import ceilings with a 10% / +3 buffer; checked by `scripts/audit-health.mjs` (pre-commit `--staged`) |
| Complexity ceilings | functions, by kind | component 200, non-component 50, tool handler 30, test body 15; extract at 70%; over-ceiling files need a first-line `// COMPLEXITY:` comment and cannot grow |
| Architecture audit | repositories | cycle identities and global ceilings; hub instability reported |

Practical consequences when planning a split:

- The hub budget is often the binding constraint on `context.tsx` /
  `Menubar.tsx` extractions: lines can drop while imports cannot rise. Move the
  import out with the code.
- The complexity ceilings are per function. Splitting a file does not reduce a
  function's estimated complexity, so an over-ceiling file stays on the
  `COMPLEXITY` list until the offending function is extracted or simplified.
- File-size debt is recorded per path; the split task should pick the seam that
  also relieves a hub import or a complexity hotspot rather than the simplest
  line-count cut.

## Exceptions

There are no open-ended exceptions. The only permanent exclusions are
`vendor/**` and the generated-file list, and both require a named generator and
review. A file that genuinely cannot be split (for example a single generated
table) is generated-data by definition and must be listed with its generator.
Temporary over-cap growth requires maintainer approval, a `--force` baseline
change with the reason in the same change, and a follow-up split task; it is not
an agent's unilateral option. Never weaken the guard to make a failing check
pass.

## Evidence

Measured 2026-10-28 after the first split batch with
`node scripts/quality/audit-file-size.mjs --report`: 6,035 source files scanned;
966 over 400 lines (961 tracked frozen + 5 untracked WIP reported); 722,287
frozen lines; 340,081 lines over cap. The batch split
`packages/editor/src/menu/defs.ts` (2,657 -> 11-line barrel + 15 modules),
`packages/engine/src/replay.test.ts` (2,243 -> 377, with 9 sibling suites and a
shared helper) and `packages/engine/src/halftone.test.ts` (1,921 -> 299, with 6
sibling suites and a shared helper), removing three baseline entries and 5,621
over-cap lines. Third-party `vendor/**` and 3 generated files (9,628 lines) are
excluded.
The split queue and per-file seams are in
[`agent-context-remediation-2026-10-28.md`](agent-context-remediation-2026-10-28.md).
