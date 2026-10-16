/**
 * One control-channel connection: handshake, authentication and dispatch.
 *
 * Transport-independent. A transport (Unix socket, named pipe, loopback TCP,
 * the desktop bridge, a test) owns the byte stream and the `LineFramer`, feeds
 * complete lines to `handleLine`, and writes back what it returns. Trust is
 * decided here and only here: the principal is whatever `authenticate`
 * returns for the credential presented in `session.hello`, never anything the
 * caller asserts about itself.
 */
import type { IdRng } from '@varve/scene';
import type { DocumentAuthority } from '../authority';
import type { CommandEffect } from '../catalog';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ExecutionPolicy,
  Executor,
  ExecutorContext,
  ExternalHandler,
} from '../executor';
import type { Principal } from '../principal';
import { type Infer, s, validateUnknown } from '../schema';
import { encodeError, encodeResult, parseFrame, RPC_ERROR, type RpcRequest } from './jsonrpc';

export const CONTROL_PROTOCOL = 'varve.control/1';

export interface ControlLimits {
  /** Largest accepted frame after authentication. */
  maxFrameBytes: number;
  /** Largest accepted frame before authentication. */
  maxPreAuthFrameBytes: number;
  /** Largest response the server will write. */
  maxResponseBytes: number;
  /** Time a connection has to send `session.hello`. */
  helloTimeoutMs: number;
  /** Failed credentials tolerated before the connection is closed. */
  maxAuthFailures: number;
}

export const DEFAULT_CONTROL_LIMITS: ControlLimits = {
  maxFrameBytes: 4 * 1024 * 1024,
  maxPreAuthFrameBytes: 4 * 1024,
  maxResponseBytes: 16 * 1024 * 1024,
  helloTimeoutMs: 5000,
  maxAuthFailures: 3,
};

export interface ControlServerConfig {
  executor: Executor;
  authority: DocumentAuthority;
  externals?: Readonly<Record<string, ExternalHandler>>;
  /**
   * Host policy for this connection: refuses effects the session is currently
   * not permitted to run (automation paused, client revoked). Supplied by the
   * transport's host, never by request data, and it can only refuse.
   */
  policy?: ExecutionPolicy;
  /**
   * Holds each change for a person's decision. Supplied by the trusted host (a
   * UI), never reachable from a request, and there is no method an agent can
   * call to approve its own work.
   */
  approval?: (request: ApprovalRequest) => Promise<ApprovalDecision>;
  /** Map a presented credential to a principal, or `null` to refuse it. */
  authenticate(
    credential: string,
    client: { name: string; version?: string },
  ): Principal | null | Promise<Principal | null>;
  serverInfo: { name: string; version: string };
  limits?: Partial<ControlLimits>;
  rng?: IdRng;
  now?: () => number;
}

const HELLO = s.object({
  credential: s.string({ maxBytes: 512, minLength: 1 }),
  client: s.object({
    name: s.string({ maxBytes: 128, minLength: 1 }),
    version: s.optional(s.string({ maxBytes: 64 })),
  }),
  protocolVersions: s.array(s.string({ maxBytes: 32 }), { minItems: 1, maxItems: 8 }),
});

const CATALOG_LIST = s.object({
  search: s.optional(s.string({ maxBytes: 256 })),
  effect: s.optional(s.enum(['read', 'mutate', 'view', 'job', 'external'] as const)),
  domain: s.optional(s.string({ maxBytes: 64 })),
  limit: s.integer({ min: 1, max: 500, default: 100 }),
});

const CATALOG_DESCRIBE = s.object({ command: s.string({ maxBytes: 128, minLength: 1 }) });
const EMPTY = s.object({});

type ConnectionState = 'awaiting-hello' | 'ready' | 'closed';

export class ControlConnection {
  private current: ConnectionState = 'awaiting-hello';
  private principal: Principal | null = null;
  private authFailures = 0;
  private closeAfterResponse = false;
  private readonly limits: ControlLimits;
  private queue: Promise<unknown> = Promise.resolve();
  readonly openedAt: number;

  constructor(private readonly config: ControlServerConfig) {
    this.limits = { ...DEFAULT_CONTROL_LIMITS, ...config.limits };
    this.openedAt = (config.now ?? Date.now)();
  }

