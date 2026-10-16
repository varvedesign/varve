/**
 * Document authority: the one place a document revision is committed.
 *
 * The executor never writes to a document directly. It computes a pure plan
 * and asks the authority to commit it against an expected revision. A headless
 * session and the live editor provide different authorities behind this one
 * interface, so a command means the same thing in both and history, revision
 * and attribution are recorded in the same shape.
 */
import type { Document } from '@varve/scene';
import type { Issue } from './schema';

export type OriginKind = 'user' | 'agent' | 'cli' | 'system';

/** Who caused a transaction, as established by the transport. */
export interface Origin {
  principalId: string;
  kind: OriginKind;
  label: string;
  transport: string;
}

/** A pure, validated change computed by a command, ready to commit. */
export interface CommitPlan {
  doc: Document;
  label: string;
  created: string[];
  changed: string[];
  deleted: string[];
  warnings?: Issue[];
}

export interface TransactionRecord {
  transactionId: string;
  /** Revision produced by this transaction. */
  revision: number;
  label: string;
  origin: Origin;
  command: string;
  receiptId: string;
  created: string[];
  changed: string[];
  deleted: string[];
  /** Set when this transaction is itself a rollback of another. */
  revertsTransactionId?: string;
}

export interface CommitInput {
  plan: CommitPlan;
  origin: Origin;
  command: string;
  receiptId: string;
  /** Revision the plan was computed against. The commit is refused if it moved. */
  baseRevision: number;
}

export type CommitResult =
  | { ok: true; revision: number; transactionId: string }
  | { ok: false; reason: 'revision-conflict'; currentRevision: number }
  /**
   * The pinned document is no longer reachable (tab closed, document replaced),
   * or the authority could not apply a valid plan.
   *
   * `code` lets the authority name the refusal instead of leaving the executor
   * to guess from `reason`: "you are addressing a different document" and "this
   * session is gone" are different problems with different recoveries. It
   * defaults to `TARGET_MISMATCH` for authorities that predate it.
   */
  | {
      ok: false;
      reason: 'unavailable';
      message: string;
      /**
       * `CONFLICT` is for a refusal that clears by itself: a person is in the
       * middle of an edit, so the same plan may be installed a moment later.
       */
      code?: 'TARGET_MISMATCH' | 'UNAVAILABLE' | 'INVARIANT_VIOLATION' | 'CONFLICT';
    };

export type RollbackResult =
  | { ok: true; revision: number; transactionId: string; restored: string[] }
  | {
      ok: false;
      reason: 'unknown-transaction' | 'conflict' | 'expired' | 'nothing-to-roll-back';
      message: string;
      conflictingTransactions?: string[];
      entities?: string[];
    };

export interface AuthorityInfo {
  mode: 'headless' | 'connected';
  instanceId: string;
  generation: string;
  documentId: string;
  documentName: string;
}

export type Availability =
  | { ok: true }
  | { ok: false; code: 'TARGET_MISMATCH' | 'UNAVAILABLE'; message: string; hint?: string };

export interface DocumentAuthority {
  info(): AuthorityInfo;
  /**
   * Whether the pinned document can currently be read and edited. A live
   * editor can lose its target (the person switched tabs or replaced the
   * document); the executor refuses with the reason instead of acting on a
   * different document.
   */
  availability?(): Availability;
  getRevision(): number;
  /** Immutable snapshot of the committed document. */
  getDocument(): Document;
  /**
   * Where a new node goes when the caller names no parent.
   *
   * A headless session has no notion of "what the person is looking at", so it
   * leaves this out and the first publishing page's content root is used. A live
   * editor answers with the surface its own tools insert into (the active design
   * canvas, or the active page in a publishing workspace): a node placed anywhere
   * else renders but never appears in the Layers panel or on the canvas the
   * person is looking at. `undefined` means "no opinion"; `null` means the
   * document root.
   */
  defaultParentId?(): string | null | undefined;
  commit(input: CommitInput): CommitResult | Promise<CommitResult>;
  /** Most recent first. */
  listTransactions(limit?: number): TransactionRecord[];
  /** Roll back one attributed transaction without disturbing later, unrelated work. */
  rollback(
    transactionId: string,
    origin: Origin,
    receiptId: string,
  ): RollbackResult | Promise<RollbackResult>;
}
