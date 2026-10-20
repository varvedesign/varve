#!/usr/bin/env node

/** Resumable, paginated evidence capture for the Penpot issue tracker. */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPOSITORY = 'penpot/penpot';
const API = 'https://api.github.com';
const DEFAULT_AUDIT = 'docs/audits/penpot';
const USER_AGENT = 'Varve-Penpot-Audit/1.0';

function atomicWrite(file, contents) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, contents, { mode: 0o600 });
  renameSync(temporary, file);
}

function writeJson(file, value) {
  atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function parseLinkHeader(header) {
  if (!header) return [];
  return header
    .split(/,\s*(?=<)/u)
    .map((part) => {
      const match = /^<([^>]+)>;\s*rel="([^"]+)"/u.exec(part);
      return match ? { url: match[1], rel: match[2] } : null;
    })
    .filter(Boolean);
}

export function getNextUrl(header) {
  return parseLinkHeader(header).find((link) => link.rel === 'next')?.url ?? null;
}

export function commentResumeUrl(cached, initialUrl) {
  return cached ? cached.nextUrl : initialUrl;
}

export function uniqueById(items) {
  const unique = new Map();
  for (const item of items) unique.set(item.id, item);
  return [...unique.values()];
}

export function compareCommentSets(before, after, beforeCutoff, afterCutoff) {
  const beforeById = new Map(
    uniqueById(
      before.filter(
        (comment) => comment.created_at <= beforeCutoff && comment.updated_at <= beforeCutoff,
      ),
    ).map((comment) => [comment.id, comment]),
  );
  const afterAtCutoff = uniqueById(after.filter((comment) => comment.created_at <= afterCutoff));
  const deferredEdits = afterAtCutoff.filter((comment) => comment.updated_at > afterCutoff);
  const afterById = new Map(
    afterAtCutoff
      .filter((comment) => comment.updated_at <= afterCutoff)
      .map((comment) => [comment.id, comment]),
  );
  const changes = [];
  for (const [id, comment] of afterById) {
    const old = beforeById.get(id);
    if (!old) {
      changes.push({ type: 'new-comment', commentId: id, updatedAt: comment.updated_at });
      continue;
    }
    if (old.updated_at !== comment.updated_at || old.body !== comment.body) {
      changes.push({
        type: 'edited-comment',
        commentId: id,
        beforeUpdatedAt: old.updated_at,
        afterUpdatedAt: comment.updated_at,
        beforeBodySha256: sha256(old.body ?? ''),
        afterBodySha256: sha256(comment.body ?? ''),
      });
    }
  }
  for (const id of beforeById.keys()) {
    if (!afterById.has(id) && !deferredEdits.some((comment) => comment.id === id))
      changes.push({ type: 'removed-comment', commentId: id });
  }
  for (const comment of deferredEdits)
    changes.push({
      type: beforeById.has(comment.id) ? 'post-cutoff-comment-edit' : 'post-cutoff-comment',
      commentId: comment.id,
      updatedAt: comment.updated_at,
      disposition: 'queued-for-follow-on',
    });
  return changes;
}

export function compareInventories(previousRecords, currentRecords, cutoffAt = null) {
  const previous = new Map(previousRecords.map((record) => [record.nodeId, record]));
  const current = new Map(currentRecords.map((record) => [record.nodeId, record]));
  const changes = [];
  for (const record of currentRecords) {
    const before = previous.get(record.nodeId);
    if (!before) {
      if (record.includedAtCutoff && record.kind === 'issue') {
        changes.push({
          type: 'new-issue',
          nodeId: record.nodeId,
          number: record.number,
          url: record.url,
        });
      }
      continue;
    }
    if (cutoffAt && record.updatedAt > cutoffAt) {
      changes.push({
        type: 'post-cutoff-evidence-change',
        nodeId: record.nodeId,
        number: record.number,
        url: record.url,
        updatedAt: record.updatedAt,
        disposition: 'queued-for-follow-on',
      });
      continue;
    }
    const fields = ['state', 'updatedAt', 'bodySha256', 'commentCount'];
    const changedFields = fields.filter((field) => before[field] !== record[field]);
    if (changedFields.length) {
      changes.push({
        type: 'changed-evidence',
        nodeId: record.nodeId,
        number: record.number,
        url: record.url,
        changedFields,
        before: Object.fromEntries(changedFields.map((field) => [field, before[field]])),
        after: Object.fromEntries(changedFields.map((field) => [field, record[field]])),
      });
    }
  }
  for (const record of previousRecords) {
    if (!current.has(record.nodeId) && record.kind === 'issue' && record.includedAtCutoff) {
      changes.push({
        type: 'missing-at-cutoff',
        nodeId: record.nodeId,
        number: record.number,
        url: record.url,
        before: { state: record.state, updatedAt: record.updatedAt },
        disposition: 'requires-transfer-or-removal-investigation',
      });
    }
  }
  return changes;
}

export function completionRecordErrors(record) {
  const errors = [];
  if (record.evidenceUpdatedAfterCutoff === true)
    errors.push(`issue #${record.number} source evidence changed after the frozen cutoff`);
  if (record.researchStatus === 'reviewed') {
    if (typeof record.assessment !== 'string' || !record.assessment.trim())
      errors.push(`reviewed issue #${record.number} has no assessment`);
    if (typeof record.sourcePagePath !== 'string' || typeof record.bodySha256 !== 'string')
      errors.push(`reviewed issue #${record.number} has no source evidence pointer`);
    if (record.commentCount > 0 && record.commentCoverage !== 'complete')
      errors.push(`reviewed issue #${record.number} has incomplete discussion evidence`);
    if (typeof record.owner !== 'string' || !record.owner.trim())
      errors.push(`reviewed issue #${record.number} has no owner`);
    if (!record.disposition || record.disposition === 'pending-review')
      errors.push(`reviewed issue #${record.number} has no final disposition`);
  }
  if (record.engineeringStatus === 'closed') {
    if (
      record.researchStatus !== 'reviewed' ||
      !record.assessment ||
      !record.owner ||
      !record.disposition ||
      record.disposition === 'pending-review'
    )
      errors.push(
        `closed engineering status for issue #${record.number} lacks reviewed evidence and disposition`,
      );
    if (typeof record.engineeringEvidence !== 'string' || !record.engineeringEvidence.trim())
      errors.push(
        `closed engineering status for issue #${record.number} has no engineering evidence`,
      );
    if (record.disposition === 'varve-defect-found-repair-implemented-validation-pending')
      errors.push(
        `issue #${record.number} closes engineering before validation/integration evidence`,
      );
  }
  return errors;
}

