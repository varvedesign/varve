/**
 * Per-node IR item cache — skip rebuild when node content hash is unchanged.
 * Complements compositor SubtreeReplayCache (replay skip, not IR generation).
 *
 * Architecture:
 *   SubtreeIrCache caches RenderItem per nodeId. The cached entry is
 *   looked up by a FNV-1a hash that includes every field that affects IR
 *   output. CacheContentParts() extracts the full set of render-relevant
 *   fields; nodeHash() hashes them together with nodeId, transform, and
 *   styleKey.
 *
 *   When cacheContentParts changes (any field that affects IR), the hash
 *   changes and the entry is a miss — this is the defence-in-depth layer.
 *   Explicit invalidate(nodeId) is the primary invalidation mechanism,
 *   called from CanvasArea.tsx document-diffing.
 *
 * Budget model:
 *   The cache enforces both entry-count and byte-count limits. set()
 *   accounts for the estimated retained bytes of the inserted item and
 *   evicts LRU entries until both limits are satisfied. Entries larger
 *   than the entire soft budget are refused.
 *
 * Sub-hash system:
 *   cacheContentParts returns a SubHashReport containing both the content
 *   parts (for the primary hash) and a breakdown by category (geometry,
 *   paint, text, effects, image). The breakdown is used for diagnostics
 *   only — the primary hash is still a single FNV-1a over all parts.
 */

import type { SceneNode as EngineNode, RenderItem } from '@varve/engine';

/** Diagnostics: which sub-category of content changed. */
export interface ChangedSubHashes {
  geometry: boolean;
  paint: boolean;
  text: boolean;
  effects: boolean;
  image: boolean;
  mask: boolean;
}

export interface SubHashReport {
  parts: string[];
  sub: ChangedSubHashes;
}

/**
 * Raster-layer content summary for the IR cache key — avoids hashing pixels.
 *
 * The tile count and the *sum* of versions the key used to rely on are not an
 * identity: `{1, 2}` and `{2, 1}` sum alike, and a tile's version repeats
 * across divergent histories (undo then a different stroke, a branch switch).
 * Each tile contributes its key, version and content identity to a rolling
 * 64-bit hash instead, in key order, so any tile whose buffer was replaced
 * changes the key.
 */
function rasterLayerVersionSummary(data: NonNullable<EngineNode['rasterLayerData']>): string {
  const { width, height, pixelMode, tiles } = data;
  const tileKeys = Object.keys(tiles).sort();
  let lo = 0x811c9dc5;
  let hi = 0x9e3779b1;
  const mix = (n: number): void => {
    lo = Math.imul(lo ^ n, 0x01000193) >>> 0;
    hi = Math.imul(hi ^ (n + 0x9e3779b9), 0x85ebca6b) >>> 0;
    hi = (hi ^ (hi >>> 13)) >>> 0;
  };
  for (const k of tileKeys) {
    for (let i = 0; i < k.length; i++) mix(k.charCodeAt(i));
    const t = tiles[k];
    if (!t) continue;
    mix(t.version);
    mix(t.contentId ?? 0);
    mix(0xff);
  }
  return `raster:${width}x${height}:${pixelMode ? 'pixel' : 'image'}:t${tileKeys.length}:h${lo.toString(36)}${hi.toString(36)}`;
}

/**
 * Image `src` values are data URLs that can be several megabytes. The content
 * hash walks every character of every part (see {@link SubtreeIrCache.nodeHash})
 * and JSON.stringify copies the whole string, so hashing a raw image fill costs
 * O(image bytes) *per frame* — even on a cache hit, and even for a scene with a
 * handful of nodes. That untimed cost (it sits outside buildIr timing) is what
 * makes an image-bearing canvas feel sluggish on every pan/zoom/edit.
 *
 * Replace long src strings with a cheap, stable fingerprint. Image fills carry
 * a short `assetId` (a content reference into Document.assets) which is kept in
 * the hash and already discriminates image identity; real src swaps are also
 * caught by explicit cache invalidation from document diffing. So the content
 * hash only needs a cheap defence-in-depth signal here, not a full byte hash.
 * Short srcs (file paths, remote URLs) are hashed verbatim.
 */
const MAX_INLINE_SRC = 256;

/**
 * Bytes charged for a raster tile pixel payload the IR holds by reference.
 *
 * A 128x128 RGBA tile is 65,536 bytes of pixels, but those bytes belong to the
 * document's immutable tile buffer, not to the cache entry: the entry holds the
 * grid key, the tile record and a pointer. Charging the payload would
 * double-count document memory and (because a number array serialises to
 * roughly 450 KB of JSON) push ordinary layers over the entry budget. This
 * covers the key string, the record and the pointer.
 */
