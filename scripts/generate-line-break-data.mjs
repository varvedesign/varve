#!/usr/bin/env node
/**
 * Generate line-breaking data from the pinned Unicode Character Database.
 *
 * Usage:
 *   curl -o /tmp/LineBreak.txt \
 *     https://www.unicode.org/Public/16.0.0/ucd/LineBreak.txt
 *   curl -o /tmp/EastAsianWidth.txt \
 *     https://www.unicode.org/Public/16.0.0/ucd/EastAsianWidth.txt
 *   curl -o /tmp/UnicodeData.txt \
 *     https://www.unicode.org/Public/16.0.0/ucd/UnicodeData.txt
 *   curl -o /tmp/LineBreakTest.txt \
 *     https://www.unicode.org/Public/16.0.0/ucd/auxiliary/LineBreakTest.txt
 *   node scripts/generate-line-break-data.mjs /tmp/LineBreak.txt /tmp/LineBreakTest.txt /tmp/EastAsianWidth.txt /tmp/UnicodeData.txt
 *
 * Emits two committed modules:
 *
 *   packages/engine/src/text/lineBreakClassesData.ts
 *     Line_Break property ranges (UAX #14), the runtime table.
 *
 *   packages/engine/src/text/__fixtures__/lineBreakProhibitionData.ts
 *     A compact conformance fixture derived from the official
 *     LineBreakTest.txt: the resolved-class pairs that the oracle treats as
 *     unconditionally prohibited (never a break opportunity). The full oracle
 *     is 3 MB and is not committed; this fixture records the source file's
 *     SHA-256 and the derivation's denominators so the check is reproducible.
 *
 * The version pin is shared by both outputs so the class table and the
 * conformance fixture can never describe different UCD releases.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [
  ,
  ,
  classPath = '/tmp/LineBreak.txt',
  testPath = '/tmp/LineBreakTest.txt',
  widthPath = '/tmp/EastAsianWidth.txt',
  unicodeDataPath = '/tmp/UnicodeData.txt',
  emojiDataPath = '/tmp/emoji-data.txt',
] = process.argv;

const classText = readFileSync(classPath, 'utf8');
const testText = readFileSync(testPath, 'utf8');
const widthText = readFileSync(widthPath, 'utf8');
const unicodeDataText = readFileSync(unicodeDataPath, 'utf8');
const emojiDataText = readFileSync(emojiDataPath, 'utf8');

const version = classText.match(/^# LineBreak-([\d.]+)\.txt$/m)?.[1];
const classDate = classText.match(/^# Date: (.+)$/m)?.[1];
if (!version) throw new Error('Could not read LineBreak.txt version header');
if (!classDate) throw new Error('Could not read LineBreak.txt date header');
if (classText.match(/^# @missing: [0-9A-F.]+; (\w+)$/m)?.[1] !== 'XX') {
  throw new Error('Unexpected @missing default; regenerate against the pinned format');
}

// UAX #14 §5.1 class order. Index 0..n-1, emitted as names + numeric ranges.
const CLASSES = [
  'BK',
  'CR',
  'LF',
  'CM',
  'NL',
  'SG',
  'WJ',
  'ZW',
  'GL',
  'SP',
  'ZWJ',
  'B2',
  'BA',
  'BB',
  'HY',
  'HH',
  'CB',
  'CL',
  'CP',
  'EX',
  'IN',
  'NS',
  'OP',
  'QU',
  'IS',
  'NU',
  'PO',
  'PR',
  'SY',
  'AI',
  'AK',
  'AL',
  'AP',
  'AS',
  'CJ',
  'EB',
  'EM',
  'H2',
  'H3',
  'HL',
  'ID',
  'JL',
  'JV',
  'JT',
  'RI',
  'SA',
  'VF',
  'VI',
  'XX',
];
const CLASS_INDEX = new Map(CLASSES.map((name, index) => [name, index]));

const ranges = [];
for (const line of classText.split('\n')) {
  const data = line.match(/^([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s*;\s*(\w+)\s*(?:#|$)/);
  if (!data) continue;
  const index = CLASS_INDEX.get(data[3]);
  if (index === undefined) throw new Error(`Unknown line break class ${data[3]}`);
  ranges.push([parseInt(data[1], 16), parseInt(data[2] ?? data[1], 16), index]);
}
if (ranges.length < 2000) throw new Error(`Only ${ranges.length} ranges parsed; file truncated?`);

ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
for (let i = 1; i < ranges.length; i++) {
  if (ranges[i][0] <= ranges[i - 1][1]) {
    throw new Error(
      `Overlapping explicit ranges at ${ranges[i][0].toString(16)}; ` +
        'the pinned data file is expected to be non-overlapping',
    );
  }
}

/**
 * Documented unassigned defaults from the file header (see the notes at the
 * top of LineBreak.txt). The data section lists only assigned code points, so
 * gaps are filled from these blocks before falling back to the "XX" default.
 * Explicit assignments always win: U+20A7 PESETA SIGN is PO inside the
 * Currency Symbols block whose *unassigned* members default to PR.
 */
