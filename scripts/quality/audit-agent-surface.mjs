#!/usr/bin/env node
/**
 * Agent-context surface audit (durable repository-context guard).
 *
 * The repository-context remediation of 2026-10-28 added a small, always-loaded
 * agent surface: three identical search-ignore files at the root, a short
 * AGENTS.md index whose "Read next" table points at on-demand playbooks, and
 * docs/README.md index rows for the new policy docs. Each piece is easy to
 * erode silently: an ignore file gets edited alone, AGENTS.md regrows into a
 * manual, or a pointer row survives after its target is renamed. This audit is
 * the fail-fast check for that drift.
 *
 * Checks (each produces a finding; the CLI exits 1 on any finding):
 *   1. .ignore, .dshignore and .opencodeignore exist at the root, are
 *      byte-identical, and every one carries the required exclusion rules,
 *      including the "!packages/ui/src/icons/*.svg" re-include negation.
 *   2. AGENTS.md stays within the always-loaded budget (<= 150 lines and
 *      <= 9000 bytes) and keeps a "Read next" pointer table.
 *   3. Every backticked repository-relative *.md path in that pointer table
 *      resolves on disk. Absolute paths, URLs and non-.md code spans are not
 *      pointer targets and are skipped.
 *   4. docs/README.md keeps a table row for the context-economy playbook and
 *      the file-size policy. Rows are matched with the docs-relative form used
 *      by the index (agents/x.md) and with the repository-relative form.
 *
 * Canonical policy: docs/agents/agent-context-economy.md (surface contract) and
 * docs/quality/file-size-policy.md (why the index stays small).
 *
 * Usage:
 *   node scripts/quality/audit-agent-surface.mjs          # check (exit 1 on drift)
 *   node scripts/quality/audit-agent-surface.mjs --json   # machine-readable result
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMainModule } from '../is-main-module.mjs';

/** Root search-ignore files that must stay in sync. */
export const IGNORE_FILES = ['.ignore', '.dshignore', '.opencodeignore'];

/**
 * Rules every search-ignore file must carry. Directory patterns are matched
 * with or without a trailing slash so a deliberate "node_modules" spelling does
 * not read as a missing rule.
 */
export const REQUIRED_IGNORE_PATTERNS = [
  '.worktrees/',
  'node_modules',
  '**/target/',
  'docs/screenshots/',
  'pnpm-lock.yaml',
  'Cargo.lock',
  '*.svg',
  '!packages/ui/src/icons/*.svg',
];

/** Always-loaded AGENTS.md budget. Keep both limits in the audit and the docs. */
export const AGENTS_MAX_LINES = 150;
export const AGENTS_MAX_BYTES = 9000;

const AGENTS_FILE = 'AGENTS.md';
const DOCS_INDEX_FILE = 'docs/README.md';
const DOCS_PREFIX = 'docs/';
const MAX_REPORTED_FINDINGS = 25;

/** Documentation index rows that must survive doc moves. */
const REQUIRED_DOCS_INDEX_ROWS = [
  'docs/agents/agent-context-economy.md',
  'docs/quality/file-size-policy.md',
];

/** Count lines; a trailing newline does not start another line. */
function countLines(text) {
  if (text.length === 0) return 0;
  const segments = text.split('\n').length;
  return text.endsWith('\n') ? segments - 1 : segments;
}

/** Read a surface file as bytes plus UTF-8 text; null when it cannot be read. */
function readSurfaceFile(path) {
  try {
    const buffer = readFileSync(path);
    return { buffer, text: buffer.toString('utf8') };
  } catch {
    return null;
  }
}

/** Match an ignore rule exactly, tolerating a trailing slash on directories. */
function hasIgnorePattern(lines, pattern) {
  const variants = pattern.endsWith('/')
    ? [pattern, pattern.slice(0, -1)]
    : [pattern, `${pattern}/`];
  return lines.some((line) => variants.includes(line.trim()));
}

