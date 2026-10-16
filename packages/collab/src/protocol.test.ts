import { describe, expect, it } from 'vitest';
import {
  COLLAB_PROTOCOL_VERSION,
  PROTOCOL_LIMITS,
  parseClientMessage,
  parseServerMessage,
  type RoomOperation,
  type ServerMessage,
} from './protocol';

const VALID_CAPTURE = {
  transactionId: 'tx-1',
  changes: [
    {
      changeType: 'modified' as const,
      entityId: 'n1',
      entityType: 'node',
      propertyPath: 'nodes.n1.opacity',
      before: 1,
      after: 0.5,
      summary: 'Node opacity changed',
    },
  ],
  summary: { label: 'Opacity', affectedEntityIds: ['n1'], kind: 'modify' },
  beforeHash: 'a'.repeat(64),
  afterHash: 'b'.repeat(64),
};

const VALID_OP: RoomOperation = {
  clientOpId: 'op-1',
  basedOnSeq: 3,
  actorId: 'actor-1',
  actorName: 'Kevin',
  transactionId: 'tx-1',
  label: 'Set opacity',
  kind: 'modify',
  originAuthor: 'local-user',
  revertsClientOpId: null,
  capture: VALID_CAPTURE,
};

const VALID_WELCOME: ServerMessage = {
  type: 'welcome',
  protocol: COLLAB_PROTOCOL_VERSION,
  roomSeq: 7,
  actorId: 'actor-9',
  role: 'editor',
  participants: [
    { actorId: 'actor-1', displayName: 'Kevin', colorIndex: 0, role: 'owner', clientId: 'c1' },
  ],
  snapshot: { uptoSeq: 7, documentJson: '{"id":"d1"}' },
  sharedBaselineSeq: 0,
};

describe('parseClientMessage', () => {
  it('round-trips every message kind through JSON', () => {
    const messages: unknown[] = [
      { type: 'hello', protocol: 1, token: 'inv_abc', clientId: 'c1', displayName: 'Kevin' },
      { type: 'operation', op: VALID_OP },
      { type: 'cursor', pageId: 'p1', x: 1.5, y: -2 },
      { type: 'cursor', pageId: null, x: 0, y: 0 },
      { type: 'selection', pageId: 'p1', nodeIds: ['n1', 'n2'] },
      { type: 'chat', message: { messageId: 'm1', actorId: 'a1', text: 'hello' } },
      { type: 'sync-request', fromSeq: 4 },
      { type: 'leave' },
      { type: 'ping' },
    ];
    for (const message of messages) {
      const parsed = parseClientMessage(JSON.parse(JSON.stringify(message)));
      expect(parsed).toEqual(message);
    }
  });

  it('rejects hostile and malformed frames', () => {
    const hostile: unknown[] = [
      null,
      42,
      'hello',
      {},
      { type: 'unknown' },
      { type: 'hello', protocol: 2, token: 't', clientId: 'c', displayName: 'n' },
      { type: 'hello', protocol: 1, token: 5, clientId: 'c', displayName: 'n' },
      { type: 'cursor', pageId: 'p', x: Number.POSITIVE_INFINITY, y: 0 },
      { type: 'cursor', pageId: 'p', x: NaN, y: 0 },
      { type: 'operation', op: { ...VALID_OP, basedOnSeq: -1 } },
      { type: 'operation', op: { ...VALID_OP, capture: { ...VALID_CAPTURE, changes: 'no' } } },
      { type: 'operation', op: { ...VALID_OP, originAuthor: 'remote-user' } },
      { type: 'operation', op: { ...VALID_OP, revertsClientOpId: {} } },
      {
        type: 'selection',
        pageId: 'p',
        nodeIds: Array.from({ length: PROTOCOL_LIMITS.maxSelectionIds + 1 }, (_, i) => `n${i}`),
      },
      { type: 'chat', message: { messageId: 'm', actorId: 'a', text: 'x'.repeat(281) } },
      { type: 'sync-request', fromSeq: -5 },
    ];
    for (const frame of hostile) {
      expect(parseClientMessage(frame)).toBeNull();
    }
  });

  it('rejects frames with excessively long identity strings', () => {
    expect(
      parseClientMessage({
        type: 'hello',
        protocol: 1,
        token: 't',
        clientId: 'c'.repeat(129),
        displayName: 'n',
      }),
    ).toBeNull();
    expect(
      parseClientMessage({
        type: 'hello',
        protocol: 1,
        token: 't',
        clientId: 'c',
        displayName: 'n'.repeat(61),
      }),
    ).toBeNull();
  });
});

describe('parseServerMessage', () => {
  it('round-trips every message kind through JSON', () => {
    const messages: unknown[] = [
      VALID_WELCOME,
      { type: 'operation-accepted', clientOpId: 'op-1', seq: 8 },
      { type: 'operation-rejected', clientOpId: 'op-1', reason: 'read-only', fatal: false },
      { type: 'operation', seq: 9, op: { ...VALID_OP, actorId: 'other' } },
      {
        type: 'participant-joined',
        participant: {
          actorId: 'a2',
          displayName: 'Sam',
          colorIndex: 1,
          role: 'viewer',
          clientId: 'c2',
        },
      },
      { type: 'participant-left', actorId: 'a2', reason: 'disconnect' },
      { type: 'presence-cursor', actorId: 'a2', cursor: { pageId: null, x: 3, y: 4 } },
      { type: 'presence-selection', actorId: 'a2', selection: { pageId: 'p1', nodeIds: [] } },
      { type: 'chat', message: { messageId: 'm2', actorId: 'a2', text: 'hi' } },
      {
        type: 'sync',
        fromSeq: 3,
        seq: 5,
        operations: [
          { seq: 4, op: VALID_OP },
          { seq: 5, op: { ...VALID_OP, clientOpId: 'op-2' } },
        ],
      },
      { type: 'snapshot', snapshot: { uptoSeq: 12, documentJson: '{}' } },
      { type: 'role-changed', actorId: 'a2', role: 'editor' },
      { type: 'room-ended', reason: 'owner stopped sharing' },
      { type: 'error', code: 'room-full', message: 'room is full', fatal: true },
      { type: 'pong' },
    ];
    for (const message of messages) {
      const parsed = parseServerMessage(JSON.parse(JSON.stringify(message)));
      expect(parsed).toEqual(message);
    }
  });

  it('rejects malformed server frames', () => {
    const malformed: unknown[] = [
      { type: 'welcome', protocol: 1, roomSeq: -1 },
      { ...VALID_WELCOME, role: 'superuser' },
      {
        ...VALID_WELCOME,
        participants: [
          { actorId: 'a', displayName: 'd', colorIndex: 9, role: 'editor', clientId: 'c' },
        ],
      },
      { ...VALID_WELCOME, snapshot: { uptoSeq: 1, documentJson: 42 } },
      { type: 'operation', seq: 1, op: { ...VALID_OP, actorName: null } },
      { type: 'operation', seq: Number.NaN, op: VALID_OP },
      { type: 'error', code: 'x', message: 'y' },
      { type: 'sync', fromSeq: 1, seq: 2, operations: [{ seq: 'x', op: VALID_OP }] },
    ];
    for (const frame of malformed) {
      expect(parseServerMessage(frame)).toBeNull();
    }
  });
});
