#!/usr/bin/env node
/**
 * Rust <-> TypeScript IPC contract audit (repository-context defect 5).
 *
 * The Tauri seam has no generated bindings yet: Rust declares commands with
 * #[tauri::command] and TypeScript reaches them through the untyped invoke()
 * string API. Nothing type-checks the command name, so a caller can invoke a
 * command that does not exist and only find out at runtime.
 *
 * This audit enforces the statically checkable half of the seam: command-name
 * parity. Rust definitions are parsed from apps/desktop/src-tauri/src; literal
 * invoke() call sites are parsed from packages/** and apps/**. Rules:
 *   - a literal TS invoke naming no Rust command fails;
 *   - a dynamic-name call site must be listed in DYNAMIC_CALL_ALLOWLIST with a
 *     reason and a site budget, so command-name transport stays reviewed;
 *   - KNOWN_NATIVE_GAPS is a fail-closed allowlist of pre-existing mismatches.
 *     A gap that starts resolving in Rust fails as a stale entry; a new
 *     unmatched invoke fails. --report lists every gap;
 *   - invoking a defined command that generate_handler! never registers fails,
 *     because Tauri would reject it at runtime;
 *   - plugin-namespaced names (plugin:dialog|open) are not custom commands and
 *     are ignored.
 *
 * Not enforced here (the payload half): argument/return shapes are hand-mirrored
 * between Rust structs and TS interfaces and the invoke wrapper is untyped.
 * docs/architecture/ipc-type-contract.md records those gaps and the phased
 * tauri-specta adoption plan that closes them.
 *
 * Parser limits (regex-based; no TypeScript/Rust dependency): dynamic-name
 * detection is a heuristic, interface method declarations are skipped
 * structurally, and test files are excluded because mocks do not establish a
 * wire contract.
 *
 * Usage:
 *   node scripts/quality/audit-ipc-contract.mjs              # check (exit 1 on drift)
 *   node scripts/quality/audit-ipc-contract.mjs --report     # full inventory (exit 0)
 *   node scripts/quality/audit-ipc-contract.mjs --verbose    # clean run + gap names
 */
import { readFileSync } from 'node:fs';
import { isMainModule } from '../is-main-module.mjs';
import { DYNAMIC_CALL_ALLOWLIST, KNOWN_NATIVE_GAPS } from './ipc-contract-allowlists.mjs';
import { parseInvokeSites } from './ipc-contract-invoke.mjs';
import {
  parseRegisteredCommands,
  parseRustCommands,
  readRustSources,
  readTsSources,
} from './ipc-contract-parse.mjs';
import { MAX_REPORTED_PROBLEMS, printReport } from './ipc-contract-report.mjs';

export { DYNAMIC_CALL_ALLOWLIST, KNOWN_NATIVE_GAPS } from './ipc-contract-allowlists.mjs';
export { parseInvokeSites } from './ipc-contract-invoke.mjs';
export { parseRustCommands } from './ipc-contract-parse.mjs';

/**
 * Analyze the IPC seam. Exposed for tests, which inject fixture allowlists.
 */
