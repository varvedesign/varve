/**
 * Collab wire protocol v1 (ADR-0200 semantic-operation sync).
 *
 * The room replicates an ordered list of validated semantic captures
 * (`document.transaction-capture` payloads, ADR-0017 §8.1) plus ephemeral
 * presence and chat. The server assigns the authoritative room sequence;
 * clients apply every accepted operation in sequence order. Documents are a
 * deterministic function of (genesis snapshot, ordered capture payloads);
 * undo is client-local compensation that emits ordinary capture payloads.
 *
 * Wire format is JSON with camelCase keys. The Rust room host
 * (crates/varve-room) mirrors these types with `rename_all = "camelCase"`;
 * conformance fixtures live in ./__fixtures__/protocol-v1.json and are
 * checked by both sides.
 *
 * Trust boundary: the server authenticates connections, enforces roles,
 * sequence, size, and rate limits, but cannot replay design semantics —
 * receiving clients validate every capture through the operation registry
 * before applying it. A capture that fails validation triggers a visible
 * resync, never silent loss.
 */

import type { TransactionCapturePayload } from '@varve/scene';

/** Wire protocol version. Negotiated in `hello`/`welcome`. */
export const COLLAB_PROTOCOL_VERSION = 1;

/** Participant roles. Enforced by the host on every mutation. */
export type ParticipantRole = 'owner' | 'editor' | 'viewer';

/** Wire limits. The host rejects frames exceeding them; clients pre-check. */
export const PROTOCOL_LIMITS = {
  /** Maximum grapheme-safe plain-text length of one chat message. */
  maxChatLength: 280,
  /** Maximum node ids in one selection broadcast. */
  maxSelectionIds: 200,
  /** Maximum serialized capture payload bytes per operation frame. */
  maxOperationBytes: 2_000_000,
  /** Maximum serialized document bytes for the bootstrap snapshot. */
  maxSnapshotBytes: 64_000_000,
  /** Maximum participants per room (host-configurable, never exceeded). */
  maxParticipants: 10,
  /** Presence updates per second the client coalesces to. */
  presenceHz: 30,
} as const;

/** Participant identity as broadcast to every room member. */
export interface ParticipantInfo {
  /** Stable for the join session; authorship on operations. */
  actorId: string;
  /** Client-supplied display name; unverified (not an identity). */
  displayName: string;
  /** Palette index 0-7; the UI resolves it to a theme token. */
  colorIndex: number;
  role: ParticipantRole;
  /** Connection identity; distinct from actorId and from any device id. */
  clientId: string;
}

/** Cursor position in document/world coordinates for one page surface. */
export interface CursorPresence {
  /** Null when the pointer is over chrome or another surface. */
  pageId: string | null;
  x: number;
  y: number;
}

/** Remote selection outline payload (bounded, page-scoped). */
export interface SelectionPresence {
  pageId: string | null;
  nodeIds: string[];
}

/** Ephemeral cursor-chat message. Never persisted, never a document mutation. */
export interface ChatMessage {
  messageId: string;
  actorId: string;
  /** Plain text only; rendered with textContent, never HTML. */
  text: string;
}

/** A document mutation as it travels through the room. */
export interface RoomOperation {
  /** Sender-minted id; the first accepted frame wins, duplicates are acked. */
  clientOpId: string;
  /** Room sequence the sender had fully applied when it composed this op. */
  basedOnSeq: number;
  actorId: string;
  /** Sender display name snapshot for labels on clients that joined later. */
  actorName: string;
  transactionId: string;
  label: string;
  kind: string;
  /** Authorship class of the original gesture (never 'remote-user' on the wire). */
  originAuthor: 'local-user' | 'system';
  /** Provenance for undo: the operation this one compensates, when present. */
  revertsClientOpId: string | null;
  capture: TransactionCapturePayload;
}

// ── Client → Host ─────────────────────────────────────────────────────────────

