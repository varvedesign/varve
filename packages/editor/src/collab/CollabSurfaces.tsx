/**
 * Collaborative surfaces (ADR-0200): the canvas presence overlay, the
 * header session control, and the layers-panel presence adapter.
 *
 * Everything here is ephemeral presentation over the session context —
 * none of it mutates the document, touches history, or steals focus:
 * - Remote cursors project world coordinates through the editor's own
 *   camera transform (worldToCanvas — the same one the renderer uses, so
 *   zoom, pan, DPI, and rotation stay consistent).
 * - Cursor chat bubbles follow the author's cursor, expire on a TTL, and
 *   render text as textContent (never HTML).
 * - The composer opens on `/` when no text control has focus, is bounded
 *   by the protocol chat limit, and broadcasts live draft updates under a
 *   stable message id (Enter finalizes, Escape clears).
 * - Remote selections render as thin outlines behind the local canvas —
 *   they never steal hit-testing, selection, or keyboard focus.
 * - Following a spotlight applies the author's camera only after an
 *   explicit opt-in and any local interaction cancels it (enforced in the
 *   provider, mirrored in the UI affordances).
 */

import { PROTOCOL_LIMITS } from '@varve/collab';
import { Button } from '@varve/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from '../components/Settings/SettingsContext';
import { useEditor } from '../context';
import { useCollabSession } from './CollabSessionContext';
import { participantColor } from './presencePalette';
import './collab.css';

// ── Canvas presence (cursors, selections, chat) ─────────────────────────────

export function CollabCanvasPresence() {
  const editor = editorOrNull();
  const session = useCollabSessionSafe();
  const settingsCtx = useSettingsSafe();
  if (!editor || !session) return null;
  const activePageId = editor.state.document.activePageId ?? null;
  const showCursors = settingsCtx?.settings.collab.showLiveCursors !== false;

  const visibleCursors = showCursors
    ? session.cursors.filter((entry) => entry.cursor.pageId === activePageId)
    : [];
  const visibleSelections = session.selections.filter(
    (entry) => entry.pageId === activePageId && entry.nodeIds.length > 0,
  );

  return (
    <div className="collab-presence-layer" aria-hidden={false}>
      <svg className="collab-presence-layer__svg" aria-hidden>
        <title>Live collaborators</title>
        {visibleSelections.map((entry) => {
          const owner = session.participants.find((p) => p.actorId === entry.actorId);
          const color = participantColor(owner?.colorIndex ?? fallbackIndex(entry.actorId));
          return entry.nodeIds.slice(0, 8).map((nodeId) => {
            const rect = nodeScreenRect(editor, nodeId);
            if (!rect) return null;
            return (
              <rect
                key={`${entry.actorId}:${nodeId}`}
                className="collab-presence-layer__selection"
                x={rect.x}
                y={rect.y}
                width={rect.width}
                height={rect.height}
                style={{ stroke: color }}
              />
            );
          });
        })}
      </svg>
      {visibleCursors.map((entry) => {
        const screen = editor.worldToCanvas(entry.cursor.x, entry.cursor.y);
        const color = participantColor(
          entry.participant?.colorIndex ?? fallbackIndex(entry.actorId),
        );
        const name = entry.participant?.displayName ?? 'Guest';
        const bubble = session.chat.find((b) => b.actorId === entry.actorId);
        return (
          <div
            key={entry.actorId}
            className="collab-presence-layer__cursor"
            style={{ left: screen.x, top: screen.y }}
          >
            {bubble && (
              <div
                className={`collab-presence-layer__bubble${bubble.composing ? ' is-composing' : ''}`}
                style={{ borderColor: color }}
              >
                <span className="collab-presence-layer__bubble-author" style={{ color }}>
                  {bubble.displayName}
                </span>
                <span className="collab-presence-layer__bubble-text">{bubble.text}</span>
              </div>
            )}
            <svg
              width="18"
              height="22"
              viewBox="0 0 18 22"
              aria-hidden
              focusable="false"
              style={{ color }}
            >
              <title>Cursor</title>
              <polygon points="0,0 3,17 7,13 11,20 14,18.5 10.5,12 16,10" fill="currentColor" />
            </svg>
            <span className="collab-presence-layer__name" style={{ backgroundColor: color }}>
              {name}
            </span>
          </div>
        );
      })}
      <ChatComposer />
    </div>
  );
}

/**
 * Cursor-chat composer: `/` opens it when no text control holds focus.
 * Live drafts broadcast under one message id; Enter sends; Escape or leaving
 * the field clears the draft locally and remotely. A draft is never sent
 * implicitly: an in-progress IME composition is not submitted by Enter (that
 * key belongs to the candidate list), and blurring the field cancels rather
 * than sending a half-typed message.
 */
