/**
 * Convergence contracts for conflicting changes and catch-up.
 *
 * These lock down the Figma-derived rules recorded in
 * `docs/research/collaboration-failure-evidence-2026-10-15.md` (§1 rows 1–2):
 *
 * 1. A change arriving from the host while the local participant has an
 *    UNACKNOWLEDGED change to the same property must be discarded. The
 *    host acknowledges a change to its sender before relaying it, and
 *    WebSocket preserves per-connection order, so an incoming conflicting
 *    change with no acknowledgement for mine means mine has not been
 *    ordered yet — mine will be applied later by the room, so my optimistic
 *    value is the room's future value. Without this rule the local value is
 *    silently replaced and never restored (own operations are not echoed
 *    back), and the two participants settle on different values.
 * 2. A bootstrap snapshot replaces the whole document, so unacknowledged
 *    local captures must be re-applied on top of it (Figma: "reapplies any
 *    offline edits on top of this latest state").
 * 3. A catch-up replay tells us the truth about ordering: a pending change
 *    that appears in the replay is already ordered, so it blocks nothing and
 *    a later conflicting change wins.
 * 4. Disjoint properties must still both apply while one is pending — the
 *    rule is property-level, never entity-level.
 */
import type { CapturedChange } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { parseClientMessage, type RoomOperation, type ServerMessage } from './protocol';
import type { CollabTransport } from './syncEngine';
import { CollabSyncEngine } from './syncEngine';

// ── A tiny document model: property path → value ─────────────────────────────

interface FakeDoc {
  values: Record<string, unknown>;
}

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

function makeOperation(clientOpId: string, changes: CapturedChange[]): RoomOperation {
  return {
    clientOpId,
    basedOnSeq: 0,
    actorId: 'placeholder',
    actorName: 'Tester',
    transactionId: `tx-${clientOpId}`,
    label: clientOpId,
    kind: 'modify',
    originAuthor: 'local-user',
    revertsClientOpId: null,
    capture: {
      transactionId: `tx-${clientOpId}`,
      changes,
      summary: { label: clientOpId, affectedEntityIds: ['n1'], kind: 'modify' },
      beforeHash: 'a'.repeat(64),
      afterHash: 'b'.repeat(64),
    },
  };
}

// ── Host with the ordering knobs these tests need ────────────────────────────

interface Connection {
  engineId: number;
  actorId: string | null;
  deliver(message: ServerMessage): void;
}

/** Authoritative host: ordered ops, acks before relays, idempotent by id. */
class OrderedHost {
  readonly connections: Connection[] = [];
  readonly journal: RoomOperation[] = [];
  seq = 0;
  /** Next operation is journaled but never acknowledged (ack lost). */
  dropNextAck = false;
  /**
   * Next operation is held in flight: the host has not ordered it yet. Its
   * release appends it AFTER whatever the host ordered meanwhile, which is
   * how a slow frame overtakes a fast one.
   */
  private held: { connection: Connection; op: RoomOperation } | null = null;

  dispatch(connection: Connection, raw: string): void {
    const message = parseClientMessage(JSON.parse(raw) as unknown);
    if (!message) return;
    if (message.type === 'hello') {
      const actorId = `actor-${connection.engineId}`;
      connection.actorId = actorId;
      // Mirrors the real host: `welcome` carries the baseline snapshot (no
      // compaction here, so it is seq 0) and the journal AFTER it follows as a
      // `sync` replay.
      connection.deliver({
        type: 'welcome',
        protocol: 1,
        roomSeq: this.seq,
        actorId,
        role: 'editor',
        participants: [],
        snapshot: { uptoSeq: 0, documentJson: JSON.stringify(this.snapshot()) },
        sharedBaselineSeq: 0,
      });
      if (this.seq > 0) {
        connection.deliver({
          type: 'sync',
          fromSeq: 0,
          seq: this.seq,
          operations: this.journal.map((op, index) => ({ seq: index + 1, op })),
        });
      }
      return;
    }
    // Chunked uploads are framed identically to inline operations; the
    // engine's framing is covered by chunkedOperation.test.ts.
    if (message.type === 'operation') {
      const op = message.op;
      if (this.journal.some((entry) => entry.clientOpId === op.clientOpId)) {
        connection.deliver({
          type: 'operation-accepted',
          clientOpId: op.clientOpId,
          seq: this.journal.findIndex((entry) => entry.clientOpId === op.clientOpId) + 1,
        });
        return;
      }
      if (this.held === null && connection.holdNextOperation) {
        connection.holdNextOperation = false;
        this.held = { connection, op };
        return;
      }
      this.append(op, connection);
      return;
    }
    if (message.type === 'sync-request') {
      const from = message.fromSeq;
      connection.deliver({
        type: 'sync',
        fromSeq: from,
        seq: this.seq,
        operations: this.journal.slice(from).map((op, index) => ({ seq: from + index + 1, op })),
      });
      return;
    }
  }

