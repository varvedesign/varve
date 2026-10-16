/**
 * Strict runtime schemas for command arguments and results.
 *
 * TypeScript types are erased at the wire, so they are not validation. This
 * module is the single description of every command's input and output: it
 * validates at runtime (unknown keys rejected, enums closed, numbers finite,
 * strings bounded in UTF-8 bytes, lists bounded) and generates the JSON Schema
 * that the CLI, JSON control channel and MCP adapters publish. One source, no
 * drift between what is advertised and what is enforced.
 *
 * Deliberate rules:
 * - No coercion. `"1"` is not `1`, `0` is not absent, `null` must be declared.
 * - Unknown keys are errors, with a nearest-key suggestion.
 * - Every string and array declares a bound; there is no unbounded default.
 * - Defaults are explicit, and the result lists which were applied.
 */
import { closestMatch, isWellFormedUnicode, utf8ByteLength } from './text';

// ── Schema model ─────────────────────────────────────────────────────────────

interface SchemaBase {
  description?: string;
  /** Property may be omitted. Set through `s.optional`. */
  optional?: boolean;
}

export interface StringSchema extends SchemaBase {
  kind: 'string';
  maxBytes: number;
  minLength?: number;
  pattern?: string;
  default?: string;
}

export interface EnumSchema<V extends string = string> extends SchemaBase {
  kind: 'enum';
  values: readonly V[];
  default?: V;
}

export interface NumberSchema extends SchemaBase {
  kind: 'number';
  integer?: boolean;
  min?: number;
  max?: number;
  unit?: string;
  default?: number;
}

export interface BooleanSchema extends SchemaBase {
  kind: 'boolean';
  default?: boolean;
}

export interface LiteralSchema<V extends string | number | boolean = string> extends SchemaBase {
  kind: 'literal';
  value: V;
}

export interface ArraySchema<T extends Schema = Schema> extends SchemaBase {
  kind: 'array';
  items: T;
  minItems?: number;
  maxItems: number;
  unique?: boolean;
}

export interface ObjectSchema<P extends Record<string, Schema> = Record<string, Schema>>
  extends SchemaBase {
  kind: 'object';
  properties: P;
}

export interface NullableSchema<T extends Schema = Schema> extends SchemaBase {
  kind: 'nullable';
  inner: T;
}

export interface UnionSchema<
  D extends string = string,
  V extends Record<string, ObjectSchema> = Record<string, ObjectSchema>,
> extends SchemaBase {
  kind: 'union';
  discriminator: D;
  variants: V;
}

/** Any JSON value, still bounded by depth and node-count limits. Use sparingly. */
export interface AnySchema extends SchemaBase {
  kind: 'any';
}

export type Schema =
  | StringSchema
  | EnumSchema
  | NumberSchema
  | BooleanSchema
  | LiteralSchema<string | number | boolean>
  | ArraySchema
  | ObjectSchema
  | NullableSchema
  | UnionSchema
  | AnySchema;

type OptionalKeys<P> = {
  [K in keyof P]: P[K] extends { optional: true } ? K : never;
}[keyof P];
type ObjectInfer<P> = { [K in Exclude<keyof P, OptionalKeys<P>>]: Infer<P[K]> } & {
  [K in OptionalKeys<P>]?: Infer<P[K]>;
};

/**
 * The TypeScript type a schema validates to.
 *
 * A flat lookup keyed by the literal `kind`. A chain of nested conditional
 * types costs one instantiation level per branch and exhausts the compiler's
 * depth budget on realistic nested outputs; indexed access keeps each level of
 * nesting to a constant cost.
 */
interface InferByKind<S> {
  string: string;
  number: number;
  boolean: boolean;
  any: unknown;
  enum: S extends { values: readonly (infer V)[] } ? V : never;
  literal: S extends { value: infer V } ? V : never;
  array: S extends { items: infer T } ? Infer<T>[] : never;
  nullable: S extends { inner: infer T } ? Infer<T> | null : never;
  union: S extends { variants: infer V } ? { [K in keyof V]: Infer<V[K]> }[keyof V] : never;
  object: S extends { properties: infer P } ? ObjectInfer<P> : never;
}

export type Infer<S> = S extends { kind: infer K }
  ? K extends keyof InferByKind<S>
    ? InferByKind<S>[K]
    : never
  : never;

// ── Builders ─────────────────────────────────────────────────────────────────

type Described = { description?: string };