export function sourceRecordErrors(record, item, pagePath, pageEtag, cutoffAt = null) {
  const errors = [];
  if (!item) return [`ledger issue #${record.number} has no matching raw source item`];
  if (record.sourcePagePath !== pagePath)
    errors.push(`ledger issue #${record.number} source page pointer mismatch`);
  if (record.sourcePageETag !== pageEtag)
    errors.push(`ledger issue #${record.number} source page validator mismatch`);
  if (cutoffAt !== null) {
    const changedAfterCutoff = item.updated_at > cutoffAt;
    if (
      (record.researchStatus === 'reviewed' &&
        record.evidenceUpdatedAfterCutoff !== changedAfterCutoff) ||
      (record.evidenceUpdatedAfterCutoff !== undefined &&
        record.evidenceUpdatedAfterCutoff !== changedAfterCutoff)
    )
      errors.push(`ledger issue #${record.number} cutoff marker differs from raw source timestamp`);
  }
  const kind = item.pull_request ? 'pull-request' : 'issue';
  if (
    record.id !== item.id ||
    record.nodeId !== item.node_id ||
    record.number !== item.number ||
    record.url !== item.html_url ||
    record.kind !== kind ||
    record.state !== item.state ||
    record.createdAt !== item.created_at ||
    record.updatedAt !== item.updated_at ||
    record.closedAt !== item.closed_at ||
    record.commentCount !== item.comments ||
    record.bodyPresent !== (item.body !== null) ||
    record.bodySha256 !== sha256(item.body ?? '') ||
    (cutoffAt !== null && record.includedAtCutoff !== item.created_at <= cutoffAt) ||
    JSON.stringify(record.labels) !== JSON.stringify((item.labels ?? []).map((label) => label.name))
  )
    errors.push(`ledger issue #${record.number} identity or body differs from raw source item`);
  return errors;
}

