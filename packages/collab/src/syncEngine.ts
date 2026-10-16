/**
 * Collab sync engine (ADR-0200): the client-side state machine over a
 * `CollabTransport`. Transport-agnostic — unit tests drive it through an
 * in-memory transport; production uses the WebSocket adapter.
 *
 * Model (Figma-style authoritative semantic operations, evidence-checked
 * against Excalidraw/FigCraft failure reports — see
 * docs/architecture/collaboration-system.md):
 *
 * - The host owns the room sequence. Every accepted capture gets a
 *   consecutive seq; clients apply operations in seq order.
 * - Local edits are optimistic: the caller applies them to the document
 *   immediately and hands the capture to `submitOperation`; acceptance is
 *   confirmed by `operation-accepted`, rejection by `operation-rejected`.
 * - Rejections never roll back silently: the caller receives a notice with
 *   the reason and the op stays recoverable through normal undo.
 * - Unacked operations survive reconnects and are re-sent once (idempotent
 *   by clientOpId — at-least-once delivery without duplication).
 * - Sequence gaps trigger `sync-request`; the host replays the missing
 *   range or sends a fresh snapshot. Stale replays of already-applied ops
 *   are dropped by clientOpId.
 * - Presence (cursors, selections, chat) rides the same socket but is
 *   lossy by construction: no acks, no persistence, TTL-based expiry,
 *   client-side coalescing to PROTOCOL_LIMITS.presenceHz.
 * - Reconnection uses exponential backoff with jitter (background-tab
 *   timer throttling must not become a reconnect storm).
 */

import {
  type ChatMessage,
  type ClientMessage,
  COLLAB_PROTOCOL_VERSION,
  type CursorPresence,
  type ParticipantInfo,
  type ParticipantRole,
  PROTOCOL_LIMITS,
  parseServerMessage,
  type RoomOperation,
  type SelectionPresence,
} from './protocol';

export interface CollabTransport {
  /** Open the underlying connection. Idempotent. */
  connect(): void;
  /** Send one client frame. Returns false when the link is down. */
  send(message: ClientMessage): boolean;
  /** Close the underlying connection (client-initiated leave). */
  close(): void;
  /** Underlying link events. */
  onOpen(handler: () => void): void;
  onFrame(handler: (data: string) => void): void;
  onDisconnect(handler: () => void): void;
}

export type CollabStatus = 'idle' | 'connecting' | 'syncing' | 'live' | 'reconnecting' | 'ended';

export interface CollabNotice {
  code:
    | 'operation-rejected'
    | 'participant-joined'
    | 'participant-left'
    | 'role-changed'
    | 'room-ended'
    | 'protocol-error'
    | 'resynced';
  message: string;
  actorId?: string;
  clientOpId?: string;
}

export interface CollabEngineHandlers {
  /** Replace the whole document from the authoritative snapshot. */
  applySnapshot(documentJson: string, uptoSeq: number): void;
  /** Apply one remote capture (never the local participant's own). */
  applyRemoteOperation(op: RoomOperation): void;
  /** Presence and roster changes (already TTL-filtered). */
  onRoster(participants: ParticipantInfo[]): void;
  onCursor(actorId: string, cursor: CursorPresence): void;
  onSelection(actorId: string, selection: SelectionPresence): void;
  onChat(message: ChatMessage): void;
  onNotice(notice: CollabNotice): void;
  onStatus(status: CollabStatus): void;
}

export interface CollabEngineOptions {
  roomUrl: string;
  inviteToken: string;
  displayName: string;
  /** Fresh per-join client id (minted by the caller via mintClientId). */
  clientId: string;
  handlers: CollabEngineHandlers;
  /** Transport factory (tests inject in-memory pairs). */
  createTransport: (roomUrl: string) => CollabTransport;
  /** Timer injection for tests; defaults to setTimeout/clearTimeout. */
  timers?: CollabTimers;
  now?: () => number;
}

export interface CollabTimers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

interface PendingOperation {
  op: RoomOperation;
  sentAt: number;
}

const PRESENCE_TTL_MS = 30_000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 30_000;
/** Re-sent unacked ops are dropped by the host's dedupe window. */
const MAX_PENDING = 500;
const APPLIED_IDS_LIMIT = 2_000;

export class CollabSyncEngine {
  status: CollabStatus = 'idle';
  actorId: string | null = null;
  role: ParticipantRole | null = null;
  participants: ParticipantInfo[] = [];
  appliedSeq = 0;

