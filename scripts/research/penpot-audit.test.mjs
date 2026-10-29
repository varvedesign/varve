import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commentResumeUrl,
  compareCommentSets,
  compareInventories,
  completionRecordErrors,
  getNextUrl,
  parseLinkHeader,
  reconcileInventory,
  reconcileSupplemental,
  requestJson,
  reuseCachedResponse,
  sourceRecordErrors,
  uniqueById,
} from './penpot-audit.mjs';

test('follows GitHub Link pagination without confusing commas inside URLs', () => {
  const next = 'https://api.github.com/repos/penpot/penpot/issues?state=all&page=2';
  const links = parseLinkHeader(
    `<https://api.github.com/?q=a,b>; rel="prev", <${next}>; rel="next"`,
  );
  assert.deepEqual(links, [
    { url: 'https://api.github.com/?q=a,b', rel: 'prev' },
    { url: next, rel: 'next' },
  ]);
  assert.equal(getNextUrl(`<${next}>; rel="next"`), next);
  assert.equal(getNextUrl(null), null);
});

test('reconciles issues and pull requests separately and excludes records after cutoff', () => {
  const result = reconcileInventory([
    {
      nodeId: 'issue-1',
      number: 1,
      kind: 'issue',
      state: 'open',
      includedAtCutoff: true,
      bodyPresent: true,
      commentCount: 1,
      commentCoverage: 'complete',
      researchStatus: 'reviewed',
      engineeringStatus: 'closed',
    },
    {
      nodeId: 'pr-2',
      number: 2,
      kind: 'pull-request',
      state: 'closed',
      includedAtCutoff: true,
      bodyPresent: true,
      commentCount: 9,
      commentCoverage: 'not-fetched',
      researchStatus: 'unreviewed',
      engineeringStatus: 'unassessed',
    },
    {
      nodeId: 'issue-3',
      number: 3,
      kind: 'issue',
      state: 'closed',
      includedAtCutoff: false,
      bodyPresent: false,
      commentCount: 0,
      commentCoverage: 'not-needed',
      researchStatus: 'unreviewed',
      engineeringStatus: 'unassessed',
    },
  ]);
  assert.equal(result.issueCount, 1);
  assert.equal(result.pullRequestCount, 1);
  assert.deepEqual(result.issueStates, { open: 1, closed: 0 });
  assert.deepEqual(result.pullRequestStates, { open: 0, closed: 1 });
  assert.deepEqual(result.unresolvedComments, []);
  assert.equal(result.pendingResearch, 0);
  assert.equal(result.pendingEngineering, 0);
});

test('keeps supplemental issue omissions separate while detecting duplicate identities', () => {
  const base = [{ nodeId: 'listed-id', number: 10, kind: 'issue' }];
  const result = reconcileSupplemental(base, [
    {
      nodeId: 'supplement-id',
      number: 11,
      kind: 'issue',
      researchStatus: 'reviewed',
      engineeringStatus: 'closed',
    },
  ]);
  assert.deepEqual(result, {
    issueCount: 1,
    pendingResearch: 0,
    pendingEngineering: 0,
    duplicateStableIds: [],
    duplicateNumbers: [],
  });

  const duplicated = reconcileSupplemental(base, [
    { nodeId: 'listed-id', number: 10, kind: 'issue' },
  ]);
  assert.deepEqual(duplicated.duplicateStableIds, ['listed-id']);
  assert.deepEqual(duplicated.duplicateNumbers, [10]);
});

test('keeps duplicate identities and missing issue discussions visible in reconciliation', () => {
  const result = reconcileInventory([
    {
      nodeId: 'first-copy',
      number: 7,
      kind: 'issue',
      state: 'open',
      includedAtCutoff: true,
      bodyPresent: false,
      commentCount: 4,
      commentCoverage: 'not-fetched',
      researchStatus: 'unreviewed',
      engineeringStatus: 'unassessed',
    },
    {
      nodeId: 'second-copy',
      number: 7,
      kind: 'issue',
      state: 'open',
      includedAtCutoff: true,
      bodyPresent: true,
      commentCount: 0,
      commentCoverage: 'not-needed',
      researchStatus: 'unreviewed',
      engineeringStatus: 'unassessed',
    },
  ]);
  assert.deepEqual(result.duplicateNumbers, [7]);
  assert.deepEqual(result.duplicateStableIds, []);
  assert.deepEqual(result.bodylessIssues, [7]);
  assert.deepEqual(result.unresolvedComments, [7]);
  assert.equal(result.pendingResearch, 2);
});

