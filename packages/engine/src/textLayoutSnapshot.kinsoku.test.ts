import { describe, expect, it } from 'vitest';
import { buildTextLayoutSnapshot, type TextLayoutSnapshot } from './textLayoutSnapshot';
import type { ShapedRun, TextShaping } from './types';

/**
 * JLREQ line-start (行頭禁則) and line-end (行末禁則) prohibition, as realised
 * through the canonical layout snapshot.
 *
 * The engine implements UAX #14's prohibition rules (see
 * `text/lineBreakProhibition.test.ts` for the conformance result against the
 * official oracle) and applies them by merging units that must not be
 * separated, so the greedy fill can never break at a reserved position. The
 * observable contract these tests pin is JLREQ's: a line never begins with a
 * character that may not start one, and never ends with one that may not end
 * one.
 */

/** Monospaced shaping: every code point advances `width`, so line breaks are exact. */
function makeShaping(text: string, width = 10): TextShaping {
  const run: ShapedRun = {
    fontFamily: 'Test Sans',
    fontSize: 16,
    fontWeight: 400,
    fontStyle: 'normal',
    direction: 'ltr',
    level: 0,
    script: 'latn',
    glyphs: [...text].map((_, index) => ({
      glyphId: index + 1,
      xAdvance: width,
      yAdvance: 0,
      xOffset: 0,
      yOffset: 0,
      clusterUtf16: index,
    })),
    width: [...text].length * width,
    ascent: 12,
    descent: 4,
  };
  return {
    runs: [run],
    visualRuns: [run],
    width: run.width,
    height: 16,
    baseDirection: 'ltr',
    direction: 'ltr',
  };
}

function layout(text: string, maxWidth: number): TextLayoutSnapshot {
  return buildTextLayoutSnapshot(text, makeShaping(text), {
    maxWidth,
    sourceRevision: 'doc:1',
    fontRevision: 'font:1',
  });
}

/** The source text each line covers, in order. */
function lineTexts(snapshot: TextLayoutSnapshot, text: string): string[] {
  return snapshot.lines.map((line) => text.slice(line.sourceStart, line.sourceEnd));
}

/** JLREQ §3.1.7 — none of these may begin a line. */
const LINE_START_PROHIBITED = [
  '。',
  '、',
  '，',
  '．',
  '」',
  '』',
  '）',
  '】',
  '］',
  '！',
  '？',
  '・',
  '：',
  '；',
  'ー',
  '々',
  'ヽ',
  'ゝ',
  'ぁ',
  'ぃ',
  'ぅ',
  'ぇ',
  'ぉ',
  'っ',
  'ゃ',
  'ゅ',
  'ょ',
  'ゎ',
  'ァ',
  'ィ',
  'ゥ',
  'ェ',
  'ォ',
  'ッ',
  'ャ',
  'ュ',
  'ョ',
];

/** JLREQ §3.1.8 — none of these may end a line. */
const LINE_END_PROHIBITED = ['「', '『', '（', '【', '〔', '〈', '《', '［', '｛', '“', '‘'];