  private readonly options: CollabEngineOptions;
  private transport: CollabTransport | null = null;
  private readonly pending = new Map<string, PendingOperation>();
  private readonly appliedIds = new Set<string>();
  private reconnectAttempt = 0;
  private reconnectHandle: unknown = null;
  private presenceTimer: unknown = null;
  private readonly cursors = new Map<string, { cursor: CursorPresence; at: number }>();
  private readonly selections = new Map<string, { selection: SelectionPresence; at: number }>();
  private endedReason: string | null = null;
  private leaving = false;
  private lastCursorSent: CursorPresence | null = null;

  constructor(options: CollabEngineOptions) {
    this.options = options;
  }

  private nowMs(): number {
    return (this.options.now ?? Date.now)();
  }

  private get timers(): CollabTimers {
    return (
      this.options.timers ?? {
        setTimeout: (handler, ms) => setTimeout(handler, ms),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      }
    );
  }

  /** Begin joining. Safe to call once; further calls are no-ops. */
  start(): void {
    if (this.transport || this.leaving) return;
    this.setStatus('connecting');
    this.openTransport();
  }

  /** Leave the room and stop reconnecting. Idempotent. */
  stop(): void {
    this.leaving = true;
    this.transport?.send({ type: 'leave' });
    this.teardownTransport();
    this.pending.clear();
    this.setStatus('ended');
  }

  /**
   * Submit a locally applied capture. The engine tracks it as pending
   * until the host acknowledges it. Returns false when the room is not
   * live (the caller keeps the local state; the op is queued if the
   * engine is reconnecting, dropped with a notice only when idle/ended).
   */
  submitOperation(op: RoomOperation): boolean {
    if (this.pending.size >= MAX_PENDING) {
      this.options.handlers.onNotice({
        code: 'operation-rejected',
        message: 'Too many unacknowledged edits; reconnect to resynchronize.',
        clientOpId: op.clientOpId,
      });
      return false;
    }
    this.pending.set(op.clientOpId, { op, sentAt: this.nowMs() });
    return this.transport?.send({ type: 'operation', op }) ?? false;
  }

  /** Publish the local cursor (coalesced to the presence rate). */
  sendCursor(pageId: string | null, x: number, y: number): void {
    this.lastCursorSent = { pageId, x, y };
    if (this.presenceTimer !== null) return;
    this.presenceTimer = this.timers.setTimeout(() => {
      this.presenceTimer = null;
      const cursor = this.lastCursorSent;
      if (cursor && this.status === 'live') {
        this.transport?.send({ type: 'cursor', ...cursor });
      }
    }, 1000 / PROTOCOL_LIMITS.presenceHz);
  }

  sendSelection(pageId: string | null, nodeIds: string[]): void {
    if (this.status !== 'live') return;
    this.transport?.send({
      type: 'selection',
      pageId,
      nodeIds: nodeIds.slice(0, PROTOCOL_LIMITS.maxSelectionIds),
    });
  }

  sendChat(text: string, messageId: string): boolean {
    const trimmed = text.slice(0, PROTOCOL_LIMITS.maxChatLength);
    if (this.status !== 'live' || trimmed.trim().length === 0) return false;
    return (
      this.transport?.send({
        type: 'chat',
        message: { messageId, actorId: this.actorId ?? '', text: trimmed },
      }) ?? false
    );
  }

  /** True when the op is ours and still unacknowledged. */
  isPending(clientOpId: string): boolean {
    return this.pending.has(clientOpId);
  }

  /** Live remote presence, TTL-filtered. */
  liveCursors(): Array<{
    actorId: string;
    cursor: CursorPresence;
    participant: ParticipantInfo | null;
  }> {
    this.expirePresence();
    const out: Array<{
      actorId: string;
      cursor: CursorPresence;
      participant: ParticipantInfo | null;
    }> = [];
    for (const [actorId, entry] of this.cursors) {
      out.push({ actorId, cursor: entry.cursor, participant: this.participantFor(actorId) });
    }
    return out;
  }

  liveSelections(): Array<{ actorId: string; selection: SelectionPresence }> {
    this.expirePresence();
    return [...this.selections.entries()].map(([actorId, entry]) => ({
      actorId,
      selection: entry.selection,
    }));
  }

