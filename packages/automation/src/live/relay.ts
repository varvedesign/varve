/**
 * The mapping between a transport's events and a host's connections.
 *
 * The desktop endpoint is a socket owned by Rust; the protocol is owned by the
 * host in TypeScript. This is the whole of what lies between them, written once
 * and without any platform import, so the desktop bridge (Tauri events) and a
 * test (a child process speaking the same payloads over stdio) run the *same*
 * code and a difference between them cannot hide here.
 *
 * Two mappings are places where a bridge can quietly lose information, so both
 * are stated:
 *
 * - **A transport connection id becomes a host connection lazily**, on first
 *   sight. Rust owns the socket's lifetime; the protocol's per-connection state
 *   (handshake, limits, close intent) lives in the host's connection. A
 *   connection the host refuses because it is full is answered with "close":
 *   the honest outcome of a resource limit, not an invented error frame.
 * - **`closeAfter` is sent back explicitly.** If the protocol decides to end a
 *   session and the transport is not told, the socket stays open on a session
 *   the protocol believes is finished.
 */
import type { AutomationHost, HostConnection } from './host';

/** Anything that can open a connection: the host, or a controller that owns one. */
export type ConnectionAcceptor = Pick<AutomationHost, 'open'>;

/** What to write back, and whether to close afterwards. `frame: null` writes nothing. */
export interface RelayAnswer {
  frame: string | null;
  closeAfter: boolean;
}

/** The transport-level refusals the protocol owns the wording of. */
export type RelayTransportError =
  | { kind: 'frame-too-large' }
  | { kind: 'invalid-utf8' }
  | { kind: 'hello-timeout' }
  | { kind: string };

export interface FrameRelayCore {
  /** One complete frame arrived on a connection. */
  frame(connectionId: string, frame: string): Promise<RelayAnswer>;
  /** The transport refused something before the protocol saw it. */
  transportError(connectionId: string, error: RelayTransportError): Promise<RelayAnswer>;
  /** A connection ended (the peer left, or the transport closed it). */
  closed(connectionId: string): void;
  /** Close every connection this relay opened. */
  closeAll(): void;
  /** Connections currently held, for diagnostics and tests. */
  readonly open: number;
}

export function createFrameRelay(host: ConnectionAcceptor): FrameRelayCore {
  const connections = new Map<string, HostConnection>();

  const connectionFor = (connectionId: string): HostConnection | null => {
    const existing = connections.get(connectionId);
    if (existing) return existing;
    const opened = host.open({ transport: 'ipc' });
    if (!opened.ok) return null;
    connections.set(connectionId, opened.connection);
    return opened.connection;
  };

  const forget = (connectionId: string): void => {
    connections.get(connectionId)?.close();
    connections.delete(connectionId);
  };

  return {
    async frame(connectionId, frame) {
      const connection = connectionFor(connectionId);
      if (!connection) return { frame: null, closeAfter: true };
      const response = await connection.handleLine(frame);
      const closeAfter = connection.shouldClose;
      if (closeAfter) forget(connectionId);
      return { frame: response, closeAfter };
    },

    async transportError(connectionId, error) {
      const connection = connectionFor(connectionId);
      let frame: string | null = null;
      if (connection) {
        // The protocol owns the wording of its own refusals.
        if (error.kind === 'frame-too-large') frame = connection.onOverflow();
        else if (error.kind === 'invalid-utf8') frame = connection.onInvalidUtf8();
        else if (error.kind === 'hello-timeout') frame = connection.onHelloTimeout();
      }
      forget(connectionId);
      return { frame, closeAfter: true };
    },

    closed(connectionId) {
      forget(connectionId);
    },

    closeAll() {
      for (const connection of connections.values()) connection.close();
      connections.clear();
    },

    get open() {
      return connections.size;
    },
  };
}