const HEADER_DEFAULTS = [
  [
    'ID',
    [
      [0x3400, 0x4dbf],
      [0x4e00, 0x9fff],
      [0xf900, 0xfaff],
      [0x20000, 0x2fffd],
      [0x30000, 0x3fffd],
      [0x1f000, 0x1faff],
      [0x1fc00, 0x1fffd],
    ],
  ],
  ['PR', [[0x20a0, 0x20cf]]],
];
const defaultBlocks = [];
for (const [name, blocks] of HEADER_DEFAULTS) {
  const index = CLASS_INDEX.get(name);
  for (const [first, last] of blocks) defaultBlocks.push([first, last, index]);
}
const XX = CLASS_INDEX.get('XX');

function defaultClassOf(codePoint) {
  for (const [first, last, index] of defaultBlocks) {
    if (codePoint >= first && codePoint <= last) return index;
  }
  return XX;
}

// Build the full table by sweeping the union of explicit-range and
// default-block boundaries: an explicit assignment always wins, otherwise the
// header default for that position applies.
const boundaries = new Set([0, 0x110000]);
for (const [first, last] of ranges) {
  boundaries.add(first);
  boundaries.add(last + 1);
}
for (const [first, last] of defaultBlocks) {
  boundaries.add(first);
  boundaries.add(last + 1);
}
const points = [...boundaries].sort((a, b) => a - b);

function explicitClassOf(codePoint) {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const row = ranges[mid];
    if (codePoint < row[0]) hi = mid - 1;
    else if (codePoint > row[1]) lo = mid + 1;
    else return row[2];
  }
  return null;
}

const segments = [];
for (let i = 0; i < points.length - 1; i++) {
  const start = points[i];
  const end = points[i + 1] - 1;
  const value = explicitClassOf(start) ?? defaultClassOf(start);
  if (explicitClassOf(end) !== explicitClassOf(start)) {
    throw new Error(`Segment ${start.toString(16)}..${end.toString(16)} crosses an explicit edge`);
  }
  const previous = segments[segments.length - 1];
  if (previous && previous[2] === value) previous[1] = end;
  else segments.push([start, end, value]);
}

const merged = segments;
if (merged[0][0] !== 0 || merged[merged.length - 1][1] !== 0x10ffff) {
  throw new Error('Merged table does not cover the whole code space');
}
for (let i = 1; i < merged.length; i++) {
  if (merged[i][0] !== merged[i - 1][1] + 1) {
    throw new Error(`Gap in merged table at ${merged[i][0].toString(16)}`);
  }
}

function classIndexOf(codePoint) {
  let lo = 0;
  let hi = merged.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const row = merged[mid];
    if (codePoint < row[0]) hi = mid - 1;
    else if (codePoint > row[1]) lo = mid + 1;
    else return row[2];
  }
  throw new Error(`No class for U+${codePoint.toString(16)}`);
}

