/**
 * Content-stream tokenizer for PDF import.
 *
 * A PDF content stream is a small program, not a text file. Tokens are read
 * with the syntax the format actually defines: literal strings with escape
 * syntax, hex strings, nested arrays, names and operators. Inline images are
 * skipped as opaque data — their bytes may contain anything, including
 * sequences that look like text-showing operators, so reading them as content
 * is how a page loses everything that follows its first inline image.
 *
 * The interpreter that consumes these tokens lives in `contentInterpreter`;
 * this module has no dependency on it.
 */
import { decodeHexStringBytes, decodeLiteralStringBytes } from './encoding';

export interface TextRun {
  readonly text: string;
  /** Display-space position in PDF points, origin at the box's upper-left. */
  readonly x: number;
  readonly y: number;
  readonly fontSize: number;
  readonly fontResource: string;
  readonly fontBase: string | null;
  /** True when the font published no widths and the advance was estimated. */
  readonly estimatedAdvance: boolean;
  /**
   * True when the run is set in a vertical writing mode (`Identity-V`, or a
   * CMap whose `/WMode` is 1). Its glyphs advance down the page, so importing
   * it as a horizontal run would put a column of text on one line.
   */
  readonly vertical: boolean;
  /**
   * Display-space displacement of the pen after showing this run, in points.
   * The next run in the same column starts at `x + advanceX, y + advanceY`.
   */
  readonly advanceX: number;
  readonly advanceY: number;
}

export interface RectFill {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly alpha: number;
}

export interface ExtGState {
  /** Fill alpha (`/ca`), or null when the state could not be read. */
  readonly alpha: number | null;
}

export interface ContentDiagnostics {
  /** Runs whose codes the font mapped only partly; their text is incomplete. */
  unmappedRuns: number;
  unmappedCodes: number;
  /** Runs skipped because the font published no encoding at all. */
  undecodableRuns: number;
  /** Runs the document paints with nothing (`3 Tr` invisible, `7 Tr` clip). */
  invisibleRuns: number;
  /** Runs set in a vertical writing mode, imported as vertical text. */
  verticalRuns: number;
  /** Editable vertical columns created from those runs after merging. */
  verticalColumns: number;
  /**
   * Runs and fills inside an optional-content group the document's default
   * configuration hides. They are not imported, because the page does not
   * show them; the layer names are reported instead.
   */
  hiddenRuns: number;
  hiddenRects: number;
  /** Optional-content sections whose visibility could not be resolved. */
  unresolvedOptionalContent: number;
  /** Display names of hidden optional-content layers that carried content. */
  hiddenLayers: Set<string>;
  inlineImages: number;
  formXObjects: number;
  strokedPaths: number;
  cmykFills: number;
  patternFills: number;
  /** `/gs` names absent from the page's `/ExtGState` resources. */
  unknownGraphicsStates: number;
  /** Runs placed outside the visible page box. */
  outsidePage: number;
  /** True when a size bound stopped the interpreter before the stream ended. */
  truncated: boolean;
}

export type ContentToken =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'name'; readonly value: string }
  | { readonly kind: 'string'; readonly value: Uint8Array }
  | { readonly kind: 'operator'; readonly value: string }
  | { readonly kind: 'arrayOpen' }
  | { readonly kind: 'arrayClose' }
  | { readonly kind: 'dictOpen' }
  | { readonly kind: 'dictClose' };

/** Bounds that keep a hostile or broken stream from monopolising the import. */
export const MAX_CONTENT_TOKENS = 400_000;

export function createDiagnostics(): ContentDiagnostics {
  return {
    unmappedRuns: 0,
    unmappedCodes: 0,
    undecodableRuns: 0,
    invisibleRuns: 0,
    verticalRuns: 0,
    verticalColumns: 0,
    hiddenRuns: 0,
    hiddenRects: 0,
    unresolvedOptionalContent: 0,
    hiddenLayers: new Set<string>(),
    inlineImages: 0,
    formXObjects: 0,
    strokedPaths: 0,
    cmykFills: 0,
    patternFills: 0,
    unknownGraphicsStates: 0,
    outsidePage: 0,
    truncated: false,
  };
}

