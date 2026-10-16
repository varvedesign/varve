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

/** Whether any line carries `token` whole, i.e. the token was not broken. */
function textsIncludeToken(snapshot: TextLayoutSnapshot, text: string, token: string): boolean {
  return snapshot.lines.some((line) =>
    text.slice(line.sourceStart, line.sourceEnd).includes(token),
  );
}

describe('Japanese line-start and line-end prohibition', () => {
  /**
   * These sweeps assert an invariant: whatever `Intl.Segmenter` does with a
   * given run, a line edge never holds a character the rules exclude. It is
   * deliberately ICU-agnostic — the outcome must hold on Node, Chromium and
   * WebKitGTK alike, so a red result on another platform is a real defect
   * rather than a version difference.
   *
   * Measured load-bearing coverage, by disabling `mergeUnbreakableUnits` and
   * re-running this file: **34 of these 65 cases fail** without the pass —
   * 18 line-start members (the non-`\p{P}` ones: iteration marks `々` `ヽ` and
   * the small kana, a selection of which is visible in the names below), all
   * 11 line-end members, and the push-out assertion. The remaining line-start
   * members (`。` `、` `」` `！` `？` `・` …) pass either way because
   * `segmentBreakUnits` already glues closing punctuation to the word before
   * it; they are kept as invariant coverage, not as proof of the pass.
   */
  it.each(LINE_START_PROHIBITED)('never begins a line with %s', (character) => {
    // Force a break candidate immediately before the character by padding the
    // line to its exact measure, then a two-character tail.
    for (const prefixChars of [3, 4, 5, 6, 7]) {
      const text = `${'あ'.repeat(prefixChars)}${character}い`;
      const snapshot = layout(text, prefixChars * 10);
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

  /**
   * Line-end prohibition is push-out, so it is provable positively: an opening
   * bracket must travel with the character it introduces. A word followed by
   * `「`/`（`/`『` is the shape that strands the bracket when nothing merges,
   * and the assertion below cannot hold unless the two are kept together.
   */
  it('push-out keeps a bracket with the content it introduces', () => {
    for (const [open, close] of [
      ['「', '」'],
      ['（', '）'],
      ['『', '』'],
      ['【', '】'],
    ] as const) {
      for (const measure of [20, 30, 40, 50, 60]) {
        const text = `漢字${open}かな${close}です`;
        const lines = lineTexts(layout(text, measure), text);
        expect(lines.join(''), `${open} at ${measure}px lost text`).toBe(text);
        const holder = lines.find((line) => line.includes(open));
        expect(holder, `${open} at ${measure}px: ${JSON.stringify(lines)}`).toBeDefined();
        const openIndexInLine = holder!.indexOf(open);
        expect(
          holder!.length > openIndexInLine + 1,
          `${open} at ${measure}px ends the line: ${JSON.stringify(lines)}`,
        ).toBe(true);
        // The character after the bracket is on the same line, i.e. the
        // bracket did not end the line and was not separated from its content.
        expect(holder!.endsWith(open)).toBe(false);
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
    // `1234。` is a single glued unit wider than the measure, so the split runs —
    // and it must keep the pieces together rather than let the full stop begin a
    // line. A line-edge rule may cost one grapheme of overhang, which is what
    // makes that possible: the group reaches the measure and `。` still joins.
    const text = '1234。5678';
    for (const maxWidth of [30, 40, 50]) {
      const texts = lineTexts(layout(text, maxWidth), text);
      expect(texts.join(''), `at ${maxWidth}px`).toBe(text);
      for (const line of texts.slice(1)) {
        expect(line.startsWith('。'), `line [${line}] at ${maxWidth}px starts with 。`).toBe(false);
      }
    }
  });

  it('bounds a run that has no legal break opportunity at all', () => {
    // Twelve non-starters are prohibited at every internal boundary, so no
    // arrangement inside the measure exists. Before the split was bounded this
    // produced a single 120px line in a 40px box; it now wraps with at most one
    // grapheme of overhang and never loses a character.
    const runs = [
      'ー'.repeat(12),
      '…'.repeat(12),
      '。'.repeat(12),
      'うわーーーーーーーーーーーー。',
    ];
    for (const text of runs) {
      for (const maxWidth of [40, 70, 110]) {
        const snapshot = layout(text, maxWidth);
        expect(lineTexts(snapshot, text).join(''), `at ${maxWidth}px`).toBe(text);
        for (const line of snapshot.lines) {
          // One grapheme of overhang is the documented bound.
          expect(line.width, `line at ${maxWidth}px`).toBeLessThanOrEqual(maxWidth + 10);
        }
        // A run that cannot fit even with that allowance has to wrap; one that
        // fits outright legitimately stays on a single line.
        const total = text.length * 10;
        expect(
          snapshot.lines.length > 1,
          `${text.slice(0, 3)} at ${maxWidth}px (total ${total}px)`,
        ).toBe(total > maxWidth + 10);
      }
    }
  });

  it('keeps a token whole while it fits and breaks it near its end when it cannot', () => {
    // `$7,890` is 60px at this metric. Where the measure allows it the merge
    // keeps it intact; at 50px no arrangement fits, so the emergency break is
    // taken - the token is broken, but never after the currency sign, and no
    // character is lost.
    const text = 'total $7,890 end';
    for (const maxWidth of [50, 60, 70, 110, 160, 240]) {
      const texts = lineTexts(layout(text, maxWidth), text);
      expect(texts.join(''), `at ${maxWidth}px`).toBe(text);
      expect(
        texts.some((line) => line.endsWith('$')),
        `at ${maxWidth}px: ${JSON.stringify(texts)}`,
      ).toBe(false);
    }
    for (const maxWidth of [110, 160, 240]) {
      expect(textsIncludeToken(layout(text, maxWidth), text, '$7,890'), `at ${maxWidth}px`).toBe(
        true,
      );
    }
  });

  it('keeps an opening bracket with its content in vertical columns', () => {
    // The same JLREQ invariant in vertical writing, on the shape that strands a
    // bracket when nothing is kept together: every boundary in the column is
    // prohibited, so the incoming cluster joins the column instead of starting
    // one of its own.
    const cases: ReadonlyArray<readonly [string, readonly number[]]> = [
      ['あああ。」', [32, 48, 64]],
      ['ああ。', [32, 48]],
      ['あああ。「い', [32, 48, 64]],
    ];
    for (const [text, measures] of cases) {
      for (const maxWidth of measures) {
        const snapshot = buildTextLayoutSnapshot(text, makeShaping(text), {
          maxWidth,
          sourceRevision: 'doc:1',
          fontRevision: 'font:1',
          writingMode: 'vertical-rl',
          textOrientation: 'mixed',
        });
        const columns = snapshot.lines.map((line) => text.slice(line.sourceStart, line.sourceEnd));
        expect(columns.join(''), `${text} at ${maxWidth}px lost text`).toBe(text);
        for (const column of columns.slice(1)) {
          expect(
            '。、」'.includes(column[0] ?? ''),
            `${text} at ${maxWidth}px: ${JSON.stringify(columns)}`,
          ).toBe(false);
        }
        for (const column of columns.slice(0, -1)) {
          expect(
            '「（'.includes(column.at(-1) ?? ''),
            `${text} at ${maxWidth}px: ${JSON.stringify(columns)}`,
          ).toBe(false);
        }
      }
    }
  });
});
