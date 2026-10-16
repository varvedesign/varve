/**
 * The streaming digest must produce exactly the bytes `canonicalizeDocument`
 * returns. These tests pin that, since persisted revisions and snapshots store
 * the digest and any drift would make every stored hash fail verification.
 */
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  CanonicalizationError,
  canonicalDocumentDigest,
  canonicalHash,
  canonicalHistoryHash,
  canonicalizeDocument,
} from '../canonical';
import { createDocument, type Document } from '../document';
import { makeRasterLayerNode, TILE_SIZE } from '../rasterLayer';
import { sha256Utf8 } from '../sha256';
import type { RasterTile } from '../types';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function nodeDigest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function expectSameDigest(doc: Document, opts: Parameters<typeof canonicalizeDocument>[1] = {}) {
  const text = canonicalizeDocument(doc, opts);
  const streamed = canonicalDocumentDigest(doc, opts);
  expect(streamed).toBe(sha256Utf8(text));
  expect(streamed).toBe(nodeDigest(text));
}

const BASE = createDocument('stream-test', { flat: true });
function withExtension(value: unknown): Document {
  return { ...BASE, zz_extension: value } as unknown as Document;
}

const AWKWARD_STRINGS = [
  '',
  'plain',
  'quote " and backslash \\ and slash /',
  'control \u0000\u0001\u001f\u007f chars \n\r\t',
  'line para sep',
  'emoji \u{1F600} and astral \u{20BB7}',
  'lone high \ud800 and lone low \udc00 surrogates',
  'accents éè and CJK 中文 and RTL אב',
  'x'.repeat(70_000),
  'é'.repeat(40_000),
];

const AWKWARD_NUMBERS = [
  0,
  -0,
  1,
  -1,
  0.1 + 0.2,
  1e21,
  1e-7,
  123456789012345680000,
  Number.MAX_SAFE_INTEGER,
  Number.MIN_SAFE_INTEGER,
  Number.MIN_VALUE,
  Number.MAX_VALUE,
  2 ** 53,
  -1.5e-300,
];

