# Phase 0 research - A-06 product screenshot pipeline seam

**Status:** research complete 2026-10-28. Implementation proceeds only after
[GAP_ANALYSIS.md](GAP_ANALYSIS.md) and [SEAM_SPEC.md](SEAM_SPEC.md) exist. Work
happens in `.worktrees/A-06` on branch `seam/A/A-06-product-capture`, created
from local `master` at the foundation checkpoint
`30cfb7a7f534ae58b42f588536783d07f9517edb` (never from `origin/main`: the
remote lacks the baseline, the guard scripts, the `audit:filesize` script and
the completed split batches).

**Scope:** Batch A / A-06, `scripts/screenshots/product.mjs` (2,767 lines,
frozen at 2767 in `.file-size-baseline.json`) to a new destination directory
`scripts/screenshots/product/`. Seam: scene data vs runner vs manifest sync.
Covering test: `node --test scripts/screenshots/capture-safety.test.mjs`
(522 lines, **15 tests**). Root `scripts/` tooling, no workspace package.

## Measured inputs (this worktree, checkpoint `30cfb7a7f`, 2026-10-28)

- `wc -l scripts/screenshots/product.mjs` -> **2767**; baseline line 881 ->
  `"scripts/screenshots/product.mjs": 2767`.
- `node scripts/quality/godsplit-plan.mjs scripts/screenshots/product.mjs` ->
  exit 0, **86 blocks** (72 top-level declarations + 14 non-declaration
  blocks), 11 imports, 2,767 lines; hazards: target is over the cap, and
  `SCENES` lines 816-2072 is **1,257 lines** on its own, so the scene data must
  be sub-split inside the destination directory (one seam, several modules).
- `node scripts/quality/refactor-verify.mjs --base master --target
  scripts/screenshots/product.mjs --json` -> exit 0,
  `{ok: true, baseCount: 72, presentCount: 72, missing: [], missingExports: []}`.
  All 72 base declarations areprivate (planner `export: no` for every block);
  the verifier's export-preservation half is therefore vacuous, but the
  declaration-preservation half is the hard stop.
- `node --test scripts/screenshots/capture-safety.test.mjs` -> **15 pass, 0
  fail** before the move.
- `node --check scripts/screenshots/product.mjs` -> exit 0.
- `node scripts/quality/audit-file-size.mjs --report` in the worktree: 6,051
  source files scanned; 958 over the cap; **958 frozen**; 0 violations; 0
  untracked WIP over-cap; 329,922 excess lines; 0 stale baseline entries.
  (The session handoff's main-checkout reading is 6,108 scanned / 962 over cap /
  331,917 excess / 4 untracked WIP over-cap: those four WIP files live only in
  the main checkout and are not copied into the worktree. The worktree reading
  above is authoritative for this session.)
- `git rev-parse HEAD` -> `30cfb7a7f534ae58b42f588536783d07f9517edb`;
  `git log -1 --oneline master` -> `30cfb7a7f refactor(scene): split scene type
  aggregation into types modules (Batch A/A-05)`.
- Environment limits measured, not blockers: `pnpm install --frozen-lockfile`
  fails with `ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK` / `Read-only file system
  (os error 30)`; every `pnpm <script>` still runs the script after warning,
  because the worktree symlinks the main checkout's installed trees
  (`node_modules` plus each `packages/*/node_modules`, `apps/desktop`,
  `apps/website`). The queued `pnpm check:agent` is therefore replaced by the
  same recursive tsc program run directly (see SEAM_SPEC proof plan).
- `pnpm claims claim ...` against the default `/run/user/1000` runtime dir
  failed with `ENOENT`; retried with `VARVE_PATH_CLAIMS_DIR` under the user
  cache (advisory only; no peer split is updating the baseline - the queue is
  idle and no other worktree has `scripts/screenshots/` or
  `.file-size-baseline.json` claims).

## 1. Module-evaluation side effects (critical)

The target is an executable ESM script, not a library: module scope performs
work whose order is observable.

- `config` block (base 109-151): parses `process.argv`, throws on malformed
  `--review-dir`/`--source-scenes-dir`, computes output paths, calls
  `assertReviewDirectorySafe`. It runs before every mode. In the split it becomes
  `product/config.mjs` and is the first import, so the same statements run at
  import time, before anything else.
