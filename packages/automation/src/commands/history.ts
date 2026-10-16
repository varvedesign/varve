import { defineCommand } from '../catalog';
import { type Infer, s } from '../schema';

const ORIGIN = s.object({
  principalId: s.string({ maxBytes: 128 }),
  kind: s.string({ maxBytes: 16 }),
  label: s.string({ maxBytes: 256 }),
  transport: s.string({ maxBytes: 32 }),
});

const LIST_INPUT = s.object({ limit: s.integer({ min: 1, max: 200, default: 20 }) });

const TRANSACTION = s.object({
  transactionId: s.string({ maxBytes: 64 }),
  revision: s.integer({ min: 0 }),
  label: s.string({ maxBytes: 512 }),
  command: s.string({ maxBytes: 128 }),
  origin: ORIGIN,
  createdCount: s.integer({ min: 0 }),
  changedCount: s.integer({ min: 0 }),
  deletedCount: s.integer({ min: 0 }),
  revertsTransactionId: s.optional(s.string({ maxBytes: 64 })),
});

const LIST_OUTPUT = s.object({
  revision: s.integer({ min: 0 }),
  transactions: s.array(TRANSACTION, { maxItems: 200 }),
});

type ListOutput = Infer<typeof LIST_OUTPUT>;

const ROLLBACK_INPUT = s.object({ transactionId: s.string({ maxBytes: 64, minLength: 1 }) });
const ROLLBACK_OUTPUT = s.object({
  restored: s.array(s.string({ maxBytes: 160 }), { maxItems: 100_000 }),
});

export const historyList = defineCommand({
  id: 'varve.history.list',
  version: 1,
  title: 'List recent transactions',
  summary:
    'List recent committed transactions, newest first, with who made each one. Use a transaction id with varve.history.rollback to reverse one of your own changes safely.',
  keywords: ['undo', 'log', 'attribution', 'transactions', 'changes'],
  effect: 'read',
  authorization: 'read',
  runtimes: ['headless', 'connected'],
  input: LIST_INPUT,
  output: LIST_OUTPUT,
  examples: [{ title: 'Last ten', args: { limit: 10 } }],
  inspect(authority, args: Infer<typeof LIST_INPUT>): ListOutput {
    return {
      revision: authority.getRevision(),
      transactions: authority.listTransactions(args.limit).map((entry) => ({
        transactionId: entry.transactionId,
        revision: entry.revision,
        label: entry.label,
        command: entry.command,
        origin: {
          principalId: entry.origin.principalId,
          kind: entry.origin.kind,
          label: entry.origin.label,
          transport: entry.origin.transport,
        },
        createdCount: entry.created.length,
        changedCount: entry.changed.length,
        deletedCount: entry.deleted.length,
        ...(entry.revertsTransactionId ? { revertsTransactionId: entry.revertsTransactionId } : {}),
      })),
    };
  },
});

export const historyRollback = defineCommand({
  id: 'varve.history.rollback',
  version: 1,
  title: 'Roll back one transaction',
  summary:
    'Reverse one earlier transaction by id without disturbing later work. Refused with the conflicting transactions listed if any later transaction touched the same entities; it never pops the last N edits blindly.',
  keywords: ['undo', 'revert', 'recover'],
  effect: 'mutate',
  authorization: 'edit',
  runtimes: ['headless', 'connected'],
  input: ROLLBACK_INPUT,
  output: ROLLBACK_OUTPUT,
  examples: [{ title: 'Undo t3', args: { transactionId: 't3' } }],
  async revert(authority, args: Infer<typeof ROLLBACK_INPUT>, env) {
    const result = await authority.rollback(args.transactionId, env.origin, env.receiptId);
    if (!result.ok) {
      const code =
        result.reason === 'conflict'
          ? 'CONFLICT'
          : result.reason === 'expired'
            ? 'HISTORY_EXPIRED'
            : result.reason === 'nothing-to-roll-back'
              ? 'CONFLICT'
              : 'UNKNOWN_TARGET';
      return {
        ok: false,
        code,
        message: result.message,
        details: {
          ...(result.conflictingTransactions
            ? { conflictingTransactions: result.conflictingTransactions }
            : {}),
          ...(result.entities ? { entities: result.entities } : {}),
          reason: result.reason,
        },
      };
    }
    return {
      ok: true,
      output: { restored: result.restored },
      summary: `Rolled back ${args.transactionId}: restored ${result.restored.length} entities (revision ${result.revision}).`,
      result,
    };
  },
});

export const HISTORY_COMMANDS = [historyList, historyRollback];
