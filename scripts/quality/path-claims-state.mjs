#!/usr/bin/env node

/**
 * Advisory path-claim ledger state.
 *
 * Concurrent sessions share one workstation and one repository family. Worktree
 * isolation prevents most collisions, but it does not make intent visible. This
 * module records repo-relative path claims so a second session can see that
 * another session is working in the same area before it starts.
 *
 * This is deliberately NOT a lock:
 *   - a claim never blocks, fails, or delays any command;
 *   - nothing in the validation or commit path reads this ledger;
 *   - stale/expired/corrupt records are tolerated and pruned;
 *   - claims are scoped by the repository common git directory.
 *
 * The real controls remain worktree-per-task, single-writer generated surfaces,
 * and the sequential merge protocol. The ledger only makes overlap visible.
 *
 * Runtime:  $XDG_RUNTIME_DIR|/tmp/varve-path-claims/
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

export const CLAIM_SCHEMA = 1;
export const DEFAULT_TTL_MINUTES = 240;
export const CLAIM_PREFIX = 'claim-';

export class ClaimError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ClaimError';
    this.code = code;
  }
}

export function claimsDirectory(env = process.env) {
  if (env.VARVE_PATH_CLAIMS_DIR) return resolve(env.VARVE_PATH_CLAIMS_DIR);
  const base = env.XDG_RUNTIME_DIR || tmpdir();
  return join(base, 'varve-path-claims');
}

function git(cwd, ...args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new ClaimError('NOT_A_REPO', `not a git repository: ${cwd}`);
  }
}

function canonicalExisting(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** Resolve the repository root and common git directory for a working tree. */
export function repoContext(cwd = process.cwd()) {
  const root = canonicalExisting(git(cwd, 'rev-parse', '--show-toplevel'));
  const common = canonicalExisting(resolve(cwd, git(cwd, 'rev-parse', '--git-common-dir')));
  return { root, common };
}

function normalizeOne(root, cwd, value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new ClaimError('INVALID_PATH', 'claim paths must be non-empty strings without NUL');
  }
  const absolute = isAbsolute(value) ? resolve(value) : resolve(cwd, value);
  const rel = relative(root, absolute);
  const normalized = rel
    .split(/[\\/]+/)
    .filter(Boolean)
    .join('/');
  if (
    normalized.length === 0 ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    isAbsolute(rel)
  ) {
    throw new ClaimError(
      'INVALID_PATH',
      `path is outside the repository or is the repository root: ${value}`,
    );
  }
  return normalized;
}

/** Normalize inputs to sorted, de-duplicated, repo-relative POSIX paths. */
export function normalizeRepoPaths(root, inputs, cwd = process.cwd()) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new ClaimError('INVALID_PATH', 'at least one --path is required');
  }
  const paths = inputs.map((value) => normalizeOne(root, cwd, value));
  return [...new Set(paths)].sort();
}

/** True when one repo-relative path is the other or one is an ancestor. */
export function pathOverlap(a, b) {
  if (a === b) return true;
  const left = a.split('/');
  const right = b.split('/');
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function readIdentity(pid) {
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const closing = stat.lastIndexOf(')');
      if (closing < 0) return null;
      const fields = stat.slice(closing + 2).split(' ');
      // After comm/state, starttime is field 22 overall -> index 19 here.
      return fields[19] ? `linux:${fields[19]}` : null;
    }
    const output = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return output ? `ps:${output}` : null;
  } catch {
    return null;
  }
}

/** Liveness plus a PID-reuse guard. Identity may be null when unreadable. */
export function processInfo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return { alive: false, identity: null };
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code !== 'EPERM') return { alive: false, identity: null };
  }
  return { alive: true, identity: readIdentity(pid) };
}

export function currentIdentity() {
  return processInfo(process.pid).identity;
}

/** A claim is a task lease: TTL is authoritative, not the creating process. */
export function claimState(record, now = Date.now()) {
  return now >= record.expiresAt ? 'expired' : 'active';
}

/** Diagnostic only. The creating CLI normally exits immediately. */
export function ownerStatus(record) {
  const info = processInfo(record.pid);
  return {
    alive: info.alive,
    identityMatches: !record.identity || !info.identity || record.identity === info.identity,
  };
}

function validRecord(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    value.schema === CLAIM_SCHEMA &&
    typeof value.id === 'string' &&
    Number.isInteger(value.pid) &&
    typeof value.repoCommonDir === 'string' &&
    Array.isArray(value.paths) &&
    value.paths.every((path) => typeof path === 'string') &&
    typeof value.task === 'string' &&
    Number.isFinite(value.createdAt) &&
    Number.isFinite(value.expiresAt)
  );
}