- `manifestBytesAtStart` / `manifestDigestAtStart` (base 195-196) read the
  published manifest at startup; they move to `product/provenance.mjs`, whose
  module evaluation happens after `config` (entry imports config first) and
  before the reviewed-promotion early exit - identical to base lines 195-198.
- The reviewed-promotion block (base 198-261) and the `--normalize` dispatch
  (base 2343) are mode dispatches. They move to `product/manifest-sync.mjs` as
  `syncReviewedPromotion()` and to the entry respectively, and the entry calls
  them in the original order. Functions are evaluated but not executed on
  import, so no promotion work can run early.
- `browser`, `server` and `variantSupport` are top-level `await` expressions
  in the base file (launch Chromium, start the Vite dev server, open variant
  support). They must not run at import time: importing the split entry for
  `--sync-reviewed` or `--normalize` must not launch a browser, and the base
  file exits `--normalize` at line 2343 before line 2366. They stay module-level
  declarations in `product/runner.mjs` (`export let`) but are **assigned inside
  `runCapture()`**, which the entry calls only after the normalize dispatch.
- `SEED_FIRST_RUN_STATE`, the editor/automation helpers and the scene array are
  declaration-only at module scope (functions and literal data). Importing them
  has no side effect.
- `openVariantSupport()` dynamically imports `./variants.mjs`; the moved file
  is one directory deeper, so the specifier is rebased to `../variants.mjs`.
  This is the only module-specifier rewrite inside moved code (the `ROOT`
  computation is the other depth rebase).

Failure mode observed in this repository: a module-scope singleton constructed
on import becomes a second instance when its file is imported twice (the A-04
`auditPool` hazard). A-06 has no singleton, but the same class of defect applies
to the dev server and browser: importing the entry from a test that only wants
`--sync-reviewed` must not start them. Guardrail: the mode dispatch stays ahead
of all capture-side effects, and the capture-safety fixture test (which copies
the entry into a sandbox and runs `--sync-reviewed`) would hang or fail if the
browser/server were constructed at import.

## 2. tsconfig project boundaries and imports

`scripts/**` is outside every tsconfig project (`packages/*`, `apps/desktop`,
`tests/e2e`); nothing in the moved code is type-checked by `check:agent`. Node
ESM requires explicit extensions and `import.meta.url`-relative resolution, so
every new relative specifier must carry `.mjs` and be rebased one directory
deeper:

- `./capture-safety.mjs` -> `../capture-safety.mjs`;
  `./lib/image-analysis.mjs` -> `../lib/image-analysis.mjs`;
  `./producer-capture.mjs` -> `../producer-capture.mjs`;
  `./source-scenes.mjs` -> `../source-scenes.mjs`;
  `../quality/heavy-lease.mjs` -> `../../quality/heavy-lease.mjs`.
- `ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')` becomes
  three `'..'` segments from `scripts/screenshots/product/`. Value unchanged.
- The dynamic variant import becomes `new URL('../variants.mjs',
  import.meta.url)`.
- No `@varve/*` alias is used by this file, so no alias change is needed.

Failure mode: a missing or un-rebased specifier surfaces only when a mode is
executed; `node --check` does not resolve imports. Guardrails: static
free-identifier/import analysis over every new module (SEAM_SPEC proof 2), the
`--sync-reviewed` fixture test (exercises the entry and the manifest module),
and a module-load smoke test of every new module.

## 3. Declaration boundaries, not brace or line counts

The file is dense with template literals, regexes, Playwright locators and
string fixtures (scene `run` bodies contain `/.../i` regexes and
`${...}` templates). A brace/regex-based cut can corrupt strings. The split
uses contiguous source line ranges derived from the planner and AST statement
ranges, never line counts within a declaration. All 31 scene entries are
contiguous (each entry starts the line after the previous one ends), so the
partition covers every scene byte. Comments inside a range move verbatim.

Failure mode: A-05 measured that planner ranges start at the first syntax line
and exclude leading doc comments. A-06 avoids it by moving contiguous regions
(comments included) rather than planner ranges; the full file is partitioned
with no gaps, so no comment can be orphaned.

