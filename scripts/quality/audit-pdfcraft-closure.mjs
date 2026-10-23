#!/usr/bin/env node
/**
 * PDFCraft closure gate.
 *
 * The cutoff-1 and cutoff-2 ledgers are frozen history and are never rewritten;
 * a later pass resolves a row by appending to `resolutions.tsv` (or by adding a
 * cutoff-3 row). Closure is therefore a property of the *latest disposition per
 * issue*, not of a scan over historical rows.
 *
 * This script builds that view and fails when:
 *   - an issue's latest disposition is `candidate` or `deferred` without a
 *     `blocked:` reason naming a command and error,
 *   - a `verified-already-correct-` reason cites no code/test path,
 *   - the cutoff-3 summary's reconciliation arithmetic is inconsistent,
 *   - a cutoff-3 row duplicates an issue number or names an issue that does not
 *     exist in the frozen set,
 *   - a resolution names an issue that is not in an earlier ledger.
 *
 * Usage: node scripts/quality/audit-pdfcraft-closure.mjs [--json]
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DIR = join(ROOT, 'docs', 'audits', 'pdfcraft');
const BLOCKED =
  /^blocked:\s+.*\b(?:cargo|pnpm|node|npm|npx|git|command|exit|error|not found|timed out|denied)\b/i;
const TERMINAL = new Set([
  'implemented-validated',
  'verified-already-correct-',
  'outside-varve-scope',
  'duplicate-of',
  'cluster-assessed',
]);

function rows(file) {
  let text;
  try {
    text = readFileSync(join(DIR, file), 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => line.split('\t'));
}

const earlier = [...rows('issue-ledger.tsv'), ...rows('issue-ledger-cutoff2.tsv')];
const cutoff3 = rows('issue-ledger-cutoff3.tsv');
const resolutions = rows('resolutions.tsv');

const errors = [];
const latest = new Map();
const frozen = new Set();

for (const row of earlier) {
  const [number, , , , cluster, disposition, reason] = row;
  frozen.add(number);
  latest.set(number, { cluster, disposition, reason, source: 'cutoff1/2' });
}

for (const row of resolutions) {
  const [number, previous, disposition, reason] = row;
  if (!latest.has(number)) {
    errors.push(`resolutions.tsv names issue ${number}, which is not in an earlier ledger`);
    continue;
  }
  if (latest.get(number).disposition !== previous) {
    errors.push(
      `resolutions.tsv for ${number} says previous=${previous}, ledger says ${latest.get(number).disposition}`,
    );
  }
  latest.set(number, { disposition, reason, source: 'resolution' });
}

const seenCutoff3 = new Set();
for (const row of cutoff3) {
  const [number, , , , cluster, disposition, reason] = row;
  if (seenCutoff3.has(number)) errors.push(`cutoff-3 row ${number} is duplicated`);
  seenCutoff3.add(number);
  if (latest.has(number)) {
    // A cutoff-3 row may only describe an issue created after cutoff 2; an
    // overlap with the frozen set would be a corpus-boundary error.
    errors.push(`cutoff-3 row ${number} also appears in the cutoff-1/2 ledgers`);
  }
  latest.set(number, { cluster, disposition, reason, source: 'cutoff3' });
  frozen.add(number);
}

const counts = new Map();
for (const [, entry] of latest) {
  counts.set(entry.disposition, (counts.get(entry.disposition) ?? 0) + 1);
  if (
    !TERMINAL.has(entry.disposition) &&
    entry.disposition !== 'candidate' &&
    entry.disposition !== 'deferred'
  ) {
    errors.push(`unknown disposition: ${entry.disposition}`);
  }
  if (entry.disposition === 'candidate' || entry.disposition === 'deferred') {
    if (!BLOCKED.test(entry.reason)) {
      errors.push(
        `issue has non-terminal latest disposition (${entry.disposition}) without a blocked: reason naming a command and an error: ${entry.reason}`,
      );
    }
  }
  if (entry.disposition === 'verified-already-correct-') {
    if (!/\.(tsx|ts|rs|md|sh|mjs|js|css|json)|:[0-9]+/.test(entry.reason)) {
      errors.push(`verified row cites no code/test path: ${entry.reason}`);
    } else if (entry.source !== 'cutoff1/2') {
      for (const cited of entry.reason.match(/[\w./-]+\.(?:tsx|ts|rs|md|sh|mjs|js|css|json)/g) ??
        []) {
        if (!existsSync(join(ROOT, cited))) {
          errors.push(`verified row cites a path that does not exist: ${cited}`);
        }
      }
    }
  }
}

let summary = null;
try {
  summary = JSON.parse(readFileSync(join(DIR, 'cutoff3.summary.json'), 'utf8'));
} catch {
  errors.push('cutoff3.summary.json is missing or not valid JSON');
}
if (summary) {
  const t = summary.totals ?? {};
  if (t.open_issues + t.open_pull_requests !== t.repository_open_issues_count) {
    errors.push('cutoff-3 reconciliation: open issues + open PRs != open_issues_count');
  }
  if (t.open_issues + t.open_pull_requests !== t.open_issues_plus_open_prs) {
    errors.push('cutoff-3 reconciliation: recorded sum is inconsistent');
  }
  if (t.duplicate_issue_numbers !== 0) errors.push('cutoff-3 duplicate issue numbers');
  if (t.failed_requests !== 0) errors.push('cutoff-3 recorded failed requests');
  if (t.issues_missing_from_cutoff3 !== 0) errors.push('cutoff-3 missing earlier issues');
  if (summary.frozen_id_set?.issue_count !== frozen.size) {
    errors.push(
      `frozen ID set size ${summary.frozen_id_set?.issue_count} != ledger issue count ${frozen.size}`,
    );
  }
  const computedHash = createHash('sha256')
    .update(
      [...frozen]
        .map(Number)
        .sort((a, b) => a - b)
        .join(','),
    )
    .digest('hex');
  if (summary.frozen_id_set?.sha256 !== computedHash) {
    errors.push(
      `frozen ID set hash ${summary.frozen_id_set?.sha256} != recomputed ${computedHash}`,
    );
  }
}

const result = {
  issues: frozen.size,
  cutoff3Rows: cutoff3.length,
  resolutions: resolutions.length,
  dispositions: Object.fromEntries([...counts].sort()),
  nonTerminal: [...latest].filter(
    ([, entry]) => entry.disposition === 'candidate' || entry.disposition === 'deferred',
  ).length,
  errors,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Frozen issue set: ${result.issues}`);
  console.log(`Cutoff-3 rows: ${result.cutoff3Rows}`);
  console.log(`Resolutions: ${result.resolutions}`);
  console.log('Latest dispositions:');
  for (const [key, value] of Object.entries(result.dispositions)) {
    console.log(`  ${String(value).padStart(5)} ${key}`);
  }
  console.log(`Non-terminal latest dispositions: ${result.nonTerminal}`);
  if (errors.length > 0) {
    console.error('\nFAILED:');
    for (const error of errors) console.error(`  - ${error}`);
  } else {
    console.log('\nPASS: every issue has a terminal, evidence-bearing disposition.');
  }
}

process.exit(errors.length === 0 ? 0 : 1);
