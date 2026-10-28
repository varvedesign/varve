#!/usr/bin/env node
/**
 * Visual-baseline hygiene audit.
 *
 * Playwright snapshot baselines are reviewed binary artifacts; stale ownership,
 * naming, dimensions, or tier coverage makes them fail silently or noisily.
 * This audit checks the artifact set, not the pixels:
 *
 *   1. Owner: every *-snapshots directory has an owning spec (suffix removed).
 *   2. PNG sanity: signature, IHDR, 0 < width/height < 20000, 25 B - 25 MB.
 *   3. Suffix: <base>-<project>-<platform>.png with known project/platform.
 *   4. Dimensions: equal width/height per fixture base across visual tiers
 *      (chromium-visual-1x/2x/3x/gpu, firefox-visual, webkit-visual).
 *   5. Coverage: replay.spec.ts-snapshots carries 1x/2x/3x/GPU per fixture;
 *      firefox is required if any firefox baseline exists, webkit likewise.
 *
 * Hermetic (node builtins) and never edits snapshots; regenerate with
 * --update-snapshots in the target project, then review the images.
 *
 * Usage:
 *   node scripts/quality/audit-visual-baselines.mjs           # check
 *   node scripts/quality/audit-visual-baselines.mjs --json    # machine output
 *   node scripts/quality/audit-visual-baselines.mjs --help
 *
 * Exit codes: 0 clean, 1 findings, 2 usage error.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMainModule } from '../is-main-module.mjs';

export const SNAPSHOT_SUFFIX = '-snapshots';
export const REPLAY_SNAPSHOTS = 'tests/e2e/visual/replay.spec.ts-snapshots';
export const PROJECTS = [
  'chromium',
  'firefox',
  'webkit',
  'chromium-snapshot',
  'chromium-visual-1x',
  'chromium-visual-2x',
  'chromium-visual-3x',
  'chromium-visual-gpu',
  'firefox-visual',
  'webkit-visual',
];
const PROJECTS_LONGEST_FIRST = [...PROJECTS].sort((a, b) => b.length - a.length);
const PLATFORMS = ['linux', 'darwin', 'win32'];
const REQUIRED_TIERS = ['1x', '2x', '3x', 'gpu'];

/**
 * Visual tier projects: the snapshot-name tier label (the argument the spec
 * passes to toHaveScreenshot) and the coverage variant it represents.
 */
const VISUAL_PROJECTS = new Map([
  ['chromium-visual-1x', { tier: '1x', variant: '1x' }],
  ['chromium-visual-2x', { tier: '2x', variant: '2x' }],
  ['chromium-visual-3x', { tier: '3x', variant: '3x' }],
  ['chromium-visual-gpu', { tier: 'gpu', variant: 'gpu' }],
  ['firefox-visual', { tier: 'firefox-visual', variant: 'firefox' }],
  ['webkit-visual', { tier: 'webkit-visual', variant: 'webkit' }],
]);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PNG_BYTES = 25 * 1024 * 1024;
const MAX_DIMENSION = 20000;
const MIN_PNG_BYTES = 25;
const MAX_REPORTED_FINDINGS = 40;

function relative(root, absolute) {
  return absolute.slice(root.length + 1).replaceAll('\\', '/');
}

function walkSnapshotDirs(directory, output) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const absolute = join(directory, entry.name);
    if (entry.name.endsWith(SNAPSHOT_SUFFIX)) output.push(absolute);
    walkSnapshotDirs(absolute, output);
  }
}

/** @returns {string[]} repository-relative snapshot directories, sorted. */
export function discoverSnapshotDirs(root) {
  const directories = [];
  walkSnapshotDirs(join(root, 'tests/e2e'), directories);
  return directories.map((absolute) => relative(root, absolute)).sort();
}

/**
 * Parse "<base>-<project>-<platform>" from a snapshot filename stem.
 * @returns {{ base: string, project: string, platform: string, unknown: boolean, reason?: string }}
 */