const TILE_REFERENCE_BYTES = 96;

/** Stand-in written in place of a tile payload so its bytes are never walked. */
const TILE_PAYLOAD_MARKER = '~';

/** True for the pixel payload shapes a raster tile record can carry. */
function isTilePixelPayload(value: unknown): boolean {
  return Array.isArray(value) || ArrayBuffer.isView(value);
}
export function imageSrcHashProxy(src: string): string {
  const n = src.length;
  if (n <= MAX_INLINE_SRC) return src;
  // Sample ~32 chars spread across the payload so two different images of equal
  // byte length still produce different fingerprints. Char indexing is O(1),
  // so this is bounded regardless of image size.
  let sample = '';
  const step = Math.max(1, (n / 32) | 0);
  for (let i = 0; i < n; i += step) sample += src[i];
  return `${n}:${sample}`;
}

/** JSON.stringify replacer that shortens megabyte image src data URLs. */
function fillHashReplacer(_key: string, value: unknown): unknown {
  return _key === 'src' && typeof value === 'string' && value.length > MAX_INLINE_SRC
    ? imageSrcHashProxy(value)
    : value;
}

/** Extract all render-relevant fields from an EngineNode for hashing.
 *
 * Returns a SubHashReport with both the content parts array (for the primary
 * hash) and a sub-hash breakdown for diagnostics.
 *
 * Every field that shapeToPrimitive() or buildIr() reads MUST be represented
 * here, directly or through JSON serialization of its container object.
 *
 * Fields are split into sub-categories so diagnostics can explain WHY a hash
 * changed (which category of content drifted).
 */
