#!/usr/bin/env node

/**
 * Advisory path-claim ledger CLI.
 *
 * A claim records intent ("this session is editing these repo paths"). It is
 * never a lock: claim and check always exit 0 on overlap, and nothing in the
 * commit or validation path reads this state. See
 * docs/quality/path-claims.md for the contract.
 */

import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  ClaimError,
  claimState,
  claimsDirectory,
  createClaim,
  formatAge,
  normalizeRepoPaths,
  overlappingClaims,
  pruneClaims,
  readClaims,
  releaseClaim,
  releaseTask,
  repoContext,
} from './path-claims-state.mjs';

const USAGE = `path-claims — advisory path reservations (never gates commits or validation)

Usage:
  path-claims claim --task <label> --path <repo-path> [--path ...]
      [--note <text>] [--ttl-minutes <n>] [--json]
  path-claims list|status [--all] [--repo] [--json]
  path-claims check --path <repo-path> [--path ...] [--json]
  path-claims release <claim-id> | --task <label> [--json]
  path-claims prune [--repo] [--json]

Advisory contract:
  claim/check never block or fail on overlap. Exit 0 means "recorded" or
  "checked", not "this path is exclusively yours". Claims expire after
  4 hours by default; use --ttl-minutes to change one claim.

State:
  $VARVE_PATH_CLAIMS_DIR, else $XDG_RUNTIME_DIR/varve-path-claims,
  else /tmp/varve-path-claims.
`;

function usage(exitCode) {
  const output = exitCode === 0 ? console.log : console.error;
  output(USAGE);
  process.exit(exitCode);
}

function pathsOf(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function printClaim(record, state, now) {
  console.log(
    `${record.id}  ${state}  task="${record.task}"  pid=${record.pid}  ` +
      `age=${formatAge(record.createdAt, now)}  paths=${record.paths.length}`,
  );
  for (const path of record.paths) console.log(`  ${path}`);
}

function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: true,
    options: {
      task: { type: 'string' },
      path: { type: 'string', multiple: true },
      note: { type: 'string' },
      'ttl-minutes': { type: 'string' },
      json: { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
      repo: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help) usage(0);
  const command = positionals[0];
  if (!command) usage(2);
  const directory = claimsDirectory();
  const now = Date.now();

  if (command === 'claim') {
    if (!values.task) throw new ClaimError('INVALID_TASK', '--task must be a non-empty label');
    const repo = repoContext();
    const paths = normalizeRepoPaths(repo.root, pathsOf(values.path));
    // Re-claiming the same task refreshes intent instead of accumulating records.
    const replaced = releaseTask(directory, values.task, { repoCommonDir: repo.common });
    const { claims } = readClaims(directory);
    const overlaps = overlappingClaims(claims, paths, { repoCommonDir: repo.common, now });
    const { record } = createClaim({
      directory,
      repo,
      task: values.task,
      paths: paths.map((path) => join(repo.root, path)),
      note: values.note,
      ttlMinutes: values['ttl-minutes'],
      cwd: repo.root,
      now,
    });
    if (values.json) {
      console.log(JSON.stringify({ advisory: true, claim: record, replaced, overlaps }, null, 2));
      return;
    }
    if (replaced.length > 0) {
      console.log(`replaced ${replaced.length} earlier claim(s) for task="${record.task}"`);
    }
    console.log(
      `claim ${record.id}  task="${record.task}"  expires=${new Date(record.expiresAt).toISOString()}`,
    );
    if (overlaps.length > 0) {
      console.log(`advisory: ${overlaps.length} active claim(s) overlap; nothing was blocked`);
      for (const overlap of overlaps) {
        console.log(
          `  ${overlap.id}  task="${overlap.task}"  pid=${overlap.pid}  age=${formatAge(overlap.createdAt, now)}`,
        );
        for (const path of overlap.paths) console.log(`    ${path}`);
      }
    }
    return;
  }

  if (command === 'list' || command === 'status') {
    const { claims, invalid } = readClaims(directory);
    let filtered = claims;
    if (values.repo) {
      const repo = repoContext();
      filtered = filtered.filter((record) => record.repoCommonDir === repo.common);
    }
    if (!values.all) {
      filtered = filtered.filter((record) => claimState(record, now) === 'active');
    }
    if (values.json) {
      console.log(
        JSON.stringify(
          {
            advisory: true,
            claims: filtered.map((record) => ({ ...record, state: claimState(record, now) })),
            invalid,
          },
          null,
          2,
        ),
      );
      return;
    }
    if (filtered.length === 0) {
      console.log('no matching claims');
    } else {
      for (const record of filtered) printClaim(record, claimState(record, now), now);
    }
    if (invalid.length > 0) {
      console.log(
        `warning: ${invalid.length} unreadable claim file(s) ignored (prune does not remove them)`,
      );
    }
    return;
  }

  if (command === 'check') {
    const repo = repoContext();
    const paths = normalizeRepoPaths(repo.root, pathsOf(values.path));
    const { claims } = readClaims(directory);
    const overlaps = overlappingClaims(claims, paths, { repoCommonDir: repo.common, now });
    if (values.json) {
      console.log(JSON.stringify({ advisory: true, paths, overlaps }, null, 2));
      return;
    }
    if (overlaps.length === 0) {
      console.log(`no active claims overlap ${paths.length} path(s)`);
      return;
    }
    console.log(`advisory: ${overlaps.length} active claim(s) overlap; nothing is blocked`);
    for (const overlap of overlaps) printClaim(overlap, 'active', now);
    return;
  }

  if (command === 'release') {
    const repo = repoContext();
    if (values.task) {
      const released = releaseTask(directory, values.task, { repoCommonDir: repo.common });
      if (values.json) {
        console.log(JSON.stringify({ released }, null, 2));
        return;
      }
      console.log(
        released.length === 0
          ? `no claims for task="${values.task}" in this repository`
          : `released ${released.length} claim(s) for task="${values.task}"`,
      );
      return;
    }
    const id = positionals[1];
    if (!id) {
      throw new ClaimError('USAGE', 'release requires a claim id or --task');
    }
    const record = releaseClaim(directory, id, { repoCommonDir: repo.common });
    if (!record) {
      throw new ClaimError('NOT_FOUND', `claim not found: ${id}`);
    }
    if (values.json) {
      console.log(JSON.stringify({ released: [record] }, null, 2));
      return;
    }
    console.log(`released ${record.id}`);
    return;
  }

  if (command === 'prune') {
    const repo = values.repo ? repoContext() : null;
    const { removed, kept } = pruneClaims(
      directory,
      now,
      repo ? { repoCommonDir: repo.common } : {},
    );
    if (values.json) {
      console.log(
        JSON.stringify(
          {
            removed: removed.map(({ record, state }) => ({
              id: record.id,
              task: record.task,
              state,
            })),
            kept: kept.length,
          },
          null,
          2,
        ),
      );
      return;
    }
    console.log(`pruned ${removed.length} expired claim(s); kept ${kept.length} active claim(s)`);
    return;
  }

  usage(2);
}

try {
  main();
} catch (error) {
  if (error instanceof ClaimError) {
    console.error(`path-claims: ${error.message}`);
    process.exit(error.code === 'NOT_OWNER' ? 3 : error.code === 'NOT_FOUND' ? 1 : 2);
  }
  console.error(`path-claims: ${error.message}`);
  process.exit(1);
}
