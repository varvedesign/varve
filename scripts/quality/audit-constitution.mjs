#!/usr/bin/env node
/**
 * Constitution audit — keeps the machine-readable rule registry honest.
 *
 * .ai/constitution.json is NOT auto-loaded by agent harnesses (AGENTS.md is the
 * always-loaded system prompt; the documented convention is AGENTS.md/rules files
 * — see docs/agents/agent-context-economy.md). The JSON exists for a different
 * job: every recurring hard rule must point at a REAL enforcement mechanism
 * (package script, repo script, existing tests, or a manual checklist with a
 * reviewed doc). This audit fails when a rule becomes decorative, references a
 * missing command/path, loses its manual review material, or a role references
 * files that no longer exist. It also covers role registration (every
 * .ai/roles/*.md except README.md is registered exactly once) and source-doc
 * reachability (each rule source is reachable from AGENTS.md within two
 * markdown-link hops), so the prompt surface cannot silently lose its
 * pointers. Policy drift then fails CI instead of being re-learned by the next
 * agent.
 *
 * Usage:
 *   node scripts/quality/audit-constitution.mjs           # check (exit 1 on findings)
 *   node scripts/quality/audit-constitution.mjs --json    # machine-readable result
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isMainModule } from '../is-main-module.mjs';

export const CONSTITUTION_FILE = '.ai/constitution.json';
export const CONSTITUTION_SCHEMA = 'agent-constitution-v1';
export const EXPECTED_REPO = 'varve';
const SEVERITIES = new Set(['blocking', 'advisory']);
const ENFORCEMENT_KINDS = new Set(['command', 'script', 'test', 'manual']);
const MAX_REPORTED = 30;
const AGENTS_FILE = 'AGENTS.md';
const ROLES_DIR = '.ai/roles';
const ROLES_README = 'README.md';
const MAX_SOURCE_HOPS = 2;
const MARKDOWN_LINK = /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const INLINE_CODE = /`([^`\n]+)`/g;
const DOC_PATH = /^[A-Za-z0-9_.@/-]+\.md$/;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function relativeExists(root, value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.startsWith('/') || value.includes('..')) return false;
  return existsSync(join(root, value));
}

function relativeFileExists(root, value) {
  if (!relativeExists(root, value)) return false;
  try {
    return statSync(join(root, value)).isFile();
  } catch {
    return false;
  }
}

function sourceDocExists(root, source) {
  if (typeof source !== 'string' || source.length === 0) return false;
  return relativeExists(root, source.split('#')[0]);
}

function normalizeRepoPath(value) {
  return String(value).replaceAll('\\', '/').replace(/^\.\//, '');
}

function stripAnchor(value) {
  const index = value.indexOf('#');
  return index === -1 ? value : value.slice(0, index);
}

function isExternalReference(target) {
  if (!target || target.startsWith('#')) return true;
  return target.startsWith('//') || URL_SCHEME.test(target);
}

function resolveDocReference(root, fromDoc, target, { rootRelative = false } = {}) {
  const cleaned = normalizeRepoPath(stripAnchor(target ?? '')).replace(/^\//, '');
  if (isExternalReference(cleaned) || !DOC_PATH.test(cleaned)) return null;
  const candidate = rootRelative ? cleaned : normalizeRepoPath(join(dirname(fromDoc), cleaned));
  if (candidate.startsWith('..') || !relativeFileExists(root, candidate)) return null;
  return candidate;
}

function extractDocReferences(content) {
  const references = [];
  const text = content.replace(/```[\s\S]*?```/g, '\n');
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    references.push({ target: match[1], rootRelative: false });
  }
  for (const match of text.matchAll(INLINE_CODE)) {
    const target = match[1].trim();
    if (DOC_PATH.test(stripAnchor(target))) references.push({ target, rootRelative: true });
  }
  return references;
}

/**
 * Docs reachable from AGENTS.md within `maxHops` markdown-link hops.
 * Depth 0 is AGENTS.md itself; backticked repo-relative .md paths count as
 * links (AGENTS.md points at docs that way). External links, mailto and bare
 * anchors are ignored. Returns a Set of normalized repo-relative paths.
 */
export function reachableDocs(root, maxHops = MAX_SOURCE_HOPS) {
  const docs = new Set();
  if (!relativeFileExists(root, AGENTS_FILE)) return docs;
  docs.add(AGENTS_FILE);
  let frontier = [AGENTS_FILE];
  for (let hop = 0; hop < maxHops && frontier.length > 0; hop += 1) {
    const next = [];
    for (const doc of frontier) {
      let content;
      try {
        content = readFileSync(join(root, doc), 'utf8');
      } catch {
        continue;
      }
      for (const reference of extractDocReferences(content)) {
        const resolved = resolveDocReference(root, doc, reference.target, {
          rootRelative: reference.rootRelative,
        });
        if (!resolved || docs.has(resolved)) continue;
        docs.add(resolved);
        next.push(resolved);
      }
    }
    frontier = next;
  }
  return docs;
}

