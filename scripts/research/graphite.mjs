#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';

const REPOSITORY = 'GraphiteEditor/Graphite';
const API = 'https://api.github.com';
const CACHE =
  process.env.VARVE_GRAPHITE_CACHE_DIR ??
  join(process.env.XDG_CACHE_HOME ?? join(process.env.HOME ?? '.', '.cache'), 'varve', 'graphite');
const AUDIT = new URL('../../docs/audits/graphite/', import.meta.url).pathname;
const SOURCE_PATH = join(CACHE, 'source.json');
const PAGES_PATH = join(CACHE, 'issues');
const COMMENTS_PATH = join(CACHE, 'comments');
const INDEX_PATH = join(CACHE, 'inventory.jsonl');
const PULLS_PATH = join(CACHE, 'pulls.jsonl');
const ISSUE_CURSOR_PATH = join(CACHE, 'issue-cursor.json');
const COMMENT_INDEX_PATH = join(CACHE, 'comment-index.jsonl');
const COMMENT_PAGE_CURSOR_PATH = join(CACHE, 'comment-page-cursor.json');
const GRAPHQL_PAGES_PATH = join(CACHE, 'graphql-pages');

const ISSUE_COMMENTS_QUERY = `query GraphiteIssuePage($after: String) {
  repository(owner: "GraphiteEditor", name: "Graphite") {
    issues(first: 100, after: $after, orderBy: { field: CREATED_AT, direction: ASC }, filterBy: { states: [OPEN, CLOSED] }) {
      nodes {
        number
        url
        title
        state
        stateReason
        createdAt
        updatedAt
        closedAt
        labels(first: 30) { nodes { name } }
        comments(first: 100) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes { databaseId url body createdAt updatedAt author { login } }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const ISSUE_COMMENT_CONTINUATION_QUERY = `query GraphiteIssueComments($number: Int!, $after: String) {
  repository(owner: "GraphiteEditor", name: "Graphite") {
    issue(number: $number) {
      number
      url
      comments(first: 100, after: $after) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { databaseId url body createdAt updatedAt author { login } }
      }
    }
  }
}`;

export function nextLink(header) {
  for (const segment of (header ?? '').split(/,(?=\s*<)/)) {
    const match = segment.match(/^\s*<([^>]+)>\s*;(.*)$/);
    if (match && /(?:^|;)\s*rel="?next"?(?:;|$)/i.test(match[2].replace(/\s/g, ''))) {
      return match[1];
    }
  }
  return null;
}

export function parseArgs(argv) {
  const [command = 'status', ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith('--')) {
      options._ = [...(options._ ?? []), value];
      continue;
    }
    const key = value.slice(2);
    options[key] = rest[index + 1] && !rest[index + 1].startsWith('--') ? rest[++index] : true;
  }
  return { command, options };
}

export function partitionRecords(records, cutoff) {
  const beforeCutoff = records.filter((record) => record.created_at <= cutoff);
  return {
    issues: beforeCutoff.filter((record) => !record.pull_request),
    pullRequests: beforeCutoff.filter((record) => Boolean(record.pull_request)),
  };
}

export function createLedgerRecord(issue, discussion) {
  return {
    number: issue.number,
    title: issue.title,
    url: issue.url,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    closedAt: issue.closedAt ?? null,
    state: issue.state,
    labels: issue.labels,
    declaredComments: discussion?.expectedAtInventory ?? issue.comments,
    retrievedComments: discussion?.retrievable ?? null,
    discussionComplete: discussion?.complete ?? false,
    discussionPages: discussion?.pages ?? 0,
    commentCountDiscrepancy: discussion?.countDiscrepancy ?? null,
    review: {
      status: 'unreviewed',
      bodyReviewed: false,
      commentsReviewed: 0,
      disposition: null,
      reason: null,
      relatedIssues: [],
      evidence: [],
      varveAssessment: null,
    },
  };
}

export function applyLedgerReview(row, assessment, reviewedAt = new Date().toISOString()) {
  if (!assessment || assessment.number !== row.number)
    throw new Error(`Assessment number must match issue #${row.number}.`);
  if (assessment.bodyReviewed !== true)
    throw new Error(`Issue #${row.number} body must be read before it can be dispositioned.`);
  if (assessment.commentsReviewed !== row.retrievedComments)
    throw new Error(
      `Issue #${row.number} requires review of all ${row.retrievedComments} retrievable comments.`,
    );
  if (!assessment.disposition || !assessment.reason?.trim())
    throw new Error(`Issue #${row.number} requires a disposition and reason.`);
  if (!Array.isArray(assessment.evidence))
    throw new Error(`Issue #${row.number} evidence must be an array of source pointers.`);
  return {
    ...row,
    review: {
      status: row.commentCountDiscrepancy ? 'reviewed-with-source-gap' : 'reviewed',
      bodyReviewed: true,
      commentsReviewed: assessment.commentsReviewed,
      reviewedAt,
      disposition: assessment.disposition,
      reason: assessment.reason,
      relatedIssues: assessment.relatedIssues ?? [],
      evidence: assessment.evidence,
      varveAssessment: assessment.varveAssessment ?? null,
    },
  };
}