describe('Japanese line-start and line-end prohibition', () => {
  it.each(LINE_START_PROHIBITED)('never begins a line with %s', (character) => {
    // Force a break candidate immediately before the character by padding the
    // line to its exact measure, then a two-character tail.
    for (const prefixChars of [3, 4, 5, 6, 7]) {
      const text = `${'あ'.repeat(prefixChars)}${character}い`;
      const snapshot = layout(text, prefixChars * 10);
      expect(
        lineTexts(snapshot, text).slice(1),
        `${character} after ${prefixChars} kana`,
      ).not.toContain(expect.stringMatching(new RegExp(`^${character}`)));
      for (const line of lineTexts(snapshot, text).slice(1)) {
        expect(line.startsWith(character), `line [${line}] starts with ${character}`).toBe(false);
      }
    }
  });

  it.each(LINE_END_PROHIBITED)('never ends a line with %s', (character) => {
    for (const prefixChars of [3, 4, 5, 6, 7]) {
      const text = `${'あ'.repeat(prefixChars)}${character}い`;
      const snapshot = layout(text, prefixChars * 10);
      for (const line of lineTexts(snapshot, text).slice(0, -1)) {
        expect(line.endsWith(character), `line [${line}] ends with ${character}`).toBe(false);
      }
    }
  });

  it('keeps an opening bracket with the content it introduces', () => {
    // The reproduced defect: the line used to end with `（`, leaving the
    // bracket stranded from the `参照` it opens.
    const text = 'この文書は『重要な資料』に（参照）されています。';
    const texts = lineTexts(layout(text, 50), text);
    expect(texts.some((line) => line.endsWith('（'))).toBe(false);
    expect(texts).toContain('に（参照）');
  });

  it('keeps a closing bracket with the text it closes', () => {
    const text = '彼は「これは長い引用文です」と言った。';
    const texts = lineTexts(layout(text, 40), text);
    for (const line of texts) {
      expect(line.startsWith('」')).toBe(false);
      expect(line.endsWith('「')).toBe(false);
    }
  });

  it('keeps a full stop off the start of a line', () => {
    const text = 'あいうえお。かきくけこ。';
    const texts = lineTexts(layout(text, 30), text);
    for (const line of texts.slice(1)) {
      expect(line.startsWith('。')).toBe(false);
    }
  });

  it('keeps a small kana with the kana it modifies', () => {
    const text = 'きょうはとてもいいおてんきですねそうですね';
    const texts = lineTexts(layout(text, 30), text);
    for (const line of texts.slice(1)) {
      expect('ゃゅょっぁぃぅぇぉ'.includes(line[0]!)).toBe(false);
    }
  });

  it('preserves every source offset across the lines it produces', () => {
    // Merging changes where lines end, never which offsets exist: the lines
    // stay contiguous and together cover the whole paragraph.
    const text = 'この文書は『重要な資料』に（参照）されています。';
    const snapshot = layout(text, 50);
    let cursor = 0;
    for (const line of snapshot.lines) {
      expect(line.sourceStart).toBe(cursor);
      cursor = line.sourceEnd;
    }
    expect(cursor).toBe(text.length);
  });

  it('leaves a caret stop on every offset the unprohibited layout had', () => {
    const text = 'この文書は『重要な資料』に（参照）されています。';
    const snapshot = layout(text, 50);
    const stops = new Set(snapshot.caretStops.map((stop) => stop.offset));
    for (let offset = 0; offset <= text.length; offset++) {
      expect(stops.has(offset), `offset ${offset} (${text[offset] ?? 'end'})`).toBe(true);
    }
  });
});

