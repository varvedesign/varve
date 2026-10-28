# Local validation queue — decision and contract

**Status:** current local operating contract, introduced 2026-10-28.
Related: [validation-strategy.md](validation-strategy.md) (canonical validation
policy), [file-size-policy.md](file-size-policy.md), and
[`scripts/quality/validation-queue.mjs`](../../scripts/quality/validation-queue.mjs).

## The structural problem

Several agents can share one workstation and one checkout family. Each running
its own gate — recursive `tsc`, `cargo check`, focused or full Vitest,
Playwright — independently saturates the CPU, drives the kernel into memory
pressure, and re-does work another agent just completed. The heavy-task lease
solved the worst case (browser OOM kills) and the push/full-gate receipt caches
solved repeat evidence, but ordinary gate runs bypassed both. The machine is
small enough that two recursive typechecks plus a browser lane already
interfere; observed directly while auditing this work.

## Decision review (2026-10-28)

The proposal was: *"local agents should not each run independent gates on one
workstation; the durable fix is a single shared validation queue (or a dedicated
runner) that owns the machine and hands back receipts."*

**Accepted:** local gate runs must share one admission point, and every run must
leave a receipt that a second agent can reuse instead of re-running.

**Rejected:** a dedicated runner/daemon that "owns the machine". It adds a
long-lived availability problem, a command-execution/credential surface, a
cross-platform service lifecycle (Linux/macOS/Windows), and it fails precisely
when the runner itself is the CPU hog. The repository already has the durable
pieces as files: the cross-worktree **heavy-task lease** (owner PID + process
identity, bounded wait, memory floor, tested child cleanup) and the **local
receipt caches** (exact identity pins, clean-tree-only reuse, local cache never
CI evidence). The correct form is to join them for every gate run — not to add a
new service.

**Also rejected:** one global mutex for *all* validation. Serializing a 2-second
audit behind an 8-minute `cargo check` wastes the workstation. Admission uses
resource classes instead:

| Class | Concurrency | Use for |
| --- | --- | --- |
| `exclusive` | exactly one machine-wide, through the memory floor | recursive `tsc` (`check:agent`), `cargo check` (`check:rust`), `verify:affected`, full Vitest, builds |
| `shared` | up to `VARVE_VALIDATION_QUEUE_SHARED_SLOTS` (default `min(4, cpus/2)`) | audits, focused specs (`test:agent`), small scripts |

Browser/Playwright runs stay with the heavy-task lease: that lease owns the
memory floor and the browser-crash evidence, and wrapping it twice would hold
the machine queue while waiting on the repository lock. Queue-exclusive runs may
*internally* launch browser lanes (for example `verify:affected`); they are
already the only queued gate on the machine at that point.

## What the queue does

1. **Admission.** `exclusive` lock files or `shared` slot files under
   `$XDG_RUNTIME_DIR|/tmp/varve-validation-queue/`. Records carry owner PID,
   process identity, queue ID, label, class, cwd, and start time. A lock is
   reclaimed only after its owner PID and identity are proven dead; corrupt
   metadata fails closed; a deadline fails with exit 1 instead of running
   concurrently. A live lock is never stolen, and a released owner can never
   remove its successor's lock.
2. **Memory floor.** Before an `exclusive` run, wait for real `MemAvailable`
   (`VARVE_LEASE_MIN_MEM_MB`, default 1536 MB), matching the heavy-task lease
   rationale: a free slot says nothing about an unwrapped browser elsewhere.
3. **Execution.** The command runs under the tested child supervisor from
   `heavy-lease.mjs` (`runValidationCommand`) with `stdio: inherit`, so agents
   see their own output live and cancellation/descendant cleanup behaves like
   every other validation run.
4. **Receipt.** Writes a receipt under
   `$XDG_CACHE_HOME|~/.cache/varve/validation-queue/receipts/` with identity
   hash, label, class, argv, cwd, repository common git directory, HEAD SHA,
   clean/dirty state, dirty-tree hash when applicable, outcome, exit code,
   duration, and tool versions.
5. **Reuse.** A run is skipped only when a **passed** receipt matches the exact
   command, class, repository, HEAD, and tool versions, the tree is **clean**,
   and the receipt is younger than the TTL (default 6 h). Dirty trees always
   run; failed receipts are never reused. Reuse prints the receipt hash and
   says no command executed; `--no-cache` forces execution.

