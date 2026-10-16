/**
 * History hash schemes (ADR-0241 D4).
 *
 * Persisted revisions and snapshots store these hashes, so the contract pinned
 * here is the one that must never drift: scheme 1 reproduces every hash ever
 * written, scheme 2 is a stable function of the same document, and a document
 * with no byte arrays hashes identically under both.
 */
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byteArrayDigest, hasByteArrayDigest } from '../byteDigest';
import {
  canonicalDocumentDigest,
  canonicalHistoryHash,
  canonicalizeDocument,
  HISTORY_HASH_SCHEME_CURRENT,
  HISTORY_HASH_SCHEME_LEGACY,
  historyHashSchemeOf,
} from '../canonical';
import { createDocument, type Document } from '../document';
import { makeCoverageMask } from '../paintCoverage';
import {
  type BrushDab,
  beginRasterTileDraft,
  compositeDabOnNode,
  compositeSmudgeDabOnNode,
  eraseDabOnNode,
  fillCoverageOnNode,
  makeRasterLayerNode,
  TILE_SIZE,
} from '../rasterLayer';
import { Sha256Stream, sha256Hex } from '../sha256';
import type { RasterLayerNode, RasterTile } from '../types';

/**
 * Scheme-1 hash of `rasterDocument()`, verified equal to what the pre-scheme-2
 * `canonical.ts` (git HEAD at 2026-10-16) computes for the same document: the
 * value every stored revision written before scheme 2 carries.
 */
const V1_RASTER_DOCUMENT_HASH = '30406e11893d9ee372c08579644f89e109f112c99c71c7e4adbb377d1d88a3b5';
const V2_RASTER_DOCUMENT_HASH = 'bf6bb48a8a0278ec6a0f7e696580654ab4a1c71b7b50d18ee6ac316b6942fc16';
const FLAT_DOCUMENT_HASH = 'ef3dfce573fa6ce5a711dad15b542a32be2de78f78c8475420ef06191017277e';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function tile(seed: number, version: number): RasterTile {
  const next = rng(seed);
  const pixels = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
  for (let i = 0; i < pixels.length; i++) pixels[i] = Math.floor(next() * 256);
  return { pixels, version };
}

// `createDocument` mints a random id; the pinned hashes need a fixed one.
const BASE: Document = { ...createDocument('golden-scheme', { flat: true }), id: 'golden-doc' };

function withTiles(tiles: Map<string, RasterTile>, width = 2 * TILE_SIZE): Document {
  const layer = { ...makeRasterLayerNode('rl', { width, height: TILE_SIZE }), tiles };
  return {
    ...BASE,
    rootChildren: [...BASE.rootChildren, 'rl'],
    nodes: { ...BASE.nodes, rl: layer },
  } as unknown as Document;
}

function rasterDocument(): Document {
  return withTiles(
    new Map([
      ['0:0', tile(1, 3)],
      ['1:0', tile(2, 5)],
    ]),
  );
}

function layerOf(doc: Document): RasterLayerNode {
  return doc.nodes.rl as RasterLayerNode;
}

function nodeSha(bytes: Uint8Array | Uint8ClampedArray): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('history hash scheme 1 (legacy)', () => {
  it('still reproduces the hash every pre-scheme-2 revision stored', () => {
    expect(canonicalHistoryHash(rasterDocument(), 1)).toBe(V1_RASTER_DOCUMENT_HASH);
    expect(canonicalHistoryHash(BASE, 1)).toBe(FLAT_DOCUMENT_HASH);
  });

  it('is the hash of the JSON.stringify canonical text', () => {
    const doc = rasterDocument();
    const text = canonicalizeDocument(doc, { excludeVolatile: true });
    expect(canonicalHistoryHash(doc, 1)).toBe(createHash('sha256').update(text).digest('hex'));
  });
});

