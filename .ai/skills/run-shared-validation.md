# Run shared validation

Run the right gate through the machine-wide queue, reuse a clean-tree receipt,
and escalate heavy or browser work to the cross-worktree lease. Canonical
contract: [local-validation-queue.md](../../docs/quality/local-validation-queue.md).

## When to use

- Before declaring a task done, or when a gate waits (`waiting for ...`), times
  out (`deadline reached`), or skips unexpectedly.
- Deciding between inner-loop checks, `verify:affected`, and a full gate; or
  before any Playwright, full vitest, workspace cargo, or desktop build.
- Not for CI runs (CI owns its own concurrency) or non-queueing audits.

## Required context

- [local-validation-queue.md](../../docs/quality/local-validation-queue.md) -
  classes, admission, receipts, bypasses, failure table.
- [validation-and-workflow.md](../../docs/agents/validation-and-workflow.md) -
  tier policy, heavy-lease rules, E2E; [validation-strategy.md](../../docs/quality/validation-strategy.md)
  - tier definitions behind `verify:plan` / `verify:affected`.
- `scripts/quality/validation-queue.mjs` and `scripts/quality/heavy-lease.mjs`; the `AGENTS.md` quiet block is always loaded.

## Steps

1. Start at the smallest gate: `pnpm verify:plan`, then `check:agent` /
   `check:rust` / `test:agent <path>`, then `verify:affected` (Tiers 0-4,
   default). A full gate needs a stated reason and exact-SHA evidence.
2. Run gate scripts by their normal names; they self-queue. Do not launch a
   `*:raw` variant to dodge a wait: raw runs skip admission and receipts.
3. `pnpm queue:status` shows holders and waiters; wait your turn, never kill a
   live lock. `reclaiming stale lock` is expected; `deadline reached` means
   re-run with a larger `VARVE_VALIDATION_QUEUE_TIMEOUT_MS` after the holder exits.
4. Check reuse: `pnpm queue:history` lists receipts. A passed receipt is reused
   only for the same command/class/repo/HEAD/tool versions on a clean tree
   within TTL (6 h); dirty trees always run, and `--no-cache` forces execution.
   Receipts are local evidence only: never CI, release, signing, or provenance.
5. Heavy work outside gate scripts (Playwright, full vitest, workspace cargo,
   desktop/WASM builds) takes the heavy lease; browser runs stay on it. Do not
   nest a heavy lease in a queue-exclusive run; prefer `--workers=1`.
6. Use bypasses (`CI`, nested `VARVE_VALIDATION_QUEUE_ACTIVE=1`,
   `VARVE_VALIDATION_QUEUE=0`, `VARVE_HEAVY_TASK_PARALLELISM=0`) deliberately
   for diagnosis only; bypassed runs write no receipts and are not evidence.
7. Report failures only, with the exact command and output line; never edit receipts or queue state.

## Exact commands

```bash
pnpm verify:plan
pnpm check:agent
pnpm check:rust
pnpm test:agent <spec path>              # no "--": pnpm forwards it, vitest drops it
pnpm verify:affected
pnpm verify:agent
pnpm queue:status
pnpm queue:history
VARVE_VALIDATION_QUEUE_TIMEOUT_MS=1800000 pnpm check:agent   # longer wait bound
node scripts/quality/heavy-lease.mjs "e2e: <what>" -- \
  npx playwright test <spec path> --project=chromium --workers=1 --reporter=list
```

## Definition of done

- The relevant tier passed on the intended tree; the reported evidence names the
  command and either a receipt hash or the live output.
- No bypass, no killed or corrupted foreign lock, and no `*:raw` substitution
  used to claim a pass; Playwright ran under the heavy lease.
- Any failure is reported with command and output; full-gate/CI claims rest on
  exact-SHA evidence only; report what ran, was reused, and remains unverified.

## Do not

- Run `pnpm test`, full Playwright, `cargo test --workspace`, `pnpm build`, or
  `just gate` by default; use `verify:plan` / `verify:affected`.
- Delete or steal a live lock or lease because it is slow; wait for the owner.
- Treat a local receipt as CI/release evidence; do not pass `--no-cache` on
  every run.
- Wrap a queued script in another queue, nest a heavy lease in a queue-exclusive
  run, or run raw Playwright unwrapped.
- Report success for a bypassed run.