function cacheRoot(cwd = process.cwd()) {
  const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd,
    encoding: 'utf8',
  }).trim();
  return resolve(cwd, commonDir, 'varve-research', 'penpot');
}

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export async function requestJson(url, authToken, { etag = null } = {}) {
  let attempt = 0;
  while (true) {
    attempt += 1;
    let response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${authToken}`,
          'User-Agent': USER_AGENT,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(etag ? { 'If-None-Match': etag } : {}),
        },
      });
    } catch (error) {
      if (attempt >= 6) throw error;
      await delay(Math.min(1000 * 2 ** (attempt - 1), 30000));
      continue;
    }

    if (response.status === 304) {
      return { notModified: true, response, value: null };
    }
    if (response.ok) {
      return { notModified: false, response, value: await response.json() };
    }

    if (response.status === 403 || response.status === 429 || response.status >= 500) {
      if (attempt >= 6) {
        throw new Error(`GitHub API ${response.status} for ${url}`);
      }
      const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
      const retryAfter = Number(response.headers.get('retry-after')) * 1000;
      const wait =
        retryAfter || (reset > Date.now() ? reset - Date.now() + 1000 : 1000 * 2 ** (attempt - 1));
      await delay(Math.min(Math.max(wait, 1000), 60000));
      continue;
    }
    throw new Error(`GitHub API ${response.status} for ${url}`);
  }
}

function findCachedPage(directory, requestedUrl, filePrefix) {
  if (!existsSync(directory)) return null;
  const file = readdirSync(directory)
    .filter((name) => name.startsWith(filePrefix) && name.endsWith('.json'))
    .map((name) => join(directory, name))
    .find((path) => {
      try {
        return readJson(path).requestedUrl === requestedUrl;
      } catch {
        return false;
      }
    });
  return file ? readJson(file) : null;
}

export function reuseCachedResponse(result, cached) {
  if (!result.notModified) return result;
  if (!cached) throw new Error('GitHub returned 304 without a matching cached response');
  const metadata = { etag: cached.etag, 'last-modified': cached.lastModified, link: cached.link };
  return {
    ...result,
    value: cached.items,
    response: { headers: { get: (name) => metadata[name.toLowerCase()] ?? null } },
  };
}

function scopeDir(auditDir, cutoff) {
  return join(auditDir, 'snapshots', cutoff.toUpperCase());
}

function cacheFile(cacheDir, name) {
  return join(cacheDir, name);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeIssue(issue, cutoffAt, snapshot) {
  const isPullRequest = Boolean(issue.pull_request);
  return {
    id: issue.id,
    nodeId: issue.node_id,
    number: issue.number,
    url: issue.html_url,
    title: issue.title,
    state: issue.state,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    closedAt: issue.closed_at,
    bodyPresent: issue.body !== null,
    labels: (issue.labels ?? []).map((label) => label.name),
    commentCount: issue.comments,
    kind: isPullRequest ? 'pull-request' : 'issue',
    pullRequestUrl: issue.pull_request?.html_url ?? null,
    includedAtCutoff: issue.created_at <= cutoffAt,
    fetchedAt: snapshot.fetchedAt,
    sourcePagePath: snapshot.path,
    sourcePageETag: snapshot.etag,
    sourcePageLastModified: snapshot.lastModified,
    bodySha256: sha256(issue.body ?? ''),
    evidenceUpdatedAfterCutoff: issue.updated_at > cutoffAt,
    researchStatus: 'unreviewed',
    engineeringStatus: 'unassessed',
    disposition: 'pending-review',
    commentCoverage: issue.comments === 0 ? 'not-needed' : 'not-fetched',
  };
}

export function reconcileInventory(records) {
  const unique = new Map();
  const seenNumbers = new Map();
  const duplicateNumbers = new Set();
  const duplicateStableIds = new Set();
  for (const record of records) {
    const key = record.nodeId ?? `${record.kind}:${record.number}`;
    if (unique.has(key)) {
      duplicateStableIds.add(key);
      continue;
    }
    unique.set(key, record);
    const numberKey = `${record.kind}:${record.number}`;
    if (seenNumbers.has(numberKey) && seenNumbers.get(numberKey) !== key)
      duplicateNumbers.add(record.number);
    else seenNumbers.set(numberKey, key);
  }
  const included = [...unique.values()].filter((record) => record.includedAtCutoff);
  const issues = included.filter((record) => record.kind === 'issue');
  const pullRequests = included.filter((record) => record.kind === 'pull-request');
  const stateCounts = (items) => ({
    open: items.filter((item) => item.state === 'open').length,
    closed: items.filter((item) => item.state === 'closed').length,
  });
  return {
    totalRecords: included.length,
    issueCount: issues.length,
    pullRequestCount: pullRequests.length,
    issueStates: stateCounts(issues),
    pullRequestStates: stateCounts(pullRequests),
    duplicateNumbers: [...duplicateNumbers].sort((a, b) => a - b),
    duplicateStableIds: [...duplicateStableIds].sort(),
    bodylessIssues: issues.filter((item) => !item.bodyPresent).map((item) => item.number),
    unresolvedComments: issues
      .filter((item) => item.commentCount > 0 && item.commentCoverage !== 'complete')
      .map((item) => item.number),
    pendingResearch: issues.filter((item) => item.researchStatus !== 'reviewed').length,
    pendingEngineering: issues.filter((item) => item.engineeringStatus !== 'closed').length,
  };
}

function reconciliationSummary(result) {
  return {
    totalRecords: result.totalRecords,
    issueCount: result.issueCount,
    pullRequestCount: result.pullRequestCount,
    issueStates: result.issueStates,
    pullRequestStates: result.pullRequestStates,
    duplicateNumberCount: result.duplicateNumbers.length,
    duplicateStableIdCount: result.duplicateStableIds.length,
    bodylessIssueCount: result.bodylessIssues.length,
    unresolvedCommentCount: result.unresolvedComments.length,
    pendingResearch: result.pendingResearch,
    pendingEngineering: result.pendingEngineering,
  };
}

export function reconcileSupplemental(records, supplemental) {
  const knownIds = new Set(records.map((record) => record.nodeId ?? String(record.id)));
  const knownNumbers = new Set(records.map((record) => `${record.kind}:${record.number}`));
  const duplicateStableIds = [];
  const duplicateNumbers = [];
  for (const record of supplemental) {
    const id = record.nodeId ?? String(record.id);
    const number = `${record.kind}:${record.number}`;
    if (knownIds.has(id)) duplicateStableIds.push(id);
    if (knownNumbers.has(number)) duplicateNumbers.push(record.number);
    knownIds.add(id);
    knownNumbers.add(number);
  }
  const issues = supplemental.filter((record) => record.kind === 'issue');
  return {
    issueCount: issues.length,
    pendingResearch: issues.filter((record) => record.researchStatus !== 'reviewed').length,
    pendingEngineering: issues.filter((record) => record.engineeringStatus !== 'closed').length,
    duplicateStableIds,
    duplicateNumbers,
  };
}

function loadRecords(snapshotDir) {
  const file = join(snapshotDir, 'issues.ndjson');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function loadSupplemental(snapshotDir) {
  const file = join(snapshotDir, 'supplemental.ndjson');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function validateSupplementalEvidence(record, manifest, cacheDirectory) {
  const errors = completionRecordErrors(record).map((error) =>
    error.replace('issue #', 'supplemental issue #'),
  );
  if (record.kind !== 'issue') errors.push(`supplemental record #${record.number} is not an issue`);
  if (!record.issueResponsePath || !record.commentsResponsePath)
    errors.push(`supplemental issue #${record.number} has no raw response paths`);
  if (!record.issueResponseSha256 || !record.commentsResponseSha256)
    errors.push(`supplemental issue #${record.number} has no raw response checksums`);
  if (!record.issueEtag || !record.retrievedAt)
    errors.push(`supplemental issue #${record.number} has no retrieval validators or time`);
  if (record.updatedAt > manifest.cutoffAt)
    errors.push(`supplemental issue #${record.number} changed after the cutoff`);
  if (errors.length) return errors;

  const issuePath = join(
    cacheDirectory,
    manifest.cutoff.toUpperCase(),
    'supplemental',
    record.issueResponsePath,
  );
  const commentsPath = join(
    cacheDirectory,
    manifest.cutoff.toUpperCase(),
    'supplemental',
    record.commentsResponsePath,
  );
  const issueHttpPath = issuePath.replace(/\.json$/, '.http');
  const commentsHttpPath = commentsPath.replace(/\.json$/, '.http');
  for (const path of [issuePath, commentsPath, issueHttpPath, commentsHttpPath]) {
    if (!existsSync(path))
      errors.push(`supplemental issue #${record.number} is missing cached response ${path}`);
  }
  if (errors.length) return errors;

  const issueRaw = readFileSync(issuePath);
  const commentsRaw = readFileSync(commentsPath);
  const issueHttp = readFileSync(issueHttpPath, 'utf8');
  const commentsHttp = readFileSync(commentsHttpPath, 'utf8');
  if (sha256(issueRaw) !== record.issueResponseSha256)
    errors.push(`supplemental issue #${record.number} response checksum mismatch`);
  if (sha256(commentsRaw) !== record.commentsResponseSha256)
    errors.push(`supplemental issue #${record.number} comments checksum mismatch`);
  if (!issueHttp.includes(record.issueEtag) || !commentsHttp.includes(record.commentsEtag))
    errors.push(`supplemental issue #${record.number} validator is absent from raw headers`);
  const issue = JSON.parse(issueRaw.toString('utf8'));
  const comments = JSON.parse(commentsRaw.toString('utf8'));
  if (issue.id !== record.id || issue.number !== record.number || issue.html_url !== record.url)
    errors.push(`supplemental issue #${record.number} identity does not match cached response`);
  if (sha256(issue.body ?? '') !== record.bodySha256)
    errors.push(`supplemental issue #${record.number} body checksum mismatch`);
  if (issue.comments !== comments.length || comments.length !== record.commentCount)
    errors.push(`supplemental issue #${record.number} comment count mismatch`);
  if (
    comments.some(
      (comment) => comment.created_at > manifest.cutoffAt || comment.updated_at > manifest.cutoffAt,
    )
  )
    errors.push(`supplemental issue #${record.number} includes comment evidence after the cutoff`);
  return errors;
}

function persistRecords(snapshotDir, records) {
  const content = `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  atomicWrite(join(snapshotDir, 'issues.ndjson'), content);
  return sha256(content);
}

function writeCutoffDiff(auditDir, currentManifest, records) {
  const previousDirectory = scopeDir(auditDir, 'C1');
  if (!existsSync(join(previousDirectory, 'issues.ndjson'))) return;
  const previousRecords = loadRecords(previousDirectory);
  const changes = compareInventories(previousRecords, records, currentManifest.cutoffAt);
  atomicWrite(
    join(scopeDir(auditDir, 'C2'), 'changes-from-C1.ndjson'),
    `${changes.map((change) => JSON.stringify(change)).join('\n')}${changes.length ? '\n' : ''}`,
  );
}

function writeCommentCutoffDiff(auditDir, cacheDir, currentManifest, records) {
  if (currentManifest.cutoff !== 'C2') return;
  const previousDirectory = scopeDir(auditDir, 'C1');
  const previousManifest = readJson(join(previousDirectory, 'manifest.json'));
  const previousById = new Map(
    loadRecords(previousDirectory).map((record) => [record.nodeId, record]),
  );
  const previousCache = join(cacheDir, 'C1', 'comments');
  const currentCache = join(cacheDir, 'C2', 'comments');
  const changes = [];
  for (const record of records) {
    if (!record.includedAtCutoff || record.kind !== 'issue') continue;
    const beforeRecord = previousById.get(record.nodeId);
    if (!beforeRecord) continue;
    const beforePath = join(previousCache, `issue-${beforeRecord.number}.json`);
    const afterPath = join(currentCache, `issue-${record.number}.json`);
    if (record.commentCount > 0 && !existsSync(afterPath)) continue;
    const beforeComments = existsSync(beforePath) ? readJson(beforePath).comments : [];
    const afterComments = existsSync(afterPath) ? readJson(afterPath).comments : [];
    for (const change of compareCommentSets(
      beforeComments,
      afterComments,
      previousManifest.cutoffAt,
      currentManifest.cutoffAt,
    )) {
      changes.push({ issueNumber: record.number, issueUrl: record.url, ...change });
    }
  }
  const file = join(scopeDir(auditDir, 'C2'), 'comment-changes-from-C1.ndjson');
  atomicWrite(
    file,
    `${changes.map((change) => JSON.stringify(change)).join('\n')}${changes.length ? '\n' : ''}`,
  );
  currentManifest.commentChangesFromC1Count = changes.length;
}

function updateFollowOnQueue(auditDir, cutoff, records) {
  const file = join(auditDir, 'follow-on.ndjson');
  const existing = existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
  const byKey = new Map(existing.map((entry) => [`${entry.cutoff}:${entry.nodeId}`, entry]));
  for (const record of records) {
    if (record.kind !== 'issue') continue;
    const createdAfterCutoff = !record.includedAtCutoff;
    const updatedAfterCutoff =
      cutoff.toUpperCase() === 'C2' && record.evidenceUpdatedAfterCutoff === true;
    if (!createdAfterCutoff && !updatedAfterCutoff) continue;
    const entry = {
      cutoff: cutoff.toUpperCase(),
      nodeId: record.nodeId,
      number: record.number,
      url: record.url,
      createdAt: record.createdAt,
      ...(record.updatedAt ? { updatedAt: record.updatedAt } : {}),
      reason: createdAfterCutoff ? 'created-after-cutoff' : 'evidence-updated-after-cutoff',
      status: 'queued-for-later-cutoff',
    };
    byKey.set(`${entry.cutoff}:${entry.nodeId}`, entry);
  }
  const content = [...byKey.values()].map((entry) => JSON.stringify(entry)).join('\n');
  atomicWrite(file, content ? `${content}\n` : '');
}

async function startInventory({ auditDir, cacheDir, cutoff }) {
  const directory = scopeDir(auditDir, cutoff);
  const cache = join(cacheDir, cutoff.toUpperCase(), 'issues');
  mkdirSync(cache, { recursive: true });
  mkdirSync(directory, { recursive: true });
  const manifestPath = join(directory, 'manifest.json');
  let manifest;
  if (existsSync(manifestPath)) {
    manifest = readJson(manifestPath);
    if (manifest.cutoff !== cutoff.toUpperCase()) throw new Error('Cutoff name mismatch');
    if (!manifest.crawlStartedAt) {
      const startedAt = new Date().toISOString();
      manifest.cutoffAt = startedAt;
      manifest.crawlStartedAt = startedAt;
      manifest.issueNextUrl = `${API}/repos/${REPOSITORY}/issues?state=all&sort=created&direction=asc&per_page=100`;
      manifest.lastUpdatedAt = startedAt;
      writeJson(manifestPath, manifest);
    }
  } else {
    const startedAt = new Date().toISOString();
    manifest = {
      schemaVersion: 1,
      source: `https://github.com/${REPOSITORY}/issues`,
      repository: REPOSITORY,
      cutoff: cutoff.toUpperCase(),
      cutoffAt: startedAt,
      crawlStartedAt: startedAt,
      crawlEndedAt: null,
      retrievalMethod: 'GitHub REST API, all states, ascending creation order, Link-following',
      issueNextUrl: `${API}/repos/${REPOSITORY}/issues?state=all&sort=created&direction=asc&per_page=100`,
      issuePages: 0,
      issuePageChecksums: [],
      sourceVersion: null,
      inventoryComplete: false,
      commentsComplete: false,
      lastUpdatedAt: startedAt,
    };
    writeJson(manifestPath, manifest);
  }

  const authToken = token();
  if (!manifest.sourceVersion) {
    const source = await requestJson(
      `${API}/repos/${REPOSITORY}/commits/${encodeURIComponent('develop')}`,
      authToken,
    );
    manifest.sourceVersion = source.value.sha;
    manifest.sourceVersionRef = 'develop';
    manifest.sourceVersionFetchedAt = new Date().toISOString();
    writeJson(manifestPath, manifest);
  }

  let nextUrl = manifest.issueNextUrl;
  let pageIndex = manifest.issuePages;
  while (nextUrl) {
    const fetchedAt = new Date().toISOString();
    const cached =
      findCachedPage(cache, nextUrl, 'page-') ??
      (cutoff.toUpperCase() === 'C2'
        ? findCachedPage(join(cacheDir, 'C1', 'issues'), nextUrl, 'page-')
        : null);
    const result = reuseCachedResponse(
      await requestJson(nextUrl, authToken, cached?.etag ? { etag: cached.etag } : {}),
      cached,
    );
    const pagePath = cacheFile(cache, `page-${String(pageIndex + 1).padStart(4, '0')}.json`);
    const body = JSON.stringify(result.value);
    const record = {
      requestedUrl: nextUrl,
      fetchedAt,
      etag: result.response.headers.get('etag'),
      lastModified: result.response.headers.get('last-modified'),
      link: result.response.headers.get('link'),
      sha256: sha256(body),
      items: result.value,
    };
    writeJson(pagePath, record);
    nextUrl = getNextUrl(record.link);
    pageIndex += 1;
    manifest.issuePages = pageIndex;
    manifest.issueNextUrl = nextUrl;
    manifest.lastUpdatedAt = fetchedAt;
    manifest.issuePageChecksums.push({
      path: pagePath.slice(cacheDir.length + 1),
      sha256: record.sha256,
    });
    writeJson(manifestPath, manifest);
    if (pageIndex % 10 === 0) process.stdout.write(`Fetched ${pageIndex} issue-list pages\n`);
  }

  // Re-read all cached pages, including those from a prior interrupted run.
  // The continuation URL is committed after every response, before the
  // complete tracked ledger is rewritten, so this cache is the resume source.
  const allCachedPages = [];
  for (let page = 1; page <= manifest.issuePages; page += 1) {
    const pagePath = cacheFile(cache, `page-${String(page).padStart(4, '0')}.json`);
    if (!existsSync(pagePath)) throw new Error(`Missing cached issue page ${page}`);
    const pageSnapshot = readJson(pagePath);
    const relativePath = pagePath.slice(cacheDir.length + 1);
    allCachedPages.push(
      ...pageSnapshot.items.map((issue) => ({
        issue,
        fetchedAt: pageSnapshot.fetchedAt,
        path: relativePath,
        etag: pageSnapshot.etag,
        lastModified: pageSnapshot.lastModified,
      })),
    );
  }
  const existing = loadRecords(directory);
  const incoming = allCachedPages.map((issue) =>
    normalizeIssue(issue.issue, manifest.cutoffAt, issue),
  );
  const recordsByNodeId = new Map(existing.map((record) => [record.nodeId, record]));
  for (const record of incoming) {
    const previous = recordsByNodeId.get(record.nodeId);
    if (previous) {
      recordsByNodeId.set(record.nodeId, {
        ...previous,
        ...record,
        ...Object.fromEntries(
          Object.entries(previous).filter(
            ([key]) => key.startsWith('comment') || key.startsWith('comments'),
          ),
        ),
        researchStatus: previous.researchStatus,
        engineeringStatus: previous.engineeringStatus,
        disposition: previous.disposition,
      });
    } else {
      recordsByNodeId.set(record.nodeId, record);
    }
  }
  const records = [...recordsByNodeId.values()].sort((a, b) => a.number - b.number);
  const ledgerSha256 = persistRecords(directory, records);
  updateFollowOnQueue(auditDir, cutoff, records);
  if (cutoff.toUpperCase() === 'C2') writeCutoffDiff(auditDir, manifest, records);
  manifest.inventoryComplete = true;
  manifest.crawlEndedAt = new Date().toISOString();
  manifest.issuesLedgerSha256 = ledgerSha256;
  manifest.lastUpdatedAt = manifest.crawlEndedAt;
  writeJson(manifestPath, manifest);
  writeJson(
    join(directory, 'reconciliation.json'),
    reconciliationSummary(reconcileInventory(records)),
  );
  process.stdout.write(
    `${JSON.stringify({ cutoff: manifest.cutoff, ...reconciliationSummary(reconcileInventory(records)) }, null, 2)}\n`,
  );
}