function ChatComposer() {
  const session = useCollabSessionSafe();
  const [draft, setDraft] = useState('');
  const [messageId, setMessageId] = useState(() => cryptoMessageId());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const active = session !== null && session.session !== null && session.status === 'live';
  // Refs, not state: the close path must see the value the key handler saw,
  // and must fire exactly once per open regardless of which path closed it.
  const draftRef = useRef('');
  const closedRef = useRef(true);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      // ARIA text surfaces are text surfaces too: the project convention
      // (packages/ui Toolbar) also excludes these roles, because stealing the
      // keystroke from an ARIA textbox is the same bug as stealing it from an
      // <input>.
      const role = target?.getAttribute?.('role');
      if (role === 'textbox' || role === 'combobox' || role === 'spinbutton') return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active]);

  if (!active) return null;

  const close = (mode: 'send' | 'cancel') => {
    if (closedRef.current) return;
    closedRef.current = true;
    session?.sendChat(messageId, mode === 'send' ? draftRef.current : '', false);
    draftRef.current = '';
    setDraft('');
    setMessageId(cryptoMessageId());
    inputRef.current?.blur();
  };

  return (
    <div className="collab-chat-composer">
      <label className="collab-chat-composer__label" htmlFor="collab-chat-input">
        Cursor chat
      </label>
      <input
        id="collab-chat-input"
        ref={inputRef}
        className="collab-chat-composer__input"
        value={draft}
        maxLength={PROTOCOL_LIMITS.maxChatLength}
        placeholder="Message collaborators, then press Enter"
        aria-describedby="collab-chat-hint"
        onFocus={() => {
          closedRef.current = false;
        }}
        onChange={(event) => {
          draftRef.current = event.target.value;
          setDraft(event.target.value);
          if (session) session.sendChat(messageId, event.target.value, true);
        }}
        onKeyDown={(event) => {
          // `isComposing` is true for the Enter that commits an IME candidate
          // (Japanese, Chinese, Korean, …): sending there would post a
          // half-composed draft. keyCode 229 covers engines that report the
          // composition only that way.
          const composing = event.nativeEvent.isComposing || event.keyCode === 229;
          if (event.key === 'Enter') {
            event.preventDefault();
            if (!composing) close('send');
          } else if (event.key === 'Escape') {
            event.preventDefault();
            close('cancel');
          }
        }}
        onBlur={() => close('cancel')}
      />
      <span id="collab-chat-hint" className="collab-chat-composer__hint">
        Enter to send · Esc or leaving the field clears it
      </span>
    </div>
  );
}

/**
 * Non-pointer presentation of cursor chat.
 *
 * Bubbles live on the canvas next to a cursor, which a screen-reader user
 * cannot follow. Finalized messages from other participants are announced
 * once, politely. Drafts are never announced — a live draft would fire on
 * every keystroke — and the author's own messages are skipped.
 */
function ChatAnnouncer() {
  const session = useCollabSessionSafe();
  const [announcement, setAnnouncement] = useState('');
  const announcedRef = useRef<Set<string>>(new Set());
  const announcedActorRef = useRef<string | null>(null);

  useEffect(() => {
    if (!session) return;
    // A new session (or actor) starts a fresh announcement history.
    if (announcedActorRef.current !== session.actorId) {
      announcedActorRef.current = session.actorId;
      announcedRef.current = new Set();
    }
    const seen = announcedRef.current;
    while (seen.size > 200) {
      const oldest = seen.values().next().value;
      if (oldest === undefined) break;
      seen.delete(oldest);
    }
    for (const bubble of session.chat) {
      if (bubble.composing || bubble.actorId === session.actorId) continue;
      if (seen.has(bubble.messageId)) continue;
      seen.add(bubble.messageId);
      setAnnouncement(`${bubble.displayName}: ${bubble.text}`);
    }
  }, [session]);

  return (
    <span className="sr-only" role="status" aria-live="polite">
      {announcement}
    </span>
  );
}

// ── Header control (status, participants, Share) ─────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  idle: 'Not sharing',
  connecting: 'Connecting…',
  syncing: 'Synchronizing…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  ended: 'Session ended',
};

export function CollabHeaderControl({ onOpenShare }: { onOpenShare: () => void }) {
  const session = useCollabSessionSafe();
  if (!session) return null;
  const active =
    session.session !== null && session.status !== 'idle' && session.status !== 'ended';
  if (!active) {
    return (
      <Button size="sm" variant="secondary" onClick={onOpenShare}>
        Share
      </Button>
    );
  }
  const statusTone =
    session.status === 'live'
      ? 'is-live'
      : session.status === 'reconnecting'
        ? 'is-warning'
        : 'is-busy';
  return (
    <div className="collab-header-control">
      <span className={`collab-header-control__status ${statusTone}`} role="status">
        {STATUS_LABEL[session.status] ?? session.status}
      </span>
      <ChatAnnouncer />
      <ParticipantAvatars />
      <Button size="sm" variant="secondary" onClick={onOpenShare}>
        Session
      </Button>
    </div>
  );
}