export const s = {
  string(
    opts: {
      maxBytes?: number;
      minLength?: number;
      pattern?: string;
      default?: string;
    } & Described = {},
  ): StringSchema {
    return { kind: 'string', maxBytes: opts.maxBytes ?? 1024, ...omitMaxBytes(opts) };
  },
  enum<const V extends string>(
    values: readonly V[],
    opts: { default?: V } & Described = {},
  ): EnumSchema<V> {
    return { kind: 'enum', values, ...opts };
  },
  number(
    opts: { min?: number; max?: number; unit?: string; default?: number } & Described = {},
  ): NumberSchema {
    return { kind: 'number', ...opts };
  },
  integer(
    opts: { min?: number; max?: number; unit?: string; default?: number } & Described = {},
  ): NumberSchema {
    return { kind: 'number', integer: true, ...opts };
  },
  boolean(opts: { default?: boolean } & Described = {}): BooleanSchema {
    return { kind: 'boolean', ...opts };
  },
  literal<const V extends string | number | boolean>(
    value: V,
    opts: Described = {},
  ): LiteralSchema<V> {
    return { kind: 'literal', value, ...opts };
  },
  array<T extends Schema>(
    items: T,
    opts: { maxItems: number; minItems?: number; unique?: boolean } & Described,
  ): ArraySchema<T> {
    return { kind: 'array', items, ...opts };
  },
  object<P extends Record<string, Schema>>(properties: P, opts: Described = {}): ObjectSchema<P> {
    return { kind: 'object', properties, ...opts };
  },
  nullable<T extends Schema>(inner: T, opts: Described = {}): NullableSchema<T> {
    return { kind: 'nullable', inner, ...opts };
  },
  union<D extends string, V extends Record<string, ObjectSchema>>(
    discriminator: D,
    variants: V,
    opts: Described = {},
  ): UnionSchema<D, V> {
    return { kind: 'union', discriminator, variants, ...opts };
  },
  any(opts: Described = {}): AnySchema {
    return { kind: 'any', ...opts };
  },
  /** Mark a property as omittable. Omission is never reported as `null`. */
  optional<T extends Schema>(schema: T): T & { optional: true } {
    return { ...schema, optional: true };
  },
};

function omitMaxBytes<T extends { maxBytes?: number }>(opts: T): Omit<T, 'maxBytes'> {
  const { maxBytes: _ignored, ...rest } = opts;
  return rest;
}

// ── Validation ───────────────────────────────────────────────────────────────

export type IssueCode =
  | 'wrong_type'
  | 'missing_required'
  | 'unknown_key'
  | 'not_finite'
  | 'out_of_range'
  | 'not_integer'
  | 'too_long'
  | 'too_short'
  | 'malformed_unicode'
  | 'pattern_mismatch'
  | 'not_in_enum'
  | 'unknown_variant'
  | 'too_many_items'
  | 'too_few_items'
  | 'duplicate_item'
  | 'literal_mismatch'
  | 'too_deep'
  | 'too_large'
  | 'too_many_issues';

export interface Issue {
  /** RFC 6901 JSON Pointer to the offending value (`""` is the root). */
  path: string;
  code: IssueCode;
  message: string;
  /** Short description of what was expected. */
  expected?: string;
  /** Actionable suggestion, e.g. the nearest valid key. */
  hint?: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T; defaulted: string[] }
  | { ok: false; issues: Issue[] };

export interface ValidateOptions {
  maxDepth?: number;
  maxIssues?: number;
  /** Cap on values visited, so a hostile payload cannot cost unbounded work. */
  maxNodes?: number;
}

const DEFAULT_MAX_DEPTH = 16;
const DEFAULT_MAX_ISSUES = 50;
const DEFAULT_MAX_NODES = 200_000;

interface Walk {
  issues: Issue[];
  defaulted: string[];
  maxDepth: number;
  maxIssues: number;
  maxNodes: number;
  nodes: number;
  aborted: boolean;
}

