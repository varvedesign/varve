/**
 * UAX #14 line break *prohibition* rules — "may a line break be placed here?".
 *
 * The algorithm is split deliberately: this module answers only the
 * prohibition question, and the layout engine keeps its own greedy line
 * filling. UAX #14 §6.1's conformance requirement has two halves, and this
 * implements the second — the implementation must never produce a break
 * opportunity at a position the rules call a non-break. The first half
 * (producing *all* the break opportunities the rules allow) is deliberately
 * not claimed: word segmentation still decides where Latin breaks may fall, so
 * the implementation is conservative — it can prohibit more than UAX #14
 * requires, never less. That tailoring is disclosed, as UAX14-C1 asks.
 *
 * LB9 is the subtlest part. Once a combining mark or zero-width joiner
 * inherits its base's class, later rules must *ignore* it rather than see the
 * substituted class: a lookback over `HY CM AL` has to find the context before
 * the hyphen, not the hyphen it already matched. Every positional helper here
 * therefore steps over inherited positions.
 *
 * The conformance test drives the official `LineBreakTest.txt` oracle and
 * asserts the soundness half position by position.
 */
import {
  DOTTED_CIRCLE,
  FINAL_QUOTE_CODE_POINTS,
  HYPHEN,
  INITIAL_QUOTE_CODE_POINTS,
  isEastAsianWide,
  isUnassignedPictographic,
  type LineBreakClass,
  resolveLineBreakClasses,
} from './lineBreakClasses';

/** A paragraph prepared for line break decisions. */
export interface LineBreakSequence {
  /** Effective classes, one per code point (LB1 and LB9 applied). */
  classes: readonly LineBreakClass[];
  /** LB1-resolved classes without LB9 substitution (LB8a reads ZWJ here). */
  rawClasses: readonly LineBreakClass[];
  /** True where LB9 made this code point inherit its base. */
  inherited: readonly boolean[];
  /** True where the code point came from UAX #14 class `SA`. */
  dictionarySegmented: readonly boolean[];
  /** Code points, one per entry in `classes`. */
  codePoints: readonly number[];
  /**
   * UTF-16 index where each code point starts, plus the paragraph length as a
   * final sentinel. Lets a break asked about in layout offsets resolve without
   * a scan.
   */
  utf16Starts: readonly number[];
}

/** Prepare a paragraph once; every prohibition query then costs O(n) worst case. */
export function buildLineBreakSequence(text: string): LineBreakSequence {
  const { classes, rawClasses, inherited, dictionarySegmented } = resolveLineBreakClasses(text);
  const codePoints: number[] = [];
  const utf16Starts: number[] = [];
  let offset = 0;
  for (const character of text) {
    codePoints.push(character.codePointAt(0) ?? 0);
    utf16Starts.push(offset);
    offset += character.length;
  }
  utf16Starts.push(text.length);
  return { classes, rawClasses, inherited, dictionarySegmented, codePoints, utf16Starts };
}

/**
 * Whether the position before `utf16Offset` is a boundary this pipeline's
 * dictionary segmentation produced for a South East Asian script.
 *
 * UAX #14 §3.1 gives South East Asian scripts their own context analysis:
 * "line breaks require morphological analysis". LB1 resolves the `SA` class to
 * `AL` for implementations without that analysis, and the word-gluing rules
 * (LB28 in particular) then hold an entire Thai run together. This pipeline
 * *does* segment those scripts — `Intl.Segmenter` supplies the word boundaries
 * — so treating its boundaries as break opportunities is the tailoring UAX #14
 * §8 asks implementations to make. Gluing them back would let a Thai line grow
 * without limit: measured at a 70px measure, a 39-code-point Thai sentence
 * collapsed from 7 lines into 2 overflowing runs before this tailoring existed.
 */
export function isDictionarySegmentedBoundary(
  sequence: LineBreakSequence,
  utf16Offset: number,
): boolean {
  const codePointIndex = codePointIndexAt(sequence, utf16Offset);
  if (codePointIndex === null || codePointIndex <= 0) return false;
  return (
    sequence.dictionarySegmented[codePointIndex] === true ||
    sequence.dictionarySegmented[codePointIndex - 1] === true
  );
}