async function fetchComments({ auditDir, cacheDir, cutoff }) {
  const directory = scopeDir(auditDir, cutoff);
  const manifestPath = join(directory, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`No ${cutoff} inventory; run inventory first`);
  const manifest = readJson(manifestPath);
  if (!manifest.inventoryComplete) throw new Error(`The ${cutoff} inventory is incomplete`);
  const cache = join(cacheDir, cutoff.toUpperCase(), 'comments');
  mkdirSync(cache, { recursive: true });
  const records = loadRecords(directory);
  const authToken = token();
  let completed = 0;

  for (const record of records) {
    if (!record.includedAtCutoff || record.kind !== 'issue' || record.commentCount === 0) continue;
    if (record.commentCoverage === 'complete') continue;
    const cacheFilePath = join(cache, `issue-${record.number}.json`);
    const cached = existsSync(cacheFilePath) ? readJson(cacheFilePath) : null;
    const initialUrl = `${API}/repos/${REPOSITORY}/issues/${record.number}/comments?per_page=100`;
    let nextUrl = commentResumeUrl(cached, initialUrl);
    const comments = cached?.comments ?? [];
    let pages = cached?.pageRequests ?? cached?.pages ?? 0;

    while (nextUrl) {
      const fetchedAt = new Date().toISOString();
      const cached =
        findCachedPage(cache, nextUrl, `issue-${record.number}-page-`) ??
        (cutoff.toUpperCase() === 'C2'
          ? findCachedPage(
              join(cacheDir, 'C1', 'comments'),
              nextUrl,
              `issue-${record.number}-page-`,
            )
          : null);
      const result = reuseCachedResponse(
        await requestJson(nextUrl, authToken, cached?.etag ? { etag: cached.etag } : {}),
        cached,
      );
      const body = JSON.stringify(result.value);
      const pageRecord = {
        requestedUrl: nextUrl,
        fetchedAt,
        etag: result.response.headers.get('etag'),
        lastModified: result.response.headers.get('last-modified'),
        link: result.response.headers.get('link'),
        sha256: sha256(body),
        items: result.value,
      };
      writeJson(
        join(cache, `issue-${record.number}-page-${String(pages + 1).padStart(4, '0')}.json`),
        pageRecord,
      );
      comments.push(...result.value);
      nextUrl = getNextUrl(result.response.headers.get('link'));
      pages += 1;
      writeJson(cacheFilePath, {
        issueNumber: record.number,
        comments,
        pages,
        pageRequests: pages,
        nextUrl,
        updatedAt: fetchedAt,
      });
    }
    const normalizedComments = uniqueById(comments);
    const pageUrls = [];
    for (let pageIndex = 1; pageIndex <= pages; pageIndex += 1) {
      const pagePath = join(
        cache,
        `issue-${record.number}-page-${String(pageIndex).padStart(4, '0')}.json`,
      );
      if (existsSync(pagePath)) pageUrls.push(readJson(pagePath).requestedUrl);
    }
    const uniquePageUrls = [...new Set(pageUrls)];
    writeJson(cacheFilePath, {
      issueNumber: record.number,
      comments: normalizedComments,
      pages: uniquePageUrls.length,
      pageRequests: pages,
      pageUrls: uniquePageUrls,
      nextUrl: null,
      updatedAt: new Date().toISOString(),
    });
    const atCutoff = normalizedComments.filter(
      (comment) =>
        comment.created_at <= manifest.cutoffAt && comment.updated_at <= manifest.cutoffAt,
    );
    record.commentCoverage = 'complete';
    record.commentCountAtCutoff = atCutoff.length;
    record.commentCachePath = `varve-research/penpot/${cutoff.toUpperCase()}/comments/issue-${record.number}.json`;
    record.commentCacheSha256 = sha256(JSON.stringify(atCutoff));
    record.commentsFetchedAt = new Date().toISOString();
    completed += 1;
    if (completed % 50 === 0) {
      persistRecords(directory, records);
      process.stdout.write(
        `Completed comment threads for ${completed} issues; current #${record.number}\n`,
      );
    }
  }

  manifest.commentsComplete = records
    .filter((record) => record.includedAtCutoff && record.kind === 'issue')
    .every((record) => record.commentCoverage === 'complete' || record.commentCount === 0);
  manifest.commentsCompletedAt = new Date().toISOString();
  manifest.issuesLedgerSha256 = persistRecords(directory, records);
  writeJson(manifestPath, manifest);
  const reconciliation = reconcileInventory(records);
  writeJson(join(directory, 'reconciliation.json'), reconciliationSummary(reconciliation));
  process.stdout.write(
    `${JSON.stringify({ cutoff: manifest.cutoff, commentsComplete: manifest.commentsComplete, completedThisRun: completed, ...reconciliationSummary(reconciliation) }, null, 2)}\n`,
  );
}