export function parseSnapshotName(stem) {
  for (const platform of PLATFORMS) {
    const platformMarker = '-' + platform;
    if (!stem.endsWith(platformMarker)) continue;
    const head = stem.slice(0, -platformMarker.length);
    for (const project of PROJECTS_LONGEST_FIRST) {
      const projectMarker = '-' + project;
      if (head.length > projectMarker.length && head.endsWith(projectMarker)) {
        return { base: head.slice(0, -projectMarker.length), project, platform, unknown: false };
      }
    }
    const lastDash = head.lastIndexOf('-');
    const base = lastDash > 0 ? head.slice(0, lastDash) : '';
    const project = lastDash >= 0 ? head.slice(lastDash + 1) : head;
    return {
      base,
      project,
      platform,
      unknown: true,
      reason: 'unknown project "' + project + '" (platform ' + platform + ')',
    };
  }
  return {
    base: stem,
    project: '',
    platform: '',
    unknown: true,
    reason: 'unknown platform suffix',
  };
}

/**
 * Validate one PNG from its header. No image library: the signature and IHDR
 * chunk are enough to prove the file is a readable baseline with sane size.
 * @returns {{ ok: boolean, width?: number, height?: number, reason?: string }}
 */
export function inspectPngBytes(buffer) {
  if (buffer.length < MIN_PNG_BYTES) {
    return {
      ok: false,
      reason: 'file is ' + buffer.length + ' bytes (minimum ' + MIN_PNG_BYTES + ' bytes)',
    };
  }
  if (buffer.length >= MAX_PNG_BYTES) {
    return { ok: false, reason: 'file exceeds 25 MB' };
  }
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { ok: false, reason: 'invalid PNG signature' };
  }
  if (
    buffer.length < 24 ||
    buffer.readUInt32BE(8) !== 13 ||
    buffer.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    return { ok: false, reason: 'missing or truncated IHDR chunk' };
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width <= 0 || height <= 0 || width >= MAX_DIMENSION || height >= MAX_DIMENSION) {
    return { ok: false, reason: 'invalid dimensions ' + width + 'x' + height };
  }
  return { ok: true, width, height };
}

function inspectPngFile(absolute) {
  let buffer;
  try {
    buffer = readFileSync(absolute);
  } catch {
    return { ok: false, reason: 'unreadable file' };
  }
  return inspectPngBytes(buffer);
}

function stripTier(base, project) {
  const visual = VISUAL_PROJECTS.get(project);
  if (!visual) return base;
  const marker = '-' + visual.tier;
  return base.endsWith(marker) ? base.slice(0, -marker.length) : base;
}

function checkDimensions(files, findings) {
  const groups = new Map();
  for (const file of files) {
    if (!VISUAL_PROJECTS.has(file.project)) continue;
    const base = stripTier(file.base, file.project);
    if (base.length === 0) continue;
    const key = file.dir + '|' + file.platform + '|' + base;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  }
  for (const list of groups.values()) {
    const dimensions = new Set(list.map((file) => file.width + 'x' + file.height));
    if (dimensions.size <= 1) continue;
    const detail = list
      .map((file) => file.project + '=' + file.width + 'x' + file.height)
      .sort()
      .join(', ');
    findings.push({
      kind: 'dimension-mismatch',
      path: list[0].dir,
      message:
        'fixture "' +
        stripTier(list[0].base, list[0].project) +
        '" has mismatched dimensions: ' +
        detail,
    });
  }
}

function checkCoverage(files, findings) {
  const firefoxPresent = files.some((file) => file.project === 'firefox-visual');
  const webkitPresent = files.some((file) => file.project === 'webkit-visual');
  const required = [...REQUIRED_TIERS];
  if (firefoxPresent) required.push('firefox');
  if (webkitPresent) required.push('webkit');
  const fixtures = new Map();
  for (const file of files) {
    if (file.dir !== REPLAY_SNAPSHOTS || !VISUAL_PROJECTS.has(file.project)) continue;
    const base = stripTier(file.base, file.project);
    if (!fixtures.has(base)) fixtures.set(base, new Set());
    fixtures.get(base).add(VISUAL_PROJECTS.get(file.project).variant);
  }
  for (const [base, variants] of [...fixtures].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const missing = required.filter((variant) => !variants.has(variant));
    if (missing.length === 0) continue;
    findings.push({
      kind: 'missing-variant',
      path: REPLAY_SNAPSHOTS + '/' + base,
      message: 'fixture "' + base + '" is missing required baseline(s): ' + missing.join(', '),
    });
  }
}

/**
 * Run every visual-baseline hygiene check.
 * @param {{ root?: string }} options
 * @returns {{
 *   ok: boolean,
 *   root: string,
 *   findings: {kind: string, path: string, message: string}[],
 *   summary: {
 *     snapshotDirs: number,
 *     ownedDirs: number,
 *     pngCount: number,
 *     byProject: Record<string, number>,
 *     byKind: Record<string, number>,
 *   },
 * }}
 */
