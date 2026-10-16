/**
 * Receipt journal: a small sidecar that lets a retry recover the result of an
 * operation whose acknowledgement was lost.
 *
 * Each CLI invocation is a fresh process, so the executor's in-memory
 * idempotency store cannot see an earlier attempt. The journal bridges that for
 * `--in-place` runs. Protocol, per keyed mutation:
 *
 *   1. write a `pending` entry (receipt, hash before, hash after) under the
 *      document lock;
 *   2. replace the document atomically;
 *   3. mark the entry `committed`.
 *
 * On a retry, a `committed` entry replays its receipt. A `pending` entry is
 * reconciled against the bytes on disk: equal to `afterHash` means the write
 * landed (replay), equal to `beforeHash` means it never did (execute), anything
 * else is reported as an unknown outcome. Nothing is guessed.
 */
import { readFileSync } from 'node:fs';
import type { BatchReceipt, IdempotencyEntry, Receipt } from '@varve/automation';
import { parseStrictJson } from '@varve/automation';
import { type PathPolicy, writeTextAtomic } from './files';

export const JOURNAL_SCHEMA = 'varve.journal/1';
const MAX_ENTRIES = 128;
const TTL_MS = 24 * 60 * 60 * 1000;

export interface JournalEntry {
  key: string;
  principalId: string;
  documentId: string;
  operation: string;
  argsHash: string;
  state: 'pending' | 'committed';
  beforeHash: string;
  afterHash: string;
  receipt: Receipt | BatchReceipt;
  storedAt: number;
}

export function journalPathFor(documentPath: string): string {
  return `${documentPath}.varve-journal.json`;
}

export class Journal {
  constructor(
    private readonly policy: PathPolicy,
    readonly path: string,
    private readonly now: () => number = Date.now,
  ) {}

  load(): JournalEntry[] {
    let text: string;
    try {
      text = readFileSync(this.path, 'utf8');
    } catch {
      return [];
    }
    const parsed = parseStrictJson(text, { maxBytes: 8 * 1024 * 1024 });
    if (!parsed.ok) return [];
    const root = parsed.value as { schema?: string; entries?: unknown };
    if (root.schema !== JOURNAL_SCHEMA || !Array.isArray(root.entries)) return [];
    const cutoff = this.now() - TTL_MS;
    return (root.entries as JournalEntry[]).filter(
      (entry) =>
        typeof entry?.key === 'string' &&
        typeof entry.storedAt === 'number' &&
        entry.storedAt >= cutoff,
    );
  }

  upsert(entry: JournalEntry): void {
    const entries = this.load().filter(
      (existing) => !(existing.key === entry.key && existing.principalId === entry.principalId),
    );
    entries.push(entry);
    const trimmed = entries.slice(-MAX_ENTRIES);
    writeTextAtomic(
      this.policy,
      this.path,
      JSON.stringify({ schema: JOURNAL_SCHEMA, entries: trimmed }),
      { kind: 'replace-any' },
    );
  }
}

/**
 * Decide what a journal entry means for a retry against the current file.
 * Returns the entry to seed the executor with, or `null` when it should run.
 */
export function reconcile(
  entry: JournalEntry | undefined,
  currentHash: string,
): { seed: IdempotencyEntry | null; verdict: 'none' | 'replay' | 'not-landed' | 'unknown' } {
  if (!entry) return { seed: null, verdict: 'none' };
  const seed: IdempotencyEntry = {
    key: entry.key,
    principalId: entry.principalId,
    documentId: entry.documentId,
    operation: entry.operation,
    argsHash: entry.argsHash,
    receipt: entry.receipt,
    storedAt: entry.storedAt,
  };
  if (entry.state === 'committed') return { seed, verdict: 'replay' };
  if (currentHash === entry.afterHash) return { seed, verdict: 'replay' };
  if (currentHash === entry.beforeHash) return { seed: null, verdict: 'not-landed' };
  return { seed: null, verdict: 'unknown' };
}
