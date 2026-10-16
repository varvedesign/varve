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
import type { Issue } from './schema';

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