function pointer(parent: string, key: string | number): string {
  return `${parent}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function report(walk: Walk, issue: Issue): void {
  if (walk.issues.length >= walk.maxIssues) {
    if (!walk.aborted) {
      walk.aborted = true;
      walk.issues.push({
        path: '',
        code: 'too_many_issues',
        message: `more than ${walk.maxIssues} problems; fix the listed ones and retry`,
      });
    }
    return;
  }
  walk.issues.push(issue);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const OMIT = Symbol('omit');

/** Validate `input` against `schema`. Never throws for any JSON-shaped input. */
export function validate<S extends Schema>(
  schema: S,
  input: unknown,
  options: ValidateOptions = {},
): ValidationResult<Infer<S>> {
  return validateUnknown(schema, input, options) as ValidationResult<Infer<S>>;
}

/** Untyped form for code that holds erased schemas (catalog, executor). */
export function validateUnknown(
  schema: Schema,
  input: unknown,
  options: ValidateOptions = {},
): ValidationResult<unknown> {
  const walk: Walk = {
    issues: [],
    defaulted: [],
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxIssues: options.maxIssues ?? DEFAULT_MAX_ISSUES,
    maxNodes: options.maxNodes ?? DEFAULT_MAX_NODES,
    nodes: 0,
    aborted: false,
  };
  const value = check(schema, input, '', 0, walk);
  if (walk.issues.length > 0) return { ok: false, issues: walk.issues };
  return { ok: true, value, defaulted: walk.defaulted };
}

function check(schema: Schema, value: unknown, path: string, depth: number, walk: Walk): unknown {
  walk.nodes += 1;
  if (walk.nodes > walk.maxNodes) {
    if (walk.nodes === walk.maxNodes + 1) {
      report(walk, {
        path,
        code: 'too_large',
        message: `input has more than ${walk.maxNodes} values`,
      });
    }
    return OMIT;
  }
  if (depth > walk.maxDepth) {
    report(walk, {
      path,
      code: 'too_deep',
      message: `nesting deeper than ${walk.maxDepth} levels`,
    });
    return OMIT;
  }

  switch (schema.kind) {
    case 'any':
      return checkAny(value, path, depth, walk);

    case 'string':
      return checkString(schema, value, path, walk);

    case 'enum': {
      if (typeof value !== 'string') {
        report(walk, wrongType(path, 'string', value));
        return OMIT;
      }
      if (!schema.values.includes(value)) {
        const near = closestMatch(value, schema.values);
        report(walk, {
          path,
          code: 'not_in_enum',
          message: `${JSON.stringify(truncate(value))} is not one of: ${schema.values.join(', ')}`,
          expected: schema.values.join(' | '),
          ...(near ? { hint: `did you mean ${JSON.stringify(near)}?` } : {}),
        });
        return OMIT;
      }
      return value;
    }

    case 'number':
      return checkNumber(schema, value, path, walk);

    case 'boolean':
      if (typeof value !== 'boolean') {
        report(walk, wrongType(path, 'boolean', value));
        return OMIT;
      }
      return value;

    case 'literal':
      if (value !== schema.value) {
        report(walk, {
          path,
          code: 'literal_mismatch',
          message: `expected the constant ${JSON.stringify(schema.value)}`,
          expected: JSON.stringify(schema.value),
        });
        return OMIT;
      }
      return value;

    case 'nullable':
      if (value === null) return null;
      return check(schema.inner, value, path, depth, walk);

    case 'array':
      return checkArray(schema, value, path, depth, walk);

    case 'object':
      return checkObject(schema, value, path, depth, walk);

    case 'union':
      return checkUnion(schema, value, path, depth, walk);
  }
}

const RESERVED_KEYS = new Set(['__proto__']);

/**
 * `any` still accepts only JSON-shaped data and still costs bounded work:
 * finite numbers, well-formed strings, plain objects and arrays, no reserved
 * keys, within the depth and node limits that apply to typed schemas.
 */
function checkAny(value: unknown, path: string, depth: number, walk: Walk): unknown {
  walk.nodes += 1;
  if (walk.nodes > walk.maxNodes) {
    if (walk.nodes === walk.maxNodes + 1) {
      report(walk, {
        path,
        code: 'too_large',
        message: `input has more than ${walk.maxNodes} values`,
      });
    }
    return OMIT;
  }
  if (depth > walk.maxDepth) {
    report(walk, {
      path,
      code: 'too_deep',
      message: `nesting deeper than ${walk.maxDepth} levels`,
    });
    return OMIT;
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      report(walk, { path, code: 'not_finite', message: 'number must be finite' });
      return OMIT;
    }
    return value;
  }
  if (typeof value === 'string') {
    if (!isWellFormedUnicode(value)) {
      report(walk, {
        path,
        code: 'malformed_unicode',
        message: 'string contains an unpaired surrogate',
      });
      return OMIT;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => checkAny(item, pointer(path, i), depth + 1, walk));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (RESERVED_KEYS.has(key)) {
        report(walk, {
          path: pointer(path, key),
          code: 'unknown_key',
          message: `reserved property name ${JSON.stringify(key)} is not accepted`,
        });
        continue;
      }
      if (value[key] === undefined) continue;
      out[key] = checkAny(value[key], pointer(path, key), depth + 1, walk);
    }
    return out;
  }
  report(walk, wrongType(path, 'a JSON value', value));
  return OMIT;
}

function truncate(text: string, max = 48): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function wrongType(path: string, expected: string, received: unknown): Issue {
  return {
    path,
    code: 'wrong_type',
    message: `expected ${expected}, received ${describe(received)}`,
    expected,
    hint:
      typeof received === 'string' && (expected === 'number' || expected === 'integer')
        ? 'numbers must be JSON numbers; strings are not coerced'
        : undefined,
  };
}

function checkString(schema: StringSchema, value: unknown, path: string, walk: Walk): unknown {
  if (typeof value !== 'string') {
    report(walk, wrongType(path, 'string', value));
    return OMIT;
  }
  if (!isWellFormedUnicode(value)) {
    report(walk, {
      path,
      code: 'malformed_unicode',
      message: 'string contains an unpaired surrogate and cannot be encoded as UTF-8',
    });
    return OMIT;
  }
  const bytes = utf8ByteLength(value);
  if (bytes > schema.maxBytes) {
    report(walk, {
      path,
      code: 'too_long',
      message: `string is ${bytes} UTF-8 bytes; the limit is ${schema.maxBytes}`,
      expected: `at most ${schema.maxBytes} bytes`,
    });
    return OMIT;
  }
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    report(walk, {
      path,
      code: 'too_short',
      message: `string must have at least ${schema.minLength} character(s)`,
    });
    return OMIT;
  }
  if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) {
    report(walk, {
      path,
      code: 'pattern_mismatch',
      message: `string does not match the required pattern ${schema.pattern}`,
      expected: schema.pattern,
    });
    return OMIT;
  }
  return value;
}

function checkNumber(schema: NumberSchema, value: unknown, path: string, walk: Walk): unknown {
  if (typeof value !== 'number') {
    report(walk, wrongType(path, schema.integer ? 'integer' : 'number', value));
    return OMIT;
  }
  if (!Number.isFinite(value)) {
    report(walk, {
      path,
      code: 'not_finite',
      message: 'number must be finite (NaN and infinities are not accepted)',
    });
    return OMIT;
  }
  if (schema.integer && !Number.isInteger(value)) {
    report(walk, {
      path,
      code: 'not_integer',
      message: `expected an integer, received ${value}`,
      expected: 'integer',
    });
    return OMIT;
  }
  if (
    (schema.min !== undefined && value < schema.min) ||
    (schema.max !== undefined && value > schema.max)
  ) {
    const lo = schema.min ?? '-inf';
    const hi = schema.max ?? '+inf';
    report(walk, {
      path,
      code: 'out_of_range',
      message: `${value} is outside the allowed range [${lo}, ${hi}]${schema.unit ? ` ${schema.unit}` : ''}`,
      expected: `[${lo}, ${hi}]`,
    });
    return OMIT;
  }
  return value;
}

function checkArray(
  schema: ArraySchema,
  value: unknown,
  path: string,
  depth: number,
  walk: Walk,
): unknown {
  if (!Array.isArray(value)) {
    report(walk, wrongType(path, 'array', value));
    return OMIT;
  }
  if (value.length > schema.maxItems) {
    report(walk, {
      path,
      code: 'too_many_items',
      message: `list has ${value.length} items; the limit is ${schema.maxItems}`,
      expected: `at most ${schema.maxItems} items`,
    });
    return OMIT;
  }
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    report(walk, {
      path,
      code: 'too_few_items',
      message: `list needs at least ${schema.minItems} item(s)`,
    });
    return OMIT;
  }
  const out: unknown[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = check(schema.items, value[i], pointer(path, i), depth + 1, walk);
    out.push(item);
  }
  if (schema.unique) {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const item of out) {
      if (item === OMIT) continue;
      const key = typeof item === 'string' ? `s:${item}` : `j:${JSON.stringify(item)}`;
      if (seen.has(key)) duplicates.add(typeof item === 'string' ? item : JSON.stringify(item));
      seen.add(key);
    }
    if (duplicates.size > 0) {
      report(walk, {
        path,
        code: 'duplicate_item',
        message: `list contains duplicate items: ${[...duplicates].map(truncate).join(', ')}`,
        hint: 'remove duplicates; each item may appear once',
      });
      return OMIT;
    }
  }
  return out;
}

function checkObject(
  schema: ObjectSchema,
  value: unknown,
  path: string,
  depth: number,
  walk: Walk,
): unknown {
  if (!isPlainObject(value)) {
    report(walk, wrongType(path, 'object', value));
    return OMIT;
  }
  const known = Object.keys(schema.properties);
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(value)) {
    if (Object.hasOwn(schema.properties, key)) continue;
    const near = closestMatch(key, known);
    report(walk, {
      path: pointer(path, key),
      code: 'unknown_key',
      message: `unknown property ${JSON.stringify(truncate(key))}`,
      expected: `one of: ${known.join(', ') || '(no properties)'}`,
      ...(near ? { hint: `did you mean ${JSON.stringify(near)}?` } : {}),
    });
  }

  for (const key of known) {
    const property = schema.properties[key] as Schema;
    const present = Object.hasOwn(value, key) && value[key] !== undefined;
    if (!present) {
      const fallback = (property as { default?: unknown }).default;
      if (fallback !== undefined) {
        out[key] = fallback;
        walk.defaulted.push(pointer(path, key));
      } else if (!property.optional) {
        report(walk, {
          path: pointer(path, key),
          code: 'missing_required',
          message: `missing required property ${JSON.stringify(key)}`,
          expected: property.kind,
        });
      }
      continue;
    }
    const checked = check(property, value[key], pointer(path, key), depth + 1, walk);
    if (checked !== OMIT) out[key] = checked;
  }
  return out;
}

function checkUnion(
  schema: UnionSchema,
  value: unknown,
  path: string,
  depth: number,
  walk: Walk,
): unknown {
  if (!isPlainObject(value)) {
    report(walk, wrongType(path, 'object', value));
    return OMIT;
  }
  const tag = value[schema.discriminator];
  const names = Object.keys(schema.variants);
  if (typeof tag !== 'string' || !Object.hasOwn(schema.variants, tag)) {
    const near = typeof tag === 'string' ? closestMatch(tag, names) : undefined;
    report(walk, {
      path: pointer(path, schema.discriminator),
      code: 'unknown_variant',
      message: `${schema.discriminator} must be one of: ${names.join(', ')}`,
      expected: names.join(' | '),
      ...(near ? { hint: `did you mean ${JSON.stringify(near)}?` } : {}),
    });
    return OMIT;
  }
  return checkObject(schema.variants[tag] as ObjectSchema, value, path, depth, walk);
}

// ── JSON Schema generation ───────────────────────────────────────────────────

export type JsonSchema = Record<string, unknown>;

export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

/** JSON Schema (draft 2020-12) for a command schema. Deterministic output. */
export function toJsonSchema(schema: Schema): JsonSchema {
  return { $schema: JSON_SCHEMA_DIALECT, ...convert(schema) };
}

function convert(schema: Schema): JsonSchema {
  const meta: JsonSchema = schema.description ? { description: schema.description } : {};
  switch (schema.kind) {
    case 'any':
      return meta;
    case 'string':
      return {
        type: 'string',
        // A string of N UTF-8 bytes has at most N UTF-16 units: a necessary,
        // conservative bound. The authoritative limit is `x-maxBytes`.
        maxLength: schema.maxBytes,
        'x-maxBytes': schema.maxBytes,
        ...(schema.minLength !== undefined ? { minLength: schema.minLength } : {}),
        ...(schema.pattern !== undefined ? { pattern: schema.pattern } : {}),
        ...(schema.default !== undefined ? { default: schema.default } : {}),
        ...meta,
      };
    case 'enum':
      return {
        type: 'string',
        enum: [...schema.values],
        ...(schema.default !== undefined ? { default: schema.default } : {}),
        ...meta,
      };
    case 'number':
      return {
        type: schema.integer ? 'integer' : 'number',
        ...(schema.min !== undefined ? { minimum: schema.min } : {}),
        ...(schema.max !== undefined ? { maximum: schema.max } : {}),
        ...(schema.unit !== undefined ? { 'x-unit': schema.unit } : {}),
        ...(schema.default !== undefined ? { default: schema.default } : {}),
        ...meta,
      };
    case 'boolean':
      return {
        type: 'boolean',
        ...(schema.default !== undefined ? { default: schema.default } : {}),
        ...meta,
      };
    case 'literal':
      return { const: schema.value, ...meta };
    case 'array':
      return {
        type: 'array',
        items: convert(schema.items),
        maxItems: schema.maxItems,
        ...(schema.minItems !== undefined ? { minItems: schema.minItems } : {}),
        ...(schema.unique ? { uniqueItems: true } : {}),
        ...meta,
      };
    case 'object': {
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, property] of Object.entries(schema.properties)) {
        properties[key] = convert(property);
        const defaulted = (property as { default?: unknown }).default !== undefined;
        if (!property.optional && !defaulted) required.push(key);
      }
      return {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
        ...meta,
      };
    }
    case 'nullable':
      return { anyOf: [convert(schema.inner), { type: 'null' }], ...meta };
    case 'union':
      return {
        oneOf: Object.values(schema.variants).map((variant) => convert(variant)),
        ...meta,
      };
  }
}
