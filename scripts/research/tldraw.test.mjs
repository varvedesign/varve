import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyLedgerReview,
  createLedgerRecord,
  nextLink,
  parseArgs,
  partitionRecords,
} from './tldraw.mjs';

test('follows the RFC link relation when next is mixed with other links', () => {
  assert.equal(
    nextLink(
      '<https://api.github.com/page/2>; rel="next", <https://api.github.com/page/4>; rel="last"',
    ),
    'https://api.github.com/page/2',
  );
  assert.equal(
    nextLink(
      '<https://api.github.com/page/1>; rel="prev", <https://api.github.com/page/4>; rel="last"',
    ),
    null,
  );
});

test('parses boolean and valued CLI options without interpreting unknown flags as paths', () => {
  assert.deepEqual(parseArgs(['inventory', '--resume', '--limit', '3']), {
    command: 'inventory',
    options: { resume: true, limit: '3' },
  });
  assert.deepEqual(parseArgs([]), { command: 'status', options: {} });
  assert.throws(() => parseArgs(['status', 'unexpected']), /Unexpected argument/);
});

test('freezes both issue and PR records at the same C1 creation cutoff', () => {
  const before = '2026-10-20T02:57:26.000Z';
  const after = '2026-10-20T02:57:27.000Z';
  const result = partitionRecords(
    [
      { number: 1, created_at: before },
      { number: 2, created_at: before, pull_request: { url: 'https://example.test/pr/2' } },
      { number: 3, created_at: after },
      { number: 4, created_at: after, pull_request: { url: 'https://example.test/pr/4' } },
    ],
    before,
  );
  assert.deepEqual(
    result.issues.map((record) => record.number),
    [1],
  );
  assert.deepEqual(
    result.pullRequests.map((record) => record.number),
    [2],
  );
});

test('initializes separate review state while retaining source comment discrepancies', () => {
  const row = createLedgerRecord(
    {
      number: 2329,
      title: 'Matrix2d.Scale issue',
      url: 'https://github.com/tldraw/tldraw/issues/2329',
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      state: 'closed',
      labels: ['bug'],
      comments: 2,
    },
    {
      expectedAtInventory: 2,
      retrieved: 1,
      complete: true,
      pages: 1,
      countDiscrepancy: { missingDeclaredCount: 1 },
    },
  );
  assert.equal(row.discussionComplete, true);
  assert.equal(row.declaredComments, 2);
  assert.equal(row.retrievedComments, 1);
  assert.deepEqual(row.commentCountDiscrepancy, { missingDeclaredCount: 1 });
  assert.equal(row.review.status, 'unreviewed');
  assert.equal(row.review.commentsReviewed, 0);
  assert.equal(row.review.bodyReviewed, false);
});

test('requires every accessible comment and retains unresolved source gaps in a disposition', () => {
  const row = createLedgerRecord(
    {
      number: 2329,
      title: 'Matrix2d.Scale issue',
      url: 'https://github.com/tldraw/tldraw/issues/2329',
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      state: 'closed',
      labels: ['bug'],
      comments: 2,
    },
    {
      expectedAtInventory: 2,
      retrieved: 1,
      complete: true,
      pages: 1,
      countDiscrepancy: { missingDeclaredCount: 1 },
    },
  );
  const assessment = {
    number: 2329,
    bodyReviewed: true,
    commentsReviewed: 1,
    disposition: 'closed-no-change',
    reason: 'Verified source behavior; no transferable defect found.',
    evidence: ['https://github.com/tldraw/tldraw/issues/2329'],
  };
  assert.throws(
    () => applyLedgerReview(row, { ...assessment, commentsReviewed: 0 }),
    /requires review/,
  );
  const reviewed = applyLedgerReview(row, assessment, '2026-10-20T03:10:00Z');
  assert.equal(reviewed.review.status, 'reviewed-with-source-gap');
  assert.equal(reviewed.review.commentsReviewed, 1);
  assert.equal(reviewed.review.reviewedAt, '2026-10-20T03:10:00Z');
});