/** Code point index for a UTF-16 offset, or null when it is not a boundary. */
export function codePointIndexAt(sequence: LineBreakSequence, utf16Offset: number): number | null {
  const { utf16Starts } = sequence;
  let lo = 0;
  let hi = utf16Starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (utf16Starts[mid]! < utf16Offset) lo = mid + 1;
    else if (utf16Starts[mid]! > utf16Offset) hi = mid - 1;
    else return mid;
  }
  return null;
}

const ALPHABETIC: ReadonlySet<LineBreakClass> = new Set(['AL', 'HL']);
const IDEOGRAPHIC_LIKE: ReadonlySet<LineBreakClass> = new Set(['ID', 'EB', 'EM']);
const HANGUL_SYLLABLE: ReadonlySet<LineBreakClass> = new Set(['JL', 'JV', 'JT', 'H2', 'H3']);
const NON_BASE_AFTER_SPACE: ReadonlySet<LineBreakClass> = new Set([
  'BK',
  'CR',
  'LF',
  'NL',
  'OP',
  'QU',
  'GL',
  'SP',
  'ZW',
]);
const AFTER_FINAL_QUOTE: ReadonlySet<LineBreakClass> = new Set([
  'SP',
  'GL',
  'WJ',
  'CL',
  'QU',
  'CP',
  'EX',
  'IS',
  'SY',
  'BK',
  'CR',
  'LF',
  'NL',
  'ZW',
]);
const WORD_INITIAL_CONTEXT: ReadonlySet<LineBreakClass> = new Set([
  'BK',
  'CR',
  'LF',
  'NL',
  'SP',
  'ZW',
  'CB',
  'GL',
]);

/**
 * Whether UAX #14 prohibits a line break between `classes[index - 1]` and
 * `classes[index]`. `index === 0` is the start-of-text position (LB2, never a
 * break); `index >= length` is the end (LB3, always a break).
 */