export function importLedgerReviews(rows, assessments, reviewedAt = new Date().toISOString()) {
  const byNumber = new Map(rows.map((row, index) => [row.number, index]));
  const imported = new Set();
  const nextRows = [...rows];
  for (const assessment of assessments) {
    if (imported.has(assessment.number))
      throw new Error(`Duplicate assessment for issue #${assessment.number}.`);
    imported.add(assessment.number);
    const index = byNumber.get(assessment.number);
    if (index === undefined)
      throw new Error(`Issue #${assessment.number} is not in the frozen ledger.`);
    if (nextRows[index].review.status !== 'unreviewed')
      throw new Error(
        `Issue #${assessment.number} already has review status ${nextRows[index].review.status}.`,
      );
    nextRows[index] = applyLedgerReview(nextRows[index], assessment, reviewedAt);
  }
  return nextRows;
}

export function extractEvidenceLinks(text) {
  const links = new Set();
  const githubPath =
    /https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull|commit|blob|tree|discussions)\/[^\s)\]}>"']+/g;
  for (const match of text.matchAll(githubPath)) {
    links.add(match[0].replace(/[.,;:!?]+$/, ''));
  }
  for (const match of text.matchAll(/(?<![\w/])#(\d+)\b/g)) {
    links.add(`#${match[1]}`);
  }
  return [...links];
}

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function atomicLines(path, values) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(
    temporary,
    values.map((value) => JSON.stringify(value)).join('\n') + (values.length ? '\n' : ''),
    { mode: 0o600 },
  );
  await rename(temporary, path);
}

async function lines(path) {
  try {
    const text = await readFile(path, 'utf8');
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function authorizationToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync('gh', ['auth', 'token', '--hostname', 'github.com'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

async function get(url) {
  const token = authorizationToken();
  let delayMs = 1000;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (response.ok) return response;
    const requestId = response.headers.get('x-github-request-id') ?? 'unknown';
    const retryAfter = Number(response.headers.get('retry-after'));
    if ((response.status === 429 || response.status === 403) && attempt < 8) {
      const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
      const untilReset = reset > Date.now() ? reset - Date.now() + 1500 : 0;
      const waitMs = Math.max(
        Number.isFinite(retryAfter) ? retryAfter * 1000 : 0,
        untilReset,
        delayMs,
      );
      console.warn(
        `GitHub returned ${response.status}; request ${requestId}; checkpoint retained, waiting ${Math.ceil(waitMs / 1000)}s.`,
      );
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 3_600_000)));
      delayMs = Math.min(delayMs * 2, 60_000);
      continue;
    }
    if (response.status >= 500 && attempt < 8) {
      console.warn(`GitHub returned ${response.status}; request ${requestId}; retry ${attempt}/8.`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 2, 60_000);
      continue;
    }
    const body = (await response.text()).slice(0, 1000);
    throw new Error(`GitHub request failed (${response.status}, request ${requestId}): ${body}`);
  }
  throw new Error('GitHub request exhausted retry budget; resume from the saved cursor.');
}

