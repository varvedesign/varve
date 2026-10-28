# Agent infrastructure campaign — 2026-10-28

**Status:** dated execution plan. Current contracts stay authoritative:
[`file-size-policy.md`](../quality/file-size-policy.md),
[`ipc-type-contract.md`](../architecture/ipc-type-contract.md),
[`concurrent-agents.md`](../quality/concurrent-agents.md), and
[`local-validation-queue.md`](../quality/local-validation-queue.md). This plan
only sequences the remaining work and records the decisions those contracts
leave open.

## Measured baseline

- **God files:** 6,060 source files scanned; 965 over 400 lines; **960 frozen**
  entries. The pasted “964” count was already stale: three Batch A splits plus
  A-08 removed four entries (964 -> 960).
- **IPC:** 154 Rust commands in 15 files; 191 literal TS invoke sites; 172 unique
  names; 124 matched; **48 known Home gaps**; 4 allowlisted dynamic sites; 0
  generated bindings. 48 commands now live in `home_store/`, which is why
  `lib.rs` dropped to 7,377 lines.
- **Hutch:** separate repository at `../hutch`; queue adapter landed
  (`scripts/validation_queue.py`, 6 tests) with no implicit cross-repo default.
- **Working tree:** dozens of modified and untracked files belong to other
  sessions. Every task below runs in its own worktree and touches only its named
  files.

## Order

1. **P0 foundations** (this session): advisory path claims, Hutch queue wrapper,
   this plan. Neither P0 item gates a commit or a validation run.
2. **P1 Batch A** remaining low-risk splits, one seam per task.
3. **P2 Home IPC** storage decision plus the tags pilot group; then groups in
   dependency order.
4. **P3 Batch B** module extraction behind tests/goldens, starting with
   `lib.rs` domain modules so state and command seams exist before generated
   bindings.
5. **P4 tauri-specta** phases 1-5, after the first `lib.rs` command groups and
   the first typed Home module exist.
6. **P5 Batch C** hot-path splits (benchmarks required), then **Batch D** hubs
   (import-neutral only).
7. **P6 CI-scale remote cache**, independently of the local inner loop.

## Workstream 1 — advisory path-claim ledger

**Decision:** add a ledger because concurrent worktrees make intent invisible,
but keep it purely advisory. It is a visibility tool, not a lock, not a gate,
and not a merge authority.

**Non-goals (binding):**

- Never wired into `verify:commit`, `verify:agent`, CI, or any validation
  command. A claim cannot block, fail, or delay work.
- No daemon, no OS file locks, no watchdog process.
- No cross-repository enforcement. Claims are scoped by the repository common
  git directory; another repo’s claims never compare.
- No promise that a claimed path is exclusive. Worktree-per-task, single-writer
  surfaces, and the merge protocol remain the real controls.

**Shape:** `scripts/quality/path-claims.mjs` plus
`scripts/quality/path-claims-state.mjs`, state under
`$XDG_RUNTIME_DIR|/tmp/varve-path-claims/` (override
`VARVE_PATH_CLAIMS_DIR`). Records carry owner PID and process identity, repo
common dir, worktree, task label, repo-relative paths, note, creation and expiry.
Default TTL 4 hours; `claim` always succeeds and prints overlapping live claims
as warnings; `check` always exits 0 unless input is invalid; `prune` removes
expired or dead-owner records only.

**Commands:** `pnpm claims claim --task ... --path ...`, `pnpm claims list`,
`pnpm claims check --path ...`, `pnpm claims release <id|--mine>`,
`pnpm claims prune`.

**Acceptance:** focused `node --test` suite covers overlap, cross-repo
isolation, path escape rejection, expiry, dead-owner staleness, corrupt-record
tolerance, and the “never blocks” contract; `audit:docs` and `audit:filesize`
stay green.

## Workstream 2 — CI-scale shared compiler / remote cache

**Decision:** a remote cache is a CI optimization, not a local-first default.
Do not add a cache service, a shared `CARGO_TARGET_DIR`, or a local daemon to
the developer inner loop. Local correctness still comes from the queue and the
heavy-task lease.

**Phases:**

1. **Measure.** CI lane wall times and cache hit rates for `cargo check`,
   `cargo test`, `tsc`, Vitest, and Playwright. Record the baseline in the CI
   execution report; no cache work without a measured target.
2. **Cheap dependency caches.** pnpm store and Cargo registry/git caches keyed by
   lockfile hashes and toolchain versions. These are safe, reversible, and do
   not change compiler behavior.
3. **Rust compiler cache.** `sccache` only in CI, with a remote backend
   (GitHub Actions cache or an object store). Pin the sccache version, key by
   target triple, Rust toolchain, profile, and lockfile, and keep fork PRs
   read-only. Local developers do not set `RUSTC_WRAPPER` by default.