export function cacheContentParts(en: EngineNode): SubHashReport {
  const parts: string[] = [];
  const sub: ChangedSubHashes = {
    geometry: false,
    paint: false,
    text: false,
    effects: false,
    image: false,
    mask: false,
  };

  const shape = en.shape;
  if (shape) {
    parts.push(JSON.stringify(shape));
    sub.geometry = true;
  }
  if (en.w !== undefined) {
    parts.push(`nw:${en.w}`);
    sub.geometry = true;
  }
  if (en.h !== undefined) {
    parts.push(`nh:${en.h}`);
    sub.geometry = true;
  }
  if (en.cornerRadius !== undefined) {
    parts.push(`cr:${JSON.stringify(en.cornerRadius)}`);
    sub.geometry = true;
  }
  if (en.cornerSmoothing !== undefined) {
    parts.push(`cs:${en.cornerSmoothing}`);
    sub.geometry = true;
  }
  if (en.shapeless !== undefined) {
    parts.push(`sl:${en.shapeless}`);
    sub.geometry = true;
  }
  if (en.kind) {
    parts.push(`k:${en.kind}`);
    sub.geometry = true;
  }

  if (en.fill) {
    parts.push(JSON.stringify(en.fill, fillHashReplacer));
    sub.paint = true;
  }
  if (en.fills && en.fills.length > 0) {
    parts.push(JSON.stringify(en.fills, fillHashReplacer));
    sub.paint = true;
  }
  if (en.strokes && en.strokes.length > 0) {
    parts.push(JSON.stringify(en.strokes));
    sub.paint = true;
  }
  if (en.opacity !== undefined) {
    parts.push(`op:${en.opacity}`);
    sub.paint = true;
  }
  if (en.blendMode) {
    parts.push(`bm:${en.blendMode}`);
    sub.paint = true;
  }
  if (en.rotation !== undefined) {
    parts.push(`rot:${en.rotation}`);
    sub.paint = true;
  }

  if (en.text !== undefined) {
    parts.push(`txt:${en.text}`);
    sub.text = true;
  }
  if (en.fontSize !== undefined) {
    parts.push(`fs:${en.fontSize}`);
    sub.text = true;
  }
  if (en.fontFamily) {
    parts.push(`ff:${en.fontFamily}`);
    sub.text = true;
  }
  if (en.fontWeight !== undefined) {
    parts.push(`fw:${en.fontWeight}`);
    sub.text = true;
  }
  if (en.fontStyle) {
    parts.push(`fst:${en.fontStyle}`);
    sub.text = true;
  }
  if (en.textAlign) {
    parts.push(`ta:${en.textAlign}`);
    sub.text = true;
  }
  if (en.textAlignVertical) {
    parts.push(`tav:${en.textAlignVertical}`);
    sub.text = true;
  }
  if (en.letterSpacing !== undefined) {
    parts.push(`ls:${en.letterSpacing}`);
    sub.text = true;
  }
  if (en.lineHeight !== undefined) {
    parts.push(`lh:${en.lineHeight}`);
    sub.text = true;
  }
  if (en.paragraphSpacing !== undefined) {
    parts.push(`ps:${en.paragraphSpacing}`);
    sub.text = true;
  }
  if (en.textCase) {
    parts.push(`tc:${en.textCase}`);
    sub.text = true;
  }
  if (en.textDecoration) {
    parts.push(`td:${en.textDecoration}`);
    sub.text = true;
  }
  if (en.textOverflow) {
    parts.push(`to:${en.textOverflow}`);
    sub.text = true;
  }
  if (en.listStyle) {
    parts.push(`lst:${en.listStyle}`);
    sub.text = true;
  }
  if (en.textMode) {
    parts.push(`tm:${en.textMode}`);
    sub.text = true;
  }
  if (en.pathTextSettings) {
    parts.push(`pts:${JSON.stringify(en.pathTextSettings)}`);
    sub.text = true;
  }
  if (en.variableAxes) {
    parts.push(`va:${JSON.stringify(en.variableAxes)}`);
    sub.text = true;
  }
  if (en.openTypeFeatures) {
    parts.push(`otf:${JSON.stringify(en.openTypeFeatures)}`);
    sub.text = true;
  }
  if (en.richText) {
    parts.push(`rt:${JSON.stringify(en.richText)}`);
    sub.text = true;
  }
  // Text-shaping inputs the IR builder reads but that were absent from this
  // key. `computeInvalidationPlan` invalidates a node whenever its object
  // identity changes, so a per-node edit is already covered before this hash is
  // consulted; the hash exists to catch content drift for nodes that were *not*
  // explicitly invalidated, and it could not do that for any of these. They are
  // all scalars or small maps, so the extra cost is negligible against a whole
  // node rebuild, and over-hashing only ever costs a rebuild — under-hashing
  // serves a stale item.
  if (en.tracking !== undefined) {
    // Typographic tracking in 1/1000 em, added between glyphs: a different
    // advance per cluster, so the whole laid-out run moves.
    parts.push(`trk:${en.tracking}`);
    sub.text = true;
  }
  if (en.direction) {
    parts.push(`dir:${en.direction}`);
    sub.text = true;
  }
  if (en.language) {
    parts.push(`lng:${en.language}`);
    sub.text = true;
  }
  if (en.kerningMode) {
    parts.push(`km:${en.kerningMode}`);
    sub.text = true;
  }
  if (en.writingMode) {
    parts.push(`wm:${en.writingMode}`);
    sub.text = true;
  }
  if (en.textOrientation) {
    parts.push(`tor:${en.textOrientation}`);
    sub.text = true;
  }
  if (en.glyphAdjustments) {
    parts.push(`ga:${JSON.stringify(en.glyphAdjustments)}`);
    sub.text = true;
  }
  if (en.pairAdjustments) {
    parts.push(`pa:${JSON.stringify(en.pairAdjustments)}`);
    sub.text = true;
  }
  if (en.textWrapShape) {
    parts.push(`tws:${JSON.stringify(en.textWrapShape)}`);
    sub.text = true;
  }
  if (en.fontReference) {
    // Font identity. The resolved family is hashed above, but two references can
    // resolve to different faces (weight/width/italic axis, a variable instance,
    // a fallback chain), so the reference itself belongs in the key.
    parts.push(`fr:${JSON.stringify(en.fontReference)}`);
    sub.text = true;
  }

  if (en.effects && en.effects.length > 0) {
    parts.push(JSON.stringify(en.effects));
    sub.effects = true;
  }
  if (en.filters && en.filters.length > 0) {
    parts.push(JSON.stringify(en.filters));
    sub.effects = true;
  }

  if (en.src) {
    parts.push(`src:${imageSrcHashProxy(en.src)}`);
    sub.image = true;
  }
  if (en.rasterLayerData) {
    parts.push(rasterLayerVersionSummary(en.rasterLayerData));
    sub.image = true;
  }

  if (en.alphaMask) {
    // Mask URL length alone is not a safe identity: an edited mask (v1 → v2)
    // or a swapped render proxy can produce a payload of the same byte
    // length, and the cache would then keep serving the OLD mask URL — stale
    // cutout pixels on a document that never changed otherwise. Sample the
    // URL like image srcs do (bounded, position-spread) so any content
    // change to the mask invalidates the cached IR.
    parts.push(`mask:${imageSrcHashProxy(en.alphaMask)}`);
    sub.mask = true;
  }

  return { parts, sub };
}

