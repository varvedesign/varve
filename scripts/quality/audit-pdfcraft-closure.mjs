#!/usr/bin/env node
/**
 * Check the append-only PDFCraft inventory and recorded review coverage.
 * This validates metadata, not the correctness of a cited test or assertion.
 * Terminal labels alone are never a corpus-completion certificate.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const DIR = join(ROOT, 'docs', 'audits', 'pdfcraft');
const errors = [];
const TERMINAL = new Set([
  'implemented-validated',
  'verified-already-correct-',
  'outside-varve-scope',
  'duplicate-of',
  'cluster-assessed',
]);
const NON_TERMINAL = new Set(['candidate', 'deferred']);
const BLOCKED = /^blocked: command="[^"]+"; error="[^"]+"$/;

function rows(file, minimumColumns) {
  let text;
  try {
    text = readFileSync(join(DIR, file), 'utf8');
  } catch {
    errors.push(`required ledger is missing or unreadable: ${file}`);
    return [];
  }
  const parsed = [];
  for (const [index, line] of text.split('\n').entries()) {
    if (!line.trim() || line.startsWith('#')) continue;
    const columns = line.split('\t');
    if (columns.length < minimumColumns || !/^[1-9]\d*$/.test(columns[0])) {
      errors.push(`malformed row: ${file}:${index + 1}`);
      continue;
    }
    parsed.push(columns);
  }
  return parsed;
}

function recordIssue(row, source, latest, frozen) {
  const [number, , , , cluster, disposition, reason] = row;
  if (frozen.has(number)) errors.push(`duplicate issue number: ${number} (${source})`);
  frozen.add(number);
  latest.set(number, { cluster, disposition, reason, source });
}

function applyResolutions(resolutions, latest) {
  for (const [number, previous, disposition, reason] of resolutions) {
    const entry = latest.get(number);
    if (!entry) {
      errors.push(`resolution names issue absent from earlier ledgers: ${number}`);
      continue;
    }
    if (entry.disposition !== previous) {
      errors.push(
        `resolution ancestry mismatch for ${number}: ${previous} != ${entry.disposition}`,
      );
    }
    latest.set(number, { ...entry, disposition, reason, source: 'resolution' });
  }
}

function checkEvidence(number, entry) {
  const citations = entry.reason.match(/[\w./-]+\.(?:tsx|ts|rs|md|sh|mjs|js|css|json)\b/g) ?? [];
  if (citations.length === 0) errors.push(`issue ${number} cites no code/test path`);
  // Frozen rows retain historical spelling. Current resolutions and additions
  // must cite actual repository files, never an arbitrary file on this host.
  if (entry.source === 'cutoff1/2') return;
  for (const cited of citations) {
    const target = resolve(ROOT, cited);
    const rel = relative(ROOT, target);
    if (isAbsolute(cited) || rel.startsWith('..') || !existsSync(target)) {
      errors.push(`issue ${number} cites a missing or non-repository path: ${cited}`);
    }
  }
}

function checkEntries(latest) {
  const counts = new Map();
  let nonTerminal = 0;
  for (const [number, entry] of latest) {
    counts.set(entry.disposition, (counts.get(entry.disposition) ?? 0) + 1);
    if (!entry.reason.trim()) errors.push(`issue ${number} has an empty reason`);
    if (NON_TERMINAL.has(entry.disposition)) {
      nonTerminal += 1;
      if (!BLOCKED.test(entry.reason)) {
        errors.push(
          `issue ${number} is unresolved; a blocker must name command="..."; error="..."`,
        );
      }
    } else if (!TERMINAL.has(entry.disposition)) {
      errors.push(`issue ${number} has unknown disposition: ${entry.disposition}`);
    }
    if (['verified-already-correct-', 'implemented-validated'].includes(entry.disposition)) {
      checkEvidence(number, entry);
    }
  }
  return { counts, nonTerminal };
}

function readSummary() {
  try {
    const summary = JSON.parse(readFileSync(join(DIR, 'cutoff3.summary.json'), 'utf8'));
    if (summary && typeof summary === 'object' && !Array.isArray(summary)) return summary;
  } catch {
    // Invalid or missing summaries must fail, not become an empty inventory.
  }
  errors.push('cutoff3.summary.json is missing or invalid');
  return {};
}

function checkTotals(summary, frozen) {
  const totals = summary.totals ?? {};
  const names = [
    'records',
    'issues',
    'pull_requests',
    'open_issues',
    'open_pull_requests',
    'repository_open_issues_count',
    'open_issues_plus_open_prs',
    'duplicate_issue_numbers',
    'failed_requests',
    'issues_missing_from_cutoff3',
  ];
  for (const name of names) {
    if (!Number.isSafeInteger(totals[name]) || totals[name] < 0) {
      errors.push(`invalid summary count: ${name}`);
    }
  }
  if (totals.records !== totals.issues + totals.pull_requests)
    errors.push('record total is inconsistent');
  if (totals.issues !== frozen.size) errors.push('issue total does not match the ledgers');
  const open = totals.open_issues + totals.open_pull_requests;
  if (open !== totals.repository_open_issues_count || open !== totals.open_issues_plus_open_prs) {
    errors.push('open issue / PR reconciliation is inconsistent');
  }
  if (totals.open_issues > totals.issues || totals.open_pull_requests > totals.pull_requests) {
    errors.push('open counts exceed total counts');
  }
  for (const name of [
    'duplicate_issue_numbers',
    'failed_requests',
    'issues_missing_from_cutoff3',
  ]) {
    if (totals[name] !== 0) errors.push(`snapshot reports ${name}: ${totals[name]}`);
  }
  const hash = createHash('sha256')
    .update(
      [...frozen]
        .map(Number)
        .sort((a, b) => a - b)
        .join(','),
    )
    .digest('hex');
  if (summary.frozen_id_set?.issue_count !== frozen.size)
    errors.push('frozen issue count mismatch');
  if (summary.frozen_id_set?.sha256 !== hash) errors.push('frozen ID hash mismatch');
}

function reviewIds(value, name, frozen) {
  if (!Array.isArray(value)) {
    errors.push(`missing review list: ${name}`);
    return new Set();
  }
  const ids = new Set();
  for (const number of value) {
    if (!Number.isSafeInteger(number) || !frozen.has(String(number)) || ids.has(number)) {
      errors.push(`invalid, duplicate or foreign review issue: ${name} ${number}`);
    }
    ids.add(number);
  }
  return ids;
}

function checkReview(summary, cutoff3, resolutions, frozen) {
  const review = summary.review ?? {};
  const required = reviewIds(review.required_issue_ids, 'required_issue_ids', frozen);
  const completed = reviewIds(review.completed_issue_ids, 'completed_issue_ids', frozen);
  for (const row of [...cutoff3, ...resolutions]) {
    if (!required.has(Number(row[0]))) errors.push(`required review omits issue ${row[0]}`);
  }
  for (const number of completed) {
    if (!required.has(number)) errors.push(`completed review is not required: ${number}`);
  }
  const pending = [...required].filter((number) => !completed.has(number)).length;
  if (pending > 0) errors.push(`full evidence review remains outstanding for ${pending} issues`);
  if (summary.corpus_closed !== true) errors.push('corpus is not declared closed');
  return pending;
}

const earlier = [...rows('issue-ledger.tsv', 7), ...rows('issue-ledger-cutoff2.tsv', 7)];
const cutoff3 = rows('issue-ledger-cutoff3.tsv', 7);
const resolutions = rows('resolutions.tsv', 4);
const latest = new Map();
const frozen = new Set();
for (const row of earlier) recordIssue(row, 'cutoff1/2', latest, frozen);
applyResolutions(resolutions, latest);
for (const row of cutoff3) recordIssue(row, 'cutoff3', latest, frozen);
const { counts, nonTerminal } = checkEntries(latest);
const summary = readSummary();
checkTotals(summary, frozen);
const pendingReviews = checkReview(summary, cutoff3, resolutions, frozen);
if (nonTerminal > 0) errors.push(`${nonTerminal} non-terminal dispositions remain`);

const result = {
  issues: frozen.size,
  cutoff3Rows: cutoff3.length,
  resolutions: resolutions.length,
  dispositions: Object.fromEntries([...counts].sort()),
  nonTerminal,
  pendingReviews,
  closureComplete: errors.length === 0,
  errors,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Frozen issue set: ${result.issues}`);
  console.log(`Cutoff-3 rows: ${result.cutoff3Rows}`);
  console.log(`Resolutions: ${result.resolutions}`);
  console.log('Declared latest dispositions (not independent verification):');
  for (const [key, value] of Object.entries(result.dispositions)) {
    console.log(`  ${String(value).padStart(5)} ${key}`);
  }
  console.log(`Non-terminal latest dispositions: ${nonTerminal}`);
  console.log(`Pending full-evidence reviews: ${pendingReviews}`);
  if (errors.length) {
    console.error('\nINCOMPLETE:');
    for (const error of errors) console.error(`  - ${error}`);
  } else {
    console.log('\nPASS: metadata and recorded review coverage are consistent.');
    console.log('Behavioral correctness and integration require separate validation.');
  }
}
process.exit(result.closureComplete ? 0 : 1);
