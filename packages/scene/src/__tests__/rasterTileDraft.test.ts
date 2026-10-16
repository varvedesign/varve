import { describe, expect, it } from 'vitest';
import { makeCoverageMask } from '../paintCoverage';
import {
  type BrushDab,
  beginRasterTileDraft,
  compositeDabOnNode,
  eraseDabOnNode,
  makeRasterLayerNode,
  makeTileKey,
  TILE_SIZE,
} from '../rasterLayer';
import { createStrokeOpacityAccumulator } from '../strokeOpacity';
import type { RasterLayerNode, RasterTile } from '../types';

const COLOR: [number, number, number, number] = [210, 60, 30, 255];

function dab(x: number, y: number, over: Partial<BrushDab> = {}): BrushDab {
  return {
    x,
    y,
    radius: 20,
    opacity: 0.8,
    flow: 0.9,
    hardness: 0.6,
    angle: 0,
    roundness: 1,
    strokeT: 0,
    strokeDistance: 0,
    ...over,
  };
}

/** Deterministic 32-bit PRNG so failures reproduce from the seed alone. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function seededTile(seed: number): RasterTile {
  const next = rng(seed);
  const pixels = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
  for (let i = 0; i < pixels.length; i++) pixels[i] = Math.floor(next() * 256);
  return { pixels, version: 3 };
}

function layerWithTiles(cols: number, rows: number, populated: ReadonlyArray<string>) {
  const base = makeRasterLayerNode('rl', { width: cols * TILE_SIZE, height: rows * TILE_SIZE });
  const tiles = new Map<string, RasterTile>();
  for (const [i, key] of populated.entries()) tiles.set(key, seededTile(i + 11));
  return { ...base, tiles } as RasterLayerNode;
}

function snapshotBytes(node: RasterLayerNode): Map<string, { bytes: number[]; version: number }> {
  const out = new Map<string, { bytes: number[]; version: number }>();
  for (const [key, tile] of node.tiles) {
    out.set(key, { bytes: Array.from(tile.pixels), version: tile.version });
  }
  return out;
}

function expectSameTiles(actual: RasterLayerNode, expected: RasterLayerNode): void {
  expect([...actual.tiles.keys()].sort()).toEqual([...expected.tiles.keys()].sort());
  for (const [key, want] of expected.tiles) {
    const got = actual.tiles.get(key)!;
    expect(got.version, `version of tile ${key}`).toBe(want.version);
    expect(got.pixels.length).toBe(want.pixels.length);
    // Typed-array equality, not toEqual on 64K-element arrays per tile.
    let equal = true;
    for (let i = 0; i < want.pixels.length; i++) {
      if (got.pixels[i] !== want.pixels[i]) {
        equal = false;
        break;
      }
    }
    expect(equal, `pixels of tile ${key}`).toBe(true);
  }
}

/** The per-dab path: every dab is its own draft (Map copy + tile clone each). */
function perDabComposite(
  node: RasterLayerNode,
  dabs: readonly BrushDab[],
  options: (i: number) => Parameters<typeof compositeDabOnNode>[3],
): RasterLayerNode {
  let n = node;
  dabs.forEach((d, i) => {
    n = compositeDabOnNode(n, d, COLOR, options(i));
  });
  return n;
}

function strokeDabs(seed: number, count: number, spanX: number, spanY: number): BrushDab[] {
  const next = rng(seed);
  const out: BrushDab[] = [];
  let x = next() * spanX;
  let y = next() * spanY;
  for (let i = 0; i < count; i++) {
    x = Math.min(spanX - 1, Math.max(1, x + (next() - 0.5) * 18));
    y = Math.min(spanY - 1, Math.max(1, y + (next() - 0.5) * 18));
    out.push(
      dab(x, y, {
        radius: 2 + next() * 28,
        hardness: next(),
        opacity: 0.2 + next() * 0.8,
        flow: 0.3 + next() * 0.7,
        strokeT: i / count,
        strokeDistance: i * 3,
      }),
    );
  }
  return out;
}