describe('prohibition does not disturb the behaviour it was added beside', () => {
  it('wraps Latin at word boundaries exactly as before', () => {
    // Boundaries next to whitespace are deliberately left to the fill loop, so
    // this is byte-for-byte the layout the engine produced before prohibition
    // existed: each word plus its trailing space fills the measure, and a word
    // longer than the measure falls back to the emergency grapheme split.
    const text = 'alpha beta gamma delta epsilon';
    expect(lineTexts(layout(text, 60), text)).toEqual([
      'alpha ',
      'beta ',
      'gamma ',
      'delta ',
      'epsilo',
      'n',
    ]);
  });

  it('still wraps a single word longer than the line', () => {
    // The emergency grapheme split exists so an unbreakable word cannot
    // overflow; the prohibition pass must not re-merge it (LB28 joins
    // alphabetics, so merged pieces would never wrap).
    const text = 'abcdefghijklmnopqrstuvwxyz';
    const texts = lineTexts(layout(text, 40), text);
    expect(texts.length).toBeGreaterThan(1);
    expect(texts.join('')).toBe(text);
    for (const line of texts) expect(line.length).toBeLessThanOrEqual(4);
  });

  it('still wraps an over-long CJK run', () => {
    const text = '東京都港区赤坂九丁目七番地一丁目';
    const texts = lineTexts(layout(text, 50), text);
    expect(texts.join('')).toBe(text);
    expect(texts.length).toBeGreaterThan(3);
  });

  it('keeps a number together rather than breaking it internally', () => {
    // LB25: `1,234.56` must not be split across lines.
    const text = '総額は 1,234.56 円です';
    const texts = lineTexts(layout(text, 80), text);
    expect(texts.join('')).toBe(text);
    expect(texts.some((line) => line.includes('1,234.56'))).toBe(true);
  });

  it('keeps a bracketed suffix with its word', () => {
    // LB30: "person(s)" should not break before the bracket.
    const text = 'the person(s) listed here are many and varied indeed';
    const texts = lineTexts(layout(text, 110), text);
    expect(texts.join('')).toBe(text);
    expect(texts.some((line) => line.includes('person(s)'))).toBe(true);
  });

  it('still wraps dictionary-segmented Thai within the measure', () => {
    // The UAX #14 §8 tailoring that matters most: Thai has no spaces, so LB1's
    // `SA -> AL` plus LB28 would hold an entire sentence together and let every
    // line run past the measure. The segmenter's word boundaries must survive.
    // Before the tailoring this text produced 2 lines of ~140px under a 70px
    // measure; it produced 7 lines of at most 70px both before and after the
    // prohibition pass.
    const text = 'ภาษาไทยสวยงาม การตัดคำอัตโนมัติทำงานได้';
    for (const maxWidth of [40, 70, 110]) {
      const snapshot = layout(text, maxWidth);
      expect(snapshot.lines.length, `thai at ${maxWidth}px did not wrap`).toBeGreaterThan(1);
      for (const line of snapshot.lines) {
        expect(line.width, `thai line at ${maxWidth}px overflowed`).toBeLessThanOrEqual(maxWidth);
      }
    }
  });

  it('still wraps dictionary-segmented Khmer and Lao within the measure', () => {
    for (const text of [
      'ភាសាខ្មែរគឺជាភាសាដ៏ស្រស់ស្អាត ហើយវាត្រូវបានប្រើប្រាស់',
      'ພາສາລາວງາມຫຼາຍ ແລະ ມັນຖືກນໍາໃຊ້ຢູ່',
    ]) {
      const snapshot = layout(text, 80);
      expect(snapshot.lines.length).toBeGreaterThan(1);
      for (const line of snapshot.lines) {
        expect(line.width).toBeLessThanOrEqual(80);
      }
    }
  });

  it('wraps vertical Japanese without stranding punctuation at a column head', () => {
    // The input must contain characters the prohibition actually protects, and
    // the measure must put those characters at a column boundary — otherwise
    // the assertions hold whether or not any prohibition exists. `「` sits at
    // the column end (line-end prohibition) and `、`/`。` at a column start
    // (line-start prohibition).
    const text = 'この文書は「重要な、資料」に（参照）されています。';
    for (const maxWidth of [32, 48, 64, 96]) {
      const snapshot = buildTextLayoutSnapshot(text, makeShaping(text), {
        maxWidth,
        sourceRevision: 'doc:1',
        fontRevision: 'font:1',
        writingMode: 'vertical-rl',
        textOrientation: 'mixed',
      });
      const columns = snapshot.lines.map((line) => text.slice(line.sourceStart, line.sourceEnd));
      expect(columns.length, `vertical at ${maxWidth}px did not wrap`).toBeGreaterThan(1);
      for (const column of columns.slice(1)) {
        expect(column.startsWith('。'), `column [${column}] starts with 。`).toBe(false);
        expect(column.startsWith('、'), `column [${column}] starts with 、`).toBe(false);
        expect(column.startsWith('」'), `column [${column}] starts with 」`).toBe(false);
      }
      for (const column of columns.slice(0, -1)) {
        expect(column.endsWith('「'), `column [${column}] ends with 「`).toBe(false);
        expect(column.endsWith('（'), `column [${column}] ends with （`).toBe(false);
      }
    }
  });

  it('keeps a prohibited character off a line start even when its word must be split', () => {
    // `1234。` is a single glued unit wider than the measure, so the emergency
    // grapheme split runs — and it must regroup the pieces rather than let the
    // full stop begin a line.
    const text = '1234。5678';
    for (const maxWidth of [30, 40, 50]) {
      const texts = lineTexts(layout(text, maxWidth), text);
      expect(texts.join(''), `at ${maxWidth}px`).toBe(text);
      for (const line of texts.slice(1)) {
        expect(line.startsWith('。'), `line [${line}] at ${maxWidth}px starts with 。`).toBe(false);
      }
    }
  });

  it('lets an indivisible token overflow rather than breaking it, and keeps every character', () => {
    // `$7,890` is glued by LB25 (PR × NU chain) and is 60px at this metric. In a
    // 50px box there is no layout that both fits and preserves the token, so the
    // engine keeps the token whole and the line overhangs. Pinning this makes the
    // trade-off explicit: prohibition wins over the measure.
    const text = 'total $7,890 end';
    const texts = lineTexts(layout(text, 50), text);
    expect(texts.join('')).toBe(text);
    expect(
      texts.some((line) => line.includes('$7,890')),
      JSON.stringify(texts),
    ).toBe(true);
    // The token is kept whole rather than split after the currency sign.
    expect(texts.some((line) => line.endsWith('$'))).toBe(false);
  });
});