/** Split a content stream into operand and operator tokens. */
export function tokenizeContent(bytes: Uint8Array): {
  tokens: ContentToken[];
  truncated: boolean;
  /** Inline images skipped as opaque data; never re-read as page content. */
  inlineImages: number;
} {
  const tokens: ContentToken[] = [];
  let i = 0;
  let truncated = false;
  let inlineImages = 0;
  while (i < bytes.length) {
    if (tokens.length >= MAX_CONTENT_TOKENS) {
      truncated = true;
      break;
    }
    const byte = bytes[i]!;
    if (isWhitespace(byte)) {
      i += 1;
      continue;
    }
    if (byte === 0x25) {
      while (i < bytes.length && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i += 1;
      continue;
    }
    if (byte === 0x28) {
      const slice = readLiteralString(bytes, i);
      tokens.push({ kind: 'string', value: decodeLiteralStringBytes(slice.body) });
      i = slice.next;
      continue;
    }
    if (byte === 0x3c) {
      if (bytes[i + 1] === 0x3c) {
        tokens.push({ kind: 'dictOpen' });
        i += 2;
        continue;
      }
      const slice = readHexString(bytes, i);
      tokens.push({ kind: 'string', value: decodeHexStringBytes(slice.body) });
      i = slice.next;
      continue;
    }
    if (byte === 0x3e && bytes[i + 1] === 0x3e) {
      tokens.push({ kind: 'dictClose' });
      i += 2;
      continue;
    }
    if (byte === 0x5b) {
      tokens.push({ kind: 'arrayOpen' });
      i += 1;
      continue;
    }
    if (byte === 0x5d) {
      tokens.push({ kind: 'arrayClose' });
      i += 1;
      continue;
    }
    if (byte === 0x2f) {
      let end = i + 1;
      while (end < bytes.length && !isDelimiter(bytes[end]!) && !isWhitespace(bytes[end]!))
        end += 1;
      tokens.push({ kind: 'name', value: latin1(bytes.subarray(i + 1, end)) });
      i = end;
      continue;
    }
    const numberEnd = readNumberEnd(bytes, i);
    if (numberEnd > i) {
      tokens.push({ kind: 'number', value: Number(latin1(bytes.subarray(i, numberEnd))) });
      i = numberEnd;
      continue;
    }
    const operatorEnd = readOperatorEnd(bytes, i);
    if (operatorEnd > i) {
      const value = latin1(bytes.subarray(i, operatorEnd));
      i = operatorEnd;
      if (value === 'BI') {
        inlineImages += 1;
        i = skipInlineImage(bytes, i);
        continue;
      }
      tokens.push({ kind: 'operator', value });
      continue;
    }
    // Unrecognised byte: skip it rather than desynchronising the stream.
    i += 1;
  }
  return { tokens, truncated, inlineImages };
}

/**
 * Skip an inline image. Its data runs from after `ID` to the first `EI` that
 * stands alone, so a byte sequence inside the image can never be re-read as
 * page content.
 *
 * `EI` must be preceded by white space. What follows it is either white space,
 * end of data, or a delimiter — producers do emit `EI/OC` with no gap, and
 * treating that as image data swallows every operator after the image, which
 * loses the rest of the page.
 */
function skipInlineImage(bytes: Uint8Array, start: number): number {
  let i = start;
  if (isWhitespace(bytes[i] ?? 0)) i += 1;
  while (i + 1 < bytes.length) {
    if (bytes[i] === 0x45 && bytes[i + 1] === 0x49) {
      const before = bytes[i - 1] ?? 0x20;
      const after = bytes[i + 2];
      const endsHere = after === undefined || isWhitespace(after) || isDelimiter(after);
      if (isWhitespace(before) && endsHere) return i + 2;
    }
    i += 1;
  }
  return bytes.length;
}

function readLiteralString(bytes: Uint8Array, start: number): { body: string; next: number } {
  let depth = 1;
  let i = start + 1;
  const from = i;
  while (i < bytes.length) {
    const byte = bytes[i]!;
    if (byte === 0x5c) {
      i += 2;
      continue;
    }
    if (byte === 0x28) depth += 1;
    if (byte === 0x29) {
      depth -= 1;
      if (depth === 0) break;
    }
    i += 1;
  }
  const end = Math.min(i, bytes.length);
  return { body: latin1(bytes.subarray(from, end)), next: Math.min(i + 1, bytes.length) };
}

function readHexString(bytes: Uint8Array, start: number): { body: string; next: number } {
  let i = start + 1;
  while (i < bytes.length && bytes[i] !== 0x3e) i += 1;
  return { body: latin1(bytes.subarray(start + 1, i)), next: Math.min(i + 1, bytes.length) };
}

function readNumberEnd(bytes: Uint8Array, start: number): number {
  let i = start;
  if (bytes[i] === 0x2b || bytes[i] === 0x2d) i += 1;
  let digits = 0;
  while (i < bytes.length && bytes[i]! >= 0x30 && bytes[i]! <= 0x39) {
    i += 1;
    digits += 1;
  }
  if (bytes[i] === 0x2e) {
    i += 1;
    while (i < bytes.length && bytes[i]! >= 0x30 && bytes[i]! <= 0x39) {
      i += 1;
      digits += 1;
    }
  }
  return digits > 0 ? i : start;
}

function readOperatorEnd(bytes: Uint8Array, start: number): number {
  let i = start;
  while (i < bytes.length && !isWhitespace(bytes[i]!) && !isDelimiter(bytes[i]!)) i += 1;
  return i;
}

function isWhitespace(byte: number): boolean {
  return (
    byte === 0x20 ||
    byte === 0x0a ||
    byte === 0x0d ||
    byte === 0x09 ||
    byte === 0x0c ||
    byte === 0x00
  );
}

function isDelimiter(byte: number): boolean {
  return (
    byte === 0x28 ||
    byte === 0x29 ||
    byte === 0x3c ||
    byte === 0x3e ||
    byte === 0x5b ||
    byte === 0x5d ||
    byte === 0x7b ||
    byte === 0x7d ||
    byte === 0x2f ||
    byte === 0x25
  );
}

export function latin1(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}
