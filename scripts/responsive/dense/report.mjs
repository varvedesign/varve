/** JSON + markdown evidence writer for the dense-data probe. */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const NEWLINE = '\n';

/**
 * Persist one probe run next to its report.
 * @param {string} outDir
 * @param {object} report
 * @returns {{ total: number, passed: number, failed: number, result: 'PASS' | 'FAIL' }}
 */
export function writeReport(outDir, report) {
  mkdirSync(outDir, { recursive: true });
  const failed = report.checks.filter((item) => !item.pass);
  const passed = report.checks.length - failed.length;
  const summary = {
    total: report.checks.length,
    passed,
    failed: failed.length,
    result: failed.length === 0 && report.errors.length === 0 ? 'PASS' : 'FAIL',
  };
  const payload = { ...report, summary };
  writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(payload, null, 2) + NEWLINE);

  const lines = [
    '# Dense-data responsive probe report',
    '',
    '- Commit: ' + report.commit,
    '- Generated: ' + report.generatedAt,
    '- Command: ' + report.command,
    '- Scene: ' +
      (report.scene
        ? report.scene.layersRows + ' layers rows, ' + report.scene.trackRows + ' track rows'
        : 'not seeded'),
    '- Result: ' + summary.result + ' (' + passed + '/' + report.checks.length + ' checks)',
    '',
    '## Checks',
    '',
    '| Run | Check | Result | Measured |',
    '| --- | --- | --- | --- |',
  ];
  for (const item of report.checks) {
    lines.push(
      '| ' +
        item.run +
        ' | ' +
        item.id +
        ' | ' +
        (item.pass ? 'PASS' : 'FAIL') +
        ' | ' +
        JSON.stringify(item.measured) +
        ' |',
    );
  }
  lines.push('', '## Metrics', '');
  for (const run of report.runs) lines.push('- ' + run.label + ': ' + JSON.stringify(run.metrics));
  if (report.errors.length > 0) {
    lines.push('', '## Page errors', '');
    for (const error of report.errors) lines.push('- ' + error);
  }
  lines.push('', '## Screenshots', '');
  for (const run of report.runs) {
    for (const file of run.screenshots) lines.push('- ' + file);
  }
  writeFileSync(path.join(outDir, 'report.md'), lines.join(NEWLINE) + NEWLINE);
  return summary;
}
