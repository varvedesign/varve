/**
 * Automation host: the object a transport accepts connections into.
 *
 * It exists so the transport and the policy are separable. A Unix socket, a
 * named pipe, a desktop bridge or a test all end up calling `open()` and
 * feeding lines to the returned connection; this class owns everything that
 * must not depend on which one it was:
 *
 * - **One principal per connection.** A credential identifies the client, not
 *   the connection, so two agents attached to one document get two principal
 *   ids. Attribution, idempotency scope and revocation are per connection,
 *   and a receipt can always say which client wrote it.
 * - **A bounded connection count.** A local listener is still a resource a
 *   broken client can exhaust.
 * - **Pause, resume and revoke.** "Stop automation" has to be possible
 *   without closing the editor, discarding unsaved work, or blinding a client
 *   that is only asking what happened.
 *
 * The host never decides trust. `admit` maps a credential the transport
 * already accepted to an admission, and the host mints the principal id from
 * it; nothing in a request can influence either.
 */
import type { IdRng } from '@varve/scene';
import { sha256Utf8 } from '@varve/scene';
import type { DocumentAuthority } from '../authority';
import type { CommandEffect } from '../catalog';
import {
  CONTROL_PROTOCOL,
  ControlConnection,
  type ControlLimits,
  DEFAULT_CONTROL_LIMITS,
} from '../control/connection';
import type {
  ApprovalDecision,
  ApprovalRequest,
  ExecutionPolicy,
  Executor,
  ExternalHandler,
} from '../executor';
import type { AuthorizationClass, Principal, PrincipalKind, TransportKind } from '../principal';

/** What a verified credential is allowed to do. */
export interface Admission {
  grants: readonly AuthorizationClass[];
  label: string;
  kind?: PrincipalKind;
  transport?: TransportKind;
}

export interface AdmissionRequest {
  credential: string;
  client: { name: string; version?: string };
  /** Stable id of the connection asking, for logs and per-connection policy. */
  connectionId: string;
}

/** Verify a credential. Returns `null` to refuse. The host never retries. */
export type AdmitClient = (
  request: AdmissionRequest,
) => Admission | null | Promise<Admission | null>;

export interface AutomationHostOptions {
  authority: DocumentAuthority;
  executor: Executor;
  serverInfo: { name: string; version: string };
  admit: AdmitClient;
  externals?: Readonly<Record<string, ExternalHandler>>;
  /** Hold each change for a person's decision (see `ExecutorContext.approval`). */
  approval?: (request: ApprovalRequest) => Promise<ApprovalDecision>;
  limits?: Partial<ControlLimits>;
  /** Concurrent connections the transport may hold open. */
  maxConnections?: number;
  /** Prefix for minted principal ids, so two hosts in one process stay distinct. */
  principalPrefix?: string;
  now?: () => number;
  rng?: IdRng;
}

export type ConnectionState = 'awaiting-hello' | 'ready' | 'closed';

export interface ConnectionSummary {
  connectionId: string;
  /** `null` until `session.hello` is accepted. */
  principalId: string | null;
  /**
   * Stable pseudonym for the credential this connection presented, so a
   * revocation can outlive the connection that earned it.
   *
   * Revocation cannot key on the principal id: a principal is minted per
   * connection, so a reconnecting client would simply be a new principal with
   * the same credential and the same grants. This is a truncated SHA-256 of the
   * credential — a name, not a secret. It identifies a client without carrying
   * anything that could be replayed.
   */
  clientKey: string | null;
  label: string;
  client: { name: string; version?: string } | null;
  transport: TransportKind;
  openedAt: number;
  state: ConnectionState;
}

export interface HostStatus {
  protocol: string;
  /** Whether the host accepts new connections at all. */
  accepting: boolean;
  /** Whether new commits are currently refused. */
  paused: boolean;
  /** Why it is paused, for the person and for a refused client. */
  pausedReason: string | null;
  maxConnections: number;
  connections: ConnectionSummary[];
  /**
   * Credentials currently refused, as the pseudonyms `clientKey` carries. One
   * window issues one credential, so a block applies to every client holding it.
   */
  revoked: string[];
}

export type HostOpenResult =
  | { ok: true; connection: HostConnection }
  | { ok: false; reason: 'full' | 'stopped'; message: string };

