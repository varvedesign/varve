import type { CapturedChange } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { parseClientMessage, type RoomOperation, type ServerMessage } from './protocol';
import type { CollabTransport } from './syncEngine';
import { type CollabStatus, CollabSyncEngine } from './syncEngine';

// ── In-memory test host (executable reference for the Rust room host) ────────

interface HostConnection {
  engineId: number;
  actorId: string | null;
  deliver(message: ServerMessage): void;
}

/** Minimal authoritative host: auth, ordered ops, acks, dedupe, presence relay. */
class FakeHost {
  readonly connections: HostConnection[] = [];
  seq = 0;
  ops: RoomOperation[] = [];
  rejectedNext: string | null = null;
  /** Next new op is journaled but its ack/broadcast is lost (crash window). */
  dropNextAck = false;
  closed = false;

  dispatch(connection: HostConnection, raw: string): void {
    const message = parseClientMessage(JSON.parse(raw) as unknown);
    if (!message) return;
    switch (message.type) {
      case 'hello': {
        if (message.token !== 'good-token') {
          connection.deliver({
            type: 'error',
            code: 'bad-token',
            message: 'Invite invalid.',
            fatal: true,
          });
          return;
        }
        const actorId = `actor-${connection.engineId}`;
        connection.actorId = actorId;
        connection.deliver({
          type: 'welcome',
          protocol: 1,
          roomSeq: this.seq,
          actorId,
          role: 'editor',
          participants: this.connections
            .filter((c) => c.actorId !== null)
            .map((c) => ({
              actorId: `actor-${c.engineId}`,
              displayName: `User ${c.engineId}`,
              colorIndex: c.engineId % 8,
              role: 'editor' as const,
              clientId: `client-${c.engineId}`,
            })),
          snapshot: { uptoSeq: this.seq, documentJson: '{"id":"doc-1"}' },
          sharedBaselineSeq: 0,
        });
        for (const other of this.connections) {
          if (other !== connection && other.actorId !== null) {
            other.deliver({
              type: 'participant-joined',
              participant: {
                actorId,
                displayName: `User ${connection.engineId}`,
                colorIndex: connection.engineId % 8,
                role: 'editor',
                clientId: `client-${connection.engineId}`,
              },
            });
          }
        }
        break;
      }
      case 'operation': {
        // Idempotent by clientOpId: a retry of an already-journaled op is
        // re-acked with its existing sequence, never double-applied.
        const existing = this.ops.findIndex((op) => op.clientOpId === message.op.clientOpId);
        if (existing >= 0) {
          connection.deliver({
            type: 'operation-accepted',
            clientOpId: message.op.clientOpId,
            seq: existing + 1,
          });
          return;
        }
        if (this.rejectedNext === message.op.clientOpId) {
          this.rejectedNext = null;
          connection.deliver({
            type: 'operation-rejected',
            clientOpId: message.op.clientOpId,
            reason: 'test rejection',
            fatal: false,
          });
          return; // rejected ops never enter the room journal
        }
        this.seq += 1;
        this.ops.push(message.op);
        if (this.dropNextAck) {
          this.dropNextAck = false;
          return; // journaled; ack and broadcast lost
        }
        connection.deliver({
          type: 'operation-accepted',
          clientOpId: message.op.clientOpId,
          seq: this.seq,
        });
        for (const other of this.connections) {
          if (other !== connection && other.actorId !== null) {
            other.deliver({ type: 'operation', seq: this.seq, op: message.op });
          }
        }
        break;
      }
      case 'sync-request': {
        const from = message.fromSeq;
        connection.deliver({
          type: 'sync',
          fromSeq: from,
          seq: this.seq,
          operations: this.ops.slice(from).map((op, index) => ({ seq: from + index + 1, op })),
        });
        break;
      }
      case 'cursor': {
        for (const other of this.connections) {
          if (other !== connection && other.actorId !== null) {
            other.deliver({
              type: 'presence-cursor',
              actorId: `actor-${connection.engineId}`,
              cursor: { pageId: message.pageId, x: message.x, y: message.y },
            });
          }
        }
        break;
      }
      case 'chat': {
        for (const other of this.connections) {
          if (other !== connection && other.actorId !== null) {
            other.deliver({ type: 'chat', message: message.message });
          }
        }
        break;
      }
      case 'leave': {
        this.closed = true;
        break;
      }
      case 'selection':
      case 'ping':
        break;
    }
  }

  broadcastEnded(reason: string): void {
    for (const connection of this.connections) {
      connection.deliver({ type: 'room-ended', reason });
    }
  }
}

class LinkedTransport implements CollabTransport {
  private readonly openHandlers: Array<() => void> = [];
  private readonly frameHandlers: Array<(data: string) => void> = [];
  private readonly disconnectHandlers: Array<() => void> = [];
  private connected = false;

