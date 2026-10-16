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
import { Button, Dialog } from '@varve/ui';
import { useEffect, useState } from 'react';
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
  const [appHostSupported, setAppHostSupported] = useState(false);

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
            <div className="collab-share__tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'host'}
                className={`collab-share__tab${tab === 'host' ? ' is-active' : ''}`}
                onClick={() => setTab('host')}
              >
                Host
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'join'}
                className={`collab-share__tab${tab === 'join' ? ' is-active' : ''}`}
                onClick={() => setTab('join')}
              >
                Join
              </button>
            </div>

            {tab === 'host' && (
              <section className="collab-share__section">
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
                {hosted && (
                  <div className="collab-share__hosted">
                    <p className="collab-share__hint">
                      Room <strong>{hosted.roomId}</strong> is ready. Invite links carry the token
                      in the fragment, so it stays out of server logs. Local hosting is reachable on
                      this machine only; for LAN or internet sessions run your own server over TLS.
                    </p>
                    <label htmlFor="collab-share-invite">Owner invite link</label>
                    <input
                      id="collab-share-invite"
                      readOnly
                      value={inviteLink}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <div className="collab-share__actions">
                      <Button size="sm" variant="default" onClick={startHostedSession}>
                        Start sharing now
                      </Button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {tab === 'join' && (
              <section className="collab-share__section">
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
