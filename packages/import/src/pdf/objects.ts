/**
 * PDF object indexing and bounded stream decoding.
 *
 * The importer reads a whole file without trusting its cross-reference table:
 * `xref` streams and tables are frequently wrong in files the user actually
 * has, and a wrong table must not turn a readable document into an empty one.
 * Objects are located by scanning for `n g obj`, and streams are sliced from
 * the original bytes rather than from a decoded string so binary content is
 * never reinterpreted.
 *
 * Decoded stream data is bounded: a small compressed stream must not be able
 * to expand into unbounded memory (the classic decompression bomb), so inflate
 * output is capped and the overflow is reported instead of allocated.
 */
import { Inflate, Unzlib } from 'fflate';

/** Largest file the string-based scanner will load, in bytes. */
export const MAX_PDF_BYTES = 32 * 1024 * 1024;
/** Largest decoded stream the importer will accept, in bytes. */
export const MAX_STREAM_BYTES = 16 * 1024 * 1024;

export interface PdfObject {
  readonly number: number;
  readonly generation: number;
  /** Dictionary text between `obj` and `stream`/`endobj` (dictionaries only). */
  readonly header: string;
  /** Byte range of the raw stream payload, when the object has one. */
  readonly stream: { readonly start: number; readonly end: number } | null;
}

export interface PdfIndex {
  readonly bytes: Uint8Array;
  /** Byte-preserving view of the file; `text[i]` is byte `i`. */
  readonly text: string;
  readonly objects: Map<number, PdfObject>;
  /** True when scanning stopped early because the file exceeded its budget. */
  readonly truncated: boolean;
}

/** Collected diagnostics from one parse; the parser turns these into warnings. */
export interface DecodeReport {
  unsupportedFilters: Set<string>;
  /** Streams whose decode failed (bad data, truncated, unexpected format). */
  failedStreams: number;
  /** Streams refused because their expansion exceeded the decode budget. */
  oversizedStreams: number;
  /**
   * Streams skipped for any reason. A page body that could not be decoded is
   * a reported outcome, never an empty page: the difference between "no text
   * here" and "this was not read" is what the user needs to see.
   */
  skippedStreams: number;
}

export function createDecodeReport(): DecodeReport {
  return {
    unsupportedFilters: new Set<string>(),
    failedStreams: 0,
    oversizedStreams: 0,
    skippedStreams: 0,
  };
}

/**
 * Build a one-character-per-byte string. `TextDecoder('latin1')` is *not* a
 * byte-preserving mapping — the WHATWG label maps to windows-1252, where bytes
 * 0x80–0x9F decode to different code points, which would shift every offset.
 */
export function bytesToBinaryString(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return out;
}

const OBJECT_HEADER = /\d+\s+\d+\s+obj\b/g;

/** Index every `n g obj` block. Later definitions of the same number win. */
export function indexPdfObjects(bytes: Uint8Array): PdfIndex {
  const truncated = bytes.length > MAX_PDF_BYTES;
  const slice = truncated ? bytes.subarray(0, MAX_PDF_BYTES) : bytes;
  const text = bytesToBinaryString(slice);
  const objects = new Map<number, PdfObject>();
  OBJECT_HEADER.lastIndex = 0;

  let match = OBJECT_HEADER.exec(text);
  while (match !== null) {
    const headerEnd = match.index + match[0].length;
    const endobjAt = text.indexOf('endobj', headerEnd);
    const streamAt = findStreamKeyword(text, headerEnd);
    // A `stream` keyword that appears after this object's `endobj` belongs to a
    // later object; treating it as ours would give every object the same body.
    const hasOwnStream = streamAt >= 0 && (endobjAt < 0 || streamAt < endobjAt);
    const dictEnd = hasOwnStream ? streamAt : endobjAt;
    if (dictEnd < 0) {
      match = OBJECT_HEADER.exec(text);
      continue;
    }
    const header = text.slice(headerEnd, dictEnd);
    const [numText, genText] = match[0].split(/\s+/);
    const stream = hasOwnStream ? sliceStream(text, streamAt, lengthOf(header)) : null;
    objects.set(Number(numText), {
      number: Number(numText),
      generation: Number(genText),
      header,
      stream,
    });
    match = OBJECT_HEADER.exec(text);
  }

  return { bytes: slice, text, objects, truncated };
}