/** Check the ignore trio for existence, byte identity and required rules. */
function checkIgnoreFiles(root) {
  const findings = [];
  const present = new Map();
  for (const file of IGNORE_FILES) {
    const surface = readSurfaceFile(join(root, file));
    if (surface === null) {
      findings.push(`${file}: required search-ignore file is missing`);
      continue;
    }
    present.set(file, surface);
  }

  const referenceName = IGNORE_FILES.find((file) => present.has(file));
  const reference = referenceName === undefined ? null : present.get(referenceName);
  if (referenceName !== undefined && reference !== null) {
    for (const [file, surface] of present) {
      if (file === referenceName) continue;
      if (!surface.buffer.equals(reference.buffer)) {
        findings.push(
          `${file}: not byte-identical to ${referenceName} (${surface.buffer.length} vs ${reference.buffer.length} bytes); keep all three search-ignore files identical`,
        );
      }
    }
  }

  let ignoreLines = 0;
  let ignoreRules = 0;
  if (reference !== null) {
    ignoreLines = countLines(reference.text);
    ignoreRules = reference.text.split('\n').filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('#');
    }).length;
  }

  const linesByFile = new Map();
  for (const [file, surface] of present) linesByFile.set(file, surface.text.split('\n'));
  let requiredPresent = 0;
  for (const pattern of REQUIRED_IGNORE_PATTERNS) {
    let presentEverywhere = present.size > 0;
    for (const [file, lines] of linesByFile) {
      if (!hasIgnorePattern(lines, pattern)) {
        presentEverywhere = false;
        findings.push(`${file}: missing required search-ignore pattern: ${pattern}`);
      }
    }
    if (presentEverywhere) requiredPresent += 1;
  }

  const ignoreIdentical =
    present.size === IGNORE_FILES.length &&
    reference !== null &&
    [...present.values()].every((surface) => surface.buffer.equals(reference.buffer));

  return {
    findings,
    stats: {
      ignoreFiles: present.size,
      ignoreIdentical,
      ignoreLines,
      ignoreRules,
      ignorePatterns: requiredPresent,
    },
  };
}

/**
 * Locate the "Read next" section and return its table rows. The section ends at
 * the next heading of any level; rows are lines that start with a table pipe.
 */
function findReadNextTable(lines) {
  const start = lines.findIndex((line) => /^#{1,6}\s+/.test(line) && /read next/i.test(line));
  if (start < 0) return null;
  const rows = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^#{1,6}\s+/.test(line)) break;
    if (line.trim().startsWith('|')) rows.push(line);
  }
  return rows;
}

