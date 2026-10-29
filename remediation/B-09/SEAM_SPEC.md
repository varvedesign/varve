# B-09 seam specification — `packages/editor/src/context/useSam2Segmentation.ts` split

**Single concern:** pure code motion of the SAM2 segmentation hook's
capability/budget helpers, worker transport, and mask post-processing into
`packages/editor/src/context/sam2/`; the hook composes them. No behavior,
naming, comment, string, API or test change. **No visual surface changed** —
the hook has no rendered surface of its own; identical behavior is proven by
`packages/editor/src/context/useSam2Segmentation.test.tsx` (34 tests measured
passing before and after). The front-end and visual gates (prompts 03/04) do
not fire.

## Pre-flight (measured on `.worktrees/B-09`, branch `seam/B/B-09-sam2-hook`, HEAD f1411c4ac)

- `pnpm audit:filesize`: exit 0; "6223 source files scanned; 947 over 400
  lines, all frozen in .file-size-baseline.json"; `--report`: 6,223 scanned /
  947 frozen / 0 stale / 300,868 excess / 0 untracked WIP.
- `node scripts/quality/godsplit-plan.mjs <target>`: exit 0; 2,222 lines,
  16 imports, **30 blocks**; hazards: over-cap target and "sub-split required:
  useSam2Segmentation lines 277-1902 is 1626 lines on its own". (`--top` is
  unsupported at this checkpoint: exit 2, "unknown argument: --top".)
- `node scripts/quality/refactor-verify.mjs --base master --target <target> --json`:
  exit 0, `{ok:true, baseCount:30, presentCount:30, missing:[], missingExports:[]}`.
- Covering test (direct vitest; queue EROFS blocks `pnpm test:agent`):
  **34 passed (34) / 0 failed**, 1 file, 12.42 s.
- Direct recursive tsc program (same inputs as `check:agent:raw`):
  `packages-checked=20 packages-fail=0 desktop-exit=0 e2e-exit=0 diagnostics=0`.
- Environment: read-only pnpm store -> 21 node_modules symlinks from the main
  checkout (`pnpm install` impossible); queue EROFS -> direct tsc/vitest;
  `pnpm -r exec tsc` dies on its read-only-store pre-install, so per-package
  direct `./node_modules/.bin/tsc` is the measured substitution.
- `pnpm worktree:status` healthy; `pnpm queue:status`: "exclusive free;
  shared 0/4 slots busy; 0 waiting".
- Base blob: `git show HEAD:packages/editor/src/context/useSam2Segmentation.ts`
  = the working tree copy (clean status), 2,222 lines.
- Covering test: 929 lines, frozen at 929; expected byte-identical (a pure
  move touches no test).

## Declaration inventory (hand-completed from the planner's 30-block table)

Every top-level declaration of the base file, read block by block in line
ranges, with its destination. Every item appears exactly once.

