/**
 * Control-channel client.
 *
 * Correlates replies by id and ignores everything else: a late reply after a
 * timeout, a duplicate, an id it never sent. A client that accepts "whatever
 * line arrived next" can report another request's success as its own
 * (DeckCraft #718), so every reply must name a request that is still pending.
 */

import net from 'node:net';
import {
  CONTROL_PROTOCOL,
  type ControlConnection,
  LineFramer,
  parseStrictJson,
  RPC_ERROR,
} from '@varve/automation';

export interface LineTransport {
  send(line: string): void;
  onLine(handler: (line: string) => void): void;
  onClose(handler: (error?: Error) => void): void;
  close(): void;
}

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

/** Client-side codes, outside the server's -32000..-32099 application range use. */
export const CLIENT_ERROR = {
  TIMEOUT: -31001,
  CLOSED: -31002,
  MALFORMED_REPLY: -31003,
} as const;

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
  method: string;
}

export interface HelloResult {
  protocol: string;
  server: { name: string; version: string };
  session: {
    mode: 'headless' | 'connected';
    instanceId: string;
    generation: string;
    documentId: string;
    documentName: string;
    revision: number;
  };
  principal: { id: string; label: string; kind: string; grants: string[] };
  catalog: { hash: string; commands: number };
  limits: { maxFrameBytes: number; maxResponseBytes: number };
}

export class ControlClient {
  private nextId = 1;
  private readonly pending = new Map<string | number, Pending>();
  private closedWith: Error | null = null;
  /** Replies that matched no pending request (late, duplicate, or foreign). */
  unsolicited = 0;

  constructor(
    private readonly transport: LineTransport,
    private readonly options: { requestTimeoutMs?: number } = {},
  ) {
    transport.onLine((line) => this.receive(line));
    transport.onClose((error) => {
      this.closedWith = error ?? new RpcError(CLIENT_ERROR.CLOSED, 'connection closed');
      for (const [, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(this.closedWith);
      }
      this.pending.clear();
    });
  }

  private receive(line: string): void {
    const parsed = parseStrictJson(line, { maxBytes: 32 * 1024 * 1024 });
    if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null) {
      this.unsolicited += 1;
      return;
    }
    const message = parsed.value as Record<string, unknown>;
    const id = message.id;
    if ((typeof id !== 'string' && typeof id !== 'number') || !this.pending.has(id)) {
      this.unsolicited += 1;
      return;
    }
    const pending = this.pending.get(id) as Pending;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    const hasResult = 'result' in message;
    const hasError = 'error' in message;
    if (hasResult === hasError) {
      pending.reject(
        new RpcError(CLIENT_ERROR.MALFORMED_REPLY, `malformed reply to ${pending.method}`),
      );
      return;
    }
    if (hasError) {
      const err = message.error as { code?: number; message?: string; data?: unknown };
      pending.reject(
        new RpcError(
          typeof err.code === 'number' ? err.code : RPC_ERROR.INTERNAL_ERROR,
          typeof err.message === 'string' ? err.message : 'error',
          err.data,
        ),
      );
      return;
    }
    pending.resolve(message.result);
  }

  request<T = unknown>(method: string, params: unknown = {}, timeoutMs?: number): Promise<T> {
    if (this.closedWith) return Promise.reject(this.closedWith);
    const id = this.nextId++;
    const limit = timeoutMs ?? this.options.requestTimeoutMs ?? 30_000;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new RpcError(
            CLIENT_ERROR.TIMEOUT,
            `no reply to ${method} within ${limit} ms; the outcome of a mutation is unknown`,
          ),
        );
      }, limit);
      timer.unref?.();
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
        method,
      });
      this.transport.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  hello(credential: string, client: { name: string; version?: string }): Promise<HelloResult> {
    return this.request<HelloResult>('session.hello', {
      credential,
      client,
      protocolVersions: [CONTROL_PROTOCOL],
    });
  }

  close(): void {
    this.transport.close();
  }
}

// ── Transports ──────────────────────────────────────────────────────────────

/** Connect to a Unix socket or named pipe. */
export function connectEndpoint(endpoint: string, timeoutMs = 5000): Promise<LineTransport> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(endpoint);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`timed out connecting to ${endpoint}`));
    }, timeoutMs);
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once('connect', () => {
      clearTimeout(timer);
      let lineHandler: (line: string) => void = () => undefined;
      let closeHandler: (error?: Error) => void = () => undefined;
      let closed = false;
      const framer = new LineFramer(64 * 1024 * 1024, {
        onLine: (line) => lineHandler(line),
        onOverflow: () => {
          socket.destroy(new Error('reply frame exceeds the client limit'));
        },
        onInvalidUtf8: () => {
          socket.destroy(new Error('reply frame is not valid UTF-8'));
        },
      });
      socket.on('data', (chunk: Buffer) => framer.push(chunk));
      socket.on('end', () => framer.end());
      const notifyClose = (error?: Error): void => {
        if (closed) return;
        closed = true;
        closeHandler(error);
      };
      socket.on('error', (error) => notifyClose(error));
      socket.on('close', () => notifyClose());
      resolve({
        send: (line) => {
          socket.write(`${line}\n`);
        },
        onLine: (handler) => {
          lineHandler = handler;
        },
        onClose: (handler) => {
          closeHandler = handler;
        },
        close: () => socket.end(),
      });
    });
  });
}

/** In-process transport onto a `ControlConnection`: the same protocol, no socket. */
export function loopbackTransport(connection: ControlConnection): LineTransport {
  let lineHandler: (line: string) => void = () => undefined;
  let closeHandler: (error?: Error) => void = () => undefined;
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    connection.close();
    queueMicrotask(() => closeHandler());
  };
  return {
    send: (line) => {
      void connection.handleLine(line).then((response) => {
        if (response !== null) queueMicrotask(() => lineHandler(response));
        if (connection.shouldClose) close();
      });
    },
    onLine: (handler) => {
      lineHandler = handler;
    },
    onClose: (handler) => {
      closeHandler = handler;
    },
    close,
  };
}
