/**
 * CollabSessionProvider (ADR-0200): the editor-side integration of the
 * collaboration session.
 *
 * Mounted inside Shell (below EditorProvider), it owns one
 * `CollabSyncEngine` per join and provides session state to every surface:
 * presence, participants, chat, spotlight, connection status, and the
 * selective-undo interception.
 *
 * Invariants kept here (see docs/architecture/collaboration-system.md):
 * - Remote transactions apply through `applyCollabTransaction` — never a
 *   local undo step, never a local persistent-history revision, never a
 *   re-broadcast (the history skip flag also keeps compensations from
 *   re-entering the capture sink: no echo loops).
 * - While a session is active the `undo`/`redo` actions are intercepted
 *   through the ActionRegistry: shared-session undo is a compensating
 *   forward operation over the LOCAL participant's own recorded captures
 *   (ADR-0019 Model B). Cursor-movement undo would restore stale
 *   snapshots over collaborators' work and is therefore unavailable while
 *   a session is active.
 * - Presence (cursors, selections, viewports, chat) is ephemeral and
 *   TTL-filtered; it never touches the document, dirty state, or history.
 * - Following a spotlight is opt-in per viewer and cancelled by any local
 *   camera interaction — never a hijack. Rotation-aware follow is a
 *   documented v1 limitation: following is suppressed while the camera is
 *   rotated rather than applied incorrectly.
 */

import {
  type ChatMessage,
  type CollabNotice,
  type CollabStatus,
  CollabSyncEngine,
  type CursorPresence,
  computeRedoCompensation,
  computeStepCompensation,
  getDeviceId,
  MemoryPendingOperationStore,
  mergeIncomingSplice,
  mintClientId,
  type ParticipantInfo,
  type PendingOperationStore,
  PROTOCOL_LIMITS,
  type RoomOperation,
  type SelectionPresence,
  setLocalCaptureSink,
  type ViewportPresence,
  WebSocketCollabTransport,
} from '@varve/collab';
import { diffDocuments } from '@varve/history';
import type { CapturedChange, Document, NodeId, TransactionCapturePayload } from '@varve/scene';
import {
  applyOperation,
  canonicalHistoryHash,
  DocumentCodec,
  registerBuiltinOperations,
  validatePayload,
} from '@varve/scene';
import { screenToWorld } from '@varve/shared';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getActionRegistry } from '../actions/ActionRegistry';
import { getCursorWorldPosition, subscribeCursorWorldPosition } from '../canvas/cursorPosition';
import { useEditor } from '../context';
import { IndexedDbPendingOperationStore } from './pendingOperationStore';

// ── Public shape ──────────────────────────────────────────────────────────────

export interface CollabSessionConfig {
  /** WebSocket endpoint of the room, e.g. ws://127.0.0.1:8790/room/room-x. */
  roomUrl: string;
  inviteToken: string;
}

export interface CollabChatBubble {
  messageId: string;
  actorId: string;
  displayName: string;
  colorIndex: number;
  text: string;
  at: number;
  /** True while the author may still be typing (live draft updates). */
  composing: boolean;
}

export interface CollabRemoteSelection {
  actorId: string;
  pageId: string | null;
  nodeIds: string[];
}

export interface CollabNoticeEntry {
  id: string;
  notice: CollabNotice;
}

export interface CollabSessionValue {
  status: CollabStatus;
  actorId: string | null;
  role: ParticipantInfo['role'] | null;
  participants: ParticipantInfo[];
  cursors: Array<{ actorId: string; cursor: CursorPresence; participant: ParticipantInfo | null }>;
  selections: CollabRemoteSelection[];
  spotlights: Array<{ actorId: string; viewport: ViewportPresence }>;
  chat: CollabChatBubble[];
  notices: CollabNoticeEntry[];
  session: CollabSessionConfig | null;
  spotlighting: boolean;
  followingActorId: string | null;
  startSession(config: CollabSessionConfig): void;
  stopSession(): void;
  toggleSpotlight(): void;
  followActor(actorId: string | null): void;
  sendChat(messageId: string, text: string, composing: boolean): void;
}

const CollabSessionCtx = createContext<CollabSessionValue | null>(null);

