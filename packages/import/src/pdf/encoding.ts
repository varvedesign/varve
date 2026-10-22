/**
 * PDF string and font-encoding handling for import.
 *
 * A PDF text string is a sequence of *character codes*, not characters. The
 * byte sequence is meaningless until it is resolved through the font's
 * encoding — its `/ToUnicode` CMap when it has one, otherwise a named base
 * encoding plus `/Differences`. Treating the raw bytes as Latin-1 is what
 * makes accented text arrive as `?`, and skipping the escape syntax is what
 * makes `\(`, `\)` and octal escapes corrupt a line.
 *
 * Decoding never invents characters: a code with no mapping is counted as
 * unmapped so the parser can report a run it could not read instead of
 * emitting placeholder text.
 */
import {
  bytesToBinaryString,
  type DecodeReport,
  decodeStream,
  dictArrayBody,
  dictInteger,
  dictName,
  dictOperand,
  type PdfIndex,
  type PdfObject,
  parseNumberList,
  resolveRef,
} from './objects';

export interface PdfFont {
  readonly resourceName: string;
  readonly subtype: string | null;
  readonly baseFont: string | null;
  /** True for composite fonts whose codes are 2 bytes (Type0/Identity-H). */
  readonly twoByteCodes: boolean;
  /** False when the font publishes no usable encoding; textFor returns ''. */
  readonly decodable: boolean;
  /** Glyph advance in 1/1000 em, or null when the font publishes no widths. */
  widthOf(code: number): number | null;
  /**
   * True when the font's CMap selects vertical writing (`/Identity-V` or a
   * vertical CMap with `/WMode 1`, ISO 32000-2 §9.7.4.3). Each code then
   * advances the pen down the column instead of along the baseline.
   */
  readonly vertical: boolean;
  /**
   * Downward vertical advance in 1/1000 em, always positive. Uses `/W2` when
   * the descendant font publishes it, otherwise the `/DW2` default.
   */
  verticalAdvanceOf(code: number): number;
  /** The code that renders a space, for word-gap detection. */
  readonly spaceCode: number;
  /** Resolve one character code to text; '' means this code is unmapped. */
  textFor(code: number): string;
}

/** Decoders are created on first use; a missing label must not crash import. */
class LazyDecoder {
  private decoder: TextDecoder | null | undefined;

  constructor(private readonly label: string) {}

  get(): TextDecoder | null {
    if (this.decoder === undefined) {
      try {
        this.decoder =
          typeof TextDecoder === 'undefined' ? null : new TextDecoder(this.label, { fatal: false });
      } catch {
        this.decoder = null;
      }
    }
    return this.decoder;
  }
}

const WIN_ANSI = new LazyDecoder('windows-1252');
const MAC_ROMAN = new LazyDecoder('macintosh');

const REPLACEMENT = '\ufffd';

/**
 * Decode a literal `( ... )` body. The body excludes the surrounding
 * parentheses; escapes are resolved here and unbalanced inner parentheses are
 * preserved as literal characters.
 */
export function decodeLiteralStringBytes(body: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (ch !== '\\') {
      out.push(ch.charCodeAt(0) & 0xff);
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) break;
    const simple = SIMPLE_ESCAPES[next];
    if (simple !== undefined) {
      out.push(simple);
      i += 1;
      continue;
    }
    if (next === '\n') {
      i += 1; // line continuation
      continue;
    }
    if (next === '\r') {
      i += body[i + 2] === '\n' ? 2 : 1;
      continue;
    }
    if (isOctal(next)) {
      let digits = next;
      let cursor = i + 2;
      while (digits.length < 3 && cursor < body.length && isOctal(body[cursor]!)) {
        digits += body[cursor]!;
        cursor += 1;
      }
      out.push(Number.parseInt(digits, 8) & 0xff);
      i = cursor - 1;
      continue;
    }
    // Unknown escape: the backslash is dropped and the character kept.
    out.push(next.charCodeAt(0) & 0xff);
    i += 1;
  }
  return new Uint8Array(out);
}

const SIMPLE_ESCAPES: Record<string, number> = {
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  b: 0x08,
  f: 0x0c,
  '(': 0x28,
  ')': 0x29,
  '\\': 0x5c,
};

function isOctal(ch: string): boolean {
  return ch >= '0' && ch <= '7';
}

