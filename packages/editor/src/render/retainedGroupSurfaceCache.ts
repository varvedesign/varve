/**
 * Small, memory-bounded cache for isolated group source pixels.
 *
 * This deliberately admits only groups made from visible shape leaves with
 * resolved IR and no external resource/effect dependencies. Group/backdrop
 * effects, masks, text, images, proofing, and warped instances stay on the
 * authoritative replay path. The cache owns drawable canvases; a hit never
 * means "skip painting" unless those pixels are actually composited.
 */

export const RETAINED_GROUP_SURFACE_BUDGET_BYTES = 32 * 1024 * 1024;
const MAX_SURFACE_BYTES = 8 * 1024 * 1024;

export interface RetainedGroupSurface {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  bytes: number;
  shapeLeaves: number;
}

interface Entry extends RetainedGroupSurface {
  lastUsed: number;
  documentId: string;
}

/**
 * Object identities are assigned weakly, so document revisions need no
 * explicit global epoch and the cache does not retain scene/IR objects.
 */
export class RetainedGroupSurfaceCache {
  private readonly identities = new WeakMap<object, number>();
  private readonly entries = new Map<string, Entry>();
  private nextIdentity = 1;
  private clock = 0;
  private bytes = 0;
  private hitCount = 0;
  private missCount = 0;
  private bypassCount = 0;
  private evictionCount = 0;
  private avoidedShapeLeaves = 0;
  private avoidedRasterPixels = 0;
  private enabled = true;

  constructor(private budgetBytes = RETAINED_GROUP_SURFACE_BUDGET_BYTES) {}

  key(parts: readonly (object | string | number)[]): string | null {
    const encoded: string[] = [];
    for (const part of parts) {
      const value = typeof part === 'object' ? String(this.identity(part)) : String(part);
      const tag = typeof part === 'object' ? 'o' : typeof part === 'number' ? 'n' : 's';
      // Length-prefix each token so arbitrary imported ids containing `|`
      // or tag-like text cannot alias a different dependency sequence.
      encoded.push(`${tag}${value.length}:${value}`);
    }
    return encoded.join('');
  }

  get(key: string): RetainedGroupSurface | null {
    if (!this.enabled) {
      this.bypassCount++;
      return null;
    }
    const entry = this.entries.get(key);
    if (!entry) {
      this.missCount++;
      return null;
    }
    entry.lastUsed = ++this.clock;
    this.hitCount++;
    this.avoidedShapeLeaves += entry.shapeLeaves;
    this.avoidedRasterPixels += entry.canvas.width * entry.canvas.height;
    return entry;
  }

  set(
    key: string,
    documentId: string,
    canvas: RetainedGroupSurface['canvas'],
    shapeLeaves: number,
  ): boolean {
    if (!this.enabled) return false;
    const width = canvas.width;
    const height = canvas.height;
    const bytes = width * height * 4;
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      !Number.isSafeInteger(bytes) ||
      bytes > MAX_SURFACE_BYTES ||
      bytes > this.budgetBytes
    ) {
      this.bypassCount++;
      return false;
    }

    const previous = this.entries.get(key);
    if (previous) {
      this.bytes -= previous.bytes;
      this.entries.delete(key);
    }
    while (this.bytes + bytes > this.budgetBytes) this.evictOldest();
    this.entries.set(key, { canvas, bytes, shapeLeaves, lastUsed: ++this.clock, documentId });
    this.bytes += bytes;
    return true;
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      // Resetting dimensions releases the backing store when no frame still
      // owns the canvas. Calls are synchronous on the main render thread.
      entry.canvas.width = 0;
      entry.canvas.height = 0;
    }
    this.entries.clear();
    this.bytes = 0;
  }

  activateDocument(documentId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.documentId === documentId) continue;
      entry.canvas.width = 0;
      entry.canvas.height = 0;
      this.entries.delete(key);
      this.bytes -= entry.bytes;
      this.evictionCount++;
    }
  }

  closeDocument(documentId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.documentId !== documentId) continue;
      entry.canvas.width = 0;
      entry.canvas.height = 0;
      this.entries.delete(key);
      this.bytes -= entry.bytes;
      this.evictionCount++;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  resetDiagnostics(): void {
    this.hitCount = 0;
    this.missCount = 0;
    this.bypassCount = 0;
    this.evictionCount = 0;
    this.avoidedShapeLeaves = 0;
    this.avoidedRasterPixels = 0;
  }

  get diagnostics() {
    return {
      entries: this.entries.size,
      residentBytes: this.bytes,
      budgetBytes: this.budgetBytes,
      hits: this.hitCount,
      misses: this.missCount,
      bypasses: this.bypassCount,
      evictions: this.evictionCount,
      avoidedShapeLeaves: this.avoidedShapeLeaves,
      avoidedRasterPixels: this.avoidedRasterPixels,
      enabled: this.enabled,
    };
  }

  private identity(value: object): number {
    let id = this.identities.get(value);
    if (id === undefined) {
      id = this.nextIdentity++;
      this.identities.set(value, id);
    }
    return id;
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldest: Entry | null = null;
    for (const [key, entry] of this.entries) {
      if (!oldest || entry.lastUsed < oldest.lastUsed) {
        oldest = entry;
        oldestKey = key;
      }
    }
    if (!oldest || oldestKey === null) return;
    oldest.canvas.width = 0;
    oldest.canvas.height = 0;
    this.entries.delete(oldestKey);
    this.bytes -= oldest.bytes;
    this.evictionCount++;
  }
}

export const retainedGroupSurfaceCache = new RetainedGroupSurfaceCache();

if (typeof window !== 'undefined') {
  window.addEventListener('varve:document-fonts-closed', (event) => {
    const documentId = (event as CustomEvent<{ documentId?: string }>).detail?.documentId;
    if (documentId) retainedGroupSurfaceCache.closeDocument(documentId);
  });
}