export function useCollabSession(): CollabSessionValue {
  const ctx = useContext(CollabSessionCtx);
  if (!ctx) throw new Error('useCollabSession must be used within CollabSessionProvider');
  return ctx;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CHAT_TTL_MS = 6000;
const CHAT_COMPOSING_TTL_MS = 30_000;
const NOTICE_TTL_MS = 8000;
const MAX_SESSION_CAPTURES = 300;

interface SessionCapture {
  clientOpId: string;
  capture: TransactionCapturePayload;
  label: string;
}

interface RedoEntry {
  original: SessionCapture;
  compensation: TransactionCapturePayload;
  compensationOpId: string;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function CollabSessionProvider({ children }: { children: ReactNode }) {
  const editor = useEditor();
  const [status, setStatus] = useState<CollabStatus>('idle');
  const [actorId, setActorId] = useState<string | null>(null);
  const [role, setRole] = useState<ParticipantInfo['role'] | null>(null);
  const [participants, setParticipants] = useState<ParticipantInfo[]>([]);
  const [cursors, setCursors] = useState<
    Array<{ actorId: string; cursor: CursorPresence; participant: ParticipantInfo | null }>
  >([]);
  const [selections, setSelections] = useState<CollabRemoteSelection[]>([]);
  const [spotlights, setSpotlights] = useState<
    Array<{ actorId: string; viewport: ViewportPresence }>
  >([]);
  const [chat, setChat] = useState<CollabChatBubble[]>([]);
  const [notices, setNotices] = useState<CollabNoticeEntry[]>([]);
  const [sessionConfig, setSessionConfig] = useState<CollabSessionConfig | null>(null);
  const [spotlighting, setSpotlighting] = useState(false);
  const [followingActorId, setFollowingActorId] = useState<string | null>(null);

  const engineRef = useRef<CollabSyncEngine | null>(null);
  // One store instance per app session (IndexedDB handles are reused; the
  // memory fallback keeps tests and private-mode browsers working).
  const pendingStoreRef = useRef<PendingOperationStore>(createPendingStore());
  const undoStackRef = useRef<SessionCapture[]>([]);
  const redoStackRef = useRef<RedoEntry[]>([]);
  const followingRef = useRef<string | null>(null);
  followingRef.current = followingActorId;
  const applyingFollowRef = useRef(false);
  const spotlightingRef = useRef(false);
  spotlightingRef.current = spotlighting;
  const activePageIdRef = useRef<string | null>(editor.state.document.activePageId ?? null);
  activePageIdRef.current = editor.state.document.activePageId ?? null;
  const documentRef = useRef<Document>(editor.state.document);
  documentRef.current = editor.state.document;
  const composingMessageIdRef = useRef<string | null>(null);

  const displayName = useDisplayName();
  const displayNameRef = useRef(displayName);
  displayNameRef.current = displayName;

  const pushNotice = useCallback((notice: CollabNotice) => {
    const entry = { id: mintClientId(), notice };
    setNotices((current) => [...current.slice(-4), entry]);
    window.setTimeout(() => {
      setNotices((current) => current.filter((candidate) => candidate.id !== entry.id));
    }, NOTICE_TTL_MS);
  }, []);

  // ── Send helpers ────────────────────────────────────────────────────────────

  const buildCapture = useCallback(
    (before: Document, after: Document, label: string): TransactionCapturePayload | null => {
      registerBuiltinOperations();
      const diff = diffDocuments(before, after);
      if (diff.changes.length === 0) return null;
      return {
        transactionId: mintClientId(),
        changes: diff.changes.map((change) => ({
          changeType: change.changeType,
          entityId: change.entityId,
          entityType: change.entityType,
          propertyPath: change.propertyPath,
          before: change.before,
          after: change.after,
          textRanges: change.textRanges,
          summary: change.summary,
        })),
        summary: {
          label,
          affectedEntityIds: [...new Set(diff.changes.map((c) => c.entityId))],
          kind: 'modify',
        },
        beforeHash: canonicalHistoryHash(before),
        afterHash: canonicalHistoryHash(after),
      };
    },
    [],
  );

  const broadcastCapture = useCallback(
    (
      capture: TransactionCapturePayload,
      label: string,
      revertsClientOpId: string | null,
    ): string | null => {
      const engine = engineRef.current;
      if (engine?.status !== 'live') return null;
      // Pre-flight the capture against the SAME validator every receiving
      // client runs. A capture the receiver must refuse is otherwise sent,
      // refused there, and answered with a resynchronization — while the author
      // sees nothing wrong. (Measured: an inserted 3.9 MB image exceeded the
      // capture string bound, so it never replicated and nobody was told.)
      const validated = validatePayload('document.transaction-capture', capture);
      if (!validated.ok) {
        pushNotice({
          code: 'operation-rejected',
          message: `This change cannot be shared (${validated.errors.join('; ')}). It stays in your local document.`,
        });
        return null;
      }
      const clientOpId = mintClientId();
      const op: RoomOperation = {
        clientOpId,
        basedOnSeq: engine.appliedSeq,
        actorId: engine.actorId ?? '',
        actorName: displayNameRef.current,
        transactionId: capture.transactionId,
        label,
        kind: capture.summary.kind,
        originAuthor: 'local-user',
        revertsClientOpId,
        capture,
      };
      engine.submitOperation(op);
      return clientOpId;
    },
    [],
  );

  const applyCaptureChanges = useCallback(
    (before: Document, changes: CapturedChange[]): Document | null => {
      if (changes.length === 0) return null;
      registerBuiltinOperations();
      return applyOperation(before, 'document.transaction-capture', {
        transactionId: mintClientId(),
        changes,
        summary: {
          label: 'Compensation',
          affectedEntityIds: [...new Set(changes.map((c) => c.entityId))],
          kind: 'modify',
        },
        beforeHash: canonicalHistoryHash(before),
        afterHash: 'f'.repeat(64),
      });
    },
    [],
  );

  // ── Remote application ────────────────────────────────────────────────────

  const applyRemoteCapture = useCallback(
    (capture: TransactionCapturePayload, label: string) => {
      registerBuiltinOperations();
      const validated = validatePayload('document.transaction-capture', capture);
      if (!validated.ok) {
        // Name the rule that refused it: a bare "failed validation" leaves the
        // reason (and therefore the fix) invisible in the field.
        pushNotice({
          code: 'protocol-error',
          message: `A received change failed validation (${validated.errors.join('; ')}); resynchronizing.`,
        });
        engineRef.current?.resync();
        return;
      }
      const before = documentRef.current;
      const adjusted = transformCaptureToLocal(before, capture);
      if (adjusted.changes.length === 0) return;
      const next = applyCaptureChanges(before, adjusted.changes);
      if (next) editor.applyCollabTransaction(next, label);
    },
    [applyCaptureChanges, editor, pushNotice],
  );

  // ── Selective undo / redo (compensating) ──────────────────────────────────

  const collabUndo = useCallback(() => {
    const step = undoStackRef.current.pop();
    if (!step) {
      editor.announce('Nothing of yours left to undo in this session');
      return;
    }
    const before = documentRef.current;
    const compensation = computeStepCompensation(before, {
      revisionId: step.clientOpId,
      clientOpId: step.clientOpId,
      capture: step.capture,
    });
    if (compensation.changes.length === 0) {
      const reasons = [...new Set(compensation.skips.map((s) => s.reason))].join(', ');
      editor.announce(
        compensation.skips.length > 0 ? `Undo skipped: ${reasons}` : 'Nothing to undo',
      );
      redoStackRef.current = redoStackRef.current.slice(0, -1);
      return;
    }
    const next = applyCaptureChanges(before, compensation.changes);
    if (!next) return;
    editor.applyCollabTransaction(next, `Undo ${step.label}`);
    const capture = buildCapture(before, next, `Undo ${step.label}`);
    const compensationOpId = capture
      ? broadcastCapture(capture, `Undo ${step.label}`, step.clientOpId)
      : null;
    redoStackRef.current = [
      ...redoStackRef.current.slice(-MAX_SESSION_CAPTURES),
      {
        original: step,
        compensation: {
          transactionId: mintClientId(),
          changes: compensation.changes,
          summary: { label: 'Undo', affectedEntityIds: [], kind: 'modify' },
          beforeHash: '0'.repeat(64),
          afterHash: '0'.repeat(64),
        },
        compensationOpId: compensationOpId ?? '',
      },
    ];
  }, [applyCaptureChanges, broadcastCapture, buildCapture, editor]);

  const collabRedo = useCallback(() => {
    const entry = redoStackRef.current[redoStackRef.current.length - 1];
    if (!entry) {
      editor.announce('Nothing to redo');
      return;
    }
    const before = documentRef.current;
    const redo = computeRedoCompensation(before, {
      step: {
        revisionId: entry.original.clientOpId,
        clientOpId: entry.original.clientOpId,
        capture: entry.original.capture,
      },
      compensation: entry.compensation,
    });
    if (redo.changes.length === 0) {
      editor.announce('Redo skipped: the values have changed since the undo');
      return;
    }
    const next = applyCaptureChanges(before, redo.changes);
    if (!next) return;
    editor.applyCollabTransaction(next, `Redo ${entry.original.label}`);
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current.slice(-MAX_SESSION_CAPTURES), entry.original];
    const capture = buildCapture(before, next, `Redo ${entry.original.label}`);
    if (capture) broadcastCapture(capture, `Redo ${entry.original.label}`, entry.compensationOpId);
  }, [applyCaptureChanges, broadcastCapture, buildCapture, editor]);

  const collabUndoRef = useRef(collabUndo);
  collabUndoRef.current = collabUndo;
  const collabRedoRef = useRef(collabRedo);
  collabRedoRef.current = collabRedo;

  // Intercept the registry handlers while a session is active. Undo and
  // redo never cursor through the revision DAG in shared sessions: that
  // would restore pre-session snapshots over collaborators' work.
  useEffect(() => {
    const active =
      sessionConfig !== null &&
      (status === 'live' || status === 'syncing' || status === 'reconnecting');
    const registry = getActionRegistry();
    const originalUndo = registry.get('undo');
    const originalRedo = registry.get('redo');
    if (!active || !originalUndo || !originalRedo) return;
    const savedUndo = originalUndo.handler;
    const savedRedo = originalRedo.handler;
    registry.updateHandler('undo', () => collabUndoRef.current());
    registry.updateHandler('redo', () => collabRedoRef.current());
    return () => {
      registry.updateHandler('undo', savedUndo);
      registry.updateHandler('redo', savedRedo);
    };
  }, [sessionConfig, status]);

  // ── Local capture broadcast ───────────────────────────────────────────────

  useEffect(() => {
    if (!sessionConfig) {
      setLocalCaptureSink(null);
      return;
    }
    setLocalCaptureSink((event) => {
      const capture = buildCapture(event.before, event.after, event.label);
      if (!capture) return;
      const clientOpId = broadcastCapture(capture, event.label, null);
      undoStackRef.current = [
        ...undoStackRef.current.slice(-MAX_SESSION_CAPTURES),
        { clientOpId: clientOpId ?? mintClientId(), capture, label: event.label },
      ];
    });
    return () => setLocalCaptureSink(null);
  }, [sessionConfig, buildCapture, broadcastCapture]);

  // ── Presence publishing ───────────────────────────────────────────────────

  useEffect(() => {
    if (!sessionConfig || status !== 'live') return;
    return subscribeCursorWorldPosition(() => {
      const position = getCursorWorldPosition();
      if (position) {
        engineRef.current?.sendCursor(activePageIdRef.current, position.x, position.y);
      }
    });
  }, [sessionConfig, status]);

  const lastSelectionRef = useRef('');
  const lastViewportRef = useRef('');
  useEffect(() => {
    if (!sessionConfig || status !== 'live') return;
    const selectionKey = editor.state.selection.join(',');
    if (selectionKey !== lastSelectionRef.current) {
      lastSelectionRef.current = selectionKey;
      engineRef.current?.sendSelection(
        activePageIdRef.current,
        editor.state.selection.slice(0, PROTOCOL_LIMITS.maxSelectionIds),
      );
    }
    const viewportKey = `${activePageIdRef.current}|${editor.state.pan.x.toFixed(1)}|${editor.state.pan.y.toFixed(1)}|${editor.state.zoom.toFixed(3)}`;
    if (viewportKey !== lastViewportRef.current) {
      const wasFollowApplication = applyingFollowRef.current;
      lastViewportRef.current = viewportKey;
      if (!wasFollowApplication && followingRef.current) {
        // Local camera interaction cancels following — never a fight.
        setFollowingActorId(null);
      }
      const canvasEl = document.querySelector<HTMLElement>('canvas.editor-canvas__content-layer');
      const width = canvasEl?.clientWidth ?? window.innerWidth;
      const height = canvasEl?.clientHeight ?? window.innerHeight - 120;
      const [centerX, centerY] = screenToWorld(
        {
          zoom: editor.state.zoom,
          pan: editor.state.pan,
          rotation: editor.state.cameraRotation,
        },
        width / 2,
        height / 2,
        { width, height },
      );
      engineRef.current?.sendViewport(
        activePageIdRef.current,
        centerX,
        centerY,
        editor.state.zoom,
        spotlightingRef.current,
      );
    }
  }, [
    sessionConfig,
    status,
    editor.state.selection,
    editor.state.pan,
    editor.state.zoom,
    editor.state.cameraRotation,
  ]);

  // ── Session lifecycle ─────────────────────────────────────────────────────

  const startSession = useCallback(
    (config: CollabSessionConfig) => {
      engineRef.current?.stop();
      undoStackRef.current = [];
      redoStackRef.current = [];
      setChat([]);
      setSelections([]);
      setCursors([]);
      setSpotlights([]);
      setFollowingActorId(null);
      setSpotlighting(false);
      const engine = new CollabSyncEngine({
        roomUrl: config.roomUrl,
        inviteToken: config.inviteToken,
        displayName: displayNameRef.current,
        clientId: mintClientId(),
        handlers: {
          applySnapshot: (documentJson) => {
            const decoded = DocumentCodec.decode(documentJson);
            if (!decoded.ok) {
              // Refusing here is the point: joining a room whose baseline this
              // client cannot load would fail validation on every incoming
              // operation and resynchronize forever.
              pushNotice({
                code: 'protocol-error',
                message: 'The room snapshot could not be decoded.',
              });
              return false;
            }
            editor.applyCollabTransaction(decoded.document, 'Joined session');
            return true;
          },
          applyRemoteOperation: (op) => {
            applyRemoteCapture(op.capture, op.label);
          },
          onRoster: (roster) => setParticipants(roster),
          onCursor: (remoteActor, cursor) => {
            setCursors((current) => [
              ...current.filter((entry) => entry.actorId !== remoteActor),
              {
                actorId: remoteActor,
                cursor,
                participant: engineRef.current?.participantFor(remoteActor) ?? null,
              },
            ]);
          },
          onSelection: (remoteActor, selection: SelectionPresence) => {
            setSelections((current) => [
              ...current.filter((entry) => entry.actorId !== remoteActor),
              { actorId: remoteActor, pageId: selection.pageId, nodeIds: selection.nodeIds },
            ]);
          },
          onViewport: (remoteActor, viewport) => {
            setSpotlights((current) => [
              ...current.filter((entry) => entry.actorId !== remoteActor),
              { actorId: remoteActor, viewport },
            ]);
            if (followingRef.current === remoteActor) {
              if (Math.abs(editor.state.cameraRotation) > 1e-9) {
                // Rotation-aware follow is a documented v1 limitation.
                setFollowingActorId(null);
                pushNotice({
                  code: 'protocol-error',
                  message: 'Follow paused: rotate the view back to 0 to resume.',
                });
                return;
              }
              applyingFollowRef.current = true;
              const canvasEl = document.querySelector<HTMLElement>(
                'canvas.editor-canvas__content-layer',
              );
              const width = canvasEl?.clientWidth ?? window.innerWidth;
              const height = canvasEl?.clientHeight ?? window.innerHeight - 120;
              editor.setPan({
                x: width / 2 - viewport.centerX * viewport.zoom,
                y: height / 2 - viewport.centerY * viewport.zoom,
              });
              editor.setZoom(viewport.zoom);
              window.setTimeout(() => {
                applyingFollowRef.current = false;
              }, 80);
            }
          },
          onChat: (message: ChatMessage) => {
            const participant = engineRef.current?.participantFor(message.actorId);
            if (message.text.length === 0) {
              // The author withdrew the draft (Escape, or leaving the field):
              // drop the bubble everywhere it was shown.
              setChat((current) =>
                current.filter((bubble) => bubble.messageId !== message.messageId),
              );
              return;
            }
            setChat((current) => [
              ...current.filter((bubble) => bubble.messageId !== message.messageId),
              {
                messageId: message.messageId,
                actorId: message.actorId,
                displayName: participant?.displayName ?? 'Guest',
                colorIndex: participant?.colorIndex ?? 0,
                text: message.text,
                at: Date.now(),
                // A finalized message keeps the short TTL; only a live draft
                // gets the longer composing window.
                composing: message.composing,
              },
            ]);
          },
          onNotice: (notice) => pushNotice(notice),
          onStatus: (next) => {
            setStatus(next);
            if (next === 'ended') {
              setCursors([]);
              setSelections([]);
              setSpotlights([]);
              setChat([]);
            }
          },
        },
        createTransport: (roomUrl) => new WebSocketCollabTransport(roomUrl),
        // Unacknowledged edits survive a reload: the room catches up to the
        // local document on the next join instead of staying behind it.
        pendingStore: pendingStoreRef.current,
        timers: {
          setTimeout: (handler, ms) => window.setTimeout(handler, ms),
          clearTimeout: (handle) => window.clearTimeout(handle as number),
        },
      });
      engineRef.current = engine;
      setSessionConfig(config);
      setStatus('connecting');
      engine.start();
    },
    [applyRemoteCapture, editor, pushNotice],
  );

  const stopSession = useCallback(() => {
    engineRef.current?.stop();
    engineRef.current = null;
    setSessionConfig(null);
    setStatus('idle');
    setActorId(null);
    setRole(null);
    setParticipants([]);
    setCursors([]);
    setSelections([]);
    setSpotlights([]);
    setChat([]);
    setFollowingActorId(null);
    setSpotlighting(false);
  }, []);

  // Actor/role mirror from the engine (assigned by the host on welcome).
  useEffect(() => {
    if (!sessionConfig) return;
    const interval = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      setActorId(engine.actorId);
      setRole(engine.role);
    }, 400);
    return () => window.clearInterval(interval);
  }, [sessionConfig]);

  // Presence TTL sweep: drops stale cursors, expired chat, ended spotlights.
  useEffect(() => {
    const interval = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      setCursors(
        engine.liveCursors().map((entry) => ({
          actorId: entry.actorId,
          cursor: entry.cursor,
          participant: entry.participant,
        })),
      );
      setSelections(
        engine.liveSelections().map((entry) => ({
          actorId: entry.actorId,
          pageId: entry.selection.pageId,
          nodeIds: entry.selection.nodeIds,
        })),
      );
      setSpotlights(
        engine
          .liveViewports()
          .map((entry) => ({ actorId: entry.actorId, viewport: entry.viewport })),
      );
      setChat((current) =>
        current.filter(
          (bubble) =>
            bubble.messageId === composingMessageIdRef.current ||
            Date.now() - bubble.at < (bubble.composing ? CHAT_COMPOSING_TTL_MS : CHAT_TTL_MS),
        ),
      );
      setNotices((current) => current.filter(() => true));
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const sendChat = useCallback((messageId: string, text: string, composing: boolean) => {
    const engine = engineRef.current;
    if (!engine) return;
    composingMessageIdRef.current = composing ? messageId : null;
    engine.sendChat(text, messageId, composing);
    // The author does not get a local bubble: bubbles are anchored to a
    // REMOTE cursor, and the author's own text is already visible in the
    // composer. A finalized message is simply withdrawn from local state (its
    // bubble, if the peer sees it, belongs to the peer's cursor).
    if (!composing) {
      setChat((current) => current.filter((bubble) => bubble.messageId !== messageId));
    }
  }, []);

  const toggleSpotlight = useCallback(() => {
    setSpotlighting((current) => !current);
  }, []);

  const followActor = useCallback((actor: string | null) => {
    setFollowingActorId(actor);
    if (actor === null) applyingFollowRef.current = false;
  }, []);

  const value = useMemo<CollabSessionValue>(
    () => ({
      status,
      actorId,
      role,
      participants,
      cursors,
      selections,
      spotlights,
      chat,
      notices,
      session: sessionConfig,
      spotlighting,
      followingActorId,
      startSession,
      stopSession,
      toggleSpotlight,
      followActor,
      sendChat,
    }),
    [
      status,
      actorId,
      role,
      participants,
      cursors,
      selections,
      spotlights,
      chat,
      notices,
      sessionConfig,
      spotlighting,
      followingActorId,
      startSession,
      stopSession,
      toggleSpotlight,
      followActor,
      sendChat,
    ],
  );

  return <CollabSessionCtx.Provider value={value}>{children}</CollabSessionCtx.Provider>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Persistent when the platform allows it, in-memory otherwise. */
function createPendingStore(): PendingOperationStore {
  try {
    if (typeof indexedDB !== 'undefined' && indexedDB !== null) {
      return new IndexedDbPendingOperationStore();
    }
  } catch {
    // Private mode / disabled storage: fall through to memory.
  }
  return new MemoryPendingOperationStore();
}

function useDisplayName(): string {
  const [name, setName] = useState('');
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('varve-editor-settings');
      if (raw) {
        const parsed = JSON.parse(raw) as { collab?: { displayName?: string } };
        if (parsed.collab?.displayName) setName(parsed.collab.displayName);
      }
    } catch {
      // Settings unreadable: fall back to the device id prefix.
    }
  }, []);
  if (name) return name;
  try {
    return `Guest-${getDeviceId().slice(0, 4)}`;
  } catch {
    return 'Guest';
  }
}

