/**
 * Socket server for the control protocol (Unix domain socket, or a named pipe
 * on Windows). One `ControlConnection` per client; the transport only moves
 * bytes: frame, enforce the size limit, honor backpressure, close.
 */
import { timingSafeEqual } from 'node:crypto';
import { chmodSync, rmSync } from 'node:fs';
import net from 'node:net';
import {
  ControlConnection,
  type ControlServerConfig,
  LineFramer,
  type Principal,
} from '@varve/automation';

export interface ControlServerOptions {
  endpoint: string;
  token: string;
  /** Principal granted to a client that presents the token. */
  principal: (client: { name: string; version?: string }) => Principal;
  config: Omit<ControlServerConfig, 'authenticate'>;
  maxConnections?: number;
  onConnectionCount?: (count: number) => void;
}

export interface RunningControlServer {
  endpoint: string;
  connections(): number;
  close(): Promise<void>;
}

function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function startControlServer(options: ControlServerOptions): Promise<RunningControlServer> {
  const maxConnections = options.maxConnections ?? 8;
  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    if (sockets.size >= maxConnections) {
      socket.end(
        '{"jsonrpc":"2.0","id":null,"error":{"code":-32001,"message":"too many connections"}}\n',
      );
      return;
    }
    sockets.add(socket);
    options.onConnectionCount?.(sockets.size);

    const connection = new ControlConnection({
      ...options.config,
      authenticate: (credential, client) =>
        tokenMatches(credential, options.token) ? options.principal(client) : null,
    });

    const write = (text: string): void => {
      if (socket.destroyed) return;
      if (!socket.write(`${text}\n`)) {
        socket.pause();
        socket.once('drain', () => socket.resume());
      }
    };
    const finish = (): void => {
      connection.close();
      if (!socket.destroyed) socket.end();
    };

    const framer = new LineFramer(connection.maxFrameBytes, {
      onLine: (line) => {
        void connection.handleLine(line).then((response) => {
          if (response !== null) write(response);
          if (connection.shouldClose) finish();
        });
      },
      onOverflow: () => {
        write(connection.onOverflow());
        finish();
      },
      onInvalidUtf8: () => {
        write(connection.onInvalidUtf8());
        finish();
      },
    });

    const helloTimer = setTimeout(() => {
      const message = connection.onHelloTimeout();
      if (message !== null) {
        write(message);
        finish();
      }
    }, connection.helloTimeoutMs);
    helloTimer.unref();

    socket.on('data', (chunk: Buffer) => {
      framer.setMaxLineBytes(connection.maxFrameBytes);
      framer.push(chunk);
    });
    socket.on('end', () => framer.end());
    socket.on('error', () => {
      // A peer reset is not an error for the server.
    });
    socket.on('close', () => {
      clearTimeout(helloTimer);
      connection.close();
      sockets.delete(socket);
      options.onConnectionCount?.(sockets.size);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.endpoint, () => {
      server.off('error', reject);
      if (process.platform !== 'win32') {
        try {
          chmodSync(options.endpoint, 0o600);
        } catch {
          // The 0700 directory is the primary control; the socket mode is defense in depth.
        }
      }
      resolve({
        endpoint: options.endpoint,
        connections: () => sockets.size,
        close: () =>
          new Promise<void>((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => {
              if (process.platform !== 'win32') {
                try {
                  rmSync(options.endpoint, { force: true });
                } catch {
                  // best effort
                }
              }
              done();
            });
          }),
      });
    });
  });
}