  constructor(
    private readonly host: FakeHost,
    readonly engineId: number,
  ) {}

  connect(): void {
    this.connected = true;
    for (const handler of this.openHandlers) handler();
  }

  send(message: Parameters<CollabTransport['send']>[0]): boolean {
    return this.sendFrame(JSON.stringify(message));
  }

  sendFrame(text: string): boolean {
    if (!this.connected) return false;
    this.host.dispatch(this.connection(), text);
    return true;
  }

  close(): void {
    this.connected = false;
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

  /** Simulate a link drop, then a fresh link whose open handlers fire. */
  reconnect(): void {
    this.connected = false;
    for (const handler of this.disconnectHandlers) handler();
    this.connected = true;
    for (const handler of this.openHandlers) handler();
  }

  receiveFromHost(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const handler of this.frameHandlers) handler(data);
  }

  /** Inject a client frame into the host as if this link sent it. */
  deliverToHost(frame: unknown): void {
    this.host.dispatch(this.connection(), JSON.stringify(frame));
  }

  private connection(): HostConnection {
    let connection = this.host.connections.find((c) => c.engineId === this.engineId);
    if (!connection) {
      connection = {
        engineId: this.engineId,
        actorId: null,
        deliver: (message) => this.receiveFromHost(message),
      };
      this.host.connections.push(connection);
    }
    return connection;
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ZERO_HASH = '0'.repeat(64);

function makeOp(clientOpId: string, actorId = 'actor-1'): RoomOperation {
  const change: CapturedChange = {
    changeType: 'modified',
    entityId: 'n1',
    entityType: 'node',
    propertyPath: 'nodes.n1.opacity',
    before: 1,
    after: 0.5,
    summary: 'opacity',
  };
  return {
    clientOpId,
    basedOnSeq: 0,
    actorId,
    actorName: 'Tester',
    transactionId: `tx-${clientOpId}`,
    label: 'Edit',
    kind: 'modify',
    originAuthor: 'local-user',
    revertsClientOpId: null,
    capture: {
      transactionId: `tx-${clientOpId}`,
      changes: [change],
      summary: { label: 'Edit', affectedEntityIds: ['n1'], kind: 'modify' },
      beforeHash: ZERO_HASH,
      afterHash: ZERO_HASH,
    },
  };
}

interface Harness {
  engine: CollabSyncEngine;
  transport: LinkedTransport;
  host: FakeHost;
  applied: Array<{ documentJson: string; uptoSeq: number } | { op: RoomOperation }>;
  notices: Array<{ code: string; message: string }>;
  statuses: CollabStatus[];
  chats: string[];
}

function makeHarness(engineId: number, host: FakeHost, token = 'good-token'): Harness {
  const applied: Harness['applied'] = [];
  const notices: Harness['notices'] = [];
  const statuses: CollabStatus[] = [];
  const chats: string[] = [];
  const transport = new LinkedTransport(host, engineId);
  const engine = new CollabSyncEngine({
    roomUrl: 'memory://room',
    inviteToken: token,
    displayName: `User ${engineId}`,
    clientId: `client-${engineId}`,
    handlers: {
      applySnapshot: (documentJson, uptoSeq) => {
        applied.push({ documentJson, uptoSeq });
        return true;
      },
      applyRemoteOperation: (op) => applied.push({ op }),
      onRoster: () => {},
      onCursor: () => {},
      onSelection: () => {},
      onViewport: () => {},
      onChat: (message) => chats.push(message.text),
      onNotice: (notice) => notices.push({ code: notice.code, message: notice.message }),
      onStatus: (status) => statuses.push(status),
    },
    createTransport: () => transport,
    timers: {
      setTimeout: () => 0,
      clearTimeout: () => {},
    },
  });
  return { engine, transport, host, applied, notices, statuses, chats };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CollabSyncEngine', () => {
  it('joins, receives the snapshot, and reaches live', () => {
    const host = new FakeHost();
    const a = makeHarness(1, host);
    a.engine.start();
    expect(a.engine.status).toBe('live');
    expect(a.engine.actorId).toBe('actor-1');
    expect(a.applied).toEqual([{ documentJson: '{"id":"doc-1"}', uptoSeq: 0 }]);
  });

  it('rejects invalid invite tokens with a fatal error and never reaches live', () => {
    const host = new FakeHost();
    const a = makeHarness(1, host, 'wrong-token');
    a.engine.start();
    expect(a.engine.status).toBe('ended');
    expect(a.engine.actorId).toBeNull();
    expect(a.notices.some((n) => n.code === 'protocol-error')).toBe(true);
  });

  it('acknowledges local ops, relays them to peers, and skips own echo on resync', () => {
    const host = new FakeHost();
    const a = makeHarness(1, host);
    const b = makeHarness(2, host);
    a.engine.start();
    b.engine.start();

    expect(a.engine.submitOperation(makeOp('op-a1'))).toBe(true);
    expect(a.engine.isPending('op-a1')).toBe(false); // acked

    const remoteOps = b.applied.filter((entry) => 'op' in entry) as Array<{ op: RoomOperation }>;
    expect(remoteOps).toHaveLength(1);
    expect(remoteOps[0]!.op.clientOpId).toBe('op-a1');

    // Resync replay including own op: engine must not re-apply its own op.
    a.transport.receiveFromHost({
      type: 'sync',
      fromSeq: 0,
      seq: host.seq,
      operations: host.ops.map((op, index) => ({ seq: index + 1, op })),
    });
    expect(a.applied.filter((entry) => 'op' in entry)).toHaveLength(0);
  });

  it('keeps unacked ops pending across a reconnect and the host applies them once', () => {
    const host = new FakeHost();
    const a = makeHarness(1, host);
    a.engine.start();

    host.dropNextAck = true; // journaled; ack lost (crash window)
    a.engine.submitOperation(makeOp('op-a1'));
    expect(a.engine.isPending('op-a1')).toBe(true);

    // Link drops and reconnects; the engine resends the pending op.
    a.transport.reconnect();
    expect(a.engine.isPending('op-a1')).toBe(false); // re-acked from the journal
    expect(host.ops).toHaveLength(1); // applied exactly once
  });

  it('surfaces non-fatal rejections as notices without desynchronizing', () => {
    const host = new FakeHost();
    host.rejectedNext = 'op-a1';
    const a = makeHarness(1, host);
    a.engine.start();

    a.engine.submitOperation(makeOp('op-a1'));
    expect(a.engine.isPending('op-a1')).toBe(false);
    expect(
      a.notices.some((n) => n.code === 'operation-rejected' && n.message === 'test rejection'),
    ).toBe(true);
    expect(a.engine.status).toBe('live');
  });

  it('requests catch-up when a sequence gap is detected', () => {
    const host = new FakeHost();
    const a = makeHarness(1, host);
    a.engine.start();

    // Two unseen ops sit in the host journal; the second arrives out of
    // band (seq 2 while the client is at 0) — a gap.
    const missed = makeOp('op-missed', 'actor-9');
    const other = makeOp('op-other', 'actor-8');
    host.ops.push(missed, other);
    host.seq = 2;
    a.transport.receiveFromHost({ type: 'operation', seq: 2, op: other });

    // The engine detected the gap, asked the host, and the sync replay
    // delivered both unseen operations in order.
    const ops = a.applied.filter((entry) => 'op' in entry) as Array<{ op: RoomOperation }>;
    expect(ops.map((entry) => entry.op.clientOpId)).toEqual(['op-missed', 'op-other']);
  });

  it('ignores stale redelivery of already-applied operations', () => {
    const host = new FakeHost();
    const a = makeHarness(1, host);
    a.engine.start();
    a.engine.submitOperation(makeOp('op-a1'));

    const before = a.applied.filter((entry) => 'op' in entry).length;
    a.transport.receiveFromHost({ type: 'operation', seq: 1, op: makeOp('op-a1') });
    expect(a.applied.filter((entry) => 'op' in entry).length).toBe(before);
  });

  it('relays presence and chat without entering the operation log', () => {
    const host = new FakeHost();
    const a = makeHarness(1, host);
    const b = makeHarness(2, host);
    a.engine.start();
    b.engine.start();

    a.transport.deliverToHost({ type: 'cursor', pageId: 'page-1', x: 42, y: 7 });
    const live = b.engine.liveCursors();
    expect(live).toHaveLength(1);
    expect(live[0]!.cursor).toEqual({ pageId: 'page-1', x: 42, y: 7 });
    expect(live[0]!.participant?.actorId).toBe('actor-1');

    expect(b.engine.sendChat('hello there', 'm-1', false)).toBe(true);
    expect(host.ops).toHaveLength(0); // chat never becomes a document op
    expect(a.chats).toEqual(['hello there']);
  });

  it('ends cleanly on room-ended and stops reconnecting', () => {
    const host = new FakeHost();
    const a = makeHarness(1, host);
    a.engine.start();

    host.broadcastEnded('owner stopped sharing');
    expect(a.engine.status).toBe('ended');
    expect(a.notices.some((n) => n.code === 'room-ended')).toBe(true);
  });

  it('stops when asked and does not reconnect afterwards', () => {
    const host = new FakeHost();
    const a = makeHarness(1, host);
    a.engine.start();
    a.engine.stop();
    expect(a.engine.status).toBe('ended');
    a.transport.reconnect();
    expect(a.engine.status).toBe('ended');
    expect(host.closed).toBe(true);
  });
});