export interface SubtreeIrCacheEntry {
  hash: string;
  item: RenderItem;
  lastUsed: number;
  bytes: number;
}

/** Eviction reason for diagnostics. */
export type EvictionReason = 'entry_count' | 'byte_budget' | 'oversized_entry';

export interface EvictionEvent {
  nodeId: string;
  bytes: number;
  reason: EvictionReason;
}

export class SubtreeIrCache {
  private readonly maxEntries: number;
  private softBytes: number;
  private readonly hardBytes: number;
  private readonly entries = new Map<string, SubtreeIrCacheEntry>();
  private currentBytes = 0;
  private hitCount = 0;
  private missCount = 0;
  private evictionLog: EvictionEvent[] = [];

  constructor(maxEntries = 500, softBytes = 50 * 1024 * 1024, hardBytes = 100 * 1024 * 1024) {
    this.maxEntries = maxEntries;
    this.softBytes = softBytes;
    this.hardBytes = hardBytes;
  }

  /** Estimate retained byte size of a RenderItem.
   *
   * Conservative estimate based on JSON serialisation size (multiplied by 2
   * for UTF-16 overhead) plus fixed per-object overhead. Actual JS engine
   * memory may differ, but this provides a consistent relative measure.
   *
   * A RenderItem for an image fill embeds the full `src` data URL (see engine
   * buildIr), which can be several megabytes. A naive JSON.stringify(item) is
   * therefore O(image bytes) on every cache store — the same class of hidden
   * cost as hashing the src verbatim. Collapse long strings to a marker in the
   * serialized output while still counting their real length (String.length is
   * O(1)); the byte estimate — and thus eviction behaviour — is unchanged, but
   * the cost is bounded regardless of image size.
   *
   * Tile pixel payloads are handled differently, because the ownership is
   * different: a raster tile's `pixels` is a **reference** to the document's
   * immutable buffer, not a copy the cache owns. Walking it therefore both
   * mis-accounts memory (double-counting the document, and inflating one
   * 65,536-byte tile to roughly 450 KB of JSON) and costs O(raster bytes) on
   * the frame that stores the entry. The inflation was not cosmetic: it made
   * any raster layer above roughly 7 MiB of pixels look like an oversized
   * entry, so `set` refused it and raster layers got no IR reuse at all while
   * still paying the conversion and the stringify every frame. Tiles are now
   * charged {@link TILE_REFERENCE_BYTES} each — the key, record and pointer the
   * entry actually holds — and the pixels are never visited.
   */
  static estimateItemBytes(item: RenderItem): number {
    try {
      let longStringChars = 0;
      let tileRefs = 0;
      const json = JSON.stringify(item, (key, value) => {
        if (typeof value === 'string' && value.length > MAX_INLINE_SRC) {
          longStringChars += value.length;
          return '';
        }
        if (key === 'pixels' && isTilePixelPayload(value)) {
          tileRefs++;
          return TILE_PAYLOAD_MARKER;
        }
        return value;
      });
      return (json.length + longStringChars) * 2 + 64 + tileRefs * TILE_REFERENCE_BYTES;
    } catch {
      return 1024;
    }
  }

