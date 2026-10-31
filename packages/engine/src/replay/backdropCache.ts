import type { BackdropCacheEntry } from './types';
export const backdropCache = new Map<string, BackdropCacheEntry>();
const BACKDROP_CACHE_MAX = 20;
const BACKDROP_CACHE_TTL = 500;

export function backdropCacheKey(
  lx: number,
  ly: number,
  lw: number,
  lh: number,
  canvasTransform: { a: number; b: number; c: number; d: number; e: number; f: number },
  itemTransform: readonly [number, number, number, number, number, number],
  radius: number,
): string {
  return `${lx.toFixed(1)},${ly.toFixed(1)},${lw.toFixed(1)},${lh.toFixed(1)}|${canvasTransform.a},${canvasTransform.b},${canvasTransform.c},${canvasTransform.d},${canvasTransform.e},${canvasTransform.f}|${itemTransform.join(',')}|r${radius}`;
}

export function getBackdropCache(key: string): BackdropCacheEntry | undefined {
  const entry = backdropCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.lastAccess > BACKDROP_CACHE_TTL) {
    backdropCache.delete(key);
    return undefined;
  }
  entry.lastAccess = Date.now();
  return entry;
}

export function setBackdropCache(key: string, canvas: HTMLCanvasElement | OffscreenCanvas): void {
  if (backdropCache.size >= BACKDROP_CACHE_MAX) {
    let oldestKey = '';
    let oldestTime = Infinity;
    for (const [k, v] of backdropCache) {
      if (v.lastAccess < oldestTime) {
        oldestTime = v.lastAccess;
        oldestKey = k;
      }
    }
    if (oldestKey) backdropCache.delete(oldestKey);
  }
  backdropCache.set(key, { canvas, lastAccess: Date.now() });
}

export function __clearBackdropCache(): void {
  backdropCache.clear();
}

export function __getBackdropCacheSize(): number {
  return backdropCache.size;
}