## 4. Identity-sensitive declarations and the entry path

`product.mjs` is invoked by path: `package.json` `screenshots:product`,
`scripts/screenshots/import-reviewed.mjs` (spawns the entry), the README, and
two fixtures in the covering test. The entry file must keep its path and
shebang, and `node scripts/screenshots/product.mjs` must still be the command
(orchestrator). No base declaration is exported, so the "same named export"
risk does not apply; the equivalent risk is the **module-relative root and
dynamic-variant paths** (section 2) and the **test fixture source list**.

The covering test copies a fixed source list into a sandbox and runs
`fixture/scripts/screenshots/product.mjs --sync-reviewed`
(`capture-safety.test.mjs` lines 414-422 and 488-499). With the split, the
fixture must also copy `scripts/screenshots/product/` or the sandboxed entry
cannot resolve its imports. That is a harness-wiring edit in the covering test
(add the destination directory to the copy), not a weakening of any assertion;
the 15 test names and pass count stay identical. It is committed with the seam
because the test is the cover for the moved declarations.

Failure mode: a test that copies only `product.mjs` would fail with
`ERR_MODULE_NOT_FOUND` after the move, which looks like a behavior regression.
Guardrail: the fixture gains one `cpSync(..., { recursive: true })` line and the
test count is recorded before and after.

## 5. Same-named helpers and one home per shared helper

The planner shows no duplicate declaration names. Cross-cutting helpers are used
by both the scene data and the runner (`openCleanEditor`, `settle`,
`clipFromLocator`, `sceneKind`, `sourceScenePath`, `freshSourceSceneCapture`).
Each keeps exactly one definition and is imported by its consumers; no helper is
copied into a second module and no new production export is added beyond what
the imports require (moved declarations gain an `export` keyword only where a
sibling module imports them; the destination is new, so this is the module
boundary, not a new public API).

## 6. Dropped declarations

The inventory in [SEAM_SPEC.md](SEAM_SPEC.md) is complete before the cut:
72 declarations, all mapped to exactly one destination module. `refactor-verify`
must exit 0 with `missing: []` before tests. The full-file partition (every line
1-2767 assigned to exactly one destination, imports/header rebuilt deliberately)
is checked by a coverage script before and after.

## 7. Tracked-versus-untracked baseline policy

New destination modules are untracked until staged. The guard reports untracked
WIP over-cap files but never freezes them; they are enforced the moment they are
staged via `audit-file-size.mjs --staged` inside `pnpm verify:commit`. Every new
module is measured before staging; target 350-400, hard cap 400. The entry
stays well under the cap. No WIP is frozen.

## 8. Stale and grandfathered entries

Exactly the `scripts/screenshots/product.mjs` entry must leave the baseline
(958 -> 957). `--update` refuses to freeze new over-cap files or grow a frozen
one; `--force` is forbidden. The worktree report shows 0 stale entries before
the split; a stale or grown entry after `--update` is a blocker to report, not a
reason to force.

## 9. Concurrent worktree conflict on peer-hot files

Single-writer surfaces for this seam: `.file-size-baseline.json`,
`docs/agents/repo-map.generated.md`, `BACKLOG_LEDGER.md`, and the seam docs.
The queue is idle and no other worktree claims `scripts/screenshots/` or the
baseline. The only writer is this worktree; docs and source share it because the
same worker writes them (no second writer is introduced). `pnpm claims` is
advisory and was retried with a writable runtime dir.

## 10. Rollback

The seam is uncommitted until the commit step. A failed extraction is discarded
by restoring only this worktree's task paths (the target plus the new
`product/` directory and the covering-test copy line); `git checkout --` on
the target, `rm -rf scripts/screenshots/product`, and re-run the pre-flight.
The baseline is only ratcheted after the split is green; if it cannot ratchet,
stop before committing. Never revert another session's files, never reset the
shared checkout, never commit a partial seam.

## 11. Rust-crate equivalents

Does not apply. There is no Rust seam in A-06; `refactor-verify` is
TypeScript/JavaScript-only, and this file is JavaScript. A-07
(`wgsl_validation.rs`) is the Rust entry and is verified by its package tests
instead.

## 12. Reference tools and failure modes