4. **Optional artifact caches.** Only if phase 1 shows a material win: cache
   Playwright browser installs and generated WASM artifacts by exact input hash.
   Never cache test results, visual baselines, or release evidence as a
   substitute for execution.

**Guardrails:** cache misses are always correct; a poisoned or stale cache must
not be able to change a pass into a fail or a fail into a pass; secrets never
enter cache keys or artifacts; cache provenance is not release provenance; every
phase has a one-line rollback (remove the cache step).

**Acceptance:** measured median CI reduction with no change to local commands,
no new local service, and a documented rollback. If the measurement does not
justify it, stop at phase 2.

## Workstream 3 — god-file Batch A-D queue

The ranked list and seams live in
[`agent-context-remediation-2026-10-28.md`](../quality/agent-context-remediation-2026-10-28.md).
This plan fixes the execution protocol and the remaining order.

**Task protocol (per split):**

1. Start from a fresh worktree; claim the target paths with `pnpm claims`.
2. Move code only. No behavior edits, no test weakening, no opportunistic
   renames.
3. Focused tests before and after; record counts.
4. `pnpm exec biome check` on changed files.
5. `node scripts/quality/audit-file-size.mjs --update` after the split is green;
   confirm exactly the intended entry left the baseline and no new over-cap file
   was frozen. `--update --force` is not allowed.
6. Merge sequentially. The baseline is a single-writer surface: no two splits
   update it concurrently.
7. After merge: `pnpm verify:plan`, `pnpm verify:affected`, then regenerate the
   baseline from the merged tree.

**Batch A remaining (low risk):**

| ID | File | Seam |
|----|------|------|
| A-04 | `packages/editor/src/panels/IntelligencePanel.tsx` (3,191) | one module per tab under `panels/intelligence/` |
| A-05 | `packages/scene/src/types.ts` (3,055) | domain modules plus one re-export barrel |
| A-06 | `scripts/screenshots/product.mjs` (2,767) | scene data vs runner vs manifest sync |
| A-07 | `crates/varve-bridge/tests/wgsl_validation.rs` (2,696) | shader-family modules plus shared fixtures |
| A-08 | `packages/engine/src/replay-fill.test.ts` (2,269) | test families plus shared helpers |
| A-09 | `scripts/perf/run-production-workload.mjs` (1,969) | scenario data vs runner vs report |

**Batch B order:** `lib.rs` command groups first (B-01), then print, clipboard,
document codec, filters, snapping, room server, bgremove, SAM2, ContentAwareFill,
AdjustmentEditor. Each extraction needs the existing golden/regression suite
green before and after.

**Batch C order:** `replay.ts`, `inputPipeline.ts`, `renderPipeline.ts`.
Benchmark 100/1k/10k/50k nodes (or the pointer equivalent) before and after;
keep per-node dispatch monomorphic; never weaken the “no pixels no fresh frame
will replace” rule.

**Batch D order:** `context.tsx`, `Menubar.tsx`, `CanvasArea.tsx`, `Shell.tsx`.
Import-neutral extractions only; hub budgets and component complexity ceilings
apply.

**Worker rule:** one worker per worktree, one task per worker. Workers may not
update the baseline concurrently, may not use `--update --force`, and may not
merge. A worker that cannot finish leaves its worktree unmerged for review.

## Workstream 4 — Home native IPC commands (56 originally, 48 remaining)

**Decision:** implement the gaps in a `varve-sync`-backed
`apps/desktop/src-tauri/src/home_store.rs` domain module (legacy Home commands
move there from `lib.rs` as part of B-01). `DocumentStore` stays the single
SQLite owner; new tables arrive through additive, versioned migrations
(`SCHEMA_VERSION` bumps), one group per migration.

**Rules:**

- Typed request/response structs only; `#[serde(rename_all = "camelCase")]`;
  epoch-millisecond timestamps to match the TS types. No new `*_json: String`
  or `serde_json::Value` parameters.
- One group per land. After the group is registered and round-trip tested,
  delete its `KNOWN_NATIVE_GAPS` entries. The audit fails on stale entries, so
  the allowlist can only shrink.
- Desktop parity coverage: each group gets a store-level Rust test and a
  platform-adapter round-trip test where the adapter shape is not a straight
  cast.
- Schema changes are single-writer. Two groups never bump `SCHEMA_VERSION` in
  parallel.

**Group order and counts:**

| Group | Commands | Why this order |
|-------|----------|----------------|
| Tags | 8 | **landed** — self-contained join table, schema v3; the pilot group |
| Drafts | 3 | reuses `files.project_id` with the `__drafts__` sentinel |
| Folders | 6 | hierarchy over projects; validates parent/ordering rules |
| Collections | 8 | cross-project membership plus smart filters |
| Workspaces | 5 | scope owner for the remaining groups |
| Libraries | 4 | workspace-scoped, enable/disable state |
| Templates | 6 | document JSON payloads; needs bounded validation |
| Assets | 6 | binary metadata and search; no source bytes in SQLite |
| Branches | 2 | version-history adjacency |
| Permissions | 2 | trust-boundary review required |
| Activity | 2 | append-only event log |
| Saved searches | 3 | query/tag references |
| File-content search | 1 | FTS or bounded LIKE; decide in its own task |