/** One accepted connection. The transport owns the byte stream and the framer. */
export interface HostConnection {
  readonly connectionId: string;
  /** Feed one complete line. Resolves with the response line, or `null`. */
  handleLine(line: string): Promise<string | null>;
  /** Frame-size limit the transport's framer should currently enforce. */
  readonly maxFrameBytes: number;
  /** True once the transport should close the stream, after flushing. */
  readonly shouldClose: boolean;
  /** Milliseconds allowed for `session.hello`. */
  readonly helloTimeoutMs: number;
  /** Response for a framer overflow. The connection closes. */
  onOverflow(): string;
  onInvalidUtf8(): string;
  /** Called by the transport when the hello deadline passes. */
  onHelloTimeout(): string | null;
  summary(): ConnectionSummary;
  close(): void;
  /**
   * Hear that this connection closed, whoever closed it (a person revoked the
   * client, automation stopped, the protocol ended the session). Called once; a
   * listener added after the close is never called. Returns an unsubscribe.
   */
  onClose(listener: () => void): () => void;
}

class HostConnectionImpl implements HostConnection {
  readonly connectionId: string;
  private principalId: string | null = null;
  private clientKey: string | null = null;
  private label: string;
  private client: { name: string; version?: string } | null = null;
  private readonly transport: TransportKind;
  private closed = false;
  private readonly closeListeners = new Set<() => void>();

  constructor(
    connectionId: string,
    transport: TransportKind,
    private readonly inner: ControlConnection,
    private readonly onClosed: (connection: HostConnectionImpl) => void,
    private readonly openedAt: number,
  ) {
    this.connectionId = connectionId;
    this.transport = transport;
    this.label = 'Connecting';
  }

  get maxFrameBytes(): number {
    return this.inner.maxFrameBytes;
  }

  get shouldClose(): boolean {
    return this.closed || this.inner.shouldClose;
  }

  get helloTimeoutMs(): number {
    return this.inner.helloTimeoutMs;
  }

  /** Called by the host once a principal is minted for this connection. */
  admit(principal: Principal, client: { name: string; version?: string }, clientKey: string): void {
    this.principalId = principal.id;
    this.clientKey = clientKey;
    this.label = principal.label;
    this.client = client;
  }

  handleLine(line: string): Promise<string | null> {
    return this.inner.handleLine(line);
  }

  onOverflow(): string {
    return this.inner.onOverflow();
  }

  onInvalidUtf8(): string {
    return this.inner.onInvalidUtf8();
  }

  onHelloTimeout(): string | null {
    return this.inner.onHelloTimeout();
  }

  summary(): ConnectionSummary {
    return {
      connectionId: this.connectionId,
      principalId: this.principalId,
      clientKey: this.clientKey,
      label: this.label,
      client: this.client,
      transport: this.transport,
      openedAt: this.openedAt,
      state: this.closed ? 'closed' : this.inner.state,
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.inner.close();
    this.onClosed(this);
    const listeners = [...this.closeListeners];
    this.closeListeners.clear();
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // A listener must never stop the connection from closing.
      }
    }
  }

  onClose(listener: () => void): () => void {
    if (this.closed) return () => undefined;
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }
}

/**
 * A stable name for a presented credential.
 *
 * Truncated to 16 hex characters: long enough that two clients cannot collide
 * in practice, and it is a pseudonym rather than the credential, so showing it
 * in a status list does not hand anyone a way in.
 */
function credentialKey(credential: string): string {
  return sha256Utf8(credential).slice(0, 16);
}

export class AutomationHost {
  private readonly connections = new Map<string, HostConnectionImpl>();
  private readonly revoked = new Set<string>();
  private readonly listeners = new Set<(status: HostStatus) => void>();
  private readonly options: AutomationHostOptions;
  private readonly limits: ControlLimits;
  private readonly maxConnections: number;
  private readonly prefix: string;
  private readonly now: () => number;
  private nextOrdinal = 0;
  private accepting = true;
  private paused = false;
  private pausedReason: string | null = null;

  constructor(options: AutomationHostOptions) {
    this.options = options;
    this.limits = { ...DEFAULT_CONTROL_LIMITS, ...options.limits };
    this.maxConnections = options.maxConnections ?? 8;
    this.prefix = options.principalPrefix ?? 'client';
    this.now = options.now ?? Date.now;
  }