export type ClientMessage =
  | {
      type: 'hello';
      protocol: number;
      token: string;
      clientId: string;
      displayName: string;
    }
  | { type: 'operation'; op: RoomOperation }
  | { type: 'cursor'; pageId: string | null; x: number; y: number }
  | { type: 'selection'; pageId: string | null; nodeIds: string[] }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'sync-request'; fromSeq: number }
  | { type: 'leave' }
  | { type: 'ping' };

// ── Host → Client ─────────────────────────────────────────────────────────────

export interface RoomSnapshot {
  /** Sequence number the snapshot reflects. */
  uptoSeq: number;
  /** Canonical serialized document (DocumentCodec). */
  documentJson: string;
}

export type ServerMessage =
  | {
      type: 'welcome';
      protocol: number;
      roomSeq: number;
      actorId: string;
      role: ParticipantRole;
      participants: ParticipantInfo[];
      snapshot: RoomSnapshot;
      sharedBaselineSeq: number;
    }
  | { type: 'operation-accepted'; clientOpId: string; seq: number }
  | { type: 'operation-rejected'; clientOpId: string; reason: string; fatal: boolean }
  | { type: 'operation'; seq: number; op: RoomOperation }
  | { type: 'participant-joined'; participant: ParticipantInfo }
  | { type: 'participant-left'; actorId: string; reason: string }
  | { type: 'presence-cursor'; actorId: string; cursor: CursorPresence }
  | { type: 'presence-selection'; actorId: string; selection: SelectionPresence }
  | { type: 'chat'; message: ChatMessage }
  | {
      type: 'sync';
      fromSeq: number;
      seq: number;
      operations: Array<{ seq: number; op: RoomOperation }>;
    }
  | { type: 'snapshot'; snapshot: RoomSnapshot }
  | { type: 'role-changed'; actorId: string; role: ParticipantRole }
  | { type: 'room-ended'; reason: string }
  | { type: 'error'; code: string; message: string; fatal: boolean }
  | { type: 'pong' };

// ── Validation (mirrors the host; frames outside these shapes are closed on) ──

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

export function isParticipantRole(value: unknown): value is ParticipantRole {
  return value === 'owner' || value === 'editor' || value === 'viewer';
}

const ID_MAX = 128;
const NAME_MAX = 60;
const LABEL_MAX = 120;

/** Structural validation of a capture payload before registry validation. */
export function isCapturePayloadLike(value: unknown): value is TransactionCapturePayload {
  if (!isRecord(value)) return false;
  return (
    isBoundedString(value.transactionId, ID_MAX) &&
    Array.isArray(value.changes) &&
    value.changes.length <= 20_000 &&
    isBoundedString(value.beforeHash, 64) &&
    isBoundedString(value.afterHash, 64) &&
    isRecord(value.summary)
  );
}

export function isRoomOperationLike(value: unknown): value is RoomOperation {
  if (!isRecord(value)) return false;
  return (
    isBoundedString(value.clientOpId, ID_MAX) &&
    isFiniteNumber(value.basedOnSeq) &&
    value.basedOnSeq >= 0 &&
    isBoundedString(value.actorId, ID_MAX) &&
    isBoundedString(value.actorName, NAME_MAX) &&
    isBoundedString(value.transactionId, ID_MAX) &&
    isBoundedString(value.label, LABEL_MAX) &&
    isBoundedString(value.kind, 40) &&
    (value.originAuthor === 'local-user' || value.originAuthor === 'system') &&
    (value.revertsClientOpId === null || isBoundedString(value.revertsClientOpId, ID_MAX)) &&
    isCapturePayloadLike(value.capture)
  );
}