/** Decode a hex string `<...>` body; an odd final digit is padded with 0. */
export function decodeHexStringBytes(body: string): Uint8Array {
  const digits = body.replace(/[^0-9A-Fa-f]/g, '');
  const out = new Uint8Array(Math.ceil(digits.length / 2));
  for (let i = 0; i < out.length; i += 1) {
    const pair = digits.slice(i * 2, i * 2 + 2);
    out[i] = Number.parseInt(pair.length === 2 ? pair : `${pair}0`, 16);
  }
  return out;
}

/** True when a byte string starts with a UTF-16BE byte-order mark. */
export function hasUtf16Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff;
}

export function decodeUtf16Be(bytes: Uint8Array): string {
  let out = '';
  for (let i = 2; i + 1 < bytes.length; i += 2) {
    out += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
  }
  return out;
}

/** Build the font record for one `/Font` resource dictionary entry. */
export function buildFont(
  index: PdfIndex,
  resourceName: string,
  fontObject: PdfObject | null,
  report: DecodeReport,
): PdfFont {
  if (!fontObject) return nonDecodableFont(resourceName, null, null);
  const subtype = dictName(fontObject.header, 'Subtype');
  const baseFont = dictName(fontObject.header, 'BaseFont');
  const twoByteCodes = subtype === 'Type0';
  const toUnicode = loadToUnicode(index, fontObject, report);
  const widthOf = loadWidths(index, fontObject, twoByteCodes);
  const vertical = loadVerticalMode(index, fontObject, subtype, report);
  const verticalAdvanceOf = vertical
    ? loadCidVerticalAdvances(index, fontObject)
    : () => DEFAULT_VERTICAL_ADVANCE;

  if (toUnicode) {
    return {
      resourceName,
      subtype,
      baseFont,
      twoByteCodes,
      decodable: true,
      widthOf,
      vertical,
      verticalAdvanceOf,
      spaceCode: toUnicode.spaceCode,
      textFor: (code: number) => sanitizeMapped(toUnicode.textFor(code)),
    };
  }
  if (twoByteCodes) {
    // A composite font with no /ToUnicode publishes no mapping at all. Its
    // bytes are glyph indices; decoding them as characters would be fiction.
    return nonDecodableFont(resourceName, subtype, baseFont);
  }

  const simple = loadSimpleEncoding(fontObject);
  return {
    resourceName,
    subtype,
    baseFont,
    twoByteCodes: false,
    decodable: true,
    widthOf,
    vertical,
    verticalAdvanceOf,
    spaceCode: simple.spaceCode,
    textFor: (code: number) => sanitizeMapped(simple.textFor(code)),
  };
}

/**
 * A decoder that has no mapping for a byte returns U+FFFD. That replacement
 * character is not text the source contained, so it is reported as unmapped
 * and kept out of the imported run.
 */
function sanitizeMapped(mapped: string): string {
  return mapped.includes(REPLACEMENT) ? '' : mapped;
}

function nonDecodableFont(
  resourceName: string,
  subtype: string | null,
  baseFont: string | null,
): PdfFont {
  return {
    resourceName,
    subtype,
    baseFont,
    twoByteCodes: subtype === 'Type0',
    decodable: false,
    widthOf: () => null,
    vertical: false,
    verticalAdvanceOf: () => DEFAULT_VERTICAL_ADVANCE,
    spaceCode: 32,
    textFor: () => '',
  };
}

interface SimpleEncoding {
  textFor(code: number): string;
  readonly spaceCode: number;
}

function loadSimpleEncoding(fontObject: PdfObject): SimpleEncoding {
  const base = dictName(fontObject.header, 'Encoding');
  const differences = parseDifferences(fontObject.header);
  const decoder = base === 'MacRomanEncoding' ? MAC_ROMAN : WIN_ANSI;
  return {
    spaceCode: 32,
    textFor(code: number): string {
      const override = differences.get(code);
      if (override !== undefined) return override;
      if (code === 32) return ' ';
      if (code >= 0x20 && code <= 0x7e) return String.fromCharCode(code);
      const decoderInstance = decoder.get();
      if (!decoderInstance) return String.fromCharCode(code);
      return decoderInstance.decode(new Uint8Array([code]));
    },
  };
}

/**
 * `/Differences [ 65 /Alpha 67 /Gamma ]` maps codes to glyph names. Only names
 * that resolve to a Unicode character are applied; an unknown name leaves the
 * base encoding in place (a wrong character is worse than the base mapping).
 */
