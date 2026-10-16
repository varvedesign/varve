/**
 * SHA-256 known-answer tests (FIPS 180-4) for the canonical digest.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalDigest, Sha256Stream, sha256Hex, sha256Utf8 } from '../sha256';

function nodeSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function patterned(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let s = seed >>> 0;
  for (let i = 0; i < length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

describe('sha256Hex', () => {
  it('matches FIPS 180-4 example vectors', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Utf8('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('hashes 1MB of "a" correctly (FIPS long-vector)', () => {
    const big = new Uint8Array(1_000_000).fill(0x61);
    expect(sha256Hex(big)).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('handles partial-block lengths around the padding boundary', () => {
    // 55 bytes: fits in one block after padding (56-byte length field).
    const s55 = 'a'.repeat(55);
    // 56 bytes: spills into a second block.
    const s56 = 'a'.repeat(56);
    const known55 = sha256Utf8(s55);
    const known56 = sha256Utf8(s56);
    expect(known55).toMatch(/^[0-9a-f]{64}$/);
    expect(known56).toMatch(/^[0-9a-f]{64}$/);
    expect(known55).not.toBe(known56);
  });

  it('digests arbitrary byte sequences', () => {
    expect(sha256Hex(fromHex('000102030405060708090a0b0c0d0e0f'))).toBe(
      'be45cb2605bf36bebde684841a28f0fd43c69850a3dce5fedba69928ee3a8991',
    );
  });

  it('canonicalDigest equals sha256Utf8', () => {
    expect(canonicalDigest('{"a":1}')).toBe(sha256Utf8('{"a":1}'));
  });
});

describe('sha256 cross-checked against node:crypto', () => {
  it('agrees for every length through two blocks, including the 55/56/63/64-byte padding edges', () => {
    for (let n = 0; n <= 200; n++) {
      const data = patterned(n, n + 1);
      expect(sha256Hex(data), `length ${n}`).toBe(nodeSha256(data));
    }
  });

  it('agrees for a multi-megabyte buffer', () => {
    const data = patterned(5 * 1024 * 1024 + 13, 77);
    expect(sha256Hex(data)).toBe(nodeSha256(data));
  });

  it('is independent of how the input is chunked', () => {
    const data = patterned(70_000, 5);
    const want = nodeSha256(data);
    const sizes = [1, 2, 3, 7, 31, 63, 64, 65, 127, 128, 1000, 4096, 65_536, 70_000];
    for (const size of sizes) {
      const stream = new Sha256Stream();
      for (let at = 0; at < data.length; at += size) {
        stream.update(data, at, Math.min(data.length, at + size));
      }
      expect(stream.digestHex(), `chunk size ${size}`).toBe(want);
    }
  });

  it('honours start/end offsets without reading outside them', () => {
    const data = patterned(300, 9);
    const stream = new Sha256Stream().update(data, 10, 133);
    expect(stream.digestHex()).toBe(nodeSha256(data.subarray(10, 133)));
  });

  it('refuses reuse after finalization', () => {
    const stream = new Sha256Stream().update(new Uint8Array(3));
    stream.digestHex();
    expect(() => stream.update(new Uint8Array(1))).toThrow(/finalized/);
    expect(() => stream.digestHex()).toThrow(/finalized/);
  });
});
