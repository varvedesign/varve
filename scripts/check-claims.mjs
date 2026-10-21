#!/usr/bin/env node
/**
 * Public-claims guard for varve.studio and current-state docs.
 *
 * Fails CI when user-facing copy overclaims the shipped app. Keep this cheap:
 * local files only, no network, no paid services.
 *
 * Adding an exception:
 *   Open scripts/claims-allowlist.json and add an object with:
 *     file     — repo-relative path (posix)
 *     includes — substring that must appear on the matching line
 *     reason   — why this line is not a product overclaim
 *   Use this for genuine exceptions only: copy guides that name a banned
 *   phrase so writers avoid it, or docs about a different default (for
 *   example cloud providers that stay "Disabled by default"). Banned
 *   phrases include "open source" for Varve, "off by default"/"opt-in"/
 *   "optional" near AI, "Rust rendering engine", "no telemetry",
 *   "certified PDF/X", "usage isn't measured" / "we don't measure usage",
 *   "does not track which AI features", "one switch turns all AI off",
 *   competitor names in llms.txt, and a latest/current version that
 *   disagrees with package.json.
 *
 *   node scripts/check-claims.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './is-main-module.mjs';
import { readAppVersion } from './website/app-version.mjs';
import { llmsTxtIsCurrent } from './website/generate-llms-txt.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const SCAN_ROOTS = [
  'apps/website/src/pages',
  'apps/website/src/components',
  'apps/website/public/llms.txt',
  'docs',
];

const EXCLUDE_FILES = new Set([
  'README.md',
  'CHANGELOG.md',
  'apps/website/src/pages/changelog.astro',
  'apps/website/src/pages/support/known-issues.astro',
  'apps/website/src/pages/download.astro',
  'apps/website/src/data/release-manifest.json',
]);

const HISTORICAL_PREFIXES = [
  'docs/adr/',
  'docs/audits/',
  'docs/historical/',
  'docs/implementation/',
  'docs/implementation-memory/',
  'docs/perf/',
  'docs/plans/',
  'docs/research/',
  'docs/superpowers/',
  'docs/quality/',
  'docs/screenshots/',
];

const HISTORICAL_EXACT = new Set([
  'docs/agents/session-history.md',
  'docs/CLA-DECISION-RECORD.md',
  'docs/CLA-MAINTAINER.md',
  'docs/CLA.md',
  'docs/ICLA.md',
  'docs/CCLA.md',
  'docs/licensing/review.md',
  'docs/development/provenance.md',
  'docs/privacy/crash-audit.md',
  'docs/release/release-readiness-audit.md',
  'docs/release/0.5.0-release-execution.md',
  'docs/brand/varve-brand-guide.md',
  'docs/agents/chromeos-stage3-ownership.md',
  'docs/agents/gpu-npu-ownership-2026-09-13.md',
]);

const TEXT_EXT = new Set(['.astro', '.md', '.mdx', '.txt', '.html']);

const COMPETITORS =
  /\b(Figma|Sketch|Illustrator|Affinity|Adobe|Photoshop|InDesign|Canva|Photopea|ArtCraft)\b/;

export function loadAllowlist(root = repoRoot) {
  return JSON.parse(readFileSync(join(root, 'scripts/claims-allowlist.json'), 'utf8'));
}

export function isHistoricalDoc(relPath) {
  if (HISTORICAL_EXACT.has(relPath)) return true;
  return HISTORICAL_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

export function listClaimFiles(root = repoRoot) {
  const listed = execFileSync('git', ['ls-files', '-z', '--', ...SCAN_ROOTS], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
  return listed.filter((relPath) => {
    if (EXCLUDE_FILES.has(relPath)) return false;
    if (isHistoricalDoc(relPath)) return false;
    const ext = relPath.includes('.') ? `.${relPath.split('.').pop()}` : '';
    return TEXT_EXT.has(ext);
  });
}

function isAllowlisted(relPath, line, allowlist) {
  return allowlist.some((entry) => entry.file === relPath && line.includes(entry.includes));
}

export function isVarveOpenSourceClaim(line) {
  if (!/open[\s-]source/i.test(line)) return false;
  if (/not (?:OSI-approved )?open[\s-]source/i.test(line)) return false;
  if (/is Varve open source\?/i.test(line)) return false;
  if (/never (?:mark|call|say).{0,40}open[\s-]source/i.test(line)) return false;
  if (/must not.{0,40}open[\s-]source/i.test(line)) return false;
  if (/do not call.{0,40}open[\s-]source/i.test(line)) return false;
  if (/source-available.{0,80}not.{0,40}open[\s-]source/i.test(line)) return false;
  if (/\bVarve\b(?:'s)? is\b.{0,40}open[\s-]source/i.test(line)) return true;
  if (/\bVarve\b.{0,20}\bis an?\b.{0,30}open[\s-]source/i.test(line)) return true;
  if (
    /\bopen[\s-]source\b.{0,30}\bVarve\b/i.test(line) &&
    !/fonts?|icons?|sets?|crates?/i.test(line)
  ) {
    return true;
  }
  return false;
}

export function isUsageNotMeasuredClaim(line) {
  if (/\bwe (?:do not|don't) measure usage\b/i.test(line)) return true;
  if (/\b(?:product )?usage (?:is|are|isn't|aren't)(?: not)? measured\b/i.test(line)) return true;
  return false;
}

export function isAiUsageNotTrackedClaim(line) {
  return /(?:does not|doesn't|do not|don't|never)\s+track(?:s)?\s+which AI features/i.test(line);
}

export function isAllAiOffSwitchClaim(line) {
  if (/\bsingle switch\b.{0,40}\b(turns them all off|turns all AI)\b/i.test(line)) return true;
  if (/\bone switch\b.{0,40}\b(turns|covers)\b.{0,20}\ball AI\b/i.test(line)) return true;
  if (/\bturns them all off\b/i.test(line)) return true;
  return false;
}

export function isAiDefaultClaim(line) {
  if (/\bvisual search is opt-in\b/i.test(line)) return true;
  if (/\bAI-assisted.{0,30}\boptional\b/i.test(line)) return true;
  if (/\boptional product AI\b/i.test(line)) return true;
  if (/\boptional AI\b/i.test(line) || /\bopt-in AI\b/i.test(line)) return true;
  if (/\bAI features?\b.{0,40}\b(optional|opt-in|off by default)\b/i.test(line)) return true;
  if (/\b(optional|opt-in|off by default)\b.{0,40}\bAI features?\b/i.test(line)) return true;
  return false;
}

export function findLatestVersionClaims(line, expectedVersion) {
  const found = [];
  const patterns = [
    /\blatest(?:\s+\w+){0,8}\s+(?:published\s+)?(?:application\s+)?(?:release\s+)?(?:is\s+)?(?:\*\*)?(?:Varve\s+)?`?v?(\d+\.\d+\.\d+)/gi,
    /\bcurrent version\s+(?:is\s+)?`?v?(\d+\.\d+\.\d+)/gi,
    /`?v?(\d+\.\d+\.\d+)`?\s+is the latest/gi,
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match = pattern.exec(line);
    while (match) {
      if (match[1] !== expectedVersion) found.push(match[1]);
      match = pattern.exec(line);
    }
  }
  return found;
}

export function inspectLine(relPath, line, expectedVersion, allowlist) {
  const findings = [];
  const skip = (rule) =>
    isAllowlisted(
      relPath,
      line,
      allowlist.filter((e) => !e.rule || e.rule === rule),
    );

  if (/Rust rendering engine/i.test(line) && !skip('rust-rendering-engine')) {
    findings.push('Rust rendering engine');
  }
  if (
    /\bno telemetry\b/i.test(line) &&
    !/no design telemetry/i.test(line) &&
    !skip('no-telemetry')
  ) {
    findings.push('no telemetry');
  }
  if (isUsageNotMeasuredClaim(line) && !skip('usage-not-measured')) {
    findings.push("usage isn't measured");
  }
  if (isAiUsageNotTrackedClaim(line) && !skip('ai-usage-not-tracked')) {
    findings.push('does not track which AI features');
  }
  if (isAllAiOffSwitchClaim(line) && !skip('ai-all-off-switch')) {
    findings.push('one switch turns all AI off');
  }
  if (
    /certified PDF\/X|validated PDF\/X|PDF\/X compliance/i.test(line) &&
    !skip('pdfx-certified')
  ) {
    findings.push('certified or validated PDF/X');
  }
  if (isVarveOpenSourceClaim(line) && !skip('open-source')) {
    findings.push('open source used to describe Varve');
  }
  if (isAiDefaultClaim(line) && !skip('ai-default')) {
    findings.push('off by default / opt-in / optional near AI');
  }
  if (relPath.endsWith('llms.txt') && COMPETITORS.test(line) && !skip('competitors')) {
    findings.push(`competitor name in llms.txt (${line.match(COMPETITORS)?.[0]})`);
  }
  const stale = findLatestVersionClaims(line, expectedVersion);
  if (stale.length > 0 && !skip('latest-version')) {
    findings.push(`latest/current version ${stale.join(', ')} (expected ${expectedVersion})`);
  }
  return findings;
}

export function checkClaims(root = repoRoot) {
  const expectedVersion = readAppVersion(root);
  const allowlist = loadAllowlist(root);
  const problems = [];

  const generated = llmsTxtIsCurrent(root);
  if (!generated.ok) {
    problems.push(
      'apps/website/public/llms.txt is stale; run node scripts/website/generate-llms-txt.mjs',
    );
  }

  for (const relPath of listClaimFiles(root)) {
    const text = readFileSync(join(root, relPath), 'utf8');
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      for (const finding of inspectLine(relPath, line, expectedVersion, allowlist)) {
        problems.push(`${relPath}:${i + 1}: ${finding}`);
      }
    }
  }

  return { expectedVersion, problems };
}

if (isMainModule(import.meta.url)) {
  const { expectedVersion, problems } = checkClaims();
  if (problems.length > 0) {
    process.stderr.write(
      `check-claims — ${problems.length} violation(s) (app version ${expectedVersion}):\n`,
    );
    for (const problem of problems) process.stderr.write(`  ${problem}\n`);
    process.stderr.write(
      '\nIf this line is a genuine exception, add it to scripts/claims-allowlist.json with a reason.\n',
    );
    process.exit(1);
  }
  process.stdout.write(`check-claims — clean (app version ${expectedVersion}).\n`);
}