/** Narrows an untrusted frame to a ClientMessage or null (host-side mirror). */
export function parseClientMessage(value: unknown): ClientMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  switch (value.type) {
    case 'hello':
      return value.protocol === COLLAB_PROTOCOL_VERSION &&
        typeof value.token === 'string' &&
        value.token.length > 0 &&
        value.token.length <= 256 &&
        typeof value.clientId === 'string' &&
        value.clientId.length > 0 &&
        value.clientId.length <= ID_MAX &&
        isBoundedString(value.displayName, NAME_MAX)
        ? {
            type: 'hello',
            protocol: value.protocol,
            token: value.token,
            clientId: value.clientId,
            displayName: value.displayName,
          }
        : null;
    case 'operation':
      return isRoomOperationLike(value.op) ? { type: 'operation', op: value.op } : null;
    case 'cursor':
      return (value.pageId === null || isBoundedString(value.pageId, ID_MAX)) &&
        isFiniteNumber(value.x) &&
        isFiniteNumber(value.y)
        ? { type: 'cursor', pageId: value.pageId, x: value.x, y: value.y }
        : null;
    case 'selection':
      return (value.pageId === null || isBoundedString(value.pageId, ID_MAX)) &&
        Array.isArray(value.nodeIds) &&
        value.nodeIds.length <= PROTOCOL_LIMITS.maxSelectionIds &&
        value.nodeIds.every((id) => isBoundedString(id, ID_MAX))
        ? { type: 'selection', pageId: value.pageId, nodeIds: [...value.nodeIds] }
        : null;
    case 'chat': {
      if (!isRecord(value.message)) return null;
      const message = value.message;
      return isBoundedString(message.messageId, ID_MAX) &&
        isBoundedString(message.actorId, ID_MAX) &&
        isBoundedString(message.text, PROTOCOL_LIMITS.maxChatLength)
        ? {
            type: 'chat',
            message: { messageId: message.messageId, actorId: message.actorId, text: message.text },
          }
        : null;
    }
    case 'sync-request':
      return isFiniteNumber(value.fromSeq) && value.fromSeq >= 0
        ? { type: 'sync-request', fromSeq: value.fromSeq }
        : null;
    case 'leave':
      return { type: 'leave' };
    case 'ping':
      return { type: 'ping' };
    default:
      return null;
  }
}

