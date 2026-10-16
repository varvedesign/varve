/**
 * Durable pending-operation queue.
 *
 * The contract: work the host never acknowledged outlives the app session, so
 * the ROOM catches up to the author's own document on the next join. The local
 * document always holds the edit (its history recorded it), so this queue only
 * repairs the room — and every way it can decline to do so is reported rather
 * than silent.
 */
import type { CapturedChange, Document } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  MemoryPendingOperationStore,
  PENDING_LIMITS,
  type PendingOperationRecord,
  prunePendingRecords,
  roomKeyFor,
} from './pendingStore';
import type { RoomOperation } from './protocol';
import { CollabSyncEngine } from './syncEngine';

// ── A tiny document model: property path → value ─────────────────────────────

function makeChange(path: string, before: unknown, after: unknown): CapturedChange {
  return {
    changeType: 'modified',
    entityId: 'n1',
    entityType: 'node',
    propertyPath: path,
    before,
    after,
    summary: `${path} changed`,
  };
}

function makeOperation(
  clientOpId: string,
  changes: CapturedChange[],
  label = 'Edit',
): RoomOperation {
  return {
    clientOpId,
    basedOnSeq: 0,
    actorId: 'placeholder',
    actorName: 'Tester',
    transactionId: `tx-${clientOpId}`,
    label,
    kind: 'modify',
    originAuthor: 'local-user',
    revertsClientOpId: null,
    capture: {
      transactionId: `tx-${clientOpId}`,
      changes,
      summary: { label, affectedEntityIds: ['n1'], kind: 'modify' },
      beforeHash: 'a'.repeat(64),
      afterHash: 'b'.repeat(64),
    },
  };
}

// ── Host + transport (as in syncConflict.test.ts, kept minimal) ──────────────

interface Connection {
  actorId: string | null;
  deliver(message: unknown): void;
}

class Journal {
  readonly ops: RoomOperation[] = [];
  private readonly connections: Array<{ connection: Connection; live: () => boolean }> = [];

  register(connection: Connection, live: () => boolean): void {
    this.connections.push({ connection, live });
  }

  dispatch(sender: Connection, raw: string): void {
    const message = JSON.parse(raw) as { type: string; [key: string]: unknown };
    if (message.type === 'hello') {
      sender.actorId = `actor-${this.connections.length}`;
      sender.deliver({
        type: 'welcome',
        protocol: 1,
        roomSeq: this.ops.length,
        actorId: sender.actorId,
        role: 'editor',
        participants: [],
        snapshot: { uptoSeq: 0, documentJson: '{"id":"d"}' },
        sharedBaselineSeq: 0,
      });
      return;
    }
    if (message.type !== 'operation') return;
    const op = message.op as RoomOperation;
    const existing = this.ops.findIndex((entry) => entry.clientOpId === op.clientOpId);
    if (existing >= 0) {
      sender.deliver({ type: 'operation-accepted', clientOpId: op.clientOpId, seq: existing + 1 });
      return;
    }
    this.ops.push(op);
    const seq = this.ops.length;
    sender.deliver({ type: 'operation-accepted', clientOpId: op.clientOpId, seq });
    for (const entry of this.connections) {
      if (entry.connection === sender) continue;
      if (!entry.live()) continue;
      entry.connection.deliver({ type: 'operation', seq, op });
    }
  }
}

function makeTransport(journal: Journal) {
  const state = {
    connected: true,
    openHandlers: [] as Array<() => void>,
    frameHandlers: [] as Array<(data: string) => void>,
  };
  const connection: Connection = {
    actorId: null,
    deliver: (message) => {
      if (!state.connected) return;
      for (const handler of state.frameHandlers) handler(JSON.stringify(message));
    },
  };
  journal.register(connection, () => state.connected);
  return {
    transport: {
      connect: () => {
        state.connected = true;
        for (const handler of state.openHandlers) handler();
      },
      send: (message: { [key: string]: unknown }) => {
        if (!state.connected) return false;
        journal.dispatch(connection, JSON.stringify(message));
        return true;
      },
      sendFrame: (text: string) => {
        if (!state.connected) return false;
        journal.dispatch(connection, text);
        return true;
      },
      close: () => {
        state.connected = false;
      },
      onOpen: (handler: () => void) => state.openHandlers.push(handler),
      onFrame: (handler: (data: string) => void) => state.frameHandlers.push(handler),
      onDisconnect: () => {},
    },
    disconnect: () => {
      state.connected = false;
    },
  };
}

function makeSession(journal: Journal, pendingStore?: MemoryPendingOperationStore) {
  const { transport, disconnect } = makeTransport(journal);
  const doc: Document = { values: {} } as unknown as Document;
  const values: Record<string, unknown> = {};
  const notices: string[] = [];
  const engine = new CollabSyncEngine({
    roomUrl: 'ws://test/room/one',
    inviteToken: 't',
    displayName: 'Tester',
    clientId: `client-${Math.random()}`,
    handlers: {
      applySnapshot: () => true,
      applyRemoteOperation: (op) => {
        for (const change of op.capture.changes) {
          if (change.propertyPath) values[change.propertyPath] = change.after;
        }
      },
      onRoster: () => {},
      onCursor: () => {},
      onSelection: () => {},
      onViewport: () => {},
      onChat: () => {},
      onNotice: (notice) => notices.push(notice.message),
      onStatus: () => {},
    },
    createTransport: () => transport,
    timers: { setTimeout: () => 0, clearTimeout: () => {} },
    pendingStore,
  });
  void doc;
  return { engine, values, notices, disconnect, transport };
}