  participantFor(actorId: string): ParticipantInfo | null {
    return this.participants.find((p) => p.actorId === actorId) ?? null;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private setStatus(status: CollabStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.handlers.onStatus(status);
  }

  private openTransport(): void {
    const transport = this.options.createTransport(this.options.roomUrl);
    this.transport = transport;
    transport.onOpen(() => {
      if (this.leaving || this.endedReason) return;
      transport.send({
        type: 'hello',
        protocol: COLLAB_PROTOCOL_VERSION,
        token: this.options.inviteToken,
        clientId: this.options.clientId,
        displayName: this.options.displayName,
      });
    });
    transport.onFrame((data) => this.handleFrame(data));
    transport.onDisconnect(() => this.handleDisconnect());
    transport.connect();
  }

  private handleDisconnect(): void {
    // The transport object stays installed (its send() reports the broken
    // link) so frames that arrive before the replacement link opens —
    // including the pending-op resend on the new welcome — still route.
    if (this.leaving) return;
    if (this.endedReason) {
      this.setStatus('ended');
      return;
    }
    // Exponential backoff with jitter: background-tab timer throttling
    // must not turn a dropped socket into a reconnect storm (tldraw#7670).
    this.reconnectAttempt += 1;
    const base = Math.min(RECONNECT_BASE_MS * 2 ** (this.reconnectAttempt - 1), RECONNECT_MAX_MS);
    const jitter = base * (0.8 + Math.random() * 0.4);
    this.setStatus('reconnecting');
    this.reconnectHandle = this.timers.setTimeout(() => {
      this.reconnectHandle = null;
      if (!this.leaving && !this.endedReason) this.openTransport();
    }, jitter);
  }

  private handleFrame(data: string): void {
    if (this.leaving) return; // stale socket after an intentional leave
    let parsed: unknown;
    try {
      parsed = JSON.parse(data) as unknown;
    } catch {
      this.options.handlers.onNotice({
        code: 'protocol-error',
        message: 'Unparseable frame from host.',
      });
      return;
    }
    const message = parseServerMessage(parsed);
    if (!message) {
      this.options.handlers.onNotice({
        code: 'protocol-error',
        message: 'Frame failed protocol validation.',
      });
      return;
    }
    switch (message.type) {
      case 'welcome': {
        this.actorId = message.actorId;
        this.role = message.role;
        this.participants = message.participants;
        this.appliedSeq = message.snapshot.uptoSeq;
        this.reconnectAttempt = 0;
        this.setStatus('syncing');
        this.options.handlers.applySnapshot(
          message.snapshot.documentJson,
          message.snapshot.uptoSeq,
        );
        this.options.handlers.onRoster(message.participants);
        this.setStatus('live');
        // Re-send unacked operations (idempotent by clientOpId).
        for (const pending of this.pending.values()) {
          this.transport?.send({ type: 'operation', op: pending.op });
          pending.sentAt = this.nowMs();
        }
        break;
      }
      case 'operation': {
        this.applyRoomOperation(message.seq, message.op);
        break;
      }
      case 'operation-accepted': {
        this.pending.delete(message.clientOpId);
        this.appliedIds.add(message.clientOpId);
        this.appliedSeq = Math.max(this.appliedSeq, message.seq);
        break;
      }
      case 'operation-rejected': {
        const pending = this.pending.get(message.clientOpId);
        this.pending.delete(message.clientOpId);
        this.options.handlers.onNotice({
          code: 'operation-rejected',
          message: message.reason,
          clientOpId: message.clientOpId,
        });
        // A fatal rejection (permissions/schema) means our optimistic state
        // diverges from the room: resynchronize rather than guess.
        if (message.fatal && pending) {
          this.transport?.send({ type: 'sync-request', fromSeq: this.appliedSeq });
        }
        break;
      }
      case 'sync': {
        for (const entry of message.operations) {
          this.applyRoomOperation(entry.seq, entry.op);
        }
        this.appliedSeq = Math.max(this.appliedSeq, message.seq);
        this.options.handlers.onNotice({
          code: 'resynced',
          message: `Caught up to sequence ${message.seq}.`,
        });
        break;
      }
      case 'snapshot': {
        this.appliedSeq = message.snapshot.uptoSeq;
        this.options.handlers.applySnapshot(
          message.snapshot.documentJson,
          message.snapshot.uptoSeq,
        );
        this.options.handlers.onNotice({
          code: 'resynced',
          message: 'Document resynchronized from snapshot.',
        });
        break;
      }
      case 'participant-joined': {
        this.participants = [
          ...this.participants.filter((p) => p.actorId !== message.participant.actorId),
          message.participant,
        ];
        this.options.handlers.onRoster(this.participants);
        this.options.handlers.onNotice({
          code: 'participant-joined',
          message: `${message.participant.displayName} joined`,
          actorId: message.participant.actorId,
        });
        break;
      }
      case 'participant-left': {
        this.participants = this.participants.filter((p) => p.actorId !== message.actorId);
        this.cursors.delete(message.actorId);
        this.selections.delete(message.actorId);
        this.options.handlers.onRoster(this.participants);
        this.options.handlers.onNotice({
          code: 'participant-left',
          message: 'A participant left',
          actorId: message.actorId,
        });
        break;
      }
      case 'presence-cursor': {
        if (message.actorId !== this.actorId) {
          this.cursors.set(message.actorId, { cursor: message.cursor, at: this.nowMs() });
          this.options.handlers.onCursor(message.actorId, message.cursor);
        }
        break;
      }
      case 'presence-selection': {
        if (message.actorId !== this.actorId) {
          this.selections.set(message.actorId, { selection: message.selection, at: this.nowMs() });
          this.options.handlers.onSelection(message.actorId, message.selection);
        }
        break;
      }
      case 'chat': {
        this.options.handlers.onChat(message.message);
        break;
      }
      case 'role-changed': {
        const participant = this.participants.find((p) => p.actorId === message.actorId);
        if (participant) {
          this.participants = this.participants.map((p) =>
            p.actorId === message.actorId ? { ...p, role: message.role } : p,
          );
          if (message.actorId === this.actorId) this.role = message.role;
          this.options.handlers.onRoster(this.participants);
          this.options.handlers.onNotice({
            code: 'role-changed',
            message: `${participant.displayName} is now ${message.role}`,
            actorId: message.actorId,
          });
        }
        break;
      }
      case 'room-ended': {
        this.endedReason = message.reason;
        this.pending.clear();
        this.teardownTransport();
        this.setStatus('ended');
        this.options.handlers.onNotice({ code: 'room-ended', message: message.reason });
        break;
      }
      case 'error': {
        this.options.handlers.onNotice({ code: 'protocol-error', message: message.message });
        if (message.fatal) {
          this.endedReason = message.message;
          this.pending.clear();
          this.teardownTransport();
          this.setStatus('ended');
        }
        break;
      }
      case 'pong':
        break;
    }
  }

  private applyRoomOperation(seq: number, op: RoomOperation): void {
    // Ordered application. Stale redelivery (resync overlap) drops by id.
    if (seq <= this.appliedSeq) {
      if (this.appliedIds.has(op.clientOpId)) return;
      // A lower seq we have not seen implies a divergent history — resync.
      this.transport?.send({ type: 'sync-request', fromSeq: this.appliedSeq });
      return;
    }
    if (seq > this.appliedSeq + 1) {
      // Gap: request catch-up; the host replays the missing range.
      this.transport?.send({ type: 'sync-request', fromSeq: this.appliedSeq });
      return;
    }
    this.appliedSeq = seq;
    this.appliedIds.add(op.clientOpId);
    if (this.appliedIds.size > APPLIED_IDS_LIMIT) {
      const first = this.appliedIds.values().next().value;
      if (first) this.appliedIds.delete(first);
    }
    if (op.actorId === this.actorId) return; // own optimistic application
    this.options.handlers.applyRemoteOperation(op);
  }

  private expirePresence(): void {
    const cutoff = this.nowMs() - PRESENCE_TTL_MS;
    for (const [actorId, entry] of this.cursors) {
      if (entry.at < cutoff) this.cursors.delete(actorId);
    }
    for (const [actorId, entry] of this.selections) {
      if (entry.at < cutoff) this.selections.delete(actorId);
    }
  }

  private teardownTransport(): void {
    if (this.reconnectHandle !== null) {
      this.timers.clearTimeout(this.reconnectHandle);
      this.reconnectHandle = null;
    }
    if (this.presenceTimer !== null) {
      this.timers.clearTimeout(this.presenceTimer);
      this.presenceTimer = null;
    }
    this.transport?.close();
    this.transport = null;
  }
}
