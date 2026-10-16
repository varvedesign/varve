/**
 * Conservative structural identity for documents.
 *
 * `strictlyIdentical(a, b)` answers "are these two values the same data?" with
 * a deliberately one-sided guarantee: `true` means the canonical serialization
 * of the two values is byte-for-byte equal, so their canonical hashes are
 * equal; `false` means only "not proven identical" and the caller must fall
 * back to comparing hashes. It never reports `true` for values whose canonical
 * bytes differ.
 *
 * This lets history capture prove that replaying stored operations recreated
 * the captured document without re-hashing every raster byte it already
 * holds: untouched subtrees are shared by reference and touched tiles are
 * compared with a byte loop rather than SHA-256.
 */

import { isByteArray } from '@varve/scene';

const MAX_DEPTH = 256;

export interface StrictIdentityOptions {
  /**
   * Own keys of the root object to disregard. Used for fields that the
   * canonical history hash itself excludes (`nextId`), so they cannot make a
   * pair that hashes equal look different.
   */
  ignoreRootKeys?: readonly string[];
}

function bytesIdentical(
  a: Uint8Array | Uint8ClampedArray,
  b: Uint8Array | Uint8ClampedArray,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function definedKeys(value: object, ignore: readonly string[] | undefined): string[] {
  const record = value as Record<string, unknown>;
  const out: string[] = [];
  for (const key of Object.keys(record)) {
    // The canonical form omits members whose value is `undefined`.
    if (record[key] === undefined) continue;
    if (ignore?.includes(key)) continue;
    out.push(key);
  }
  return out;
}

function identical(
  a: unknown,
  b: unknown,
  depth: number,
  ignoreRootKeys: readonly string[] | undefined,
): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (depth > MAX_DEPTH) return false;

  if (isByteArray(a)) {
    return (
      isByteArray(b) &&
      Object.prototype.toString.call(a) === Object.prototype.toString.call(b) &&
      bytesIdentical(a, b)
    );
  }
  if (isByteArray(b)) return false;

  if (a instanceof Map) {
    if (!(b instanceof Map) || a.size !== b.size) return false;
    for (const [key, value] of a) {
      if (!b.has(key)) return false;
      if (!identical(value, b.get(key), depth + 1, undefined)) return false;
    }
    return true;
  }
  if (b instanceof Map) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!identical(a[i], b[i], depth + 1, undefined)) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;

  // Only plain data objects. Class instances, Dates and exotic objects may
  // serialize through behaviour this comparison cannot see.
  const protoA = Object.getPrototypeOf(a);
  const protoB = Object.getPrototypeOf(b);
  if (protoA !== protoB || (protoA !== Object.prototype && protoA !== null)) return false;

  const ignore = depth === 0 ? ignoreRootKeys : undefined;
  const keysA = definedKeys(a, ignore);
  const keysB = definedKeys(b, ignore);
  if (keysA.length !== keysB.length) return false;
  const recordA = a as Record<string, unknown>;
  const recordB = b as Record<string, unknown>;
  for (const key of keysA) {
    if (!Object.hasOwn(recordB, key) || recordB[key] === undefined) return false;
    if (!identical(recordA[key], recordB[key], depth + 1, undefined)) return false;
  }
  return true;
}

export function strictlyIdentical(
  a: unknown,
  b: unknown,
  options: StrictIdentityOptions = {},
): boolean {
  return identical(a, b, 0, options.ignoreRootKeys);
}
