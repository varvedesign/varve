/**
 * The desktop endpoint, seen from the webview.
 *
 * The endpoint itself lives in Rust (`apps/desktop/src-tauri/src/automation_host.rs`)
 * because a webview cannot open a listener. This module is the only place that
 * knows about that split: it starts and stops the endpoint, and it turns the
 * events Rust emits into calls on the same `AutomationHost` the browser build
 * would use, so nothing above this file is platform-aware.
 *
 * The mapping between Rust's events and host connections lives in
 * `createFrameRelay` (`@varve/automation`): lazily-created connections, an
 * explicit "close after this reply", and the protocol's own wording for
 * transport-level refusals. It is shared with the test that drives a real Rust
 * process over stdio, so this bridge and that test run the same code.
 */
import { type ConnectionAcceptor, createFrameRelay } from '@varve/automation';

export type { ConnectionAcceptor };

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
 * Each side keeps doing its own job - Rust owns sockets and limits, the host
 * owns the protocol - and this is the only code that knows they are two things.
 * The mapping itself lives in `createFrameRelay` (`@varve/automation`), shared
 * with the test that drives a real Rust process over stdio, so both run the same
 * code.
 */
export async function attachDesktopRelay(host: ConnectionAcceptor): Promise<RelayHandle> {
  const { invoke, listen } = await tauriModules();
  // A session the window itself ends (a person disconnects an agent) has to be
  // closed at the socket too: Rust owns the socket and cannot see that decision.
  const relay = createFrameRelay(host, {
    closeTransport: (connectionId) => {
      void invoke('automation_close_connection', { connectionId }).catch(() => {
        // The endpoint is already gone; so is the socket.
      });
    },
  });

  const answer = async (requestId: string, frame: string | null, closeAfter: boolean) => {
    try {
      await invoke('automation_reply', { requestId, frame, closeAfter });
    } catch {
      // The endpoint is gone; there is nothing left to answer and the client
      // will see its own connection close.
    }
  };

  const stopFrames = await listen<FrameEventPayload>('automation:frame', async (event) => {
    const { connectionId, requestId, frame } = event.payload;
    const result = await relay.frame(connectionId, frame);
    await answer(requestId, result.frame, result.closeAfter);
  });

  const stopErrors = await listen<TransportErrorPayload>(
    'automation:transport-error',
    async (event) => {
      const { connectionId, requestId, error } = event.payload;
      const result = await relay.transportError(connectionId, error);
      await answer(requestId, result.frame, result.closeAfter);
    },
  );

  // Rust owns the sockets and the webview cannot see them, so a client that
  // simply disconnects is invisible here unless Rust says so. Without this its
  // session stays listed as connected until the connection cap turns real
  // clients away.
  const stopClosed = await listen<{ connectionId: string }>('automation:closed', (event) => {
    relay.closed(event.payload.connectionId);
  });

  return {
    stop() {
      stopFrames();
      stopErrors();
      stopClosed();
      relay.closeAll();
    },
  };
}