function parseDifferences(header: string): Map<number, string> {
  const out = new Map<number, string>();
  const body = dictArrayBody(header, 'Differences');
  if (body === null) return out;
  let code = 0;
  for (const token of body.matchAll(/\d+|\/([A-Za-z0-9._]+)/g)) {
    const text = token[0]!;
    if (text.startsWith('/')) {
      const glyph = glyphNameToText(token[1]!);
      if (glyph !== null) out.set(code, glyph);
      code += 1;
    } else {
      code = Number(text);
    }
  }
  return out;
}

/**
 * The Adobe Glyph List names that appear in `/Differences` arrays in real
 * documents. `uniXXXX` and `uXXXX` forms are resolved arithmetically instead
 * of tabulated, which covers the rest of the AGL for practical purposes.
 */
const GLYPH_NAMES: Record<string, string> = {
  space: ' ',
  exclam: '!',
  quotedbl: '"',
  numbersign: '#',
  dollar: '$',
  percent: '%',
  ampersand: '&',
  quotesingle: "'",
  parenleft: '(',
  parenright: ')',
  asterisk: '*',
  plus: '+',
  comma: ',',
  hyphen: '-',
  period: '.',
  slash: '/',
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  colon: ':',
  semicolon: ';',
  less: '<',
  equal: '=',
  greater: '>',
  question: '?',
  at: '@',
  bracketleft: '[',
  backslash: '\\',
  bracketright: ']',
  underscore: '_',
  grave: '`',
  braceleft: '{',
  bar: '|',
  braceright: '}',
  asciitilde: '~',
  quoteright: '\u2019',
  quoteleft: '\u2018',
  quotedblleft: '\u201c',
  quotedblright: '\u201d',
  endash: '\u2013',
  emdash: '\u2014',
  ellipsis: '\u2026',
  bullet: '\u2022',
  dagger: '\u2020',
  daggerdbl: '\u2021',
  trademark: '\u2122',
  fi: '\ufb01',
  fl: '\ufb02',
  ae: '\u00e6',
  oe: '\u0153',
  AE: '\u00c6',
  OE: '\u0152',
  Aacute: '\u00c1',
  Acircumflex: '\u00c2',
  Adieresis: '\u00c4',
  Aring: '\u00c5',
  Atilde: '\u00c3',
  Ccedilla: '\u00c7',
  Eacute: '\u00c9',
  Egrave: '\u00c8',
  Ecircumflex: '\u00ca',
  Edieresis: '\u00cb',
  Iacute: '\u00cd',
  Icircumflex: '\u00ce',
  Idieresis: '\u00cf',
  Ntilde: '\u00d1',
  Oacute: '\u00d3',
  Ocircumflex: '\u00d4',
  Odieresis: '\u00d6',
  Otilde: '\u00d5',
  Oslash: '\u00d8',
  Uacute: '\u00da',
  Ucircumflex: '\u00db',
  Udieresis: '\u00dc',
  Yacute: '\u00dd',
  germandbls: '\u00df',
  agrave: '\u00e0',
  aacute: '\u00e1',
  acircumflex: '\u00e2',
  adieresis: '\u00e4',
  atilde: '\u00e3',
  aring: '\u00e5',
  ccedilla: '\u00e7',
  eacute: '\u00e9',
  egrave: '\u00e8',
  ecircumflex: '\u00ea',
  edieresis: '\u00eb',
  iacute: '\u00ed',
  icircumflex: '\u00ee',
  idieresis: '\u00ef',
  ntilde: '\u00f1',
  oacute: '\u00f3',
  ocircumflex: '\u00f4',
  odieresis: '\u00f6',
  otilde: '\u00f5',
  oslash: '\u00f8',
  uacute: '\u00fa',
  ucircumflex: '\u00fb',
  udieresis: '\u00fc',
  yacute: '\u00fd',
  ydieresis: '\u00ff',
};

/** Resolve a glyph name through the table, `uniXXXX`, or `uXXXX` forms. */
export function glyphNameToText(name: string): string | null {
  const direct = GLYPH_NAMES[name];
  if (direct !== undefined) return direct;
  const uni = /^uni([0-9A-Fa-f]{4,6})$/.exec(name);
  if (uni) return codePointToString(uni[1]!);
  const short = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (short) return codePointToString(short[1]!);
  return null;
}

function codePointToString(hex: string): string | null {
  const value = Number.parseInt(hex, 16);
  return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : null;
}

interface ToUnicodeMap {
  textFor(code: number): string;
  readonly spaceCode: number;
}