/** Read every parseable claim; corrupt files are reported, never fatal. */
export function readClaims(directory = claimsDirectory()) {
  if (!existsSync(directory)) return { claims: [], invalid: [] };
  const claims = [];
  const invalid = [];
  for (const name of readdirSync(directory).sort()) {
    if (!name.startsWith(CLAIM_PREFIX) || !name.endsWith('.json')) continue;
    const file = join(directory, name);
    try {
      const record = JSON.parse(readFileSync(file, 'utf8'));
      if (!validRecord(record)) {
        invalid.push({ file, reason: 'invalid claim record' });
        continue;
      }
      claims.push(record);
    } catch (error) {
      invalid.push({ file, reason: error.message });
    }
  }
  claims.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return { claims, invalid };
}

function ttlFromMinutes(value) {
  if (value === undefined) return DEFAULT_TTL_MINUTES;
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new ClaimError('INVALID_TTL', '--ttl-minutes must be a positive number');
  }
  return minutes;
}

export function createClaim({
  directory = claimsDirectory(),
  repo,
  task,
  paths,
  note,
  ttlMinutes,
  now = Date.now(),
  pid = process.pid,
  identity = currentIdentity(),
  cwd = process.cwd(),
}) {
  if (typeof task !== 'string' || task.trim().length === 0) {
    throw new ClaimError('INVALID_TASK', '--task must be a non-empty label');
  }
  const ttl = ttlFromMinutes(ttlMinutes);
  const normalized = normalizeRepoPaths(repo.root, paths, cwd);
  const record = {
    schema: CLAIM_SCHEMA,
    id: randomUUID(),
    pid,
    identity,
    host: hostname(),
    repoRoot: repo.root,
    repoCommonDir: repo.common,
    worktree: repo.root,
    task: task.trim(),
    note: typeof note === 'string' ? note : null,
    session:
      process.env.TERM_SESSION_ID ||
      process.env.TMUX_PANE ||
      process.env.SSH_TTY ||
      process.env.TTY ||
      null,
    paths: normalized,
    createdAt: now,
    expiresAt: now + ttl * 60_000,
  };
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${CLAIM_PREFIX}${record.id}.json`);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  return { record, file };
}

function findClaimFile(directory, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const file = join(directory, `${CLAIM_PREFIX}${id}.json`);
  return existsSync(file) ? file : null;
}

/** Release one claim in this repository. Advisory claims are not locks. */
export function releaseClaim(directory, id, { repoCommonDir }) {
  const file = findClaimFile(directory, id);
  if (!file) return null;
  const record = JSON.parse(readFileSync(file, 'utf8'));
  if (record.repoCommonDir !== repoCommonDir) {
    throw new ClaimError('NOT_OWNER', `claim ${id} belongs to another repository`);
  }
  unlinkSync(file);
  return record;
}

/** Release every claim with this exact task label in this repository. */
export function releaseTask(directory, task, { repoCommonDir }) {
  const { claims } = readClaims(directory);
  const released = [];
  for (const record of claims) {
    if (record.task !== task || record.repoCommonDir !== repoCommonDir) continue;
    const file = findClaimFile(directory, record.id);
    if (file) {
      unlinkSync(file);
      released.push(record);
    }
  }
  return released;
}

/** Remove expired and dead-owner claims. Invalid records are left untouched. */
export function pruneClaims(directory, now = Date.now(), { repoCommonDir = null } = {}) {
  const { claims } = readClaims(directory);
  const removed = [];
  const kept = [];
  for (const record of claims) {
    if (repoCommonDir !== null && record.repoCommonDir !== repoCommonDir) {
      kept.push(record);
      continue;
    }
    const state = claimState(record, now);
    if (state === 'active') {
      kept.push(record);
      continue;
    }
    const file = findClaimFile(directory, record.id);
    if (file) {
      unlinkSync(file);
      removed.push({ record, state });
    }
  }
  return { removed, kept };
}

/** Active claims in the same repository that overlap any of `paths`. */
export function overlappingClaims(
  claims,
  paths,
  { repoCommonDir, now = Date.now(), excludePid = null } = {},
) {
  return claims.filter((record) => {
    if (record.repoCommonDir !== repoCommonDir) return false;
    if (excludePid !== null && record.pid === excludePid) return false;
    if (claimState(record, now) !== 'active') return false;
    return record.paths.some((claimed) => paths.some((path) => pathOverlap(claimed, path)));
  });
}

export function formatAge(timestamp, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
