/**
 * Structured error model.
 *
 * Every refusal carries a stable machine code, a readable message, whether a
 * retry of the same request can ever succeed, and (for argument problems) the
 * full issue list. Adapters map codes onto their own wire conventions
 * (JSON-RPC error vs MCP `isError` tool result) without inventing new ones, and
 * a UI never has to parse message text to decide what to offer (LightCraft #1046).
 */
import type { Issue } from './schema';

export type ErrorCode =
  /** Arguments failed structural or domain validation. */
  | 'INVALID_ARGUMENT'
  | 'UNKNOWN_COMMAND'
  /** The command exists, but the catalog version the caller built against is stale. */
  | 'SCHEMA_VERSION_MISMATCH'
  /** A referenced node/page/asset does not exist in the pinned document. */
  | 'UNKNOWN_TARGET'
  | 'AMBIGUOUS_TARGET'
  /** The request pinned a document or session generation that is not current. */
  | 'TARGET_MISMATCH'
  /** `expectedRevision` no longer matches; resync and retry deliberately. */
  | 'REVISION_CONFLICT'
  | 'PERMISSION_DENIED'
  /** Command is defined but not available in this runtime (headless vs connected). */
  | 'UNAVAILABLE'
  | 'LIMIT_EXCEEDED'
  | 'LOCKED'
  /** Operation would corrupt the document (cycle, non-container parent, ...). */
  | 'INVARIANT_VIOLATION'
  /** Concurrent work intersects this operation; nothing was changed. */
  | 'CONFLICT'
  | 'IDEMPOTENCY_MISMATCH'
  /** A declared retry found no record of the original; do not repeat blindly. */
  | 'OUTCOME_UNKNOWN'
  | 'HISTORY_EXPIRED'
  | 'CANCELLED'
  | 'INTERNAL';

export type ErrorCategory =
  | 'validation'
  | 'authorization'
  | 'state'
  | 'limit'
  | 'availability'
  | 'internal';

export const ERROR_CATEGORY: Readonly<Record<ErrorCode, ErrorCategory>> = {
  INVALID_ARGUMENT: 'validation',
  UNKNOWN_COMMAND: 'validation',
  SCHEMA_VERSION_MISMATCH: 'validation',
  UNKNOWN_TARGET: 'validation',
  AMBIGUOUS_TARGET: 'validation',
  TARGET_MISMATCH: 'state',
  REVISION_CONFLICT: 'state',
  PERMISSION_DENIED: 'authorization',
  UNAVAILABLE: 'availability',
  LIMIT_EXCEEDED: 'limit',
  LOCKED: 'state',
  INVARIANT_VIOLATION: 'validation',
  CONFLICT: 'state',
  IDEMPOTENCY_MISMATCH: 'validation',
  OUTCOME_UNKNOWN: 'state',
  HISTORY_EXPIRED: 'state',
  CANCELLED: 'state',
  INTERNAL: 'internal',
};

/** Codes for which re-sending the identical request may succeed later. */
const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['REVISION_CONFLICT', 'CONFLICT']);

export interface ErrorInfo {
  code: ErrorCode;
  category: ErrorCategory;
  message: string;
  /** True only when the same request can plausibly succeed after state changes. */
  retryable: boolean;
  /** What to do next, in a sentence a person or an agent can act on. */
  hint?: string;
  /** Per-field problems for INVALID_ARGUMENT. */
  issues?: Issue[];
  details?: Record<string, unknown>;
}

export interface ErrorInit {
  message: string;
  hint?: string;
  issues?: Issue[];
  details?: Record<string, unknown>;
}

export function errorInfo(code: ErrorCode, init: ErrorInit): ErrorInfo {
  return {
    code,
    category: ERROR_CATEGORY[code],
    message: init.message,
    retryable: RETRYABLE.has(code),
    ...(init.hint !== undefined ? { hint: init.hint } : {}),
    ...(init.issues !== undefined ? { issues: init.issues } : {}),
    ...(init.details !== undefined ? { details: init.details } : {}),
  };
}

/** Thrown by command implementations for expected, user-correctable refusals. */
export class CommandRejection extends Error {
  readonly info: ErrorInfo;
  constructor(code: ErrorCode, init: ErrorInit) {
    super(init.message);
    this.name = 'CommandRejection';
    this.info = errorInfo(code, init);
  }
}
