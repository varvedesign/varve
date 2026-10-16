/**
 * `strictlyIdentical` is a one-sided oracle: true must imply equal canonical
 * hashes (it lets history capture skip a whole-document hash), false only means
 * "not proven" and is always safe. These tests pin both directions.
 */

import { runInNewContext } from 'node:vm';
import type { Document, RasterLayerNode, RasterTile } from '@varve/scene';
import {
  addNode,
  canonicalHistoryHash,
  createDocument,
  makeRasterLayerNode,
  makeShapeNode,
  TILE_SIZE,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { strictlyIdentical } from '../strictIdentity';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function tile(seed: number): RasterTile {
  const next = rng(seed);
  const pixels = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
  for (let i = 0; i < pixels.length; i++) pixels[i] = Math.floor(next() * 256);
  return { pixels, version: 2 };
}

function documentWithRaster(): Document {
  const tiles = new Map<string, RasterTile>([
    ['0:0', tile(1)],
    ['1:0', tile(2)],
  ]);
  const layer: RasterLayerNode = {
    ...makeRasterLayerNode('rl', { width: 2 * TILE_SIZE, height: TILE_SIZE }),
    tiles,
  };
  const base = { ...createDocument('ident', { flat: true }), id: 'ident' } as Document;
  return addNode(
    addNode(base, makeShapeNode('n1_aaaa', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 })),
    layer,
  );
}

function deepCopy(doc: Document): Document {
  return structuredClone(doc);
}

describe('strictlyIdentical', () => {
  it('is true for the same reference and for a structural deep copy', () => {
    const doc = documentWithRaster();
    expect(strictlyIdentical(doc, doc)).toBe(true);
    const copy = deepCopy(doc);
    expect(copy).not.toBe(doc);
    expect(strictlyIdentical(doc, copy)).toBe(true);
    expect(canonicalHistoryHash(copy)).toBe(canonicalHistoryHash(doc));
  });

  it('detects a single changed tile byte', () => {
    const doc = documentWithRaster();
    const copy = deepCopy(doc);
    const layer = copy.nodes.rl as RasterLayerNode;
    layer.tiles.get('1:0')!.pixels[40_000] = (layer.tiles.get('1:0')!.pixels[40_000]! + 1) & 0xff;
    expect(strictlyIdentical(doc, copy)).toBe(false);
    expect(canonicalHistoryHash(copy)).not.toBe(canonicalHistoryHash(doc));
  });

  it('detects tile version, tile presence, and node property changes', () => {
    const doc = documentWithRaster();

    const versionBump = deepCopy(doc);
    (versionBump.nodes.rl as RasterLayerNode).tiles.get('0:0')!.version += 1;
    expect(strictlyIdentical(doc, versionBump)).toBe(false);

    const missingTile = deepCopy(doc);
    (missingTile.nodes.rl as RasterLayerNode).tiles.delete('1:0');
    expect(strictlyIdentical(doc, missingTile)).toBe(false);

    const patched = deepCopy(doc);
    (patched.nodes.n1_aaaa as unknown as { opacity: number }).opacity = 0.5;
    expect(strictlyIdentical(doc, patched)).toBe(false);

    const reordered = deepCopy(doc);
    reordered.rootChildren = [...reordered.rootChildren].reverse();
    expect(strictlyIdentical(doc, reordered)).toBe(false);
  });

  it('ignores key insertion order and undefined-valued members, as the canonical form does', () => {
    const a = { a: 1, b: { x: 1, y: 2 }, gone: undefined };
    const b = { b: { y: 2, x: 1 }, a: 1 };
    expect(strictlyIdentical(a, b)).toBe(true);
    expect(strictlyIdentical({ a: undefined }, {})).toBe(true);
    expect(strictlyIdentical({ a: 1 }, { a: 1, extra: 0 })).toBe(false);
  });

  it('can disregard named root keys (nextId) without relaxing nested ones', () => {
    const a = { nextId: 1, inner: { nextId: 1 } };
    const b = { nextId: 99, inner: { nextId: 1 } };
    expect(strictlyIdentical(a, b)).toBe(false);
    expect(strictlyIdentical(a, b, { ignoreRootKeys: ['nextId'] })).toBe(true);
    expect(
      strictlyIdentical(a, { nextId: 99, inner: { nextId: 2 } }, { ignoreRootKeys: ['nextId'] }),
    ).toBe(false);
  });

  it('is conservative: a Map is not an object, class instances and unequal types are unproven', () => {
    expect(strictlyIdentical(new Map([['a', 1]]), { a: 1 })).toBe(false);
    expect(strictlyIdentical([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(strictlyIdentical(new Date(0), new Date(0))).toBe(false);
    expect(strictlyIdentical(Number.NaN, Number.NaN)).toBe(false);
    expect(strictlyIdentical(new Uint8Array([1]), new Uint8ClampedArray([1]))).toBe(false);
  });

  it('treats a typed array from another realm as the same bytes', () => {
    const foreign = runInNewContext('new Uint8ClampedArray([1, 2, 255])') as Uint8ClampedArray;
    expect(foreign instanceof Uint8ClampedArray).toBe(false);
    expect(strictlyIdentical({ p: foreign }, { p: new Uint8ClampedArray([1, 2, 255]) })).toBe(true);
    expect(strictlyIdentical({ p: foreign }, { p: new Uint8ClampedArray([1, 2, 254]) })).toBe(
      false,
    );
  });

  it('never reports identical for documents whose canonical hashes differ (randomized)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const next = rng(seed * 31);
      const doc = documentWithRaster();
      const copy = deepCopy(doc);
      const layer = copy.nodes.rl as RasterLayerNode;
      const mutations = Math.floor(next() * 3);
      for (let m = 0; m < mutations; m++) {
        const key = next() < 0.5 ? '0:0' : '1:0';
        const t = layer.tiles.get(key)!;
        t.pixels[Math.floor(next() * t.pixels.length)] = Math.floor(next() * 256);
      }
      const identical = strictlyIdentical(doc, copy);
      const sameHash = canonicalHistoryHash(doc) === canonicalHistoryHash(copy);
      if (identical) expect(sameHash, `seed ${seed}`).toBe(true);
      // Contrapositive: differing hashes can never be reported identical.
      if (!sameHash) expect(identical, `seed ${seed}`).toBe(false);
    }
  });
});
