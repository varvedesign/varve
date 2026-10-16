/**
 * Live document authority: a connected session over the document a person is
 * actually editing.
 *
 * A headless session owns its document in memory. A connected session does
 * not: the editor owns the document, the undo stack and the revision, and this
 * authority is a *view* of that state which installs a planned commit through
 * the editor's own mutation path. That is the whole difference — the executor,
 * the receipts, the ledger and the rollback rules are the same objects in both
 * modes, so a command cannot mean one thing to an agent and another to a
 * person.
 *
 * **One authority, one document session.** The editor constructs an authority
 * when a document session opens and disposes it when that session ends, so the
 * `generation` this authority reports never changes under a client. That is
 * deliberate: `generation` answers "is the session I planned against the one
 * I am still talking to?". Two rules make connected mode honest rather than
 * convenient:
 *
 * 1. **A dead pin is refused, never retargeted.** If the document this session
 *    was attached to is closed, replaced or Save-As'd, every later request is
 *    refused instead of being applied to whatever happens to be open now, and
 *    there is no silent fallback to an empty document. The editor disposes the
 *    authority at that point; `availability` is the backstop for callers that
 *    omit an explicit target.
 * 2. **The revision belongs to the editor.** A request that planned against
 *    revision N is refused if the person has edited since, so a stale plan can
 *    never overwrite newer work.
 */
import type { Document } from '@varve/scene';
import type {
  AuthorityInfo,
  Availability,
  CommitInput,
  CommitResult,
  DocumentAuthority,
  Origin,
  RollbackResult,
  TransactionRecord,
} from '../authority';
import { type LedgerOptions, TransactionLedger } from '../ledger';

/** Identity of the editor session an automation client attached to. */
export interface LiveTargetInfo {
  instanceId: string;
  generation: string;
  documentId: string;
  documentName: string;
}

/**
 * The editor-side half of a connected session.
 *
 * Every method is synchronous on purpose. The editor's own mutations are
 * synchronous, and a check-then-install pair that could be interleaved with a
 * person's keystroke or an in-flight IME composition is not a precondition —
 * it is a race. Nothing here may await a network, model or file-dialog wait.
 */
export interface LiveEditorPort {
  /** Session identity. `generation` changes when the session is replaced. */
  info(): LiveTargetInfo;
  /**
   * Monotonic revision of this session's document. It MUST increase on every
   * committed document change, including edits the person made. The editor
   * owns this number; the authority never invents one.
   */
  revision(): number;
  /** The committed document as the editor holds it. */
  document(): Document;
  /** Whether the session can still be read and edited at all. */
  status(): Availability;
  /**
   * Install one planned commit as a single undoable step and return the new
   * revision. The port MUST refuse when `input.baseRevision` is no longer
   * `revision()`, and MUST have advanced `revision()` before returning `ok`.
   */
  install(input: CommitInput): CommitResult;
  /**
   * The surface the editor inserts its own new layers into right now, or
   * `undefined` when it cannot say. See `DocumentAuthority.defaultParentId`.
   */
  defaultParentId?(): string | null | undefined;
}

export interface LiveAuthorityOptions {
  port: LiveEditorPort;
  ledger?: LedgerOptions;
}

export class LiveAuthority implements DocumentAuthority {
  private readonly port: LiveEditorPort;
  private readonly ledger: TransactionLedger;
  private readonly pinned: LiveTargetInfo;

  constructor(options: LiveAuthorityOptions) {
    this.port = options.port;
    this.ledger = new TransactionLedger(options.ledger);
    this.pinned = this.port.info();
  }

  /** Identity of the session this authority serves. Never changes. */
  info(): AuthorityInfo {
    return {
      mode: 'connected',
      instanceId: this.pinned.instanceId,
      generation: this.pinned.generation,
      documentId: this.pinned.documentId,
      documentName: this.pinned.documentName,
    };
  }

  defaultParentId(): string | null | undefined {
    return this.port.defaultParentId?.();
  }

  availability(): Availability {
    const status = this.port.status();
    if (!status.ok) return status;
    const info = this.port.info();
    if (info.generation !== this.pinned.generation) {
      return {
        ok: false,
        code: 'UNAVAILABLE',
        message: 'the document session this client attached to has been replaced',
        hint: 'the editor closes a connected session when its document session ends; attach again',
      };
    }
    if (info.documentId !== this.pinned.documentId) {
      return {
        ok: false,
        code: 'UNAVAILABLE',
        message: `this session was attached to document ${this.pinned.documentId}, which is no longer open`,
        hint: 'attaching never retargets a session; attach again to the document that is open now',
      };
    }
    return { ok: true };
  }

  getRevision(): number {
    return this.port.revision();
  }

  getDocument(): Document {
    return this.port.document();
  }

  commit(input: CommitInput): CommitResult {
    const refusal = this.unavailable();
    if (refusal) return refusal;

    const before = this.port.document();
    const result = this.port.install(input);
    if (!result.ok) return result;
    if (result.revision === input.baseRevision) {
      // The editor accepted the document but did not move its revision, which
      // would defeat every stale-plan check afterwards. Report it here rather
      // than letting a later request believe it is looking at fresh state.
      return {
        ok: false,
        reason: 'unavailable',
        code: 'INVARIANT_VIOLATION',
        message:
          'the editor installed the document without advancing its revision; connected sessions require a monotonic revision',
      };
    }
    const record = this.ledger.record({
      before,
      after: input.plan.doc,
      revision: result.revision,
      label: input.plan.label,
      origin: input.origin,
      command: input.command,
      receiptId: input.receiptId,
      created: input.plan.created,
      changed: input.plan.changed,
      deleted: input.plan.deleted,
    });
    return { ok: true, revision: result.revision, transactionId: record.transactionId };
  }

  listTransactions(limit = 50): TransactionRecord[] {
    return this.ledger.list(limit);
  }

  rollback(transactionId: string, origin: Origin, receiptId: string): RollbackResult {
    const refusal = this.unavailable();
    if (refusal) {
      return { ok: false, reason: 'conflict', message: refusal.message };
    }
    const current = this.port.document();
    const prepared = this.ledger.prepareRollback(current, transactionId);
    if (!prepared.ok) return prepared;
    // A rollback is a new compensating edit on top of the person's history,
    // never a pop of the editor's undo stack: popping would discard whatever
    // the person did after the agent, which is exactly what is forbidden.
    const result = this.port.install({
      plan: {
        doc: prepared.doc,
        label: prepared.label,
        created: prepared.created,
        changed: prepared.changed,
        deleted: prepared.deleted,
      },
      origin,
      command: 'varve.history.rollback',
      receiptId,
      baseRevision: this.port.revision(),
    });
    if (!result.ok) {
      if (result.reason === 'revision-conflict') {
        return {
          ok: false,
          reason: 'conflict',
          message: 'the document changed while the rollback was being prepared',
        };
      }
      return { ok: false, reason: 'conflict', message: result.message };
    }
    const record = this.ledger.record({
      before: current,
      after: prepared.doc,
      revision: result.revision,
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
      revision: result.revision,
      transactionId: record.transactionId,
      restored: prepared.restored,
    };
  }

  private unavailable(): {
    ok: false;
    reason: 'unavailable';
    message: string;
    code: 'UNAVAILABLE';
  } | null {
    const availability = this.availability();
    if (availability.ok) return null;
    return {
      ok: false,
      reason: 'unavailable',
      message: availability.message,
      code: 'UNAVAILABLE',
    };
  }
}