  get state(): ConnectionState {
    return this.current;
  }

  /** True once the transport should close the stream (after flushing). */
  get shouldClose(): boolean {
    return this.closeAfterResponse || this.current === 'closed';
  }

  /** The frame-size limit the transport's framer should currently enforce. */
  get maxFrameBytes(): number {
    return this.current === 'ready' ? this.limits.maxFrameBytes : this.limits.maxPreAuthFrameBytes;
  }

  get helloTimeoutMs(): number {
    return this.limits.helloTimeoutMs;
  }

  /** Response for a framer overflow. The connection closes. */
  onOverflow(): string {
    this.closeAfterResponse = true;
    return encodeError(
      null,
      RPC_ERROR.FRAME_TOO_LARGE,
      `frame exceeds the ${this.maxFrameBytes} byte limit`,
      { limit: this.maxFrameBytes },
    );
  }

  onInvalidUtf8(): string {
    this.closeAfterResponse = true;
    return encodeError(null, RPC_ERROR.PARSE_ERROR, 'frame is not valid UTF-8');
  }

  /** Called by the transport when the hello deadline passes unauthenticated. */
  onHelloTimeout(): string | null {
    if (this.current !== 'awaiting-hello') return null;
    this.closeAfterResponse = true;
    return encodeError(null, RPC_ERROR.SESSION_REQUIRED, 'session.hello was not received in time');
  }

  close(): void {
    this.current = 'closed';
  }

