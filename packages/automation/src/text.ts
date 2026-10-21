/**
 * Text and canonical-JSON helpers shared by the validator, idempotency store,
 * catalog drift hash and the wire framing. Pure, allocation-conscious, and free
 * of Node built-ins so the same code runs in the webview and in a CLI process.
 */

/**
 * UTF-8 byte length of a string without allocating the encoded buffer.
 *
 * Limits in this package are expressed in UTF-8 **bytes**. `String.length`
 * counts UTF-16 code units, which under-counts CJK text 3x and astral text 2x
 * (the legacy session envelope cap had exactly that defect).
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) {
      bytes += 1;
    } else if (unit < 0x800) {
      bytes += 2;
    } else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3; // lone high surrogate encodes as U+FFFD (3 bytes)
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** True when the string has no unpaired UTF-16 surrogates. */
export function isWellFormedUnicode(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/**
 * Deterministic JSON text: object keys sorted, `undefined` members omitted,
 * non-finite numbers rejected. Equal values always produce equal text, which
 * makes it a sound basis for argument hashes and drift detection.
 */
export function canonicalJson(value: unknown): string {
  const out: string[] = [];
  write(value, out, 0);
  return out.join('');
}

function write(value: unknown, out: string[], depth: number): void {
  if (depth > 64) throw new RangeError('canonicalJson: nesting too deep');
  if (value === null) {
    out.push('null');
    return;
  }
  switch (typeof value) {
    case 'string':
      out.push(JSON.stringify(value));
      return;
    case 'boolean':
      out.push(value ? 'true' : 'false');
      return;
    case 'number':
      if (!Number.isFinite(value)) throw new RangeError('canonicalJson: non-finite number');
      out.push(Object.is(value, -0) ? '0' : String(value));
      return;
    case 'object': {
      if (Array.isArray(value)) {
        out.push('[');
        for (let i = 0; i < value.length; i++) {
          if (i > 0) out.push(',');
          write(value[i] === undefined ? null : value[i], out, depth + 1);
        }
        out.push(']');
        return;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort();
      out.push('{');
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i] as string;
        if (i > 0) out.push(',');
        out.push(JSON.stringify(key), ':');
        write(record[key], out, depth + 1);
      }
      out.push('}');
      return;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported value of type ${typeof value}`);
  }
}

/** Levenshtein distance with an early cut-off; used for "did you mean". */
export function editDistance(a: string, b: string, limit = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const value = Math.min(
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1,
        (previous[j - 1] as number) + cost,
      );
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length] as number;
}

/** Closest candidate within `limit` edits, or `undefined`. */
export function closestMatch(
  input: string,
  candidates: readonly string[],
  limit = 2,
): string | undefined {
  let best: string | undefined;
  let bestDistance = limit + 1;
  for (const candidate of candidates) {
    const distance = editDistance(input.toLowerCase(), candidate.toLowerCase(), limit);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return bestDistance <= limit ? best : undefined;
}
