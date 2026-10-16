/**
 * Whole-document canonical hashing is proportional to raster bytes, so the
 * number of passes a history capture makes is a user-visible cost. These tests
 * pin the pass count and, separately, that the exactness guarantees the saved
 * hash economy must not weaken (replay-verified capture, exact undo/redo,
 * fallback to the hash oracle when identity cannot be proven) still hold.
 */
import {
  createMemoryHistoryStore,
  MemoryRasterTileStore,
  type RasterTileStore,
} from '@varve/history';
import type { Document, RasterLayerNode, RasterTile } from '@varve/scene';
import {
  addNode,
  beginRasterTileDraft,
  createDocument,
  makeRasterLayerNode,
  makeShapeNode,
  registerBuiltinOperations,
  TILE_SIZE,
} from '@varve/scene';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hashCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock('@varve/scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@varve/scene')>();
  return {
    ...actual,
    canonicalHistoryHash: (doc: Parameters<typeof actual.canonicalHistoryHash>[0]) => {
      hashCalls.count += 1;
      return actual.canonicalHistoryHash(doc);
    },
  };
});

// Imported after the mock is registered so the session binds the counting wrapper.
const { EditorHistorySession } = await import('../editorHistorySession');
const scene = await import('@varve/scene');

registerBuiltinOperations();

const DOC_ID = 'hash-economy-doc';

function noiseTile(seed: number): RasterTile {
  const pixels = new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
  let s = Math.imul(seed + 7, 2654435761) >>> 0;
  for (let i = 0; i < pixels.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    pixels[i] = s >>> 24;
  }
  return { pixels, version: 1 };
}

function rasterDocument(): Document {
  const tiles = new Map<string, RasterTile>();
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) tiles.set(`${c}:${r}`, noiseTile(r * 3 + c));
  }
  const layer: RasterLayerNode = {
    ...makeRasterLayerNode('rl_econ', { width: 3 * TILE_SIZE, height: 2 * TILE_SIZE }),
    tiles,
  };
  const base = { ...createDocument(DOC_ID, { flat: true }), id: DOC_ID } as Document;
  const withShape = addNode(
    base,
    makeShapeNode('n1_aaaa', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
  );
  return addNode(withShape, layer);
}

function paint(doc: Document, x: number, y: number, dabs = 6): Document {
  const draft = beginRasterTileDraft(doc.nodes.rl_econ as RasterLayerNode);
  for (let i = 0; i < dabs; i++) {
    draft.compositeDab(
      {
        x: x + i * 2,
        y,
        radius: 12,
        opacity: 1,
        flow: 1,
        hardness: 0.7,
        angle: 0,
        roundness: 1,
        strokeT: 0,
        strokeDistance: 0,
      },
      [200, 30, 30, 255],
    );
  }
  return { ...doc, nodes: { ...doc.nodes, rl_econ: draft.commit() } };
}

function newSession(rasterTileStore: RasterTileStore) {
  return new EditorHistorySession({
    store: createMemoryHistoryStore(),
    documentId: DOC_ID,
    authorActorId: 'tester',
    rasterTileStore,
  });
}

describe('history capture hash economy', () => {
  beforeEach(() => {
    hashCalls.count = 0;
  });

  it('hashes the document once per captured raster stroke, not three times', async () => {
    const session = newSession(new MemoryRasterTileStore());
    let doc = rasterDocument();
    await session.attach(doc);

    for (let stroke = 0; stroke < 3; stroke++) {
      const next = paint(doc, 40 + stroke * 30, 40);
      hashCalls.count = 0;
      const revision = await session.capture(doc, next, [], { label: 'Paint', kind: 'modify' });
      expect(revision, `stroke ${stroke}`).not.toBeNull();
      // One pass: the target document. The base digest is the head's recorded
      // digest and the replay is proven identical to the target structurally.
      expect(hashCalls.count, `hash passes for stroke ${stroke}`).toBe(1);
      doc = next;
    }
  });

  it('still falls back to hashing the base when the before-document is not the head object', async () => {
    const session = newSession(new MemoryRasterTileStore());
    const doc = rasterDocument();
    await session.attach(doc);

    // Structurally equal but a different object: identity cannot be proven.
    const stranger = { ...doc, nodes: { ...doc.nodes } } as Document;
    const next = paint(stranger, 50, 50);
    hashCalls.count = 0;
    const revision = await session.capture(stranger, next, [], { label: 'Paint', kind: 'modify' });
    expect(revision).not.toBeNull();
    expect(hashCalls.count).toBe(2); // base + target; replay still proven identical
  });

  it('keeps undo and redo exact after economised captures', async () => {
    const tiles = new MemoryRasterTileStore();
    const session = newSession(tiles);
    const original = rasterDocument();
    await session.attach(original);

    const one = paint(original, 40, 40);
    const two = paint(one, 90, 60);
    await session.capture(original, one, [], { label: 'Stroke 1', kind: 'modify' });
    await session.capture(one, two, [], { label: 'Stroke 2', kind: 'modify' });

    const hash = scene.canonicalHistoryHash;
    const undone = await session.undo();
    expect(undone && hash(undone.document)).toBe(hash(one));
    const undoneAgain = await session.undo();
    expect(undoneAgain && hash(undoneAgain.document)).toBe(hash(original));
    const redone = await session.redo();
    expect(redone && hash(redone.document)).toBe(hash(one));
    const redoneAgain = await session.redo();
    expect(redoneAgain && hash(redoneAgain.document)).toBe(hash(two));
  });

  it('records the same digest the unoptimised whole-document hash produces', async () => {
    const store = createMemoryHistoryStore();
    const session = new EditorHistorySession({
      store,
      documentId: DOC_ID,
      authorActorId: 'tester',
      rasterTileStore: new MemoryRasterTileStore(),
    });
    const original = rasterDocument();
    await session.attach(original);
    const next = paint(original, 70, 70);
    const revision = await session.capture(original, next, [], { label: 'Paint', kind: 'modify' });

    const legacy = scene.canonicalizeDocument(next, { excludeVolatile: true });
    expect(revision?.canonicalDocumentHash).toBe(scene.sha256Utf8(legacy));
  });
});