function normalizeCommentCaches({ auditDir, cacheDir, cutoff }) {
  const directory = scopeDir(auditDir, cutoff);
  const manifestPath = join(directory, 'manifest.json');
  const manifest = readJson(manifestPath);
  if (cutoff.toUpperCase() === 'C2' && !manifest.commentsComplete)
    throw new Error('Cannot compare C2 discussion evidence until the comment crawl is complete');
  const records = loadRecords(directory);
  const commentDirectory = join(cacheDir, cutoff.toUpperCase(), 'comments');
  let removedCopies = 0;
  let normalizedThreads = 0;
  for (const record of records) {
    if (!record.includedAtCutoff || record.kind !== 'issue' || record.commentCount === 0) continue;
    const aggregatePath = join(commentDirectory, `issue-${record.number}.json`);
    if (!existsSync(aggregatePath)) continue;
    const aggregate = readJson(aggregatePath);
    const comments = uniqueById(aggregate.comments);
    removedCopies += aggregate.comments.length - comments.length;
    const pageRequests = aggregate.pageRequests ?? aggregate.pages;
    const pageUrls = [];
    for (let pageIndex = 1; pageIndex <= pageRequests; pageIndex += 1) {
      const pagePath = join(
        commentDirectory,
        `issue-${record.number}-page-${String(pageIndex).padStart(4, '0')}.json`,
      );
      if (existsSync(pagePath)) pageUrls.push(readJson(pagePath).requestedUrl);
    }
    const uniquePageUrls = [...new Set(pageUrls)];
    writeJson(aggregatePath, {
      ...aggregate,
      comments,
      pages: uniquePageUrls.length,
      pageRequests,
      pageUrls: uniquePageUrls,
      nextUrl: null,
    });
    const atCutoff = comments.filter((comment) => comment.created_at <= manifest.cutoffAt);
    record.commentCountAtCutoff = atCutoff.length;
    record.commentCacheSha256 = sha256(JSON.stringify(atCutoff));
    normalizedThreads += 1;
  }
  manifest.issuesLedgerSha256 = persistRecords(directory, records);
  manifest.lastUpdatedAt = new Date().toISOString();
  writeCommentCutoffDiff(auditDir, cacheDir, manifest, records);
  writeJson(manifestPath, manifest);
  const reconciliation = reconcileInventory(records);
  writeJson(join(directory, 'reconciliation.json'), reconciliationSummary(reconciliation));
  process.stdout.write(
    `${JSON.stringify({ cutoff: manifest.cutoff, normalizedThreads, removedDuplicateCommentCopies: removedCopies, ...reconciliationSummary(reconciliation) }, null, 2)}\n`,
  );
}