  open(options: { transport?: TransportKind } = {}): HostOpenResult {
    if (!this.accepting) {
      return { ok: false, reason: 'stopped', message: 'this session is not accepting connections' };
    }
    if (this.connections.size >= this.maxConnections) {
      return {
        ok: false,
        reason: 'full',
        message: `the session already holds ${this.maxConnections} connections`,
      };
    }
    this.nextOrdinal += 1;
    const ordinal = this.nextOrdinal;
    const connectionId = `${this.prefix}-${ordinal.toString(36)}-${this.now().toString(36)}`;
    const connection = new HostConnectionImpl(
      connectionId,
      options.transport ?? 'ipc',
      new ControlConnection({
        executor: this.options.executor,
        authority: this.options.authority,
        ...(this.options.externals ? { externals: this.options.externals } : {}),
        ...(this.options.approval ? { approval: this.options.approval } : {}),
        ...(this.options.rng ? { rng: this.options.rng } : {}),
        serverInfo: this.options.serverInfo,
        limits: this.limits,
        authenticate: (credential, client) => this.authenticate(connectionId, credential, client),
        policy: this.policyFor(),
      }),
      (closed) => {
        this.connections.delete(closed.connectionId);
        this.emit();
      },
      this.now(),
    );
    this.connections.set(connectionId, connection);
    this.emit();
    return { ok: true, connection };
  }

  /** Stop accepting new connections. Existing ones keep working. */
  stopAccepting(): void {
    this.accepting = false;
    this.emit();
  }

  /**
   * Refuse new commits. Reads and agent-scoped view changes keep working so a
   * client can still discover what happened and why it is blocked. Committed
   * work is not undone: pausing is not a rollback.
   */
  pause(reason = 'automation is paused'): void {
    this.paused = true;
    this.pausedReason = reason;
    this.emit();
  }

  resume(): void {
    this.paused = false;
    this.pausedReason = null;
    this.emit();
  }

  /**
   * Revoke one client: its live connections close, and the credential it
   * presented is refused from then on.
   *
   * Refusing the credential is the part that matters. Closing a socket is a
   * gesture: a client that already read the credential file can reconnect in
   * milliseconds, and without this it would be admitted as a new principal with
   * the same grants — which makes "revoked" a label rather than a decision.
   */
  revoke(principalId: string): number {
    let closed = 0;
    for (const connection of [...this.connections.values()]) {
      const summary = connection.summary();
      if (summary.principalId !== principalId) continue;
      if (summary.clientKey !== null) this.revoked.add(summary.clientKey);
      connection.close();
      closed += 1;
    }
    if (closed === 0) this.emit();
    return closed;
  }

  /** Client keys currently refused, so a surface can offer to re-admit one. */
  revokedClients(): string[] {
    return [...this.revoked];
  }

  /** Re-admit a client key: its credential is accepted again. */
  clearRevocation(clientKey: string): boolean {
    const removed = this.revoked.delete(clientKey);
    if (removed) this.emit();
    return removed;
  }

  closeAll(): void {
    for (const connection of [...this.connections.values()]) connection.close();
  }

  status(): HostStatus {
    return {
      protocol: CONTROL_PROTOCOL,
      accepting: this.accepting,
      paused: this.paused,
      pausedReason: this.pausedReason,
      maxConnections: this.maxConnections,
      connections: [...this.connections.values()].map((connection) => connection.summary()),
      revoked: [...this.revoked],
    };
  }

  /** Subscribe to connection/policy changes. Returns an unsubscribe function. */
  onChange(listener: (status: HostStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const status = this.status();
    for (const listener of [...this.listeners]) {
      try {
        listener(status);
      } catch {
        // A status listener must never break the control path.
      }
    }
  }

  private async authenticate(
    connectionId: string,
    credential: string,
    client: { name: string; version?: string },
  ): Promise<Principal | null> {
    // A revoked credential is refused before the caller is consulted. The host
    // owns "who is connected" (as it already does for pause and the connection
    // cap); `admit` owns "is this credential valid". Both are necessary.
    const clientKey = credentialKey(credential);
    if (this.revoked.has(clientKey)) return null;
    const admission = await this.options.admit({ credential, client, connectionId });
    if (admission === null) return null;
    const principal: Principal = {
      id: `${this.prefix}:${connectionId}`,
      kind: admission.kind ?? 'agent',
      label: admission.label,
      transport: admission.transport ?? 'ipc',
      grants: admission.grants,
      // Stable across reconnects, so a retry after a lost reply finds the
      // original result instead of being told the outcome is unknown.
      clientId: `${clientKey}:${client.name}`,
    };
    this.connections.get(connectionId)?.admit(principal, client, clientKey);
    this.emit();
    return principal;
  }

  /**
   * Pause is the only thing this policy decides, and it needs no principal.
   * Revocation is enforced where trust is decided (`authenticate`) and the
   * connection is closed at the same moment, so a check here could never run.
   */
  private policyFor(): ExecutionPolicy {
    return {
      blockReason: (effect: CommandEffect): string | null => {
        if (!this.paused) return null;
        if (effect === 'read' || effect === 'view') return null;
        return this.pausedReason ?? 'automation is paused';
      },
    };
  }
}