  /**
   * Process one frame. Requests on a connection are handled strictly in order,
   * so a client observes its own commands applied in the order it sent them.
   */
  handleLine(line: string): Promise<string | null> {
    const run = this.queue.then(() => this.process(line));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async process(line: string): Promise<string | null> {
    if (this.current === 'closed') return null;
    const frame = parseFrame(line, { maxBytes: this.maxFrameBytes });
    if (frame.kind === 'error') {
      if (this.current === 'awaiting-hello') this.closeAfterResponse = true;
      return frame.response;
    }
    if (frame.kind === 'notification') {
      // Authored work needs a receipt; a notification cannot carry one.
      if (this.current === 'awaiting-hello') this.closeAfterResponse = true;
      return null;
    }
    const request = frame.request;

    if (this.current === 'awaiting-hello') {
      if (request.method !== 'session.hello') {
        this.closeAfterResponse = true;
        return encodeError(
          request.id,
          RPC_ERROR.SESSION_REQUIRED,
          'the first request must be session.hello',
        );
      }
      return this.hello(request);
    }

    try {
      const response = await this.dispatch(request);
      return this.bounded(request, response);
    } catch (error) {
      return encodeError(
        request.id,
        RPC_ERROR.INTERNAL_ERROR,
        `internal error${error instanceof Error ? `: ${error.name}` : ''}`,
      );
    }
  }

  private bounded(request: RpcRequest, encoded: string): string {
    if (encoded.length > this.limits.maxResponseBytes) {
      return encodeError(
        request.id,
        RPC_ERROR.RESPONSE_TOO_LARGE,
        `the result exceeds ${this.limits.maxResponseBytes} bytes; request less data`,
      );
    }
    return encoded;
  }

  private sessionBlock(): Record<string, unknown> {
    const info = this.config.authority.info();
    return {
      mode: info.mode,
      instanceId: info.instanceId,
      generation: info.generation,
      documentId: info.documentId,
      documentName: info.documentName,
      revision: this.config.authority.getRevision(),
    };
  }

  private async hello(request: RpcRequest): Promise<string> {
    const params = validateUnknown(HELLO, request.params);
    if (!params.ok) {
      this.closeAfterResponse = true;
      return encodeError(request.id, RPC_ERROR.INVALID_PARAMS, 'invalid session.hello', {
        issues: params.issues,
      });
    }
    const value = params.value as Infer<typeof HELLO>;
    if (!value.protocolVersions.includes(CONTROL_PROTOCOL)) {
      this.closeAfterResponse = true;
      return encodeError(
        request.id,
        RPC_ERROR.PROTOCOL_UNSUPPORTED,
        `protocol not supported; this server speaks ${CONTROL_PROTOCOL}`,
        { supported: [CONTROL_PROTOCOL], requested: value.protocolVersions },
      );
    }
    const principal = await this.config.authenticate(value.credential, value.client);
    if (principal === null) {
      this.authFailures += 1;
      if (this.authFailures >= this.limits.maxAuthFailures) this.closeAfterResponse = true;
      return encodeError(request.id, RPC_ERROR.UNAUTHENTICATED, 'credential refused');
    }
    this.principal = principal;
    this.current = 'ready';
    const catalog = this.config.executor.catalog;
    return encodeResult(request.id, {
      protocol: CONTROL_PROTOCOL,
      server: this.config.serverInfo,
      session: this.sessionBlock(),
      principal: {
        id: principal.id,
        label: principal.label,
        kind: principal.kind,
        grants: [...principal.grants],
      },
      catalog: {
        hash: catalog.catalogHash(),
        commands: catalog.list({ principal, runtime: this.config.authority.info().mode }).length,
      },
      limits: {
        maxFrameBytes: this.limits.maxFrameBytes,
        maxResponseBytes: this.limits.maxResponseBytes,
      },
    });
  }

  private context(): ExecutorContext {
    return {
      principal: this.principal as Principal,
      authority: this.config.authority,
      ...(this.config.externals ? { externals: this.config.externals } : {}),
      ...(this.config.policy ? { policy: this.config.policy } : {}),
      ...(this.config.approval ? { approval: this.config.approval } : {}),
      ...(this.config.rng ? { rng: this.config.rng } : {}),
    };
  }

  private async dispatch(request: RpcRequest): Promise<string> {
    const { executor, authority } = this.config;
    const principal = this.principal as Principal;
    switch (request.method) {
      case 'ping': {
        return encodeResult(request.id, { ok: true });
      }
      case 'session.info': {
        const checked = validateUnknown(EMPTY, request.params);
        if (!checked.ok) return invalid(request, checked.issues);
        return encodeResult(request.id, {
          session: this.sessionBlock(),
          catalogHash: executor.catalog.catalogHash(),
          grants: [...principal.grants],
        });
      }
      case 'catalog.list': {
        const checked = validateUnknown(CATALOG_LIST, request.params);
        if (!checked.ok) return invalid(request, checked.issues);
        const p = checked.value as Infer<typeof CATALOG_LIST>;
        const runtime = authority.info().mode;
        let list = p.search
          ? executor.catalog.search(p.search, { principal, runtime, limit: p.limit })
          : executor.catalog.list({ principal, runtime });
        if (p.effect) list = list.filter((c) => c.effect === (p.effect as CommandEffect));
        if (p.domain) list = list.filter((c) => c.id.split('.')[1] === p.domain);
        return encodeResult(request.id, {
          catalogHash: executor.catalog.catalogHash(),
          commands: list.slice(0, p.limit),
        });
      }
      case 'catalog.describe': {
        const checked = validateUnknown(CATALOG_DESCRIBE, request.params);
        if (!checked.ok) return invalid(request, checked.issues);
        const id = (checked.value as Infer<typeof CATALOG_DESCRIBE>).command;
        const description = executor.catalog.describe(id);
        const visible =
          description !== undefined && principal.grants.includes(description.authorization);
        if (!description || !visible) {
          const near = executor.catalog.suggest(id);
          return encodeError(request.id, RPC_ERROR.INVALID_PARAMS, `no command ${id}`, {
            ...(near ? { suggestion: near } : {}),
          });
        }
        return encodeResult(request.id, description);
      }
      case 'command.execute': {
        const receipt = await executor.execute(this.context(), request.params);
        return encodeResult(request.id, receipt);
      }
      case 'batch.execute': {
        const receipt = await executor.executeBatch(this.context(), request.params);
        return encodeResult(request.id, receipt);
      }
      case 'session.close': {
        this.closeAfterResponse = true;
        return encodeResult(request.id, { ok: true });
      }
      default:
        return encodeError(
          request.id,
          RPC_ERROR.METHOD_NOT_FOUND,
          `unknown method ${request.method}`,
        );
    }
  }
}

function invalid(request: RpcRequest, issues: unknown): string {
  return encodeError(request.id, RPC_ERROR.INVALID_PARAMS, `invalid params for ${request.method}`, {
    issues,
  });
}
