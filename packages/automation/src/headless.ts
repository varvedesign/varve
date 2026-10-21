/**
 * Headless document authority: an isolated, in-memory session over one
 * document, with revisions, attributed transactions and safe rollback.
 *
 * It is the authority behind `varve exec --file ...` and a headless MCP
 * server. It never silently stands in for a running application: a connected
 * session is a different class with a different `info().mode`, and an adapter
 * asked to connect that cannot must fail instead of constructing one of these.
 */
import type { Document } from '@varve/scene';
import type {
  AuthorityInfo,
  CommitInput,
  CommitResult,
  DocumentAuthority,
  Origin,
  RollbackResult,
  TransactionRecord,
} from './authority';
import { deepEqual, type Touched, touchedBetween } from './diff';
import { revertTransaction } from './revert';

interface StoredTransaction {
  record: TransactionRecord;
  before: Document;
  after: Document;
  touched: Touched;
}

export interface HeadlessOptions {
  document: Document;
  instanceId?: string;
  /** Transactions retained for attributed rollback; older ones expire. */
  maxTransactions?: number;
  newId?: () => string;
}

export class HeadlessAuthority implements DocumentAuthority {
  private doc: Document;
  private revision = 0;
  private sequence = 0;
  private readonly stored: StoredTransaction[] = [];
  private expiredThrough = 0;
  private readonly instanceId: string;
  private readonly generation: string;
  private readonly maxTransactions: number;
  private readonly newId: () => string;

  constructor(options: HeadlessOptions) {
    this.newId = options.newId ?? defaultId;
    this.doc = options.document;
    this.instanceId = options.instanceId ?? `headless-${this.newId().slice(0, 8)}`;
    this.generation = this.newId().slice(0, 12);
    this.maxTransactions = options.maxTransactions ?? 200;
  }

  info(): AuthorityInfo {
    return {
      mode: 'headless',
      instanceId: this.instanceId,
      generation: this.generation,
      documentId: this.doc.id,
      documentName: this.doc.name,
    };
  }

  getRevision(): number {
    return this.revision;
  }

  getDocument(): Document {
    return this.doc;
  }

  commit(input: CommitInput): CommitResult {
    if (input.baseRevision !== this.revision) {
      return { ok: false, reason: 'revision-conflict', currentRevision: this.revision };
    }
    return this.append(this.doc, input.plan.doc, {
      label: input.plan.label,
      origin: input.origin,
      command: input.command,
      receiptId: input.receiptId,
      created: input.plan.created,
      changed: input.plan.changed,
      deleted: input.plan.deleted,
    });
  }

  listTransactions(limit = 50): TransactionRecord[] {
    return this.stored
      .slice(-limit)
      .reverse()
      .map((entry) => entry.record);
  }

  rollback(transactionId: string, origin: Origin, receiptId: string): RollbackResult {
    const index = this.stored.findIndex((entry) => entry.record.transactionId === transactionId);
    if (index < 0) {
      const sequence = Number(transactionId.replace(/^t/, ''));
      if (Number.isInteger(sequence) && sequence > 0 && sequence <= this.expiredThrough) {
        return {
          ok: false,
          reason: 'expired',
          message: `transaction ${transactionId} is older than the ${this.maxTransactions} retained for rollback`,
        };
      }
      return {
        ok: false,
        reason: 'unknown-transaction',
        message: `no transaction ${transactionId} in this session`,
      };
    }

    const target = this.stored[index] as StoredTransaction;
    const reverted = revertTransaction(this.doc, target.before, target.after);
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

    if (deepEqual(reverted.doc, this.doc)) {
      return {
        ok: false,
        reason: 'nothing-to-roll-back',
        message: `transaction ${transactionId} has no remaining effect to undo`,
      };
    }

    const touched = touchedBetween(this.doc, reverted.doc);
    const result = this.append(this.doc, reverted.doc, {
      label: `Roll back: ${target.record.label}`,
      origin,
      command: 'varve.history.rollback',
      receiptId,
      created: [...touched.nodes].filter((id) => !(id in this.doc.nodes)),
      changed: [...touched.nodes].filter((id) => id in this.doc.nodes && id in reverted.doc.nodes),
      deleted: [...touched.nodes].filter((id) => !(id in reverted.doc.nodes)),
      revertsTransactionId: transactionId,
    });
    return {
      ok: true,
      revision: result.revision,
      transactionId: result.transactionId,
      restored: reverted.restored,
    };
  }

  private append(
    before: Document,
    after: Document,
    meta: {
      label: string;
      origin: Origin;
      command: string;
      receiptId: string;
      created: string[];
      changed: string[];
      deleted: string[];
      revertsTransactionId?: string;
    },
  ): Extract<CommitResult, { ok: true }> {
    this.revision += 1;
    this.sequence += 1;
    const record: TransactionRecord = {
      transactionId: `t${this.sequence}`,
      revision: this.revision,
      label: meta.label,
      origin: meta.origin,
      command: meta.command,
      receiptId: meta.receiptId,
      created: meta.created,
      changed: meta.changed,
      deleted: meta.deleted,
      ...(meta.revertsTransactionId ? { revertsTransactionId: meta.revertsTransactionId } : {}),
    };
    this.stored.push({ record, before, after, touched: touchedBetween(before, after) });
    this.doc = after;
    while (this.stored.length > this.maxTransactions) {
      this.stored.shift();
      this.expiredThrough += 1;
    }
    return { ok: true, revision: this.revision, transactionId: record.transactionId };
  }
}

function defaultId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '');
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 14)}`;
}