A codemod driven only by top-level line spans fails here in four ways: it drops
leading doc comments (A-05 measured 634 lines outside planner ranges), it breaks
on dense template literals/regexes if it reflows text, it reports success while
leaving a referencing module unimported (no type check covers `scripts/**`),
and it cannot prove the fixture sandbox still runs. Existing machinery covers
the expensive parts: `refactor-verify` proves declaration preservation,
`node --check` proves syntax, `--sync-reviewed` fixture execution proves the
entry/manifest path end to end, the free-identifier audit proves every moved
reference is imported, `audit-file-size` proves the ratchet only shrank, and
`verify:commit` proves the staged map/baseline/size state. Remaining untested
area: the browser capture loop itself (Playwright + Vite) is not run in this
session by design (heavy, and not part of a pure move's proof); its declarations
are byte-identical code moved into `product/runner.mjs` and are covered by the
static reference audit plus the same commands the capture uses.

## Failure modes -> guardrails

| Failure mode | Evidence | Guardrail | Owner prompt |
|---|---|---|---|
| Browser/dev server launched at import on `--sync-reviewed`/`--normalize` | base 198-261 exits before 2366; base 2343 exits before 2366 | capture side effects only inside `runCapture()`; `--sync-reviewed` fixture test | 02 Step 1/3 |
| Doc comment dropped at a cut | A-05: 634 lines outside planner ranges | contiguous full-file partition; comment coverage checked by line accounting | 02 Step 2 |
| Un-rebased relative specifier | one directory deeper destination | free-identifier/import audit + module-load smoke + fixture run | 02 Step 2/3 |
| Dropped or renamed declaration | 72 base declarations | `refactor-verify` exit 0 before tests; full inventory in SEAM_SPEC | 02 Step 1/3 |
| New module over 400 lines | 1,257-line `SCENES` declaration | sub-split scene data by contiguous feature blocks; measure every module | 02 Step 2/5 |
| Baseline froze WIP or grew a frozen file | shrink-only policy | `--update` once, diff exactly one removed entry; no `--force` | 02 Step 5 |
| Test fixture cannot resolve split imports | test copies an explicit source list | add destination directory to the fixture copy; 15/15 before and after | 02 Step 3/4 |
| Unrelated WIP committed | main checkout has 27 entries | stage exact paths only; `verify:commit` staged-only | 02 Step 6/8 |
| Second writer on generated surfaces | baseline/map/ledger single-writer | one worktree, one worker; no second session on the baseline | 02 Step 6/7 |

## Edge-case register

| Edge case | A-06 decision | Status |
|---|---|---|
| Module-eval side effects | config -> provenance -> state evaluation order preserved; capture side effects inside `runCapture()`; sync block called from entry | applies, handled |
| tsconfig project boundaries | `scripts/**` is in no tsconfig; consumer tsc gate proves nothing else broke | does not apply to moved code; gate still run |
| Path aliases / import ordering | no aliases; relative specifiers rebased; biome only formats | applies, handled |
| Template-literal / JSX-like text | no JSX; quote/regex-dense scene bodies moved as opaque contiguous ranges | applies, handled |
| Overloaded / identity-sensitive declarations | no exports/overloads; entry path and ROOT depth are the identity risks | applies, handled |
| Same-named private helpers | no duplicate names; each helper has one home | applies, handled |
| Dropped declaration | 72/72 inventory + verifier | applies, handled |
| Parse failure in target/destination | `node --check` every file; planner/verifier parse the tree | applies, handled |
| Tracked-vs-untracked baseline | new modules untracked until staged; staged size check | applies, handled |
| Stale / grandfathered / slack entry | 0 stale before; exactly product.mjs leaves | applies, handled |
| Baseline refusing to add/raise | `--update` once, no force | applies, handled |
| Test-file exemption from ratchet | covering test is 522 lines, frozen; only its fixture copy line changes; stays frozen | applies, handled |
| Generated-file exclusions | vendor and 3 generated tables untouched | does not apply |
| Concurrent peer-hot file | queue idle, no overlapping claims | applies, handled |
| Rollback | uncommitted seam; discard worktree paths only | applies, handled |
| Unknown/unresolved tools | both seam tools exist at checkpoint and parse the target | verified |