/**
 * Every .ai/roles/*.md except README.md must be registered exactly once in
 * constitution.roles[].file. Reports orphan role files and duplicate
 * registrations; missing registered files stay a separate check.
 */
export function roleRegistrationFindings(root, roles = []) {
  const findings = [];
  const registrations = new Map();
  for (const role of Array.isArray(roles) ? roles : []) {
    if (!isPlainObject(role) || typeof role.file !== 'string' || role.file.length === 0) continue;
    const file = normalizeRepoPath(role.file);
    const label = typeof role.id === 'string' ? role.id : '(missing id)';
    if (!registrations.has(file)) registrations.set(file, []);
    registrations.get(file).push(label);
  }
  let roleFiles = [];
  try {
    roleFiles = readdirSync(join(root, ROLES_DIR), { withFileTypes: true })
      .filter(
        (entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== ROLES_README,
      )
      .map((entry) => `${ROLES_DIR}/${entry.name}`)
      .sort();
  } catch {
    roleFiles = [];
  }
  for (const file of roleFiles) {
    if (!registrations.has(file))
      findings.push(
        `${file}: role file is not registered in ${CONSTITUTION_FILE} roles[].file (orphan); add it or delete the file`,
      );
  }
  for (const [file, labels] of [...registrations].sort(([a], [b]) => a.localeCompare(b))) {
    if (labels.length < 2) continue;
    findings.push(
      `${file}: duplicate role registration - registered by ${labels.length} roles (${labels.join(', ')}); register each role file exactly once`,
    );
  }
  return findings;
}

function scriptKeys(root) {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return new Set(Object.keys(pkg.scripts ?? {}));
  } catch {
    return new Set();
  }
}

/**
 * @param {{ root?: string }} [options]
 * @returns {{ findings: string[], stats: { roles: number, rules: number, enforced: number, manual: number, ids: string[] } }}
 */
