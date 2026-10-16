/**
 * The desktop endpoint, seen from the webview.
 *
 * The endpoint itself lives in Rust (`apps/desktop/src-tauri/src/automation_host.rs`)
 * because a webview cannot open a listener. This module is the only place that
 * knows about that split: it starts and stops the endpoint, and it turns the
 * events Rust emits into calls on the same `AutomationHost` the browser build
 * would use, so nothing above this file is platform-aware.
 *
 * Two mappings are worth stating plainly, because both are places a bridge can
 * quietly lose information:
 *
 * - **Rust connection ids become host connections lazily.** Rust owns the
 *   socket lifecycle; the protocol's per-connection state (handshake, limits,
 *   close intent) is created here on first sight of a connection id. A
 *   connection Rust refuses because the host is full is answered with
 *   "close", which is the honest outcome of a resource limit.
 * - **`shouldClose` crosses the boundary explicitly.** The protocol decides to
 *   end a session; if that decision were not sent back, Rust would leave a
 *   socket open that the protocol believes is finished.
 */
import type { AutomationHost, HostConnection } from '@varve/automation';

/**
 * Anything that can open a connection onto the current document session: the
 * host itself, or the controller that rebuilds its host when the session
 * changes. The relay needs nothing else, so it depends on nothing else.
 */
export type ConnectionAcceptor = Pick<AutomationHost, 'open'>;

export interface DesktopEndpoint {
  /** Identity shared with the discoverable instance record. */
  instanceId: string;
  /** Socket path, for display and for `varve mcp --connect`. */
  endpoint: string;
  /** The credential the transport minted. Compared by the protocol, not here. */
  credential: string;
}

interface PolicyReply {
  running: boolean;
  endpoint?: string;
  instanceId?: string;
  credential?: string;
}

interface FrameEventPayload {
  connectionId: string;
  requestId: string;
  frame: string;
}

interface TransportErrorPayload {
  connectionId: string;
  requestId: string;
  error: { kind: string };
}

async function tauriModules() {
  const [core, event] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/api/event'),
  ]);
  return { invoke: core.invoke, listen: event.listen };
}

/** Start or re-scope the endpoint. Returns `null` when it is not running. */
export async function applyDesktopPolicy(input: {
  enabled: boolean;
  grants: 'read' | 'edit';
  documentId: string;
  documentName: string;
  instanceId: string;
}): Promise<DesktopEndpoint | null> {
  const { invoke } = await tauriModules();
  const reply = await invoke<PolicyReply>('automation_apply_policy', {
    enabled: input.enabled,
    grants: input.grants,
    documentId: input.documentId,
    documentName: input.documentName,
    instanceId: input.instanceId,
  });
  if (!reply.running) return null;
  if (!reply.endpoint || !reply.instanceId || !reply.credential) {
    // Not a cosmetic failure: without all three a client cannot find the
    // endpoint, and the protocol cannot compare the credential.
    throw new Error(
      'the endpoint reported itself running without an endpoint, identity or credential',
    );
  }
  return {
    endpoint: reply.endpoint,
    instanceId: reply.instanceId,
    credential: reply.credential,
  };
}

/** Inspectable endpoint status. Carries no credential. */
export async function desktopEndpointStatus(): Promise<{
  running: boolean;
  endpoint?: string;
  instanceId?: string;
  openConnections?: number;
}> {
  const { invoke } = await tauriModules();
  return invoke('automation_status');
}

export async function stopDesktopEndpoint(): Promise<void> {
  const { invoke } = await tauriModules();
  await invoke('automation_stop');
}

/** The application version, for the `server` block a client is told. */
export async function desktopAppVersion(): Promise<string> {
  try {
    const { invoke } = await tauriModules();
    void invoke;
    const app = await import('@tauri-apps/api/app');
    return await app.getVersion();
  } catch {
    return 'unknown';
  }
}

export interface RelayHandle {
  stop(): void;
}

/**
 * Connect Rust's endpoint to a host: frames in, replies out.
 *
 * Each side keeps doing its own job — Rust owns sockets and limits, the host
 * owns the protocol — and this is the only code that knows they are two things.
 */
export async function attachDesktopRelay(host: ConnectionAcceptor): Promise<RelayHandle> {
  const { invoke, listen } = await tauriModules();
  const connections = new Map<string, HostConnection>();

  const connectionFor = (rustId: string): HostConnection | null => {
    const existing = connections.get(rustId);
    if (existing) return existing;
    const opened = host.open({ transport: 'ipc' });
    if (!opened.ok) return null;
    connections.set(rustId, opened.connection);
    return opened.connection;
  };

  const answer = async (requestId: string, frame: string | null, closeAfter: boolean) => {
    try {
      await invoke('automation_reply', { requestId, frame, closeAfter });
    } catch {
      // The endpoint is gone; there is nothing left to answer and the client
      // will see its own connection close.
    }
  };

  const forget = (rustId: string) => {
    connections.get(rustId)?.close();
    connections.delete(rustId);
  };

  const stopFrames = await listen<FrameEventPayload>('automation:frame', async (event) => {
    const { connectionId, requestId, frame } = event.payload;
    const connection = connectionFor(connectionId);
    if (!connection) {
      // The host is at its connection limit. Refusing by closing is the honest
      // signal; an invented error frame would be a second protocol.
      await answer(requestId, null, true);
      return;
    }
    const response = await connection.handleLine(frame);
    const closeAfter = connection.shouldClose;
    await answer(requestId, response, closeAfter);
    if (closeAfter) forget(connectionId);
  });

  const stopErrors = await listen<TransportErrorPayload>(
    'automation:transport-error',
    async (event) => {
      const { connectionId, requestId, error } = event.payload;
      const connection = connectionFor(connectionId);
      let frame: string | null = null;
      if (connection) {
        // The protocol owns the wording of its own refusals.
        if (error.kind === 'frame-too-large') frame = connection.onOverflow();
        else if (error.kind === 'invalid-utf8') frame = connection.onInvalidUtf8();
        else if (error.kind === 'hello-timeout') frame = connection.onHelloTimeout();
      }
      await answer(requestId, frame, true);
      forget(connectionId);
    },
  );

  return {
    stop() {
      stopFrames();
      stopErrors();
      for (const connection of connections.values()) connection.close();
      connections.clear();
    },
  };
}