Receipts are local cache and local evidence only. They never satisfy CI,
release-candidate certification, signing, or provenance; those remain remote
exact-SHA evidence.

## Commands

Gate scripts self-queue, so the ordinary inner loop is unchanged in name:

```bash
pnpm check:agent                 # exclusive queued tsc gate, machine-wide
pnpm check:rust                  # exclusive queued cargo check, memory floor
pnpm test:agent <spec paths>     # shared queued focused Vitest (no "--")
pnpm verify:affected             # exclusive queued affected validation
pnpm verify:agent                # check:agent + agent-surface + file-size + IPC audits
pnpm queue:status                # holders, shared slots, waiters
pnpm queue:history               # recent receipts (hash, outcome, duration, tree)
pnpm queue:prune                 # remove receipts older than 14 days (default)
```

Raw, unqueued variants exist for diagnosis and CI: `check:agent:raw`,
`check:rust:raw`, `check:rust:workspace:raw`, `test:agent:raw`,
`verify:affected:raw`. Any command can be queued directly:

```bash
node scripts/quality/validation-queue.mjs run --label "custom gate" \
  --class exclusive -- <command...>
```

## Bypasses

- `CI` present (GitHub Actions sets it) — CI owns its own runner, receipts, and
  concurrency; the queue must not serialize or reuse there.
- Nested invocation (`VARVE_VALIDATION_QUEUE_ACTIVE=1` is set on queued
  children) — prevents queue-within-queue deadlock when a queued script calls
  another queued script.
- `VARVE_VALIDATION_QUEUE=0` or `VARVE_HEAVY_TASK_PARALLELISM=0` — deliberate
  operator opt-out for both admission and receipts.

Bypassed runs never write receipts, so they cannot silently become evidence.

## Across worktrees

Receipt identity includes the repository common git directory, HEAD, command,
class and tool versions. A passed receipt for a **clean** tree is therefore
reusable by every worktree of the same repository at the same HEAD: run the
affected gate once per HEAD, not once per worktree. Dirty trees always run
fresh, so uncommitted work is never credited with another session's pass.
Staged-only pre-commit validators (`audit:filesize:staged`,
`audit:agent-map --staged`) exist so a commit is judged on its staged content
rather than the shared working tree.

## Failure modes and operations

| Symptom | Meaning | Action |
| --- | --- | --- |
| `waiting for <label> (... running 8m)` | A live gate owns admission | Wait; do not kill another agent's run |
| `reclaiming stale lock` | Owner PID/identity is gone | Expected recovery; rerun normally |
| `deadline reached` | Your wait bound expired | Re-run with a larger `VARVE_VALIDATION_QUEUE_TIMEOUT_MS` or after the holder exits |
| `invalid queue metadata` | Corrupt lock file | Fail closed by design: inspect/remove the named file only after proving no live owner |
| `receipt write failed` | Cache directory unwritable/full | Command result still applies; fix cache permissions |
| `cleanup incomplete` | A queued command left descendants | Inspect; the run is reported failed rather than silently passing |

Queue state lives outside the repository, is per-user, and contains no
environment values, credentials, or captured output. Sources of truth for
implementation and edge cases are the modules beside the CLI
(`validation-queue-state.mjs`, `validation-queue-receipts.mjs`) and their
tests: `validation-queue.test.mjs`, `validation-queue-concurrency.test.mjs`.

## Follow-ups

- **Other local repositories on the same workstation** (for example Hutch) are
  not yet wired. The admission and receipt state is machine-wide, so adoption is
  a per-repository wrapper around the same CLI or a small script that invokes it
  by an explicit checkout path; it must not become an implicit cross-repo
  dependency. Decide per repository whether the CPU gating is worth it.
- **Browser/Playwright unification** was deliberately not attempted: the
  heavy-task lease owns the memory floor and browser-crash evidence today.
  Unifying would first require the queue to acquire that repository lock without
  holding the machine slot while waiting (repo lease first, machine slot
  second) and evidence that one queue for browser lanes improves rather than
  serializes the wrong thing.
- **Throughput tuning:** `VARVE_VALIDATION_QUEUE_SHARED_SLOTS` is the only knob
  for light-lane parallelism today; per-lane cost history (the receipts already
  contain durations) could inform ETA output later.
