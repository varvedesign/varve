/**
 * Dual-scheme verification (ADR-0241 D4): a history whose records were written
 * before hash scheme 2 existed must still verify, a record must always be
 * judged by the scheme it names, and an unreadable scheme must be refused
 * rather than guessed at.
 */
import type { BrushDab, Document, RasterLayerNode } from '@varve/scene';
import {
  canonicalHistoryHash,
  compositeDabOnNode,
  createDocument,
  DocumentCodec,
  makeRasterLayerNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { diffDocuments } from '../diff';
import { captureRasterTileDeltas, RASTER_DELTA_OPERATION } from '../rasterDelta';
import { MemoryRasterTileStore } from '../rasterTileStore';
import { validateHistory } from '../recovery';
import { loadDocumentAt, ReplayError, replayAndVerify, revisionHashScheme } from '../replay';
import { buildRevision, createGenesisRevision } from '../revisions';
import { type SnapshotRecord, snapshotToDocument } from '../snapshots';
import { createMemoryHistoryStore } from '../store';
import type { RevisionRecord, StoredOperation } from '../types';

const DOC_ID = 'hash-scheme-compat';
const AUTHOR = { actorId: 'test', kind: 'local-user' as const };

function dab(x: number, y: number): BrushDab {
  return {
    x,
    y,
    radius: 14,
    opacity: 0.9,
    flow: 0.8,
    hardness: 0.6,
    angle: 0,
    roundness: 1,
    strokeT: 0,
    strokeDistance: 0,
  };
}

function paintedDocument(): Document {
  let layer: RasterLayerNode = makeRasterLayerNode('raster', { width: 256, height: 128 });
  layer = compositeDabOnNode(layer, dab(40, 40), [210, 60, 30, 255]);
  layer = compositeDabOnNode(layer, dab(180, 70), [30, 90, 210, 255]);
  return {
    ...createDocument(DOC_ID, { flat: true }),
    id: DOC_ID,
    nodes: { raster: layer },
    rootChildren: ['raster'],
  } as Document;
}

function strokeOn(doc: Document, x: number, y: number): Document {
  const layer = doc.nodes.raster as RasterLayerNode;
  return {
    ...doc,
    nodes: { ...doc.nodes, raster: compositeDabOnNode(layer, dab(x, y), [20, 160, 80, 255]) },
  };
}

/** A revision and snapshot exactly as the writer before scheme 2 produced them. */
async function seedLegacyGenesis(
  store: ReturnType<typeof createMemoryHistoryStore>,
  document: Document,
): Promise<RevisionRecord> {
  const hash = canonicalHistoryHash(document, 1);
  const snapshot: SnapshotRecord = {
    canonicalHash: hash,
    documentId: DOC_ID,
    canonicalText: DocumentCodec.encode(document),
    encoding: 'document-codec',
    revisionId: 'r-legacy',
    schemaVersion: 1,
    createdAt: 1,
  };
  expect('hashScheme' in snapshot).toBe(false);
  await store.putSnapshot(snapshot);
  const revision: RevisionRecord = {
    revisionId: 'r-legacy',
    documentId: DOC_ID,
    parentRevisionIds: [],
    canonicalDocumentHash: hash,
    snapshotId: hash,
    author: AUTHOR,
    semanticSummary: { label: 'Genesis', kind: 'admin', affectedEntityIds: [] },
    createdAt: 1,
    schemaVersion: 1,
    origin: 'migration',
  };
  expect('hashScheme' in revision).toBe(false);
  await store.commitRevision({
    revision,
    createBranch: {
      branchId: 'b-main',
      documentId: DOC_ID,
      name: 'main',
      headRevisionId: revision.revisionId,
      createdFromRevisionId: revision.revisionId,
      createdAt: 1,
      updatedAt: 1,
      status: 'active',
    },
  });
  return revision;
}

describe('revisions and snapshots written now', () => {
  it('name scheme 2 and verify by replay', async () => {
    const store = createMemoryHistoryStore();
    const tiles = new MemoryRasterTileStore();
    const document = paintedDocument();
    const { genesis } = await createGenesisRevision(store, document, {
      documentId: DOC_ID,
      author: AUTHOR,
      rasterTileStore: tiles,
    });

    expect(genesis.hashScheme).toBe(2);
    expect(genesis.canonicalDocumentHash).toBe(canonicalHistoryHash(document, 2));
    const snapshot = await store.getSnapshot(DOC_ID, genesis.snapshotId!);
    expect(snapshot?.hashScheme).toBe(2);
    expect((await replayAndVerify(store, DOC_ID, genesis.revisionId, tiles)).verified).toBe(true);
    expect(await validateHistory(store, DOC_ID, { rasterTileStore: tiles })).toEqual([]);
  });
});

describe('records written before scheme 2', () => {
  it('still verify, load, and validate with no hashScheme field', async () => {
    const store = createMemoryHistoryStore();
    const tiles = new MemoryRasterTileStore();
    const document = paintedDocument();
    const legacy = await seedLegacyGenesis(store, document);

    expect(revisionHashScheme(legacy)).toBe(1);
    const result = await replayAndVerify(store, DOC_ID, legacy.revisionId, tiles);
    expect(result.verified).toBe(true);
    expect(result.expectedHash).toBe(canonicalHistoryHash(document, 1));

    const loaded = await loadDocumentAt(store, DOC_ID, legacy.revisionId, tiles);
    expect(canonicalHistoryHash(loaded, 1)).toBe(legacy.canonicalDocumentHash);
    expect(await validateHistory(store, DOC_ID, { rasterTileStore: tiles })).toEqual([]);
  });

  it('are judged by their own scheme even when a scheme-2 revision follows them', async () => {
    const store = createMemoryHistoryStore();
    const tiles = new MemoryRasterTileStore();
    const before = paintedDocument();
    const legacy = await seedLegacyGenesis(store, before);
    const after = strokeOn(before, 100, 90);

    const capture = await captureRasterTileDeltas(before, after, 'tx-mixed', {
      beforeHash: canonicalHistoryHash(before, 1),
      afterHash: canonicalHistoryHash(after, 2),
    });
    await tiles.putBatch(capture.entries);
    const operation: StoredOperation = {
      operationId: 'op-mixed',
      operationType: RASTER_DELTA_OPERATION,
      schemaVersion: 1,
      logicalSequence: 0,
      affectedEntityIds: ['raster'],
      payload: capture.payload!,
    };
    const start = await store.appendOperations(DOC_ID, [operation]);
    const next = buildRevision({
      document: after,
      documentId: DOC_ID,
      parentRevisionIds: [legacy.revisionId],
      author: AUTHOR,
      origin: 'edit',
      semanticSummary: { label: 'Paint', kind: 'modify', affectedEntityIds: ['raster'] },
      operationStart: start,
      operationEnd: { segment: start.segment, offset: start.offset + 1 },
    });
    await store.putRevision(next);

    expect(next.hashScheme).toBe(2);
    // The two records disagree about the same lineage's hash form, and each is
    // right under its own scheme.
    expect((await replayAndVerify(store, DOC_ID, legacy.revisionId, tiles)).verified).toBe(true);
    const replayed = await replayAndVerify(store, DOC_ID, next.revisionId, tiles);
    expect(replayed.verified).toBe(true);
    expect(replayed.replayedFromRevisionId).toBe(legacy.revisionId);
    expect(replayed.appliedOperationCount).toBe(1);
    // The legacy record was not rewritten.
    const stored = await store.getRevision(DOC_ID, legacy.revisionId);
    expect(stored?.hashScheme).toBeUndefined();
    expect(stored?.canonicalDocumentHash).toBe(canonicalHistoryHash(before, 1));
  });
});

describe('a record is judged by the scheme it names', () => {
  it('rejects a revision whose hash belongs to the other scheme', async () => {
    const store = createMemoryHistoryStore();
    const tiles = new MemoryRasterTileStore();
    const document = paintedDocument();
    const { genesis } = await createGenesisRevision(store, document, {
      documentId: DOC_ID,
      author: AUTHOR,
      rasterTileStore: tiles,
    });

    // A scheme-2 hash presented as scheme 1 must not verify.
    await store.putRevision({ ...genesis, hashScheme: 1 });
    const mislabeled = await replayAndVerify(store, DOC_ID, genesis.revisionId, tiles).catch(
      (error: unknown) => error,
    );
    // Either the snapshot refuses to decode or the hash comparison fails; both
    // are a refusal, never a pass.
    if (mislabeled instanceof Error) {
      expect(mislabeled.message).toMatch(/hash mismatch|snapshot/);
    } else {
      expect((mislabeled as { verified: boolean }).verified).toBe(false);
    }
  });

  it('rejects a legacy snapshot relabelled as scheme 2, and the reverse', async () => {
    const store = createMemoryHistoryStore();
    const document = paintedDocument();
    const legacy = await seedLegacyGenesis(store, document);
    const snapshot = (await store.getSnapshot(DOC_ID, legacy.snapshotId!))!;

    expect(snapshotToDocument(snapshot)).toBeTruthy();
    expect(() => snapshotToDocument({ ...snapshot, hashScheme: 2 })).toThrow(
      /snapshot canonical hash mismatch/,
    );
    expect(() => snapshotToDocument({ ...snapshot, hashScheme: 1 })).not.toThrow();

    const current: SnapshotRecord = {
      ...snapshot,
      canonicalHash: canonicalHistoryHash(document, 2),
      hashScheme: 2,
    };
    expect(snapshotToDocument(current)).toBeTruthy();
    expect(() => snapshotToDocument({ ...current, hashScheme: 1 })).toThrow(
      /snapshot canonical hash mismatch/,
    );
  });

  it('refuses a scheme it does not know instead of guessing', async () => {
    const store = createMemoryHistoryStore();
    const tiles = new MemoryRasterTileStore();
    const { genesis } = await createGenesisRevision(store, paintedDocument(), {
      documentId: DOC_ID,
      author: AUTHOR,
      rasterTileStore: tiles,
    });
    const future = { ...genesis, hashScheme: 3 } as unknown as RevisionRecord;
    await store.putRevision(future);

    expect(() => revisionHashScheme(future)).toThrow(ReplayError);
    await expect(replayAndVerify(store, DOC_ID, genesis.revisionId, tiles)).rejects.toMatchObject({
      code: 'replay.unknown-hash-scheme',
    });

    const snapshot = (await store.getSnapshot(DOC_ID, genesis.snapshotId!))!;
    expect(() =>
      snapshotToDocument({ ...snapshot, hashScheme: 3 } as unknown as SnapshotRecord),
    ).toThrow(/unsupported history hash scheme/);
  });
});

describe('diffDocuments hash scheme', () => {
  it('hashes both sides under the requested scheme, defaulting to the current one', () => {
    const base = paintedDocument();
    const target = strokeOn(base, 90, 100);

    const current = diffDocuments(base, target, { epsilonPolicy: 'exact' });
    expect(current.baseHash).toBe(canonicalHistoryHash(base, 2));
    expect(current.targetHash).toBe(canonicalHistoryHash(target, 2));

    const legacy = diffDocuments(base, target, { epsilonPolicy: 'exact', hashScheme: 1 });
    expect(legacy.baseHash).toBe(canonicalHistoryHash(base, 1));
    expect(legacy.targetHash).toBe(canonicalHistoryHash(target, 1));
    expect(legacy.baseHash).not.toBe(current.baseHash);
  });

  it('reports no change for identical documents under either scheme', () => {
    const base = paintedDocument();
    const same = { ...base, nodes: { ...base.nodes } } as Document;
    expect(diffDocuments(base, same, { hashScheme: 1 }).changed).toBe(false);
    expect(diffDocuments(base, same, { hashScheme: 2 }).changed).toBe(false);
  });
});
