#!/usr/bin/env node
/**
 * IPC contract audit — human-readable inventory output.
 */
import { HOME_PHASE_GAP_REASON } from './ipc-contract-allowlists.mjs';

const MAX_REPORTED_PROBLEMS = 30;

function printKnownGaps(result, knownNativeGaps) {
  if (result.gapNamesCurrentlyMissing.length === 0) return;
  console.log('Known pre-existing native gaps (Home Phase 1-3, fail-closed allowlist):');
  console.log('  reason: ' + HOME_PHASE_GAP_REASON);
  for (const name of result.gapNamesCurrentlyMissing) {
    const reason = knownNativeGaps.get(name) ?? '';
    console.log('  ' + name + (reason === HOME_PHASE_GAP_REASON ? '' : ' — ' + reason));
  }
}

/** Full seam inventory. Always informational; drift is reported by the check. */
export function printReport(result, knownNativeGaps) {
  const rustByFile = new Map();
  for (const command of result.rustCommands) {
    rustByFile.set(command.file, (rustByFile.get(command.file) ?? 0) + 1);
  }
  const tsFiles = new Set(result.literals.map((literal) => literal.file));
  const output = [
    'IPC contract report',
    'Rust commands: ' +
      result.rustCommands.length +
      ' in ' +
      rustByFile.size +
      ' file(s); registration list parsed: ' +
      (result.registered === null ? 'no' : 'yes (' + result.registered.size + ' registered)') +
      '; parser-skipped attributes: ' +
      result.rustSkipped +
      '.',
  ];
  for (const [file, count] of [...rustByFile.entries()].sort((a, b) => b[1] - a[1])) {
    output.push('  ' + String(count).padStart(4) + '  ' + file);
  }
  output.push(
    'Literal TS invokes: ' +
      result.literals.length +
      ' site(s) in ' +
      tsFiles.size +
      ' file(s); ' +
      result.uniqueLiteralNames.size +
      ' unique command(s); ' +
      result.matchedCount +
      ' matched; ' +
      result.missingNames.length +
      ' unmatched; ' +
      result.knownGapNames.length +
      ' known gap(s).',
  );
  output.push(
    'Plugin-namespaced invokes ignored: ' +
      new Set(result.plugins.map((plugin) => plugin.name)).size +
      ' unique (' +
      result.plugins.length +
      ' site(s)). Dynamic call sites: ' +
      result.dynamics.length +
      ' in ' +
      result.dynamicByFile.size +
      ' allowlisted file(s); interface declarations skipped: ' +
      result.declarations.length +
      '.',
  );
  output.push('Rust commands never literally invoked: ' + result.neverInvoked.length + '.');
  if (result.definedUnregistered.length > 0) {
    output.push(
      'Defined but not registered in generate_handler!: ' +
        result.definedUnregistered.length +
        ' (' +
        result.definedUnregistered.join(', ') +
        ')',
    );
  }
  if (result.dynamicByFile.size > 0) {
    output.push('Dynamic call allowlist:');
    for (const [file, sites] of result.dynamicByFile) {
      const entry = result.dynamicAllowlist.get(file);
      output.push(
        '  ' +
          file +
          ' — ' +
          sites.length +
          ' site(s); ' +
          (entry ? entry.reason : 'NOT ALLOWLISTED'),
      );
    }
  }
  const gaps = [...result.knownGapNames].sort();
  if (gaps.length > 0) {
    result.gapNamesCurrentlyMissing = gaps;
    output.push('Known pre-existing native gaps (Home Phase 1-3, fail-closed allowlist):');
    output.push('  reason: ' + HOME_PHASE_GAP_REASON);
    for (const name of gaps) output.push('  ' + name);
  }
  if (result.missingNames.length > 0) {
    output.push('Unmatched TS invokes: ' + result.missingNames.join(', '));
  }
  console.log(output.join('\n'));
  if (result.problems.length > 0) {
    console.log('Problems:');
    for (const problem of result.problems.slice(0, MAX_REPORTED_PROBLEMS)) {
      console.log('  ' + problem.message);
    }
  }
}

export { MAX_REPORTED_PROBLEMS };