function loadToUnicode(
  index: PdfIndex,
  fontObject: PdfObject,
  report: DecodeReport,
): ToUnicodeMap | null {
  const match = /\/ToUnicode\s+(\d+\s+\d+\s+R)/.exec(fontObject.header);
  const ref = resolveRef(index, match?.[1]);
  if (!ref) return null;
  const bytes = decodeStream(index, ref, report);
  if (!bytes) return null;
  return parseToUnicodeMap(latin1(bytes));
}

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

/**
 * Parse the `bfchar` and `bfrange` sections of a `/ToUnicode` CMap. Ranges
 * whose destination is an array map consecutive codes to consecutive strings;
 * a destination string may be several UTF-16 code units long.
 */
export function parseToUnicodeMap(source: string): ToUnicodeMap {
  const map = new Map<number, string>();

  for (const section of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of section[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const code = Number.parseInt(pair[1]!, 16);
      const text = hexToUtf16(pair[2]!);
      if (text) map.set(code, text);
    }
  }

  for (const section of source.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of section[1]!.matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]+>|\[[^\]]*\])/g,
    )) {
      const lo = Number.parseInt(range[1]!, 16);
      const hi = Number.parseInt(range[2]!, 16);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo || hi - lo > 0x10000) continue;
      const target = range[3]!;
      if (target.startsWith('[')) {
        let cursor = lo;
        for (const item of target.matchAll(/<([0-9A-Fa-f]+)>/g)) {
          if (cursor > hi) break;
          const text = hexToUtf16(item[1]!);
          if (text) map.set(cursor, text);
          cursor += 1;
        }
        continue;
      }
      const base = Number.parseInt(target.slice(1, -1), 16);
      for (let code = lo; code <= hi; code += 1) {
        map.set(code, String.fromCodePoint(base + (code - lo)));
      }
    }
  }

  let spaceCode = 32;
  for (const [code, text] of map) {
    if (text === ' ') {
      spaceCode = code;
      break;
    }
  }

  return {
    spaceCode,
    textFor: (code: number) => map.get(code) ?? '',
  };
}

function hexToUtf16(hex: string): string {
  const padded =
    hex.length % 4 === 0 ? hex : hex.padStart(hex.length + (4 - (hex.length % 4)), '0');
  let out = '';
  for (let i = 0; i + 3 < padded.length; i += 4) {
    out += String.fromCharCode(Number.parseInt(padded.slice(i, i + 4), 16));
  }
  return out;
}

/**
 * `/Widths` for simple fonts, `/W` for composite fonts. Both are in 1/1000 em.
 * A font that publishes neither returns null, and the caller then marks the
 * run's advance as estimated instead of pretending it measured it.
 */
function loadWidths(
  index: PdfIndex,
  fontObject: PdfObject,
  twoByteCodes: boolean,
): (code: number) => number | null {
  if (twoByteCodes) return loadCidWidths(index, fontObject);
  const firstChar = dictInteger(fontObject.header, 'FirstChar');
  const widthsBody = dictArrayBody(fontObject.header, 'Widths');
  const values = widthsBody === null ? [] : parseNumberList(widthsBody);
  if (firstChar === null || values.length === 0) return () => null;
  return (code: number) => {
    const offset = code - firstChar;
    return offset >= 0 && offset < values.length ? values[offset]! : null;
  };
}

/** `/W [ c [w1 w2] cFirst cLast w ]` on the descendant CIDFont. */
function loadCidWidths(index: PdfIndex, fontObject: PdfObject): (code: number) => number | null {
  const descendants = dictArrayBody(fontObject.header, 'DescendantFonts');
  const descendant = resolveRef(index, descendants ?? undefined);
  const body = descendant ? dictArrayBody(descendant.header, 'W') : null;
  if (body === null) return () => null;
  const ranges: Array<{ from: number; to: number; width: number }> = [];
  const tokens = [...body.matchAll(/\[[^\]]*\]|-?\d*\.?\d+/g)].map((m) => m[0]!);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token.startsWith('[')) {
      const start = Number(tokens[i - 1]);
      for (const [offset, width] of parseNumberList(token).entries()) {
        if (Number.isFinite(start))
          ranges.push({ from: start + offset, to: start + offset, width });
      }
      continue;
    }
    const first = Number(token);
    const next = tokens[i + 1];
    if (next && !next.startsWith('[')) {
      const last = Number(next);
      const width = Number(tokens[i + 2]);
      if (Number.isFinite(first) && Number.isFinite(last) && Number.isFinite(width)) {
        ranges.push({ from: first, to: last, width });
        i += 2;
      }
    }
  }
  return (code: number) => {
    for (const range of ranges) {
      if (code >= range.from && code <= range.to) return range.width;
    }
    return null;
  };
}

