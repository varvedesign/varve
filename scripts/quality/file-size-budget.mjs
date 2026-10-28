#!/usr/bin/env node
/**
 * Pure file-size budget policy for the repository-context guards.
 *
 * This module owns the cap, the exclusion sets, the baseline format, and the
 * tracked-vs-untracked evaluation rules. The CLI in `audit-file-size.mjs` owns
 * git scanning and output, so both stay small enough to satisfy the very budget
 * they enforce.
 *
 * Enforcement scope is tracked source: committed/staged content is enforced
 * immediately (CI included). Untracked WIP is measured and reported as "WIP"
 * but does not fail another agent's gate while it is being written; it becomes
 * enforced the moment it is tracked/staged, so an over-cap module can never be
 * committed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Hard cap for hand-maintained source files. Split at 350-400 lines. */
export const MAX_LINES = 400;
export const BASELINE_FILE = '.file-size-baseline.json';
export const BASELINE_SCHEMA_VERSION = 1;

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.rs']);

/** Directory prefixes excluded from the budget. Keep this list and the policy doc in sync. */
export const EXCLUDED_PREFIXES = ['vendor/'];

/**
 * Machine-generated files, keyed by path with the generator that produces them.
 * These are derived data committed as source so the build is offline-safe. They
 * are excluded from the line budget because splitting them is meaningless and
 * reviewing them line-by-line is not the source of truth: the generator is.
 */
export const GENERATED_FILES = new Map([
  [
    'packages/engine/src/text/lineBreakClassesData.ts',
    'scripts/generate-line-break-data.mjs (Unicode UAX #14 tables)',
  ],
  [
    'packages/shared/src/verticalOrientationData.ts',
    'scripts/generate-vertical-orientation.mjs (Unicode vertical orientation tables)',
  ],
  [
    'packages/engine/src/inference/models/siglipT5Charmap.ts',
    'scripts/semantic-corpus/generate-siglip-charmap.py (derived SigLIP tokenizer charmap)',
  ],
]);

/** Normalize a git path to forward slashes for stable cross-platform output. */
export function normalizePath(file) {
  return file.replaceAll('\\', '/');
}

export function isSourcePath(file) {
  const normalized = normalizePath(file);
  const dot = normalized.lastIndexOf('.');
  if (dot < 0 || !SOURCE_EXTENSIONS.has(normalized.slice(dot))) return false;
  if (EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return false;
  return !GENERATED_FILES.has(normalized);
}

/**
 * Count the lines a file contributes to the budget. A trailing newline does not
 * start another line, so a 400-line file with a final newline counts as 400.
 * @param {string} text
 * @returns {number}
 */
export function countLines(text) {
  if (text.length === 0) return 0;
  const segments = text.split('\n').length;
  return text.endsWith('\n') ? segments - 1 : segments;
}

export function comparePaths(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * @param {string} root
 * @returns {{ schemaVersion: number, maxLines: number, files: Record<string, number> } | null}
 */
export function readBaseline(root) {
  const path = join(root, BASELINE_FILE);
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (parsed.schemaVersion !== BASELINE_SCHEMA_VERSION) {
    throw new Error(
      `${BASELINE_FILE}: unsupported schemaVersion ${parsed.schemaVersion} (expected ${BASELINE_SCHEMA_VERSION})`,
    );
  }
  if (parsed.maxLines !== MAX_LINES) {
    throw new Error(
      `${BASELINE_FILE}: maxLines is ${parsed.maxLines} but the policy cap is ${MAX_LINES}`,
    );
  }
  const files = parsed.files ?? {};
  for (const [file, lines] of Object.entries(files)) {
    if (!Number.isInteger(lines) || lines <= MAX_LINES) {
      throw new Error(
        `${BASELINE_FILE}: ${file} has invalid frozen size ${lines} (must be an integer > ${MAX_LINES})`,
      );
    }
  }
  return { schemaVersion: parsed.schemaVersion, maxLines: parsed.maxLines, files };
}

/**
 * Compare the measured tree against a baseline.
 * @param {Map<string, number>} sizes
 * @param {{ files: Record<string, number> } | null} baseline
 * @param {{ untracked?: Set<string>, partial?: boolean }} [options]
 *   partial: evaluate only the supplied files (staged mode); never report
 *   unrelated baseline entries as stale.
 */
export function evaluate(sizes, baseline, { untracked = new Set(), partial = false } = {}) {
  const frozenFiles = baseline?.files ?? {};
  const violations = [];
  const pending = [];
  const frozen = [];
  let overCap = 0;
  let excessLines = 0;
  for (const [file, lines] of sizes) {
    if (lines <= MAX_LINES) continue;
    overCap += 1;
    excessLines += lines - MAX_LINES;
    if (untracked.has(file)) {
      // Not repository content yet: reported, not enforced. Tracking the file
      // moves it into the normal NEW/GREW evaluation below.
      pending.push({ file, lines });
      continue;
    }
    const allowed = frozenFiles[file];
    if (allowed === undefined) {
      violations.push({ kind: 'new', file, lines });
    } else if (lines > allowed) {
      violations.push({ kind: 'grew', file, lines, allowed, delta: lines - allowed });
    } else {
      frozen.push({ file, lines, allowed, slack: allowed - lines });
    }
  }
  const stale = [];
  if (baseline && !partial) {
    for (const [file, allowed] of Object.entries(frozenFiles)) {
      const lines = sizes.get(file);
      if (lines === undefined || lines <= MAX_LINES) stale.push({ file, allowed });
    }
  }
  return { violations, pending, frozen, overCap, excessLines, stale };
}

/**
 * Build the deterministic baseline payload for the current tree. Files are
 * sorted by repository path; there is no timestamp, so running --update twice on
 * the same tree produces byte-identical output.
 * Only tracked source is frozen: untracked WIP is deliberately not adopted,
 * because it is not repository content yet and can still change or disappear.
 * @param {Map<string, number>} sizes
 * @param {{ untracked?: Set<string> }} [options]
 */
export function buildBaselinePayload(sizes, { untracked = new Set() } = {}) {
  const files = {};
  const offenders = [...sizes]
    .filter(([file, lines]) => lines > MAX_LINES && !untracked.has(file))
    .sort(([a], [b]) => comparePaths(a, b));
  for (const [file, lines] of offenders) files[file] = lines;
  return { schemaVersion: BASELINE_SCHEMA_VERSION, maxLines: MAX_LINES, files };
}

/** Serialize the baseline deterministically (2-space JSON, sorted keys, final newline). */
export function serializeBaseline(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}
