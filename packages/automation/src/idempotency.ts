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
import { utf8ByteLength } from './text';

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
  /**
   * Total encoded size of retained receipts. Entries count is not a memory
   * bound once a receipt can carry an image: 1024 retained captures would hold
   * gigabytes. A receipt larger than the whole budget is not retained at all,
   * which a declared retry then reports as an unknown outcome, never as a
   * repeat.
   */
  maxBytes?: number;
  ttlMs?: number;
  now?: () => number;
}

export const DEFAULT_IDEMPOTENCY_ENTRIES = 1024;
export const DEFAULT_IDEMPOTENCY_BYTES = 32 * 1024 * 1024;
export const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export class IdempotencyStore {
  private readonly entries = new Map<string, IdempotencyEntry>();
  private readonly sizes = new Map<string, number>();
  private retainedBytes = 0;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: IdempotencyOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_IDEMPOTENCY_ENTRIES;
    this.maxBytes = options.maxBytes ?? DEFAULT_IDEMPOTENCY_BYTES;
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
      this.forget(scoped);
      return undefined;
    }
    return entry;
  }

  private forget(scoped: string): void {
    this.entries.delete(scoped);
    this.retainedBytes -= this.sizes.get(scoped) ?? 0;
    this.sizes.delete(scoped);
  }

  /**
   * Retain a receipt for replay. Returns false when it was not kept because it
   * alone exceeds the byte budget; the caller still has the real result, and a
   * later declared retry will be told the outcome is unknown rather than be
   * handed a second execution.
   */
  record(entry: IdempotencyEntry): boolean {
    const scoped = IdempotencyStore.scope(entry.principalId, entry.documentId, entry.key);
    this.forget(scoped);
    const size = utf8ByteLength(JSON.stringify(entry.receipt));
    if (size > this.maxBytes) return false;
    this.entries.set(scoped, entry);
    this.sizes.set(scoped, size);
    this.retainedBytes += size;
    while (this.entries.size > this.maxEntries || this.retainedBytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.forget(oldest);
    }
    return true;
  }

  /** Encoded size currently retained, for diagnostics and tests. */
  get bytes(): number {
    return this.retainedBytes;
  }

  get size(): number {
    return this.entries.size;
  }
}