/** A pointer target is a repository-relative Markdown path, not a URL or absolute. */
function isRepoRelativeMarkdownPointer(value) {
  if (!value.endsWith('.md')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  if (value.startsWith('/') || value.startsWith('~') || value.startsWith('#')) return false;
  if (/[\s*?{}<>|\\]/.test(value)) return false;
  return true;
}

/** Extract unique backticked repository-relative *.md pointers from table rows. */
function extractPointerPaths(rows) {
  const pointers = [];
  const seen = new Set();
  for (const row of rows) {
    for (const match of row.matchAll(/`([^`]+)`/g)) {
      const raw = match[1].trim();
      if (!isRepoRelativeMarkdownPointer(raw)) continue;
      const pointer = raw.startsWith('./') ? raw.slice(2) : raw;
      if (seen.has(pointer)) continue;
      seen.add(pointer);
      pointers.push(pointer);
    }
  }
  return pointers;
}

/** Check the AGENTS.md budget and its pointer table targets. */
function checkAgentsSurface(root) {
  const findings = [];
  const stats = {
    agentsLines: null,
    agentsBytes: null,
    pointerTargets: 0,
    missingPointerTargets: 0,
  };
  const surface = readSurfaceFile(join(root, AGENTS_FILE));
  if (surface === null) {
    findings.push(`${AGENTS_FILE}: required always-loaded agent index is missing`);
    return { findings, stats };
  }
  stats.agentsLines = countLines(surface.text);
  stats.agentsBytes = surface.buffer.length;
  if (stats.agentsLines > AGENTS_MAX_LINES) {
    findings.push(
      `${AGENTS_FILE}: ${stats.agentsLines} lines exceeds the ${AGENTS_MAX_LINES}-line index budget; move detail into docs/agents/`,
    );
  }
  if (stats.agentsBytes > AGENTS_MAX_BYTES) {
    findings.push(
      `${AGENTS_FILE}: ${stats.agentsBytes} bytes exceeds the ${AGENTS_MAX_BYTES}-byte index budget; move detail into docs/agents/`,
    );
  }

  const rows = findReadNextTable(surface.text.split('\n'));
  if (rows === null) {
    findings.push(`${AGENTS_FILE}: missing the "Read next" pointer table heading`);
    return { findings, stats };
  }
  if (rows.length === 0) {
    findings.push(`${AGENTS_FILE}: "Read next" section contains no table rows`);
    return { findings, stats };
  }
  const pointers = extractPointerPaths(rows);
  if (pointers.length === 0) {
    findings.push(`${AGENTS_FILE}: "Read next" table lists no repository-relative .md pointer`);
  }
  const missing = pointers.filter((pointer) => !existsSync(join(root, pointer)));
  for (const pointer of missing) {
    findings.push(`${AGENTS_FILE}: pointer target missing on disk: ${pointer}`);
  }
  stats.pointerTargets = pointers.length;
  stats.missingPointerTargets = missing.length;
  return { findings, stats };
}

/** Check that docs/README.md still indexes the two context policy docs. */
function checkDocsIndex(root) {
  const findings = [];
  const stats = { readmeRows: 0, missingReadmeRows: REQUIRED_DOCS_INDEX_ROWS.length };
  const surface = readSurfaceFile(join(root, DOCS_INDEX_FILE));
  if (surface === null) {
    findings.push(`${DOCS_INDEX_FILE}: required documentation index is missing`);
    return { findings, stats };
  }
  const rows = surface.text.split('\n').filter((line) => line.trim().startsWith('|'));
  for (const target of REQUIRED_DOCS_INDEX_ROWS) {
    const docsRelative = target.startsWith(DOCS_PREFIX) ? target.slice(DOCS_PREFIX.length) : target;
    const present = rows.some((row) => row.includes(target) || row.includes(docsRelative));
    if (present) {
      stats.readmeRows += 1;
    } else {
      findings.push(`${DOCS_INDEX_FILE}: missing index table row for ${target}`);
    }
  }
  stats.missingReadmeRows = REQUIRED_DOCS_INDEX_ROWS.length - stats.readmeRows;
  return { findings, stats };
}

/**
 * Audit the durable agent-context surface under a repository root.
 * Pure read: no files are written, so tests can point it at fixtures.
 * @param {{ root?: string }} [options]
 * @returns {{ findings: string[], stats: Record<string, unknown> }}
 */
export function checkAgentSurface({ root = process.cwd() } = {}) {
  const ignore = checkIgnoreFiles(root);
  const agents = checkAgentsSurface(root);
  const docsIndex = checkDocsIndex(root);
  return {
    root,
    findings: [...ignore.findings, ...agents.findings, ...docsIndex.findings],
    stats: { ...ignore.stats, ...agents.stats, ...docsIndex.stats },
  };
}

function printUsage() {
  console.log(
    'Usage: node scripts/quality/audit-agent-surface.mjs [--json]\n\n' +
      '  (default)  fail when the agent-context surface drifts\n' +
      '  --json     print {ok, root, findings, stats} as JSON\n' +
      '  --help     print this usage\n',
  );
}

/**
 * CLI entry point.
 * @param {string} [root]
 * @param {string[]} [argv]
 * @returns {number} exit code
 */
export function runAuditAgentSurface(root = process.cwd(), argv = process.argv.slice(2)) {
  const known = new Set(['--json', '--help', '-h']);
  const unknown = argv.filter((argument) => !known.has(argument));
  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(', ')}`);
    printUsage();
    return 2;
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    return 0;
  }
  let result;
  try {
    result = checkAgentSurface({ root });
  } catch (error) {
    console.error(`audit-agent-surface: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const ok = result.findings.length === 0;
  if (argv.includes('--json')) {
    console.log(
      JSON.stringify(
        { ok, root: result.root, findings: result.findings, stats: result.stats },
        null,
        2,
      ),
    );
    return ok ? 0 : 1;
  }
  if (!ok) {
    console.log(`Agent-context surface drift: ${result.findings.length} finding(s)`);
    for (const finding of result.findings.slice(0, MAX_REPORTED_FINDINGS)) {
      console.log(`  - ${finding}`);
    }
    if (result.findings.length > MAX_REPORTED_FINDINGS) {
      console.log(`  ... and ${result.findings.length - MAX_REPORTED_FINDINGS} more finding(s)`);
    }
    console.log(
      'Surface contract: docs/agents/agent-context-economy.md; policy: docs/quality/file-size-policy.md',
    );
    return 1;
  }
  const { stats } = result;
  console.log(
    `Agent-context surface OK: ${stats.ignoreFiles} search-ignore files byte-identical (${stats.ignoreLines} lines, ${stats.ignorePatterns}/${REQUIRED_IGNORE_PATTERNS.length} required patterns); AGENTS.md ${stats.agentsLines} lines / ${stats.agentsBytes} bytes within ${AGENTS_MAX_LINES}/${AGENTS_MAX_BYTES}; ${stats.pointerTargets} pointer target(s) resolve; ${stats.readmeRows}/${REQUIRED_DOCS_INDEX_ROWS.length} docs index rows present.`,
  );
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runAuditAgentSurface(process.cwd());
}
