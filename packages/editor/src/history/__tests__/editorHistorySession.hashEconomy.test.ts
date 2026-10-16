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
  replayAndVerify,
} from '@varve/history';
import type { Document, HistoryHashScheme, RasterLayerNode, RasterTile } from '@varve/scene';
import {
  addNode,
  beginRasterTileDraft,
  createDocument,
  DocumentCodec,
  makeRasterLayerNode,
  makeShapeNode,
  registerBuiltinOperations,
  Sha256Stream,
  TILE_SIZE,
} from '@varve/scene';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hashCalls = vi.hoisted(() => ({ count: 0, schemes: [] as Array<number | undefined> }));

vi.mock('@varve/scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@varve/scene')>();
  return {
    ...actual,
    canonicalHistoryHash: (
      doc: Parameters<typeof actual.canonicalHistoryHash>[0],
      scheme?: Parameters<typeof actual.canonicalHistoryHash>[1],
    ) => {
      hashCalls.count += 1;
      hashCalls.schemes.push(scheme);
      return actual.canonicalHistoryHash(doc, scheme);
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

function newSessionOn(
  store: ReturnType<typeof createMemoryHistoryStore>,
  rasterTileStore: RasterTileStore,
) {
  return new EditorHistorySession({
    store,
    documentId: DOC_ID,
    authorActorId: 'tester',
    rasterTileStore,
  });
}

function newSession(rasterTileStore: RasterTileStore) {
  return newSessionOn(createMemoryHistoryStore(), rasterTileStore);
}

describe('history capture hash economy', () => {
  beforeEach(() => {
    hashCalls.count = 0;
    hashCalls.schemes = [];
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

  it('records the digest of the independently built scheme-2 canonical text', async () => {
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

    const text = scene.canonicalizeDocument(next, { excludeVolatile: true, byteArrays: 'digest' });
    expect(revision?.hashScheme).toBe(2);
    expect(revision?.canonicalDocumentHash).toBe(scene.sha256Utf8(text));
  });
});

/** Genesis exactly as the writer before hash scheme 2 produced it (no `hashScheme`). */
async function seedLegacyHistory(
  store: ReturnType<typeof createMemoryHistoryStore>,
  document: Document,
) {
  const hash = scene.canonicalHistoryHash(document, 1);
  await store.putSnapshot({
    canonicalHash: hash,
    documentId: DOC_ID,
    canonicalText: DocumentCodec.encode(document),
    encoding: 'document-codec',
    revisionId: 'r-legacy',
    schemaVersion: 1,
    createdAt: 1,
  });
  const revision = {
    revisionId: 'r-legacy',
    documentId: DOC_ID,
    parentRevisionIds: [],
    canonicalDocumentHash: hash,
    snapshotId: hash,
    author: { actorId: 'tester', kind: 'local-user' as const },
    semanticSummary: { label: 'Genesis', kind: 'admin' as const, affectedEntityIds: [] },
    createdAt: 1,
    schemaVersion: 1,
    origin: 'migration' as const,
  };
  await store.commitRevision({
    revision,
    createBranch: {
      branchId: 'b-main',
      documentId: DOC_ID,
      name: 'main',
      headRevisionId: 'r-legacy',
      createdFromRevisionId: 'r-legacy',
      createdAt: 1,
      updatedAt: 1,
      status: 'active',
    },
  });
  return revision;
}

describe('history written under hash scheme 1', () => {
  beforeEach(() => {
    hashCalls.count = 0;
    hashCalls.schemes = [];
  });

  it('attaches without inventing a revision, then continues in scheme 2 with one base pass', async () => {
    const store = createMemoryHistoryStore();
    const tiles = new MemoryRasterTileStore();
    const original = rasterDocument();
    const legacy = await seedLegacyHistory(store, original);
    const session = newSessionOn(store, tiles);

    await session.attach(original);
    // The working document matches the scheme-1 head, so nothing is reconciled.
    expect(await store.listRevisions(DOC_ID)).toHaveLength(1);

    const one = paint(original, 40, 40);
    hashCalls.count = 0;
    hashCalls.schemes = [];
    const first = await session.capture(original, one, [], { label: 'Stroke 1', kind: 'modify' });
    expect(first?.hashScheme).toBe(2);
    // The head's recorded digest is scheme 1, so the base is hashed afresh under
    // scheme 2 (once); the target is the second pass.
    expect(hashCalls.count).toBe(2);
    // An omitted scheme means the current one (2).
    expect(hashCalls.schemes.map((scheme) => scheme ?? 2)).toEqual([2, 2]);

    const two = paint(one, 90, 60);
    hashCalls.count = 0;
    const second = await session.capture(one, two, [], { label: 'Stroke 2', kind: 'modify' });
    expect(second?.hashScheme).toBe(2);
    // The previous capture left a scheme-2 head: its digest is reusable.
    expect(hashCalls.count).toBe(1);

    // Every revision verifies under its own scheme; the legacy record is untouched.
    expect(await store.getRevision(DOC_ID, 'r-legacy')).toEqual(legacy);
    for (const revision of await store.listRevisions(DOC_ID)) {
      const result = await replayAndVerify(store, DOC_ID, revision.revisionId, tiles);
      expect(result.verified, revision.revisionId).toBe(true);
    }

    // Undo and redo walk across the scheme boundary exactly.
    const hash = (doc: Document, scheme: HistoryHashScheme) =>
      scene.canonicalHistoryHash(doc, scheme);
    const undone = await session.undo();
    expect(undone && hash(undone.document, 2)).toBe(hash(one, 2));
    const undoneAgain = await session.undo();
    expect(undoneAgain && hash(undoneAgain.document, 1)).toBe(hash(original, 1));
    const redone = await session.redo();
    expect(redone && hash(redone.document, 2)).toBe(hash(one, 2));
  });

  it('reattaches a mixed-scheme history in a new session without reconciling', async () => {
    const store = createMemoryHistoryStore();
    const tiles = new MemoryRasterTileStore();
    const original = rasterDocument();
    await seedLegacyHistory(store, original);
    const first = newSessionOn(store, tiles);
    await first.attach(original);
    const one = paint(original, 40, 40);
    await first.capture(original, one, [], { label: 'Stroke 1', kind: 'modify' });

    const reloaded = newSessionOn(store, tiles);
    await reloaded.attach(one);
    expect(await store.listRevisions(DOC_ID)).toHaveLength(2);
  });
});

describe('hash scheme 2 capture cost', () => {
  it('hashes bytes proportional to the touched tiles, not the layer', async () => {
    const tiles = new Map<string, RasterTile>();
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) tiles.set(`${c}:${r}`, noiseTile(r * 8 + c));
    const layer: RasterLayerNode = {
      ...makeRasterLayerNode('rl_econ', { width: 8 * TILE_SIZE, height: 8 * TILE_SIZE }),
      tiles,
    };
    const base = { ...createDocument(DOC_ID, { flat: true }), id: DOC_ID } as Document;
    let doc = addNode(base, layer);
    const layerBytes = 64 * TILE_SIZE * TILE_SIZE * 4;

    const session = newSession(new MemoryRasterTileStore());
    await session.attach(doc);

    const original = Sha256Stream.prototype.update;
    let hashed = 0;
    Sha256Stream.prototype.update = function (
      this: Sha256Stream,
      data,
      start = 0,
      end = data.length,
    ) {
      hashed += end - start;
      return original.call(this, data, start, end);
    };
    try {
      for (let stroke = 0; stroke < 3; stroke++) {
        const next = paint(doc, 40 + stroke * 30, 40);
        hashed = 0;
        const revision = await session.capture(doc, next, [], { label: 'Paint', kind: 'modify' });
        expect(revision, `stroke ${stroke}`).not.toBeNull();
        // One touched tile is hashed a handful of times (document digest, store
        // verification of the before and after copies, replay verification).
        // The other 63 tiles contribute nothing.
        expect(hashed, `bytes hashed by stroke ${stroke}`).toBeLessThan(layerBytes / 6);
        expect(hashed).toBeGreaterThan(TILE_SIZE * TILE_SIZE * 4);
        doc = next;
      }
    } finally {
      Sha256Stream.prototype.update = original;
    }
  });
});
