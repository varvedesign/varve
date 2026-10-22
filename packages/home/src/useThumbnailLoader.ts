/**
 * useThumbnailLoader — canonical thumbnail loading for Home surfaces.
 *
 * Loads cached thumbnails by canonical identity
 * (fileId + contentHash + preference + home-card variant); on a miss it
 * falls back to the legacy bare content-hash key (warm migration for
 * pre-canonical files) and otherwise shows the empty state. Generation is
 * owned by the editor (save path) — Home never renders documents.
 *
 * Scheduling: bounded concurrency (batch of 4), idle-time dispatch, LRU
 * in-memory map keyed by file id, duplicate-job suppression.
 */

import { THUMBNAIL_RENDERER_VERSION } from '@varve/engine';
import type { FileEntry, Platform, RecentFileRecord } from '@varve/platform';
import {
  computeThumbnailIdentity,
  THUMBNAIL_VARIANTS,
  type ThumbnailIdentity,
  type ThumbnailVariant,
  thumbnailVariantForDevice,
} from '@varve/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const BATCH_SIZE = 4;
const MAX_CACHE_SIZE = 100;

/** Display density, read once per session (no DOM dependency in @varve/shared). */
function displayPixelRatio(): number {
  return typeof globalThis.devicePixelRatio === 'number' ? globalThis.devicePixelRatio : 1;
}

/** Home-card profile for this display: 2x on HiDPI, 1x elsewhere. */
export const HOME_CARD_VARIANT: ThumbnailVariant = thumbnailVariantForDevice(
  'home-card',
  displayPixelRatio(),
);

interface QueueItem {
  entry: FileEntry;
  priority: number;
  identities: ThumbnailIdentity[];
}

export interface ThumbnailLoader {
  thumbnails: Map<string, string | null>;
  load: (entry: FileEntry) => void;
  loadBatch: (entries: FileEntry[]) => void;
  prioritize: (entryId: string) => void;
}

/**
 * Optional host-owned repair path for a cache miss. Home remains a consumer
 * of the thumbnail store; the host decides whether it is safe to decode the
 * document and uses the canonical editor renderer when a preview is absent.
 */
export type ThumbnailGenerator = (entry: FileEntry) => Promise<string | null>;

/** Canonical identity for a file's home-card thumbnail. */
export function fileThumbnailIdentity(
  entry: FileEntry,
  variant: ThumbnailVariant = HOME_CARD_VARIANT,
): ThumbnailIdentity {
  return computeThumbnailIdentity({
    docKey: entry.id,
    revisionHash: entry.contentHash,
    source: entry.thumbnailPreference ?? { type: 'automatic' },
    variant,
    rendererVersion: THUMBNAIL_RENDERER_VERSION,
  });
}

/**
 * Identities to try, in order, for one entry.
 *
 * On HiDPI the 2x identity is primary and the 1x identity is a fallback: a
 * thumbnail saved by an older build (or a 1x session) must still display
 * rather than leaving the card empty. At 1x there is exactly one candidate.
 */
export function thumbnailIdentityCandidates(
  entry: FileEntry,
  variant: ThumbnailVariant = HOME_CARD_VARIANT,
): ThumbnailIdentity[] {
  const primary = fileThumbnailIdentity(entry, variant);
  if (variant.devicePixelRatio === 1) return [primary];
  return [primary, fileThumbnailIdentity(entry, THUMBNAIL_VARIANTS['home-card'])];
}

/**
 * Look up a file's thumbnail with legacy fallback. Never throws; failures
 * resolve to null so the card shows its empty state.
 */
async function loadUrl(
  platform: Platform,
  identities: ThumbnailIdentity[],
  entry: FileEntry,
  generate?: ThumbnailGenerator,
): Promise<string | null> {
  try {
    for (const identity of identities) {
      const canonical = await platform.getThumbnail(identity.key);
      if (canonical) return canonical;
    }
    // Legacy warm migration: bare content-hash entries from the
    // pre-canonical system are treated as disposable optimization state.
    if (identities.every((identity) => identity.key !== entry.contentHash)) {
      const legacy = await platform.getThumbnail(entry.contentHash);
      if (legacy) return legacy;
    }
    return generate ? await generate(entry) : null;
  } catch {
    return null;
  }
}