describe('history hash scheme 2', () => {
  it('is the current scheme and pins a stable value', () => {
    expect(HISTORY_HASH_SCHEME_CURRENT).toBe(2);
    expect(HISTORY_HASH_SCHEME_LEGACY).toBe(1);
    expect(canonicalHistoryHash(rasterDocument())).toBe(V2_RASTER_DOCUMENT_HASH);
    expect(canonicalHistoryHash(rasterDocument(), 2)).toBe(V2_RASTER_DOCUMENT_HASH);
  });

  it('differs from scheme 1 for a document that holds byte arrays', () => {
    expect(V2_RASTER_DOCUMENT_HASH).not.toBe(V1_RASTER_DOCUMENT_HASH);
  });

  it('is exactly equal to scheme 1 when the document holds no byte arrays', () => {
    expect(canonicalHistoryHash(BASE, 2)).toBe(canonicalHistoryHash(BASE, 1));
    const emptyLayer = withTiles(new Map());
    expect(canonicalHistoryHash(emptyLayer, 2)).toBe(canonicalHistoryHash(emptyLayer, 1));
  });

  it('digests the same bytes the text form spells, and builds that text independently', () => {
    const doc = rasterDocument();
    const text = canonicalizeDocument(doc, { excludeVolatile: true, byteArrays: 'digest' });
    expect(canonicalDocumentDigest(doc, { excludeVolatile: true, byteArrays: 'digest' })).toBe(
      createHash('sha256').update(text).digest('hex'),
    );
    // Hand-built expectation: each tile appears as its length and its own
    // SHA-256 (computed here by Node, not by the code under test).
    for (const [key, t] of layerOf(doc).tiles) {
      expect(text, `tile ${key}`).toContain(
        `"pixels":bytes:${t.pixels.length}:${nodeSha(t.pixels)},"version":${t.version}`,
      );
    }
    // And no tile byte is spelled out.
    expect(text).not.toContain('"pixels":[');
  });

  it('is not valid JSON when it carries a byte array, so no scheme-1 text can equal it', () => {
    const text = canonicalizeDocument(rasterDocument(), {
      excludeVolatile: true,
      byteArrays: 'digest',
    });
    expect(() => JSON.parse(text)).toThrow();
    const flat = canonicalizeDocument(BASE, { excludeVolatile: true, byteArrays: 'digest' });
    expect(flat).toBe(canonicalizeDocument(BASE, { excludeVolatile: true }));
  });

  it('changes when one byte, one version, one key, or the byte length changes', () => {
    const base = rasterDocument();
    const reference = canonicalHistoryHash(base);

    const flipped = new Map(layerOf(base).tiles);
    const t0 = flipped.get('0:0')!;
    const pixels = new Uint8ClampedArray(t0.pixels);
    pixels[12345] = pixels[12345]! ^ 1;
    flipped.set('0:0', { pixels, version: t0.version });
    expect(canonicalHistoryHash(withTiles(flipped))).not.toBe(reference);

    const bumped = new Map(layerOf(base).tiles);
    bumped.set('0:0', { pixels: t0.pixels, version: t0.version + 1 });
    expect(canonicalHistoryHash(withTiles(bumped))).not.toBe(reference);

    const moved = new Map<string, RasterTile>([
      ['0:0', layerOf(base).tiles.get('1:0')!],
      ['1:0', layerOf(base).tiles.get('0:0')!],
    ]);
    expect(canonicalHistoryHash(withTiles(moved))).not.toBe(reference);

    const shorter = new Map(layerOf(base).tiles);
    shorter.set('0:0', { pixels: t0.pixels.slice(0, t0.pixels.length - 4), version: t0.version });
    expect(canonicalHistoryHash(withTiles(shorter))).not.toBe(reference);
  });

  it('treats equal bytes in a Uint8Array and a Uint8ClampedArray alike, as scheme 1 does', () => {
    const next = rng(9);
    const clamped = new Uint8ClampedArray(300).map(() => Math.floor(next() * 256));
    const u8 = new Uint8Array(clamped);
    const holder = (value: unknown) => ({ ...BASE, zz_extension: value }) as unknown as Document;
    expect(canonicalHistoryHash(holder(u8), 2)).toBe(canonicalHistoryHash(holder(clamped), 2));
    expect(canonicalHistoryHash(holder(u8), 1)).toBe(canonicalHistoryHash(holder(clamped), 1));
  });

  it('hashes a typed array from another realm the same way', () => {
    const next = rng(4);
    const local = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4).map(() =>
      Math.floor(next() * 256),
    );
    const foreign = runInNewContext('new Uint8ClampedArray(n)', {
      n: local.length,
    }) as Uint8ClampedArray;
    foreign.set(local);
    expect(foreign instanceof Uint8ClampedArray).toBe(false);
    const a = withTiles(new Map([['0:0', { pixels: local, version: 1 }]]));
    const b = withTiles(new Map([['0:0', { pixels: foreign, version: 1 }]]));
    expect(canonicalHistoryHash(b, 2)).toBe(canonicalHistoryHash(a, 2));
    expect(canonicalHistoryHash(b, 1)).toBe(canonicalHistoryHash(a, 1));
  });
});