/** Locate the `stream` keyword that terminates an object's dictionary. */
function findStreamKeyword(text: string, from: number): number {
  const at = text.indexOf('stream', from);
  if (at < 0) return -1;
  // `endstream` also contains `stream`; require the preceding byte to be a
  // delimiter so an `endstream` keyword is never mistaken for a start.
  const before = at === 0 ? '\n' : text[at - 1]!;
  if (!/[\s>\]/]/.test(before)) return -1;
  return at;
}

/** Slice a stream payload out of the file text, honouring the declared length. */
function sliceStream(
  text: string,
  streamAt: number,
  declaredLength: number | null,
): { start: number; end: number } | null {
  let start = streamAt + 'stream'.length;
  if (text[start] === '\r') start += 1;
  if (text[start] === '\n') start += 1;

  if (declaredLength !== null && declaredLength >= 0 && start + declaredLength <= text.length) {
    return { start, end: start + declaredLength };
  }
  const endstreamAt = text.indexOf('endstream', start);
  if (endstreamAt < 0) return null;
  let end = endstreamAt;
  if (text[end - 1] === '\n') end -= 1;
  if (text[end - 1] === '\r') end -= 1;
  return end <= start ? null : { start, end };
}

/** Read a direct integer operand for a key such as `/Length` from a dictionary. */
export function dictInteger(header: string, key: string): number | null {
  const match = new RegExp(`/${key}\\s+(\\d+)(?!\\s+\\d+\\s+R)`, 'g').exec(header);
  return match ? Number(match[1]) : null;
}

function lengthOf(header: string): number | null {
  return dictInteger(header, 'Length');
}

/** A reference `n g R` operand, or the value itself when it is an array. */
export interface IndirectRef {
  readonly number: number;
}

export function resolveRef(index: PdfIndex, value: string | undefined): PdfObject | null {
  if (!value) return null;
  const match = /(\d+)\s+\d+\s+R/.exec(value);
  if (!match) return null;
  return index.objects.get(Number(match[1])) ?? null;
}

/** Read `/Key` as a name operand (`/FlateDecode`), returning null when absent. */
export function dictName(header: string, key: string): string | null {
  const match = new RegExp(`/${key}\\s*/([A-Za-z0-9#*.\\-]+)`).exec(header);
  return match ? match[1]! : null;
}

/** Read `/Key` as a raw operand string up to the next `/` or dictionary end. */
export function dictOperand(header: string, key: string): string | null {
  const match = new RegExp(`/${key}(?![A-Za-z0-9])\\s*([^/]*?)(?=\\s*/|\\s*>>|$)`).exec(header);
  return match ? match[1]!.trim() : null;
}

/** Read `/Key [ ... ]` and return the bracketed body, including nesting. */
export function dictArrayBody(header: string, key: string): string | null {
  const at = new RegExp(`/${key}(?![A-Za-z0-9])\\s*\\[`).exec(header);
  if (!at) return null;
  let depth = 0;
  const open = at.index + at[0].length - 1;
  for (let i = open; i < header.length; i += 1) {
    const ch = header[i];
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return header.slice(open + 1, i);
    }
  }
  return null;
}

/** Numbers inside a bracketed body such as `/MediaBox [0 0 612 792]`. */
export function parseNumberList(body: string): number[] {
  const out: number[] = [];
  for (const match of body.matchAll(/-?\d*\.?\d+/g)) out.push(Number(match[0]));
  return out;
}

export function parseNumberListOrRef(index: PdfIndex, body: string | null): number[] {
  if (body === null) return [];
  const direct = parseNumberList(body);
  if (direct.length > 0) return direct;
  const referenced = resolveRef(index, body);
  return referenced ? parseNumberList(referenced.header) : [];
}

/**
 * Decode an object's stream payload, applying the filter chain.
 *
 * Returns `null` when the stream cannot be decoded; callers must report that
 * rather than silently treating the page as empty.
 */
export function decodeStream(
  index: PdfIndex,
  object: PdfObject,
  report: DecodeReport,
): Uint8Array | null {
  if (!object.stream) return null;
  let data = index.bytes.subarray(object.stream.start, object.stream.end);

  const filters = filterChain(object.header);
  for (const filter of filters) {
    const next = applyFilter(data, filter, report);
    if (next === null) {
      report.skippedStreams += 1;
      return null;
    }
    data = next;
    if (data.length > MAX_STREAM_BYTES) {
      report.oversizedStreams += 1;
      report.skippedStreams += 1;
      return null;
    }
  }
  return data;
}

