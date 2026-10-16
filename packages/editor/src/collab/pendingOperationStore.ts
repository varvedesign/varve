/**
 * IndexedDB-backed pending-operation queue (editor platform layer).
 *
 * Mirrors the shape of the crash-report queue (`packages/crash/src/queue.ts`):
 * one object store keyed by the room key, whole-queue writes in a single
 * transaction, and best-effort failures — a broken store must degrade the
 * recovery guarantee, never the editing session.
 *
 * Room keys are hashes of the room URL (`roomKeyFor`), so no invite token and
 * no document content appears in the database name, keys, or indexes.
 */

import { type PendingOperationRecord, type PendingOperationStore, roomKeyFor } from '@varve/collab';

const DB_NAME = 'varve-collab-pending';
const DB_VERSION = 1;
const STORE_NAME = 'pending';

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

export class IndexedDbPendingOperationStore implements PendingOperationStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!hasIndexedDb()) return Promise.reject(new Error('IndexedDB unavailable'));
    this.dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
          return;
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
      request.onblocked = () => reject(new Error('IndexedDB upgrade blocked'));
    });
    return this.dbPromise;
  }

  private async run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = work(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB aborted'));
    });
  }

  async load(roomKey: string): Promise<PendingOperationRecord[]> {
    const value = await this.run<PendingOperationRecord[] | undefined>(
      'readonly',
      (store) => store.get(roomKey) as IDBRequest<PendingOperationRecord[] | undefined>,
    );
    return Array.isArray(value) ? value : [];
  }

  async save(roomKey: string, records: PendingOperationRecord[]): Promise<void> {
    await this.run('readwrite', (store) => store.put(records, roomKey));
  }

  async clear(roomKey: string): Promise<void> {
    await this.run('readwrite', (store) => store.delete(roomKey));
  }
}

/** Room key helper re-exported for callers that only need the key. */
export { roomKeyFor };