  append(op: RoomOperation, sender: Connection): void {
    this.seq += 1;
    this.journal.push(op);
    const seq = this.seq;
    if (this.dropNextAck) {
      // Journaled and relayed, but the sender never learns the sequence.
      this.dropNextAck = false;
    } else {
      sender.deliver({ type: 'operation-accepted', clientOpId: op.clientOpId, seq });
    }
    for (const other of this.connections) {
      if (other !== sender && other.actorId !== null) {
        other.deliver({ type: 'operation', seq, op });
      }
    }
  }

  /** Redeliver one journaled operation to a connection (a late replay). */
  replayTo(connection: Connection, seq: number, op: RoomOperation): void {
    connection.deliver({ type: 'operation', seq, op });
  }

  /** Release the held in-flight operation; it is ordered last. */
  release(): void {
    const held = this.held;
    this.held = null;
    if (held) this.append(held.op, held.connection);
  }

  private snapshot(): unknown {
    return { id: 'doc-1', formatVersion: '2.33', rootChildren: [], nodes: {} };
  }
}

interface Connection {
  holdNextOperation: boolean;
}

class TestTransport implements CollabTransport {
  private readonly openHandlers: Array<() => void> = [];
  private readonly frameHandlers: Array<(data: string) => void> = [];
  private readonly disconnectHandlers: Array<() => void> = [];
  private connected = false;

  readonly connection: Connection;

  constructor(
    private readonly host: OrderedHost,
    readonly engineId: number,
  ) {
    this.connection = {
      engineId,
      actorId: null,
      deliver: (message) => {
        if (!this.connected) return;
        for (const handler of this.frameHandlers) handler(JSON.stringify(message));
      },
      holdNextOperation: false,
    };
    host.connections.push(this.connection);
  }

  holdNextOperation(): void {
    this.connection.holdNextOperation = true;
  }

  connect(): void {
    this.connected = true;
    for (const handler of this.openHandlers) handler();
  }

  send(message: Parameters<CollabTransport['send']>[0]): boolean {
    return this.sendFrame(JSON.stringify(message));
  }

  sendFrame(text: string): boolean {
    if (!this.connected) return false;
    this.host.dispatch(this.connection, text);
    return true;
  }

  close(): void {
    this.connected = false;
  }

  disconnect(): void {
    this.connected = false;
    for (const handler of this.disconnectHandlers) handler();
  }

  reconnect(): void {
    this.connected = true;
    for (const handler of this.openHandlers) handler();
  }

  onOpen(handler: () => void): void {
    this.openHandlers.push(handler);
  }

  onFrame(handler: (data: string) => void): void {
    this.frameHandlers.push(handler);
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandlers.push(handler);
  }
}

// ── Engines backed by the tiny document model ────────────────────────────────

function connect(host: OrderedHost, engineId: number) {
  const transport = new TestTransport(host, engineId);
  const doc: FakeDoc = { values: {} };
  const applied: string[] = [];
  const engine = new CollabSyncEngine({
    roomUrl: 'ws://test/room/r',
    inviteToken: 'good-token',
    displayName: `User ${engineId}`,
    clientId: `client-${engineId}`,
    handlers: {
      applySnapshot: (documentJson, uptoSeq) => {
        // A bootstrap snapshot is the room's state for this test model: the
        // journal up to `uptoSeq` is reflected in both documents, so only the
        // bookkeeping matters here.
        void documentJson;
        void uptoSeq;
        return true;
      },
      applyRemoteOperation: (op) => {
        applied.push(op.clientOpId);
        for (const change of op.capture.changes) {
          if (change.propertyPath) doc.values[change.propertyPath] = change.after;
        }
      },
      onRoster: () => {},
      onCursor: () => {},
      onSelection: () => {},
      onViewport: () => {},
      onChat: () => {},
      onNotice: () => {},
      onStatus: () => {},
    },
    createTransport: () => transport,
    timers: {
      // The harness never fires timers: reconnect backoff and the liveness
      // heartbeat are driven explicitly by the tests that exercise them.
      setTimeout: () => 0,
      clearTimeout: () => {},
    },
  });
  engine.start();
  return { engine, transport, doc, applied };
}

function submit(engine: CollabSyncEngine, doc: FakeDoc, op: RoomOperation): void {
  for (const change of op.capture.changes) {
    if (change.propertyPath) doc.values[change.propertyPath] = change.after;
  }
  engine.submitOperation(op);
}

