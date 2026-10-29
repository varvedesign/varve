#!/usr/bin/env node
/**
 * C2 reconciliation for the Graphite corpus.
 *
 * Re-lists every issue updated since C1 (`state=all&since=<C1>`), follows all
 * pagination, records the response Date header as C2, and reports arrivals and
 * edits that the frozen C1 inventory does not contain. It never rewrites the
 * C1 set: later arrivals are listed so they can be added deliberately.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const REPOSITORY = 'GraphiteEditor/Graphite';
const API = 'https://api.github.com';
const CACHE = process.env.VARVE_GRAPHITE_CACHE_DIR ?? join(homedir(), '.cache/varve/graphite');

const token = process.env.GITHUB_TOKEN
  ? process.env.GITHUB_TOKEN
  : execFileSync('gh', ['auth', 'token', '--hostname', 'github.com'], { encoding: 'utf8' }).trim();

const source = JSON.parse(readFileSync(join(CACHE, 'source.json'), 'utf8'));
const inventory = readFileSync(join(CACHE, 'inventory.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
const known = new Map(inventory.map((issue) => [issue.number, issue]));

function nextLink(header) {
  for (const segment of (header ?? '').split(/,(?=\s*<)/)) {
    const match = segment.match(/^\s*<([^>]+)>\s*;(.*)$/);
    if (match && /rel="?next"?/.test(match[2].replace(/\s/g, ''))) return match[1];
  }
  return null;
}

const url = new URL(`/repos/${REPOSITORY}/issues`, API);
url.searchParams.set('state', 'all');
url.searchParams.set('sort', 'updated');
url.searchParams.set('direction', 'asc');
url.searchParams.set('since', source.cutoff);
url.searchParams.set('per_page', '100');

let next = url.href;
let c2 = null;
let pages = 0;
const touched = [];
while (next) {
  const response = await fetch(next, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`${response.status} at ${next}`);
  if (!c2) c2 = new Date(response.headers.get('date')).toISOString();
  const records = await response.json();
  for (const record of records) {
    if (record.pull_request) continue;
    touched.push({
      number: record.number,
      title: record.title,
      state: record.state,
      created_at: record.created_at,
      updated_at: record.updated_at,
      comments: record.comments,
    });
  }
  pages += 1;
  next = nextLink(response.headers.get('link'));
}

const isNew = touched.filter((record) => !known.has(record.number));
const edited = touched.filter((record) => {
  const before = known.get(record.number);
  return before && before.comments !== record.comments;
});

const report = {
  c1: source.cutoff,
  c2,
  pages,
  listingEndpoint: url.pathname + url.search,
  touchedCount: touched.length,
  newIssues: isNew,
  commentCountChanged: edited.map((record) => ({
    number: record.number,
    was: known.get(record.number).comments,
    now: record.comments,
  })),
};

writeFileSync(join(CACHE, 'c2-reconciliation.json'), `${JSON.stringify(report, null, 2)}\n`);

const lines = [
  '# C2 reconciliation',
  '',
  `- C1 cutoff: ${source.cutoff}`,
  `- C2 cutoff: ${c2} (HTTP Date on the first reconciliation response)`,
  `- Query: \`GET ${url.pathname}${url.search}\` over ${pages} page(s)`,
  `- Issues updated since C1: ${touched.length}`,
  `- New issues not in the C1 set: ${isNew.length}`,
  `- Existing issues whose comment count changed: ${edited.length}`,
  '',
];
if (isNew.length) {
  lines.push('## New issues', '', '| Issue | Created | State | Title |', '|---|---|---|---|');
  for (const record of isNew) {
    lines.push(
      `| #${record.number} | ${record.created_at} | ${record.state} | ${record.title.replace(/\|/g, '\\|')} |`,
    );
  }
  lines.push(
    '',
    'These are tracked separately from the frozen C1 set. They must be added to',
    'the ledger (inventory + comment index) before the corpus can be called',
    'complete for this cutoff.',
  );
} else {
  lines.push(
    'No new issues arrived between C1 and C2, so the frozen issue set is complete',
    'for this cutoff. The reconciliation is still required evidence: it proves the',
    'set was re-checked rather than assumed.',
  );
}
writeFileSync(
  join(new URL('../../docs/audits/graphite/', import.meta.url).pathname, 'c2-reconciliation.md'),
  `${lines.join('\n')}\n`,
);
console.log(
  JSON.stringify({
    c2,
    pages,
    touched: touched.length,
    newIssues: isNew.length,
    commentChanges: edited.length,
  }),
);
