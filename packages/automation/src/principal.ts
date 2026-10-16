/**
 * Principals and grants.
 *
 * A principal is built by the transport that accepted the connection, from
 * evidence the transport itself holds (an OS-verified peer uid, a token the
 * installation issued, the in-process caller). It is never read from a request
 * body: a caller cannot claim `origin: "ui"` or pick its own `actorId`.
 *
 * Grants are coarse authorization classes. File-path confinement is not
 * modelled here because the core has no file system; it is enforced at the
 * file gateway each adapter supplies (see `FileGateway`).
 */

/**
 * - `read`     queries over document structure and effective properties
 * - `edit`     document mutations (one undo group per command or batch)
 * - `view`     agent-scoped selection/camera changes that never touch the document
 * - `capture`  rendered pixels or snapshots that may leave the device
 * - `export`   writing a deliverable to an approved output location
 * - `external` effects beyond the document and approved outputs (network, spend)
 */
export const AUTHORIZATION_CLASSES = [
  'read',
  'edit',
  'view',
  'capture',
  'export',
  'external',
] as const;

export type AuthorizationClass = (typeof AUTHORIZATION_CLASSES)[number];

export type PrincipalKind = 'user' | 'agent' | 'system';
export type TransportKind = 'in-process' | 'stdio' | 'ipc' | 'tcp';

export interface Principal {
  /** Stable identifier minted by the transport (never client supplied). */
  id: string;
  kind: PrincipalKind;
  /** Display label for approval and activity UI. Not a security signal. */
  label: string;
  transport: TransportKind;
  grants: readonly AuthorizationClass[];
  /**
   * Identity of the client behind this connection that survives a reconnect.
   *
   * `id` is minted per connection so a receipt always names which connection
   * wrote it. That is the wrong scope for a retry: the main reason to retry is
   * a lost reply, and the retry arrives on a new connection. Idempotency is
   * therefore scoped to this value when it exists. The host derives it from the
   * credential the client presented and the name it declared, so two clients
   * with different names never share a scope, while one client that reconnects
   * keeps its own.
   */
  clientId?: string;
}

/** The scope idempotency keys live in: the client when known, else the connection. */
export function idempotencyScope(principal: Principal): string {
  return principal.clientId ?? principal.id;
}

export function hasGrant(principal: Principal, required: AuthorizationClass): boolean {
  return principal.grants.includes(required);
}

/** A principal with every class, for the trusted in-process owner of a headless session. */
export function ownerPrincipal(id = 'local-owner', label = 'Local owner'): Principal {
  return {
    id,
    kind: 'user',
    label,
    transport: 'in-process',
    grants: AUTHORIZATION_CLASSES,
  };
}

/** Command domains that must never be reachable through the automation surface. */
export const FORBIDDEN_COMMAND_DOMAINS: readonly string[] = [
  'settings',
  'preferences',
  'permissions',
  'automation',
  'approval',
  'security',
  'updater',
];
