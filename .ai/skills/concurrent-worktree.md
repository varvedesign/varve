# Work concurrently in worktrees

Run concurrent tasks without overwrites, generated-file defects, phantom
failures, or machine strain: [concurrent-agents.md](../../docs/quality/concurrent-agents.md).

## When to use

- Starting any task that writes files while other agents may be active.
- Before a merge, when a tree-wide red hits a file you did not touch, or when CPU/disk contention appears.
- Not for read-only inspection in the shared checkout.

## Required context

- [concurrent-agents.md](../../docs/quality/concurrent-agents.md) - isolation, single-writer surfaces, merge protocol, failure modes.
- [local-validation-queue.md](../../docs/quality/local-validation-queue.md) - queue classes, receipts across worktrees, bypasses.
- [validation-and-workflow.md](../../docs/agents/validation-and-workflow.md) and [file-size-policy.md](../../docs/quality/file-size-policy.md) - tiers, verify:plan/affected, pre-push, baseline recovery.
- [.ai/skills/README.md](README.md) - sibling playbooks (split file, run validation).

## Steps

1. Pre-flight: `pnpm worktree:status` (state, stale candidates, queue holder) and
   `pnpm queue:status`; never write in a checkout another session is using.
2. Isolate: one task = one worktree, branch, writer:
   `git worktree add .worktrees/<slug> -b <type>/<slug> origin/master`, then
   `pnpm install --frozen-lockfile`. Never share a worktree; external worktrees
   (`~/.codex/...`, siblings) are other sessions' - never modify or prune them.
3. Apply 3-File / 1-Seam. Before touching a single-writer generated surface
   (`AGENTS.md`, `docs/README.md`, `.ai/*` indexes, `package.json`, lockfiles,
   `.file-size-baseline.json`, `docs/agents/repo-map.generated.md`, generated
   CSS, the `.ignore` trio, `.ai/constitution.json`), check `worktree:status`
   and coordinate; one editor per merge window.
4. Validate while others work: queued gates only (`check:agent`, `check:rust`,
   `test:agent`, `verify:affected`) and the heavy lease for browser/build work,
   one heavy gate machine-wide. A tree-wide red may be another session's dirty
   worktree: check `git status`, `worktree:status`, and the queue holder first.
5. Pre-commit: staged-only validators (`pnpm audit:filesize:staged`,
   `node scripts/quality/generate-agent-map.mjs --staged`) judge what you staged,
   not another worktree's drift.
6. Generated conflict: take one side, then regenerate (`pnpm agent:map`,
   `pnpm audit:filesize --update`, or copy one `.ignore` file over the others then
   `pnpm audit:agent-surface`); never hand-merge.
7. Merge: `git fetch origin && git rebase origin/master`, regenerate generated
   surfaces last, then `pnpm verify:plan` and `pnpm verify:affected`; merge
   sequentially, coordinator runs affected after each merge, then `pnpm verify:push`.
8. Clean up: `pnpm worktree:prune` (dry run) then `--apply` for clean, merged
   worktrees only; pnpm store hardlinks are shared, per-worktree `node_modules`
   and cargo `target/` cost disk. Use isolated `VARVE_E2E_PORT` values.
9. Report branch, worktree, commands, receipts, merge result.

## Exact commands

```bash
pnpm worktree:status && pnpm queue:status
git worktree add .worktrees/<slug> -b <type>/<slug> origin/master
pnpm install --frozen-lockfile        # inside the new worktree
pnpm audit:filesize:staged && node scripts/quality/generate-agent-map.mjs --staged
pnpm agent:map && pnpm audit:agent-surface && pnpm audit:filesize --update
git fetch origin && git rebase origin/master
pnpm verify:plan && pnpm verify:affected && pnpm verify:push
pnpm worktree:prune && pnpm worktree:prune --apply   # clean, merged only
VARVE_E2E_PORT=<port> node scripts/quality/heavy-lease.mjs "e2e: <what>" -- \
  npx playwright test <spec> --project=chromium --workers=1 --reporter=list
```

## Definition of done

- One worktree and branch per task; no shared worktree; no external worktree touched.
- Generated surfaces regenerated, not hand-merged; staged validators green; queued
  gates ran once per HEAD (clean-tree receipts reused across worktrees).
- verify:plan/affected green on the merged tree; verify:push green; merge sequential.
- Only clean, merged worktrees pruned; report branch, worktree, commands, receipts,
  and what other sessions still own. No commit unless the task explicitly asks.

## Do not

- Run two agents in one worktree, or write in a shared checkout others use.
- Touch, prune, or remove an external worktree or another session's worktree.
- Hand-merge generated files; take one side and regenerate.
- Run raw heavy suites or two heavy gates at once, or duplicate another worktree's run.
- Prune a dirty/unmerged worktree, force a failing file-size baseline, or commit without an explicit request.
