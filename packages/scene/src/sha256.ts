/**
 * Pure-TS SHA-256 (FIPS 180-4) for canonical content hashing (ADR-0021).
 *
 * Deliberately dependency-free and synchronous so the canonical digest is
 * identical in Node, browsers, jsdom tests, and Tauri webviews — WebCrypto
 * `crypto.subtle` is async and absent from some test environments.
 *
 * Two entry points share one block function:
 *  - `sha256Hex` / `sha256Utf8` / `canonicalDigest` hash a complete buffer.
 *  - `Sha256Stream` hashes incrementally, so a caller that produces a large
 *    byte sequence (the canonical document text) never has to hold it whole.
 *
 * Known-answer vectors and a Node `crypto` cross-check live in
 * __tests__/sha256.test.ts.
 */

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const H0 = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

/**
 * Process `blocks` consecutive 64-byte blocks of `src` starting at `offset`,
 * folding them into the state `h`. `w` is caller-owned scratch (64 words).
 * All arithmetic is int32 (`|0`); the digest reads the words back unsigned.
 */
function compress(
  h: Int32Array,
  w: Int32Array,
  src: Uint8Array,
  offset: number,
  blocks: number,
): void {
  let h0 = h[0]!;
  let h1 = h[1]!;
  let h2 = h[2]!;
  let h3 = h[3]!;
  let h4 = h[4]!;
  let h5 = h[5]!;
  let h6 = h[6]!;
  let h7 = h[7]!;

  let p = offset;
  for (let blk = 0; blk < blocks; blk++, p += 64) {
    for (let i = 0; i < 16; i++) {
      const j = p + i * 4;
      w[i] = (src[j]! << 24) | (src[j + 1]! << 16) | (src[j + 2]! << 8) | src[j + 3]!;
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!;
      const y = w[i - 2]!;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let hh = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i]! + w[i]!) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + hh) | 0;
  }

  h[0] = h0;
  h[1] = h1;
  h[2] = h2;
  h[3] = h3;
  h[4] = h4;
  h[5] = h5;
  h[6] = h6;
  h[7] = h7;
}

/** Incremental SHA-256. Single use: `digestHex()` finishes the stream. */
export class Sha256Stream {
  private readonly h = new Int32Array(H0);
  private readonly w = new Int32Array(64);
  private readonly block = new Uint8Array(64);
  private blockLen = 0;
  private total = 0;
  private finished = false;

  /** Append `data[start, end)`. Returns `this` so calls can chain. */
  update(data: Uint8Array, start = 0, end = data.length): this {
    if (this.finished) throw new Error('Sha256Stream already finalized');
    let i = start;
    this.total += end - start;

    if (this.blockLen > 0) {
      const take = Math.min(64 - this.blockLen, end - i);
      this.block.set(data.subarray(i, i + take), this.blockLen);
      this.blockLen += take;
      i += take;
      if (this.blockLen < 64) return this;
      compress(this.h, this.w, this.block, 0, 1);
      this.blockLen = 0;
    }

    const blocks = (end - i) >> 6;
    if (blocks > 0) {
      compress(this.h, this.w, data, i, blocks);
      i += blocks << 6;
    }
    if (i < end) {
      this.block.set(data.subarray(i, end), 0);
      this.blockLen = end - i;
    }
    return this;
  }

  /** Finalize and return the digest as a lowercase 64-hex string. */
  digestHex(): string {
    if (this.finished) throw new Error('Sha256Stream already finalized');
    this.finished = true;

    const block = this.block;
    let n = this.blockLen;
    block[n++] = 0x80;
    if (n > 56) {
      block.fill(0, n, 64);
      compress(this.h, this.w, block, 0, 1);
      n = 0;
    }
    block.fill(0, n, 56);
    const bitLen = this.total * 8;
    const high = Math.floor(bitLen / 0x100000000);
    const low = bitLen >>> 0;
    block[56] = high >>> 24;
    block[57] = (high >>> 16) & 0xff;
    block[58] = (high >>> 8) & 0xff;
    block[59] = high & 0xff;
    block[60] = low >>> 24;
    block[61] = (low >>> 16) & 0xff;
    block[62] = (low >>> 8) & 0xff;
    block[63] = low & 0xff;
    compress(this.h, this.w, block, 0, 1);

    let out = '';
    for (let i = 0; i < 8; i++) {
      out += (this.h[i]! >>> 0).toString(16).padStart(8, '0');
    }
    return out;
  }
}

/** SHA-256 digest of the given bytes as a lowercase 64-hex string. */
export function sha256Hex(data: Uint8Array): string {
  return new Sha256Stream().update(data).digestHex();
}

/** SHA-256 of a UTF-8 string (canonical text form). */
export function sha256Utf8(text: string): string {
  return sha256Hex(new TextEncoder().encode(text));
}

/** SHA-256 of a canonical JSON string (the canonical document digest). */
export function canonicalDigest(canonicalJson: string): string {
  return sha256Utf8(canonicalJson);
}
