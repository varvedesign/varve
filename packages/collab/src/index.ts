/**
 * @varve/collab — local-first CRDT awareness + reconnect (Strata plan §3.2, Phase 2).
 *
 * P5: Transaction hooks for Yjs integration. These are stub hook points
 * that will be wired to Yjs document transactions when sync lands in
 * Phase 2. The editor's beginTransaction/commitTransaction/abortTransaction
 * will call these hooks to batch Yjs updates into a single undo entry.
 *
 * Session W6: added CollabUser/LiveCursor types and stub Tauri-facing
 * functions for UI development.
 */

/** Marker for the collab package. */
export const PACKAGE = '@varve/collab' as const;

// ── Real-time collaboration core (ADR-0200) ──────────────────────────────

export { fallbackColorIndex, forgetDeviceId, getDeviceId, mintClientId } from './identity';
export {
  type ChatMessage,
  type ClientMessage,
  COLLAB_PROTOCOL_VERSION,
  type CursorPresence,
  isCapturePayloadLike,
  isRoomOperationLike,
  type ParticipantInfo,
  type ParticipantRole,
  PROTOCOL_LIMITS,
  parseClientMessage,
  parseServerMessage,
  type RoomOperation,
  type RoomSnapshot,
  type SelectionPresence,
  type ServerMessage,
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
 * is in progress. When Yjs is wired in, these will wrap Y.Doc.transact(). */
export interface TransactionHooks {
  onBeginTransaction: () => void;
  onCommitTransaction: () => void;
  onAbortTransaction: () => void;
}

/** No-op transaction hooks (default when sync is not active). */
export const noopTransactionHooks: TransactionHooks = {
  onBeginTransaction: () => {},
  onCommitTransaction: () => {},
  onAbortTransaction: () => {},
};

/**
 * Register transaction hooks. Returns an unregister function.
 * When Yjs is wired in, this will connect to the Y.Doc instance.
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

// ── Stub Tauri-facing functions ──────────────────────────────────

/**
 * No real collaboration backend exists yet (no Tauri IPC, no CRDT sync) —
 * returning fake collaborators here would show invented people ("Alice",
 * "Bob") as live cursors/presence indicators in every single-user session.
 * Returns empty until this is wired to a real backend.
 */
export async function getCollabUsers(_documentId: string): Promise<CollabUser[]> {
  return [];
}

/** Stub: no-op cursor update. Will be replaced with Tauri IPC. */
export async function updateCursor(_documentId: string, _cursor: LiveCursor): Promise<void> {
  await Promise.resolve();
}