// ---------------------------------------------------------------------------
// East_Asian_Width, for the `$EastAsian` set that LB19a, LB30 and LB30a use.
// UAX #14 defines $EastAsian as East_Asian_Width in {F, W, H}; only that
// membership is needed, so the table is emitted as boolean ranges.
// ---------------------------------------------------------------------------
const widthVersion = widthText.match(/^# EastAsianWidth-([\d.]+)\.txt$/m)?.[1];
const widthDate = widthText.match(/^# Date: (.+)$/m)?.[1];
if (widthVersion !== version) {
  throw new Error(`Version mismatch: LineBreak ${version} vs EastAsianWidth ${widthVersion}`);
}
const widthRanges = [];
for (const line of widthText.split('\n')) {
  const data = line.match(/^([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s*;\s*(\w+)\s*(?:#|$)/);
  if (!data) continue;
  if (data[3] === 'F' || data[3] === 'W' || data[3] === 'H') {
    widthRanges.push([parseInt(data[1], 16), parseInt(data[2] ?? data[1], 16)]);
  }
}
if (widthRanges.length < 100) {
  throw new Error(`Only ${widthRanges.length} wide ranges parsed; file truncated?`);
}
widthRanges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const widthMerged = [];
for (const [first, last] of widthRanges) {
  const previous = widthMerged[widthMerged.length - 1];
  if (previous && first <= previous[1] + 1) {
    previous[1] = Math.max(previous[1], last);
    continue;
  }
  widthMerged.push([first, last]);
}

// ---------------------------------------------------------------------------
// General_Category Pi/Pf members of class QU, which LB15a, LB15b and LB19 use
// to distinguish initial from final quotation marks. Derived from
// UnicodeData.txt rather than hardcoded so the sets track the pinned release.
// ---------------------------------------------------------------------------
const unicodeDataVersion = unicodeDataText.match(/^# UnicodeData-([\d.]+)\.txt$/m)?.[1];
if (unicodeDataVersion !== undefined && unicodeDataVersion !== version) {
  throw new Error(`Version mismatch: LineBreak ${version} vs UnicodeData ${unicodeDataVersion}`);
}
const initialQuotes = [];
const finalQuotes = [];
for (const line of unicodeDataText.split('\n')) {
  const fields = line.split(';');
  if (fields.length < 3 || !/^[0-9A-F]+$/.test(fields[0])) continue;
  const codePoint = parseInt(fields[0], 16);
  if (classIndexOf(codePoint) !== CLASS_INDEX.get('QU')) continue;
  if (fields[2] === 'Pi') initialQuotes.push(codePoint);
  if (fields[2] === 'Pf') finalQuotes.push(codePoint);
}
if (initialQuotes.length < 5 || finalQuotes.length < 5) {
  throw new Error(
    `Derived only ${initialQuotes.length} Pi and ${finalQuotes.length} Pf quotation marks; ` +
      'UnicodeData.txt missing or misparsed?',
  );
}
const hexList = (list) => list.map((cp) => `0x${cp.toString(16)}`).join(', ');

/**
 * Emit a `ReadonlySet<number>` literal the way the repo formatter would, so
 * regenerating the module is a no-op diff. Biome wraps a line that exceeds 100
 * columns by moving the whole element list onto its own indented line.
 */
function quotedCodePointSet(name, list) {
  const values = hexList(list);
  const single = `export const ${name}: ReadonlySet<number> = new Set([${values}]);`;
  if (single.length <= 100) return single;
  return `export const ${name}: ReadonlySet<number> = new Set([\n  ${values},\n]);`;
}

// ---------------------------------------------------------------------------
// Extended_Pictographic ∩ Cn, which LB30b's second clause needs. "Cn" here is
// the complement of the assigned set, so the assigned set is reconstructed
// from UnicodeData.txt (expanding its First/Last range markers) and subtracted
// from the Extended_Pictographic ranges in emoji-data.txt.
// ---------------------------------------------------------------------------
const emojiVersion = emojiDataText.match(/^# emoji-data(?:-([\d.]+))?\.txt$/m)?.[1];
if (emojiVersion !== undefined && emojiVersion !== version) {
  throw new Error(`Version mismatch: LineBreak ${version} vs emoji-data ${emojiVersion}`);
}
const assigned = [];
let pendingRangeStart;
for (const line of unicodeDataText.split('\n')) {
  const fields = line.split(';');
  if (fields.length < 3 || !/^[0-9A-F]+$/.test(fields[0])) continue;
  const codePoint = parseInt(fields[0], 16);
  const name = fields[1];
  if (name.endsWith(', First>')) {
    pendingRangeStart = codePoint;
    continue;
  }
  if (name.endsWith(', Last>')) {
    assigned.push([pendingRangeStart ?? codePoint, codePoint]);
    pendingRangeStart = undefined;
    continue;
  }
  assigned.push([codePoint, codePoint]);
}
assigned.sort((a, b) => a[0] - b[0]);
const isAssigned = (codePoint) => {
  let lo = 0;
  let hi = assigned.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (codePoint < assigned[mid][0]) hi = mid - 1;
    else if (codePoint > assigned[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
};
const unassignedPictographic = [];
for (const line of emojiDataText.split('\n')) {
  const data = line.match(/^([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s*;\s*Extended_Pictographic\s*(?:#|$)/);
  if (!data) continue;
  const first = parseInt(data[1], 16);
  const last = parseInt(data[2] ?? data[1], 16);
  let runStart = -1;
  for (let codePoint = first; codePoint <= last; codePoint++) {
    const unassigned = !isAssigned(codePoint);
    if (unassigned && runStart < 0) runStart = codePoint;
    if (!unassigned && runStart >= 0) {
      unassignedPictographic.push([runStart, codePoint - 1]);
      runStart = -1;
    }
  }
  if (runStart >= 0) unassignedPictographic.push([runStart, last]);
}
if (unassignedPictographic.length === 0) {
  throw new Error('No Extended_Pictographic ∩ Cn code points derived; emoji-data.txt missing?');
}

const testDigest = createHash('sha256').update(testText).digest('hex');
const testVersion = testText.match(/^# LineBreakTest-([\d.]+)\.txt$/m)?.[1];
if (testVersion !== version) {
  throw new Error(`Version mismatch: LineBreak ${version} vs test ${testVersion}`);
}
let oracleLines = 0;
for (const rawLine of testText.split('\n')) {
  const line = rawLine.replace(/\s+#.*$/, '').trim();
  if (!line || rawLine.startsWith('#')) continue;
  if (line.split(/\s+/).filter(Boolean).length > 1) oracleLines++;
}

const ORACLE_NAME = `LineBreakTest-${version}.txt`;
const ORACLE_PATH = `packages/engine/src/text/__fixtures__/${ORACLE_NAME}`;
writeFileSync(ORACLE_PATH, testText);

const HEADER = `/**
 * Generated by scripts/generate-line-break-data.mjs — do not edit.
 *
 * Sources: Unicode Character Database LineBreak-${version}.txt (${classDate})
 * and EastAsianWidth-${version}.txt (${widthDate}).
 * UAX #14 (Unicode Line Breaking Algorithm).
 * Unicode terms of use: https://www.unicode.org/terms_of_use.html
 */`;

const classModule = `${HEADER}

export const LINE_BREAK_UCD_VERSION = '${version}';

/**
 * The official UAX #14 conformance oracle, committed alongside this table so
 * the conformance test runs unconditionally instead of skipping when a
 * download is missing. The digest pins the exact bytes the test validated.
 */
export const LINE_BREAK_ORACLE = {
  file: '${ORACLE_NAME}',
  sha256: '${testDigest}',
  /** Lines carrying code points; comment and blank lines excluded. */
  lines: ${oracleLines},
} as const;

/** UAX #14 §5.1 line break classes, indexed by the range table's third value. */
export const LINE_BREAK_CLASS_NAMES = [
${CLASSES.map((name) => `  '${name}',`).join('\n')}
] as const;

export type LineBreakClass = (typeof LINE_BREAK_CLASS_NAMES)[number];

/**
 * Flat [firstCodePoint, lastCodePoint, classIndex] ranges, sorted ascending
 * and covering the whole code space. Code points the data file leaves implicit
 * follow its header defaults: "XX" at large, plus the documented "ID" blocks
 * (CJK ideograph areas, planes 2 and 3, emoji planes) and the "PR" Currency
 * Symbols block.
 */
export const LINE_BREAK_RANGES: readonly (readonly [number, number, number])[] = [
${merged.map(([first, last, index]) => `  [0x${first.toString(16)}, 0x${last.toString(16)}, ${index}],`).join('\n')}
];

/**
 * East_Asian_Width in {F, W, H} — UAX #14's \`$EastAsian\` set, which LB19a,
 * LB30 and LB30a subtract to allow a break beside East Asian punctuation.
 * Ranges are sorted ascending; anything absent is not East Asian wide.
 */
export const EAST_ASIAN_WIDE_RANGES: readonly (readonly [number, number])[] = [
${widthMerged.map(([first, last]) => `  [0x${first.toString(16)}, 0x${last.toString(16)}],`).join('\n')}
];

/**
 * General_Category Pi members of line break class QU — LB15a's unresolved
 * initial punctuation. Derived from the pinned UnicodeData.txt.
 */
${quotedCodePointSet('INITIAL_QUOTE_CODE_POINTS', initialQuotes)}

/**
 * General_Category Pf members of line break class QU — LB15b's unresolved
 * final punctuation. Derived from the pinned UnicodeData.txt.
 */
${quotedCodePointSet('FINAL_QUOTE_CODE_POINTS', finalQuotes)}

/**
 * Extended_Pictographic ∩ Cn — LB30b's second clause, for emoji modifiers that
 * follow a pictographic code point not yet assigned in the pinned release.
 */
export const UNASSIGNED_PICTOGRAPHIC_RANGES: readonly (readonly [number, number])[] = [
${unassignedPictographic.map(([first, last]) => `  [0x${first.toString(16)}, 0x${last.toString(16)}],`).join('\n')}
];
`;

writeFileSync('packages/engine/src/text/lineBreakClassesData.ts', classModule);

console.log(`UCD ${version} (${classDate})`);
console.log(`  class ranges:  ${merged.length}`);
console.log(`  oracle:        ${oracleLines} lines -> ${ORACLE_PATH}`);
console.log(`  east asian:    ${widthMerged.length} ranges (EAW-16.0.0)`);
console.log(`  EP&Cn ranges:  ${unassignedPictographic.length}`);
console.log(`  oracle sha256: ${testDigest}`);
