/**
 * Non-finite numeric values in persisted documents.
 *
 * A JSON number can express a value that overflows IEEE-754 binary64
 * (`1e999` parses to `Infinity`), and in-memory edits can produce `NaN` or
 * `Infinity` through arithmetic bugs. `JSON.stringify` does not fail on either:
 * it writes `null`, so a save silently replaces the value and the next open has
 * lost the original. That makes a document containing one non-finite number
 * quietly corrupt itself on every save.
 *
 * Document numbers are finite by contract, so there are two boundaries:
 * - Load: repair the values deterministically (reset to `0`) and report every
 *   reset path in the decode warnings, so an old or crafted file becomes
 *   renderable and saveable again.
 * - Save: refuse to serialize while a non-finite value remains, naming the
 *   field(s), instead of writing `null` over the user's data.
 *
 * Binary payloads (raster tile bytes and other typed arrays / buffers) are
 * skipped: they are integer pixel data, cannot hold a non-finite number, and
 * walking them would cost time proportional to the artwork.
 */

/** One non-finite numeric value found in a document. */
export interface NonFiniteNumber {
  /** Path from the document root, e.g. `nodes.shapeA.opacity`. */
  path: string;
  value: number;
}

/** Maximum number of offending values `findNonFiniteNumbers` reports. */
const DEFAULT_REPORT_LIMIT = 64;

/** Recursion bound for repair and scan. Documents are shallow trees; a crafted
 *  payload beyond this is left untouched and the save guard reports it. */
const MAX_DEPTH = 512;

function pathOf(parent: string, key: string | number): string {
  if (typeof key === 'number') return `${parent}[${key}]`;
  return parent ? `${parent}.${key}` : key;
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isBinaryPayload(value: object): boolean {
  return ArrayBuffer.isView(value) || value instanceof ArrayBuffer;
}

/** Collect non-finite numbers without copying the document. */
export function findNonFiniteNumbers(
  root: unknown,
  limit: number = DEFAULT_REPORT_LIMIT,
): NonFiniteNumber[] {
  const found: NonFiniteNumber[] = [];
  const stack: Array<{ value: unknown; path: string; depth: number }> = [
    { value: root, path: '', depth: 0 },
  ];
  while (stack.length > 0 && found.length < limit) {
    const frame = stack.pop();
    if (!frame) break;
    const { value, path, depth } = frame;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) found.push({ path, value });
      continue;
    }
    if (value === null || typeof value !== 'object' || depth >= MAX_DEPTH) continue;
    if (isBinaryPayload(value)) continue;
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: value[index], path: pathOf(path, index), depth: depth + 1 });
      }
      continue;
    }
    if (value instanceof Map) {
      for (const [key, entry] of value) {
        stack.push({ value: entry, path: pathOf(path, String(key)), depth: depth + 1 });
      }
      continue;
    }
    if (value instanceof Set) {
      let index = 0;
      for (const entry of value) {
        stack.push({ value: entry, path: pathOf(path, index), depth: depth + 1 });
        index += 1;
      }
      continue;
    }
    if (!isPlainRecord(value)) continue;
    const keys = Object.keys(value);
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index] as string;
      stack.push({ value: value[key], path: pathOf(path, key), depth: depth + 1 });
    }
  }
  return found;
}

export interface NonFiniteRepair<T> {
  document: T;
  /** Every value that was replaced, with its path. */
  repaired: NonFiniteNumber[];
}

/** Replace every non-finite number with `0`, copying only changed branches. */
export function repairNonFiniteNumbers<T>(root: T): NonFiniteRepair<T> {
  const repaired: NonFiniteNumber[] = [];

  function repair(value: unknown, path: string, depth: number): unknown {
    if (typeof value === 'number') {
      if (Number.isFinite(value)) return value;
      repaired.push({ path, value });
      return 0;
    }
    if (value === null || typeof value !== 'object' || depth >= MAX_DEPTH) return value;
    if (isBinaryPayload(value)) return value;
    if (Array.isArray(value)) {
      let changed = false;
      const next = value.map((entry, index) => {
        const result = repair(entry, pathOf(path, index), depth + 1);
        if (result !== entry) changed = true;
        return result;
      });
      return changed ? next : value;
    }
    if (value instanceof Map) {
      let changed = false;
      const next = new Map<unknown, unknown>();
      for (const [key, entry] of value) {
        const result = repair(entry, pathOf(path, String(key)), depth + 1);
        if (result !== entry) changed = true;
        next.set(key, result);
      }
      return changed ? next : value;
    }
    if (value instanceof Set) {
      let changed = false;
      const next = new Set<unknown>();
      let index = 0;
      for (const entry of value) {
        const result = repair(entry, pathOf(path, index), depth + 1);
        if (result !== entry) changed = true;
        next.add(result);
        index += 1;
      }
      return changed ? next : value;
    }
    if (!isPlainRecord(value)) return value;
    let next: Record<string, unknown> | null = null;
    for (const key of Object.keys(value)) {
      const entry = value[key];
      const result = repair(entry, pathOf(path, key), depth + 1);
      if (result !== entry) {
        if (!next) next = { ...value };
        next[key] = result;
      } else if (next) {
        next[key] = entry;
      }
    }
    return next ?? value;
  }

  const document = repair(root, '', 0) as T;
  return { document, repaired };
}

function formatValue(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  return value > 0 ? 'Infinity' : '-Infinity';
}

/**
 * Refusal raised by `DocumentCodec.encode` when the document still holds a
 * non-finite number. Serializing would write `null`, so saving is refused and
 * the offending fields are named for an actionable error message.
 */
export class NonFiniteDocumentError extends Error {
  readonly fields: NonFiniteNumber[];

  constructor(fields: NonFiniteNumber[]) {
    const listed = fields
      .slice(0, 3)
      .map((field) => `${field.path || 'document'} = ${formatValue(field.value)}`)
      .join(', ');
    const remaining = fields.length - Math.min(fields.length, 3);
    super(
      `Document contains a non-finite number at ${listed}${remaining > 0 ? ` and ${remaining} more` : ''}; saving would replace it with null.`,
    );
    this.name = 'NonFiniteDocumentError';
    this.fields = fields;
  }
}