function status({ auditDir, cutoff }) {
  const directory = scopeDir(auditDir, cutoff);
  const manifestPath = join(directory, 'manifest.json');
  if (!existsSync(manifestPath)) {
    process.stdout.write(`${cutoff.toUpperCase()}: not started\n`);
    return;
  }
  const manifest = readJson(manifestPath);
  const records = loadRecords(directory);
  const supplemental = loadSupplemental(directory);
  process.stdout.write(
    `${JSON.stringify(
      {
        manifest: {
          ...manifest,
          issuePageChecksums: `${manifest.issuePageChecksums.length} page checksums`,
        },
        reconciliation: reconciliationSummary(reconcileInventory(records)),
        supplemental: reconcileSupplemental(records, supplemental),
      },
      null,
      2,
    )}\n`,
  );
}

function check({ auditDir, cutoff }) {
  const directory = scopeDir(auditDir, cutoff);
  const manifest = readJson(join(directory, 'manifest.json'));
  const records = loadRecords(directory);
  const supplemental = loadSupplemental(directory);
  const reconciliation = reconcileInventory(records);
  const supplementalReconciliation = reconcileSupplemental(records, supplemental);
  const errors = [];
  if (!manifest.inventoryComplete) errors.push('inventory is incomplete');
  if (!manifest.commentsComplete) errors.push('issue discussions are incomplete');
  if (reconciliation.duplicateNumbers.length) errors.push('issue numbers are duplicated');
  if (reconciliation.duplicateStableIds.length) errors.push('stable IDs are duplicated');
  if (reconciliation.pendingResearch > 0) errors.push('issues remain unreviewed');
  if (reconciliation.pendingEngineering > 0) errors.push('applicable findings remain unresolved');
  if (reconciliation.unresolvedComments.length) errors.push('issue discussions remain uncaptured');
  if (supplementalReconciliation.duplicateNumbers.length)
    errors.push('supplemental issue numbers duplicate inventory records');
  if (supplementalReconciliation.duplicateStableIds.length)
    errors.push('supplemental stable IDs duplicate inventory records');
  if (supplementalReconciliation.pendingResearch > 0)
    errors.push('supplemental issues remain unreviewed');
  if (supplementalReconciliation.pendingEngineering > 0)
    errors.push('supplemental applicable findings remain unresolved');
  for (const record of supplemental)
    errors.push(...validateSupplementalEvidence(record, manifest, cacheRoot()));
  for (const record of records) {
    if (record.includedAtCutoff && record.kind === 'issue')
      errors.push(...completionRecordErrors(record));
  }
  const actualHash = sha256(readFileSync(join(directory, 'issues.ndjson')));
  if (actualHash !== manifest.issuesLedgerSha256) errors.push('issue ledger checksum mismatch');
  const cacheDirectory = join(cacheRoot(), cutoff.toUpperCase(), 'issues');
  let cachedRecordCount = 0;
  let previousLink = null;
  const sourceItems = new Map();
  for (const [index, page] of manifest.issuePageChecksums.entries()) {
    const pagePath = join(cacheDirectory, page.path.split('/').at(-1));
    if (!existsSync(pagePath)) {
      errors.push(`missing issue page ${index + 1}`);
      continue;
    }
    const pageRecord = readJson(pagePath);
    for (const item of pageRecord.items) {
      const key = item.node_id ?? `${item.pull_request ? 'pull-request' : 'issue'}:${item.number}`;
      if (!sourceItems.has(key)) sourceItems.set(key, { item, page, pageRecord });
    }
    const pageHash = sha256(JSON.stringify(pageRecord.items));
    if (pageHash !== page.sha256) errors.push(`issue page ${index + 1} checksum mismatch`);
    if (pageRecord.items.length === 0 && manifest.issuePages > 1)
      errors.push(`issue page ${index + 1} is unexpectedly empty`);
    if (pageRecord.link && !getNextUrl(pageRecord.link) && index < manifest.issuePages - 1)
      errors.push(`issue page ${index + 1} has no next link before the final page`);
    if (previousLink && getNextUrl(previousLink) !== pageRecord.requestedUrl)
      errors.push(`issue page ${index + 1} does not follow the previous page link`);
    previousLink = pageRecord.link;
    cachedRecordCount += pageRecord.items.length;
  }
  for (const record of records) {
    const source = sourceItems.get(record.nodeId ?? `${record.kind}:${record.number}`);
    if (!source) {
      errors.push(`ledger issue #${record.number} has no matching raw source item`);
      continue;
    }
    errors.push(
      ...sourceRecordErrors(
        record,
        source.item,
        source.page.path,
        source.pageRecord.etag,
        manifest.cutoffAt,
      ),
    );
  }
  if (manifest.issuePageChecksums.length !== manifest.issuePages)
    errors.push('issue page manifest count does not match pagination count');
  if (cachedRecordCount !== records.length)
    errors.push('raw issue page and normalized ledger record totals differ');
  const commentDirectory = join(cacheRoot(), cutoff.toUpperCase(), 'comments');
  for (const record of records) {
    if (
      !record.includedAtCutoff ||
      record.kind !== 'issue' ||
      record.commentCount === 0 ||
      record.commentCoverage !== 'complete'
    )
      continue;
    const aggregatePath = join(commentDirectory, `issue-${record.number}.json`);
    if (!existsSync(aggregatePath)) {
      errors.push(`missing cached discussion for issue #${record.number}`);
      continue;
    }
    const aggregate = readJson(aggregatePath);
    const atCutoff = aggregate.comments.filter(
      (comment) =>
        comment.created_at <= manifest.cutoffAt && comment.updated_at <= manifest.cutoffAt,
    );
    if (atCutoff.length !== record.commentCountAtCutoff)
      errors.push(`discussion count mismatch for issue #${record.number}`);
    if (sha256(JSON.stringify(atCutoff)) !== record.commentCacheSha256)
      errors.push(`discussion checksum mismatch for issue #${record.number}`);
    if (aggregate.pages !== aggregate.pageUrls?.length)
      errors.push(`discussion page count mismatch for issue #${record.number}`);
    const pagedComments = [];
    const observedPageUrls = [];
    for (let pageIndex = 1; pageIndex <= aggregate.pageRequests; pageIndex += 1) {
      const pagePath = join(
        commentDirectory,
        `issue-${record.number}-page-${String(pageIndex).padStart(4, '0')}.json`,
      );
      if (!existsSync(pagePath)) {
        errors.push(`missing discussion page ${pageIndex} for issue #${record.number}`);
        continue;
      }
      const pageRecord = readJson(pagePath);
      observedPageUrls.push(pageRecord.requestedUrl);
      if (sha256(JSON.stringify(pageRecord.items)) !== pageRecord.sha256)
        errors.push(`discussion page checksum mismatch for issue #${record.number}`);
      pagedComments.push(...pageRecord.items);
      if (pageIndex > 1 && pageRecord.link) {
        const previousPath = join(
          commentDirectory,
          `issue-${record.number}-page-${String(pageIndex - 1).padStart(4, '0')}.json`,
        );
        if (existsSync(previousPath)) {
          const previous = readJson(previousPath);
          if (getNextUrl(previous.link) !== pageRecord.requestedUrl)
            errors.push(`discussion pagination gap for issue #${record.number}`);
        }
      }
    }
    if (
      sha256(JSON.stringify(uniqueById(pagedComments))) !==
      sha256(JSON.stringify(aggregate.comments))
    )
      errors.push(`discussion page and aggregate records differ for issue #${record.number}`);
    if (JSON.stringify([...new Set(observedPageUrls)]) !== JSON.stringify(aggregate.pageUrls))
      errors.push(`discussion URL index mismatch for issue #${record.number}`);
  }
  if (errors.length) throw new Error(errors.join('; '));
  process.stdout.write(
    `${JSON.stringify({ ok: true, cutoff: manifest.cutoff, ...reconciliationSummary(reconciliation), supplemental: supplementalReconciliation }, null, 2)}\n`,
  );
}