export function ParticipantAvatars() {
  const session = useCollabSessionSafe();
  if (!session) return null;
  const visible = session.participants.slice(0, 3);
  const overflow = Math.max(0, session.participants.length - 3);
  // biome-ignore lint/a11y/useSemanticElements: flex avatar row; a fieldset would add form semantics
  return (
    <div className="collab-avatars">
      {visible.map((participant) => {
        const isSpotlighting = session.spotlights.some(
          (entry) => entry.actorId === participant.actorId && entry.viewport.spotlighting,
        );
        return (
          <button
            key={participant.actorId}
            type="button"
            className="collab-avatars__item"
            style={{ backgroundColor: participantColor(participant.colorIndex) }}
            aria-label={`${participant.displayName}${isSpotlighting ? ' (spotlighting, activate to follow)' : ''}`}
            title={
              isSpotlighting
                ? session.followingActorId === participant.actorId
                  ? 'Stop following'
                  : 'Follow this participant'
                : `${participant.displayName} is not spotlighting`
            }
            onClick={() => {
              if (!isSpotlighting) return;
              session.followActor(
                session.followingActorId === participant.actorId ? null : participant.actorId,
              );
            }}
          >
            {participant.displayName.charAt(0).toUpperCase()}
          </button>
        );
      })}
      {overflow > 0 && (
        <span className="collab-avatars__overflow">
          <span className="sr-only">{overflow} more participants</span>
          <span aria-hidden>+{overflow}</span>
        </span>
      )}
    </div>
  );
}

// ── Layers-panel presence adapter ─────────────────────────────────────────────

export function CollabLayersPresence() {
  const session = useCollabSessionSafe();
  const participants = session?.participants ?? [];
  const presences = useMemo(
    () =>
      participants.map((participant) => ({
        userId: participant.actorId,
        label: participant.displayName,
        color: participantColor(participant.colorIndex),
      })),
    [participants],
  );
  if (presences.length === 0) return null;
  return (
    <section className="layers-row__presence" aria-label={`${presences.length} collaborators`}>
      {presences.slice(0, 3).map((presence) => (
        <div
          key={presence.userId}
          className="layers-row__presence-avatar"
          style={{ backgroundColor: presence.color }}
          role="img"
          aria-label={presence.label}
        >
          {presence.label.charAt(0).toUpperCase()}
        </div>
      ))}
      {presences.length > 3 && (
        <span
          className="layers-row__presence-overflow"
          role="img"
          aria-label={`${presences.length - 3} more collaborators`}
        >
          +{presences.length - 3}
        </span>
      )}
    </section>
  );
}

// ── Notices (non-stealing toast line) ─────────────────────────────────────────

export function CollabNotices() {
  const session = useCollabSessionSafe();
  if (!session || session.notices.length === 0) return null;
  return (
    <div className="collab-notices" role="log" aria-live="polite">
      {session.notices.map((entry) => (
        <div key={entry.id} className="collab-notices__item">
          {entry.notice.message}
        </div>
      ))}
    </div>
  );
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function editorOrNull(): ReturnType<typeof useEditor> | null {
  try {
    return useEditor();
  } catch {
    return null;
  }
}

function useCollabSessionSafe(): ReturnType<typeof useCollabSession> | null {
  try {
    return useCollabSession();
  } catch {
    return null;
  }
}

function useSettingsSafe(): ReturnType<typeof useSettings> | null {
  try {
    return useSettings();
  } catch {
    return null;
  }
}

function fallbackIndex(actorId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < actorId.length; i++) {
    hash ^= actorId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 8;
}

function cryptoMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** Node bounding rect in canvas-screen coordinates through the editor camera. */
function nodeScreenRect(
  editor: ReturnType<typeof useEditor>,
  nodeId: string,
): { x: number; y: number; width: number; height: number } | null {
  const node = editor.state.document.nodes[nodeId as never] as
    | { transform?: number[]; w?: number; h?: number; shape?: { w?: number; h?: number } }
    | undefined;
  if (!node) return null;
  const width = node.w ?? node.shape?.w ?? 0;
  const height = node.h ?? node.shape?.h ?? 0;
  const transform = node.transform ?? [1, 0, 0, 1, 0, 0];
  const x = transform[4] ?? 0;
  const y = transform[5] ?? 0;
  const corners = [
    editor.worldToCanvas(x, y),
    editor.worldToCanvas(x + width, y),
    editor.worldToCanvas(x + width, y + height),
    editor.worldToCanvas(x, y + height),
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}