describe('historyHashSchemeOf', () => {
  it('reads a record without the field as scheme 1 and accepts the named schemes', () => {
    expect(historyHashSchemeOf({})).toBe(1);
    expect(historyHashSchemeOf({ hashScheme: 1 })).toBe(1);
    expect(historyHashSchemeOf({ hashScheme: 2 })).toBe(2);
  });

  it('refuses a scheme it does not know rather than guessing', () => {
    expect(() => historyHashSchemeOf({ hashScheme: 3 })).toThrow(/unsupported history hash scheme/);
    expect(() => historyHashSchemeOf({ hashScheme: 0 })).toThrow(/unsupported/);
    expect(() => historyHashSchemeOf({ hashScheme: '2' as unknown as number })).toThrow(
      /unsupported/,
    );
  });
});

describe('byte array digest memo', () => {
  afterEach(() => vi.restoreAllMocks());

  it('matches SHA-256 and is computed once per buffer', () => {
    const t = tile(21, 1).pixels;
    expect(hasByteArrayDigest(t)).toBe(false);
    const first = byteArrayDigest(t);
    expect(first).toBe(nodeSha(t));
    expect(hasByteArrayDigest(t)).toBe(true);

    const update = vi.spyOn(Sha256Stream.prototype, 'update');
    expect(byteArrayDigest(t)).toBe(first);
    expect(update).not.toHaveBeenCalled();
  });

  it('keys by buffer object: an equal copy is a different, independently hashed buffer', () => {
    const t = tile(22, 1).pixels;
    const copy = new Uint8ClampedArray(t);
    byteArrayDigest(t);
    expect(hasByteArrayDigest(copy)).toBe(false);
    expect(byteArrayDigest(copy)).toBe(byteArrayDigest(t));
  });

  it('hashes a view over part of a buffer by the bytes the view covers', () => {
    const backing = new Uint8Array(1000).map((_, i) => i % 251);
    const view = backing.subarray(100, 612);
    expect(byteArrayDigest(view)).toBe(nodeSha(backing.slice(100, 612)));
    const clampedView = new Uint8ClampedArray(backing.buffer, 100, 512);
    expect(byteArrayDigest(clampedView)).toBe(byteArrayDigest(view));
  });

  it('makes re-hashing an edited document cost the changed tile, not the layer', () => {
    const tiles = new Map<string, RasterTile>();
    for (let i = 0; i < 32; i++) tiles.set(`${i}:0`, tile(100 + i, 1));
    const before = withTiles(tiles, 32 * TILE_SIZE);
    const layerBytes = 32 * TILE_SIZE * TILE_SIZE * 4;

    // Count real work by wrapping rather than replacing the prototype method.
    const original = Sha256Stream.prototype.update;
    let counted = 0;
    Sha256Stream.prototype.update = function (
      this: Sha256Stream,
      data,
      start = 0,
      end = data.length,
    ) {
      counted += end - start;
      return original.call(this, data, start, end);
    };
    try {
      const cold = canonicalHistoryHash(before);
      const coldBytes = counted;
      expect(coldBytes).toBeGreaterThan(layerBytes);

      counted = 0;
      expect(canonicalHistoryHash(before)).toBe(cold);
      expect(counted).toBeLessThan(layerBytes / 20);

      // One stroke: a single tile replaced, 31 shared by reference.
      const edited = new Map(tiles);
      const touched = tiles.get('7:0')!;
      const pixels = new Uint8ClampedArray(touched.pixels);
      pixels[777] = pixels[777]! ^ 0xff;
      edited.set('7:0', { pixels, version: touched.version + 1 });
      const after = withTiles(edited, 32 * TILE_SIZE);
      counted = 0;
      const afterHash = canonicalHistoryHash(after);
      expect(afterHash).not.toBe(cold);
      // The one new tile (65536 bytes) plus the small document text; nowhere
      // near the 2 MiB of the whole layer.
      expect(counted).toBeLessThan(layerBytes / 8);
      expect(counted).toBeGreaterThanOrEqual(pixels.length);

      // Scheme 1 has no such shortcut: it re-spells every byte every time.
      counted = 0;
      canonicalHistoryHash(after, 1);
      expect(counted).toBeGreaterThan(layerBytes);
    } finally {
      Sha256Stream.prototype.update = original;
    }
  });
});