export function checkConstitution({ root = process.cwd() } = {}) {
  const findings = [];
  const stats = { roles: 0, rules: 0, enforced: 0, manual: 0, ids: [] };
  let constitution;
  try {
    constitution = JSON.parse(readFileSync(join(root, CONSTITUTION_FILE), 'utf8'));
  } catch (error) {
    return {
      findings: [
        `${CONSTITUTION_FILE}: unreadable or invalid JSON (${error.message.split('\n')[0]})`,
      ],
      stats,
    };
  }
  if (!isPlainObject(constitution))
    return { findings: [`${CONSTITUTION_FILE}: root must be an object`], stats };
  if (constitution.schema !== CONSTITUTION_SCHEMA)
    findings.push(`schema must be ${CONSTITUTION_SCHEMA}`);
  if (constitution.version !== 1) findings.push('version must be 1');
  if (constitution.repo !== EXPECTED_REPO)
    findings.push(`repo must be "${EXPECTED_REPO}" (shared schema across repositories)`);
  if (typeof constitution.description !== 'string' || constitution.description.length < 20)
    findings.push('description must explain that AGENTS.md is the loaded prompt');

  const checks = scriptKeys(root);
  if (checks.size === 0) findings.push('package.json has no scripts; cannot validate commands');
  const roleIds = new Set();
  if (!Array.isArray(constitution.roles) || constitution.roles.length === 0) {
    findings.push('roles must be a non-empty array');
  } else {
    for (const role of constitution.roles) {
      if (!isPlainObject(role)) {
        findings.push('role entry must be an object');
        continue;
      }
      const label = typeof role.id === 'string' ? role.id : '(missing id)';
      if (typeof role.id !== 'string' || !/^[a-z][a-z0-9-]+$/.test(role.id))
        findings.push(`role ${label}: id must be kebab-case`);
      else if (roleIds.has(role.id)) findings.push(`role ${label}: duplicate id`);
      else roleIds.add(role.id);
      if (!relativeFileExists(root, role.file))
        findings.push(`role ${label}: file ${JSON.stringify(role.file)} does not exist`);
      if (!Array.isArray(role.applies_to) || role.applies_to.length === 0) {
        findings.push(`role ${label}: applies_to must be a non-empty array`);
      } else {
        for (const target of role.applies_to) {
          if (!relativeExists(root, target))
            findings.push(`role ${label}: applies_to ${JSON.stringify(target)} does not exist`);
        }
      }
      if (!Array.isArray(role.required_checks) || role.required_checks.length === 0) {
        findings.push(`role ${label}: required_checks must be a non-empty array`);
      } else {
        for (const check of role.required_checks) {
          if (!checks.has(check))
            findings.push(
              `role ${label}: required check ${JSON.stringify(check)} is not a package.json script`,
            );
        }
      }
    }
    stats.roles = constitution.roles.length;
  }

  findings.push(...roleRegistrationFindings(root, constitution.roles));
  const agentsPresent = relativeFileExists(root, AGENTS_FILE);
  const reachable = agentsPresent ? reachableDocs(root) : new Set();
  if (!agentsPresent)
    findings.push(
      `${AGENTS_FILE}: missing; cannot verify rule source-doc reachability within ${MAX_SOURCE_HOPS} markdown hops`,
    );

  const ruleIds = new Set();
  if (!Array.isArray(constitution.rules) || constitution.rules.length === 0) {
    findings.push('rules must be a non-empty array');
  } else {
    for (const rule of constitution.rules) {
      if (!isPlainObject(rule)) {
        findings.push('rule entry must be an object');
        continue;
      }
      const label = typeof rule.id === 'string' ? rule.id : '(missing id)';
      if (typeof rule.id !== 'string' || !/^CON-\d{3}$/.test(rule.id))
        findings.push(`rule ${label}: id must match CON-###`);
      else if (ruleIds.has(rule.id)) findings.push(`rule ${label}: duplicate id`);
      else ruleIds.add(rule.id);
      if (typeof rule.title !== 'string' || rule.title.trim().length < 3)
        findings.push(`rule ${label}: title is missing`);
      if (typeof rule.statement !== 'string' || rule.statement.trim().length < 20)
        findings.push(`rule ${label}: statement must be substantive`);
      if (!SEVERITIES.has(rule.severity))
        findings.push(`rule ${label}: severity must be blocking or advisory`);
      if (!sourceDocExists(root, rule.source)) {
        findings.push(`rule ${label}: source doc ${JSON.stringify(rule.source)} does not exist`);
      } else if (agentsPresent) {
        const sourcePath = normalizeRepoPath(stripAnchor(rule.source));
        if (!reachable.has(sourcePath))
          findings.push(
            `rule ${label}: source doc ${JSON.stringify(rule.source)} is not reachable from ${AGENTS_FILE} within ${MAX_SOURCE_HOPS} markdown hops`,
          );
      }
      const enforcement = rule.enforcement;
      if (!isPlainObject(enforcement) || !ENFORCEMENT_KINDS.has(enforcement.kind)) {
        findings.push(`rule ${label}: enforcement.kind must be one of command|script|test|manual`);
        continue;
      }
      if (enforcement.kind === 'command') {
        if (!checks.has(enforcement.value))
          findings.push(
            `rule ${label}: command ${JSON.stringify(enforcement.value)} is not a package.json script`,
          );
      } else if (enforcement.kind === 'script') {
        if (!relativeFileExists(root, enforcement.value))
          findings.push(
            `rule ${label}: script ${JSON.stringify(enforcement.value)} does not exist`,
          );
      } else if (enforcement.kind === 'test') {
        if (!Array.isArray(enforcement.paths) || enforcement.paths.length === 0) {
          findings.push(`rule ${label}: test enforcement needs paths`);
        } else {
          for (const path of enforcement.paths) {
            if (!relativeFileExists(root, path))
              findings.push(`rule ${label}: test path ${JSON.stringify(path)} does not exist`);
          }
        }
      } else {
        const checklist = enforcement.checklist;
        if (
          !Array.isArray(checklist) ||
          checklist.length < 2 ||
          checklist.some((item) => typeof item !== 'string' || item.trim().length < 10)
        )
          findings.push(`rule ${label}: manual enforcement needs >=2 substantive checklist items`);
        if (!relativeFileExists(root, enforcement.review_doc))
          findings.push(
            `rule ${label}: manual review_doc ${JSON.stringify(enforcement.review_doc)} does not exist`,
          );
        stats.manual += 1;
      }
      if (enforcement.kind !== 'manual') stats.enforced += 1;
    }
    stats.rules = constitution.rules.length;
    stats.ids = [...ruleIds];
  }
  return { findings, stats };
}

function printSummary(stats) {
  console.log(
    `Constitution OK: ${stats.roles} role(s), ${stats.rules} rule(s) (${stats.enforced} machine-enforced, ${stats.manual} manual-review), ids ${stats.ids[0] ?? '-'}..${stats.ids.at(-1) ?? '-'}.`,
  );
}

export function runAuditConstitution(root = process.cwd(), argv = process.argv.slice(2)) {
  const known = new Set(['--json', '--help']);
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(', ')}`);
    return 2;
  }
  if (argv.includes('--help')) {
    console.log('Usage: node scripts/quality/audit-constitution.mjs [--json]');
    return 0;
  }
  const result = checkConstitution({ root });
  if (argv.includes('--json')) {
    console.log(
      JSON.stringify(
        { ok: result.findings.length === 0, findings: result.findings, stats: result.stats },
        null,
        2,
      ),
    );
    return result.findings.length === 0 ? 0 : 1;
  }
  if (result.findings.length === 0) {
    printSummary(result.stats);
    return 0;
  }
  console.error(`Constitution FAILED: ${result.findings.length} finding(s)`);
  for (const finding of result.findings.slice(0, MAX_REPORTED)) console.error(`  ${finding}`);
  if (result.findings.length > MAX_REPORTED)
    console.error(`  ... and ${result.findings.length - MAX_REPORTED} more`);
  return 1;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runAuditConstitution(process.cwd());
}
