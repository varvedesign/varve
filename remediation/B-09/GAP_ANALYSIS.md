# B-09 gap analysis — SAM2 segmentation hook split

Companion to `RESEARCH.md`. Measured checkpoint state lives there; this file
records the gap register with owners and the front-end necessity verdict.

## Measured checkpoint state (summary)

Local `master` fast-forwarded to f1411c4ac (B-08) this session;
`.worktrees/B-09` on `seam/B/B-09-sam2-hook` at f1411c4ac, clean, 21
symlinked `node_modules` trees. `pnpm audit:filesize` exit 0 at **947
frozen / 0 stale** (report: 6,223 scanned, 300,868 excess lines, 0 untracked
WIP) — identical to the handoff checkpoint reading. Covering test **34/34**
passed / 0 failed (direct vitest; queue EROFS blocks `pnpm test:agent`).
Direct tsc program: `packages-checked=20 packages-fail=0 desktop-exit=0
e2e-exit=0 diagnostics=0`. `godsplit-plan` exit 0 with 30 blocks;
`refactor-verify --base master --json` exit 0 `{ok:true, baseCount:30,
presentCount:30}`. `pnpm queue:status`: exclusive free, 0 waiting.

## Gap -> action -> owner -> prompt file

| Gap | Action | Owner | Prompt file |
|-----|--------|-------|-------------|
| Batch definition/order: is B-09 the correct next entry? | Yes, measured: the remediation doc's Batch B list is "... room server, bgremove inference, **#17 SAM2 hook**, ContentAwareFill, AdjustmentEditor"; the campaign plan orders "... bgremove, SAM2, ContentAwareFill"; ledger rows B-01..B-08 are committed (B-08 row at 947), so B-09 is next and disjoint (its target path has not been touched by any completed seam) | orchestrator (records merged seams in the dated doc); this session executes only B-09 | this file + `02-SEAM-EXECUTION-TEMPLATE.md` |
| Baseline regeneration: who runs `--update`, how is the diff reviewed, what prevents growth? | The seam worker runs `node scripts/quality/audit-file-size.mjs --update` once in this worktree after the split compiles and tests pass; `git diff -- .file-size-baseline.json` must show exactly the removal of `"packages/editor/src/context/useSam2Segmentation.ts": 2222` (0 added, 0 grown), then `pnpm audit:filesize` exit 0 at 946. `--update` refuses new freezes by policy; `--update --force` is forbidden by policy and by the handoff. The orchestrator regenerates on the merged tree | seam worker (this session) | 02 step 5; policy in `docs/quality/file-size-policy.md` |
| Seam tooling: planner gives ranges, not destinations; verifier is TS-only | `godsplit-plan` (no flags; `--top` unsupported at this checkpoint, measured exit 2) seeds the inventory; every destination in `SEAM_SPEC.md` is a hand decision; `refactor-verify --dest` must exit 0 before tests; Rust substitution does not apply here (measured: both tools parse the target) | seam worker | 01 + 02 steps 1-3 |
| The apply body exceeds any single destination and is mostly untested | Sub-split into phase modules along recorded boundaries with the bodies byte-verbatim; the untested fresh path may not be edited at all (STOP condition); the tested commit path may only move | seam worker | `SEAM_SPEC.md` stop conditions |
| Rollback: what if the seam lands but the ratchet does not go down? | Stop before committing; the seam stays uncommitted; discard only this worktree's changes; never `--force`, never hand-edit the baseline, never commit a partial seam | seam worker | 02 steps 5-8 |
| Observability: how do we know the queue shrinks rather than changes shape? | `--report` FROZEN_COUNT 947 -> 946 and excess lines 300,868 -> lower; exactly one ledger row with caller-generated ISO-8601 timestamp; monotone ratchet (never an added/grown entry); there is no dashboard | seam worker (row + report), orchestrator (dated doc) | 02 steps 5-7 |
| Front-end / accessibility / i18n / dark mode / empty-error-loading states | Not applicable to a pure move (verdict below). The hook's error/loading announcements and session states move verbatim; any change is a defect. Proof: covering test 34/34 unchanged, "no visual surface changed" in `SEAM_SPEC.md` | seam worker | 02 (03/04 gates do not fire) |
| Concurrency: peer-hot surfaces | `.file-size-baseline.json`, `docs/agents/repo-map.generated.md`, `BACKLOG_LEDGER.md` are single-writer; this worktree is their only writer for this seam (queue free, measured). Regenerate the map from the staged tree; never hand-merge | seam worker | 02 steps 6-7 |
| Testing: is the covering suite a real-world scenario? | Real-world for the tested surface: `renderHook` runs the hook against a live `EditorState` with mocked image/model boundaries and exercises reviewed-candidate commit guards (19 tests), mask-combination decisions (9), entry guards (3), preview presentation (1), and layer extract (1). **Not covered:** the fresh inference path (encode/route/worker/publication) — recorded as an explicit residual with the byte-identity guardrail; no end-to-end desktop run is required or run for a file split | seam worker | `RESEARCH.md` theme 13; `SEAM_SPEC.md` proof plan |
| Docs index: does this seam touch `docs/`? | No: it adds `remediation/B-09/*` (outside `docs/`) and regenerates `docs/agents/repo-map.generated.md` via `pnpm agent:map` (generated, staged). `pnpm audit:docs` requires no index row for remediation docs; the dated remediation record and campaign plan stay untouched by workers | seam worker | 02 step 6 |
| Environment limits (measured, not blockers) | Read-only pnpm store: 21 node_modules symlinks instead of `pnpm install`; queue EROFS: direct tsc program + direct vitest substitution; `pnpm -r exec tsc` fails its pre-install (read-only store) so per-package direct tsc is used. All substitutions produced checkpoint-identical results | seam worker | Blockers section of the handoff; this file |

## Front-end necessity gate (prompt 01 section D)

- Does this seam change anything an operator sees or does in a remediation
  workbench? **No** — no workbench exists (the queue is the baseline + ledger +
  report commands); B-09 is a pure module move that must behave identically.
- Does it change an API response shape consumed by the UI? **No** — the
  exported surface (`useSam2Segmentation`, `Sam2SegmentationAPI`,
  `buildMaskPayload`, `mapPromptedRoutingFailure`, `embeddingCacheMaxEntries`)
  keeps identical names, signatures and import paths.
- Does it change error, empty, loading, or permission states? **No** — every
  announcement string, error taxonomy mapping and session state write moves
  verbatim; any such change is a defect, not a feature.
- Does it make the queue harder to understand? **Not applicable** — the queue
  is not a UI; one entry leaves (947 -> 946) and one ledger row is appended.

**Verdict: the front-end necessity gate does not fire; prompts 03 and 04 do
not run.** The only UI-adjacent requirement is proof of identical behavior:
the covering test (34 tests) passes unchanged before and after, and
`SEAM_SPEC.md` states "no visual surface changed".