test('reports repeated stable IDs even if the records disagree on issue number', () => {
  const result = reconcileInventory([
    { nodeId: 'same-id', number: 7, kind: 'issue', includedAtCutoff: true },
    { nodeId: 'same-id', number: 8, kind: 'issue', includedAtCutoff: true },
  ]);
  assert.deepEqual(result.duplicateStableIds, ['same-id']);
  assert.equal(result.issueCount, 1);
});

test('revalidates cached responses with ETags and recognizes not-modified', async () => {
  const originalFetch = globalThis.fetch;
  let requestHeaders;
  globalThis.fetch = async (_url, options) => {
    requestHeaders = options.headers;
    return new Response(null, { status: 304 });
  };
  try {
    const response = await requestJson('https://example.test/page', 'test-token', {
      etag: '"cached-validator"',
    });
    assert.equal(requestHeaders['If-None-Match'], '"cached-validator"');
    assert.equal(response.notModified, true);
    assert.equal(response.value, null);
    const reused = reuseCachedResponse(response, {
      items: [{ id: 1 }],
      etag: '"cached-validator"',
      lastModified: 'yesterday',
      link: '<https://example.test/next>; rel="next"',
    });
    assert.deepEqual(reused.value, [{ id: 1 }]);
    assert.equal(reused.response.headers.get('link'), '<https://example.test/next>; rel="next"');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('retries transient GitHub API failures before accepting a page', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? new Response('temporary failure', { status: 500 })
      : new Response(JSON.stringify([{ id: 1 }]), {
          status: 200,
          headers: { 'content-type': 'application/json', etag: '"page-1"' },
        });
  };
  try {
    const response = await requestJson('https://example.test/page', 'test-token');
    assert.equal(calls, 2);
    assert.deepEqual(response.value, [{ id: 1 }]);
    assert.equal(response.response.headers.get('etag'), '"page-1"');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('cutoff reconciliation records C1 issues absent from C2 for follow-up', () => {
  const previous = [
    { nodeId: 'issue-1', number: 1, kind: 'issue', includedAtCutoff: true, state: 'open' },
    { nodeId: 'pr-2', number: 2, kind: 'pull-request', includedAtCutoff: true, state: 'closed' },
  ];
  const changes = compareInventories(previous, []);
  assert.deepEqual(changes, [
    {
      type: 'missing-at-cutoff',
      nodeId: 'issue-1',
      number: 1,
      url: undefined,
      before: { state: 'open', updatedAt: undefined },
      disposition: 'requires-transfer-or-removal-investigation',
    },
  ]);
});

test('defers issue evidence edits observed after the frozen C2 cutoff', () => {
  const previous = [
    {
      nodeId: 'issue-1',
      number: 1,
      url: 'u',
      kind: 'issue',
      includedAtCutoff: true,
      updatedAt: '2026-01-01T00:00:00Z',
      bodySha256: 'old',
      commentCount: 0,
    },
  ];
  const current = [
    {
      ...previous[0],
      updatedAt: '2026-02-02T00:00:00Z',
      bodySha256: 'new',
    },
  ];
  assert.deepEqual(compareInventories(previous, current, '2026-02-01T00:00:00Z'), [
    {
      type: 'post-cutoff-evidence-change',
      nodeId: 'issue-1',
      number: 1,
      url: 'u',
      updatedAt: '2026-02-02T00:00:00Z',
      disposition: 'queued-for-follow-on',
    },
  ]);
});

test('rejects completion states without a per-issue assessment and disposition', () => {
  const record = {
    number: 9,
    researchStatus: 'reviewed',
    engineeringStatus: 'closed',
    disposition: 'pending-review',
  };
  assert.deepEqual(completionRecordErrors(record), [
    'reviewed issue #9 has no assessment',
    'reviewed issue #9 has no source evidence pointer',
    'reviewed issue #9 has no owner',
    'reviewed issue #9 has no final disposition',
    'closed engineering status for issue #9 lacks reviewed evidence and disposition',
    'closed engineering status for issue #9 has no engineering evidence',
  ]);
});

test('rejects marking an issue reviewed when its source changed after the frozen cutoff', () => {
  assert.deepEqual(completionRecordErrors({ number: 10, evidenceUpdatedAfterCutoff: true }), [
    'issue #10 source evidence changed after the frozen cutoff',
  ]);
});

test('does not restart a cached comment thread after its final page', () => {
  const firstPage = 'https://api.github.com/issues/1/comments?per_page=100';
  assert.equal(commentResumeUrl(null, firstPage), firstPage);
  assert.equal(commentResumeUrl({ nextUrl: null }, firstPage), null);
  assert.equal(
    commentResumeUrl({ nextUrl: `${firstPage}&page=2` }, firstPage),
    `${firstPage}&page=2`,
  );
});

test('normalizes replayed comment responses by stable comment ID', () => {
  const comments = [
    { id: 1, body: 'first response' },
    { id: 1, body: 'replayed response' },
    { id: 2, body: 'other comment' },
  ];
  const normalized = uniqueById(comments);
  assert.deepEqual(normalized, [comments[1], comments[2]]);
  assert.deepEqual(uniqueById(normalized), normalized);
});

test('compares comment additions, edits, and removals across frozen cutoffs', () => {
  const previous = [
    { id: 1, created_at: '2026-01-01', updated_at: '2026-01-01', body: 'old' },
    { id: 2, created_at: '2026-01-01', updated_at: '2026-01-01', body: 'removed' },
  ];
  const current = [
    { id: 1, created_at: '2026-01-01', updated_at: '2026-01-02', body: 'edited' },
    { id: 3, created_at: '2026-01-02', updated_at: '2026-01-02', body: 'new' },
    { id: 4, created_at: '2026-02-01', updated_at: '2026-02-01', body: 'after cutoff' },
  ];
  const changes = compareCommentSets(
    previous,
    current,
    '2026-01-01T00:00:00Z',
    '2026-01-31T00:00:00Z',
  );
  assert.deepEqual(
    changes.map((change) => [change.type, change.commentId]),
    [
      ['edited-comment', 1],
      ['new-comment', 3],
      ['removed-comment', 2],
    ],
  );
});

test('defers comment edits observed after C2 and does not misreport them as removals', () => {
  const previous = [
    {
      id: 1,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      body: 'before',
    },
  ];
  const current = [
    {
      id: 1,
      created_at: '2026-01-01',
      updated_at: '2026-02-02',
      body: 'edited after cutoff',
    },
  ];
  assert.deepEqual(
    compareCommentSets(previous, current, '2026-01-31T00:00:00Z', '2026-02-01T00:00:00Z'),
    [
      {
        type: 'post-cutoff-comment-edit',
        commentId: 1,
        updatedAt: '2026-02-02',
        disposition: 'queued-for-follow-on',
      },
    ],
  );
});

test('checks a reviewed ledger row against its raw issue page item and pointer', () => {
  const item = {
    id: 10,
    node_id: 'node-10',
    number: 10,
    html_url: 'https://github.test/issues/10',
    state: 'closed',
    created_at: '2026-01-01',
    updated_at: '2026-01-02',
    closed_at: '2026-01-02',
    comments: 0,
    body: 'body',
    labels: [{ name: 'bug' }],
  };
  const record = {
    id: 10,
    nodeId: 'node-10',
    number: 10,
    url: item.html_url,
    state: 'closed',
    kind: 'issue',
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    closedAt: item.closed_at,
    commentCount: 0,
    bodyPresent: true,
    bodySha256: '230d8358dc8e8890b4c58deeb62912ee2f20357ae92a5cc861b98e68fe31acb5',
    labels: ['bug'],
    researchStatus: 'reviewed',
    sourcePagePath: 'C1/issues/page-0001.json',
    sourcePageETag: '"page"',
    includedAtCutoff: true,
    evidenceUpdatedAfterCutoff: false,
  };
  assert.deepEqual(sourceRecordErrors(record, item, 'C1/issues/page-0001.json', '"page"'), []);
  assert.deepEqual(
    sourceRecordErrors(record, item, 'C1/issues/page-0001.json', '"page"', '2026-01-03'),
    [],
  );
  assert.deepEqual(
    sourceRecordErrors(record, item, 'C1/issues/page-0001.json', '"page"', '2026-01-01'),
    ['ledger issue #10 cutoff marker differs from raw source timestamp'],
  );
  assert.deepEqual(
    sourceRecordErrors(
      { ...record, evidenceUpdatedAfterCutoff: undefined },
      item,
      'C1/issues/page-0001.json',
      '"page"',
      '2026-01-03',
    ),
    ['ledger issue #10 cutoff marker differs from raw source timestamp'],
  );
  assert.deepEqual(
    sourceRecordErrors(
      { ...record, researchStatus: 'unreviewed', evidenceUpdatedAfterCutoff: undefined },
      item,
      'C1/issues/page-0001.json',
      '"page"',
      '2026-01-03',
    ),
    [],
  );
  assert.deepEqual(
    sourceRecordErrors(
      { ...record, bodySha256: 'tampered', sourcePagePath: 'C1/issues/page-0002.json' },
      item,
      'C1/issues/page-0001.json',
      '"page"',
    ),
    [
      'ledger issue #10 source page pointer mismatch',
      'ledger issue #10 identity or body differs from raw source item',
    ],
  );
});
