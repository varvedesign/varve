#!/usr/bin/env node
/**
 * Source-file size budget audit (repository-context defect 1: god files).
 *
 * Varve caps hand-maintained source files at 400 lines. Files already over the
 * cap when the budget was adopted are frozen in .file-size-baseline.json at
 * their measured size and may only shrink. A tracked file absent from the
 * baseline that crosses the cap is a violation: split it before committing. A
 * baselined file that grows past its recorded size is a violation too.
 *
 * The cap exists for agent and human context economy, not for style. Loading a
 * 3,000-line module spends thousands of tokens on a single read, and every
 * str_replace against it is more likely to miss or to silently edit the wrong
 * anchor. The enforceable target is a 350-400 line split point: split before
 * growing a baselined file, and use --report to pick the next offender.
 *
 * Scan: git ls-files --cached --others --exclude-standard, filtered to source
 * extensions. Working-tree content is measured (in-flight edits are caught).
 * Enforcement scope is tracked source: committed/staged content is enforced
 * immediately (CI included). Untracked WIP is measured and REPORTED as "WIP"
 * but does not fail another agent's gate while it is being written; it becomes
 * enforced the moment it is tracked/staged, so an over-cap module can never be
 * committed. On a shared workstation one agent's in-flight scratch file must
 * not turn every other session's check red, and the transitional state still
 * cannot hide a god file from the gate.
 *
 * On a shared workstation, split work follows the same rule as everything else:
 * one seam per task, and the file-size baseline ratchets down as splits land.
 *
 * Canonical policy: docs/quality/file-size-policy.md; related hub line/import
 * and complexity ceilings are enforced separately and are not replaced here.
 * Pure policy (cap, exclusions, baseline format, evaluation) lives in
 * ./file-size-budget.mjs so both modules stay inside the budget they enforce.
 *
 * Usage:
 *   node scripts/quality/audit-file-size.mjs             # check (fail on drift)
 *   node scripts/quality/audit-file-size.mjs --staged    # check staged content only (pre-commit)
 *   node scripts/quality/audit-file-size.mjs --report    # ranked inventory
 *   node scripts/quality/audit-file-size.mjs --update    # rewrite baseline
 *   node scripts/quality/audit-file-size.mjs --update --force
 *
 * --update is deliberately conservative once a baseline exists: it refuses to
 * freeze a new over-cap path or to record growth of a frozen file, because that
 * is exactly the laundering operation the ratchet exists to block. --force is
 * for an intentional repository-wide re-adoption (for example a rename), never
 * for making a failing check pass. Untracked over-cap WIP is never frozen.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMainModule } from '../is-main-module.mjs';
import {
  BASELINE_FILE,
  buildBaselinePayload,
  comparePaths,
  countLines,
  EXCLUDED_PREFIXES,
  evaluate,
  GENERATED_FILES,
  isSourcePath,
  MAX_LINES,
  normalizePath,
  readBaseline,
  serializeBaseline,
} from './file-size-budget.mjs';

const MAX_REPORTED_VIOLATIONS = 25;
const REPORT_OFFENDER_LIMIT = 40;

function gitSourcePaths(root, args) {
  let output;
  try {
    output = execFileSync('git', [...args, '-z'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
    });
  } catch {
    throw new Error(
      `audit-file-size must run inside a git checkout (git ls-files failed in ${root})`,
    );
  }
  const files = new Set();
  for (const raw of output.split('\0')) {
    if (raw.length === 0) continue;
    const file = normalizePath(raw);
    if (isSourcePath(file)) files.add(file);
  }
  return files;
}

/**
 * @param {string} root repository root
 * @returns {string[]} sorted repository-relative source paths
 */
export function listSourceFiles(root) {
  return [...gitSourcePaths(root, ['ls-files', '--cached', '--others', '--exclude-standard'])].sort(
    comparePaths,
  );
}

/**
 * @param {string} root repository root
 * @returns {Set<string>} tracked source paths (index content, not working tree)
 */
export function listTrackedSourceFiles(root) {
  return gitSourcePaths(root, ['ls-files', '--cached']);
}

/**
 * Measure every source file in the repository.
 * @param {string} root
 * @returns {{ sizes: Map<string, number>, unreadable: string[], untracked: Set<string> }}
 */
export function scanSourceTree(root) {
  const sizes = new Map();
  const unreadable = [];
  const tracked = listTrackedSourceFiles(root);
  const untracked = new Set();
  for (const file of listSourceFiles(root)) {
    if (!tracked.has(file)) untracked.add(file);
    let text;
    try {
      text = readFileSync(join(root, file), 'utf8');
    } catch {
      // A tracked file deleted in the working tree contributes no lines; do
      // not turn an in-flight delete into a budget failure.
      unreadable.push(file);
      continue;
    }
    sizes.set(file, countLines(text));
  }
  return { sizes, unreadable, untracked };
}