/**
 * Adjust an incoming capture for local application: text splices transform
 * against the current (possibly diverged) text; contested spans where a
 * locally pending edit wins are neutralized (the pending op lands later and
 * overwrites everywhere, so convergence holds). Non-text changes apply
 * unconditionally — room order is the tiebreaker and every client applies
 * the same order.
 */
function transformCaptureToLocal(
  doc: Document,
  capture: TransactionCapturePayload,
): TransactionCapturePayload {
  const changes: CapturedChange[] = capture.changes.map((change) => {
    if (
      change.changeType !== 'text' ||
      typeof change.before !== 'string' ||
      typeof change.after !== 'string' ||
      !change.propertyPath
    ) {
      return change;
    }
    const currentText = readNodeText(doc, change.propertyPath);
    if (currentText === null || currentText === change.before) return change;
    const incoming = {
      start: change.textRanges?.baseStart ?? 0,
      end: change.textRanges?.baseEnd ?? 0,
      replacement: graphemes(change.after).slice(
        change.textRanges?.targetStart ?? 0,
        change.textRanges?.targetEnd ?? 0,
      ),
    };
    const outcome = mergeIncomingSplice(change.before, currentText, incoming, {
      incomingIsLater: true,
    });
    if (outcome.mode === 'incoming-loses') {
      // Neutral change: apply is a no-op at the same value.
      return { ...change, changeType: 'modified', before: currentText, after: currentText };
    }
    if (outcome.mode === 'incoming-wins') {
      return { ...change, before: currentText, after: change.after };
    }
    return {
      ...change,
      before: currentText,
      after: outcome.text,
      textRanges: rangesBetween(currentText, outcome.text),
    };
  });
  return { ...capture, changes };
}

function readNodeText(doc: Document, propertyPath: string): string | null {
  const match = /^nodes\.([^.]+)\.text$/.exec(propertyPath);
  if (!match) return null;
  const node = doc.nodes[match[1] as NodeId];
  const text = (node as unknown as { text?: unknown }).text;
  return typeof text === 'string' ? text : null;
}

function graphemes(text: string): string[] {
  return Array.from(
    new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text),
    (s) => s.segment,
  );
}

function rangesBetween(beforeText: string, afterText: string) {
  const b = graphemes(beforeText);
  const c = graphemes(afterText);
  let start = 0;
  const limit = Math.min(b.length, c.length);
  while (start < limit && b[start] === c[start]) start++;
  let baseEnd = b.length;
  let currentEnd = c.length;
  while (baseEnd > start && currentEnd > start && b[baseEnd - 1] === c[currentEnd - 1]) {
    baseEnd--;
    currentEnd--;
  }
  return { baseStart: start, baseEnd, targetStart: start, targetEnd: currentEnd };
}
