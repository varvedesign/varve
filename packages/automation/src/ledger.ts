/**
 * Transaction ledger shared by every document authority.
 *
 * Records attributed transactions (who, what, before and after documents) and
 * computes safe rollbacks. Headless and live authorities differ in how they
 * apply a document and observe revisions; they must not differ in what a
 * transaction record means or when a rollback is refused.
 */
import type { Document } from '@varve/scene';
import type { Origin, RollbackResult, TransactionRecord } from './authority';
import { deepEqual, type Touched, touchedBetween } from './diff';
import { revertTransaction } from './revert';

interface StoredTransaction {
  record: TransactionRecord;
  before: Document;
  after: Document;
  touched: Touched;
}

export interface LedgerOptions {
  /** Transactions retained for rollback; older ones expire. */
  maxTransactions?: number;
  /** Prefix for generated transaction ids. */
  idPrefix?: string;
}

export interface RecordInput {
  before: Document;
  after: Document;
  revision: number;
  label: string;
  origin: Origin;
  command: string;
  receiptId: string;
  created: string[];
  changed: string[];
  deleted: string[];
  revertsTransactionId?: string;
}

export type PreparedRollback =
  | {
      ok: true;
      doc: Document;
      restored: string[];
      label: string;
      created: string[];
      changed: string[];
      deleted: string[];
    }
  | Extract<RollbackResult, { ok: false }>;

export class TransactionLedger {
  private readonly stored: StoredTransaction[] = [];
  private sequence = 0;
  private expiredThrough = 0;
  private readonly max: number;
  private readonly prefix: string;

  constructor(options: LedgerOptions = {}) {
    this.max = options.maxTransactions ?? 200;
    this.prefix = options.idPrefix ?? 't';
  }

  nextTransactionId(): string {
    return `${this.prefix}${this.sequence + 1}`;
  }

  record(input: RecordInput): TransactionRecord {
    this.sequence += 1;
    const record: TransactionRecord = {
      transactionId: `${this.prefix}${this.sequence}`,
      revision: input.revision,
      label: input.label,
      origin: input.origin,
      command: input.command,
      receiptId: input.receiptId,
      created: input.created,
      changed: input.changed,
      deleted: input.deleted,
      ...(input.revertsTransactionId ? { revertsTransactionId: input.revertsTransactionId } : {}),
    };
    this.stored.push({
      record,
      before: input.before,
      after: input.after,
      touched: touchedBetween(input.before, input.after),
    });
    while (this.stored.length > this.max) {
      this.stored.shift();
      this.expiredThrough += 1;
    }
    return record;
  }

  list(limit = 50): TransactionRecord[] {
    return this.stored
      .slice(-limit)
      .reverse()
      .map((entry) => entry.record);
  }

  /**
   * Work out the document that results from rolling back one transaction onto
   * `current`, or why it cannot be done. Pure with respect to the ledger.
   */
  prepareRollback(current: Document, transactionId: string): PreparedRollback {
    const index = this.stored.findIndex((entry) => entry.record.transactionId === transactionId);
    if (index < 0) {
      const sequence = Number(transactionId.slice(this.prefix.length));
      if (
        transactionId.startsWith(this.prefix) &&
        Number.isInteger(sequence) &&
        sequence > 0 &&
        sequence <= this.expiredThrough
      ) {
        return {
          ok: false,
          reason: 'expired',
          message: `transaction ${transactionId} is older than the ${this.max} retained for rollback`,
        };
      }
      return {
        ok: false,
        reason: 'unknown-transaction',
        message: `no transaction ${transactionId} in this session`,
      };
    }

    const target = this.stored[index] as StoredTransaction;
    const reverted = revertTransaction(current, target.before, target.after);
    if (!reverted.ok) {
      const entities = new Set(reverted.conflicts.map((conflict) => conflict.entity));
      const conflicting = this.stored
        .slice(index + 1)
        .filter((later) => {
          for (const entity of entities) {
            if (entity === 'document') {
              if (later.touched.fields.size > 0) return true;
            } else if (later.touched.nodes.has(entity)) {
              return true;
            }
          }
          return false;
        })
        .map((later) => later.record.transactionId);
      return {
        ok: false,
        reason: 'conflict',
        message: `rolling back ${transactionId} would erase later work: ${reverted.conflicts
          .slice(0, 3)
          .map((conflict) => `${conflict.entity} ${conflict.reason}`)
          .join('; ')}`,
        conflictingTransactions: conflicting,
        entities: [...entities],
      };
    }
    if (deepEqual(reverted.doc, current)) {
      return {
        ok: false,
        reason: 'nothing-to-roll-back',
        message: `transaction ${transactionId} has no remaining effect to undo`,
      };
    }
    const touched = touchedBetween(current, reverted.doc);
    return {
      ok: true,
      doc: reverted.doc,
      restored: reverted.restored,
      label: `Roll back: ${target.record.label}`,
      created: [...touched.nodes].filter((id) => !(id in current.nodes)),
      changed: [...touched.nodes].filter((id) => id in current.nodes && id in reverted.doc.nodes),
      deleted: [...touched.nodes].filter((id) => !(id in reverted.doc.nodes)),
    };
  }
}