export function listStagedSourceFiles(root) {
  const output = execFileSync(
    'git',
    ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const files = new Set();
  for (const raw of output.split('\0')) {
    if (raw.length === 0) continue;
    const file = normalizePath(raw);
    if (isSourcePath(file)) files.add(file);
  }
  return [...files].sort(comparePaths);
}

/** Measure the staged blobs only. Worktree-only edits (including another
 * agent's in-flight work) are deliberately invisible to the pre-commit
 * checkpoint: a commit is judged on what it will contain. */
export function scanStagedTree(root) {
  const sizes = new Map();
  const unreadable = [];
  for (const file of listStagedSourceFiles(root)) {
    try {
      const text = execFileSync('git', ['show', ':' + file], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      });
      sizes.set(file, countLines(text));
    } catch {
      unreadable.push(file);
    }
  }
  return { sizes, unreadable };
}

function runCheckStaged(sizes, baseline, unreadable) {
  const result = evaluate(sizes, baseline, { partial: true });
  const lines = [];
  if (result.violations.length === 0) {
    lines.push(
      `File-size budget (staged) OK: ${sizes.size} staged source file(s) at or under ${MAX_LINES} lines.`,
    );
  } else {
    lines.push(
      `File-size budget (staged) FAILED: ${result.violations.length} violation(s); cap ${MAX_LINES} lines. Split before committing.`,
    );
    for (const violation of result.violations.slice(0, MAX_REPORTED_VIOLATIONS)) {
      lines.push(`  ${formatViolation(violation)}`);
    }
  }
  if (unreadable.length > 0) {
    lines.push(
      `warning: ${unreadable.length} staged source file(s) could not be read: ${unreadable.slice(0, 5).join(', ')}`,
    );
  }
  console.log(lines.join('\\n'));
  return result.violations.length === 0 ? 0 : 1;
}

function formatViolation(violation) {
  if (violation.kind === 'new') {
    return `NEW   ${violation.file} — ${violation.lines} lines (split before committing; cap ${MAX_LINES})`;
  }
  return `GREW  ${violation.file} — ${violation.lines} lines (+${violation.delta} over frozen baseline ${violation.allowed})`;
}

function printPendingWip(pending, lines) {
  if (pending.length === 0) return;
  lines.push(
    `WIP   ${pending.length} untracked over-cap file(s) reported, not enforced until tracked:`,
  );
  for (const item of pending.slice(0, 10)) lines.push(`      ${item.file} — ${item.lines} lines`);
  if (pending.length > 10) lines.push(`      ... and ${pending.length - 10} more`);
}

function runCheck(_root, sizes, baseline, untracked) {
  const result = evaluate(sizes, baseline, { untracked });
  const lines = [];
  if (result.violations.length === 0) {
    lines.push(
      `File-size budget OK: ${sizes.size} source files scanned; ${result.overCap} over ${MAX_LINES} lines, all frozen in ${BASELINE_FILE} (tracked content).`,
    );
  } else {
    lines.push(
      `File-size budget FAILED: ${result.violations.length} violation(s); cap ${MAX_LINES} lines. Run --report for the ranked inventory.`,
    );
    for (const violation of result.violations.slice(0, MAX_REPORTED_VIOLATIONS)) {
      lines.push(`  ${formatViolation(violation)}`);
    }
    if (result.violations.length > MAX_REPORTED_VIOLATIONS) {
      lines.push(
        `  ... and ${result.violations.length - MAX_REPORTED_VIOLATIONS} more violation(s)`,
      );
    }
  }
  printPendingWip(result.pending, lines);
  if (result.stale.length > 0) {
    lines.push(
      `Note: ${result.stale.length} stale baseline entr${result.stale.length === 1 ? 'y' : 'ies'} (shrunk below the cap or deleted). Run --update after intentional splits to prune them.`,
    );
  }
  console.log(lines.join('\n'));
  return result.violations.length === 0 ? 0 : 1;
}

function runReport(_root, sizes, baseline, untracked) {
  const result = evaluate(sizes, baseline, { untracked });
  const offenders = [...sizes]
    .filter(([, lines]) => lines > MAX_LINES)
    .sort(([pathA, linesA], [pathB, linesB]) =>
      linesA === linesB ? comparePaths(pathA, pathB) : linesB - linesA,
    );
  const output = [
    'File-size budget report',
    `Scanned ${sizes.size} source files; ${result.overCap} over the ${MAX_LINES}-line cap; ${result.frozen.length} frozen${baseline ? ` in ${BASELINE_FILE}` : ' (no baseline)'}; ${result.violations.length} violation(s); ${result.pending.length} untracked WIP over-cap file(s).`,
    `Excess over cap: ${result.excessLines} lines. Baseline entries: ${baseline ? Object.keys(baseline.files).length : 0} (${result.stale.length} stale).`,
    `Excluded: ${EXCLUDED_PREFIXES.join(', ')} and ${GENERATED_FILES.size} machine-generated data file(s).`,
    `Top ${Math.min(REPORT_OFFENDER_LIMIT, offenders.length)} offenders by line count:`,
  ];
  for (const [file, lines] of offenders.slice(0, REPORT_OFFENDER_LIMIT)) {
    if (untracked.has(file)) {
      output.push(`  ${String(lines).padStart(6)}  ${file}  [WIP]`);
      continue;
    }
    const allowed = baseline?.files?.[file];
    const status =
      allowed === undefined ? 'NEW' : lines > allowed ? `+${lines - allowed}` : 'frozen';
    output.push(`  ${String(lines).padStart(6)}  ${file}  [${status}]`);
  }
  if (offenders.length > REPORT_OFFENDER_LIMIT) {
    output.push(`  ... ${offenders.length - REPORT_OFFENDER_LIMIT} more over-cap file(s)`);
  }
  console.log(output.join('\n'));
  return 0;
}