describe('canonicalDocumentDigest', () => {
  it('matches canonicalizeDocument for awkward strings, as values and as keys', () => {
    const asValues = withExtension(AWKWARD_STRINGS);
    expectSameDigest(asValues);
    const asKeys: Record<string, number> = {};
    AWKWARD_STRINGS.slice(0, 8).forEach((k, i) => {
      asKeys[k] = i;
    });
    expectSameDigest(withExtension(asKeys));
  });

  it('matches for numbers including negative zero and exponent forms', () => {
    expectSameDigest(withExtension(AWKWARD_NUMBERS));
    expectSameDigest(withExtension({ n: AWKWARD_NUMBERS }));
  });

  it('matches for null, booleans, undefined members and undefined array items', () => {
    expectSameDigest(
      withExtension({
        a: null,
        b: true,
        c: false,
        d: undefined,
        list: [1, undefined, null, 'x', undefined],
        nested: { e: undefined, f: [undefined] },
        empty: {},
        emptyList: [],
      }),
    );
  });

  it('matches for Maps (including Maps of records and numeric-like keys)', () => {
    const inner = new Map<string, unknown>([
      ['10', 1],
      ['2', 2],
      ['b', 3],
      ['a', 4],
    ]);
    expectSameDigest(withExtension({ m: inner, ms: new Map([['k', inner]]) }));
  });

  it('matches for typed arrays of every length class, including sink-boundary sizes', () => {
    const next = rng(5);
    const lengths = [0, 1, 2, 9, 10, 99, 100, 255, 256, 16_383, 16_384, 21_845, 21_846, 65_536];
    for (const length of lengths) {
      const u8 = new Uint8Array(length);
      const clamped = new Uint8ClampedArray(length);
      for (let i = 0; i < length; i++) {
        const v = Math.floor(next() * 256);
        u8[i] = v;
        clamped[i] = v;
      }
      expectSameDigest(withExtension({ u8, clamped, tail: 'after' }));
    }
  });

  it('matches for every byte value and for all-zero and all-255 runs', () => {
    const every = new Uint8Array(256 * 3);
    for (let i = 0; i < every.length; i++) every[i] = i % 256;
    expectSameDigest(
      withExtension({
        every,
        zeros: new Uint8Array(70_000),
        ones: new Uint8Array(70_000).fill(255),
      }),
    );
  });

  it('matches for randomly generated trees', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const next = rng(seed * 977);
      const gen = (depth: number): unknown => {
        const roll = next();
        if (depth > 3 || roll < 0.25) {
          const p = next();
          if (p < 0.3) return AWKWARD_NUMBERS[Math.floor(next() * AWKWARD_NUMBERS.length)];
          if (p < 0.6) return AWKWARD_STRINGS[Math.floor(next() * 8)];
          if (p < 0.7) return null;
          if (p < 0.8) return next() < 0.5;
          if (p < 0.9) return undefined;
          return Array.from({ length: Math.floor(next() * 40) }, () => Math.floor(next() * 256));
        }
        if (roll < 0.6) return Array.from({ length: Math.floor(next() * 6) }, () => gen(depth + 1));
        if (roll < 0.75) {
          const bytes = new Uint8Array(Math.floor(next() * 300));
          for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(next() * 256);
          return next() < 0.5 ? bytes : new Uint8ClampedArray(bytes);
        }
        const entries: Array<[string, unknown]> = Array.from(
          { length: Math.floor(next() * 5) },
          (_, i) => [`k${Math.floor(next() * 1000)}_${i}`, gen(depth + 1)],
        );
        return next() < 0.3 ? new Map(entries) : Object.fromEntries(entries);
      };
      expectSameDigest(withExtension(gen(0)));
    }
  });

  it('matches for a raster document, with and without the volatile-field exclusion', () => {
    const tiles = new Map<string, RasterTile>();
    const next = rng(31);
    for (let i = 0; i < 6; i++) {
      const pixels = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
      for (let j = 0; j < pixels.length; j++)
        pixels[j] = next() < 0.4 ? 0 : Math.floor(next() * 256);
      tiles.set(`${i % 3}:${Math.floor(i / 3)}`, { pixels, version: i + 2 });
    }
    const layer = {
      ...makeRasterLayerNode('rl', { width: 3 * TILE_SIZE, height: 2 * TILE_SIZE }),
      tiles,
    };
    const doc = {
      ...BASE,
      nodes: { ...BASE.nodes, rl: layer },
      rootChildren: [...BASE.rootChildren, 'rl'],
    } as unknown as Document;

    expectSameDigest(doc);
    expectSameDigest(doc, { excludeVolatile: true });
    expectSameDigest(doc, { excludePayloads: false });
    expect(canonicalHash(doc)).toBe(canonicalDocumentDigest(doc));
    expect(canonicalHistoryHash(doc, 1)).toBe(
      canonicalDocumentDigest(doc, { excludeVolatile: true }),
    );
  });

  it('keeps payload exclusion identical for asset data URLs', () => {
    const dataUrl = `data:image/png;base64,${'QUJD'.repeat(3000)}`;
    const doc = {
      ...BASE,
      assets: { a1: { id: 'a1', dataUrl, mimeType: 'image/png', name: 'a' } },
    } as unknown as Document;
    expectSameDigest(doc);
    expectSameDigest(doc, { excludePayloads: false });
  });

  it('rejects non-finite numbers exactly as canonicalizeDocument does', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const doc = withExtension({ n: bad });
      expect(() => canonicalizeDocument(doc)).toThrow(CanonicalizationError);
      expect(() => canonicalDocumentDigest(doc)).toThrow(CanonicalizationError);
    }
  });

  it('does not retain a document-sized string: a large raster digests without a string limit', () => {
    // 80 tiles of non-trivial pixels is ~18 MB of canonical text; the legacy
    // path would build it as one string. The digest only needs the 64 KiB sink.
    const tiles = new Map<string, RasterTile>();
    const next = rng(8);
    for (let i = 0; i < 80; i++) {
      const pixels = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
      for (let j = 0; j < pixels.length; j += 4) {
        pixels[j] = Math.floor(next() * 256);
        pixels[j + 3] = 255;
      }
      tiles.set(`${i % 10}:${Math.floor(i / 10)}`, { pixels, version: 1 });
    }
    const layer = {
      ...makeRasterLayerNode('big', { width: 10 * TILE_SIZE, height: 8 * TILE_SIZE }),
      tiles,
    };
    const doc = {
      ...BASE,
      nodes: { ...BASE.nodes, big: layer },
      rootChildren: [...BASE.rootChildren, 'big'],
    } as unknown as Document;
    expect(canonicalDocumentDigest(doc)).toBe(sha256Utf8(canonicalizeDocument(doc)));
  });

  it('treats a byte array created in another realm exactly like a local one', () => {
    // `instanceof Uint8ClampedArray` is false for these (jsdom test environment,
    // iframes, vm contexts); they must still canonicalize as number arrays.
    const foreign = runInNewContext('new Uint8ClampedArray([0, 7, 128, 255])') as Uint8ClampedArray;
    expect(foreign instanceof Uint8ClampedArray).toBe(false);
    const local = new Uint8ClampedArray([0, 7, 128, 255]);

    expect(canonicalizeDocument(withExtension({ pixels: foreign }))).toBe(
      canonicalizeDocument(withExtension({ pixels: local })),
    );
    expect(canonicalDocumentDigest(withExtension({ pixels: foreign }))).toBe(
      canonicalDocumentDigest(withExtension({ pixels: local })),
    );
    expect(canonicalizeDocument(withExtension({ pixels: foreign }))).toContain('[0,7,128,255]');
  });
});
