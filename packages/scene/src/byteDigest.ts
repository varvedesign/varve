/**
 * Memoized SHA-256 of an immutable byte buffer (history hash scheme 2, ADR-0241).
 *
 * A raster tile's pixels are published once and never written afterwards
 * (`RasterTileDraft` clones before it writes, and every other tile operation
 * returns fresh buffers), so a digest computed for a buffer stays valid for as
 * long as the buffer lives. Scheme-2 document hashes use this digest in place
 * of the buffer's bytes, which is what makes hashing a document after a stroke
 * cost the touched tiles rather than every tile in every layer.
 *
 * The memo is keyed by the view object and weakly held, so it never extends a
 * tile's lifetime. It also records the view's length and ignores an entry whose
 * length no longer matches (a detached or resized buffer), but it cannot detect
 * an in-place write: callers must not mutate a buffer after it has been hashed.
 * `rasterTileDigest.test.ts` pins that contract for every tile operation.
 */
import { sha256Hex } from './sha256';

export type ByteArray = Uint8Array | Uint8ClampedArray;

interface DigestEntry {
  readonly length: number;
  readonly hex: string;
}

const memo = new WeakMap<object, DigestEntry>();

function asUint8(bytes: ByteArray): Uint8Array {
  return bytes instanceof Uint8Array
    ? bytes
    : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** SHA-256 of `bytes` (lowercase hex), computed at most once per buffer object. */
export function byteArrayDigest(bytes: ByteArray): string {
  const known = memo.get(bytes);
  if (known && known.length === bytes.length) return known.hex;
  const hex = sha256Hex(asUint8(bytes));
  memo.set(bytes, { length: bytes.length, hex });
  return hex;
}

/** True when a digest for this exact buffer object is already memoized. */
export function hasByteArrayDigest(bytes: ByteArray): boolean {
  const known = memo.get(bytes);
  return known !== undefined && known.length === bytes.length;
}