function runUpdate(root, sizes, baseline, force, untracked) {
  const next = buildBaselinePayload(sizes, { untracked });
  const previous = baseline?.files ?? {};
  const added = Object.keys(next.files).filter((file) => previous[file] === undefined);
  const grown = Object.keys(next.files).filter(
    (file) => previous[file] !== undefined && next.files[file] > previous[file],
  );
  const removed = Object.keys(previous).filter((file) => next.files[file] === undefined);
  if (!force && baseline !== null && (added.length > 0 || grown.length > 0)) {
    console.error(
      `Refusing to rewrite ${BASELINE_FILE}: --update may only record intentional splits.`,
    );
    if (added.length > 0) {
      console.error(
        `  ${added.length} new over-cap file(s) must be split, not frozen: ${added.slice(0, 10).join(', ')}${added.length > 10 ? ', ...' : ''}`,
      );
    }
    if (grown.length > 0) {
      console.error(
        `  ${grown.length} frozen file(s) grew; split before growing: ${grown.slice(0, 10).join(', ')}${grown.length > 10 ? ', ...' : ''}`,
      );
    }
    console.error('  --force rewrites anyway; use it only for an intentional re-adoption.');
    return 1;
  }
  writeFileSync(join(root, BASELINE_FILE), serializeBaseline(next));
  console.log(
    [
      `Wrote ${BASELINE_FILE}: ${Object.keys(next.files).length} frozen file(s) over ${MAX_LINES} lines.`,
      `  added ${added.length}, grown ${grown.length}, removed ${removed.length} (splits/deletes/untracked-pruned).`,
      untracked.size > 0
        ? `  ${untracked.size} untracked file(s) scanned; over-cap WIP is never frozen.`
        : '',
      force ? '  --force: new/grown entries recorded intentionally.' : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  return 0;
}

function printUsage() {
  console.log(
    `Usage: node scripts/quality/audit-file-size.mjs [--report|--update [--force]]\n\n` +
      `  (default)  fail when a tracked source file over ${MAX_LINES} lines is new or grew past its frozen size; report untracked WIP\n` +
      `  --report   print the ranked offender inventory (always exits 0)\n` +
      `  --update   rewrite ${BASELINE_FILE} after intentional splits; refuses to freeze new growth\n` +
      `  --force    with --update: record new/grown entries (intentional re-adoption only)\n`,
  );
}

/**
 * @param {string} root
 * @param {string[]} argv
 * @returns {number} exit code
 */
export function runAuditFileSize(root, argv = process.argv.slice(2)) {
  const known = new Set(['--report', '--update', '--force', '--staged', '--help']);
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(', ')}`);
    printUsage();
    return 2;
  }
  if (argv.includes('--help')) {
    printUsage();
    return 0;
  }
  if (argv.includes('--staged')) {
    if (argv.includes('--update') || argv.includes('--report')) {
      console.error('--staged cannot be combined with --update or --report');
      return 2;
    }
    let staged;
    let stagedBaseline;
    try {
      staged = scanStagedTree(root);
      stagedBaseline = readBaseline(root);
    } catch (error) {
      console.error(`audit-file-size: ${error instanceof Error ? error.message : String(error)}`);
      return 2;
    }
    return runCheckStaged(staged.sizes, stagedBaseline, staged.unreadable);
  }
  const mode = argv.includes('--update')
    ? 'update'
    : argv.includes('--report')
      ? 'report'
      : 'check';
  let sizes;
  let baseline;
  let unreadable;
  let untracked;
  try {
    ({ sizes, unreadable, untracked } = scanSourceTree(root));
    baseline = readBaseline(root);
  } catch (error) {
    console.error(`audit-file-size: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  if (unreadable.length > 0) {
    console.error(
      `audit-file-size: skipped ${unreadable.length} unreadable tracked file(s): ${unreadable.slice(0, 5).join(', ')}${unreadable.length > 5 ? ', ...' : ''}`,
    );
  }
  if (mode === 'update')
    return runUpdate(root, sizes, baseline, argv.includes('--force'), untracked);
  if (mode === 'report') return runReport(root, sizes, baseline, untracked);
  return runCheck(root, sizes, baseline, untracked);
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runAuditFileSize(process.cwd());
}