export function analyzeIpcContract({
  root = process.cwd(),
  knownNativeGaps = KNOWN_NATIVE_GAPS,
  dynamicAllowlist = DYNAMIC_CALL_ALLOWLIST,
} = {}) {
  const rustSources = readRustSources(root);
  const rustCommands = [];
  let rustSkipped = 0;
  for (const source of rustSources) {
    const parsed = parseRustCommands(source.text, source.file);
    rustSkipped += parsed.skipped;
    for (const command of parsed.commands) rustCommands.push(command);
  }
  const rustByName = new Map();
  const duplicateRustCommands = [];
  for (const command of rustCommands) {
    if (rustByName.has(command.name)) {
      duplicateRustCommands.push({
        name: command.name,
        first: rustByName.get(command.name),
        second: command,
      });
    } else {
      rustByName.set(command.name, command);
    }
  }

  const literals = [];
  const plugins = [];
  const dynamics = [];
  const declarations = [];
  for (const source of readTsSources(root)) {
    const parsed = parseInvokeSites(readFileSync(source.absolute, 'utf8'), source.file);
    literals.push(...parsed.literals);
    plugins.push(...parsed.plugins);
    dynamics.push(...parsed.dynamics);
    declarations.push(...parsed.declarations);
  }

  const uniqueLiteralNames = new Set(literals.map((literal) => literal.name));
  const unknownLiterals = literals.filter((literal) => !rustByName.has(literal.name));
  const knownGapLiterals = unknownLiterals.filter((literal) => knownNativeGaps.has(literal.name));
  const missingLiterals = unknownLiterals.filter((literal) => !knownNativeGaps.has(literal.name));
  const knownGapNames = [...new Set(knownGapLiterals.map((literal) => literal.name))].sort();
  const missingNames = [...new Set(missingLiterals.map((literal) => literal.name))].sort();
  const matchedCount = uniqueLiteralNames.size - new Set(unknownLiterals.map((l) => l.name)).size;

  const problems = [];
  for (const command of duplicateRustCommands) {
    problems.push({
      kind: 'duplicate-rust-command',
      message:
        'duplicate #[tauri::command] ' +
        command.name +
        ': ' +
        command.first.file +
        ':' +
        command.first.line +
        ' and ' +
        command.second.file +
        ':' +
        command.second.line,
    });
  }
  for (const literal of missingLiterals) {
    problems.push({
      kind: 'missing-rust-command',
      message:
        "TS invoke('" +
        literal.name +
        "') at " +
        literal.file +
        ':' +
        literal.line +
        ' names no Rust #[tauri::command]',
    });
  }
  const staleGapNames = [...knownNativeGaps.keys()].filter((name) => rustByName.has(name));
  for (const name of staleGapNames) {
    const command = rustByName.get(name);
    problems.push({
      kind: 'stale-native-gap',
      message:
        "stale KNOWN_NATIVE_GAPS entry '" +
        name +
        "': Rust now defines it at " +
        command.file +
        ':' +
        command.line +
        '; remove the allowlist entry',
    });
  }
  const gapNamesCurrentlyMissing = knownGapNames.filter((name) => !rustByName.has(name));

  const dynamicByFile = new Map();
  for (const site of dynamics) {
    if (!dynamicByFile.has(site.file)) dynamicByFile.set(site.file, []);
    dynamicByFile.get(site.file).push(site);
  }
  for (const [file, sites] of dynamicByFile) {
    const allowed = dynamicAllowlist.get(file);
    if (!allowed) {
      for (const site of sites) {
        problems.push({
          kind: 'dynamic-invoke',
          message:
            'dynamic invoke at ' +
            file +
            ':' +
            site.line +
            ' is not allowlisted; add {maxSites, reason} to DYNAMIC_CALL_ALLOWLIST only for a real dynamic-name transport',
        });
      }
    } else if (sites.length > allowed.maxSites) {
      problems.push({
        kind: 'dynamic-invoke',
        message:
          'dynamic invoke count in ' +
          file +
          ' is ' +
          sites.length +
          ', allowlist maxSites is ' +
          allowed.maxSites +
          '; re-review the transport',
      });
    }
  }
  const unusedDynamicAllowlistEntries = [...dynamicAllowlist.keys()].filter(
    (file) => !dynamicByFile.has(file),
  );

  const registered = parseRegisteredCommands(rustSources);
  const unregisteredInvokedLiterals = [];
  if (registered) {
    for (const literal of literals) {
      if (rustByName.has(literal.name) && !registered.has(literal.name)) {
        unregisteredInvokedLiterals.push(literal);
        problems.push({
          kind: 'unregistered-command',
          message:
            "TS invoke('" +
            literal.name +
            "') at " +
            literal.file +
            ':' +
            literal.line +
            ' targets a Rust command that generate_handler! does not register',
        });
      }
    }
  }
  const definedUnregistered =
    registered === null
      ? []
      : [...rustByName.keys()].filter((name) => !registered.has(name)).sort();
  const neverInvoked = [...rustByName.keys()]
    .filter((name) => !uniqueLiteralNames.has(name))
    .sort();

  return {
    root,
    rustCommands,
    rustSkipped,
    rustByName,
    registered,
    definedUnregistered,
    literals,
    uniqueLiteralNames,
    plugins,
    dynamics,
    declarations,
    duplicateRustCommands,
    unknownLiterals,
    missingLiterals,
    missingNames,
    knownGapLiterals,
    knownGapNames,
    gapNamesCurrentlyMissing,
    matchedCount,
    dynamicByFile,
    dynamicAllowlist,
    unusedDynamicAllowlistEntries,
    unregisteredInvokedLiterals,
    neverInvoked,
    problems,
  };
}

/**
 * CLI entry point.
 * @returns {number} exit code
 */
export function runAuditIpcContract(root = process.cwd(), argv = process.argv.slice(2)) {
  const known = new Set(['--report', '--verbose', '--help']);
  const unknown = argv.filter((argument) => !known.has(argument));
  if (unknown.length > 0) {
    console.error('Unknown argument(s): ' + unknown.join(', '));
    console.error('Usage: node scripts/quality/audit-ipc-contract.mjs [--report] [--verbose]');
    return 2;
  }
  if (argv.includes('--help')) {
    console.log('Usage: node scripts/quality/audit-ipc-contract.mjs [--report] [--verbose]');
    return 0;
  }
  let result;
  try {
    result = analyzeIpcContract({ root });
  } catch (error) {
    console.error(
      'audit-ipc-contract: ' + (error instanceof Error ? error.message : String(error)),
    );
    return 2;
  }
  if (argv.includes('--report')) {
    printReport(result, KNOWN_NATIVE_GAPS);
    return 0;
  }
  if (result.problems.length > 0) {
    console.log('IPC contract drift: ' + result.problems.length + ' problem(s)');
    for (const problem of result.problems.slice(0, MAX_REPORTED_PROBLEMS)) {
      console.log('  ' + problem.message);
    }
    if (result.problems.length > MAX_REPORTED_PROBLEMS) {
      console.log(
        '  ... and ' + (result.problems.length - MAX_REPORTED_PROBLEMS) + ' more problem(s)',
      );
    }
    console.log('Seam rules: docs/architecture/ipc-type-contract.md');
    return 1;
  }
  console.log(
    'IPC contract OK: ' +
      result.rustCommands.length +
      ' Rust commands; ' +
      result.uniqueLiteralNames.size +
      ' unique literal TS invokes; ' +
      result.matchedCount +
      ' matched; ' +
      result.knownGapNames.length +
      ' known pre-existing native gaps (Home Phase 1-3, see docs/architecture/ipc-type-contract.md).',
  );
  console.log(
    'Dynamic invoke sites: ' +
      result.dynamics.length +
      ' allowlisted; ' +
      result.neverInvoked.length +
      ' Rust command(s) never literally invoked (informational); ' +
      new Set(result.plugins.map((plugin) => plugin.name)).size +
      ' plugin-namespaced invoke(s) ignored.',
  );
  if (argv.includes('--verbose') && result.gapNamesCurrentlyMissing.length > 0) {
    console.log('Known gap names: ' + result.gapNamesCurrentlyMissing.join(', '));
  }
  return 0;
}

const isEntryPoint =
  typeof process.argv[1] === 'string' && isMainModule(import.meta.url, process.argv[1]);
if (isEntryPoint) {
  process.exitCode = runAuditIpcContract(process.cwd());
}
