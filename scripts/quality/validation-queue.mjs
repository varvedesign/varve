#!/usr/bin/env node

/**
 * Shared local validation queue — one machine, many agents, one admission
 * point and one receipt ledger.
 *
 * Why this exists: several agents can share one workstation. Each running
 * its own typecheck/cargo/test gate independently saturates the CPU, causes
 * OS-memory pressure and OOM kills, and re-does identical work. The proven
 * durable primitives already in this repo are the cross-worktree heavy-task
 * lease (admission + memory floor) and the local receipt caches (pinned
 * identity, clean-tree-only reuse). This CLI joins them for every gate run:
 *
 *   node scripts/quality/validation-queue.mjs run --label "check:rust" \
 *     --class exclusive -- pnpm run --silent check:rust:raw
 *
 * Classes: exclusive — one at a time machine-wide (cargo, full vitest,
 * builds); shared — up to VARVE_VALIDATION_QUEUE_SHARED_SLOTS concurrent
 * (tsc, audits, focused specs). Browser/Playwright runs remain governed by
 * the existing heavy-task lease: it owns the memory floor and the browser
 * crash evidence, and queue-exclusive runs must not double-wrap it.
 *
 * A dedicated runner/daemon was rejected as the durable form: it adds a
 * high-availability, credential and remote-command-execution surface, and it
 * fails exactly when the runner is the process that needs the CPU. Files and
 * receipts under the machine's runtime/cache directories are the durable unit.
 *
 * Receipts are local cache/evidence only, never CI evidence. Reuse requires a
 * clean tree, same HEAD, same command/class, same tool versions, and a passed
 * receipt younger than the TTL (default 6h). Dirty trees always run.
 *
 * Bypass: CI environment, nested queue invocations (VARVE_VALIDATION_QUEUE_ACTIVE),
 * VARVE_VALIDATION_QUEUE=0, or VARVE_HEAVY_TASK_PARALLELISM=0.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runValidationCommand } from './heavy-lease.mjs';
import {
  findReceipt,
  formatReceiptLine,
  listReceipts,
  lookupReceipt,
  pruneReceipts,
  receiptIdentity,
  repoState,
  ttlMs,
  writeReceipt,
} from './validation-queue-receipts.mjs';
import {
  ACTIVE_ENV,
  acquire,
  admissionTimeoutMs,
  formatAge,
  queueStatus,
  registerWaiter,
  release,
  unregisterWaiter,
  waitForMemoryHeadroom,
} from './validation-queue-state.mjs';

const USAGE = `validation-queue — machine-wide admission + receipts for local agent gates

Usage:
  validation-queue.mjs run --label <label> [--class exclusive|shared]
      [--no-cache] [--timeout-ms <n>] [--ttl-hours <n>] -- <command...>
  validation-queue.mjs status [--json]
  validation-queue.mjs history [--limit <n>] [--json]
  validation-queue.mjs show <receipt-hash-prefix>
  validation-queue.mjs prune [--days <n>]

Classes:
  exclusive  One machine-wide slot; waits for memory headroom. Use for cargo,
             full vitest, builds. Do not wrap Playwright: use heavy-lease.
  shared     Up to VARVE_VALIDATION_QUEUE_SHARED_SLOTS concurrent. Use for
             tsc, audits, and focused specs.

Environment:
  VARVE_VALIDATION_QUEUE_RUNTIME_DIR   lock/waiters directory
  VARVE_VALIDATION_QUEUE_CACHE_DIR     receipt directory
  VARVE_VALIDATION_QUEUE_TIMEOUT_MS    admission deadline (default 45 min)
  VARVE_VALIDATION_QUEUE_SHARED_SLOTS  light-lane concurrency
  VARVE_VALIDATION_QUEUE_TTL_MS        receipt reuse TTL (default 6h)
  VARVE_LEASE_MIN_MEM_MB               exclusive-lane memory floor (1536)
  VARVE_VALIDATION_QUEUE=0             bypass admission for this invocation
`;

const VALUE_FLAGS = new Set([
  '--label',
  '--class',
  '--timeout-ms',
  '--ttl-hours',
  '--limit',
  '--days',
]);

function parseOptions(argv) {
  const separator = argv.indexOf('--');
  const optionArgs = separator === -1 ? argv : argv.slice(0, separator);
  const command = separator === -1 ? [] : argv.slice(separator + 1);
  const options = { command };
  for (let i = 0; i < optionArgs.length; i += 1) {
    const arg = optionArgs[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--no-cache') options.noCache = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const flag = eq === -1 ? arg : arg.slice(0, eq);
      if (!VALUE_FLAGS.has(flag)) throw new Error(`unknown option ${flag}`);
      let value = arg.slice(eq + 1);
      if (eq === -1) {
        i += 1;
        value = optionArgs[i];
      }
      if (value === undefined) throw new Error(`missing value for ${flag}`);
      if (flag === '--label') options.label = value;
      else if (flag === '--class') options.class = value;
      else if (flag === '--timeout-ms') options.timeoutMs = Number(value);
      else if (flag === '--ttl-hours') options.ttlMs = Number(value) * 60 * 60 * 1000;
      else if (flag === '--limit') options.limit = Number(value);
      else if (flag === '--days') options.days = Number(value);
    } else throw new Error(`unexpected argument ${arg}`);
  }
  return options;
}

function bypassReason() {
  if (process.env[ACTIVE_ENV] === '1') return 'nested queue invocation';
  const ci = process.env.CI;
  if (ci && ci !== '0' && ci.toLowerCase() !== 'false') return `CI=${ci}`;
  if (process.env.VARVE_VALIDATION_QUEUE === '0') return 'VARVE_VALIDATION_QUEUE=0';
  if (process.env.VARVE_HEAVY_TASK_PARALLELISM === '0') return 'VARVE_HEAVY_TASK_PARALLELISM=0';
  return null;
}

function describeWait(record) {
  const started = record.startedAt ? formatAge(record.startedAt) : '?';
  return `${record.label ?? 'unknown'} (${record.class ?? '?'}, pid ${record.pid ?? '?'}, running ${started})`;
}

async function runDirect(command, reason) {
  console.log(`validation-queue: bypassed (${reason}); running without admission or receipt`);
  const result = await runValidationCommand(command, {
    env: { ...process.env, [ACTIVE_ENV]: '1' },
  });
  return result.status ?? 1;
}

async function commandRun(argv) {
  const options = parseOptions(argv);
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (!options.command.length) {
    console.error('validation-queue: missing command after --');
    console.error(USAGE);
    return 2;
  }
  const kind = options.class ?? 'shared';
  if (kind !== 'shared' && kind !== 'exclusive') {
    console.error(
      `validation-queue: --class must be exclusive or shared, got ${JSON.stringify(kind)}`,
    );
    return 2;
  }
  const label = options.label ?? options.command.join(' ').slice(0, 100);
  if (!label) {
    console.error('validation-queue: --label must not be empty');
    return 2;
  }
  const bypass = bypassReason();
  if (bypass) return runDirect(options.command, bypass);
  const cwd = process.cwd();
  const repo = repoState({ cwd });
  if (repo.error)
    console.warn(`validation-queue: not a git checkout (${repo.error}); running without receipts`);
  // Non-git directories cannot produce a meaningful receipt identity, and
  // computing tool versions costs subprocesses: skip it there.
  const identity = repo.error
    ? null
    : receiptIdentity({ label, kind, argv: options.command, cwd, repo });
  if (identity && !options.noCache) {
    const cached = lookupReceipt(identity, { repo, ttl: options.ttlMs ?? ttlMs() });
    if (cached.reusable) {
      const head = String(cached.receipt.repo?.head ?? '').slice(0, 7);
      const duration = Math.round((cached.receipt.durationMs ?? 0) / 1000);
      console.log(
        `validation-queue: REUSED passed receipt ${identity.identityHash.slice(0, 12)} for "${label}" (${duration}s, clean tree at ${head}) — command not executed (use --no-cache to force)`,
      );
      return 0;
    }
    if (cached.reason === 'dirty-tree')
      console.log(
        'validation-queue: working tree is dirty; running fresh (dirty receipts are never reused)',
      );
  }
  if (kind === 'exclusive')
    await waitForMemoryHeadroom({
      label,
      onWait: () => console.log(`validation-queue: waiting for memory headroom before ${label}`),
    });
  const waiter = registerWaiter({ label, kind, cwd });
  let admission;
  try {
    admission = await acquire({
      kind,
      label,
      cwd,
      timeoutMs:
        Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0
          ? options.timeoutMs
          : admissionTimeoutMs(),
      onWait: (holder) => console.log(`validation-queue: waiting for ${describeWait(holder)}`),
    });
  } catch (error) {
    unregisterWaiter(waiter);
    console.error(error.message);
    return error.exitCode ?? 1;
  }
  // The holder is no longer waiting; keeping the waiter entry would make
  // `queue:status` report the running gate as both holder and waiter.
  unregisterWaiter(waiter);
  const startedAt = Date.now();
  let status = 1;
  try {
    console.log(`validation-queue: running ${label} (${kind}) — admission acquired`);
    const result = await runValidationCommand(options.command, {
      env: { ...process.env, [ACTIVE_ENV]: '1' },
    });
    status = result.status ?? 1;
    if (result.remaining?.length || result.cleanupUnknown)
      console.error(
        'validation-queue: command cleanup incomplete; inspect the queued run before retrying',
      );
  } finally {
    release(admission);
  }
  const finishedAt = Date.now();
  if (identity) {
    try {
      const path = writeReceipt({
        identity,
        label,
        kind,
        repo,
        status,
        exitCode: status,
        durationMs: finishedAt - startedAt,
        startedAt,
        finishedAt,
      });
      console.log(
        `validation-queue: ${status === 0 ? 'passed' : 'failed'} in ${((finishedAt - startedAt) / 1000).toFixed(1)}s — receipt ${path}`,
      );
    } catch (error) {
      console.warn(
        `validation-queue: receipt write failed (${error.message}); command result still applies`,
      );
    }
  }
  return status;
}

async function commandStatus(argv) {
  const options = parseOptions(argv);
  const status = queueStatus();
  if (options.json) {
    console.log(JSON.stringify(status, null, 2));
    return 0;
  }
  const exclusive = status.holders.find((holder) => holder.class === 'exclusive');
  console.log(
    `validation-queue: exclusive ${exclusive ? 'busy' : 'free'}; shared ${status.sharedBusy}/${status.sharedSlots} slots busy; ${status.waiters.length} waiting`,
  );
  console.log(`  runtime ${status.runtimeDirectory}`);
  console.log(`  cache   ${status.cacheDirectory}`);
  for (const holder of status.holders) {
    console.log(
      `  RUNNING ${holder.class.padEnd(9)} pid ${String(holder.pid).padEnd(7)} ${formatAge(holder.startedAt).padStart(6)}  ${holder.label}`,
    );
  }
  for (const waiter of status.waiters) {
    console.log(
      `  WAITING ${String(waiter.class).padEnd(9)} pid ${String(waiter.pid).padEnd(7)} ${formatAge(waiter.startedAt).padStart(6)}  ${waiter.label}`,
    );
  }
  return 0;
}

async function commandHistory(argv) {
  const options = parseOptions(argv);
  const entries = listReceipts({
    limit: Number.isSafeInteger(options.limit) && options.limit > 0 ? options.limit : 20,
  });
  if (options.json) {
    console.log(
      JSON.stringify(
        entries.map((entry) => entry.receipt),
        null,
        2,
      ),
    );
    return 0;
  }
  if (!entries.length) {
    console.log('validation-queue: no receipts yet');
    return 0;
  }
  console.log('validation-queue receipts (newest first):');
  console.log(
    '  hash          finished              outcome  class      duration  tree          label',
  );
  for (const entry of entries) console.log(`  ${formatReceiptLine(entry)}`);
  return 0;
}

async function commandShow(argv) {
  const prefix = argv.find((arg) => !arg.startsWith('-') && arg !== '--');
  if (!prefix) {
    console.error('validation-queue: show requires a receipt hash prefix');
    return 2;
  }
  const entry = findReceipt(prefix);
  if (!entry) {
    console.error(`validation-queue: no receipt matching ${JSON.stringify(prefix)}`);
    return 1;
  }
  console.log(JSON.stringify(entry.receipt, null, 2));
  return 0;
}

async function commandPrune(argv) {
  const options = parseOptions(argv);
  const result = pruneReceipts({
    days: Number.isSafeInteger(options.days) && options.days >= 0 ? options.days : 14,
  });
  console.log(`validation-queue: pruned ${result.removed} receipt(s); kept ${result.kept}`);
  return 0;
}

async function main() {
  const [subcommand, ...rest] = process.argv.slice(2);
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    console.log(USAGE);
    return;
  }
  const handlers = {
    run: commandRun,
    status: commandStatus,
    history: commandHistory,
    show: commandShow,
    prune: commandPrune,
  };
  const handler = handlers[subcommand];
  if (!handler) {
    console.error(`validation-queue: unknown subcommand ${JSON.stringify(subcommand)}`);
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  try {
    process.exitCode = await handler(rest);
  } catch (error) {
    console.error(`validation-queue: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = error?.exitCode ?? 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
