# Concurrent agents on one workstation

**Status:** current operating model, introduced 2026-10-28. Tools:
`pnpm worktree:status`, `pnpm worktree:prune`, `pnpm queue:status`,
`pnpm verify:plan` / `pnpm verify:affected`, `scripts/quality/heavy-lease.mjs`.
Canonical policy for validation: [validation-strategy.md](validation-strategy.md);
queue contract: [local-validation-queue.md](local-validation-queue.md).

## The problem

Several agents (and the maintainer) can work on one machine against one
repository. The failure modes are distinct, and each needs a different
control:

1. **Same-file conflicts and silent overwrites** when two sessions share a
   checkout or branch.
2. **Generated-file conflicts** in artifacts that must be regenerated rather
   than merged by hand (`AGENTS.md` indexes, lockfiles, baselines, generated
   maps/CSS). A hand-merged JSON or Markdown table can be silently invalid.
3. **Attribution defects**: a tree-wide check turns red because *another*
   session has uncommitted broken work; agents then chase a phantom failure.
4. **Merge defects**: two locally-green branches compose into a broken tree
   because validation only ever ran on the branches in isolation.
5. **Machine strain**: duplicate compiler/test/browser runs saturate CPU and
   memory; duplicated installs/build outputs consume tens of GB.

## Decision

**Adopted:**

- **Worktree per task** for any change that writes files; the shared
  checkout is for read-only inspection and short single-file edits.
- **Single-writer generated surfaces** (table below): one agent owns one of
  them per merge window; after a merge, regenerate rather than hand-merge.
- **Machine admission** for validation: the shared queue for compilers/tests/
  affected gates, the heavy-task lease for browser/build work.
- **Staged-only pre-commit validators** so a commit is judged on what the
  author staged, not on other sessions' dirty working trees.
- **Sequential merge protocol** with affected validation before and after.
- **Safe worktree pruning** for disk/strain control, never touching dirty,
  unmerged or external worktrees.

**Rejected (and why):**

| Alternative | Why rejected |
|---|---|
| Per-file OS locks or a claim daemon | Advisory at best, stale-lock prone across crashes/worktrees, and no cross-platform story; the merge protocol plus single-writer surfaces covers the real risk with no new service. |
| Union merge (`merge=union`) for generated JSON/Markdown | Produces syntactically valid but semantically wrong files (duplicate table rows, conflicting baselines) with no failure signal. Regeneration is deterministic and reviewable. |
| One shared `CARGO_TARGET_DIR` for all worktrees | Cargo serializes on the package cache anyway, and branch switching thrashes the cache; the win is small versus per-worktree target cost handled by pruning. |
| A dedicated validation runner/daemon | Rejected earlier for the queue: availability, credential/command-execution surface, and it fails when the runner is the CPU hog. |
| Auto-rebase/auto-merge bots for release branches | Changes need review, affected validation and regeneration; automation here converts conflicts into silent defects. |

## Worktree isolation

```bash
git fetch origin
git worktree add .worktrees/<slug> -b <type>/<slug> origin/master
cd .worktrees/<slug> && pnpm install --frozen-lockfile
```

- One branch and one active writer per worktree. Never run two agents in the
  same worktree; if a second agent must help, give it a different worktree or
  a read-only review role.
- Commit on the worktree branch, rebase onto `origin/master`, then merge
  sequentially (see below). Do not merge from a shared dirty checkout.
- Worktrees outside the repository (`~/.codex/worktrees/...`, sibling
  checkouts such as `../varve-svgfix`) belong to other sessions or tools.
  They are **never** modified or pruned by repository scripts.
- `pnpm worktree:status` shows every registered worktree with branch, dirty/
  untracked counts, ahead/behind, merged state, age, stale candidates and the
  current machine queue holder.

## Single-writer generated surfaces

| Surface | Rule | Recovery after a conflict |
|---|---|---|
| `AGENTS.md` + `docs/README.md` + `.ai/*` indexes | One editor per merge window | Reapply the edit, then run `pnpm audit:agent-surface` and `pnpm audit:constitution` |
| `package.json` scripts + lockfiles (`pnpm-lock.yaml`, `Cargo.lock`) | One owner; no concurrent lockfile updates | Re-run the package manager, never hand-edit the lockfile |
| `.file-size-baseline.json` | Shrink-only; updated only after a split | Re-run `pnpm audit:filesize --update` on the merged tree |
| `docs/agents/repo-map.generated.md` | Generated, never hand-edited | `pnpm agent:map`, stage the result |
| `.ignore` / `.dshignore` / `.opencodeignore` | Identical trio, one owner | Copy one file over the other two, run `pnpm audit:agent-surface` |
| Generated CSS / shipped assets | Build from sources | `npm run build:css`, never merge output files |
| Visual baselines (`tests/e2e/**/*-snapshots/*.png`) | Binary review artifacts; one owner per intended design change; never hand-merged | Take one side, re-run `pnpm visual:update` on the merged code, review the regenerated baseline |

