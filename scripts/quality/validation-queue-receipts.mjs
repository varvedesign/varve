#!/usr/bin/env node

/**
 * Receipt ledger for the local validation queue.
 *
 * A receipt is local cache/evidence, never CI evidence. It records exactly
 * what ran, where, at which HEAD, with which tool versions, and whether the
 * tree was clean. Reuse is deliberately narrow: only a passed receipt for a
 * CLEAN tree at the same HEAD, command, class, and tool identity may be
 * reused. Dirty-tree runs always execute and are stored as non-reusable
 * evidence, matching the push/full-gate receipt rule.
 *
 * Directory: $XDG_CACHE_HOME|~/.cache/varve/validation-queue/receipts/
 * TTL:       VARVE_VALIDATION_QUEUE_TTL_MS (default 6h)
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { sha256, toolVersions } from './validation-policy.mjs';
import { QUEUE_SCHEMA, QUEUE_VERSION, queueCacheDirectory } from './validation-queue-state.mjs';

const RECEIPT_SCHEMA = 1;
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
}

export function repoState({ cwd = process.cwd() } = {}) {
  try {
    const commonDir = resolve(cwd, git(cwd, ['rev-parse', '--git-common-dir']).trim());
    const head = git(cwd, ['rev-parse', 'HEAD']).trim();
    const status = git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=normal']);
    return {
      commonDir,
      head,
      clean: status.length === 0,
      dirtyHash: status.length ? sha256(status) : null,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message.split('\n')[0] : 'not a git checkout' };
  }
}

export function receiptDirectory() {
  return join(queueCacheDirectory(), 'receipts');
}

function receiptPath(identityHash) {
  return join(receiptDirectory(), `${identityHash}.json`);
}

export function ttlMs() {
  const override = Number(process.env.VARVE_VALIDATION_QUEUE_TTL_MS);
  return Number.isSafeInteger(override) && override > 0 ? override : DEFAULT_TTL_MS;
}

/**
 * Identity is the admission cache key. Tool versions are part of it so an
 * upgraded compiler or test runner invalidates older passes; the repository
 * identity binds the receipt to one checkout family (all worktrees share the
 * common git directory, but a different repo never matches).
 */
export function receiptIdentity({ label, kind, argv, cwd = process.cwd(), repo }) {
  const identity = {
    receiptSchema: RECEIPT_SCHEMA,
    queueSchema: QUEUE_SCHEMA,
    queueVersion: QUEUE_VERSION,
    class: kind,
    label,
    command: Array.isArray(argv) ? [...argv] : [String(argv)],
    cwd,
    repo: repo?.error ? { error: repo.error } : { commonDir: repo.commonDir, head: repo.head },
    tools: toolVersions({ root: cwd }),
    platform: process.platform,
    arch: process.arch,
  };
  return { ...identity, identityHash: sha256(stable(identity)) };
}

export function lookupReceipt(identity, { repo, ttl = ttlMs(), now = Date.now() } = {}) {
  if (!repo || repo.error) return { reusable: false, reason: 'not-a-git-checkout' };
  if (!repo.clean) return { reusable: false, reason: 'dirty-tree' };
  const path = receiptPath(identity.identityHash);
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { reusable: false, reason: 'missing', path };
  }
  if (receipt?.schema !== RECEIPT_SCHEMA || receipt?.identityHash !== identity.identityHash) {
    return { reusable: false, reason: 'schema-mismatch', path };
  }
  if (receipt.outcome !== 'passed' || receipt.clean !== true) {
    return { reusable: false, reason: 'not-a-reusable-pass', path };
  }
  const finished = Date.parse(receipt.finishedAt ?? '');
  if (!Number.isFinite(finished) || now < finished || now - finished > ttl) {
    return { reusable: false, reason: 'expired', path };
  }
  return { reusable: true, receipt, path };
}

export function writeReceipt({
  identity,
  label,
  kind,
  repo,
  status,
  exitCode,
  durationMs,
  startedAt,
  finishedAt,
}) {
  mkdirSync(receiptDirectory(), { recursive: true });
  const receipt = {
    schema: RECEIPT_SCHEMA,
    queueVersion: QUEUE_VERSION,
    identityHash: identity.identityHash,
    label,
    class: kind,
    command: identity.command,
    cwd: identity.cwd,
    repo: repo?.error ? { error: repo.error } : { commonDir: repo.commonDir, head: repo.head },
    clean: repo?.clean === true,
    dirtyHash: repo?.dirtyHash ?? null,
    outcome: status === 0 ? 'passed' : 'failed',
    exitCode,
    durationMs,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    tools: identity.tools,
  };
  const path = receiptPath(identity.identityHash);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(receipt, null, 2));
  renameSync(temporary, path);
  return path;
}

export function listReceipts({ limit = 20 } = {}) {
  if (!existsSync(receiptDirectory())) return [];
  return readdirSync(receiptDirectory())
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const path = join(receiptDirectory(), name);
      try {
        const receipt = JSON.parse(readFileSync(path, 'utf8'));
        return { path, receipt, mtime: statSync(path).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
}

export function findReceipt(prefix) {
  const matches = listReceipts({ limit: 10000 }).filter((entry) =>
    entry.receipt.identityHash?.startsWith(prefix),
  );
  return matches.length ? matches[0] : null;
}

export function pruneReceipts({ days = 14, now = Date.now() } = {}) {
  if (!existsSync(receiptDirectory())) return { removed: 0, kept: 0 };
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  let removed = 0;
  let kept = 0;
  for (const name of readdirSync(receiptDirectory())) {
    if (!name.endsWith('.json')) continue;
    const path = join(receiptDirectory(), name);
    try {
      if (statSync(path).mtimeMs < cutoff) {
        unlinkSync(path);
        removed += 1;
      } else {
        kept += 1;
      }
    } catch {
      // A concurrently pruned receipt is not an error.
    }
  }
  return { removed, kept };
}

export function formatReceiptLine(entry) {
  const receipt = entry.receipt;
  const hash = String(receipt.identityHash ?? '').slice(0, 12);
  const clean = receipt.clean === true ? 'clean' : 'dirty';
  const duration =
    typeof receipt.durationMs === 'number' ? `${(receipt.durationMs / 1000).toFixed(1)}s` : '?';
  return [
    hash,
    receipt.finishedAt ?? '',
    receipt.outcome ?? 'unknown',
    receipt.class ?? '?',
    duration,
    `${clean}@${String(receipt.repo?.head ?? '').slice(0, 7) || '?'}`,
    String(receipt.label ?? '').slice(0, 40),
  ].join('  ');
}