  /** FNV-1a hash of node fields relevant to IR generation.
   *
   * Includes node content fields (shape kind, fill, strokes, opacity, blend
   * mode, rotation, corner radius) alongside styleKey and transform.
   *
   * Deliberately excludes any document-wide revision counter: docVersion
   * bumps on every edit anywhere in the document (see CanvasArea.tsx), so
   * mixing it into a per-node hash would invalidate every other node's
   * entry on every single edit, defeating selective invalidation entirely.
   * Callers are responsible for explicitly invalidating a node's entry
   * (`invalidate(nodeId)`) when that node's own data changes — this hash
   * only needs to catch content drift for nodes that were *not* explicitly
   * invalidated (defence-in-depth). */
  static nodeHash(
    nodeId: string,
    transform: readonly number[],
    styleKey: string,
    contentParts?: readonly string[],
  ): string {
    let h = 2166136261;
    const parts = [nodeId, styleKey, ...transform.map(String)];
    if (contentParts) parts.push(...contentParts);
    for (const p of parts) {
      for (let i = 0; i < p.length; i++) {
        h ^= p.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
    }
    return (h >>> 0).toString(36);
  }

  get(nodeId: string, hash: string): RenderItem | null {
    const e = this.entries.get(nodeId);
    if (e && e.hash === hash) {
      e.lastUsed = performance.now();
      // Map iteration order is insertion order, so re-inserting on access makes
      // the map itself the LRU queue: the least-recently-used entry is always
      // the first key. This is what lets evictIfNeeded avoid sorting.
      this.entries.delete(nodeId);
      this.entries.set(nodeId, e);
      this.hitCount++;
      return e.item;
    }
    this.missCount++;
    return null;
  }

  set(nodeId: string, hash: string, item: RenderItem): void {
    const bytes = SubtreeIrCache.estimateItemBytes(item);

    // Refuse entries larger than the entire soft budget.
    if (bytes > this.softBytes) {
      this.evictionLog.push({ nodeId, bytes, reason: 'oversized_entry' });
      return;
    }

    // Remove old entry for this node if it exists (replacement accounting).
    // The delete is also what re-queues an overwritten node as most-recently
    // used: a plain Map.set on an existing key keeps its original position.
    const old = this.entries.get(nodeId);
    if (old) {
      this.currentBytes = Math.max(0, this.currentBytes - old.bytes);
      this.entries.delete(nodeId);
    }

    this.entries.set(nodeId, { hash, item, lastUsed: performance.now(), bytes });
    this.currentBytes += bytes;
    this.evictIfNeeded();
  }

  invalidate(nodeId?: string): void {
    if (!nodeId) {
      this.entries.clear();
      this.currentBytes = 0;
      return;
    }
    const old = this.entries.get(nodeId);
    if (old) {
      this.currentBytes = Math.max(0, this.currentBytes - old.bytes);
    }
    this.entries.delete(nodeId);
  }

  clear(): void {
    this.entries.clear();
    this.currentBytes = 0;
    this.hitCount = 0;
    this.missCount = 0;
    this.evictionLog = [];
  }

  private isOverBudget(): boolean {
    return this.entries.size > this.maxEntries || this.currentBytes > this.softBytes;
  }

  private evictIfNeeded(): void {
    // O(1) per eviction: the map is maintained in LRU order by get()/set(), so
    // the first key is always the least-recently-used entry and no sort is
    // needed. This previously sorted the entire map — once per evicted entry,
    // so shedding K entries cost K × O(n log n). Because any document with
    // more nodes than maxEntries sits permanently over the entry cap, every
    // set() evicted, which put that sort on the drag hot path: a 932-node drag
    // profile attributed ~4.7% of CPU to evictIfNeeded and its comparator.
    while (this.isOverBudget()) {
      const oldest = this.entries.entries().next();
      if (oldest.done) break;
      const [id, entry] = oldest.value;
      const reason: EvictionReason =
        this.entries.size > this.maxEntries ? 'entry_count' : 'byte_budget';
      this.currentBytes = Math.max(0, this.currentBytes - entry.bytes);
      this.entries.delete(id);
      if (this.evictionLog.length < 100) {
        this.evictionLog.push({ nodeId: id, bytes: entry.bytes, reason });
      }
    }
  }

  /** Current estimated retained bytes. */
  get currentMemoryBytes(): number {
    return this.currentBytes;
  }

  /** Current entry count. */
  get entryCount(): number {
    return this.entries.size;
  }

  /** Soft byte budget. */
  get softBudget(): number {
    return this.softBytes;
  }

  /** Adjust soft budget dynamically (e.g., from adaptive profile). Triggers eviction if needed. */
  setSoftBudget(bytes: number): void {
    const oldSoft = this.softBytes;
    this.softBytes = Math.max(bytes, 1024 * 1024);
    if (this.softBytes < oldSoft) {
      this.evictIfNeeded();
    }
  }

  /** Hard byte limit (entries exceeding this are refused). */
  get hardBudget(): number {
    return this.hardBytes;
  }

  /** Cache hit count since last clear. */
  get hits(): number {
    return this.hitCount;
  }

  /** Cache miss count since last clear. */
  get misses(): number {
    return this.missCount;
  }

  /** Hit rate (0–1) since last clear. */
  get hitRate(): number {
    const total = this.hitCount + this.missCount;
    return total > 0 ? this.hitCount / total : 0;
  }

  /** Recent eviction events (capped at 100). */
  get recentEvictions(): readonly EvictionEvent[] {
    return this.evictionLog;
  }

  /** Return diagnostics snapshot. */
  diagnostics(): {
    entries: number;
    bytes: number;
    softBudget: number;
    hardBudget: number;
    hits: number;
    misses: number;
    hitRate: number;
    recentEvictions: readonly EvictionEvent[];
  } {
    return {
      entries: this.entryCount,
      bytes: this.currentMemoryBytes,
      softBudget: this.softBytes,
      hardBudget: this.hardBytes,
      hits: this.hitCount,
      misses: this.missCount,
      hitRate: this.hitRate,
      recentEvictions: this.evictionLog,
    };
  }
}

export interface NodeHashResult {
  hash: string;
  /** Content parts, kept so the cache store-path can reuse them without a recompute. */
  parts: string[];
}

/**
 * Cross-frame memo for the per-node content hash (cacheContentParts + nodeHash).
 *
 * The hash is a pure function of a node's document-derived content and its
 * world transform. Strata's Document is immutable with structural sharing, so
 * an unchanged document keeps the SAME `doc` object reference, and
 * getWorldTransform returns a stable Affine reference until a node's transform
 * is invalidated (which only happens on a document edit). Therefore, when the
 * `doc` reference AND a node's world-transform reference both match the previous
 * frame, the node's hash is provably identical and need not be recomputed.
 *
 * Why this is safe (no stale renders / no false cache hits):
 *  - The returned hash is byte-identical to what the un-memoized path computes,
 *    so it can never produce a false SubtreeIrCache hit — the IR cache's own
 *    get(nodeId, hash) still decides hits. This only avoids recomputing a value.
 *  - Any document edit produces a new `doc` reference (verified: updateDoc
 *    returns `{ ...doc, nodes: { ...doc.nodes, [id]: next } }`), which clears the
 *    memo via beginFrame(). Shared-paint / mask-asset / variable / style edits
 *    all mutate the document too, so they also produce a new `doc` reference —
 *    that's why the key is the whole `doc`, not the per-node object.
 *  - `extraKey` carries any per-frame input that feeds node content but is NOT
 *    part of `doc` (e.g. the "show original background" compare toggle).
 *
 * Effect: pan / zoom / rotate / viewport-resize / DPR / theme changes — which
 * touch neither `doc` nor world transforms — skip the entire hash loop.
 */
export class NodeHashMemo {
  private entries = new Map<string, { world: readonly number[]; result: NodeHashResult }>();
  private docRef: unknown = undefined;
  private extraKey = '\0uninit';
  private computeCount = 0;
  private hitCount = 0;

