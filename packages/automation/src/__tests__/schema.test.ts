import { describe, expect, it } from 'vitest';
import { s, toJsonSchema, validate } from '../schema';
import { utf8ByteLength } from '../text';

const moveArgs = s.object({
  nodeId: s.string({ maxBytes: 64 }),
  x: s.number({ min: -1e6, max: 1e6 }),
  y: s.number({ min: -1e6, max: 1e6 }),
  relative: s.optional(s.boolean()),
});

describe('strict object validation', () => {
  it('accepts a well-formed value and returns it typed', () => {
    const result = validate(moveArgs, { nodeId: 'n1', x: 1, y: -2 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ nodeId: 'n1', x: 1, y: -2 });
  });

  it('rejects unknown keys and suggests the nearest valid key', () => {
    const result = validate(moveArgs, { nodeId: 'n1', x: 1, y: 2, relatve: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({
        code: 'unknown_key',
        path: '/relatve',
      });
      expect(result.issues[0]?.hint).toContain('relative');
    }
  });

  it('reports every problem in one pass, with JSON-pointer paths', () => {
    const result = validate(moveArgs, { nodeId: 7, x: 'abc', extra: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const byPath = Object.fromEntries(result.issues.map((i) => [i.path, i.code]));
      expect(byPath).toMatchObject({
        '/nodeId': 'wrong_type',
        '/x': 'wrong_type',
        '/y': 'missing_required',
        '/extra': 'unknown_key',
      });
    }
  });

  it('rejects prototype-polluting keys as unknown, even when parsed from JSON', () => {
    const polluted = JSON.parse('{"nodeId":"n","x":0,"y":0,"__proto__":{"admin":true}}');
    const result = validate(moveArgs, polluted);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.code === 'unknown_key')).toBe(true);
  });

  it('does not coerce: numeric strings are not numbers, numbers are not strings', () => {
    expect(validate(moveArgs, { nodeId: 'n', x: '1', y: 2 }).ok).toBe(false);
    expect(validate(s.string({ maxBytes: 8 }), 12).ok).toBe(false);
  });

  it('rejects non-object values where an object is expected', () => {
    for (const bad of [null, [], 'x', 3, true]) {
      expect(validate(moveArgs, bad).ok).toBe(false);
    }
  });
});

describe('numbers', () => {
  it('rejects NaN and infinities that arrive from in-process callers', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const r = validate(s.number(), bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues[0]?.code).toBe('not_finite');
    }
  });

  it('enforces integer and range bounds with the bound in the message', () => {
    const r = validate(s.integer({ min: 0, max: 10 }), 11);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]?.code).toBe('out_of_range');
      expect(r.issues[0]?.message).toContain('10');
    }
    expect(validate(s.integer({ min: 0, max: 10 }), 1.5).ok).toBe(false);
    expect(validate(s.integer({ min: 0, max: 10 }), 10).ok).toBe(true);
  });

  it('distinguishes zero and false from absent', () => {
    const schema = s.object({ a: s.optional(s.number()), b: s.optional(s.boolean()) });
    const r = validate(schema, { a: 0, b: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 0, b: false });
  });

  it('treats null as a value that must be declared nullable', () => {
    expect(validate(s.object({ a: s.optional(s.number()) }), { a: null }).ok).toBe(false);
    expect(validate(s.object({ a: s.nullable(s.number()) }), { a: null }).ok).toBe(true);
  });
});

describe('strings', () => {
  it('counts UTF-8 bytes, not UTF-16 units', () => {
    const schema = s.string({ maxBytes: 9 });
    expect(validate(schema, '日本語').ok).toBe(true); // 9 bytes
    expect(utf8ByteLength('日本語')).toBe(9);
    const over = validate(schema, '日本語a');
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.issues[0]?.code).toBe('too_long');
    expect(validate(schema, '\u{1f600}\u{1f600}\u{1f600}').ok).toBe(false); // 12 bytes
  });

  it('rejects unpaired surrogates', () => {
    const r = validate(s.string({ maxBytes: 16 }), 'ab\ud800cd');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.code).toBe('malformed_unicode');
  });

  it('closes enums and lists the allowed values', () => {
    const schema = s.enum(['left', 'center', 'right'] as const);
    const r = validate(schema, 'diagonal');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]?.code).toBe('not_in_enum');
      expect(r.issues[0]?.message).toContain('left');
      expect(r.issues[0]?.message).toContain('right');
    }
  });

  it('enforces patterns', () => {
    const hex = s.string({ maxBytes: 9, pattern: '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$' });
    expect(validate(hex, '#a1B2c3').ok).toBe(true);
    expect(validate(hex, 'zzzzzz').ok).toBe(false);
  });
});

