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
export const RETAINED_GROUP_MAX_ENTRIES = 512;
export const RETAINED_GROUP_MAX_KEY_CHARACTERS = 16 * 1024;
const MAX_SURFACE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BUDGET_BYTES = 64 * 1024 * 1024;
const MAX_DIAGNOSTIC_BYPASSES = 32;
const MAX_DIAGNOSTIC_GROUP_KEYS = 128;
export const RETAINED_GROUP_DIAGNOSTIC_PATH_LIMIT = 32;
const MAX_DIAGNOSTIC_ID_LENGTH = 128;

export type RetainedGroupBypassReason =
  | 'untracked-miss'
  | 'nonresident-miss'
  | 'dependency-key-changed'
  | 'dependency-key-too-large'
  | 'warped-container'
  | 'master-occurrence'
  | 'instance-occurrence'
  | 'proofing'
  | 'visible-group-effects'
  | 'group-mask'
  | 'unsupported-child-kind'
  | 'hidden-child'
  | 'child-mask'
  | 'unresolved-child-ir'
  | 'text-child'
  | 'child-effects'
  | 'child-filters'
  | 'unsupported-fill'
  | 'unsupported-surface-size'
  | 'surface-over-budget';

export type RetainedGroupAdmissionBypassReason = Exclude<
  RetainedGroupBypassReason,
  | 'untracked-miss'
  | 'nonresident-miss'
  | 'dependency-key-changed'
  | 'unsupported-surface-size'
  | 'surface-over-budget'
>;

export interface RetainedGroupBypass {
  reason: RetainedGroupBypassReason;
  groupId?: string;
  dependencyPath?: string[];
  dependencyPathTruncated?: boolean;
  requiredBytes?: number;
  budgetBytes?: number;
}