function filterChain(header: string): string[] {
  const arrayBody = dictArrayBody(header, 'Filter');
  if (arrayBody !== null) {
    return [...arrayBody.matchAll(/\/([A-Za-z0-9]+)/g)].map((m) => m[1]!);
  }
  const single = dictName(header, 'Filter');
  return single ? [single] : [];
}

function applyFilter(data: Uint8Array, filter: string, report: DecodeReport): Uint8Array | null {
  switch (filter) {
    case 'FlateDecode':
    case 'Fl':
      return inflateBounded(data, MAX_STREAM_BYTES, report);
    case 'ASCIIHexDecode':
    case 'AHx':
      return asciiHexDecode(data);
    case 'ASCII85Decode':
    case 'A85':
      return ascii85Decode(data);
    // Image filters never appear on content streams; a page whose *content*
    // uses one is not decodable here and must be reported, not guessed.
    default:
      report.unsupportedFilters.add(filter);
      return null;
  }
}

/**
 * Inflate with a hard output cap, using a streaming decoder so an
 * over-budget stream aborts instead of allocating its expansion.
 *
 * PDF's `FlateDecode` is zlib-wrapped (RFC 1950), but producers exist that
 * emit raw DEFLATE, so a failed zlib attempt is retried as raw inflate before
 * the stream is declared undecodable.
 */
export function inflateBounded(
  data: Uint8Array,
  maxBytes: number,
  report: DecodeReport,
): Uint8Array | null {
  const zlibAttempt = collectInflate(data, maxBytes, (handler) => new Unzlib(handler));
  if (zlibAttempt.ok) return zlibAttempt.value;
  const rawAttempt = collectInflate(data, maxBytes, (handler) => new Inflate(handler));
  if (rawAttempt.ok) return rawAttempt.value;
  if (rawAttempt.overflow || zlibAttempt.overflow) {
    report.oversizedStreams += 1;
  } else {
    report.failedStreams += 1;
  }
  return null;
}

interface InflateAttempt {
  ok: boolean;
  overflow: boolean;
  value: Uint8Array | null;
}

function collectInflate(
  data: Uint8Array,
  maxBytes: number,
  create: (handler: (chunk: Uint8Array) => void) => {
    push: (chunk: Uint8Array, final?: boolean) => void;
  },
): InflateAttempt {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let overflow = false;
  const decoder = create((chunk) => {
    if (overflow) return;
    total += chunk.length;
    if (total > maxBytes) {
      overflow = true;
      return;
    }
    chunks.push(chunk);
  });
  try {
    decoder.push(data, true);
  } catch {
    return { ok: false, overflow, value: null };
  }
  if (overflow) return { ok: false, overflow: true, value: null };
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return { ok: total > 0, overflow: false, value: total > 0 ? out : null };
}

function asciiHexDecode(data: Uint8Array): Uint8Array | null {
  const out: number[] = [];
  let high: number | null = null;
  for (const byte of data) {
    if (byte === 0x3e) break; // '>'
    const digit = hexDigit(byte);
    if (digit < 0) continue;
    if (high === null) high = digit;
    else {
      out.push(high * 16 + digit);
      high = null;
    }
  }
  if (high !== null) out.push(high * 16);
  return new Uint8Array(out);
}

function hexDigit(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return -1;
}

function ascii85Decode(data: Uint8Array): Uint8Array | null {
  const out: number[] = [];
  let tuple = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 1) {
    const byte = data[i]!;
    if (byte === 0x7e) break; // '~' ends the data
    if (byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09) continue;
    if (byte === 0x7a && count === 0) {
      out.push(0, 0, 0, 0); // 'z' is four zero bytes
      continue;
    }
    if (byte < 0x21 || byte > 0x75) continue;
    tuple = tuple * 85 + (byte - 0x21);
    count += 1;
    if (count === 5) {
      out.push((tuple >>> 24) & 0xff, (tuple >>> 16) & 0xff, (tuple >>> 8) & 0xff, tuple & 0xff);
      tuple = 0;
      count = 0;
    }
  }
  if (count > 1) {
    for (let i = count; i < 5; i += 1) tuple = tuple * 85 + 84;
    out.push((tuple >>> 24) & 0xff, (tuple >>> 16) & 0xff, (tuple >>> 8) & 0xff, tuple & 0xff);
  }
  return new Uint8Array(out);
}
