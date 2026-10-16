/**
 * Strict JSON parser for untrusted command input.
 *
 * `JSON.parse` is lenient in ways that matter for an automation boundary: it
 * silently keeps the last of two duplicate keys (a typo that drops an argument
 * with no error), it creates an own `__proto__` property, it produces
 * `Infinity` for `1e999`, and it recurses without a depth bound in some
 * engines. This parser enforces the stricter contract the executor assumes and
 * reports a machine code plus the byte offset, so a CLI or control channel can
 * point at the problem instead of saying "bad JSON".
 */
import { isWellFormedUnicode, utf8ByteLength } from './text';

export type JsonErrorCode =
  | 'invalid_syntax'
  | 'duplicate_key'
  | 'reserved_key'
  | 'trailing_content'
  | 'non_finite_number'
  | 'malformed_unicode'
  | 'too_deep'
  | 'too_large'
  | 'too_many_values';

export interface JsonParseError {
  code: JsonErrorCode;
  message: string;
  /** UTF-16 offset into the input where the problem was detected. */
  offset: number;
}

export type JsonParseResult = { ok: true; value: unknown } | { ok: false; error: JsonParseError };

export interface JsonParseOptions {
  maxBytes?: number;
  maxDepth?: number;
  maxNodes?: number;
}

export const DEFAULT_JSON_LIMITS = {
  maxBytes: 4 * 1024 * 1024,
  maxDepth: 64,
  maxNodes: 1_000_000,
} as const;

class Failure extends Error {
  constructor(readonly detail: JsonParseError) {
    super(detail.message);
  }
}

const NUMBER = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/;

export function parseStrictJson(input: string, options: JsonParseOptions = {}): JsonParseResult {
  const maxBytes = options.maxBytes ?? DEFAULT_JSON_LIMITS.maxBytes;
  const maxDepth = options.maxDepth ?? DEFAULT_JSON_LIMITS.maxDepth;
  const maxNodes = options.maxNodes ?? DEFAULT_JSON_LIMITS.maxNodes;

  const bytes = utf8ByteLength(input);
  if (bytes > maxBytes) {
    return {
      ok: false,
      error: {
        code: 'too_large',
        message: `input is ${bytes} bytes; the limit is ${maxBytes}`,
        offset: 0,
      },
    };
  }

  let i = input.charCodeAt(0) === 0xfeff ? 1 : 0;
  let nodes = 0;

  const fail = (code: JsonErrorCode, message: string, at = i): never => {
    throw new Failure({ code, message, offset: at });
  };

  const skip = (): void => {
    while (i < input.length) {
      const c = input.charCodeAt(i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i += 1;
      else break;
    }
  };

  const count = (): void => {
    nodes += 1;
    if (nodes > maxNodes) fail('too_many_values', `more than ${maxNodes} values`);
  };

  const parseString = (): string => {
    // Caller guarantees input[i] === '"'.
    const start = i;
    i += 1;
    let out = '';
    let runStart = i;
    while (i < input.length) {
      const c = input.charCodeAt(i);
      if (c === 0x22) {
        out += input.slice(runStart, i);
        i += 1;
        if (!isWellFormedUnicode(out)) {
          fail('malformed_unicode', 'string contains an unpaired surrogate', start);
        }
        return out;
      }
      if (c < 0x20) fail('invalid_syntax', 'control character in string; use an escape');
      if (c === 0x5c) {
        out += input.slice(runStart, i);
        i += 1;
        const e = input[i];
        i += 1;
        switch (e) {
          case '"':
            out += '"';
            break;
          case '\\':
            out += '\\';
            break;
          case '/':
            out += '/';
            break;
          case 'b':
            out += '\b';
            break;
          case 'f':
            out += '\f';
            break;
          case 'n':
            out += '\n';
            break;
          case 'r':
            out += '\r';
            break;
          case 't':
            out += '\t';
            break;
          case 'u': {
            const hex = input.slice(i, i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('invalid_syntax', 'bad \\u escape');
            out += String.fromCharCode(Number.parseInt(hex, 16));
            i += 4;
            break;
          }
          default:
            fail('invalid_syntax', `invalid escape \\${e ?? ''}`, i - 1);
        }
        runStart = i;
        continue;
      }
      i += 1;
    }
    return fail('invalid_syntax', 'unterminated string', start);
  };

  const parseValue = (depth: number): unknown => {
    if (depth > maxDepth) fail('too_deep', `nesting deeper than ${maxDepth} levels`);
    skip();
    if (i >= input.length) fail('invalid_syntax', 'unexpected end of input');
    count();
    const ch = input[i] as string;

    if (ch === '{') {
      i += 1;
      const object: Record<string, unknown> = {};
      const seen = new Set<string>();
      skip();
      if (input[i] === '}') {
        i += 1;
        return object;
      }
      for (;;) {
        skip();
        if (input[i] !== '"') fail('invalid_syntax', 'expected a string key');
        const keyAt = i;
        const key = parseString();
        if (key === '__proto__') fail('reserved_key', 'the key "__proto__" is not accepted', keyAt);
        if (seen.has(key)) {
          fail('duplicate_key', `duplicate key ${JSON.stringify(key)}`, keyAt);
        }
        seen.add(key);
        skip();
        if (input[i] !== ':') fail('invalid_syntax', 'expected ":" after key');
        i += 1;
        object[key] = parseValue(depth + 1);
        skip();
        if (input[i] === ',') {
          i += 1;
          continue;
        }
        if (input[i] === '}') {
          i += 1;
          return object;
        }
        fail('invalid_syntax', 'expected "," or "}"');
      }
    }

    if (ch === '[') {
      i += 1;
      const array: unknown[] = [];
      skip();
      if (input[i] === ']') {
        i += 1;
        return array;
      }
      for (;;) {
        array.push(parseValue(depth + 1));
        skip();
        if (input[i] === ',') {
          i += 1;
          continue;
        }
        if (input[i] === ']') {
          i += 1;
          return array;
        }
        fail('invalid_syntax', 'expected "," or "]"');
      }
    }

    if (ch === '"') return parseString();
    if (input.startsWith('true', i)) {
      i += 4;
      return true;
    }
    if (input.startsWith('false', i)) {
      i += 5;
      return false;
    }
    if (input.startsWith('null', i)) {
      i += 4;
      return null;
    }

    const match = NUMBER.exec(input.slice(i, i + 64));
    if (match === null) fail('invalid_syntax', `unexpected character ${JSON.stringify(ch)}`);
    const literal = (match as RegExpExecArray)[0];
    const next = input.charCodeAt(i + literal.length);
    // "01", "1.", "1e" and "-" leave a stray digit/letter behind: reject them.
    if (
      (next >= 0x30 && next <= 0x39) ||
      next === 0x2e ||
      next === 0x65 ||
      next === 0x45 ||
      next === 0x2b ||
      next === 0x2d
    ) {
      fail('invalid_syntax', 'malformed number');
    }
    const value = Number(literal);
    if (!Number.isFinite(value)) {
      fail('non_finite_number', `number ${literal.slice(0, 24)} is not finite`);
    }
    i += literal.length;
    return value;
  };

  try {
    const value = parseValue(0);
    skip();
    if (i < input.length) fail('trailing_content', 'unexpected content after the JSON value');
    return { ok: true, value };
  } catch (error) {
    if (error instanceof Failure) return { ok: false, error: error.detail };
    return {
      ok: false,
      error: {
        code: 'invalid_syntax',
        message: error instanceof Error ? error.message : 'invalid JSON',
        offset: i,
      },
    };
  }
}
