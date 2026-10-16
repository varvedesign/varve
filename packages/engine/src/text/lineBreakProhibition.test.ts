import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LINE_BREAK_ORACLE, LINE_BREAK_UCD_VERSION, rawLineBreakClassOf } from './lineBreakClasses';
import {
  buildLineBreakSequence,
  isLineEdgeProhibitedBreak,
  isProhibitedBreak,
} from './lineBreakProhibition';

const ORACLE_PATH = join(__dirname, '__fixtures__', `LineBreakTest-${LINE_BREAK_UCD_VERSION}.txt`);

interface OracleCase {
  /** Code points of the sample string. */
  codePoints: number[];
  /** `true` where the oracle marks `×` (a prohibited break). */
  prohibited: boolean[];
  /** Rule numbers the oracle cites, for failure reporting. */
  rules: string[];
  line: number;
}

function parseOracle(text: string): OracleCase[] {
  const cases: OracleCase[] = [];
  const lines = text.split('\n');
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    const raw = lines[lineNumber]!;
    if (raw.startsWith('#')) continue;
    const hash = raw.indexOf('#');
    const spec = (hash === -1 ? raw : raw.slice(0, hash)).trim();
    if (!spec) continue;
    const tokens = spec.split(/\s+/);
    const codePoints: number[] = [];
    const operators: string[] = [];
    for (const token of tokens) {
      if (/^[0-9A-F]+$/.test(token)) codePoints.push(parseInt(token, 16));
      else if (token === '×' || token === '÷') operators.push(token);
    }
    // op0 cp0 op1 cp1 ... opN — the operators bracket the code points, with
    // op0 the start-of-text position and opN the end.
    if (operators.length !== codePoints.length + 1) continue;
    if (codePoints.length === 0) continue;
    const annotation = hash === -1 ? '' : raw.slice(hash);
    cases.push({
      codePoints,
      // operators[i + 1] is the position between codePoints[i] and [i + 1].
      prohibited: codePoints.slice(0, -1).map((_, i) => operators[i + 1] === '×'),
      rules: [...annotation.matchAll(/\[([\d.]+)\]/g)].map((m) => m[1]!),
      line: lineNumber + 1,
    });
  }
  return cases;
}

const oracleText = readFileSync(ORACLE_PATH, 'utf8');
const cases = parseOracle(oracleText);

describe('UAX #14 line break prohibition conformance', () => {
  it('validates against the pinned oracle bytes', () => {
    // The digest pins the exact bytes; a different oracle would silently move
    // the conformance target.
    expect(createHash('sha256').update(oracleText).digest('hex')).toBe(LINE_BREAK_ORACLE.sha256);
    expect(cases.length).toBe(LINE_BREAK_ORACLE.lines);
  });

  it('never permits a break the oracle prohibits', () => {
    const violations: Array<{ line: number; index: number; rule: string }> = [];
    let positions = 0;
    let prohibitedPositions = 0;
    for (const testCase of cases) {
      const text = String.fromCodePoint(...testCase.codePoints);
      const sequence = buildLineBreakSequence(text);
      for (let i = 0; i < testCase.codePoints.length - 1; i++) {
        positions++;
        if (!testCase.prohibited[i]) continue;
        prohibitedPositions++;
        if (!isProhibitedBreak(sequence, i + 1)) {
          violations.push({
            line: testCase.line,
            index: i + 1,
            rule: testCase.rules[i + 1] ?? '?',
          });
        }
      }
    }
    // Report a bounded sample so a regression names the rule that broke.
    expect(
      violations
        .slice(0, 25)
        .map(
          (v) => `line ${v.line} pos ${v.index}: oracle prohibits (rule ${v.rule}) but we allow`,
        ),
      `${violations.length} of ${prohibitedPositions} prohibited positions allowed (of ${positions} total)`,
    ).toEqual([]);
  });

  it('never reports a line-edge prohibition the full rules do not also prohibit', () => {
    // `isLineEdgeProhibitedBreak` is a deliberate SUBSET of `isProhibitedBreak`,
    // used only where a word-internal prohibition must yield to the emergency
    // grapheme split. This proves the subset relation over the whole oracle, so
    // the narrower predicate can never license an illegal break on its own.
    const mismatches: string[] = [];
    for (const testCase of cases) {
      const text = String.fromCodePoint(...testCase.codePoints);
      const sequence = buildLineBreakSequence(text);
      for (let index = 1; index < testCase.codePoints.length; index++) {
        if (isLineEdgeProhibitedBreak(sequence, index) && !isProhibitedBreak(sequence, index)) {
          mismatches.push(
            `line ${testCase.line} pos ${index}: edge predicate prohibits, full rules allow`,
          );
        }
      }
    }
    expect(mismatches.slice(0, 20)).toEqual([]);
  });

  it('resolves every code point in the oracle to a known class', () => {
    const unknown: string[] = [];
    for (const testCase of cases) {
      for (const codePoint of testCase.codePoints) {
        try {
          rawLineBreakClassOf(codePoint);
        } catch {
          unknown.push(`U+${codePoint.toString(16).toUpperCase()}`);
        }
      }
    }
    expect([...new Set(unknown)].slice(0, 20)).toEqual([]);
  });
});