  /**
   * Call once per frame before hashing. Clears the memo when the frame's shared
   * inputs (document reference, or the extra per-frame key) changed, so a stale
   * hash can never survive a document edit.
   */
  beginFrame(doc: unknown, extraKey = ''): void {
    if (doc !== this.docRef || extraKey !== this.extraKey) {
      this.entries.clear();
      this.docRef = doc;
      this.extraKey = extraKey;
    }
  }

  /**
   * Return the memoized hash for `node` when its world transform matches the
   * memoized one (the document is already known-unchanged via beginFrame);
   * otherwise compute, memoize, and return it. `node.transform` must be the
   * world transform (the same reference getWorldTransform returned).
   */
  hash(nodeId: string, node: EngineNode, styleKey: string): NodeHashResult {
    const world = node.transform;
    const existing = this.entries.get(nodeId);
    // styleKey (doc.nodes[id].styleId) is document-derived, so an unchanged
    // `doc` already implies an unchanged styleKey — the world-transform match is
    // the only per-node check needed here.
    if (existing && existing.world === world) {
      this.hitCount++;
      return existing.result;
    }
    const parts = cacheContentParts(node).parts;
    const hash = SubtreeIrCache.nodeHash(nodeId, world, styleKey, parts);
    const result: NodeHashResult = { hash, parts };
    this.entries.set(nodeId, { world, result });
    this.computeCount++;
    return result;
  }

  /** Number of real hash computations since construction (perf guard: flat during pan). */
  get computes(): number {
    return this.computeCount;
  }
  /** Number of memo hits since construction. */
  get hits(): number {
    return this.hitCount;
  }
  /** Current memoized-node count. */
  get size(): number {
    return this.entries.size;
  }
  /** Drop all memoized state (used when the IR cache is fully invalidated). */
  clear(): void {
    this.entries.clear();
    this.docRef = undefined;
    this.extraKey = '\0uninit';
  }
}