/**
 * `/DW2`'s default second component, the downward advance, is -1000: one em
 * per glyph. Vertical CMaps are full-width by convention, so this is also the
 * honest fallback for a font that publishes no `/W2`.
 */
const DEFAULT_VERTICAL_ADVANCE = 1000;
/** Reject an advance beyond ten ems: no real vertical font is that wide. */
const MAX_VERTICAL_ADVANCE = 10_000;

/**
 * Whether a composite font writes vertically. The `/Encoding` name is the
 * usual signal (`/Identity-V`, `/90ms-RKSJ-V`); an embedded CMap states it in
 * `/WMode 1`, which may live in the stream body rather than the dictionary.
 */
function loadVerticalMode(
  index: PdfIndex,
  fontObject: PdfObject,
  subtype: string | null,
  report: DecodeReport,
): boolean {
  if (subtype !== 'Type0') return false;
  const name = dictName(fontObject.header, 'Encoding');
  if (name !== null) return /-V$/i.test(name);
  const cmap = resolveRef(index, dictOperand(fontObject.header, 'Encoding') ?? undefined);
  if (!cmap) return false;
  if (dictInteger(cmap.header, 'WMode') === 1) return true;
  if (!cmap.stream) return false;
  const bytes = decodeStream(index, cmap, report);
  if (!bytes) return false;
  // `/WMode` is a CMap dictionary entry inside the stream; a byte scan is
  // enough because the token is plain ASCII and cannot be confused with text.
  return /\/WMode\s+1(?![\d.])/.test(bytesToBinaryString(bytes));
}

/**
 * `/W2 [ c [w1y vx vy …] cFirst cLast w1y vx vy ]` on the descendant CIDFont.
 * Only the downward advance (`w1y`) is needed; the vertical displacement
 * vector positions the glyph inside its em box, which the text layout owns.
 */
function loadCidVerticalAdvances(index: PdfIndex, fontObject: PdfObject): (code: number) => number {
  const descendants = dictArrayBody(fontObject.header, 'DescendantFonts');
  const descendant = resolveRef(index, descendants ?? undefined);
  const dw2 = descendant ? dictArrayBody(descendant.header, 'DW2') : null;
  const dw2Values = dw2 === null ? [] : parseNumberList(dw2);
  const publishedDefault = dw2Values[1];
  const fallback =
    publishedDefault !== undefined && Number.isFinite(publishedDefault)
      ? boundVerticalAdvance(Math.abs(publishedDefault))
      : DEFAULT_VERTICAL_ADVANCE;
  const body = descendant ? dictArrayBody(descendant.header, 'W2') : null;
  if (body === null) return () => fallback;

  const ranges: Array<{ from: number; to: number; advance: number }> = [];
  const tokens = [...body.matchAll(/\[[^\]]*\]|-?\d*\.?\d+/g)].map((m) => m[0]!);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token.startsWith('[')) {
      const start = Number(tokens[i - 1]);
      const triples = parseNumberList(token);
      for (let at = 0; at + 2 < triples.length; at += 3) {
        if (!Number.isFinite(start)) break;
        const advance = boundVerticalAdvance(Math.abs(triples[at]!));
        ranges.push({ from: start + at / 3, to: start + at / 3, advance });
      }
      continue;
    }
    const first = Number(token);
    const next = tokens[i + 1];
    if (next && !next.startsWith('[')) {
      const last = Number(next);
      const advance = Number(tokens[i + 2]);
      if (Number.isFinite(first) && Number.isFinite(last) && Number.isFinite(advance)) {
        ranges.push({ from: first, to: last, advance: boundVerticalAdvance(Math.abs(advance)) });
        i += 4;
      }
    }
  }
  return (code: number) => {
    for (const range of ranges) {
      if (code >= range.from && code <= range.to) return range.advance;
    }
    return fallback;
  };
}

function boundVerticalAdvance(advance: number): number {
  if (!Number.isFinite(advance) || advance <= 0) return DEFAULT_VERTICAL_ADVANCE;
  return Math.min(advance, MAX_VERTICAL_ADVANCE);
}