export function checkVisualBaselines({ root = process.cwd() } = {}) {
  const findings = [];
  const files = [];
  const byProject = {};
  let pngCount = 0;
  const directories = discoverSnapshotDirs(root);
  let ownedDirs = 0;
  for (const dir of directories) {
    const owner = dir.slice(0, -SNAPSHOT_SUFFIX.length);
    if (existsSync(join(root, owner))) {
      ownedDirs += 1;
    } else {
      findings.push({
        kind: 'orphan-dir',
        path: dir,
        message: 'snapshot directory has no owning spec at ' + owner,
      });
    }
    let names;
    try {
      names = readdirSync(join(root, dir))
        .filter((name) => name.endsWith('.png'))
        .sort();
    } catch {
      continue;
    }
    for (const name of names) {
      pngCount += 1;
      const path = dir + '/' + name;
      const parsed = parseSnapshotName(name.slice(0, -4));
      const project = parsed.unknown ? 'unknown' : parsed.project;
      byProject[project] = (byProject[project] ?? 0) + 1;
      if (parsed.unknown) {
        findings.push({ kind: 'unknown-suffix', path, message: parsed.reason ?? 'unknown suffix' });
      }
      const png = inspectPngFile(join(root, path));
      if (!png.ok) {
        findings.push({ kind: 'corrupt-png', path, message: png.reason ?? 'corrupt PNG' });
        continue;
      }
      files.push({
        dir,
        name,
        path,
        base: parsed.base,
        project: parsed.project,
        platform: parsed.platform,
        width: png.width,
        height: png.height,
      });
    }
  }
  checkDimensions(files, findings);
  checkCoverage(files, findings);
  findings.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
  });
  const byKind = {};
  for (const finding of findings) byKind[finding.kind] = (byKind[finding.kind] ?? 0) + 1;
  return {
    ok: findings.length === 0,
    root,
    findings,
    summary: {
      snapshotDirs: directories.length,
      ownedDirs,
      pngCount,
      byProject,
      byKind,
    },
  };
}

function formatProjectCounts(byProject) {
  return Object.entries(byProject)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([project, count]) => project + ' ' + count)
    .join(', ');
}

function printHuman(result) {
  const verb = result.ok ? 'OK' : result.findings.length + ' finding(s)';
  console.log('Visual-baseline audit: ' + verb);
  if (!result.ok) {
    for (const finding of result.findings.slice(0, MAX_REPORTED_FINDINGS)) {
      console.log('  [' + finding.kind + '] ' + finding.path + ' — ' + finding.message);
    }
    if (result.findings.length > MAX_REPORTED_FINDINGS) {
      console.log(
        '  ... and ' + (result.findings.length - MAX_REPORTED_FINDINGS) + ' more finding(s)',
      );
    }
  }
  const summary = result.summary;
  console.log(
    'Snapshot dirs: ' +
      summary.snapshotDirs +
      ' (' +
      summary.ownedDirs +
      ' owned); PNGs: ' +
      summary.pngCount +
      '; by project: ' +
      (formatProjectCounts(summary.byProject) || 'none'),
  );
}

function printUsage() {
  console.log(
    'Usage: node scripts/quality/audit-visual-baselines.mjs [--json] [--help]\n' +
      '  (default) check baselines, exit 1 on findings; --json machine output\n' +
      '  --help prints this help\n',
  );
}

/**
 * CLI entry point.
 * @returns {number} exit code
 */
export function runVisualBaselinesAudit(root = process.cwd(), argv = process.argv.slice(2)) {
  const known = new Set(['--json', '--help']);
  const unknown = argv.filter((argument) => !known.has(argument));
  if (unknown.length > 0) {
    console.error('Unknown argument(s): ' + unknown.join(', '));
    printUsage();
    return 2;
  }
  if (argv.includes('--help')) {
    printUsage();
    return 0;
  }
  let result;
  try {
    result = checkVisualBaselines({ root });
  } catch (error) {
    console.error(
      'audit-visual-baselines: ' + (error instanceof Error ? error.message : String(error)),
    );
    return 2;
  }
  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }
  return result.ok ? 0 : 1;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runVisualBaselinesAudit(process.cwd());
}