/** Wait for the engine's fire-and-forget persistence to settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('durable pending operations', () => {
  it('re-sends unacknowledged work after a reload and the room converges', async () => {
    const store = new MemoryPendingOperationStore();
    const journal = new Journal();

    // First session: the link dies before the edit, so it never reaches the
    // host and stays unacknowledged.
    const first = makeSession(journal, store);
    first.engine.start();
    first.disconnect();
    first.engine.submitOperation(makeOperation('op-1', [makeChange('nodes.n1.x', 0, 42)]));
    first.values['nodes.n1.x'] = 42; // the local document has it (via applyCollabTransaction)
    await settle();
    expect(first.engine.isPending('op-1')).toBe(true);
    expect(await store.load(roomKeyFor('ws://test/room/one'))).toHaveLength(1);
    first.engine.stop();

    // Reload: a fresh engine, same store, same room.
    const second = makeSession(journal, store);
    second.engine.start();
    await settle();

    // The room caught up, and the local document still holds the edit.
    expect(journal.ops.map((op) => op.clientOpId)).toEqual(['op-1']);
    expect(second.engine.isPending('op-1')).toBe(false);
    expect(second.values['nodes.n1.x']).toBe(42);
    // The queue is cleared once acknowledged.
    expect(await store.load(roomKeyFor('ws://test/room/one'))).toEqual([]);
    expect(second.notices.some((message) => /never acknowledged/i.test(message))).toBe(true);
  });

  it('does not replay another room’s work', async () => {
    const store = new MemoryPendingOperationStore();
    await store.save(roomKeyFor('ws://test/room/other'), [
      {
        clientOpId: 'op-other',
        label: 'Other room edit',
        savedAt: Date.now(),
        op: makeOperation('op-other', [makeChange('nodes.n1.x', 0, 7)]),
      },
    ]);
    const journal = new Journal();
    const session = makeSession(journal, store);
    session.engine.start();
    await settle();

    expect(journal.ops).toHaveLength(0);
    expect(session.values['nodes.n1.x']).toBeUndefined();
  });

  it('prunes by age, count, and bytes, and says how many were dropped', async () => {
    const now = Date.now();
    const record = (id: string, savedAt: number): PendingOperationRecord => ({
      clientOpId: id,
      label: 'Edit',
      savedAt,
      op: makeOperation(id, [makeChange('nodes.n1.x', 0, 1)]),
    });

    const aged = prunePendingRecords(
      [record('old', now - PENDING_LIMITS.maxAgeMs - 1), record('fresh', now)],
      now,
    );
    expect(aged.kept.map((entry) => entry.clientOpId)).toEqual(['fresh']);
    expect(aged.dropped).toBe(1);

    const many = prunePendingRecords(
      Array.from({ length: 5 }, (_, index) => record(`op-${index}`, now - index)),
      now,
      { maxOperations: 2, maxAgeMs: PENDING_LIMITS.maxAgeMs, maxBytes: PENDING_LIMITS.maxBytes },
    );
    expect(many.kept.map((entry) => entry.clientOpId)).toEqual(['op-1', 'op-0']);
    expect(many.dropped).toBe(3);

    const oversized = prunePendingRecords([record('a', now - 1), record('b', now)], now, {
      maxOperations: PENDING_LIMITS.maxOperations,
      maxAgeMs: PENDING_LIMITS.maxAgeMs,
      maxBytes: 1,
    });
    // The newest is always kept: the budget can never empty the queue.
    expect(oversized.kept.map((entry) => entry.clientOpId)).toEqual(['b']);
    expect(oversized.overBudget).toBe(true);
  });

  it('reports a storage failure once and keeps editing', async () => {
    const failing = {
      load: () => Promise.reject(new Error('quota exceeded')),
      save: () => Promise.reject(new Error('quota exceeded')),
      clear: () => Promise.reject(new Error('quota exceeded')),
    };
    const journal = new Journal();
    const session = makeSession(journal, failing as unknown as MemoryPendingOperationStore);
    session.engine.start();
    session.engine.submitOperation(makeOperation('op-1', [makeChange('nodes.n1.x', 0, 1)]));
    session.engine.submitOperation(makeOperation('op-2', [makeChange('nodes.n1.y', 0, 2)]));
    await settle();

    // Both edits reached the room; the storage failure is reported, not fatal.
    expect(journal.ops.map((op) => op.clientOpId)).toEqual(['op-1', 'op-2']);
    const failures = session.notices.filter((message) => /could not be stored/i.test(message));
    expect(failures).toHaveLength(1);
  });

  it('keeps the queue when a session ends, so a later join still delivers it', async () => {
    const store = new MemoryPendingOperationStore();
    const journal = new Journal();
    const first = makeSession(journal, store);
    first.engine.start();
    first.disconnect();
    first.engine.submitOperation(makeOperation('op-keep', [makeChange('nodes.n1.x', 0, 5)]));
    await settle();
    first.engine.stop();
    await settle();

    // The author left the room; the work is still theirs and still queued.
    expect(await store.load(roomKeyFor('ws://test/room/one'))).toHaveLength(1);
  });
});