/** Narrows an untrusted frame to a ServerMessage or null (client-side guard). */
export function parseServerMessage(value: unknown): ServerMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  switch (value.type) {
    case 'welcome': {
      if (
        value.protocol !== COLLAB_PROTOCOL_VERSION ||
        !isFiniteNumber(value.roomSeq) ||
        !isBoundedString(value.actorId, ID_MAX) ||
        !isParticipantRole(value.role) ||
        !Array.isArray(value.participants) ||
        value.participants.length > PROTOCOL_LIMITS.maxParticipants ||
        !value.participants.every(isParticipantInfoLike) ||
        !isSnapshotLike(value.snapshot) ||
        !isFiniteNumber(value.sharedBaselineSeq)
      ) {
        return null;
      }
      return {
        type: 'welcome',
        protocol: value.protocol,
        roomSeq: value.roomSeq,
        actorId: value.actorId,
        role: value.role,
        participants: value.participants,
        snapshot: value.snapshot,
        sharedBaselineSeq: value.sharedBaselineSeq,
      };
    }
    case 'operation-accepted':
      return isBoundedString(value.clientOpId, ID_MAX) && isFiniteNumber(value.seq)
        ? { type: 'operation-accepted', clientOpId: value.clientOpId, seq: value.seq }
        : null;
    case 'operation-rejected':
      return isBoundedString(value.clientOpId, ID_MAX) &&
        isBoundedString(value.reason, 200) &&
        typeof value.fatal === 'boolean'
        ? {
            type: 'operation-rejected',
            clientOpId: value.clientOpId,
            reason: value.reason,
            fatal: value.fatal,
          }
        : null;
    case 'operation':
      return isFiniteNumber(value.seq) && isRoomOperationLike(value.op)
        ? { type: 'operation', seq: value.seq, op: value.op }
        : null;
    case 'participant-joined':
      return isParticipantInfoLike(value.participant)
        ? { type: 'participant-joined', participant: value.participant }
        : null;
    case 'participant-left':
      return isBoundedString(value.actorId, ID_MAX) && isBoundedString(value.reason, 60)
        ? { type: 'participant-left', actorId: value.actorId, reason: value.reason }
        : null;
    case 'presence-cursor':
      return isBoundedString(value.actorId, ID_MAX) &&
        isRecord(value.cursor) &&
        (value.cursor.pageId === null || isBoundedString(value.cursor.pageId, ID_MAX)) &&
        isFiniteNumber(value.cursor.x) &&
        isFiniteNumber(value.cursor.y)
        ? {
            type: 'presence-cursor',
            actorId: value.actorId,
            cursor: { pageId: value.cursor.pageId, x: value.cursor.x, y: value.cursor.y },
          }
        : null;
    case 'presence-selection':
      return isBoundedString(value.actorId, ID_MAX) &&
        isRecord(value.selection) &&
        (value.selection.pageId === null || isBoundedString(value.selection.pageId, ID_MAX)) &&
        Array.isArray(value.selection.nodeIds) &&
        value.selection.nodeIds.length <= PROTOCOL_LIMITS.maxSelectionIds &&
        value.selection.nodeIds.every((id) => isBoundedString(id, ID_MAX))
        ? {
            type: 'presence-selection',
            actorId: value.actorId,
            selection: { pageId: value.selection.pageId, nodeIds: [...value.selection.nodeIds] },
          }
        : null;
    case 'chat': {
      if (!isRecord(value.message)) return null;
      const message = value.message;
      return isBoundedString(message.messageId, ID_MAX) &&
        isBoundedString(message.actorId, ID_MAX) &&
        isBoundedString(message.text, PROTOCOL_LIMITS.maxChatLength)
        ? {
            type: 'chat',
            message: { messageId: message.messageId, actorId: message.actorId, text: message.text },
          }
        : null;
    }
    case 'sync': {
      if (
        !isFiniteNumber(value.fromSeq) ||
        !isFiniteNumber(value.seq) ||
        !Array.isArray(value.operations)
      ) {
        return null;
      }
      const operations: Array<{ seq: number; op: RoomOperation }> = [];
      for (const entry of value.operations) {
        if (!isRecord(entry) || !isFiniteNumber(entry.seq) || !isRoomOperationLike(entry.op))
          return null;
        operations.push({ seq: entry.seq, op: entry.op });
      }
      return { type: 'sync', fromSeq: value.fromSeq, seq: value.seq, operations };
    }
    case 'snapshot':
      return isSnapshotLike(value.snapshot) ? { type: 'snapshot', snapshot: value.snapshot } : null;
    case 'role-changed':
      return isBoundedString(value.actorId, ID_MAX) && isParticipantRole(value.role)
        ? { type: 'role-changed', actorId: value.actorId, role: value.role }
        : null;
    case 'room-ended':
      return isBoundedString(value.reason, 200)
        ? { type: 'room-ended', reason: value.reason }
        : null;
    case 'error':
      return isBoundedString(value.code, 60) &&
        isBoundedString(value.message, 300) &&
        typeof value.fatal === 'boolean'
        ? { type: 'error', code: value.code, message: value.message, fatal: value.fatal }
        : null;
    case 'pong':
      return { type: 'pong' };
    default:
      return null;
  }
}

function isParticipantInfoLike(value: unknown): value is ParticipantInfo {
  if (!isRecord(value)) return false;
  return (
    isBoundedString(value.actorId, ID_MAX) &&
    isBoundedString(value.displayName, NAME_MAX) &&
    isFiniteNumber(value.colorIndex) &&
    value.colorIndex >= 0 &&
    value.colorIndex <= 7 &&
    isParticipantRole(value.role) &&
    isBoundedString(value.clientId, ID_MAX)
  );
}

function isSnapshotLike(value: unknown): value is RoomSnapshot {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.uptoSeq) &&
    value.uptoSeq >= 0 &&
    isBoundedString(value.documentJson, PROTOCOL_LIMITS.maxSnapshotBytes)
  );
}