export function useThumbnailLoader(
  platform: Platform,
  generate?: ThumbnailGenerator,
): ThumbnailLoader {
  const [thumbnails, setThumbnails] = useState<Map<string, string | null>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<QueueItem[]>([]);
  const processingRef = useRef(false);

  const evictIfNeeded = useCallback(() => {
    setThumbnails((prev) => {
      if (prev.size <= MAX_CACHE_SIZE) return prev;
      const next = new Map(prev);
      let evicted = 0;
      for (const key of next.keys()) {
        if (next.size - evicted <= MAX_CACHE_SIZE) break;
        next.delete(key);
        evicted++;
      }
      return next;
    });
  }, []);

  const processSingle = useCallback(
    async (item: QueueItem) => {
      const { entry, identities } = item;
      if (thumbnails.has(entry.id) || loadingRef.current.has(entry.id)) return;
      loadingRef.current.add(entry.id);

      try {
        const url = await loadUrl(platform, identities, entry, generate);
        setThumbnails((prev) => {
          const next = new Map(prev);
          next.set(entry.id, url);
          return next;
        });
        evictIfNeeded();
      } catch {
        // Load failures are non-fatal: the card shows its empty state.
      } finally {
        loadingRef.current.delete(entry.id);
      }
    },
    [platform, thumbnails, generate, evictIfNeeded],
  );

  const processQueue = useCallback(() => {
    if (processingRef.current) return;
    processingRef.current = true;

    const scheduleNext = () => {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(
          () => {
            processBatch();
          },
          { timeout: 1000 },
        );
      } else {
        setTimeout(processBatch, 50);
      }
    };

    const processBatch = () => {
      const queue = queueRef.current;
      if (queue.length === 0) {
        processingRef.current = false;
        return;
      }

      queue.sort((a, b) => b.priority - a.priority);
      const batch = queue.splice(0, BATCH_SIZE);

      let completed = 0;
      for (const item of batch) {
        processSingle(item).finally(() => {
          completed++;
          if (completed === batch.length) {
            scheduleNext();
          }
        });
      }
    };

    processBatch();
  }, [processSingle]);

  const load = useCallback(
    (entry: FileEntry) => {
      if (thumbnails.has(entry.id) || loadingRef.current.has(entry.id)) return;
      queueRef.current.push({
        entry,
        priority: 0,
        identities: thumbnailIdentityCandidates(entry),
      });
      processQueue();
    },
    [thumbnails, processQueue],
  );

  const loadBatch = useCallback(
    (entries: FileEntry[]) => {
      const added: QueueItem[] = [];
      for (const entry of entries) {
        if (thumbnails.has(entry.id) || loadingRef.current.has(entry.id)) continue;
        added.push({ entry, priority: 0, identities: thumbnailIdentityCandidates(entry) });
      }
      if (added.length === 0) return;
      queueRef.current.push(...added);
      processQueue();
    },
    [thumbnails, processQueue],
  );

  const prioritize = useCallback((entryId: string) => {
    for (const item of queueRef.current) {
      if (item.entry.id === entryId) {
        item.priority = 1;
        return;
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      queueRef.current = [];
      processingRef.current = false;
    };
  }, []);

  return { thumbnails, load, loadBatch, prioritize };
}

/** Compose Home's privacy guard with the optional host-owned repair path. */
export function useHomeThumbnailLoader(
  platform: Platform,
  recentRecords: readonly RecentFileRecord[],
  onGenerateThumbnail?: ThumbnailGenerator,
): { thumbnails: ThumbnailLoader; encryptedIds: ReadonlySet<string> } {
  const encryptedIds = useMemo(
    () => new Set(recentRecords.filter((record) => record.encrypted).map((record) => record.id)),
    [recentRecords],
  );
  const generate = useCallback<ThumbnailGenerator>(
    async (entry) => {
      if (encryptedIds.has(entry.id) || !onGenerateThumbnail) return null;
      return onGenerateThumbnail(entry);
    },
    [encryptedIds, onGenerateThumbnail],
  );
  return { thumbnails: useThumbnailLoader(platform, generate), encryptedIds };
}