function argumentsFrom(argv) {
  const [command = 'status', ...rest] = argv;
  const options = { command, cutoff: 'C1', auditDir: resolve(DEFAULT_AUDIT) };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === '--cutoff') options.cutoff = rest[++index] ?? options.cutoff;
    else if (argument === '--audit-dir')
      options.auditDir = resolve(rest[++index] ?? options.auditDir);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = argumentsFrom(argv);
  const cacheDir = cacheRoot();
  mkdirSync(options.auditDir, { recursive: true });
  if (options.command === 'inventory') return startInventory({ ...options, cacheDir });
  if (options.command === 'comments') return fetchComments({ ...options, cacheDir });
  if (options.command === 'normalize-comments')
    return normalizeCommentCaches({ ...options, cacheDir });
  if (options.command === 'reconcile') {
    const directory = scopeDir(options.auditDir, options.cutoff);
    const records = loadRecords(directory);
    const supplemental = loadSupplemental(directory);
    const result = reconcileInventory(records);
    const combined = {
      ...reconciliationSummary(result),
      supplemental: reconcileSupplemental(records, supplemental),
    };
    writeJson(join(directory, 'reconciliation.json'), combined);
    process.stdout.write(`${JSON.stringify(combined, null, 2)}\n`);
    return;
  }
  if (options.command === 'status') return status(options);
  if (options.command === 'check') return check(options);
  throw new Error(
    `Unknown command '${options.command}'. Use inventory, comments, normalize-comments, reconcile, status, or check.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