## Validation under concurrency

- Gate scripts self-queue. Do not launch raw `tsc`/`cargo`/`vitest`/Playwright
  runs in parallel; use `pnpm check:agent`, `pnpm check:rust`,
  `pnpm test:agent <paths>`, `pnpm verify:affected`, and the heavy-lease
  wrapper for browser runs.
- A passed queue receipt for a **clean** tree is reusable across worktrees of
  the same repository at the same HEAD (same common git directory, command,
  class and tool versions). Run the affected gate once per HEAD, not once per
  worktree. Dirty trees always run fresh.
- Pre-commit validators judge **staged** content:
  `generate-agent-map.mjs --staged` and `audit-file-size.mjs --staged`.
  Worktree-only drift from another session cannot make your commit fail, and
  your staged content cannot hide behind a green worktree.
- A tree-wide failure may belong to another session. Check `git status` in
  the current worktree, `pnpm worktree:status`, and the queue holder before
  chasing a failure you did not cause.

## Advisory path claims

`pnpm claims claim --task "<label>" --path <repo-path>` records intent for a
repo-relative path set. It is **advisory only**: claiming and checking never
block, and no commit or validation path reads the ledger. Claims are scoped by
the repository common git directory, expire after a TTL (default 4 hours), and
can be released by id or task label. Use it at the start of a parallel task to
make overlap visible; worktree isolation and the merge protocol remain the real
controls. Contract: [path-claims.md](path-claims.md).

## Merge protocol

1. `git fetch origin && git rebase origin/master` in the task worktree.
2. Resolve source conflicts normally. Resolve generated surfaces by
   regeneration (table above), never by hand-merging both sides.
3. `pnpm verify:plan`, then `pnpm verify:affected` (both queued). Treat a
   plan escalation as a decision, not a suggestion.
4. `pnpm verify:push` for the exact outgoing refs.
5. Merge the branch sequentially on `master`; after each merge the
   coordinator runs `pnpm verify:plan` + `pnpm verify:affected` on the
   merged tree, and regenerates any generated surface touched by both sides.
6. Remove the merged worktree: `pnpm worktree:prune` (dry run), then
   `pnpm worktree:prune --apply`. Never remove a dirty or unmerged worktree.

## Performance and storage

- One heavy gate at a time machine-wide; the queue and heavy-lease own that
  serialization. Two browser lanes + a compiler lane is the contention
  pattern that motivated both tools.
- `pnpm install` uses the shared pnpm store (hardlinks), so extra worktrees
  are cheaper on disk than they look; per-worktree `node_modules` and Rust
  `target/` trees are still the main cost. Prune merged worktrees instead of
  keeping every experiment forever.
- Never duplicate a full validation run "just to be safe" in another
  worktree; the receipt cache exists to prevent exactly that.
- Use isolated ports (`VARVE_E2E_PORT`) and never run two Playwright suites
  outside the lease.

## Failure modes

| Symptom | Cause | Action |
|---|---|---|
| Tree-wide check fails in a file you did not touch | Another session's dirty worktree | Check `git status`; wait or use staged-only checks; do not "fix" their file |
| Generated JSON/Markdown conflict markers | Both sides regenerated | Take either side, regenerate with the canonical command, review the diff |
| Guard reports a frozen file grew | Another session is editing a tracked file | Do not force the baseline; let the author split or re-adopt intentionally |
| Two worktrees on one branch | Worktree created from an already-checked-out branch | Remove the duplicate, create a new branch; `git worktree list` |
| Machine queue waits for minutes | An exclusive lane (cargo/affected) is running elsewhere | `pnpm queue:status`; wait or run a shared focused check |
| Disk pressure from worktrees | Stale merged experiments | `pnpm worktree:prune` then `--apply`; external worktrees are never touched |

## Follow-ups

- **Advisory path claims** are implemented as `pnpm claims ...`; see
  [path-claims.md](path-claims.md). They make overlap visible, never gate
  commits or validation, and are not a substitute for worktree isolation.
- **A shared compiler cache service** (sccache/remote cache) remains a CI-scale
  optimization, not a local-first default. The phased measurement and rollout
  plan is in
  [`agent-infrastructure-campaign-2026-10-28.md`](../plans/agent-infrastructure-campaign-2026-10-28.md#workstream-2--ci-scale-shared-compiler--remote-cache).