**Tags pilot schema (v3):**

```sql
CREATE TABLE home_tags (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (workspace_id, name)
);
CREATE TABLE home_file_tags (
  file_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (file_id, tag_id)
);
CREATE INDEX home_file_tags_tag ON home_file_tags(tag_id);
```

**Acceptance for every group:** `cargo check` (Tauri crate), the store tests,
`pnpm audit:ipc` with that group’s allowlist entries gone, and no growth in
`lib.rs` (new commands go to `home_store.rs`).

## Workstream 5 — tauri-specta adoption

Follow the phased plan in
[`ipc-type-contract.md`](../architecture/ipc-type-contract.md#phased-tauri-specta-adoption).
Sequencing constraints:

1. Phase 1 pilot uses the 3-command `acceleration` group, not `lib.rs`.
2. Phase 2 commits `apps/desktop/src/ipc/bindings.gen.ts` and adds a drift check
   to `verify:agent`/CI. Generated output is excluded from the file-size budget.
3. Phase 3 migrates adapter modules one group at a time, starting with
   `packages/platform/src/tauri.ts` and the Home groups as they land.
4. Phase 4 enforces the adapter boundary (raw `invoke(` fails outside the
   generated client and reviewed adapters).
5. Phase 5 retires `*_json: String` parameters only after each payload has a
   typed struct and a runtime-bounds review.

**Acceptance:** no hand-edited generated file; CI fails when Rust and bindings
disagree; `audit:ipc` stays green as a cross-check; each migrated group deletes
its hand-written payload interface.

## Workstream 6 — Hutch queue adoption

**Decision:** a small per-repository wrapper, not an implicit cross-repo
dependency. Hutch does not import Varve code and does not assume a sibling
checkout path.

**Shape:** `scripts/validation_queue.py` in Hutch. The queue CLI is resolved from
`--queue-cli` or `VARVE_QUEUE_CLI`; if neither is set, the wrapper exits with a
clear configuration error. It forwards `run`, `status`, `history`, `show`, and
`prune` to the same machine-wide CLI, with Hutch as the child cwd. State and
receipts remain machine-wide; receipt identity already includes the repository
common directory and HEAD, so Hutch and Varve never reuse each other’s passes.

**Wiring:** `npm run queue -- status|run|history|prune` in Hutch, focused pytest
coverage with a fake queue CLI, a row in `docs/concurrent-agents.md`, and
`npm run agent:map` regeneration.

**Acceptance:** wrapper tests pass; `npm run check:agent` passes; a missing
`VARVE_QUEUE_CLI` fails clearly; no Varve path appears as a default in Hutch.

## Execution ledger

| ID | Task | Status |
|----|------|--------|
| FND-01 | advisory path-claim ledger | done: `pnpm claims`, 9 tests |
| FND-02 | Hutch queue wrapper | done: 6 tests, end-to-end `status` verified |
| A-08 | split `replay-fill.test.ts` | done: 84 tests across 11 files, baseline 961 -> 960 |
| B-01 | split `lib.rs` command groups | partial: Home extracted to `home_store/` (48 commands); other groups queued |
| IPC-01 | tags pilot (8 commands) | done: schema v3, gaps 56 -> 48 |
| A-04..A-07, A-09 | remaining Batch A splits | queued, one worktree each |
| IPC-02..IPC-13 | remaining Home groups (drafts next) | queued |
| SP-01..SP-05 | tauri-specta phases | queued after the first typed Home groups |
| C-01..C-03 | hot-path splits | queued after Batch B |
| D-01..D-04 | hub splits | queued after Batch C |
| CACHE-01..03 | CI remote-cache phases | independent; measure first |

## Risks and open decisions

- **Dirty shared tree.** Only the named files for a task may change; baseline and
  docs indexes are single-writer. A red tree may belong to another session.
- **Queue runtime under sandbox.** The default `/run/user/<uid>` path can be
  read-only in a sandboxed session; use a writable `VARVE_VALIDATION_QUEUE_*`
  directory for local runs. CI bypasses the queue by design.
- **Rust build cost.** Home groups and specta both compile the Tauri crate; batch
  them so one `cargo check` covers several changes, but keep one seam per task.
- **Migration conflicts.** Home schema migrations are sequential and
  single-writer; never land two `SCHEMA_VERSION` bumps together.
- **Cache trust.** A remote cache is not evidence and must never be able to turn
  a failing test into a pass; fork PRs stay read-only.
