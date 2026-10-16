/**
 * Durable pending-operation queue (ADR-0200 durability contract).
 *
 * An operation the host has not acknowledged is local work that the room does
 * not have yet. While the app runs, the engine keeps it in memory and re-sends
 * it on reconnect; a reload or a crash would otherwise lose it, and the room
 * would silently stay behind the author's own document (the local document and
 * its history already contain the edit).
 *
 * Guarantees:
 * - Room-scoped: records are keyed by a hash of the room URL, so joining a
 *   different room never replays another room's work.
 * - Bounded: count, age, and total bytes. Anything pruned is reported, never
 *   silently discarded.
 * - Best effort by construction: the local document is the durable record of
 *   the edit; this queue only repairs the ROOM. A store that fails does not
 *   break the session — the engine reports it once and keeps working.
 * - Authorship is not preserved across a reload: the host assigns a fresh
 *   actor id per join, so a replayed op is authored by the rejoining session.
 *   That is a deliberate, documented consequence of host-assigned identity.
 *
 * Pure module (plus the in-memory implementation used by tests and by
 * platforms without persistent storage).
 */

import type { RoomOperation } from './protocol';

export const PENDING_LIMITS = {
  /** Maximum operations kept for one room. */
  maxOperations: 200,
  /** Records older than this are pruned: a week-old intent is not an intent. */
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  /** Total serialized bytes kept for one room. */
  maxBytes: 48_000_000,
} as const;

export interface PendingOperationRecord {
  clientOpId: string;
  label: string;
  /** Epoch ms when the operation was first submitted. */
  savedAt: number;
  op: RoomOperation;
}

export interface PendingOperationStore {
  load(roomKey: string): Promise<PendingOperationRecord[]>;
  save(roomKey: string, records: PendingOperationRecord[]): Promise<void>;
  clear(roomKey: string): Promise<void>;
}

/** Room-scoped key: a hash of the room URL, so no token can reach storage. */
export function roomKeyFor(roomUrl: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < roomUrl.length; index++) {
    hash ^= roomUrl.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `room-${hash.toString(36)}`;
}

export interface PruneOutcome {
  kept: PendingOperationRecord[];
  /** Records dropped for age, count, or byte budget (all are reported). */
  dropped: number;
  /** True when the byte budget itself forced records out. */
  overBudget: boolean;
}

/**
 * Keep the newest, in-age, within-budget records.
 *
 * Order is preserved for `kept` (oldest first) because the engine re-sends in
 * submission order and re-applies them in the same order.
 */
export function prunePendingRecords(
  records: readonly PendingOperationRecord[],
  now: number,
  limits: { maxOperations: number; maxAgeMs: number; maxBytes: number } = PENDING_LIMITS,
): PruneOutcome {
  let dropped = 0;
  const young = records.filter((record) => {
    const keep = Number.isFinite(record.savedAt) && now - record.savedAt <= limits.maxAgeMs;
    if (!keep) dropped += 1;
    return keep;
  });
  // Newest first while trimming by count, then restore submission order.
  const byNewest = [...young].sort((a, b) => b.savedAt - a.savedAt);
  const withinCount = byNewest.slice(0, limits.maxOperations);
  dropped += byNewest.length - withinCount.length;

  const keptNewestFirst: PendingOperationRecord[] = [];
  let bytes = 0;
  let overBudget = false;
  for (const record of withinCount) {
    const size = estimateBytes(record);
    if (bytes + size > limits.maxBytes && keptNewestFirst.length > 0) {
      overBudget = true;
      dropped += 1;
      continue;
    }
    bytes += size;
    keptNewestFirst.push(record);
  }
  return {
    kept: keptNewestFirst.reverse(),
    dropped,
    overBudget,
  };
}

/** Serialized size of one record, without allocating the string twice. */
export function estimateBytes(record: PendingOperationRecord): number {
  return JSON.stringify(record.op).length + record.clientOpId.length + record.label.length + 64;
}

/** In-memory store: tests, and platforms with no persistent storage. */
export class MemoryPendingOperationStore implements PendingOperationStore {
  private readonly rooms = new Map<string, PendingOperationRecord[]>();

  async load(roomKey: string): Promise<PendingOperationRecord[]> {
    return [...(this.rooms.get(roomKey) ?? [])];
  }

  async save(roomKey: string, records: PendingOperationRecord[]): Promise<void> {
    this.rooms.set(roomKey, [...records]);
  }

  async clear(roomKey: string): Promise<void> {
    this.rooms.delete(roomKey);
  }
}
