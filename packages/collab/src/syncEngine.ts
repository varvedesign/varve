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

import type { CapturedChange } from '@varve/scene';
import { planChunkedOperation } from './chunkedOperation';
import { mintClientId } from './identity';
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
  utf8ByteLength,
  type ViewportPresence,
} from './protocol';

export interface CollabTransport {
  /** Open the underlying connection. Idempotent. */
  connect(): void;
  /** Send one client frame. Returns false when the link is down. */
  send(message: ClientMessage): boolean;
  /**
   * Send an already-serialized frame. Chunked uploads need the reassembled
   * text to be byte-identical to what the sender hashed, so the operation
   * path serializes once and hands the text over rather than re-serializing.
   * Returns false when the link is down.
   */
  sendFrame(text: string): boolean;
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
  /**
   * Replace the whole document from the authoritative snapshot.
   *
   * Return `false` when the snapshot cannot be loaded at all. The engine then
   * refuses the session instead of continuing into a room whose baseline this
   * client does not share — which would fail validation on every incoming
   * operation and resynchronize forever.
   */
  applySnapshot(documentJson: string, uptoSeq: number): boolean;
  /** Apply one remote capture (never the local participant's own). */
  applyRemoteOperation(op: RoomOperation): void;
  /** Presence and roster changes (already TTL-filtered). */
  onRoster(participants: ParticipantInfo[]): void;
  onCursor(actorId: string, cursor: CursorPresence): void;
  onSelection(actorId: string, selection: SelectionPresence): void;
  /** Spotlight/viewport broadcast from a remote participant. */
  onViewport(actorId: string, viewport: ViewportPresence): void;
  /** Spotlight/viewport broadcast from a remote participant. */
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
const EMPTY_IDS: ReadonlySet<string> = new Set();
/**
 * Liveness heartbeat. The host treats a silent socket as dead after its idle
 * window, so the client must speak even when the user is only watching. Well
 * under the 15-minute default: background tabs are throttled to roughly one
 * timer run per minute, which still beats the window.
 */
const HEARTBEAT_MS = 30_000;

/**
 * Conflict keys for one captured change (see `withoutConflictingChanges`).
 * Property-level for value edits so disjoint properties never block each
 * other; an entity-level key is added for creation and deletion, because a
 * peer cannot legitimately have a concurrent change to an entity this client
 * has only just created or removed.
 */
export function changeConflictKeys(change: CapturedChange): string[] {
  const keys = [change.propertyPath ?? `entity:${change.entityId}`];
  if (change.changeType === 'added' || change.changeType === 'removed') {
    keys.push(`entity:${change.entityId}`);
  }
  return keys;
}

/** Conflict keys for every change an operation carries. */
export function operationConflictKeys(op: RoomOperation): string[] {
  const keys: string[] = [];
  for (const change of op.capture.changes) keys.push(...changeConflictKeys(change));
  return keys;
}

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
  private heartbeatHandle: unknown = null;
  private chatDraftTimer: unknown = null;
  private pendingChatDraft: { messageId: string; text: string } | null = null;
  private readonly cursors = new Map<string, { cursor: CursorPresence; at: number }>();
  private readonly selections = new Map<string, { selection: SelectionPresence; at: number }>();
  private readonly viewports = new Map<string, { viewport: ViewportPresence; at: number }>();
  private viewportTimer: unknown = null;
  private lastViewportSent: ViewportPresence | null = null;
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
   * live or the operation cannot be framed (the caller keeps the local
   * state; the op is queued if the engine is reconnecting, dropped with a
   * notice only when idle/ended).
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
    return this.sendOperation(op);
  }

  /**
   * Frame one operation: inline when it fits, chunked when it does not. The
   * host reassembles and validates it identically either way, so the only
   * difference a large edit makes is which frames carry it.
   */
  private sendOperation(op: RoomOperation): boolean {
    const transport = this.transport;
    if (!transport) return false;
    const text = JSON.stringify({ type: 'operation', op } satisfies ClientMessage);
    if (utf8ByteLength(text) <= PROTOCOL_LIMITS.maxOperationBytes) {
      return transport.sendFrame(text);
    }
    const plan = planChunkedOperation(text, mintClientId());
    if (!plan.ok) {
      // Larger than the host will ever accept. Never silent: the caller
      // surfaces this and the local edit stays in the document and in the
      // participant's own history.
      this.pending.delete(op.clientOpId);
      this.options.handlers.onNotice({
        code: 'operation-rejected',
        message: `This change is too large to share (${Math.ceil(plan.totalBytes / 1_000_000)} MB). It stays in your local document.`,
        clientOpId: op.clientOpId,
      });
      return false;
    }
    if (
      !transport.sendFrame(
        JSON.stringify({
          type: 'operation-begin',
          uploadId: plan.uploadId,
          totalBytes: plan.totalBytes,
          chunkCount: plan.chunkCount,
          digest: plan.digest,
        } satisfies ClientMessage),
      )
    ) {
      return false;
    }
    for (let index = 0; index < plan.chunks.length; index++) {
      const sent = transport.sendFrame(
        JSON.stringify({
          type: 'operation-chunk',
          uploadId: plan.uploadId,
          index,
          data: plan.chunks[index]!,
        } satisfies ClientMessage),
      );
      if (!sent) return false;
    }
    return transport.sendFrame(
      JSON.stringify({ type: 'operation-end', uploadId: plan.uploadId } satisfies ClientMessage),
    );
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

  /**
   * Publish the local camera viewport. While `spotlighting` is true the
   * participant invites followers; following remains a per-viewer opt-in
   * and is cancelled by any local camera interaction (never forced).
   */
  sendViewport(
    pageId: string | null,
    centerX: number,
    centerY: number,
    zoom: number,
    spotlighting: boolean,
  ): void {
    this.lastViewportSent = { pageId, centerX, centerY, zoom, spotlighting };
    if (this.viewportTimer !== null) return;
    this.viewportTimer = this.timers.setTimeout(() => {
      this.viewportTimer = null;
      const viewport = this.lastViewportSent;
      if (viewport && this.status === 'live') {
        this.transport?.send({ type: 'viewport', ...viewport });
      }
    }, 1000 / PROTOCOL_LIMITS.presenceHz);
  }

  /**
   * Publish a cursor-chat frame.
   *
   * Draft updates are coalesced: a keystroke must not cost a frame, and the
   * host rate-limits finalized messages, so spending that budget on drafts
   * would silently drop the message the author actually sent. A finalized
   * frame (including an empty one that withdraws the draft) is sent
   * immediately, and any un-sent draft is cancelled first so it can never be
   * relayed after it (which would re-open the bubble with stale text).
   */
  sendChat(text: string, messageId: string, composing: boolean): boolean {
    if (this.status !== 'live') return false;
    const bounded = text.slice(0, PROTOCOL_LIMITS.maxChatLength);
    if (!composing) {
      if (this.chatDraftTimer !== null) {
        this.timers.clearTimeout(this.chatDraftTimer);
        this.chatDraftTimer = null;
      }
      this.pendingChatDraft = null;
      return (
        this.transport?.send({
          type: 'chat',
          message: {
            messageId,
            actorId: this.actorId ?? '',
            text: bounded,
            composing: false,
          },
        }) ?? false
      );
    }
    if (bounded.length === 0) return false;
    this.pendingChatDraft = { messageId, text: bounded };
    if (this.chatDraftTimer !== null) return true;
    this.chatDraftTimer = this.timers.setTimeout(() => {
      this.chatDraftTimer = null;
      const draft = this.pendingChatDraft;
      if (draft && this.status === 'live') {
        this.transport?.send({
          type: 'chat',
          message: {
            messageId: draft.messageId,
            actorId: this.actorId ?? '',
            text: draft.text,
            composing: true,
          },
        });
      }
    }, 1000 / PROTOCOL_LIMITS.chatDraftHz);
    return true;
  }

  /** True when the op is ours and still unacknowledged. */
  isPending(clientOpId: string): boolean {
    return this.pending.has(clientOpId);
  }

  /**
   * Keys of local changes whose acknowledgement is still outstanding, for the
   * conflict rule below. `journaledIds` names pending operations the catch-up
   * replay has already shown to be ordered — those block nothing, because the
   * room has already decided where they sit.
   */
  private blockedKeys(journaledIds: ReadonlySet<string>): Set<string> {
    const blocked = new Set<string>();
    for (const [clientOpId, entry] of this.pending) {
      if (journaledIds.has(clientOpId)) continue;
      for (const change of entry.op.capture.changes) {
        for (const key of changeConflictKeys(change)) blocked.add(key);
      }
    }
    return blocked;
  }

  /**
   * The Figma anti-flicker rule (see docs/research/collaboration-failure-evidence-2026-10-15.md):
   * a change arriving from the host that conflicts with a local change this
   * client has not had acknowledged is DISCARDED, because the host
   * acknowledges a change to its sender before relaying it and a WebSocket
   * preserves per-connection order. An incoming conflicting change with no
   * acknowledgement for mine therefore means mine has not been ordered yet:
   * the room will order mine later, so my optimistic value is the room's
   * future value.
   *
   * Without this rule the local value is silently replaced and never
   * restored — own operations are not echoed back — so the two participants
   * settle on different values for the same property.
   */
  private withoutConflictingChanges(
    op: RoomOperation,
    blocked: ReadonlySet<string>,
  ): RoomOperation {
    if (blocked.size === 0 || op.capture.changes.length === 0) return op;
    const kept = op.capture.changes.filter(
      (change) => !changeConflictKeys(change).some((key) => blocked.has(key)),
    );
    if (kept.length === op.capture.changes.length) return op;
    return { ...op, capture: { ...op.capture, changes: kept } };
  }

  /**
   * Re-apply unacknowledged local captures on top of an authoritative
   * snapshot. A bootstrap snapshot replaces the whole document, so without
   * this an offline edit is lost locally the moment it reconnects and is then
   * re-sent — leaving this participant and the room permanently different.
   * This is Figma's "reapplies any offline edits on top of this latest state".
   */
  private reapplyPendingCaptures(): void {
    for (const entry of [...this.pending.values()]) {
      this.options.handlers.applyRemoteOperation(entry.op);
    }
  }

  /** Mark the pending operations a catch-up replay proved to be ordered. */
  private settleJournaled(operations: ReadonlyArray<{ op: RoomOperation }>): Set<string> {
    const journaled = new Set<string>();
    for (const entry of operations) {
      if (this.pending.has(entry.op.clientOpId)) journaled.add(entry.op.clientOpId);
    }
    return journaled;
  }

  /**
   * Re-send every unacknowledged operation. Idempotent by `clientOpId`, so a
   * resend of one the host already journaled is re-acknowledged rather than
   * applied twice. Used by both the join handshake and a mid-session snapshot.
   */
  private resendPending(): void {
    for (const pending of this.pending.values()) {
      this.sendOperation(pending.op);
      pending.sentAt = this.nowMs();
    }
  }

  /** Ask the host to replay everything after our last applied sequence. */
  resync(): void {
    if (this.status === 'live' || this.status === 'syncing') {
      this.transport?.send({ type: 'sync-request', fromSeq: this.appliedSeq });
    }
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

  /** TTL-filtered spotlight/viewport broadcasts, spotlighting first. */
  liveViewports(): Array<{ actorId: string; viewport: ViewportPresence }> {
    this.expirePresence();
    return [...this.viewports.entries()]
      .map(([actorId, entry]) => ({ actorId, viewport: entry.viewport }))
      .sort((a, b) => Number(b.viewport.spotlighting) - Number(a.viewport.spotlighting));
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
      if (transport !== this.transport) return; // superseded socket
      transport.send({
        type: 'hello',
        protocol: COLLAB_PROTOCOL_VERSION,
        token: this.options.inviteToken,
        clientId: this.options.clientId,
        displayName: this.options.displayName,
      });
    });
    transport.onFrame((data) => {
      // A superseded socket must not feed the engine: two live sockets would
      // double-apply snapshots and presence.
      if (transport !== this.transport) return;
      this.handleFrame(data);
    });
    transport.onDisconnect(() => {
      if (transport !== this.transport) return; // late close of an old socket
      this.handleDisconnect();
    });
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
    if (this.reconnectHandle !== null) return; // a reconnect is already queued
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
        const loaded = this.options.handlers.applySnapshot(
          message.snapshot.documentJson,
          message.snapshot.uptoSeq,
        );
        if (!loaded) {
          // The room's document is unusable for this client: end the session
          // visibly rather than joining a room we cannot apply.
          this.endedReason = 'The room document could not be loaded.';
          this.pending.clear();
          this.teardownTransport();
          this.setStatus('ended');
          this.options.handlers.onNotice({
            code: 'protocol-error',
            message: 'The room document could not be loaded, so the session was not joined.',
          });
          break;
        }
        // The snapshot replaced the document: unacknowledged local work is
        // re-applied on top of it and then re-sent (idempotent by clientOpId).
        this.reapplyPendingCaptures();
        this.options.handlers.onRoster(message.participants);
        this.setStatus('live');
        this.startHeartbeat();
        this.resendPending();
        break;
      }
      case 'operation': {
        this.applyRoomOperation(message.seq, message.op);
        break;
      }
      case 'operation-accepted': {
        // The watermark this advances is what makes an operation ordered
        // BEFORE my own accepted change unappliable: `applyRoomOperation`
        // refuses anything at or below `appliedSeq`, so a late replay of an
        // earlier contribution can never overwrite my later value.
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
      case 'operation-upload-rejected': {
        // The chunked upload never became an operation: it was never
        // journaled, so it stays pending local work. Retry happens on the
        // next reconnect (or when the caller re-submits after a fix), and the
        // reason is always surfaced rather than swallowed.
        this.options.handlers.onNotice({
          code: 'operation-rejected',
          message: message.reason,
        });
        break;
      }
      case 'sync': {
        // Catch-up replay: it tells us the truth about ordering. A pending
        // change that appears here is already ordered, so it is settled and
        // blocks nothing; a change that does not appear will be ordered after
        // everything in this replay and therefore keeps its local value.
        //
        // Blocking is per ENTRY. My own settled change at a HIGHER sequence
        // than an incoming change means mine is the room's later value, so
        // that incoming change must be discarded: applying it and then
        // skipping my own op as "already applied" would leave this client on
        // the other participant's value while the room holds mine, forever.
        const journaled = this.settleJournaled(message.operations);
        for (const entry of message.operations) {
          if (!journaled.has(entry.op.clientOpId)) continue;
          this.pending.delete(entry.op.clientOpId);
        }
        const unsettled = this.blockedKeys(journaled);
        for (const entry of message.operations) {
          this.applyRoomOperation(entry.seq, entry.op, unsettled);
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
        if (
          !this.options.handlers.applySnapshot(
            message.snapshot.documentJson,
            message.snapshot.uptoSeq,
          )
        ) {
          this.options.handlers.onNotice({
            code: 'protocol-error',
            message: 'The room document could not be loaded; asking the host for a fresh baseline.',
          });
          this.transport?.send({ type: 'sync-request', fromSeq: this.appliedSeq });
          break;
        }
        // Same as `welcome`: a snapshot cannot contain unacknowledged local
        // work, so it is re-applied on top and re-sent. The host cannot tell
        // us whether it already had it, so the operation stays pending until
        // it is acknowledged (idempotent by clientOpId).
        this.reapplyPendingCaptures();
        this.resendPending();
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
        this.viewports.delete(message.actorId);
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
      case 'presence-viewport': {
        if (message.actorId !== this.actorId) {
          this.viewports.set(message.actorId, { viewport: message.viewport, at: this.nowMs() });
          this.options.handlers.onViewport(message.actorId, message.viewport);
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
  private applyRoomOperation(
    seq: number,
    op: RoomOperation,
    blocked: ReadonlySet<string> = this.blockedKeys(EMPTY_IDS),
  ): void {
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
    const filtered = this.withoutConflictingChanges(op, blocked);
    // Everything this operation carried was superseded by unacknowledged
    // local work: there is nothing left to apply (and nothing to mark dirty).
    if (filtered.capture.changes.length === 0) return;
    this.options.handlers.applyRemoteOperation(filtered);
  }

  private expirePresence(): void {
    const cutoff = this.nowMs() - PRESENCE_TTL_MS;
    for (const [actorId, entry] of this.cursors) {
      if (entry.at < cutoff) this.cursors.delete(actorId);
    }
    for (const [actorId, entry] of this.selections) {
      if (entry.at < cutoff) this.selections.delete(actorId);
    }
    for (const [actorId, entry] of this.viewports) {
      if (entry.at < cutoff) this.viewports.delete(actorId);
    }
  }

  /**
   * Keep the socket alive while the user watches without acting. The host
   * reaps silent sockets, so a heartbeat is required for a participant who is
   * only reading; presence frames alone are not a liveness signal.
   */
  private startHeartbeat(): void {
    if (this.heartbeatHandle !== null) return;
    const beat = () => {
      this.heartbeatHandle = this.timers.setTimeout(() => {
        this.heartbeatHandle = null;
        if (this.leaving || this.endedReason) return;
        if (this.status === 'live' || this.status === 'reconnecting') {
          this.transport?.send({ type: 'ping' });
          beat();
        }
      }, HEARTBEAT_MS);
    };
    beat();
  }

  private teardownTransport(): void {
    if (this.reconnectHandle !== null) {
      this.timers.clearTimeout(this.reconnectHandle);
      this.reconnectHandle = null;
    }
    if (this.heartbeatHandle !== null) {
      this.timers.clearTimeout(this.heartbeatHandle);
      this.heartbeatHandle = null;
    }
    if (this.presenceTimer !== null) {
      this.timers.clearTimeout(this.presenceTimer);
      this.presenceTimer = null;
    }
    if (this.chatDraftTimer !== null) {
      this.timers.clearTimeout(this.chatDraftTimer);
      this.chatDraftTimer = null;
    }
    this.pendingChatDraft = null;
    if (this.viewportTimer !== null) {
      this.timers.clearTimeout(this.viewportTimer);
      this.viewportTimer = null;
    }
    this.transport?.close();
    this.transport = null;
  }
}
