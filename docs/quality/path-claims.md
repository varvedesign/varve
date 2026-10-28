# Advisory path-claim ledger

**Status:** current local operating tool, introduced 2026-10-28. CLI:
`scripts/quality/path-claims.mjs`; state:
`scripts/quality/path-claims-state.mjs`; tests:
`scripts/quality/path-claims.test.mjs`. Related:
[`concurrent-agents.md`](concurrent-agents.md) (the real controls) and
[`local-validation-queue.md`](local-validation-queue.md) (admission).

## Decision

Concurrent sessions can see each other's worktrees, but not each other's
intent. The ledger records repo-relative path claims so a session can see that
another task is already editing the same area.

**The ledger is advisory. It is not a lock.** A claim never blocks, fails, or
delays a command. Nothing in `verify:commit`, `verify:agent`, CI, or any
validation path reads the ledger. Worktree-per-task, single-writer generated
surfaces, and the sequential merge protocol remain the enforceable controls.

This follows the decision review in
[`concurrent-agents.md`](concurrent-agents.md#decision): per-file OS locks and a
claim daemon were rejected. The ledger adds visibility without adding a service
or a stale-lock failure mode.

## What a claim is

A claim is a **task lease** with a TTL (default 4 hours). The TTL is
authoritative. The creating CLI process exits immediately, so its PID and
process identity are recorded for diagnostics only; a claim does not become
stale merely because that process ended. A crashed session's claim remains
visible until its TTL and can be released by id or task label.

Records are files under `$XDG_RUNTIME_DIR/varve-path-claims/` (override
`VARVE_PATH_CLAIMS_DIR`; fallback `/tmp/varve-path-claims/`). Each record holds
the schema, id, creating PID/identity, host, repository root and common git
directory, worktree, task label, note, normalized repo-relative paths, creation
time, expiry, and optional terminal session id. State is machine-wide and
per-user; there is no daemon and no database.

Claims are scoped by the repository **common git directory**, so all worktrees
of one repository compare against each other. A different repository never
produces an overlap, even on the same machine.

## Commands

```bash
pnpm claims claim --task "split replay-fill" --path packages/engine/src/replay-fill.test.ts
pnpm claims list                 # active claims only
pnpm claims list --all           # include expired records
pnpm claims list --repo          # this repository only
pnpm claims check --path packages/engine/src/replay-fill.test.ts
pnpm claims release <claim-id>
pnpm claims release --task "split replay-fill"
pnpm claims prune                # remove expired records
```

`claim` and `check` always exit 0 on overlap. They print the overlapping
claims and the words `nothing was blocked` / `nothing is blocked`. Exit 2 means
invalid input (not a repository, path outside the repository, missing
`--task`/`--path`, bad TTL); exit 1 means a requested claim id was not found;
exit 3 means a claim belongs to another repository.

Claiming the same task label again **replaces** the earlier claim in that
repository, so a long session can refresh intent without accumulating records.
Paths are normalized to repo-relative POSIX form and sorted; `..`, absolute
paths outside the repository, and the repository root are rejected.

## Overlap semantics

Two paths overlap when they are equal or one is an ancestor of the other by
whole path segments. `packages/engine/src` overlaps
`packages/engine/src/a.ts`; `packages/engine/src` does not overlap
`packages/engine/src2`. Expired claims never overlap. Active claims overlap
even if their creating process is gone, because the task lease has not expired.

## Failure modes

- **Claim says a path is mine, but another session edits it.** The ledger did
  its job by making the overlap visible; it cannot arbitrate. Use the worktree
  and merge protocol.
- **A session crashed and left claims.** They expire after the TTL; `list
  --all` shows them, and `release`/`prune` clears them. A dead creating PID is
  not evidence that the task ended.
- **Corrupt record.** `list` reports the count and ignores the file; `prune`
  does not remove unreadable files. Inspect and remove it manually only after
  confirming it is not a live record.
- **Read-only runtime directory.** Set `VARVE_PATH_CLAIMS_DIR` to a writable
  directory for sandboxed sessions, exactly as the validation queue does.

## Non-goals

- No commit/validation enforcement, no required claim before editing.
- No daemon, watchdog, lock file, or OS advisory lock.
- No cross-repository blocking or implicit sibling-checkout dependency.
- No merge authority and no conflict resolution. The merge protocol still owns
  that.
