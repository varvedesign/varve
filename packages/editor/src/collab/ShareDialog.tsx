/**
 * Share & Collaborate dialog (ADR-0200).
 *
 * Two honest paths, both over the same protocol:
 * - App-hosted (desktop): the desktop app starts its own loopback room
 *   server (Tauri command `collab_host_start`), creates a room seeded with
 *   the current document, and hands out invite links. Reachable from other
 *   apps/tabs on this machine; LAN/internet hosting is the standalone
 *   server's job and is labelled as such.
 * - Self-hosted / remote: join or host on a user-controlled room server by
 *   URL. Hosting on a remote server requires the operator's admin token
 *   (it mints the room owner invite); joining needs only an invite token.
 *
 * Invite links carry the token in the URL FRAGMENT so it never reaches
 * server logs or referrers: http://host:port/join#room=<id>&t=<token>.
 */
import { Button, Dialog, Select } from '@varve/ui';
import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../context';
import { useCollabSession } from './CollabSessionContext';
import './collab.css';

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
}

interface HostedRoom {
  serverBase: string;
  roomId: string;
  ownerToken: string;
  /** How this room is hosted: in-app (stoppable here) or a remote server. */
  mode: 'app' | 'server';
}

export function ShareDialog({ open, onClose }: ShareDialogProps) {
  const editor = useEditor();
  const session = useCollabSession();
  const [tab, setTab] = useState<'host' | 'join'>(session.session ? 'host' : 'join');
  const [serverBase, setServerBase] = useState('http://127.0.0.1:8790');
  const [adminToken, setAdminToken] = useState('');
  const [roomId, setRoomId] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [hosted, setHosted] = useState<HostedRoom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invites, setInvites] = useState<
    Array<{ token: string; role: 'editor' | 'viewer'; link: string }>
  >([]);
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor');
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [appHostSupported, setAppHostSupported] = useState(false);
  const tabRefs = useRef<Record<'host' | 'join', HTMLButtonElement | null>>({
    host: null,
    join: null,
  });

  useEffect(() => {
    let cancelled = false;
    const detect = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('collab_host_status');
        if (!cancelled) setAppHostSupported(true);
      } catch {
        if (!cancelled) setAppHostSupported(false);
      }
    };
    void detect();
    return () => {
      cancelled = true;
    };
  }, []);

  const active =
    session.session !== null && session.status !== 'idle' && session.status !== 'ended';

  const hostOnApp = async () => {
    setBusy(true);
    setError(null);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const status = await invoke<{ port: number }>('collab_host_start');
      const documentJson = editor.serializeDocument();
      const room = await invoke<{ roomId: string; ownerInviteToken: string }>(
        'collab_room_create',
        {
          documentJson,
        },
      );
      setHosted({
        serverBase: `http://127.0.0.1:${status.port}`,
        roomId: room.roomId,
        ownerToken: room.ownerInviteToken,
        mode: 'app',
      });
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setBusy(false);
    }
  };

  const hostOnServer = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${serverBase.replace(/\/$/, '')}/admin/rooms`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-varve-admin-token': adminToken,
        },
        body: JSON.stringify({
          docId: editor.state.document.id,
          documentJson: editor.serializeDocument(),
        }),
      });
      if (!response.ok) {
        setError(
          `The room server refused the request (${response.status}). Check the admin token.`,
        );
        return;
      }
      const created = (await response.json()) as { roomId: string; ownerInviteToken: string };
      setHosted({
        serverBase: serverBase.replace(/\/$/, ''),
        roomId: created.roomId,
        ownerToken: created.ownerInviteToken,
        mode: 'server',
      });
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setBusy(false);
    }
  };

  const joinSession = () => {
    if (!roomId.trim() || !inviteToken.trim()) {
      setError('Enter both the room id and the invite token.');
      return;
    }
    const wsUrl = serverBase
      .replace(/^http/, 'ws')
      .replace(/\/$/, '')
      .concat(`/room/${encodeURIComponent(roomId.trim())}`);
    session.startSession({ roomUrl: wsUrl, inviteToken: inviteToken.trim() });
    onClose();
  };

  const startHostedSession = () => {
    if (!hosted) return;
    session.startSession({
      roomUrl: `${hosted.serverBase.replace(/^http/, 'ws')}/room/${hosted.roomId}`,
      inviteToken: hosted.ownerToken,
    });
    onClose();
  };

  const endSession = () => {
    session.stopSession();
    setHosted(null);
    onClose();
  };

  /**
   * Stop the in-app room host. Rooms live in the app's own storage directory,
   * so stopping closes the listener without deleting anything: a later start
   * reopens the same store on a new port and clients reconnect with their
   * invite tokens. Stopping while this tab is still in the session would pull
   * the listener out from under the participants, so the session must end
   * first.
   */
  const stopAppHost = async () => {
    setBusy(true);
    setError(null);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('collab_host_stop');
      setHosted(null);
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Mint a role-scoped invite for the room this tab is hosting.
   *
   * The app-hosted path mints through the embedded host (its admin token never
   * leaves the process); the self-hosted path uses the operator's admin token
   * the user already entered. Until this existed, every link the app handed out
   * carried OWNER rights, so the host's role enforcement was unreachable.
   */
  const createInvite = async (role: 'editor' | 'viewer') => {
    if (!hosted) return;
    setBusy(true);
    setError(null);
    setInviteStatus(null);
    try {
      let token: string;
      if (hosted.mode === 'app') {
        const { invoke } = await import('@tauri-apps/api/core');
        const created = await invoke<{ inviteToken: string }>('collab_room_invite', {
          roomId: hosted.roomId,
          role,
        });
        token = created.inviteToken;
      } else {
        const response = await fetch(
          `${hosted.serverBase}/admin/rooms/${encodeURIComponent(hosted.roomId)}/invites`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-varve-admin-token': adminToken,
            },
            body: JSON.stringify({ role }),
          },
        );
        if (!response.ok) {
          setError(
            response.status === 401
              ? 'The room server refused the admin token.'
              : `The room server refused the invite (${response.status}).`,
          );
          return;
        }
        token = ((await response.json()) as { inviteToken: string }).inviteToken;
      }
      const link = `${hosted.serverBase}/join#room=${hosted.roomId}&t=${token}`;
      setInvites((current) => [...current, { token, role, link }]);
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Revoke an invite. The host closes its live sessions; copies already
   * received cannot be recalled, which the UI says plainly.
   */
  const revokeInvite = async (token: string) => {
    if (!hosted) return;
    setBusy(true);
    setError(null);
    try {
      if (hosted.mode === 'app') {
        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke<{ revoked: boolean }>('collab_room_revoke', {
          inviteToken: token,
        });
        setInviteStatus(result.revoked ? 'Invite revoked.' : 'That invite was already gone.');
      } else {
        // The server stores only the SHA-256 of the token.
        if (typeof crypto?.subtle?.digest !== 'function') {
          setError('Revoking needs a secure context (https or localhost).');
          return;
        }
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
        const hash = [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
        const response = await fetch(`${hosted.serverBase}/admin/invites/${hash}`, {
          method: 'DELETE',
          headers: { 'x-varve-admin-token': adminToken },
        });
        if (!response.ok && response.status !== 404) {
          setError(`The room server refused the revocation (${response.status}).`);
          return;
        }
        setInviteStatus(
          response.status === 404
            ? 'That invite was already gone.'
            : 'Invite revoked; its live sessions were closed.',
        );
      }
      setInvites((current) => current.filter((entry) => entry.token !== token));
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setBusy(false);
    }
  };

  const sessionUsesHostedRoom =
    active &&
    hosted !== null &&
    session.session?.roomUrl.startsWith(hosted.serverBase.replace(/^http/, 'ws'));

  const inviteLink = hosted
    ? `${hosted.serverBase}/join#room=${hosted.roomId}&t=${hosted.ownerToken}`
    : '';

  return (
    <Dialog open={open} onClose={onClose} title="Share and collaborate">
      <div className="collab-share">
        {active ? (
          <section className="collab-share__section">
            <h3>Current session</h3>
            <p className="collab-share__hint">
              {session.participants.length} participant
              {session.participants.length === 1 ? '' : 's'}. Your changes replicate live; undo
              reverses only your own edits while sharing.
            </p>
            <div className="collab-share__actions">
              <Button size="sm" variant="destructive" onClick={endSession}>
                Leave session
              </Button>
              <Button
                size="sm"
                variant={session.spotlighting ? 'default' : 'secondary'}
                onClick={session.toggleSpotlight}
              >
                {session.spotlighting ? 'Stop spotlighting my view' : 'Spotlight my view'}
              </Button>
              {session.followingActorId && (
                <Button size="sm" variant="secondary" onClick={() => session.followActor(null)}>
                  Stop following
                </Button>
              )}
            </div>
            <p className="collab-share__hint">
              Participants who follow your spotlight see your camera move. They can stop any time;
              your view never moves because someone else follows you.
            </p>
          </section>
        ) : (
          <>
            {/* APG tabs: one tab stop, arrows/Home/End move between them,
                and each tab names the panel it controls. */}
            <div
              className="collab-share__tabs"
              role="tablist"
              aria-label="Share options"
              onKeyDown={(event) => {
                const order: Array<'host' | 'join'> = ['host', 'join'];
                const index = order.indexOf(tab);
                let next: 'host' | 'join' | null = null;
                if (event.key === 'ArrowRight') next = order[(index + 1) % order.length]!;
                else if (event.key === 'ArrowLeft')
                  next = order[(index - 1 + order.length) % order.length]!;
                else if (event.key === 'Home') next = order[0]!;
                else if (event.key === 'End') next = order[order.length - 1]!;
                if (!next) return;
                event.preventDefault();
                setTab(next);
                tabRefs.current[next]?.focus();
              }}
            >
              {(['host', 'join'] as const).map((value) => (
                <button
                  key={value}
                  ref={(element) => {
                    tabRefs.current[value] = element;
                  }}
                  type="button"
                  role="tab"
                  id={`collab-share-tab-${value}`}
                  aria-selected={tab === value}
                  aria-controls={`collab-share-panel-${value}`}
                  tabIndex={tab === value ? 0 : -1}
                  className={`collab-share__tab${tab === value ? ' is-active' : ''}`}
                  onClick={() => setTab(value)}
                >
                  {value === 'host' ? 'Host' : 'Join'}
                </button>
              ))}
            </div>

            {tab === 'host' && (
              <section
                className="collab-share__section"
                role="tabpanel"
                id="collab-share-panel-host"
                aria-labelledby="collab-share-tab-host"
              >
                <h3>Start a live session</h3>
                {appHostSupported && (
                  <div className="collab-share__actions">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => void hostOnApp()}
                      disabled={busy}
                    >
                      Host on this device
                    </Button>
                  </div>
                )}
                {!appHostSupported && (
                  <p className="collab-share__hint">
                    This build cannot host from the app itself. Run the standalone room server (
                    <code>varve-room-server</code>) and host against it below, or join a session
                    someone else started.
                  </p>
                )}
                <div className="collab-share__grid">
                  <label htmlFor="collab-share-server">Room server</label>
                  <input
                    id="collab-share-server"
                    value={serverBase}
                    onChange={(event) => setServerBase(event.target.value)}
                    placeholder="http://127.0.0.1:8790"
                  />
                  <label htmlFor="collab-share-admin">Server admin token</label>
                  <input
                    id="collab-share-admin"
                    type="password"
                    value={adminToken}
                    onChange={(event) => setAdminToken(event.target.value)}
                    placeholder="Only needed to host on a remote server"
                    autoComplete="off"
                  />
                </div>
                <div className="collab-share__actions">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void hostOnServer()}
                    disabled={busy}
                  >
                    Host on this server
                  </Button>
                </div>
              </section>
            )}

            {tab === 'join' && (
              <section
                className="collab-share__section"
                role="tabpanel"
                id="collab-share-panel-join"
                aria-labelledby="collab-share-tab-join"
              >
                <h3>Join a session</h3>
                <div className="collab-share__grid">
                  <label htmlFor="collab-join-server">Room server</label>
                  <input
                    id="collab-join-server"
                    value={serverBase}
                    onChange={(event) => setServerBase(event.target.value)}
                    placeholder="http://127.0.0.1:8790"
                  />
                  <label htmlFor="collab-join-room">Room id</label>
                  <input
                    id="collab-join-room"
                    value={roomId}
                    onChange={(event) => setRoomId(event.target.value)}
                    placeholder="room-…"
                  />
                  <label htmlFor="collab-join-token">Invite token</label>
                  <input
                    id="collab-join-token"
                    type="password"
                    value={inviteToken}
                    onChange={(event) => setInviteToken(event.target.value)}
                    placeholder="From the invite link"
                    autoComplete="off"
                  />
                </div>
                <div className="collab-share__actions">
                  <Button size="sm" variant="default" onClick={joinSession}>
                    Join session
                  </Button>
                </div>
                <p className="collab-share__hint">
                  Joining replaces this tab's document with the room's live copy; your local file
                  stays untouched on disk. Viewers can watch and chat but cannot edit.
                </p>
              </section>
            )}
          </>
        )}

        {/* Reachable whenever a room is hosted — including while a session is
            live, which is when a host actually invites someone. */}
        {hosted && (
          <section className="collab-share__section">
            {hosted && (
              <div className="collab-share__hosted">
                <p className="collab-share__hint">
                  Room <strong>{hosted.roomId}</strong> is ready. Invite links carry the token in
                  the fragment, so it stays out of server logs. Local hosting is reachable on this
                  machine only; for LAN or internet sessions run your own server over TLS.
                </p>
                <label htmlFor="collab-share-invite">Owner invite link</label>
                <input
                  id="collab-share-invite"
                  readOnly
                  value={inviteLink}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <div className="collab-share__actions">
                  {!active && (
                    <Button size="sm" variant="default" onClick={startHostedSession}>
                      Start sharing now
                    </Button>
                  )}
                  {hosted.mode === 'app' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void stopAppHost()}
                      disabled={busy || sessionUsesHostedRoom}
                      disabledReason={
                        sessionUsesHostedRoom
                          ? 'Leave the session first: stopping the host would disconnect everyone on it.'
                          : undefined
                      }
                    >
                      Stop hosting on this device
                    </Button>
                  )}
                </div>
                <div className="collab-share__invite-roles">
                  <label htmlFor="collab-invite-role">Invite someone as</label>
                  <Select
                    id="collab-invite-role"
                    label="Invite role"
                    value={inviteRole}
                    onChange={(value) => setInviteRole(value as 'editor' | 'viewer')}
                    options={[
                      { value: 'editor', label: 'Editor — can change the document' },
                      { value: 'viewer', label: 'Viewer — can watch and use cursor chat' },
                    ]}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void createInvite(inviteRole)}
                    disabled={busy}
                  >
                    Create {inviteRole} link
                  </Button>
                </div>
                <ul className="collab-share__invite-list" aria-label="Invites you created">
                  {invites.map((invite) => (
                    <li key={invite.token}>
                      <span className="collab-share__invite-role">{invite.role}</span>
                      <input
                        readOnly
                        value={invite.link}
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void revokeInvite(invite.token)}
                        disabled={busy}
                      >
                        Revoke
                      </Button>
                    </li>
                  ))}
                </ul>
                {inviteStatus && (
                  <p className="collab-share__hint" role="status">
                    {inviteStatus}
                  </p>
                )}
                <p className="collab-share__hint">
                  Revoking closes the sessions an invite is already using. It cannot recall a copy
                  someone already saved, and the role is enforced by the host, not by this dialog.
                </p>
                {hosted.mode === 'app' && (
                  <p className="collab-share__hint">
                    Stopping closes the local listener. The room stays in this app's storage: a
                    later start reopens it on a new port, and participants rejoin with their invite
                    tokens.
                  </p>
                )}
              </div>
            )}
          </section>
        )}
        {error && (
          <p className="collab-share__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function describeError(reason: unknown): string {
  if (typeof reason === 'string') return reason;
  if (reason instanceof Error) return reason.message;
  return 'The room server could not be reached.';
}