export interface RetainedGroupQuality {
  renderScale: number;
  devicePixelRatio: number;
  backingWidth: number;
  backingHeight: number;
  generation: number;
  backend: 'canvas-2d';
}

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
  private collectDetailedDiagnostics = false;
  private readonly recentGroupKeys = new Map<string, string>();
  private readonly recentBypasses: RetainedGroupBypass[] = [];
  private keyBuildMs = 0;
  private keyBuildCount = 0;
  private lookupMs = 0;
  private lookupCount = 0;
  private compositionMs = 0;
  private compositionCount = 0;
  private qualityGeneration = 0;
  private qualitySignature = '';
  private quality: RetainedGroupQuality = {
    renderScale: 0,
    devicePixelRatio: 0,
    backingWidth: 0,
    backingHeight: 0,
    generation: 0,
    backend: 'canvas-2d',
  };

  private budgetBytes: number;

  constructor(budgetBytes = RETAINED_GROUP_SURFACE_BUDGET_BYTES) {
    this.budgetBytes =
      Number.isFinite(budgetBytes) && budgetBytes >= 0
        ? Math.min(Math.floor(budgetBytes), MAX_TOTAL_BUDGET_BYTES)
        : RETAINED_GROUP_SURFACE_BUDGET_BYTES;
  }

  key(parts: readonly (object | string | number)[]): string | null {
    const startedAt = this.measurementNow();
    const encoded: string[] = [];
    let encodedLength = 0;
    for (const part of parts) {
      const value = typeof part === 'object' ? String(this.identity(part)) : String(part);
      const tag = typeof part === 'object' ? 'o' : typeof part === 'number' ? 'n' : 's';
      // Length-prefix each token so arbitrary imported ids containing `|`
      // or tag-like text cannot alias a different dependency sequence.
      const tokenLength = tag.length + String(value.length).length + 1 + value.length;
      if (encodedLength + tokenLength > RETAINED_GROUP_MAX_KEY_CHARACTERS) {
        this.recordDuration(startedAt, 'key');
        return null;
      }
      encoded.push(`${tag}${value.length}:${value}`);
      encodedLength += tokenLength;
    }
    const key = encoded.join('');
    this.recordDuration(startedAt, 'key');
    return key;
  }

  get(
    key: string,
    context?: {
      groupIdentity?: string;
      groupId?: string;
      dependencyPath?: readonly string[];
      dependencyPathTruncated?: boolean;
    },
  ): RetainedGroupSurface | null {
    const startedAt = this.measurementNow();
    if (!this.enabled) {
      this.bypassCount++;
      this.recordDuration(startedAt, 'lookup');
      return null;
    }
    const entry = this.entries.get(key);
    if (!entry) {
      this.missCount++;
      if (context?.groupIdentity) {
        const keySignature = this.diagnosticKeySignature(key);
        const previousKey = this.recentGroupKeys.get(
          this.diagnosticIdentity(context.groupIdentity),
        );
        this.recordBypass({
          reason:
            previousKey === undefined
              ? 'untracked-miss'
              : previousKey === keySignature
                ? 'nonresident-miss'
                : 'dependency-key-changed',
          groupId: this.boundedDiagnosticId(context.groupId),
          ...this.boundedDependencyPath(
            context.dependencyPath ?? [],
            context.dependencyPathTruncated,
          ),
        });
      }
      this.recordDuration(startedAt, 'lookup');
      return null;
    }
    entry.lastUsed = ++this.clock;
    this.hitCount++;
    this.avoidedShapeLeaves += entry.shapeLeaves;
    this.avoidedRasterPixels += entry.canvas.width * entry.canvas.height;
    if (context?.groupIdentity) {
      this.rememberGroupKey(context.groupIdentity, this.diagnosticKeySignature(key));
    }
    this.recordDuration(startedAt, 'lookup');
    return entry;
  }

  set(
    key: string,
    documentId: string,
    canvas: RetainedGroupSurface['canvas'],
    shapeLeaves: number,
    context?: {
      groupIdentity?: string;
      groupId?: string;
      dependencyPath?: readonly string[];
      dependencyPathTruncated?: boolean;
    },
  ): boolean {
    if (!this.enabled) return false;
    if (key.length > RETAINED_GROUP_MAX_KEY_CHARACTERS) {
      this.bypassCount++;
      this.recordBypass({
        reason: 'dependency-key-too-large',
        ...(this.collectDetailedDiagnostics
          ? { groupId: this.boundedDiagnosticId(context?.groupId) }
          : {}),
        ...(this.collectDetailedDiagnostics && context?.dependencyPath
          ? this.boundedDependencyPath(context.dependencyPath, context.dependencyPathTruncated)
          : {}),
      });
      return false;
    }
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
      this.recordBypass({
        reason:
          bytes > MAX_SURFACE_BYTES || bytes > this.budgetBytes
            ? 'surface-over-budget'
            : 'unsupported-surface-size',
        requiredBytes: Number.isFinite(bytes) ? bytes : undefined,
        budgetBytes: this.budgetBytes,
        ...(this.collectDetailedDiagnostics
          ? { groupId: this.boundedDiagnosticId(context?.groupId) }
          : {}),
        ...(this.collectDetailedDiagnostics && context?.dependencyPath
          ? this.boundedDependencyPath(context.dependencyPath, context.dependencyPathTruncated)
          : {}),
      });
      return false;
    }

    const previous = this.entries.get(key);
    if (previous) {
      this.bytes -= previous.bytes;
      this.entries.delete(key);
    }
    while (
      this.entries.size >= RETAINED_GROUP_MAX_ENTRIES ||
      this.bytes + bytes > this.budgetBytes
    ) {
      this.evictOldest();
    }
    this.entries.set(key, { canvas, bytes, shapeLeaves, lastUsed: ++this.clock, documentId });
    this.bytes += bytes;
    if (context?.groupIdentity) {
      this.rememberGroupKey(context.groupIdentity, this.diagnosticKeySignature(key));
    }
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

  setBudgetBytes(budgetBytes: number): void {
    if (!Number.isFinite(budgetBytes) || budgetBytes < 0) return;
    this.budgetBytes = Math.min(Math.floor(budgetBytes), MAX_TOTAL_BUDGET_BYTES);
    while (this.bytes > this.budgetBytes) this.evictOldest();
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

  setDetailedDiagnosticsEnabled(enabled: boolean): void {
    this.collectDetailedDiagnostics = enabled;
    if (!enabled) this.resetDetailedDiagnostics();
  }

  recordAdmissionBypass(
    reason: RetainedGroupAdmissionBypassReason,
    groupId: string,
    dependencyPath: readonly string[],
    dependencyPathTruncated = false,
  ): void {
    if (!this.collectDetailedDiagnostics) return;
    this.recordBypass({
      reason,
      groupId: this.boundedDiagnosticId(groupId),
      ...this.boundedDependencyPath(dependencyPath, dependencyPathTruncated),
    });
  }

  recordQuality(input: Omit<RetainedGroupQuality, 'generation' | 'backend'>): void {
    if (!this.collectDetailedDiagnostics) return;
    const signature = [input.renderScale, input.devicePixelRatio].join(':');
    if (signature !== this.qualitySignature) {
      this.qualitySignature = signature;
      this.qualityGeneration++;
    }
    this.quality = { ...input, generation: this.qualityGeneration, backend: 'canvas-2d' };
  }

  beginCompositionMeasurement(): number | null {
    return this.measurementNow();
  }

  finishCompositionMeasurement(startedAt: number | null): void {
    this.recordDuration(startedAt, 'composition');
  }

  resetDiagnostics(): void {
    this.hitCount = 0;
    this.missCount = 0;
    this.bypassCount = 0;
    this.evictionCount = 0;
    this.avoidedShapeLeaves = 0;
    this.avoidedRasterPixels = 0;
    this.resetDetailedDiagnostics();
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
      detailed: this.collectDetailedDiagnostics
        ? {
            retainedBypassRecords: this.recentBypasses.length,
            trackedGroupKeys: this.recentGroupKeys.size,
            bypasses: this.recentBypasses.map((bypass) => ({
              ...bypass,
              dependencyPath: bypass.dependencyPath ? [...bypass.dependencyPath] : undefined,
            })),
            timings: {
              keyBuildAverageMs: this.average(this.keyBuildMs, this.keyBuildCount),
              lookupAverageMs: this.average(this.lookupMs, this.lookupCount),
              compositionAverageMs: this.average(this.compositionMs, this.compositionCount),
              keyBuildCount: this.keyBuildCount,
              lookupCount: this.lookupCount,
              compositionCount: this.compositionCount,
            },
            quality: { ...this.quality },
          }
        : null,
    };
  }

  get detailedDiagnosticsEnabled(): boolean {
    return this.collectDetailedDiagnostics;
  }

  private recordBypass(bypass: RetainedGroupBypass): void {
    if (!this.collectDetailedDiagnostics) return;
    this.recentBypasses.push(bypass);
    if (this.recentBypasses.length > MAX_DIAGNOSTIC_BYPASSES) this.recentBypasses.shift();
  }

  private rememberGroupKey(groupIdentity: string, key: string): void {
    if (!this.collectDetailedDiagnostics) return;
    const identity = this.diagnosticIdentity(groupIdentity);
    this.recentGroupKeys.delete(identity);
    this.recentGroupKeys.set(identity, key);
    if (this.recentGroupKeys.size > MAX_DIAGNOSTIC_GROUP_KEYS) {
      const oldest = this.recentGroupKeys.keys().next().value;
      if (oldest !== undefined) this.recentGroupKeys.delete(oldest);
    }
  }

  private boundedDependencyPath(
    path: readonly string[],
    alreadyTruncated = false,
  ): Pick<RetainedGroupBypass, 'dependencyPath' | 'dependencyPathTruncated'> {
    const truncated = alreadyTruncated || path.length > RETAINED_GROUP_DIAGNOSTIC_PATH_LIMIT;
    return {
      dependencyPath: path
        .slice(0, RETAINED_GROUP_DIAGNOSTIC_PATH_LIMIT)
        .map((id) => this.boundedDiagnosticId(id) ?? ''),
      ...(truncated ? { dependencyPathTruncated: true } : {}),
    };
  }

  /** Used only to label diagnostics; cache validity always compares the full key. */
  private diagnosticIdentity(identity: string): string {
    return this.diagnosticKeySignature(identity);
  }

  private boundedDiagnosticId(id: string | undefined): string | undefined {
    if (id === undefined || id.length <= MAX_DIAGNOSTIC_ID_LENGTH) return id;
    return `${id.slice(0, MAX_DIAGNOSTIC_ID_LENGTH - 1)}…`;
  }

  /** Used only to label diagnostics; cache validity always compares the full key. */
  private diagnosticKeySignature(key: string): string {
    let firstHash = 0x811c9dc5;
    let secondHash = 0x9e3779b9;
    for (let index = 0; index < key.length; index++) {
      const code = key.charCodeAt(index);
      firstHash = Math.imul(firstHash ^ code, 0x01000193);
      secondHash = Math.imul(secondHash ^ code, 0x85ebca6b);
      secondHash ^= secondHash >>> 13;
    }
    return `${key.length}:${firstHash >>> 0}:${secondHash >>> 0}`;
  }

  private measurementNow(): number | null {
    return this.collectDetailedDiagnostics && globalThis.performance
      ? globalThis.performance.now()
      : null;
  }

  private recordDuration(startedAt: number | null, stage: 'key' | 'lookup' | 'composition'): void {
    if (startedAt === null || !this.collectDetailedDiagnostics) return;
    const elapsed = Math.max(0, globalThis.performance.now() - startedAt);
    if (stage === 'key') {
      this.keyBuildMs += elapsed;
      this.keyBuildCount++;
    } else if (stage === 'lookup') {
      this.lookupMs += elapsed;
      this.lookupCount++;
    } else {
      this.compositionMs += elapsed;
      this.compositionCount++;
    }
  }

  private average(total: number, count: number): number {
    return count > 0 ? total / count : 0;
  }

  private resetDetailedDiagnostics(): void {
    this.recentGroupKeys.clear();
    this.recentBypasses.length = 0;
    this.keyBuildMs = 0;
    this.keyBuildCount = 0;
    this.lookupMs = 0;
    this.lookupCount = 0;
    this.compositionMs = 0;
    this.compositionCount = 0;
    this.qualityGeneration = 0;
    this.qualitySignature = '';
    this.quality = {
      renderScale: 0,
      devicePixelRatio: 0,
      backingWidth: 0,
      backingHeight: 0,
      generation: 0,
      backend: 'canvas-2d',
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
