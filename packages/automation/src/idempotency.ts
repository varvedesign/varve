/**
 * Idempotency store.
 *
 * A key is distinct from any transport request id and is scoped to the
 * authenticated principal AND the document it was used against, so one client
 * can never replay or collide with another's work. Entries bind the canonical
 * argument hash: re-using a key with different inputs is an error, not a
 * silent second execution.
 *
 * Retention is bounded (entry count and age). A bounded in-memory store is not
 * durable exactly-once execution, and does not pretend to be: a retry that
 * declares itself (`attempt > 1`) and finds no record is reported as an
 * unknown outcome for the caller to reconcile, never executed blindly.
 */
import type { BatchReceipt, Receipt } from './receipt';

export interface IdempotencyEntry {
  key: string;
  principalId: string;
  documentId: string;
  /** `command id` or `batch`. */
  operation: string;
  argsHash: string;
  receipt: Receipt | BatchReceipt;
  storedAt: number;
}

export interface IdempotencyOptions {
  maxEntries?: number;
  ttlMs?: number;
  now?: () => number;
}

export const DEFAULT_IDEMPOTENCY_ENTRIES = 1024;
export const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export class IdempotencyStore {
  private readonly entries = new Map<string, IdempotencyEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: IdempotencyOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_IDEMPOTENCY_ENTRIES;
    this.ttlMs = options.ttlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  private static scope(principalId: string, documentId: string, key: string): string {
    return `${principalId}\u0000${documentId}\u0000${key}`;
  }

  lookup(principalId: string, documentId: string, key: string): IdempotencyEntry | undefined {
    const scoped = IdempotencyStore.scope(principalId, documentId, key);
    const entry = this.entries.get(scoped);
    if (!entry) return undefined;
    if (this.now() - entry.storedAt > this.ttlMs) {
      this.entries.delete(scoped);
      return undefined;
    }
    return entry;
  }

  record(entry: IdempotencyEntry): void {
    const scoped = IdempotencyStore.scope(entry.principalId, entry.documentId, entry.key);
    this.entries.delete(scoped);
    this.entries.set(scoped, entry);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