describe('RasterTileDraft', () => {
  it('matches the per-dab path exactly (pixels and versions) across random strokes', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const populated = seed % 2 === 0 ? ['0:0', '1:0', '0:1'] : [];
      const base = layerWithTiles(3, 3, populated);
      const dabs = strokeDabs(seed, 40, 3 * TILE_SIZE, 3 * TILE_SIZE);

      const expected = perDabComposite(base, dabs, () => false);

      const draft = beginRasterTileDraft(base);
      for (const d of dabs) draft.compositeDab(d, COLOR, false);
      const actual = draft.commit();

      expectSameTiles(actual, expected);
    }
  });

  it('matches the per-dab path with alpha lock, blend modes, selection coverage and stroke opacity', () => {
    const base = layerWithTiles(2, 2, ['0:0', '1:0', '0:1', '1:1']);
    const dabs = strokeDabs(99, 30, 2 * TILE_SIZE, 2 * TILE_SIZE).map((d, i) => ({
      ...d,
      blendMode: i % 3 === 0 ? 'multiply' : i % 3 === 1 ? 'screen' : 'normal',
    }));
    const coverage = makeCoverageMask(10, 10, 2 * TILE_SIZE - 20, 2 * TILE_SIZE - 20, 200);

    for (const alphaLock of [false, true]) {
      // Accumulators are stateful, so each path gets its own identical one.
      const accA = createStrokeOpacityAccumulator(TILE_SIZE * TILE_SIZE);
      const accB = createStrokeOpacityAccumulator(TILE_SIZE * TILE_SIZE);
      const wetEdge = { size: 0.25, darken: 0.2 };

      const expected = perDabComposite(base, dabs, () => ({
        alphaLock,
        coverage,
        wetEdge,
        strokeOpacity: accA,
      }));

      const draft = beginRasterTileDraft(base);
      for (const d of dabs) {
        draft.compositeDab(d, COLOR, { alphaLock, coverage, wetEdge, strokeOpacity: accB });
      }
      expectSameTiles(draft.commit(), expected);
      expect(accB.tiles.size).toBe(accA.tiles.size);
    }
  });

  it('matches the per-dab path for erase and mixed paint/erase batches', () => {
    const base = layerWithTiles(2, 2, ['0:0', '1:0', '0:1', '1:1']);
    const dabs = strokeDabs(7, 24, 2 * TILE_SIZE, 2 * TILE_SIZE);

    let expected = base;
    dabs.forEach((d, i) => {
      expected =
        i % 4 === 3 ? eraseDabOnNode(expected, d, false) : compositeDabOnNode(expected, d, COLOR);
    });

    const draft = beginRasterTileDraft(base);
    dabs.forEach((d, i) => {
      if (i % 4 === 3) draft.eraseDab(d, false);
      else draft.compositeDab(d, COLOR);
    });
    expectSameTiles(draft.commit(), expected);
  });

  it('clones each touched tile once, however many dabs land on it', () => {
    const base = layerWithTiles(2, 2, ['0:0', '1:0', '0:1', '1:1']);
    // 32 dabs straddling the four-tile corner at (128, 128).
    const dabs = Array.from({ length: 32 }, (_, i) =>
      dab(TILE_SIZE - 6 + (i % 8), TILE_SIZE - 6 + Math.floor(i / 8), { radius: 10 }),
    );

    const draft = beginRasterTileDraft(base);
    for (const d of dabs) draft.compositeDab(d, COLOR);
    draft.commit();

    expect(draft.stats.dabs).toBe(32);
    expect(draft.stats.clonedTiles).toBe(4);
    expect(draft.stats.createdTiles).toBe(0);
  });

  it('counts created tiles separately and does not materialise tiles that received nothing', () => {
    const base = layerWithTiles(2, 2, []);
    const draft = beginRasterTileDraft(base);
    draft.compositeDab(dab(40, 40), COLOR);
    // A fully transparent source colour deposits nothing onto an absent tile.
    draft.compositeDab(dab(TILE_SIZE + 40, 40), [10, 10, 10, 0]);
    const out = draft.commit();

    expect(draft.stats.createdTiles).toBe(1);
    expect(out.tiles.has('0:0')).toBe(true);
    expect(out.tiles.has('1:0')).toBe(false);
  });

  it('pins version semantics: new tile starts at 2, existing tiles gain one per dab', () => {
    const fresh = beginRasterTileDraft(layerWithTiles(1, 1, []));
    fresh.compositeDab(dab(30, 30), COLOR);
    fresh.compositeDab(dab(34, 30), COLOR);
    expect(fresh.commit().tiles.get('0:0')!.version).toBe(2 + 1);

    const base = layerWithTiles(1, 1, ['0:0']); // seeded tiles start at version 3
    const draft = beginRasterTileDraft(base);
    for (let i = 0; i < 5; i++) draft.compositeDab(dab(30 + i, 30), COLOR);
    expect(draft.commit().tiles.get('0:0')!.version).toBe(3 + 5);
  });

  it('never writes a published tile: base node, its pixels and untouched tiles stay intact', () => {
    const base = layerWithTiles(3, 1, ['0:0', '1:0', '2:0']);
    const before = snapshotBytes(base);
    const untouched = base.tiles.get('2:0')!;

    const draft = beginRasterTileDraft(base);
    for (let i = 0; i < 20; i++) draft.compositeDab(dab(30 + i * 2, 40), COLOR);
    const out = draft.commit();

    // Base is byte-for-byte what it was, including tile versions.
    for (const [key, snap] of before) {
      const tile = base.tiles.get(key)!;
      expect(tile.version).toBe(snap.version);
      expect(Array.from(tile.pixels)).toEqual(snap.bytes);
    }
    // A tile outside every dab's footprint is shared by reference, not copied.
    expect(out.tiles.get('2:0')).toBe(untouched);
    // A touched tile is a different record with a different buffer.
    expect(out.tiles.get('0:0')).not.toBe(base.tiles.get('0:0'));
    expect(out.tiles.get('0:0')!.pixels).not.toBe(base.tiles.get('0:0')!.pixels);
    expect(out).not.toBe(base);
    expect(out.tiles).not.toBe(base.tiles);
  });

  it('keeps a sibling layer that shares tile records untouched', () => {
    const original = layerWithTiles(1, 1, ['0:0']);
    // A duplicate that shares tile storage by reference, as structural sharing
    // between versions or a copied layer does.
    const sibling: RasterLayerNode = { ...original, id: 'rl-copy', tiles: new Map(original.tiles) };
    const siblingBytes = snapshotBytes(sibling);

    const draft = beginRasterTileDraft(original);
    for (let i = 0; i < 10; i++) draft.compositeDab(dab(30 + i, 30), COLOR);
    const edited = draft.commit();

    expect(Array.from(sibling.tiles.get('0:0')!.pixels)).toEqual(siblingBytes.get('0:0')!.bytes);
    expect(sibling.tiles.get('0:0')!.version).toBe(siblingBytes.get('0:0')!.version);
    expect(edited.tiles.get('0:0')!.pixels).not.toBe(sibling.tiles.get('0:0')!.pixels);
  });

  it('is sealed after commit so published tiles cannot be written through the draft', () => {
    const draft = beginRasterTileDraft(layerWithTiles(1, 1, ['0:0']));
    draft.compositeDab(dab(30, 30), COLOR);
    const out = draft.commit();
    const bytes = Array.from(out.tiles.get('0:0')!.pixels);

    expect(() => draft.compositeDab(dab(31, 30), COLOR)).toThrow(/already committed/);
    expect(() => draft.eraseDab(dab(31, 30))).toThrow(/already committed/);
    expect(() => draft.commit()).toThrow(/already committed/);
    expect(Array.from(out.tiles.get('0:0')!.pixels)).toEqual(bytes);
  });

  it('keeps tile keys canonical', () => {
    const draft = beginRasterTileDraft(layerWithTiles(2, 1, []));
    draft.compositeDab(dab(TILE_SIZE + 5, 5), COLOR);
    expect([...draft.commit().tiles.keys()]).toContain(makeTileKey(1, 0));
  });
});
