/**
 * Execution receipts.
 *
 * "Handler found", "request accepted", "mutation committed", "render ready" and
 * "file durably saved" are different states. A receipt says exactly which one
 * was reached. `summary` is for people and models to read; `outcome`, `error`
 * and the identifier lists are the machine contract (DeckCraft #298: do not make
 * prose the only signal).
 */
import type { ErrorInfo } from './errors';
import { type Issue, s } from './schema';

export const RECEIPT_SCHEMA = 'varve.receipt/1';

export type Outcome =
  /** Query completed. */
  | 'ok'
  /** Mutation committed to the document authority. */
  | 'applied'
  /** Valid request that changed nothing; `summary` says why. */
  | 'no-op'
  /** Dry run: what would change, nothing did. */
  | 'preview'
  /** Refused before any change; see `error`. */
  | 'rejected'
  /** Batch in partial mode: some steps applied, some did not. */
  | 'partial'
  /** Accepted; completion is reported through a job or user interaction. */
  | 'pending'
  /** A declared retry could not be reconciled; verify state before retrying. */
  | 'unknown';

/** Result of persisting a committed edit; absent fields mean "not saved". */
export interface DurableInfo {
  saved: boolean;
  /** Destination actually written. */
  path?: string;
  bytes?: number;
  /** SHA-256 of the bytes written. */
  contentHash?: string;
}

export interface TargetInfo {
  mode: 'headless' | 'connected';
  instanceId: string;
  /** Changes whenever the authority is replaced (restart, reopen, Save As). */
  generation: string;
  documentId: string;
  documentName: string;
}

export interface Receipt {
  schema: typeof RECEIPT_SCHEMA;
  receiptId: string;
  command: string;
  commandVersion: number;
  outcome: Outcome;
  summary: string;
  target: TargetInfo;
  revision: { before: number; after: number };
  created: string[];
  changed: string[];
  deleted: string[];
  /** Caller-supplied alias to canonical id for nodes created by this command. */
  idMap: Record<string, string>;
  output?: unknown;
  warnings: Issue[];
  /** Arguments filled from declared defaults (JSON Pointers). */
  defaulted: string[];
  transactionId?: string;
  error?: ErrorInfo;
  idempotency?: { key: string; replayed: boolean; argsHash: string };
  /** Mutation committed is not the same as saved: file persistence is separate. */
  durable: DurableInfo;
}

export interface BatchStepReceipt {
  step: number;
  alias?: string;
  receipt: Receipt;
}

export interface BatchReceipt {
  schema: 'varve.batch-receipt/1';
  receiptId: string;
  mode: 'atomic' | 'partial';
  outcome: Outcome;
  summary: string;
  target: TargetInfo;
  revision: { before: number; after: number };
  transactionId?: string;
  steps: BatchStepReceipt[];
  created: string[];
  changed: string[];
  deleted: string[];
  idMap: Record<string, string>;
  error?: ErrorInfo;
  durable: DurableInfo;
}

// ── Advertised schemas ───────────────────────────────────────────────────────
//
// The receipt is part of the wire contract: adapters publish these so a client
// can validate results, and a test asserts every real receipt conforms.

const ISSUE_SCHEMA = s.object({
  path: s.string({ maxBytes: 2048 }),
  code: s.string({ maxBytes: 64 }),
  message: s.string({ maxBytes: 4096 }),
  expected: s.optional(s.string({ maxBytes: 1024 })),
  hint: s.optional(s.string({ maxBytes: 1024 })),
});

const ERROR_SCHEMA = s.object({
  code: s.string({ maxBytes: 64 }),
  category: s.string({ maxBytes: 32 }),
  message: s.string({ maxBytes: 8192 }),
  retryable: s.boolean(),
  hint: s.optional(s.string({ maxBytes: 2048 })),
  issues: s.optional(s.array(ISSUE_SCHEMA, { maxItems: 200 })),
  details: s.optional(s.any()),
});

const TARGET_SCHEMA = s.object({
  mode: s.enum(['headless', 'connected'] as const),
  instanceId: s.string({ maxBytes: 128 }),
  generation: s.string({ maxBytes: 128 }),
  documentId: s.string({ maxBytes: 256 }),
  documentName: s.string({ maxBytes: 2048 }),
});

const DURABLE_SCHEMA = s.object({
  saved: s.boolean(),
  path: s.optional(s.string({ maxBytes: 4096 })),
  bytes: s.optional(s.integer({ min: 0 })),
  contentHash: s.optional(s.string({ maxBytes: 128 })),
});

const OUTCOMES = [
  'ok',
  'applied',
  'no-op',
  'preview',
  'rejected',
  'partial',
  'pending',
  'unknown',
] as const;

const ID_LIST = s.array(s.string({ maxBytes: 256 }), { maxItems: 100_000 });

const REVISION_SCHEMA = s.object({ before: s.integer({ min: 0 }), after: s.integer({ min: 0 }) });

export const RECEIPT_OUTPUT_SCHEMA = s.object({
  schema: s.literal(RECEIPT_SCHEMA),
  receiptId: s.string({ maxBytes: 128 }),
  command: s.string({ maxBytes: 128 }),
  commandVersion: s.integer({ min: 0 }),
  outcome: s.enum(OUTCOMES),
  summary: s.string({ maxBytes: 8192 }),
  target: TARGET_SCHEMA,
  revision: REVISION_SCHEMA,
  created: ID_LIST,
  changed: ID_LIST,
  deleted: ID_LIST,
  idMap: s.any(),
  output: s.optional(s.any()),
  warnings: s.array(ISSUE_SCHEMA, { maxItems: 200 }),
  defaulted: s.array(s.string({ maxBytes: 256 }), { maxItems: 200 }),
  transactionId: s.optional(s.string({ maxBytes: 128 })),
  error: s.optional(ERROR_SCHEMA),
  idempotency: s.optional(
    s.object({
      key: s.string({ maxBytes: 128 }),
      replayed: s.boolean(),
      argsHash: s.string({ maxBytes: 128 }),
    }),
  ),
  durable: DURABLE_SCHEMA,
});

export const BATCH_RECEIPT_OUTPUT_SCHEMA = s.object({
  schema: s.literal('varve.batch-receipt/1'),
  receiptId: s.string({ maxBytes: 128 }),
  mode: s.enum(['atomic', 'partial'] as const),
  outcome: s.enum(OUTCOMES),
  summary: s.string({ maxBytes: 8192 }),
  target: TARGET_SCHEMA,
  revision: REVISION_SCHEMA,
  transactionId: s.optional(s.string({ maxBytes: 128 })),
  steps: s.array(
    s.object({
      step: s.integer({ min: 0 }),
      alias: s.optional(s.string({ maxBytes: 64 })),
      receipt: s.any(),
    }),
    { maxItems: 200 },
  ),
  created: ID_LIST,
  changed: ID_LIST,
  deleted: ID_LIST,
  idMap: s.any(),
  error: s.optional(ERROR_SCHEMA),
  durable: DURABLE_SCHEMA,
});
