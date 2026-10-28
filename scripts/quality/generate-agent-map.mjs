#!/usr/bin/env node
/**
 * Generate a compact, deterministic repository map for agent sessions.
 *
 * The maintainer evaluated project-graph-mcp and similar MCP servers (compact
 * code representations, claimed ~40% token reduction). An external MCP server
 * is a supply-chain/runtime dependency that must parse untrusted repository
 * content, and its output is not reviewable evidence. A generated skeleton
 * gives most of the benefit locally: agents read one small map instead of
 * running exploratory tree scans, and the file is drift-checked by the same
 * gate suite as the code.
 *
 * STABILITY CONTRACT (schema 2): the map is structure-only. It records paths,
 * package/crate names, tracked/source file counts, the frozen-file baseline and
 * agent entry points. It deliberately does NOT record arbitrary line counts, so
 * ordinary source edits never churn it. It changes only when files are added or
 * removed, when a package/crate is added, or when the file-size baseline is
 * intentionally updated by a split. That makes a pre-commit drift check cheap
 * and meaningful instead of a constant rebase tax.
 *
 * Source = the COMMITTED/STAGED tree (git ls-files --cached), so untracked WIP
 * and other agents scratch files never enter it. No timestamps.
 *
 * Usage:
 *   node scripts/quality/generate-agent-map.mjs            # check worktree
 *   node scripts/quality/generate-agent-map.mjs --staged   # check staged (pre-commit)
 *   node scripts/quality/generate-agent-map.mjs --write    # regenerate
 *
 * Output: docs/agents/repo-map.generated.md. Do not edit it by hand.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isMainModule } from '../is-main-module.mjs';
import { EXCLUDED_PREFIXES, isSourcePath, normalizePath } from './file-size-budget.mjs';

export const MAP_FILE = 'docs/agents/repo-map.generated.md';
export const MAP_SCHEMA_VERSION = 2;
const HOTSPOT_LIMIT = 12;
const TOP_LEVEL_LIMIT = 30;
const BASELINE_FILE = '.file-size-baseline.json';
const BT = String.fromCharCode(96);

const ENTRY_POINTS = [
  ['AGENTS.md', 'always-loaded agent index: map, rules, task discipline'],
  ['.ai/skills/README.md', 'reusable task playbooks (add command, split, validate, review)'],
  ['.ai/roles/README.md', 'on-demand task personas with scope, invariants, required checks'],
  ['.ai/constitution.json', 'machine-validated rule registry (what is actually gated)'],
  ['docs/agents/agent-context-economy.md', 'context budget, quiet commands, 3-File/1-Seam'],
  ['docs/agents/validation-and-workflow.md', 'full validation policy, commands, recovery'],
  ['docs/agents/architecture-invariants.md', 'hard rules and architecture constraints'],
  ['docs/architecture/ipc-type-contract.md', 'Rust<->TS seam inventory and tauri-specta plan'],
  ['docs/quality/file-size-policy.md', '400-line source budget and baseline lifecycle'],
  ['docs/quality/local-validation-queue.md', 'machine-wide admission queue and receipts'],
  ['docs/README.md', 'complete documentation index'],
];

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
}

function trackedFiles(root) {
  return git(root, ['ls-files', '--cached', '-z'])
    .split('\0')
    .filter(Boolean)
    .map(normalizePath)
    .sort();
}

function sourceFileList(root) {
  return trackedFiles(root).filter(
    (file) => isSourcePath(file) && !EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix)),
  );
}

function countSources(files, prefix) {
  const needle = prefix.endsWith('/') ? prefix : prefix + '/';
  return files.filter((file) => file === prefix || file.startsWith(needle)).length;
}

function topLevelLayout(root) {
  const counts = new Map();
  for (const file of trackedFiles(root)) {
    const segment = file.includes('/') ? file.slice(0, file.indexOf('/')) : '(root files)';
    counts.set(segment, (counts.get(segment) ?? 0) + 1);
  }
  return [...counts]
    .map(([segment, files]) => ({ segment, files }))
    .sort((a, b) => b.files - a.files || a.segment.localeCompare(b.segment))
    .slice(0, TOP_LEVEL_LIMIT);
}

function workspacePackages(root) {
  const packages = [];
  for (const manifest of trackedFiles(root)) {
    if (!/(^|\/)(packages|apps)\/[^/]+\/package\.json$/.test(manifest)) continue;
    let name = '(unreadable)';
    try {
      name = JSON.parse(readFileSync(join(root, manifest), 'utf8')).name ?? '(unnamed)';
    } catch {
      // Keep the placeholder; the path is still useful.
    }
    packages.push({ path: dirname(manifest), name });
  }
  return packages.sort((a, b) => a.path.localeCompare(b.path));
}

function workspaceCrates(root) {
  const crates = [];
  for (const manifest of trackedFiles(root)) {
    if (!/(^|\/)crates\/[^/]+\/Cargo\.toml$|^apps\/desktop\/src-tauri\/Cargo\.toml$/.test(manifest))
      continue;
    let name = '(unreadable)';
    try {
      const match = readFileSync(join(root, manifest), 'utf8').match(/^name\s*=\s*"([^"]+)"/m);
      if (match) name = match[1];
    } catch {
      // Keep the placeholder.
    }
    crates.push({ path: dirname(manifest), name });
  }
  return crates.sort((a, b) => a.path.localeCompare(b.path));
}

/** Stable size signal: the committed file-size baseline, not live line counts.
 * It changes only when a split or an intentional re-adoption changes it. */
