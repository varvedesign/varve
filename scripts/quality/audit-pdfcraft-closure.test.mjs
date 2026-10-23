import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./audit-pdfcraft-closure.mjs', import.meta.url));
const verified = (id) =>
  `${id}\topen\tlow\t\ttext\tverified-already-correct-\tEvidence: src/proof.ts\n`;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pdfcraft-gate-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'docs/audits/pdfcraft');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/proof.ts'), 'export {};\n');
  const files = {
    'issue-ledger.tsv': verified(1),
    'issue-ledger-cutoff2.tsv': '# no additions\n',
    'issue-ledger-cutoff3.tsv': verified(2),
    'resolutions.tsv': '# no resolutions\n',
  };
  const summary = {
    totals: {
      records: 3,
      issues: 2,
      pull_requests: 1,
      open_issues: 2,
      open_pull_requests: 1,
      repository_open_issues_count: 3,
      open_issues_plus_open_prs: 3,
      duplicate_issue_numbers: 0,
      failed_requests: 0,
      issues_missing_from_cutoff3: 0,
    },
    frozen_id_set: {
      issue_count: 2,
      sha256: createHash('sha256').update('1,2').digest('hex'),
    },
    corpus_closed: true,
    review: { required_issue_ids: [2], completed_issue_ids: [2] },
  };
  return {
    root,
    dir,
    files,
    summary,
    run() {
      for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
      writeFileSync(join(dir, 'cutoff3.summary.json'), JSON.stringify(summary));
      const result = spawnSync(process.execPath, [script, '--json'], {
        cwd: root,
        encoding: 'utf8',
      });
      assert.ifError(result.error);
      return { status: result.status, result: JSON.parse(result.stdout) };
    },
  };
}

test('accepts a consistent inventory with explicitly recorded review coverage', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
});

test('terminal labels cannot certify a corpus declared incomplete', (t) => {
  const f = fixture(t);
  f.summary.corpus_closed = false;
  const { status, result } = f.run();
  assert.equal(status, 1);
  assert.ok(result.errors.some((error) => error.includes('not declared closed')));
});

test('requires recorded review of every cutoff-3 issue', (t) => {
  const f = fixture(t);
  f.summary.review.completed_issue_ids = [];
  const { status, result } = f.run();
  assert.equal(status, 1);
  assert.equal(result.pendingReviews, 1);
});

test('cannot omit new issues from the required-review list', (t) => {
  const f = fixture(t);
  f.summary.review = { required_issue_ids: [], completed_issue_ids: [] };
  assert.equal(f.run().status, 1);
});

test('does not silently treat a missing ledger as empty', (t) => {
  const f = fixture(t);
  delete f.files['issue-ledger-cutoff2.tsv'];
  assert.equal(f.run().status, 1);
});

test('rejects a truncated row with an otherwise terminal disposition', (t) => {
  const f = fixture(t);
  f.files['issue-ledger-cutoff3.tsv'] = '2\topen\tlow\t\ttext\tcluster-assessed\n';
  assert.equal(f.run().status, 1);
});

test('rejects duplicate issue numbers in earlier ledgers', (t) => {
  const f = fixture(t);
  f.files['issue-ledger-cutoff2.tsv'] = verified(1);
  assert.equal(f.run().status, 1);
});

test('validates implemented evidence as well as verified evidence', (t) => {
  const f = fixture(t);
  f.files['issue-ledger-cutoff3.tsv'] =
    '2\topen\tlow\t\ttext\timplemented-validated\tNo evidence supplied\n';
  assert.equal(f.run().status, 1);
});

test('rejects fabricated evidence paths', (t) => {
  const f = fixture(t);
  f.files['issue-ledger-cutoff3.tsv'] = verified(2).replace('src/proof.ts', 'src/missing.ts');
  assert.equal(f.run().status, 1);
});

test('does not accept a path outside the repository as evidence', (t) => {
  const f = fixture(t);
  const external = join(f.root, '..', `${f.root.split('/').pop()}-external.ts`);
  writeFileSync(external, 'export {};');
  t.after(() => rmSync(external, { force: true }));
  f.files['issue-ledger-cutoff3.tsv'] = verified(2).replace('src/proof.ts', external);
  assert.equal(f.run().status, 1);
});

test('a vague blocked label is not a command-and-error record', (t) => {
  const f = fixture(t);
  f.files['issue-ledger-cutoff3.tsv'] = '2\topen\tlow\t\ttext\tcandidate\tblocked: error\n';
  assert.equal(f.run().status, 1);
});

test('validates summary totals independently of the hash', (t) => {
  const f = fixture(t);
  f.summary.totals.records = 99;
  assert.equal(f.run().status, 1);
});

test('rejects stale resolution ancestry', (t) => {
  const f = fixture(t);
  f.files['resolutions.tsv'] = '1\tcandidate\tcluster-assessed\tReason\n';
  assert.equal(f.run().status, 1);
});

test('rejects a mismatched frozen ID hash', (t) => {
  const f = fixture(t);
  f.summary.frozen_id_set.sha256 = 'wrong';
  assert.equal(f.run().status, 1);
});