async function graphql(query, variables) {
  const token = authorizationToken();
  if (!token)
    throw new Error('GitHub authentication is required for the batched discussion crawl.');
  let delayMs = 1000;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const response = await fetch(`${API}/graphql`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ query, variables }),
    });
    const payload = await response.json();
    const retryable = payload.errors?.some((error) =>
      ['RATE_LIMITED', 'INTERNAL_SERVER_ERROR', 'SERVICE_UNAVAILABLE'].includes(error.type),
    );
    if (response.ok && !payload.errors) {
      return {
        payload,
        date: response.headers.get('date'),
        cost: response.headers.get('x-ratelimit-cost'),
        remaining: response.headers.get('x-ratelimit-remaining'),
        requestId: response.headers.get('x-github-request-id'),
      };
    }
    if (
      attempt < 8 &&
      (response.status === 429 || response.status === 403 || response.status >= 500 || retryable)
    ) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
      const waitMs = Math.max(
        Number.isFinite(retryAfter) ? retryAfter * 1000 : 0,
        reset > Date.now() ? reset - Date.now() + 1500 : 0,
        delayMs,
      );
      console.warn(
        `GraphQL request ${response.headers.get('x-github-request-id') ?? 'unknown'} failed; checkpoint retained, waiting ${Math.ceil(waitMs / 1000)}s.`,
      );
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 3_600_000)));
      delayMs = Math.min(delayMs * 2, 60_000);
      continue;
    }
    throw new Error(
      `GitHub GraphQL failed (${response.status}): ${JSON.stringify(payload.errors ?? payload).slice(0, 1000)}`,
    );
  }
  throw new Error('GitHub GraphQL exhausted retry budget; resume from the saved cursor.');
}

async function start() {
  const current = await readJson(SOURCE_PATH);
  if (current)
    throw new Error(`C1 already exists at ${SOURCE_PATH}; refusing to replace the frozen corpus.`);
  await mkdir(PAGES_PATH, { recursive: true });
  await mkdir(COMMENTS_PATH, { recursive: true });
  await mkdir(AUDIT, { recursive: true });
  const url = new URL(`/repos/${REPOSITORY}/issues`, API);
  url.searchParams.set('state', 'all');
  url.searchParams.set('sort', 'created');
  url.searchParams.set('direction', 'asc');
  url.searchParams.set('per_page', '100');
  const startedAt = new Date().toISOString();
  const response = await get(url);
  const serverDate = response.headers.get('date');
  if (!serverDate)
    throw new Error('GitHub response omitted Date; no cutoff can be recorded safely.');
  const cutoff = new Date(serverDate).toISOString();
  const payload = await response.json();
  await atomicJson(join(PAGES_PATH, '000001.json'), {
    requestedUrl: url.href,
    retrievedAt: new Date().toISOString(),
    serverDate,
    etag: response.headers.get('etag'),
    link: response.headers.get('link'),
    records: payload,
  });
  const source = {
    repository: REPOSITORY,
    canonicalRepositoryUrl: `https://github.com/${REPOSITORY}`,
    listingEndpoint: `/repos/${REPOSITORY}/issues`,
    query: Object.fromEntries(url.searchParams),
    startedAt,
    cutoff,
    cutoffSource: 'Date header from first successful listing response',
    firstResponseDate: serverDate,
    pagesRetrieved: 1,
    paginationComplete: false,
    retrievalMethod: 'GitHub REST API, following every rel=next Link URL',
    state: 'inventory-in-progress',
  };
  const { issues, pullRequests: pulls } = partitionRecords(payload, cutoff);
  await atomicLines(INDEX_PATH, issues.map(indexRecord));
  await atomicLines(PULLS_PATH, pulls.map(indexPull));
  const next = nextLink(response.headers.get('link'));
  await atomicJson(ISSUE_CURSOR_PATH, { nextUrl: next, page: 2 });
  await atomicJson(SOURCE_PATH, source);
  console.log(
    `C1 ${cutoff}; saved page 1 with ${issues.length} issues, ${pulls.length} PR records; ${next ? 'pagination continues' : 'inventory complete'}.`,
  );
}

function indexRecord(record) {
  return {
    number: record.number,
    nodeId: record.node_id,
    title: record.title,
    url: record.html_url,
    state: record.state,
    stateReason: record.state_reason ?? null,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    closedAt: record.closed_at ?? null,
    comments: record.comments,
    labels: record.labels.map((label) => (typeof label === 'string' ? label : label.name)),
    body: record.body,
  };
}

function indexPull(record) {
  return {
    number: record.number,
    nodeId: record.node_id,
    title: record.title,
    url: record.html_url,
    createdAt: record.created_at,
    closedAt: record.closed_at ?? null,
    state: record.state,
    merged: Boolean(record.pull_request?.merged_at),
    body: record.body,
    labels: record.labels.map((label) => (typeof label === 'string' ? label : label.name)),
  };
}