function frozenHotspots(root) {
  const path = join(root, BASELINE_FILE);
  if (!existsSync(path)) return [];
  try {
    const files = JSON.parse(readFileSync(path, 'utf8')).files ?? {};
    return Object.entries(files)
      .map(([file, lines]) => ({ file, lines }))
      .sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file))
      .slice(0, HOTSPOT_LIMIT);
  } catch {
    return [];
  }
}

/**
 * Build the deterministic map.
 * @param {string} root repository root
 * @returns {{ content: string, stats: { trackedFiles: number, sourceFiles: number } }}
 */
export function buildAgentMap(root) {
  const allFiles = trackedFiles(root);
  const sources = sourceFileList(root);
  const lines = [];
  lines.push('# Agent repository map (generated)');
  lines.push('');
  lines.push(
    '<!-- Generated by scripts/quality/generate-agent-map.mjs from the committed tree; do not edit. -->',
  );
  lines.push(
    '<!-- schema ' +
      MAP_SCHEMA_VERSION +
      '; structure-only: edits do not churn it; regenerate: pnpm agent:map (drift-checked by pnpm audit:agent-map and pre-commit) -->',
  );
  lines.push('');
  lines.push(
    'Tracked files: ' +
      allFiles.length +
      '. Source files (budgeted): ' +
      sources.length +
      '. This map is an index, not a substitute for reading the exact file/line range.',
  );
  lines.push('');
  lines.push('## Top-level layout');
  lines.push('');
  lines.push('| Path | Tracked files |');
  lines.push('|------|---------------|');
  for (const entry of topLevelLayout(root)) {
    lines.push('| ' + BT + entry.segment + BT + ' | ' + entry.files + ' |');
  }
  lines.push('');
  lines.push('## Workspace packages (package.json)');
  lines.push('');
  lines.push('| Path | Name | Source files |');
  lines.push('|------|------|--------------|');
  for (const pkg of workspacePackages(root)) {
    lines.push(
      '| ' +
        BT +
        pkg.path +
        BT +
        ' | ' +
        BT +
        pkg.name +
        BT +
        ' | ' +
        countSources(sources, pkg.path) +
        ' |',
    );
  }
  lines.push('');
  lines.push('## Rust crates (Cargo.toml)');
  lines.push('');
  lines.push('| Path | Crate | Source files |');
  lines.push('|------|-------|--------------|');
  for (const crate of workspaceCrates(root)) {
    lines.push(
      '| ' +
        BT +
        crate.path +
        BT +
        ' | ' +
        BT +
        crate.name +
        BT +
        ' | ' +
        countSources(sources, crate.path) +
        ' |',
    );
  }
  lines.push('');
  lines.push('## Frozen file-size baseline (largest first)');
  lines.push('');
  lines.push(
    'Stable size signal from ' +
      BT +
      BASELINE_FILE +
      BT +
      ' (not live counts). Policy: [file-size-policy](../quality/file-size-policy.md); split queue: [remediation](../quality/agent-context-remediation-2026-10-28.md).',
  );
  lines.push('');
  lines.push('| File | Lines |');
  lines.push('|------|-------|');
  const hotspots = frozenHotspots(root);
  if (hotspots.length === 0) lines.push('| (no baseline) | - |');
  for (const hotspot of hotspots) {
    lines.push('| ' + BT + hotspot.file + BT + ' | ' + hotspot.lines + ' |');
  }
  lines.push('');
  lines.push('## Agent entry points');
  lines.push('');
  lines.push('| File | Load it for |');
  lines.push('|------|-------------|');
  for (const [path, purpose] of ENTRY_POINTS) {
    if (!existsSync(join(root, path))) continue;
    lines.push('| ' + BT + path + BT + ' | ' + purpose + ' |');
  }
  lines.push('');
  lines.push('## Regenerate');
  lines.push('');
  lines.push('```bash');
  lines.push('pnpm agent:map        # rewrite after adding/removing files or a baseline split');
  lines.push('pnpm audit:agent-map  # fail on drift (verify:agent, pre-commit, CI tools)');
  lines.push('```');
  lines.push('');
  return {
    content: lines.join('\n'),
    stats: { trackedFiles: allFiles.length, sourceFiles: sources.length },
  };
}

