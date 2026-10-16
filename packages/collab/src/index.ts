/**
 * @varve/collab — local-first real-time collaboration (ADR-0200): an
 * authoritative, ordered semantic-operation room plus ephemeral presence and
 * per-participant selective undo (see docs/architecture/collaboration-system.md).
 *
 * Nothing here is a stub. The transport-agnostic engine drives the wire
 * protocol in `./protocol`; `WebSocketCollabTransport` is the browser/Tauri
 * adapter; `./selectiveUndo` computes compensating captures; `./textSplice`
 * merges concurrent text edits. `./identity` carries the three deliberately
 * distinct identities (device, client, actor).
 *
 * The `TransactionHooks` surface below is a no-op returning empty values by
 * design: it is the seam the editor's persistent-history pipeline uses to
 * publish committed transactions (`emitLocalCapture`) and the collab session
 * subscribes to it. It is not an unimplemented CRDT integration.
 */

/** Marker for the collab package. */
export const PACKAGE = '@varve/collab' as const;

// ── Real-time collaboration core (ADR-0200) ──────────────────────────────

export {
  type ChunkedUploadPlan,
  planChunkedOperation,
  sliceByUtf8Bytes,
} from './chunkedOperation';
export { fallbackColorIndex, forgetDeviceId, getDeviceId, mintClientId } from './identity';
export {
  type ChatMessage,
  type ClientMessage,
  COLLAB_PROTOCOL_VERSION,
  type CursorPresence,
  isCapturePayloadLike,
  isRoomOperationLike,
  isSha256Hex,
  type ParticipantInfo,
  type ParticipantRole,
  PROTOCOL_LIMITS,
  parseClientMessage,
  parseServerMessage,
  type RoomOperation,
  type RoomSnapshot,
  type SelectionPresence,
  type ServerMessage,
  utf8ByteLength,
  type ViewportPresence,
} from './protocol';
export {
  type CompensationSkip,
  computeRedoCompensation,
  computeStepCompensation,
  deepEqualsStable,
  type LocalCaptureStep,
  type RedoStep,
  readFromDocument,
  type SkipReason,
  type StepCompensation,
} from './selectiveUndo';
export {
  type CollabEngineHandlers,
  type CollabEngineOptions,
  type CollabNotice,
  type CollabStatus,
  CollabSyncEngine,
  type CollabTimers,
  type CollabTransport,
} from './syncEngine';
export {
  applySplice,
  clusters,
  type MergeIncomingOptions,
  type MergeOutcome,
  mergeIncomingSplice,
  spliceBetween,
  type TextSplice,
} from './textSplice';
export { WebSocketCollabTransport } from './webSocketTransport';

// ── Local capture bridge (editor → collab session) ───────────────────────
// Module-global like the legacy TransactionHooks: the editor's persistent
// history pipeline emits committed transactions; the active collab session
// subscribes to replicate them to the room.

import type { Document } from '@varve/scene';

export interface LocalCaptureEvent {
  before: Document;
  after: Document;
  label: string;
  kind: string;
}

type LocalCaptureSink = (event: LocalCaptureEvent) => void;

let localCaptureSink: LocalCaptureSink | null = null;

/** Subscribe to committed local transactions. Returns an unsubscribe fn. */
export function setLocalCaptureSink(sink: LocalCaptureSink | null): void {
  localCaptureSink = sink;
}

/** Editor-side emit (called by the persistent history wiring). */
export function emitLocalCapture(event: LocalCaptureEvent): void {
  localCaptureSink?.(event);
}

// ── Collab user / cursor types ────────────────────────────────────

export interface CollabUser {
  id: string;
  name: string;
  color: string;
  avatar?: string;
}

export interface LiveCursor {
  userId: string;
  x: number;
  y: number;
  viewportX: number;
  viewportY: number;
  timestamp: number;
}

// ── Transaction hooks (existing) ──────────────────────────────────

/** Transaction hook interface. The editor calls these when a transaction
 * is in progress, so a future batching consumer has a seam to hook. The
 * live collab path does NOT use these: local captures reach the room through
 * `emitLocalCapture`/`setLocalCaptureSink` below. */
export interface TransactionHooks {
  onBeginTransaction: () => void;
  onCommitTransaction: () => void;
  onAbortTransaction: () => void;
}

/** No-op transaction hooks (the default; nothing consumes them today). */
export const noopTransactionHooks: TransactionHooks = {
  onBeginTransaction: () => {},
  onCommitTransaction: () => {},
  onAbortTransaction: () => {},
};

/**
 * Register transaction hooks. Returns an unregister function.
 * Kept as a documented extension seam: an aggregating consumer (for example
 * batching a multi-step gesture) would register here instead of forking the
 * history pipeline.
 */
export function registerTransactionHooks(hooks: TransactionHooks): () => void {
  _activeHooks = hooks;
  return () => {
    if (_activeHooks === hooks) {
      _activeHooks = noopTransactionHooks;
    }
  };
}

/** Get the currently active transaction hooks. */
export function getTransactionHooks(): TransactionHooks {
  return _activeHooks;
}

let _activeHooks: TransactionHooks = noopTransactionHooks;

// ── Legacy editor-facing helpers ──────────────────────────────────

/**
 * Editor-reported collaboration roster.
 *
 * Returns an EMPTY array, deliberately. The live roster comes from the room
 * session (`useCollabSession().participants`, populated from the host's
 * `welcome`/`participant-*` frames). Returning invented people here is how
 * the old stub put "Alice"/"Bob"/"Charlie" cursors in every single-user
 * session; that is a defect, not a placeholder.
 */
export async function getCollabUsers(_documentId: string): Promise<CollabUser[]> {
  return [];
}

/**
 * Cursor broadcast is owned by the session engine
 * (`CollabSyncEngine.sendCursor`), which coalesces to the presence rate and
 * only sends while the room is live. This entry point is retained for
 * callers that still route through it and does nothing.
 */
export async function updateCursor(_documentId: string, _cursor: LiveCursor): Promise<void> {
  await Promise.resolve();
}