describe('arrays', () => {
  it('requires a bound and enforces it', () => {
    const schema = s.array(s.string({ maxBytes: 8 }), { maxItems: 3 });
    expect(validate(schema, ['a', 'b', 'c']).ok).toBe(true);
    const r = validate(schema, ['a', 'b', 'c', 'd']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.code).toBe('too_many_items');
  });

  it('reports duplicate members when uniqueness is required', () => {
    const schema = s.array(s.string({ maxBytes: 8 }), { maxItems: 10, unique: true });
    const r = validate(schema, ['a', 'b', 'a', 'a']);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]?.code).toBe('duplicate_item');
      expect(r.issues[0]?.message).toContain('a');
    }
  });

  it('enforces minimum length', () => {
    const schema = s.array(s.string({ maxBytes: 8 }), { minItems: 1, maxItems: 4 });
    expect(validate(schema, []).ok).toBe(false);
  });

  it('validates each element and points at the failing index', () => {
    const schema = s.array(s.number(), { maxItems: 4 });
    const r = validate(schema, [1, 'x', 3]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.path).toBe('/1');
  });
});

describe('discriminated unions', () => {
  const shape = s.union('kind', {
    rect: s.object({ kind: s.literal('rect'), w: s.number({ min: 0 }), h: s.number({ min: 0 }) }),
    ellipse: s.object({ kind: s.literal('ellipse'), rx: s.number({ min: 0 }) }),
  });

  it('selects the variant by discriminator and validates its fields', () => {
    expect(validate(shape, { kind: 'rect', w: 1, h: 2 }).ok).toBe(true);
    expect(validate(shape, { kind: 'ellipse', rx: 3 }).ok).toBe(true);
  });

  it('rejects an unknown discriminator and lists the valid ones', () => {
    const r = validate(shape, { kind: 'banana' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]?.code).toBe('unknown_variant');
      expect(r.issues[0]?.message).toContain('rect');
    }
  });

  it('does not accept fields from another variant', () => {
    const r = validate(shape, { kind: 'rect', w: 1, h: 2, rx: 3 });
    expect(r.ok).toBe(false);
  });
});

describe('defaults and limits', () => {
  it('applies declared defaults and reports which were applied', () => {
    const schema = s.object({ mode: s.enum(['fit', 'fill'] as const, { default: 'fit' }) });
    const r = validate(schema, {});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ mode: 'fit' });
      expect(r.defaulted).toEqual(['/mode']);
    }
  });

  it('rejects over-deep input before recursing without bound', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 100; i++) deep = { a: deep };
    const recursive = s.object({ a: s.any() });
    const r = validate(recursive, deep, { maxDepth: 8 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.code === 'too_deep')).toBe(true);
  });
});

describe('JSON Schema generation', () => {
  it('emits a closed, documented draft 2020-12 schema', () => {
    const schema = toJsonSchema(moveArgs);
    expect(schema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: false,
      required: ['nodeId', 'x', 'y'],
    });
    const props = (schema as { properties: Record<string, Record<string, unknown>> }).properties;
    expect(props.x).toMatchObject({ type: 'number', minimum: -1e6, maximum: 1e6 });
    expect(props.nodeId).toMatchObject({ type: 'string', maxLength: 64, 'x-maxBytes': 64 });
  });

  it('is deterministic for equal schemas', () => {
    expect(JSON.stringify(toJsonSchema(moveArgs))).toBe(JSON.stringify(toJsonSchema(moveArgs)));
  });
});