| # | kind | name | base range | export | destination |
|---|------|------|-----------|--------|-------------|
| 1 | const | SAM2_SOFT_DEADLINE_MS | 73-73 | no | `sam2/capabilities.ts` (used by setup) |
| 2 | const | EMBEDDING_CACHE_MAX_BYTES | 74-74 | no | `sam2/capabilities.ts` |
| 3 | const | EMBEDDING_CACHE_MIN_BYTES | 75-75 | no | `sam2/capabilities.ts` |
| 4 | const | MOBILE_SAM_FALLBACK_PEAK_BYTES | 76-76 | no | `sam2/capabilities.ts` |
| 5 | const | EFFICIENT_SAM_FALLBACK_PEAK_BYTES | 77-77 | no | `sam2/capabilities.ts` |
| 6 | fn | promptedEncoderPeakBytes | 79-88 | no | `sam2/capabilities.ts` |
| 7 | fn | embeddingCacheBudgetBytes | 90-104 (doc 90-94) | no | `sam2/capabilities.ts` (hook uses) |
| 8 | fn | promptedExecutionProvider | 106-115 | no | `sam2/capabilities.ts` |
| 9 | fn | embeddingCacheMaxEntries | 117-129 (doc 117-125) | **yes** | `sam2/capabilities.ts` (hook uses; re-exported from target) |
| 10 | fn | promptedProviderFacts | 131-193 | no | `sam2/capabilities.ts` |
| 11 | fn | promptedRequiredCapabilities | 195-203 | no | `sam2/capabilities.ts` |
| 12 | fn | promptedEmbeddingCacheKey | 205-250 | no | `sam2/capabilities.ts` |
| 13 | interface | Sam2SegmentationAPI | 252-275 | **yes** | stays in the target |
| 14 | fn | useSam2Segmentation | 277-1902 | **yes** | stays in the target; its `applySam2Segmentation` body (454-1891) sub-splits per the phase table below |
| 15 | fn | combineAbortSignals | 1904-1914 | no | `sam2/session.ts` |
| 16 | fn | currentNodeSource | 1916-1918 | no | `sam2/session.ts` (hook effect uses) |
| 17 | fn | isCurrentSelectionTarget | 1920-1933 | no | `sam2/session.ts` |
| 18 | fn | readImageSourceIdentity | 1935-1963 | no | `sam2/session.ts` |
| 19 | fn | writeCurrentSam2Stage | 1965-1989 (doc 1965-1968 kept verbatim with it) | no | `sam2/session.ts` |
| 20 | fn | isCancellationError | 1991-1993 | no | `sam2/errors.ts` |
| 21 | fn | countMaskCoverage | 1995-2002 (doc 1995) | no | `sam2/maskPayload.ts` |
| 22 | fn | maskMatchesDimensions | 2004-2013 | no | `sam2/maskPayload.ts` |
| 23 | fn | formatSelectionScore | 2015-2030 (doc 2015) | no | `sam2/session.ts` |
| 24 | fn | mapSegmentationFailure | 2032-2073 (doc 1965-style comment belongs to #19 in base; unchanged) | no | `sam2/errors.ts` |
| 25 | fn | mapPromptedRoutingFailure | 2075-2110 | **yes** | `sam2/errors.ts` (re-exported from target) |
| 26 | fn | cloneSourcePrompts | 2112-2117 | no | `sam2/session.ts` |
| 27 | const | MASK_DECODE_TIMEOUT_MS | 2119-2120 (doc 2119) | no | `sam2/maskPayload.ts` |
| 28 | type | MaskPayloadResult | 2122-2124 | no | `sam2/maskPayload.ts` |
| 29 | fn | buildMaskPayload | 2126-2205 (doc 2126-2138) | **yes** | `sam2/maskPayload.ts` (re-exported from target) |
| 30 | fn | maskToDataUrl | 2207-2222 | no | `sam2/maskPayload.ts` |

### Sub-split of declaration #14 (the planner's hazard; hand-planned)

`useSam2Segmentation` stays in the target with lines 277-452 (signature,
refs, embedding-cache init, preference state, six callbacks, two effects) and
1880-1901 (`[` deps array + return object) **byte-verbatim and in the same
order**. The apply body 454-1891 sub-splits at the recorded boundaries below;
each phase body moves verbatim, receiving shared values as parameters **with
their original local names** so no body line changes:

| base range | content | phase function | module |
|-----------|---------|----------------|--------|
| 454-474 | apply signature, param type, return type | (structural) thin wrapper in the target calling `runSam2Apply`, deps array kept byte-identical | target |
| 475-556 | enabled gate, generation/node/selection/shape/src guards, session targeting, commit detection, layer guard | `precheckSam2Apply` (its `return null` paths map to `{ok:false}`) | `sam2/applyRun.ts` |
| 557-888 | reviewed-candidate commit validation: review key, source/mapping/prompt/mask/coverage guards, candidate validation + refinement, ranking, mask payload resolution | `validateReadySam2Commit` | `sam2/readyCommit.ts` |
| 890-1013 | generation/abort bump, then selection / layer / mask commit branches | `executeReadySam2Commit` | `sam2/operations.ts` |
| 1015-1087 | controller + combined signal, `promptSession` literal, `markFailure` closure, first announce + soft deadline | `setupSam2PromptRun` | `sam2/promptRun.ts` |
| 1089-1217 | image load (with its local try/catch verbatim), natural dims, mapper, prompt normalization + input guards | `prepareSam2PromptInputs` | `sam2/promptRun.ts` |
| 1219-1465 | model paths, runtime/native memory, provider facts, first route, resource assessment, `writeCurrentSam2Stage('encoding')`, image encode, fingerprint, warm-provider reroute, path recheck, anchor guard | `resolveSam2ProviderRouting` | `sam2/providerRouting.ts` |
| 1467-1701 | worker host, embedding cache get/set, stale-session guards, `runPromptedSegmentation`, ranking, decoded/publication candidates, selected candidate, mask result, coverage | `runSam2WorkerTransport` | `sam2/workerTransport.ts` |
| 1703-1862 | operation switch: preview publication, mask commit, pixel-selection output | `publishSam2Operation` | `sam2/operations.ts` |
| 1466, 1863-1877, 1879 | big `try` / `catch (e)` mapping / `finally` cleanup / trailing `return null` | structural lines in `runSam2Apply` with the catch and finally **bodies byte-verbatim** (catch and finally wrap exactly the three base ranges that sat inside the base try: 1467-1862) | `sam2/applyRun.ts` |
| 1880-1891 | `},` + deps array | stays in the target, byte-identical | target |

**try-boundary fidelity (measured from the base):** the base's image-load
try/catch (1090-1104) stays inside `prepareSam2PromptInputs`; setup
(1015-1087), routing (1219-1465) and the commit path (557-1013) run **outside**
the big try in the base and are called outside it in the orchestrator, so
thrown errors still propagate to the caller uncaught exactly as today. Only
the ranges 1467-1862 were inside the base's big try, and only the three phase
calls covering those ranges sit inside the orchestrator's try.

## Destination map (every file <= 400 lines; planned sizes)

| file | content | planned lines |
|------|---------|---------------|
| `context/useSam2Segmentation.ts` (target) | imports, explicit named re-exports of the 3 moved exports, `Sam2SegmentationAPI`, the hook (277-452 + thin apply wrapper + return) | ~315 |
| `context/sam2/applyContext.ts` | type-only shared shapes: apply context, params, precheck result, phase bundles (structural glue; no runtime code) | ~110 |
| `context/sam2/capabilities.ts` | blocks 1-12: budget/capability constants and helpers | ~205 |
| `context/sam2/session.ts` | blocks 15-19, 23, 26: abort/source/target/stage/score/prompt-clone helpers | ~145 |
| `context/sam2/errors.ts` | blocks 20, 24, 25: cancellation + failure/routing taxonomy | ~100 |
| `context/sam2/maskPayload.ts` | blocks 21, 22, 27-30: mask coverage/dimension checks + payload build/encode | ~150 |
| `context/sam2/applyRun.ts` | precheck (475-556) + `runSam2Apply` orchestration + base catch/finally | ~215 |
| `context/sam2/readyCommit.ts` | `validateReadySam2Commit` (557-888) | ~385 |
| `context/sam2/promptRun.ts` | setup (1015-1087) + inputs (1089-1217) | ~280 |
| `context/sam2/providerRouting.ts` | routing/encode/reroute (1219-1465) | ~330 |
| `context/sam2/workerTransport.ts` | transport + publication (1467-1701) | ~320 |
| `context/sam2/operations.ts` | commit execution (890-1013) + operation switch (1703-1862) | ~385 |

Planned totals are estimates before generation; **the hard rule is <= 400 per
file (measured with `wc -l` before staging, re-checked by the `--staged`
lane)**. Contingency recorded: if `readyCommit.ts` or `operations.ts`
measures over 400 after generation/biome, the payload tail (863-888) moves
with `executeReadySam2Commit` into `operations.ts` and the tail guard block
(837-862) splits into `readyCommitValidate.ts` — still one destination
directory, still one seam.

## Planned edits (the complete allowlist; everything else is byte-identical)

1. **Structural wrappers only** (new lines): per-module import blocks with
   rebased specifiers (+1 relative depth from `context/sam2/`); phase
   function signatures that destructure shared values under their original
   base names; return-object literals for phase outputs; the orchestrator
   dispatch; the target's thin apply wrapper; explicit named re-export lines
   in the target (`embeddingCacheMaxEntries`, `mapPromptedRoutingFailure`,
   `buildMaskPayload`); the type-only shapes in `applyContext.ts` (a
   type-only mirror of the hook's inline `EmbeddingCache` generic, accepted by
   structural typing — the hook's inline type is not edited).
2. **Sentinel mapping** (mechanical, recorded): `return null` inside
   `precheckSam2Apply` becomes `return { ok: false }`, and the base
   condition `if (isCommitOperation && sameSessionTarget && previousSession?.status === 'ready')`
   moves to the orchestrator over the precheck's returned fields; inside
   phases every `return null` keeps its literal meaning (phase stop).
3. **No other line changes**: no renames, no body edits, no comment/string
   changes, no reformatting of moved code beyond what biome's one import/format
   pass does on the new files (recorded if it occurs). The hook's hook order,
   effects order, and apply deps array (1881-1891) are byte-identical.
4. **One home per declaration**: no helper is duplicated; the only shared
   values crossing phase boundaries are passed as parameters, never copied.

## Hook invariants (target file)

Render order stays: refs/cache init (286-331) -> `writeTransientSession` ->
preview ref + setter -> cancel -> provider preference -> select -> review ->
effect (session-target watcher) -> effect (unmount cleanup) ->
`applySam2Segmentation` (now the thin wrapper) -> return object. Deps array
unchanged: `[enabled, stateRef, setState, updateDoc, announcerRef,
setAreaSelection, writeTransientSession, promptedProviderPreference]`. The
cache init stays render-time and guarded by `enabled`; nothing moves to
module scope (no module-eval side effects introduced).

## Proof plan

1. **Partition/byte-identity:** a split script asserts that every base line
   1-2222 is accounted for exactly once (moved verbatim into exactly one
   module / structural allowlist lines / dropped blank boundary lines), that
   every moved line equals its base line byte-for-byte, and that no module
   exceeds 400 lines. Script and matrix live under `target/b09-analysis/`
   (ignored build tree; not committed).
2. **Declaration preservation:** `node scripts/quality/refactor-verify.mjs
   --base master --target packages/editor/src/context/useSam2Segmentation.ts
   --dest packages/editor/src/context/sam2 --json` exit 0
   (`missing: []`, `missingExports: []`) **before** tests; rerun after biome.
3. **Covering test:** direct vitest, 34/34 before (measured) and 34/34 after,
   0 failures, test file untouched (sha256 unchanged).
4. **Types:** direct recursive tsc program exit 0 (20 packages + desktop +
   e2e, 0 diagnostics) after the move.
5. **Format/lint:** `pnpm exec biome check --write` then `check` on changed
   files; import-order only.
6. **Health:** `node scripts/audit-health.mjs` exit 0 (hub caps, COMPLEXITY
   comments on listed over-ceiling files, cycles).
7. **Ratchet:** `node scripts/quality/audit-file-size.mjs --update` (never
   `--force`) -> exactly `"packages/editor/src/context/useSam2Segmentation.ts": 2222`
   removed, 0 added, 0 grown; `pnpm audit:filesize` exit 0 at **946**;
   `--report` no longer lists the target.
8. **Staged checkpoint:** stage the seam, `pnpm agent:map`, one ledger row
   with a caller-generated timestamp, `pnpm verify:commit` exit 0, one commit.

## Stop conditions (blockers, not bypasses)

- `refactor-verify` exit 1 after the cut (a declaration or export missing):
  fix the extraction; never edit or suppress the verifier.
- Any line inside the untested fresh path (1015-1862) that cannot move
  verbatim: stop and report — restructuring that path is out of scope.
- Covering test below 34/34 or any new failure: stop; do not weaken tests.
- `--update` refuses, adds an entry, grows a frozen file, or would remove
  anything but the target: stop; `--force` is forbidden.
- Any staged file over 400 lines after the planned contingency: stop and
  re-plan the destination split.
- Queue/store EROFS: use the recorded direct substitutions; if a direct
  substitution itself goes red, that is a blocker, not a reason to skip.

## Measured proof (after the move; commands run on `.worktrees/B-09`)

### Partition / byte-identity (split script `target/b09-analysis/split.mjs`, ignored build tree)

- Base blob: `git show HEAD:packages/editor/src/context/useSam2Segmentation.ts`,
  2,222 lines, sha256 `ad6f6cb3066c1fe41dcf7592ed10dafcac00a494236141c9c444f868d0c8724e`
  (the script refuses any other sha and reads the base from git, so it is
  idempotent against its own output).
- Every base line classified exactly once:
  **731 moved byte-identical (705 non-blank + 26 blanks) + 1,399 moved with a
  uniform leading-space dedent (1,363 non-blank + 36 blanks) + 73 structural
  (base import block 1-71 replaced by per-module imports; line 474's trailing
  `{ ` removed for the wrapper) + 19 dropped boundary blanks = 2,222.**
  Recorded sub-edits inside moved ranges: **18 single-token `export `
  prefixes** (cross-module helper exports: 7 capabilities, 7 session,
  2 errors, 2 maskPayload) and **1 inline-import path rebase** (line 1628
  `import('./promptedMaskValidation')` -> `import('../promptedMaskValidation')`).
- **0 multi-line template-literal lines** exist in the base (AST scan), so no
  literal text could be altered by the dedent; the dedent bound check threw on
  any line below the shift.
- Generator output sizes (all <= 400): target 297; applyContext 92,
  capabilities 202, session 111, errors 82, maskPayload 127, readyCommit 361,
  promptRun 253, providerRouting 296, workerTransport 288, operations 363,
  applyRun 154; total 2,626 lines (base 2,222; +404 structural import/wrapper
  and type-glue lines).

### Formatting (biome)

- `pnpm exec biome check --write <target> <sam2>`: "Checked 12 files.
  Fixed 9 files"; `pnpm exec biome check <target> <sam2>`: exit 0,
  "No fixes applied".
- Complete pre-biome vs post-biome diff reviewed hunk by hunk: changes are
  (a) import/export statement reordering, (b) reflow of this spec's structural
  glue (signatures/destructures/type aliases), (c) single-statement line
  joins/splits caused by the new indentation. Machine check: TypeScript
  token-multiset comparison pre vs post biome is **identical on every
  non-trivia token in all 12 files** (only automatic/trailing comma+semicolon
  counts differ with line wrapping; the one `|` delta is in
  `applyContext.ts`, a pure-glue file whose union style biome normalized).
  No identifier, literal, keyword, or operator changed anywhere.

### Gates

- `refactor-verify --base master --target ... --dest .../sam2 --json`
  (run before tests and again after biome): exit 0 both times,
  `{ok:true, baseCount:30, presentCount:51, missing:[], missingExports:[]}`
  (51 = 30 base declarations + 21 new structural names: 7 phase functions,
  `precheckSam2Apply`, `runSam2Apply`, and the type-only glue).
- Covering test (direct vitest, queue EROFS): **34 passed (34) / 0 failed
  before** (pre-move baseline, 12.42 s), **34/34 after** (9.05 s pre-biome and
  8.44 s post-biome). Test file byte-identical: `git diff` empty,
  sha256 `67984fe661947b08db7b93851ece71b23470d1647f8bed2b103327966d45f6f2`.
- Direct recursive tsc program (queue-EROFS substitute for `check:agent`, same
  inputs as `check:agent:raw`): after the move
  `packages-checked=20 packages-fail=0 desktop-exit=0 e2e-exit=0 diagnostics=0`
  (exit 0); the editor package alone compiled with 0 diagnostics before the
  full program.
- `node scripts/audit-health.mjs`: exit 0 ("health check passed").
- `pnpm exec biome check` clean (above).

### Ratchet

- `node scripts/quality/audit-file-size.mjs --update` (no `--force`):
  "Wrote .file-size-baseline.json: 946 frozen file(s). added 0, grown 0,
  removed 1".
- Baseline diff: exactly `-"packages/editor/src/context/useSam2Segmentation.ts": 2222`;
  0 added, 0 grown; no other entry touched.
- `pnpm audit:filesize`: exit 0, "6234 source files scanned; 946 over 400
  lines, all frozen". `--report`: 6,234 scanned / **946 frozen / 0 stale** /
  0 violations / 0 untracked WIP / **299,046 excess lines** (was 300,868;
  delta 1,822 = 2,222 - 400, exactly the target's former excess).

### Visual statement

No visual surface changed; `useSam2Segmentation.test.tsx` (34 tests) is the
covering proof and was not edited. The front-end/visual gates did not fire.
