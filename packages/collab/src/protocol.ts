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
  /**
   * Operations above `maxOperationBytes` are uploaded in chunks instead of a
   * single frame. This is the ordinary path for an embedded image asset: the
   * document's own inline-asset bound is 10 MB
   * (`@varve/scene` documentCodec MAX_INLINE_ASSET_BYTES), so inserting a
   * photo into a shared document produces a capture well above the inline
   * ceiling. Chunking changes framing, never semantics: the host reassembles
   * the frame and validates it exactly like an inline one.
   */
  maxChunkedOperationBytes: 64_000_000,
  /** UTF-8 bytes per `operation-chunk` payload (also bounds frame escaping). */
  maxUploadChunkBytes: 262_144,
  maxUploadChunks: 4_096,
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

/** Camera viewport broadcast for spotlight/follow (all world coordinates). */
export interface ViewportPresence {
  pageId: string | null;
  centerX: number;
  centerY: number;
  zoom: number;
  /** True while this participant is spotlighting for followers. */
  spotlighting: boolean;
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
  | {
      /** Opens a chunked upload of an oversized operation frame. */
      type: 'operation-begin';
      uploadId: string;
      /** UTF-8 byte length of the reassembled frame. */
      totalBytes: number;
      chunkCount: number;
      /** SHA-256 hex of the reassembled frame's UTF-8 bytes. */
      digest: string;
    }
  | {
      type: 'operation-chunk';
      uploadId: string;
      index: number;
      /** Characters of the serialized frame, in order. */
      data: string;
    }
  | { type: 'operation-end'; uploadId: string }
  | { type: 'cursor'; pageId: string | null; x: number; y: number }
  | { type: 'selection'; pageId: string | null; nodeIds: string[] }
  | {
      type: 'viewport';
      pageId: string | null;
      centerX: number;
      centerY: number;
      zoom: number;
      spotlighting: boolean;
    }
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
  | { type: 'presence-viewport'; actorId: string; viewport: ViewportPresence }
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
  | {
      /**
       * A chunked upload was refused. The operation was never journaled and
       * stays pending local work on the sender.
       */
      type: 'operation-upload-rejected';
      uploadId: string;
      reason: string;
    }
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
    case 'operation-begin':
      return isBoundedString(value.uploadId, ID_MAX) &&
        value.uploadId.length > 0 &&
        isFiniteNumber(value.totalBytes) &&
        value.totalBytes > 0 &&
        value.totalBytes <= PROTOCOL_LIMITS.maxChunkedOperationBytes &&
        isIntegerWithin(value.chunkCount, 1, PROTOCOL_LIMITS.maxUploadChunks) &&
        isSha256Hex(value.digest)
        ? {
            type: 'operation-begin',
            uploadId: value.uploadId,
            totalBytes: value.totalBytes,
            chunkCount: value.chunkCount,
            digest: value.digest,
          }
        : null;
    case 'operation-chunk':
      return isBoundedString(value.uploadId, ID_MAX) &&
        value.uploadId.length > 0 &&
        isIntegerWithin(value.index, 0, PROTOCOL_LIMITS.maxUploadChunks - 1) &&
        typeof value.data === 'string' &&
        utf8ByteLength(value.data) <= PROTOCOL_LIMITS.maxUploadChunkBytes
        ? {
            type: 'operation-chunk',
            uploadId: value.uploadId,
            index: value.index,
            data: value.data,
          }
        : null;
    case 'operation-end':
      return isBoundedString(value.uploadId, ID_MAX) && value.uploadId.length > 0
        ? { type: 'operation-end', uploadId: value.uploadId }
        : null;
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
    case 'operation-upload-rejected':
      return isBoundedString(value.uploadId, ID_MAX) && isBoundedString(value.reason, 300)
        ? { type: 'operation-upload-rejected', uploadId: value.uploadId, reason: value.reason }
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

/** UTF-8 byte length without allocating a buffer. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      // A well-formed surrogate pair encodes to four bytes total.
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && value.length === 64 && /^[0-9a-f]+$/i.test(value);
}

function isIntegerWithin(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
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