export function isProhibitedBreak(sequence: LineBreakSequence, index: number): boolean {
  const { classes, rawClasses, inherited, codePoints } = sequence;
  const length = classes.length;
  if (index <= 0) return true;
  if (index >= length) return false;

  const after = classes[index]!;
  const afterCodePoint = codePoints[index]!;

  /** Previous position that LB9 does not ignore, or null at start of text. */
  const significantBefore = (from: number): number => {
    let cursor = from;
    while (cursor >= 0 && inherited[cursor]) cursor--;
    return cursor;
  };
  /** Next position that LB9 does not ignore, or null at end of text. */
  const significantAfter = (from: number): number => {
    let cursor = from;
    while (cursor < length && inherited[cursor]) cursor++;
    return cursor < length ? cursor : -1;
  };
  /**
   * Last position before `from` holding neither an LB9-ignored character nor a
   * space — the lookback UAX #14 spells `SP*`. LB14, LB15a, LB16 and LB17 all
   * reach across spaces, so a space run must not hide the class they match.
   */
  const nonSpaceBefore = (from: number): number => {
    let cursor = from;
    while (cursor >= 0 && (inherited[cursor] || classes[cursor] === 'SP')) cursor--;
    return cursor;
  };

  // LB8a — do not break after a zero width joiner. LB8a precedes LB9, so it
  // reads the un-substituted class of the immediately preceding character.
  if (index - 1 >= 0 && rawClasses[index - 1] === 'ZWJ') return true;

  // LB9 — do not break a combining character sequence.
  if (inherited[index]) return true;

  const beforeIndex = significantBefore(index - 1);
  if (beforeIndex < 0) {
    // Only ignorable characters precede; LB2 already covered start of text.
    return true;
  }
  const before = classes[beforeIndex]!;
  const beforeCodePoint = codePoints[beforeIndex]!;
  const beforeOne = significantBefore(beforeIndex - 1);
  const afterOne = significantAfter(index + 1);
  const afterTwo = afterOne >= 0 ? significantAfter(afterOne + 1) : -1;
  const classAt = (position: number): LineBreakClass | null =>
    position >= 0 ? classes[position]! : null;
  const codePointAt = (position: number): number => (position >= 0 ? codePoints[position]! : -1);

  // LB6 — do not break before hard line breaks.
  if (after === 'BK' || after === 'CR' || after === 'LF' || after === 'NL') return true;
  // LB7 — do not break before spaces or zero width space.
  if (after === 'SP' || after === 'ZW') return true;
  // LB11 — word joiner prohibits breaks before and after.
  if (before === 'WJ' || after === 'WJ') return true;

  // LB12 — GL prohibits breaks after itself.
  if (before === 'GL') return true;
  // LB12a — [^SP BA HY] × GL.
  if (after === 'GL' && before !== 'SP' && before !== 'BA' && before !== 'HY') return true;

  // LB13 — do not break before closing punctuation, even after spaces.
  if (after === 'CL' || after === 'CP' || after === 'EX' || after === 'SY') return true;
  // LB14 — OP SP* ×.
  const acrossSpaces = nonSpaceBefore(index - 1);
  if (classAt(acrossSpaces) === 'OP') return true;

  // LB15a — no break after an initial quote that itself follows a
  // line-opening context, even after spaces.
  if (INITIAL_QUOTE_CODE_POINTS.has(codePointAt(acrossSpaces))) {
    const preceding = classAt(significantBefore(acrossSpaces - 1));
    if (preceding === null || NON_BASE_AFTER_SPACE.has(preceding)) return true;
  }
  // LB15b — no break before a final quote that sits before a space, a
  // prohibited break, another quotation mark, or the end of the line.
  if (FINAL_QUOTE_CODE_POINTS.has(afterCodePoint)) {
    const following = classAt(afterOne);
    if (following === null || AFTER_FINAL_QUOTE.has(following)) return true;
  }
  // LB15d — otherwise do not break before ';', ',', or '.'.
  if (after === 'IS') return true;

  // LB16 — (CL | CP) SP* × NS.
  if (after === 'NS') {
    const closing = classAt(acrossSpaces);
    if (closing === 'CL' || closing === 'CP') return true;
  }
  // LB17 — do not break within '——', even with intervening spaces.
  if (after === 'B2' && classAt(acrossSpaces) === 'B2') return true;

  // LB19 — unresolved quotation marks: not before a non-initial one, not
  // after a non-final one.
  if (after === 'QU' && !INITIAL_QUOTE_CODE_POINTS.has(afterCodePoint)) return true;
  if (before === 'QU' && !FINAL_QUOTE_CODE_POINTS.has(beforeCodePoint)) return true;

  // LB19a — unless surrounded by East Asian characters, a quotation mark
  // prohibits breaks on both sides.
  if (after === 'QU') {
    if (
      !isEastAsianWide(beforeCodePoint) ||
      afterOne < 0 ||
      !isEastAsianWide(codePointAt(afterOne))
    ) {
      return true;
    }
  }
  if (
    before === 'QU' &&
    (!isEastAsianWide(afterCodePoint) || !isEastAsianWide(codePointAt(beforeOne)))
  ) {
    return true;
  }

  // LB20a — do not break after a word-initial hyphen:
  // (sot|BK|CR|LF|NL|SP|ZW|CB|GL) (HY | U+2010) × AL
  if (
    after === 'AL' &&
    (before === 'HY' || (before === 'BA' && beforeCodePoint === HYPHEN)) &&
    (classAt(beforeOne) === null || WORD_INITIAL_CONTEXT.has(classAt(beforeOne)!))
  ) {
    return true;
  }

  // LB21 — before hyphens, fixed-width spaces, small kana and other
  // non-starters; and after break-before characters.
  if (after === 'BA' || after === 'HY' || after === 'NS' || before === 'BB') {
    return true;
  }
  // LB21a — do not break after the hyphen in Hebrew + Hyphen + non-Hebrew:
  // HL (HY | [BA - $EastAsian]) × [^HL]
  if (
    after !== 'HL' &&
    (before === 'HY' || (before === 'BA' && !isEastAsianWide(beforeCodePoint))) &&
    classAt(beforeOne) === 'HL'
  ) {
    return true;
  }
  // LB21b — do not break between solidus and Hebrew letters.
  if (before === 'SY' && after === 'HL') return true;
  // LB22 — do not break before ellipses.
  if (after === 'IN') return true;

  // LB23 — no break between digits and letters.
  if ((ALPHABETIC.has(before) && after === 'NU') || (before === 'NU' && ALPHABETIC.has(after))) {
    return true;
  }
  // LB23a — no break between numeric prefixes and ideographs, or the reverse.
  if (
    (before === 'PR' && IDEOGRAPHIC_LIKE.has(after)) ||
    (IDEOGRAPHIC_LIKE.has(before) && after === 'PO')
  ) {
    return true;
  }
  // LB24 — no break between numeric prefixes/postfixes and letters.
  if (
    ((before === 'PR' || before === 'PO') && ALPHABETIC.has(after)) ||
    (ALPHABETIC.has(before) && (after === 'PR' || after === 'PO'))
  ) {
    return true;
  }

  // LB25 — do not break numbers:
  //   NU (SY|IS)* CL × PO / CP × PO / CL × PR / CP × PR
  //   NU (SY|IS)* × PO / × PR
  //   PO × OP NU / PO × OP IS NU / PO × NU
  //   PR × OP NU / PR × OP IS NU / PR × NU
  //   HY × NU / IS × NU / NU (SY|IS)* × NU
  const numericRunBefore = (from: number): number => {
    let cursor = from;
    while (cursor >= 0 && (classes[cursor] === 'SY' || classes[cursor] === 'IS')) {
      cursor = significantBefore(cursor - 1);
    }
    return cursor;
  };
  if (after === 'NU') {
    if (before === 'HY' || before === 'IS' || before === 'NU') return true;
    if (before === 'PO' || before === 'PR') return true;
    if (before === 'OP') {
      const prefix = classAt(beforeOne);
      if (prefix === 'PO' || prefix === 'PR') return true;
    }
    if (classAt(numericRunBefore(beforeIndex)) === 'NU') return true;
  }
  if (after === 'OP' && (before === 'PO' || before === 'PR')) {
    // PO | PR × OP NU  and  PO | PR × OP IS NU
    if (classAt(afterOne) === 'NU') return true;
    if (classAt(afterOne) === 'IS' && classAt(afterTwo) === 'NU') return true;
  }
  if (after === 'PO' || after === 'PR') {
    if (before === 'NU') return true;
    const run =
      before === 'CL' || before === 'CP'
        ? numericRunBefore(beforeOne)
        : numericRunBefore(beforeIndex);
    if (classAt(run) === 'NU') return true;
  }

  // LB26 — do not break a Korean syllable.
  if (
    (before === 'JL' && (after === 'JL' || after === 'JV' || after === 'H2' || after === 'H3')) ||
    ((before === 'JV' || before === 'H2') && (after === 'JV' || after === 'JT')) ||
    ((before === 'JT' || before === 'H3') && after === 'JT')
  ) {
    return true;
  }
  // LB27 — treat a Korean syllable block the same as ID.
  if (
    (HANGUL_SYLLABLE.has(before) && after === 'PO') ||
    (before === 'PR' && HANGUL_SYLLABLE.has(after))
  ) {
    return true;
  }
  // LB28 — do not break between alphabetics.
  if (ALPHABETIC.has(before) && ALPHABETIC.has(after)) return true;

  // LB28a — no break inside the orthographic syllables of Brahmic scripts.
  // The `[◌]` in the rules denotes U+25CC DOTTED CIRCLE literally.
  const isBrahmicBase = (position: number): boolean =>
    classAt(position) === 'AK' ||
    classAt(position) === 'AS' ||
    codePointAt(position) === DOTTED_CIRCLE;
  if (before === 'AP' && isBrahmicBase(index)) return true;
  if (isBrahmicBase(beforeIndex) && (after === 'VF' || after === 'VI')) return true;
  if (before === 'VI' && isBrahmicBase(beforeOne) && isBrahmicBase(index)) return true;
  if (isBrahmicBase(beforeIndex) && isBrahmicBase(index) && classAt(afterOne) === 'VF') return true;

  // LB29 — no break between numeric punctuation and alphabetics.
  if (before === 'IS' && ALPHABETIC.has(after)) return true;

  // LB30 — no break between letters, numbers or symbols and parentheses.
  if (
    (ALPHABETIC.has(before) || before === 'NU') &&
    after === 'OP' &&
    !isEastAsianWide(afterCodePoint)
  ) {
    return true;
  }
  if (
    before === 'CP' &&
    !isEastAsianWide(beforeCodePoint) &&
    (ALPHABETIC.has(after) || after === 'NU')
  ) {
    return true;
  }

  // LB30a — break between two regional indicators only in pairs.
  if (before === 'RI' && after === 'RI') {
    let count = 0;
    for (let cursor = beforeIndex; cursor >= 0; cursor = significantBefore(cursor - 1)) {
      if (classes[cursor] !== 'RI') break;
      count++;
    }
    if (count % 2 === 1) return true;
  }
  // LB30b — do not break between an emoji base (or potential emoji) and an
  // emoji modifier.
  if (after === 'EM' && (before === 'EB' || isUnassignedPictographic(beforeCodePoint))) return true;

  // LB31 — break everywhere else.
  return false;
}