describe('published tile buffers are never written (the contract the memo relies on)', () => {
  const dab: BrushDab = {
    x: 60,
    y: 60,
    radius: 30,
    opacity: 1,
    flow: 1,
    hardness: 0.5,
    angle: 0,
    roundness: 1,
    strokeT: 0,
    strokeDistance: 0,
  };

  /** Every tile buffer of `node` still hashes to the digest it was memoized under. */
  function expectBuffersUnwritten(node: RasterLayerNode, digests: Map<string, string>): void {
    for (const [key, t] of node.tiles) {
      expect(sha256Hex(new Uint8Array(t.pixels)), `tile ${key}`).toBe(digests.get(key));
      expect(byteArrayDigest(t.pixels), `memo ${key}`).toBe(digests.get(key));
    }
  }

  function seededLayer(): RasterLayerNode {
    return layerOf(rasterDocument());
  }

  const operations: Array<[string, (node: RasterLayerNode) => RasterLayerNode]> = [
    ['compositeDabOnNode', (n) => compositeDabOnNode(n, dab, [200, 40, 20, 255])],
    ['eraseDabOnNode', (n) => eraseDabOnNode(n, dab)],
    ['compositeSmudgeDabOnNode', (n) => compositeSmudgeDabOnNode(n, dab, 0.7, 0.8)],
    [
      'fillCoverageOnNode',
      (n) => fillCoverageOnNode(n, makeCoverageMask(10, 10, 200, 100, 255), [10, 220, 30, 200]),
    ],
    [
      'RasterTileDraft (many dabs)',
      (n) => {
        const draft = beginRasterTileDraft(n);
        for (let i = 0; i < 12; i++) draft.compositeDab({ ...dab, x: 40 + i * 12 }, [9, 9, 9, 255]);
        return draft.commit();
      },
    ],
  ];

  for (const [name, apply] of operations) {
    it(`${name} leaves the input's memoized buffers intact and the output hash correct`, () => {
      const input = seededLayer();
      const digests = new Map<string, string>();
      for (const [key, t] of input.tiles) digests.set(key, byteArrayDigest(t.pixels));

      const output = apply(input);

      expectBuffersUnwritten(input, digests);
      // A warm hash of the output (shared tiles memoized, new tiles fresh)
      // equals a hash of the same document rebuilt from independent copies.
      const warm = canonicalHistoryHash(withTiles(output.tiles));
      const cold = canonicalHistoryHash(
        withTiles(
          new Map(
            [...output.tiles].map(([key, t]) => [
              key,
              { pixels: new Uint8ClampedArray(t.pixels), version: t.version },
            ]),
          ),
        ),
      );
      expect(warm).toBe(cold);
      expect(output).not.toBe(input);
    });
  }
});
