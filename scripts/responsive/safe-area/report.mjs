/** JSON + markdown evidence writer for the safe-area validation harness. */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  LANDSCAPE_INSETS,
  NEWLINE,
  PORTRAIT_INSETS,
  relativeToRoot,
  shortSha,
  TOLERANCE,
} from './config.mjs';

export function writeReport(out, checks, screenshots) {
  mkdirSync(out, { recursive: true });
  const failed = checks.filter((check) => !check.ok);
  const skipped = checks.filter((check) => check.skipped === true);
  const passed = checks.filter((check) => check.ok && check.skipped !== true);
  const report = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    commit: shortSha(),
    emulatedInsets: { portrait: PORTRAIT_INSETS, landscape: LANDSCAPE_INSETS },
    tolerancePx: TOLERANCE,
    passed: passed.length,
    failed: failed.length,
    skipped: skipped.length,
    checks,
    screenshots,
  };
  writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + NEWLINE);
  const md = [
    '# Safe-area validation report',
    '',
    `- commit: ${report.commit}`,
    `- generated: ${report.generatedAt}`,
    '- emulated insets (portrait): top ' +
      PORTRAIT_INSETS.top +
      ', bottom ' +
      PORTRAIT_INSETS.bottom +
      ', left ' +
      PORTRAIT_INSETS.left +
      ', right ' +
      PORTRAIT_INSETS.right,
    '- emulated insets (landscape): top ' +
      LANDSCAPE_INSETS.top +
      ', bottom ' +
      LANDSCAPE_INSETS.bottom +
      ', left ' +
      LANDSCAPE_INSETS.left +
      ', right ' +
      LANDSCAPE_INSETS.right,
    `- result: ${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped`,
    `- screenshots: ${screenshots.length}`,
    '',
    '| Check | Result |',
    '|---|---|',
  ];
  for (const check of checks) {
    const result = check.skipped === true ? 'SKIP' : check.ok ? 'PASS' : 'FAIL';
    md.push(`| ${check.name} | ${result} |`);
  }
  writeFileSync(path.join(out, 'report.md'), md.join(NEWLINE) + NEWLINE);
  return {
    passed: report.passed,
    failed,
    skipped: skipped.length,
    reportPath: relativeToRoot(path.join(out, 'report.json')),
  };
}