async function inventory() {
  const source = await readJson(SOURCE_PATH);
  const cursor = await readJson(ISSUE_CURSOR_PATH);
  if (!source || !cursor) throw new Error('Run start first.');
  let nextUrl = cursor.nextUrl;
  let page = cursor.page;
  if (!nextUrl) {
    source.paginationComplete = true;
    source.state = 'inventory-complete';
    source.inventoryEndedAt = source.inventoryEndedAt ?? new Date().toISOString();
    source.issueCount = (await lines(INDEX_PATH)).length;
    source.pullRecordCount = (await lines(PULLS_PATH)).length;
    source.issueSetSha256 = createHash('sha256')
      .update(
        (await lines(INDEX_PATH))
          .map((issue) => issue.number)
          .sort((a, b) => a - b)
          .join('\n'),
      )
      .digest('hex');
    await atomicJson(SOURCE_PATH, source);
    console.log(
      `Inventory complete: ${source.issueCount} unique issues, ${source.pullRecordCount} pull-request records; ${source.issueSetSha256}.`,
    );
    return;
  }
  while (nextUrl) {
    const response = await get(nextUrl);
    const records = await response.json();
    if (!Array.isArray(records)) throw new Error(`Expected an array at listing page ${page}.`);
    const { issues: issueRecords, pullRequests: pullRecords } = partitionRecords(
      records,
      source.cutoff,
    );
    const existingIssues = await lines(INDEX_PATH);
    const existingPulls = await lines(PULLS_PATH);
    const knownIssues = new Set(existingIssues.map((record) => record.number));
    const knownPulls = new Set(existingPulls.map((record) => record.number));
    const uniqueIssues = issueRecords
      .filter((record) => !knownIssues.has(record.number))
      .map(indexRecord);
    const uniquePulls = pullRecords
      .filter((record) => !knownPulls.has(record.number))
      .map(indexPull);
    await atomicJson(join(PAGES_PATH, `${String(page).padStart(6, '0')}.json`), {
      requestedUrl: nextUrl,
      retrievedAt: new Date().toISOString(),
      serverDate: response.headers.get('date'),
      etag: response.headers.get('etag'),
      link: response.headers.get('link'),
      issueCount: issueRecords.length,
      pullCount: pullRecords.length,
      records,
    });
    await appendFile(
      INDEX_PATH,
      uniqueIssues.map((record) => `${JSON.stringify(record)}\n`).join(''),
      { mode: 0o600 },
    );
    await appendFile(
      PULLS_PATH,
      uniquePulls.map((record) => `${JSON.stringify(record)}\n`).join(''),
      {
        mode: 0o600,
      },
    );
    nextUrl = nextLink(response.headers.get('link'));
    page += 1;
    await atomicJson(ISSUE_CURSOR_PATH, { nextUrl, page });
    source.pagesRetrieved = page - 1;
    source.lastPageRetrievedAt = new Date().toISOString();
    source.lastPageDateHeader = response.headers.get('date');
    await atomicJson(SOURCE_PATH, source);
    console.log(
      `Page ${page - 1}: ${uniqueIssues.length} new issues, ${uniquePulls.length} PRs; ${nextUrl ? 'more pages' : 'last page reached'}.`,
    );
  }
  await inventory();
}

/**
 * GitHub's issue listing and search index can omit an otherwise reachable
 * issue (observed for #426). The single-issue endpoint still returns it, so
 * recover it into the inventory instead of treating the listing as complete.
 */