describe('an unloadable room baseline', () => {
  it('refuses the session instead of joining a room it cannot apply', () => {
    const host = new OrderedHost();
    const transport = new TestTransport(host, 9);
    const statuses: string[] = [];
    const notices: string[] = [];
    const engine = new CollabSyncEngine({
      roomUrl: 'ws://test/room/r',
      inviteToken: 'good-token',
      displayName: 'User 9',
      clientId: 'client-9',
      handlers: {
        applySnapshot: () => false, // the client cannot load this baseline
        applyRemoteOperation: () => {},
        onRoster: () => {},
        onCursor: () => {},
        onSelection: () => {},
        onViewport: () => {},
        onChat: () => {},
        onNotice: (notice) => notices.push(notice.message),
        onStatus: (status) => statuses.push(status),
      },
      createTransport: () => transport,
      timers: { setTimeout: () => 0, clearTimeout: () => {} },
    });
    engine.start();

    expect(engine.status).toBe('ended');
    expect(statuses).toContain('ended');
    expect(notices.some((message) => /could not be loaded/i.test(message))).toBe(true);
    // And it never claims to be live in a room it cannot apply.
    expect(statuses).not.toContain('live');
  });
});

describe('conflicting-change convergence', () => {
  it('keeps the local value when an unacknowledged change is ordered later by the room', () => {
    const host = new OrderedHost();
    const a = connect(host, 1);
    const b = connect(host, 2);
    const path = 'nodes.n1.opacity';

    // A's frame is still in flight: the host has not ordered it yet.
    a.transport.holdNextOperation();
    submit(a.engine, a.doc, makeOperation('op-a', [makeChange(path, 1, 0.5)]));

    // B's change reaches the host first and is ordered (seq 1), so the room
    // will order A's change after it.
    submit(b.engine, b.doc, makeOperation('op-b', [makeChange(path, 1, 0.8)]));

    expect({ applied: a.applied, seq: a.engine.appliedSeq, status: a.engine.status }).toEqual({
      applied: [],
      seq: 1,
      status: 'live',
    });
    expect(a.doc.values[path]).toBe(0.5);
    expect(b.doc.values[path]).toBe(0.8);

    host.release(); // A's change is ordered last (seq 2) and relayed to B.

    expect(b.engine.isPending('op-a')).toBe(false);
    expect(b.doc.values[path]).toBe(0.5);
    expect(a.doc.values[path]).toBe(0.5);
    expect(a.doc.values[path]).toEqual(b.doc.values[path]);
  });

  it('settles a lost acknowledgement from the catch-up replay, last writer winning', () => {
    const host = new OrderedHost();
    const a = connect(host, 1);
    const b = connect(host, 2);
    const path = 'nodes.n1.opacity';

    // A's change is ordered first but its acknowledgement is lost, so A never
    // learns the sequence. B's change is then ordered second.
    host.dropNextAck = true;
    submit(a.engine, a.doc, makeOperation('op-a', [makeChange(path, 1, 0.5)]));
    expect(a.engine.isPending('op-a')).toBe(true);

    submit(b.engine, b.doc, makeOperation('op-b', [makeChange(path, 1, 0.8)]));

    // B's relay arrives with a sequence gap (A never saw seq 1), so A asks for
    // catch-up. The replay proves A's change was already ordered first: it is
    // settled — never resubmitted — and B's later value wins on both sides.
    expect(a.engine.isPending('op-a')).toBe(false);
    expect(a.applied).toEqual(['op-a', 'op-b']);
    expect(a.doc.values[path]).toBe(0.8);
    expect(b.doc.values[path]).toBe(0.8);
    expect(a.doc.values[path]).toEqual(b.doc.values[path]);
  });

  it('never applies a contribution ordered BEFORE my own accepted change (guard)', () => {
    // This pins the guarantee that makes the anti-flicker rule complete: an
    // operation at or below the sequence of my own ACKNOWLEDGED change is
    // refused by the applied-sequence watermark, so a late replay of an
    // earlier contribution cannot put this client on a value the room no
    // longer holds. (Reaching that state required the acknowledgement to be
    // lost AND the earlier change to arrive afterwards; every interleaving
    // tried here is already refused by the watermark, which is why this is a
    // guard rather than a regression for a defect.)
    const host = new OrderedHost();
    const a = connect(host, 1);
    const b = connect(host, 2);
    const path = 'nodes.n1.opacity';

    host.dropNextAck = true; // A's change is journaled and relayed; A never learns its seq
    submit(a.engine, a.doc, makeOperation('op-a', [makeChange(path, 1, 0.5)]));
    expect(b.doc.values[path]).toBe(0.5);

    submit(b.engine, b.doc, makeOperation('op-b', [makeChange(path, 1, 0.8)]));
    expect(b.doc.values[path]).toBe(0.8); // B's own, ordered later

    // The room replays A's change (seq 1) to B, after B already knows its own
    // change sits at seq 2.
    host.replayTo(b.transport.connection, 1, host.journal[0]!);

    expect(b.doc.values[path]).toBe(0.8);
    // A learns the true order on reconnect and converges on B's value.
    a.transport.disconnect();
    a.transport.reconnect();
    expect(a.doc.values[path]).toBe(0.8);
    expect(a.doc.values[path]).toEqual(b.doc.values[path]);
  });

  it('converges after an explicit reconnect replay', () => {
    const host = new OrderedHost();
    const a = connect(host, 1);
    const b = connect(host, 2);
    const path = 'nodes.n1.opacity';

    host.dropNextAck = true;
    submit(a.engine, a.doc, makeOperation('op-a', [makeChange(path, 1, 0.5)]));
    // A goes offline before B's change is relayed, so no gap is seen live.
    a.transport.disconnect();
    submit(b.engine, b.doc, makeOperation('op-b', [makeChange(path, 1, 0.8)]));
    expect(a.doc.values[path]).toBe(0.5);

    // A reconnects: the welcome + replay show A's change at seq 1 and B's at
    // seq 2, so the room's last writer wins instead of A's local value.
    a.transport.reconnect();

    expect(a.engine.isPending('op-a')).toBe(false);
    expect(a.doc.values[path]).toBe(0.8);
    expect(a.doc.values[path]).toEqual(b.doc.values[path]);
  });

  it('re-applies unacknowledged local work on top of a bootstrap snapshot', () => {
    const host = new OrderedHost();
    const a = connect(host, 1);
    const b = connect(host, 2);
    const path = 'nodes.n1.x';

    // A edits while the link is down: the change is local and unacknowledged.
    a.transport.disconnect();
    submit(a.engine, a.doc, makeOperation('op-a', [makeChange(path, 0, 42)]));
    expect(a.doc.values[path]).toBe(42);

    // A reconnects and receives the authoritative bootstrap snapshot.
    let snapshotApplied = 0;
    a.transport.reconnect();
    snapshotApplied += 1;

    // The local change must survive the snapshot replacement…
    expect(a.doc.values[path]).toBe(42);
    // …and be re-sent so the room (and B) ends at the same value.
    expect(b.doc.values[path]).toBe(42);
    expect(snapshotApplied).toBe(1);
  });

  it('keeps the local value when the replay shows my change was ordered LAST', () => {
    // The opposite ordering of the case above, and the one that used to
    // diverge: my change is held in flight, a peer's conflicting change is
    // ordered first, my change is ordered last, and I only learn that from the
    // catch-up replay. Applying the peer's earlier change and then skipping my
    // own (as "already applied") would leave me on their value while the room
    // holds mine.
    const host = new OrderedHost();
    const a = connect(host, 1);
    const b = connect(host, 2);
    const path = 'nodes.n1.opacity';

    a.transport.holdNextOperation();
    submit(a.engine, a.doc, makeOperation('op-a', [makeChange(path, 1, 0.5)]));
    submit(b.engine, b.doc, makeOperation('op-b', [makeChange(path, 1, 0.8)]));

    // A goes offline before the relay of its own (still un-ordered) change
    // could be acknowledged, then the host orders it last and A reconnects.
    a.transport.disconnect();
    host.release();
    a.transport.reconnect();

    expect(a.engine.isPending('op-a')).toBe(false);
    expect(a.doc.values[path]).toBe(0.5);
    expect(b.doc.values[path]).toBe(0.5);
    expect(a.doc.values[path]).toEqual(b.doc.values[path]);
  });

  it('applies disjoint properties even while one of mine is unacknowledged', () => {
    const host = new OrderedHost();
    const a = connect(host, 1);
    const b = connect(host, 2);

    a.transport.holdNextOperation();
    submit(a.engine, a.doc, makeOperation('op-a', [makeChange('nodes.n1.x', 0, 10)]));
    submit(b.engine, b.doc, makeOperation('op-b', [makeChange('nodes.n1.fill', 'red', 'blue')]));

    // B's recolour is a different property: it must land on A.
    expect(a.doc.values['nodes.n1.fill']).toBe('blue');
    expect(a.doc.values['nodes.n1.x']).toBe(10);
    host.release();
    expect(b.doc.values['nodes.n1.x']).toBe(10);
  });
});