function stagedMapContent(root) {
  try {
    return git(root, ['show', ':' + MAP_FILE]);
  } catch {
    return null;
  }
}

export function readCommittedMap(root, { staged = false } = {}) {
  if (staged) return stagedMapContent(root);
  const path = join(root, MAP_FILE);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

export function runGenerateAgentMap(root, argv = process.argv.slice(2)) {
  const unknown = argv.filter((arg) => !['--write', '--staged', '--help'].includes(arg));
  if (unknown.length > 0) {
    console.error('Unknown argument(s): ' + unknown.join(', '));
    return 2;
  }
  if (argv.includes('--help')) {
    console.log(
      'Usage: node scripts/quality/generate-agent-map.mjs [--write] [--staged]\n\n' +
        '  (default) check the worktree map against the committed/staged tree\n' +
        '  --staged  check the staged map blob instead (pre-commit; ignores worktree edits)\n' +
        '  --write   regenerate ' +
        MAP_FILE +
        '\n',
    );
    return 0;
  }
  const write = argv.includes('--write');
  if (write && argv.includes('--staged')) {
    console.error('--write and --staged are mutually exclusive');
    return 2;
  }
  const { content, stats } = buildAgentMap(root);
  if (write) {
    const path = join(root, MAP_FILE);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    console.log(
      'Wrote ' +
        MAP_FILE +
        ': ' +
        stats.trackedFiles +
        ' tracked files, ' +
        stats.sourceFiles +
        ' source files (structure-only).',
    );
    return 0;
  }
  const committed = readCommittedMap(root, { staged: argv.includes('--staged') });
  if (committed === content) {
    console.log(
      'Agent map OK: ' +
        MAP_FILE +
        ' matches the committed tree (' +
        stats.trackedFiles +
        ' files).',
    );
    return 0;
  }
  const surface = argv.includes('--staged') ? 'staged map blob' : MAP_FILE;
  console.error(
    committed === null
      ? 'Agent map missing: ' + surface + '; stage a regenerated map (pnpm agent:map)'
      : 'Agent map drift: ' +
          surface +
          ' does not match the committed tree; run pnpm agent:map and stage the result',
  );
  return 1;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runGenerateAgentMap(process.cwd());
}
