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
import { TransactionLedger } from './ledger';

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
  private readonly ledger: TransactionLedger;
  private readonly instanceId: string;
  private readonly generation: string;
  private readonly newId: () => string;

  constructor(options: HeadlessOptions) {
    this.newId = options.newId ?? defaultId;
    this.doc = options.document;
    this.instanceId = options.instanceId ?? `headless-${this.newId().slice(0, 8)}`;
    this.generation = this.newId().slice(0, 12);
    this.ledger = new TransactionLedger({ maxTransactions: options.maxTransactions });
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
    const before = this.doc;
    this.revision += 1;
    this.doc = input.plan.doc;
    const record = this.ledger.record({
      before,
      after: input.plan.doc,
      revision: this.revision,
      label: input.plan.label,
      origin: input.origin,
      command: input.command,
      receiptId: input.receiptId,
      created: input.plan.created,
      changed: input.plan.changed,
      deleted: input.plan.deleted,
    });
    return { ok: true, revision: this.revision, transactionId: record.transactionId };
  }

  listTransactions(limit = 50): TransactionRecord[] {
    return this.ledger.list(limit);
  }

  rollback(transactionId: string, origin: Origin, receiptId: string): RollbackResult {
    const prepared = this.ledger.prepareRollback(this.doc, transactionId);
    if (!prepared.ok) return prepared;
    const before = this.doc;
    this.revision += 1;
    this.doc = prepared.doc;
    const record = this.ledger.record({
      before,
      after: prepared.doc,
      revision: this.revision,
      label: prepared.label,
      origin,
      command: 'varve.history.rollback',
      receiptId,
      created: prepared.created,
      changed: prepared.changed,
      deleted: prepared.deleted,
      revertsTransactionId: transactionId,
    });
    return {
      ok: true,
      revision: this.revision,
      transactionId: record.transactionId,
      restored: prepared.restored,
    };
  }
}

function defaultId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '');
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 14)}`;
}
