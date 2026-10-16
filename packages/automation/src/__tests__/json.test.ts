import { describe, expect, it } from 'vitest';
import { parseStrictJson } from '../json';

function ok(text: string, options?: Parameters<typeof parseStrictJson>[1]) {
  const result = parseStrictJson(text, options);
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

function fail(text: string, options?: Parameters<typeof parseStrictJson>[1]) {
  const result = parseStrictJson(text, options);
  if (result.ok) throw new Error('expected failure');
  return result.error;
}

describe('parseStrictJson accepts ordinary JSON', () => {
  it('parses scalars, arrays and nested objects', () => {
    expect(ok('{"a":[1,2.5,-3e2,true,null,"x"],"b":{"c":{}}}')).toEqual({
      a: [1, 2.5, -300, true, null, 'x'],
      b: { c: {} },
    });
  });

  it('accepts surrounding whitespace and a leading BOM', () => {
    expect(ok('﻿  {"a": 1}\n')).toEqual({ a: 1 });
  });

  it('keeps multilingual text and astral characters intact', () => {
    // The astral character is written as an escape so no literal emoji is committed.
    expect(ok('{"t":"日本語 \\ud83d\\ude00 \\u00e9"}')).toEqual({ t: '日本語 \u{1F600} \u00e9' });
  });

  it('keeps -0 as a number without coercion', () => {
    expect(Object.is(ok('-0'), -0)).toBe(true);
  });
});

describe('parseStrictJson rejects what JSON.parse silently accepts', () => {
  it('rejects duplicate keys and says which one', () => {
    const error = fail('{"x":1,"y":2,"x":3}');
    expect(error.code).toBe('duplicate_key');
    expect(error.message).toContain('"x"');
  });

  it('rejects duplicate keys at depth', () => {
    expect(fail('{"a":{"k":1,"k":2}}').code).toBe('duplicate_key');
  });

  it('rejects the reserved __proto__ key', () => {
    expect(fail('{"__proto__":{"admin":true}}').code).toBe('reserved_key');
  });

  it('rejects trailing content', () => {
    expect(fail('{"a":1} {"b":2}').code).toBe('trailing_content');
    expect(fail('{"a":1}x').code).toBe('trailing_content');
  });

  it('rejects numbers that overflow to infinity', () => {
    expect(fail('{"a":1e999}').code).toBe('non_finite_number');
  });

  it('rejects an unpaired surrogate escape', () => {
    expect(fail('"\\ud800"').code).toBe('malformed_unicode');
  });

  it('rejects raw control characters inside strings', () => {
    expect(fail('"a\nb"').code).toBe('invalid_syntax');
  });

  it('rejects NaN, Infinity, single quotes, comments and trailing commas', () => {
    for (const text of [
      'NaN',
      'Infinity',
      "{'a':1}",
      '{"a":1,}',
      '[1,2,]',
      '// x\n1',
      '{"a":01}',
    ]) {
      expect(parseStrictJson(text).ok, text).toBe(false);
    }
  });

  it('rejects empty input', () => {
    expect(fail('').code).toBe('invalid_syntax');
    expect(fail('   ').code).toBe('invalid_syntax');
  });
});

describe('parseStrictJson bounds the work a hostile payload can cause', () => {
  it('rejects nesting beyond the depth limit without overflowing the stack', () => {
    const deep = `${'['.repeat(100_000)}${']'.repeat(100_000)}`;
    expect(fail(deep, { maxDepth: 64 }).code).toBe('too_deep');
  });

  it('rejects input over the byte limit using UTF-8 length', () => {
    const text = JSON.stringify({ t: '日'.repeat(400) }); // ~1.2 KB in UTF-8, ~0.4 KB UTF-16
    expect(fail(text, { maxBytes: 1000 }).code).toBe('too_large');
    expect(ok(text, { maxBytes: 2000 })).toBeTruthy();
  });

  it('rejects more values than the node limit', () => {
    const text = `[${Array.from({ length: 1000 }, () => '1').join(',')}]`;
    expect(fail(text, { maxNodes: 100 }).code).toBe('too_many_values');
  });

  it('reports the byte offset of a syntax error', () => {
    const error = fail('{"a": 1, "b": }');
    expect(error.offset).toBeGreaterThan(8);
  });
});