async function recoverIssue(number, seenCreatedAt) {
  const response = await get(new URL(`/repos/${REPOSITORY}/issues/${number}`, API));
  const record = await response.json();
  if (record.number !== number) throw new Error(`Recovery for #${number} returned another issue.`);
  if (record.pull_request) throw new Error(`Recovered #${number} is a pull request record.`);
  if (seenCreatedAt && record.created_at !== seenCreatedAt)
    throw new Error(`Recovered #${number} creation timestamp disagrees with GraphQL.`);
  const entry = { ...indexRecord(record), discoveredBy: 'single-issue reconciliation' };
  await appendFile(INDEX_PATH, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  console.warn(
    `Issue #${number} is absent from the REST listing; recovered through the single-issue endpoint.`,
  );
  return entry;
}

async function comments() {
  const source = await readJson(SOURCE_PATH);
  if (!source?.paginationComplete)
    throw new Error('Complete issue pagination before crawling comments.');
  const issues = await lines(INDEX_PATH);
  const cursor = await readJson(COMMENT_PAGE_CURSOR_PATH, { after: null, page: 1 });
  const done = new Set((await lines(COMMENT_INDEX_PATH)).map((record) => record.number));
  const issueByNumber = new Map(issues.map((issue) => [issue.number, issue]));
  let after = cursor.after;
  let page = cursor.page;
  let pagesThisRun = 0;
  while (true) {
    const result = await graphql(ISSUE_COMMENTS_QUERY, { after });
    const connection = result.payload.data?.repository?.issues;
    if (!connection || !Array.isArray(connection.nodes))
      throw new Error(`Malformed GraphQL issue connection at page ${page}.`);
    await atomicJson(join(GRAPHQL_PAGES_PATH, `${String(page).padStart(4, '0')}.json`), {
      requestedAfter: after,
      retrievedAt: new Date().toISOString(),
      serverDate: result.date,
      requestId: result.requestId,
      queryCost: result.cost,
      rateLimitRemaining: result.remaining,
      issuePageInfo: connection.pageInfo,
      issues: connection.nodes,
    });
    const records = connection.nodes.filter((record) => record.createdAt <= source.cutoff);
    const pageNumbers = new Set();
    for (const record of records) {
      let known = issueByNumber.get(record.number);
      if (!known) {
        known = await recoverIssue(record.number, record.createdAt);
        issueByNumber.set(record.number, known);
        issues.push(known);
      }
      if (done.has(record.number)) continue;
      pageNumbers.add(record.number);
      const declared = record.comments.totalCount;
      const comments = [...record.comments.nodes];
      let commentAfter = record.comments.pageInfo.endCursor;
      let commentPageCount = 1;
      let commentHasNext = record.comments.pageInfo.hasNextPage;
      const issueCommentDir = join(COMMENTS_PATH, String(record.number));
      const commentPages = [
        {
          page: 1,
          after: null,
          count: record.comments.nodes.length,
          retrievedAt: new Date().toISOString(),
          serverDate: result.date,
          requestId: result.requestId,
        },
      ];
      await atomicJson(join(issueCommentDir, '0001.json'), {
        issue: record.number,
        url: record.url,
        title: record.title,
        state: record.state,
        labels: (record.labels?.nodes ?? []).map((label) => label.name),
        retrievedAt: new Date().toISOString(),
        serverDate: result.date,
        countAtIssueInventory: known.comments,
        declaredCount: declared,
        page: 1,
        after: null,
        nextCursor: commentAfter,
        records: record.comments.nodes,
      });
      while (commentHasNext) {
        if (!commentAfter)
          throw new Error(
            `Issue #${record.number} has another comment page without an end cursor.`,
          );
        const requestedAfter = commentAfter;
        const continuation = await graphql(ISSUE_COMMENT_CONTINUATION_QUERY, {
          number: record.number,
          after: commentAfter,
        });
        const issueConnection = continuation.payload.data?.repository?.issue;
        if (!issueConnection || issueConnection.number !== record.number)
          throw new Error(`Issue #${record.number} comment continuation returned the wrong issue.`);
        comments.push(...issueConnection.comments.nodes);
        commentAfter = issueConnection.comments.pageInfo.endCursor;
        commentHasNext = issueConnection.comments.pageInfo.hasNextPage;
        commentPageCount += 1;
        commentPages.push({
          page: commentPageCount,
          after: requestedAfter,
          count: issueConnection.comments.nodes.length,
          retrievedAt: new Date().toISOString(),
          serverDate: continuation.date,
          requestId: continuation.requestId,
          queryCost: continuation.cost,
          rateLimitRemaining: continuation.remaining,
        });
        await atomicJson(
          join(issueCommentDir, `${String(commentPageCount).padStart(4, '0')}.json`),
          {
            issue: record.number,
            url: record.url,
            retrievedAt: new Date().toISOString(),
            serverDate: continuation.date,
            page: commentPageCount,
            after: requestedAfter,
            nextCursor: commentAfter,
            records: issueConnection.comments.nodes,
          },
        );
      }
      if (comments.length > declared && !commentHasNext)
        throw new Error(
          `Issue #${record.number} returned more comments than its connection count.`,
        );
      const row = {
        number: record.number,
        url: record.url,
        expectedAtInventory: known.comments,
        retrievable: comments.length,
        complete: comments.length === declared,
        pages: commentPageCount,
        pageEvidence: commentPages,
        retrievedAt: new Date().toISOString(),
        countDiscrepancy:
          comments.length === known.comments
            ? null
            : {
                declaredAtInventory: known.comments,
                retrievableAtDiscussionFetch: comments.length,
                missingDeclaredCount: Math.max(0, known.comments - comments.length),
                explanation:
                  'Issue listing count differs from the retrievable issue-comment connection; retain as unresolved until the source explains the discrepancy.',
              },
      };
      await appendFile(COMMENT_INDEX_PATH, `${JSON.stringify(row)}\n`, { mode: 0o600 });
      done.add(record.number);
    }
    after = connection.pageInfo.endCursor;
    page += 1;
    pagesThisRun += 1;
    await atomicJson(COMMENT_PAGE_CURSOR_PATH, { after, page });
    source.commentsPagesRetrieved = page - 1;
    source.commentsLastPageRetrievedAt = new Date().toISOString();
    source.commentQueryCostLastPage = result.cost;
    source.commentRateLimitRemainingLastPage = result.remaining;
    await atomicJson(SOURCE_PATH, source);
    console.log(
      `Discussion page ${page - 1}: ${pageNumbers.size} issue threads; ${done.size}/${issues.length} complete; GraphQL cost ${result.cost}, remaining ${result.remaining}.`,
    );
    if (!connection.pageInfo.hasNextPage) break;
    if (pagesThisRun >= 10) return;
  }
  const missing = issues.filter((issue) => !done.has(issue.number));
  if (missing.length) {
    // An issue present in the listing but absent from the GraphQL connection is a
    // source discrepancy: keep it in the corpus with an explicit gap instead of
    // dropping it or pretending the thread was read.
    for (const issue of missing) {
      await appendFile(
        COMMENT_INDEX_PATH,
        `${JSON.stringify({
          number: issue.number,
          url: issue.url,
          expectedAtInventory: issue.comments,
          retrievable: 0,
          complete: false,
          pages: 0,
          pageEvidence: [],
          retrievedAt: new Date().toISOString(),
          countDiscrepancy: null,
          sourceGap:
            'Issue is present in the REST listing but absent from the GraphQL issue connection; discussion content could not be retrieved.',
        })}\n`,
        { mode: 0o600 },
      );
    }
    console.warn(
      `${missing.length} listed issues are absent from the GraphQL issue connection; recorded as source gaps.`,
    );
  }
  source.commentsComplete = true;
  source.commentsCompletedAt = new Date().toISOString();
  source.commentThreadCount = issues.length;
  source.issueCount = issues.length;
  source.issueSetSha256 = createHash('sha256')
    .update(
      issues
        .map((issue) => issue.number)
        .sort((a, b) => a - b)
        .join('\n'),
    )
    .digest('hex');
  const commentRows = await lines(COMMENT_INDEX_PATH);
  source.commentCount = commentRows.reduce((sum, row) => sum + row.retrievable, 0);
  source.commentCountsAtInventory = commentRows.reduce(
    (sum, row) => sum + row.expectedAtInventory,
    0,
  );
  source.commentCountDiscrepancies = commentRows.filter((row) => row.countDiscrepancy);
  source.unresolvedDeclaredComments = source.commentCountDiscrepancies.reduce(
    (sum, row) => sum + row.countDiscrepancy.missingDeclaredCount,
    0,
  );
  await atomicJson(SOURCE_PATH, source);
  console.log(
    `Discussion comments complete: ${source.commentCount} comments across ${source.commentThreadCount} issues.`,
  );
}

async function status() {
  const source = await readJson(SOURCE_PATH);
  const issueCursor = await readJson(ISSUE_CURSOR_PATH);
  const inventoryRows = await lines(INDEX_PATH);
  const pulls = await lines(PULLS_PATH);
  const commentRows = await lines(COMMENT_INDEX_PATH);
  const ledgerRows = await lines(join(AUDIT, 'issue-ledger.jsonl'));
  console.log(
    JSON.stringify(
      {
        source,
        nextIssuePage: issueCursor?.nextUrl ? issueCursor.page : null,
        issueRows: inventoryRows.length,
        uniqueIssueNumbers: new Set(inventoryRows.map((issue) => issue.number)).size,
        pullRows: pulls.length,
        completedCommentThreads: commentRows.length,
        commentsRetrieved: commentRows.reduce((sum, row) => sum + row.retrievable, 0),
        commentCountDiscrepancies: commentRows.filter((row) => row.countDiscrepancy).length,
        ledgerRows: ledgerRows.length,
        ledgerReviewed: ledgerRows.filter((row) => row.review.status !== 'unreviewed').length,
        cacheDirectory: CACHE,
      },
      null,
      2,
    ),
  );
}

async function initializeLedger() {
  const source = await readJson(SOURCE_PATH);
  if (!source?.paginationComplete || !source.commentsComplete)
    throw new Error(
      'Complete issue and discussion retrieval before initializing the review ledger.',
    );
  const path = join(AUDIT, 'issue-ledger.jsonl');
  const existing = await lines(path);
  if (existing.length)
    throw new Error(`Review ledger already has ${existing.length} rows; refusing to overwrite it.`);
  const issues = await lines(INDEX_PATH);
  const discussions = new Map((await lines(COMMENT_INDEX_PATH)).map((row) => [row.number, row]));
  const rows = issues.map((issue) => createLedgerRecord(issue, discussions.get(issue.number)));
  if (
    rows.length !== source.issueCount ||
    new Set(rows.map((row) => row.number)).size !== rows.length
  )
    throw new Error('Review ledger does not match the frozen unique issue inventory.');
  await atomicLines(path, rows);
  console.log(`Initialized ${rows.length} individually trackable issue reviews at ${path}.`);
}

async function recordReview(options) {
  const number = Number(options.number);
  if (!Number.isInteger(number) || !options.assessment)
    throw new Error('Use ledger-review --number <issue> --assessment <json-file>.');
  const path = join(AUDIT, 'issue-ledger.jsonl');
  const rows = await lines(path);
  const index = rows.findIndex((row) => row.number === number);
  if (index < 0) throw new Error(`Issue #${number} is not in the frozen ledger.`);
  if (rows[index].review.status !== 'unreviewed')
    throw new Error(`Issue #${number} already has review status ${rows[index].review.status}.`);
  const assessment = await readJson(options.assessment);
  rows[index] = applyLedgerReview(rows[index], assessment);
  await atomicLines(path, rows);
  console.log(`Recorded ${rows[index].review.status} for issue #${number}.`);
}

async function importReviews(options) {
  if (!options.assessments) throw new Error('Use ledger-import --assessments <jsonl-file>.');
  const path = join(AUDIT, 'issue-ledger.jsonl');
  const rows = await lines(path);
  const assessments = await lines(options.assessments);
  if (assessments.length === 0) throw new Error('Assessment file is empty.');
  const updated = importLedgerReviews(rows, assessments);
  await atomicLines(path, updated);
  console.log(`Imported ${assessments.length} individual issue assessments.`);
}

async function buildFrontier() {
  const source = await readJson(SOURCE_PATH);
  if (!source?.paginationComplete || !source.commentsComplete)
    throw new Error('Complete issue and discussion retrieval before building the link frontier.');
  const path = join(AUDIT, 'link-frontier.jsonl');
  if ((await lines(path)).length)
    throw new Error(
      `Link frontier already exists at ${path}; refusing to replace reviewed states.`,
    );
  const issues = await lines(INDEX_PATH);
  const pullRequests = await lines(PULLS_PATH);
  const issueNumbers = new Set(issues.map((issue) => issue.number));
  const pullNumbers = new Set(pullRequests.map((pull) => pull.number));
  const edges = new Map();
  const addSource = (target, sourceIssue) => {
    const current = edges.get(target) ?? { sourceIssueNumbers: [], occurrences: 0 };
    current.occurrences += 1;
    if (!current.sourceIssueNumbers.includes(sourceIssue))
      current.sourceIssueNumbers.push(sourceIssue);
    edges.set(target, current);
  };
  const visitText = (text, sourceIssue) => {
    for (const target of extractEvidenceLinks(text ?? '')) addSource(target, sourceIssue);
  };
  for (const issue of issues) visitText(issue.body, issue.number);
  for (const folder of await readdir(COMMENTS_PATH)) {
    const number = Number(folder);
    if (!issueNumbers.has(number)) continue;
    for (const file of await readdir(join(COMMENTS_PATH, folder))) {
      const page = await readJson(join(COMMENTS_PATH, folder, file));
      for (const comment of page.records) visitText(comment.body, number);
    }
  }
  const rows = [...edges.entries()].map(([target, evidence]) => {
    if (target.startsWith('#')) {
      const number = Number(target.slice(1));
      const kind = issueNumbers.has(number)
        ? 'issue-reference'
        : pullNumbers.has(number)
          ? 'pull-reference'
          : 'unresolved-number-reference';
      return {
        target,
        url:
          kind === 'issue-reference'
            ? `https://github.com/${REPOSITORY}/issues/${number}`
            : kind === 'pull-reference'
              ? `https://github.com/${REPOSITORY}/pull/${number}`
              : null,
        kind,
        targetNumber: number,
        ...evidence,
        status: 'pending-relevance',
        disposition: null,
        reason: null,
      };
    }
    const kind =
      target.match(
        /github\.com\/[^/]+\/[^/]+\/(issues|pull|commit|blob|tree|discussions)\//,
      )?.[1] ?? 'github-link';
    return {
      target,
      url: target,
      kind,
      targetNumber: Number(target.match(/\/(?:issues|pull)\/(\d+)/)?.[1]) || null,
      ...evidence,
      status: 'pending-relevance',
      disposition: null,
      reason: null,
    };
  });
  rows.sort((a, b) => a.target.localeCompare(b.target));
  await atomicLines(path, rows);
  console.log(`Initialized ${rows.length} deduplicated evidence links at ${path}.`);
}

async function show(options) {
  const requested = options._?.map(Number) ?? [];
  if (!requested.length) throw new Error('Use show -- <issue> [<issue> ...]');
  const issues = new Map((await lines(INDEX_PATH)).map((issue) => [issue.number, issue]));
  for (const number of requested) {
    const issue = issues.get(number);
    if (!issue) throw new Error(`Issue #${number} is not in the frozen inventory.`);
    const folder = join(COMMENTS_PATH, String(number));
    const comments = [];
    for (const file of (await readdir(folder).catch(() => [])).sort()) {
      const page = await readJson(join(folder, file));
      comments.push(...page.records);
    }
    console.log(`\n===== #${number} [${issue.state}] ${issue.title}`);
    console.log(`labels=${issue.labels.join(',') || 'none'} created=${issue.createdAt}`);
    console.log(`url=${issue.url}`);
    console.log('--- body ---');
    console.log(issue.body ?? '(empty)');
    comments.forEach((comment, index) => {
      console.log(
        `--- comment ${index + 1} by ${comment.author?.login ?? 'ghost'} at ${comment.createdAt}`,
      );
      console.log(comment.body ?? '(empty)');
    });
  }
}

async function packet(options) {
  const reviews = new Set(
    (await lines(join(AUDIT, 'issue-ledger.jsonl')))
      .filter((row) => row.review.status !== 'unreviewed')
      .map((row) => row.number),
  );
  const start = Number(options.from ?? 0);
  const size = Number(options.size ?? 50);
  const issues = await lines(INDEX_PATH);
  const selected = issues.slice(start, start + size);
  if (!selected.length) throw new Error('Packet range is beyond the inventory.');
  const out = [];
  for (const issue of selected) {
    const folder = join(COMMENTS_PATH, String(issue.number));
    const comments = [];
    for (const file of (await readdir(folder).catch(() => [])).sort()) {
      const page = await readJson(join(folder, file));
      comments.push(...page.records);
    }
    out.push({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      stateReason: issue.stateReason,
      labels: issue.labels,
      createdAt: issue.createdAt,
      closedAt: issue.closedAt,
      url: issue.url,
      previouslyReviewed: reviews.has(issue.number),
      body: issue.body,
      comments: comments.map((comment) => ({
        author: comment.author?.login ?? 'ghost',
        createdAt: comment.createdAt,
        body: comment.body,
      })),
    });
  }
  const path = join(CACHE, 'packets', `packet-${String(start).padStart(4, '0')}.json`);
  await atomicJson(path, {
    from: start,
    size: selected.length,
    generatedAt: new Date().toISOString(),
    issues: out,
  });
  console.log(
    `${path}\npositions ${start + 1}-${start + selected.length}; ${out.reduce((sum, issue) => sum + issue.comments.length, 0)} comments`,
  );
}

async function main(argv) {
  const { command, options } = parseArgs(argv);
  if (options.cache)
    throw new Error('Set VARVE_GRAPHITE_CACHE_DIR to place the cache outside the repository.');
  if (command === 'start') return start();
  if (command === 'inventory') return inventory();
  if (command === 'comments') return comments();
  if (command === 'ledger') return initializeLedger();
  if (command === 'ledger-review') return recordReview(options);
  if (command === 'ledger-import') return importReviews(options);
  if (command === 'frontier') return buildFrontier();
  if (command === 'show') return show(options);
  if (command === 'packet') return packet(options);
  if (command === 'status') return status();
  if (command === 'hash') {
    const issueRows = await lines(INDEX_PATH);
    console.log(
      createHash('sha256')
        .update(
          issueRows
            .map((issue) => issue.number)
            .sort((a, b) => a - b)
            .join('\n'),
        )
        .digest('hex'),
    );
    return;
  }
  throw new Error(
    `Unknown command: ${command}. Use start, inventory, comments, ledger, ledger-review, ledger-import, frontier, show, packet, status, or hash.`,
  );
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
