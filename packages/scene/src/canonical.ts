/**
 * Schema-aware canonical document serialization (ADR-0027).
 *
 * Produces deterministic, cross-platform canonical bytes for a Document:
 * - schema-defined property ordering per type (identity/kind first, then
 *   authored fields, then sorted unknown extension keys)
 * - stable map ordering (keys sorted lexicographically)
 * - authored-order arrays preserved (children, fills, strokes, effects,
 *   points, runs, keyframes, pages, ...) — never sorted
 * - number policy: -0 → 0, non-finite values rejected
 * - strings preserved exactly (no Unicode normalization)
 * - undefined omitted, null preserved
 * - binary payloads excluded: `DocumentAsset.dataUrl` and
 *   `RasterMaskAsset.dataUrl` are replaced by their content-addressed
 *   reference (`asset:<id>`); per-fill `image.src` that duplicates an asset
 *   payload is likewise referenced
 *
 * Idempotence: canonicalize(canonicalize(doc)) === canonicalize(doc).
 * Hash input: exactly these bytes via SHA-256 (./sha256.ts).
 */
import type { Document } from './document';
import { Sha256Stream } from './sha256';
import type { SceneNode } from './types';

export interface CanonicalizeOptions {
  /** Replace binary payloads with their content reference (default true). */
  excludePayloads?: boolean;
  /** Omit derived runtime counters from content hashes (history policy). */
  excludeVolatile?: boolean;
}

export class CanonicalizationError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${message} at ${path}`);
    this.path = path;
  }
}

// ── Schema: property ordering ────────────────────────────────────────────────

const DOCUMENT_KEY_ORDER: readonly string[] = [
  'id',
  'formatVersion',
  'name',
  'nextId',
  'canvasWidth',
  'canvasHeight',
  'canvasBackground',
  'exportDefaults',
  'rootChildren',
  'globalChildren',
  'nodes',
  'components',
  'pages',
  'pageLayout',
  'spreads',
  'sections',
  'facingPages',
  'masters',
  'activePageId',
  'guides',
  'gridSettings',
  'colorConfig',
  'documentUnit',
  'physicalWidth',
  'physicalHeight',
  'dpi',
  'bleed',
  'safeArea',
  'slug',
  'swatches',
  'spotColors',
  'spotLibraries',
  'proofConfig',
  'paints',
  'styles',
  'variableStore',
  'installedLibraries',
  'fontManifest',
  'selectionSets',
  'interactions',
  'stateMachines',
  'timelines',
  'activeTimelineId',
  'motionExtensions',
  'motionPresets',
  'textChains',
  'stories',
  'brushPresets',
  'rasterMaskAssets',
  'depthMaps',
  'iconAssets',
  'assets',
  'generativeEdits',
  'iccProfiles',
  'mockupTemplates',
  'gradientPresets',
  'logoProject',
  'presentation',
  'emailProfile',
  'emailSemantics',
  'linterConfig',
];

/** Fields common to every node, in canonical order. */
const NODE_BASE_KEY_ORDER: readonly string[] = [
  'id',
  'kind',
  'name',
  'nameMode',
  'layerColor',
  'order',
  'visible',
  'locked',
  'opacity',
  'blendMode',
  'rotation',
  'bindings',
  'fill',
  'fills',
  'paintRefs',
  'index',
  'minWidth',
  'preferredWidth',
  'maxWidth',
  'minHeight',
  'preferredHeight',
  'maxHeight',
  'layoutSizing',
  'layoutSizingWidth',
  'layoutSizingHeight',
  'layoutRelativeWidth',
  'layoutRelativeHeight',
  'layoutPosition',
  'layoutAlign',
  'gridPlacement',
  'constraints',
  'presets',
  'styleId',
  'styleOverrides',
  'snapExcluded',
  'mask',
  'iconAssetId',
];

/** Kind-specific field order; unknown keys appended sorted. */
const NODE_KIND_KEY_ORDER: Record<string, readonly string[]> = {
  shape: ['shape', 'shapeless', 'strokes', 'effects', 'cornerRadius', 'cornerSmoothing'],
  text: [
    'text',
    'w',
    'h',
    'fontSize',
    'fontFamily',
    'fontWeight',
    'fontStyle',
    'lineHeight',
    'letterSpacing',
    'textAlign',
    'textAlignVertical',
    'writingMode',
    'textOrientation',
    'textWrapShape',
    'textCase',
    'textDecoration',
    'listStyle',
    'richText',
    'glyphAdjustments',
    'warpSettings',
    'strokes',
    'effects',
  ],
  group: ['transform', 'children', 'isolated', 'effects'],
  frame: [
    'frameRole',
    'transform',
    'w',
    'h',
    'children',
    'componentId',
    'slots',
    'variant',
    'propertyOverrides',
    'syncBaseline',
    'layoutStyle',
    'clipContent',
    'cornerRadius',
    'cornerSmoothing',
    'mockup',
    'strokes',
    'effects',
  ],
  table: [
    'transform',
    'w',
    'h',
    'table',
    'clipContent',
    'strokes',
    'effects',
    'cornerRadius',
    'cornerSmoothing',
  ],
  adjustment: [
    'adjustmentType',
    'params',
    'transform',
    'clipping',
    'adjustments',
    'scope',
    'effects',
  ],
  path: ['points', 'closed', 'transform', 'strokes', 'effects'],
  rasterLayer: ['width', 'height', 'pixelMode', 'tiles', 'transform', 'effects'],
};

const FILL_KEY_ORDER: readonly string[] = [
  'type',
  'color',
  'gradient',
  'image',
  'opacity',
  'blendMode',
  'visible',
];

const STROKE_KEY_ORDER: readonly string[] = [
  'color',
  'width',
  'opacity',
  'blendMode',
  'visible',
  'align',
  'cap',
  'join',
  'miterLimit',
  'dashArray',
  'dashOffset',
];

const EFFECT_KEY_ORDER: readonly string[] = [
  'type',
  'radius',
  'spread',
  'color',
  'offsetX',
  'offsetY',
  'opacity',
  'blendMode',
  'visible',
  'inset',
  'angle',
  'scaleX',
  'scaleY',
  'tint',
];

const TEXT_RUN_KEY_ORDER: readonly string[] = ['text', 'format', 'characterStyleId'];
const PARAGRAPH_KEY_ORDER: readonly string[] = ['runs', 'format', 'paragraphStyleId'];
const POINT_KEY_ORDER: readonly string[] = ['x', 'y', 'in', 'out', 'smooth', 'type'];
const SHAPE_PATH_KEY_ORDER: readonly string[] = [
  'kind',
  'x',
  'y',
  'w',
  'h',
  'cx',
  'cy',
  'rx',
  'ry',
  'r',
  'from',
  'to',
  'radius',
  'sides',
  'rotation',
  'innerRadius',
  'outerRadius',
  'points',
  'closed',
  'tolerance',
  'contours',
  'holes',
  'fillRule',
];
const COLOR_KEY_ORDER: readonly string[] = [
  'space',
  'bitDepth',
  'r',
  'g',
  'b',
  'a',
  'c',
  'm',
  'y',
  'k',
  'gray',
  'l',
  'h',
  'name',
  'library',
  'tint',
  'fallback',
  'profile',
  'id',
];

const PATH_ORDER_MAP: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/\.fills\[\d+\]$/, FILL_KEY_ORDER],
  [/\.strokes\[\d+\]$/, STROKE_KEY_ORDER],
  [/\.effects\[\d+\]$/, EFFECT_KEY_ORDER],
  [/\.runs\[\d+\]$/, TEXT_RUN_KEY_ORDER],
  [/\.paragraphs\[\d+\]$/, PARAGRAPH_KEY_ORDER],
  [/\.points\[\d+\]$/, POINT_KEY_ORDER],
  [/\.shape$/, SHAPE_PATH_KEY_ORDER],
];

// ── Canonical serialization core ─────────────────────────────────────────────

interface SerializeCtx {
  excludePayloads: boolean;
  excludeVolatile: boolean;
  payloadOwners: Set<string>;
  payloadToAssetId: Map<string, string>;
  /**
   * Keep binary values as typed-array leaves instead of expanding them to
   * number arrays. Only the streaming digest sets this: it writes the same
   * decimal text for them directly into the hasher.
   */
  typedArrayLeaves: boolean;
}

function normalizeNumber(value: number, path: string): number {
  if (!Number.isFinite(value)) {
    throw new CanonicalizationError(path, 'non-finite number is not canonicalizable');
  }
  return value === 0 ? 0 : value; // -0 → 0
}

/**
 * True for the byte arrays raster tiles and masks are stored in.
 *
 * `instanceof` alone is realm-bound: a typed array created in another realm
 * (an iframe, a `vm` context, a jsdom test environment) fails it even though
 * it is exactly a `Uint8ClampedArray`, and would then canonicalize as an
 * index-keyed object. The intrinsic `toStringTag` is realm-independent.
 */
export function isByteArray(value: unknown): value is Uint8Array | Uint8ClampedArray {
  if (value instanceof Uint8Array || value instanceof Uint8ClampedArray) return true;
  if (typeof value !== 'object' || value === null || !ArrayBuffer.isView(value)) return false;
  const tag = Object.prototype.toString.call(value);
  return tag === '[object Uint8Array]' || tag === '[object Uint8ClampedArray]';
}

/** Recursively build a canonical (ordered) plain object tree. */
function canonify(value: unknown, path: string, ctx: SerializeCtx): unknown {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'number') return normalizeNumber(value as number, path);
  if (t === 'string' || t === 'boolean') return value;
  if (Array.isArray(value)) {
    // Arrays are always authored-order; never sorted.
    return value.map((item, i) => canonify(item, `${path}[${i}]`, ctx));
  }
  if (value instanceof Map) {
    return canonify(Object.fromEntries(value), path, ctx);
  }
  if (isByteArray(value)) {
    return ctx.typedArrayLeaves ? value : Array.from(value);
  }
  if (typeof value !== 'object') {
    throw new CanonicalizationError(path, `unsupported value type ${t}`);
  }
  const record = value as Record<string, unknown>;

  const out: Record<string, unknown> = {};
  for (const key of orderedKeys(record, path)) {
    if (ctx.excludeVolatile && path === '' && key === 'nextId') continue;
    let child = record[key];
    if (ctx.excludePayloads && typeof child === 'string') {
      if (key === 'src' && ctx.payloadToAssetId.has(child)) {
        child = `asset:${ctx.payloadToAssetId.get(child)}`;
      } else if (
        key === 'dataUrl' &&
        typeof record.id === 'string' &&
        ctx.payloadOwners.has(record.id)
      ) {
        child = `asset:${record.id}`;
      }
    }
    if (child === undefined) continue; // undefined omitted
    const childPath = path === '' ? key : `${path}.${key}`;
    out[key] = canonify(child, childPath, ctx);
  }
  return out;
}

function orderedKeys(value: Record<string, unknown>, path: string): string[] {
  const ordered = orderFor(value, path);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const key of ordered) {
    if (Object.hasOwn(value, key)) {
      result.push(key);
      seen.add(key);
    }
  }
  const unknown = Object.keys(value).filter((k) => !seen.has(k));
  unknown.sort();
  result.push(...unknown);
  return result;
}

function orderFor(value: Record<string, unknown>, path: string): readonly string[] {
  if (path === '') return DOCUMENT_KEY_ORDER;
  const nodeMatch = /^nodes\.([^.]+)$/.exec(path);
  if (nodeMatch && typeof value.kind === 'string') {
    const kindOrder = NODE_KIND_KEY_ORDER[value.kind];
    if (kindOrder) return [...NODE_BASE_KEY_ORDER, ...kindOrder];
  }
  for (const [pattern, order] of PATH_ORDER_MAP) {
    if (pattern.test(path)) return order;
  }
  if ('space' in value && typeof value.space === 'string') return COLOR_KEY_ORDER;
  // Content-based detection for the remaining known shapes: a fill object
  // carries `type` + `color`/`gradient`/`image`; a stroke carries `width`;
  // an effect carries `radius` and one of spread/offset/inset.
  if (
    typeof value.type === 'string' &&
    ('color' in value || 'gradient' in value || 'image' in value)
  ) {
    return FILL_KEY_ORDER;
  }
  if (typeof value.width === 'number' && 'color' in value) return STROKE_KEY_ORDER;
  if (
    typeof value.radius === 'number' &&
    ('spread' in value || 'offsetX' in value || 'inset' in value)
  ) {
    return EFFECT_KEY_ORDER;
  }
  return [];
}

function buildSerializeCtx(
  doc: Document,
  opts: CanonicalizeOptions,
  typedArrayLeaves: boolean,
): SerializeCtx {
  const excludePayloads = opts.excludePayloads ?? true;

  const payloadOwners = new Set<string>();
  const payloadToAssetId = new Map<string, string>();
  if (excludePayloads) {
    for (const [id, asset] of Object.entries(doc.assets ?? {})) {
      payloadOwners.add(id);
      if (typeof asset.dataUrl === 'string') payloadToAssetId.set(asset.dataUrl, id);
    }
    for (const id of Object.keys(doc.rasterMaskAssets ?? {})) {
      payloadOwners.add(id);
    }
  }

  return {
    excludePayloads,
    excludeVolatile: opts.excludeVolatile ?? false,
    payloadOwners,
    payloadToAssetId,
    typedArrayLeaves,
  };
}

/**
 * Canonicalize a document to deterministic JSON text.
 * Throws CanonicalizationError on non-finite numbers or unsupported values.
 */
export function canonicalizeDocument(doc: Document, opts: CanonicalizeOptions = {}): string {
  const tree = canonify(doc, '', buildSerializeCtx(doc, opts, false));
  return JSON.stringify(tree);
}

// ── Streaming digest ─────────────────────────────────────────────────────────
//
// `canonicalizeDocument` expands every raster tile byte into a JS number and
// then builds the whole document as one string, which is both slow (~270 ms
// per MiB of raster) and bounded by the engine's maximum string length. The
// digest below produces the *same bytes* — it is verified byte-for-byte against
// `canonicalizeDocument` — but writes them straight into an incremental
// SHA-256 through a small reusable buffer.

const SINK_CAPACITY = 1 << 16;
const SINK_HEADROOM = 8;

class DigestSink {
  private readonly buf = new Uint8Array(SINK_CAPACITY);
  private n = 0;
  private readonly hash = new Sha256Stream();
  private readonly encoder = new TextEncoder();

  private flush(): void {
    if (this.n > 0) {
      this.hash.update(this.buf, 0, this.n);
      this.n = 0;
    }
  }

  byte(b: number): void {
    if (this.n === SINK_CAPACITY) this.flush();
    this.buf[this.n++] = b;
  }

  /** Append a string already known to be 7-bit ASCII (numbers, literals). */
  ascii(text: string): void {
    for (let i = 0; i < text.length; i++) this.byte(text.charCodeAt(i));
  }

  /** Append `JSON.stringify(text)`, UTF-8 encoded. */
  jsonString(text: string): void {
    const json = JSON.stringify(text);
    for (let i = 0; i < json.length; i++) {
      if (json.charCodeAt(i) > 0x7f) {
        this.flush();
        this.hash.update(this.encoder.encode(json));
        return;
      }
    }
    this.ascii(json);
  }

  /** Append a byte array as the JSON number array `JSON.stringify` would emit. */
  bytes(values: Uint8Array | Uint8ClampedArray): void {
    this.byte(0x5b); // [
    const buf = this.buf;
    let n = this.n;
    for (let i = 0; i < values.length; i++) {
      if (n > SINK_CAPACITY - SINK_HEADROOM) {
        this.n = n;
        this.flush();
        n = 0;
      }
      if (i !== 0) buf[n++] = 0x2c; // ,
      const v = values[i]!;
      if (v >= 100) {
        buf[n++] = 0x30 + ((v / 100) | 0);
        buf[n++] = 0x30 + (((v / 10) | 0) % 10);
        buf[n++] = 0x30 + (v % 10);
      } else if (v >= 10) {
        buf[n++] = 0x30 + ((v / 10) | 0);
        buf[n++] = 0x30 + (v % 10);
      } else {
        buf[n++] = 0x30 + v;
      }
    }
    this.n = n;
    this.byte(0x5d); // ]
  }

  digestHex(): string {
    this.flush();
    return this.hash.digestHex();
  }
}

/**
 * Write a `canonify` tree exactly as `JSON.stringify` would: the tree is plain
 * objects/arrays/primitives plus typed-array leaves, `undefined` array items
 * become `null`, and `undefined` object members are omitted.
 */
function writeCanonical(sink: DigestSink, value: unknown): void {
  if (value === null || value === undefined) {
    sink.ascii('null');
    return;
  }
  switch (typeof value) {
    case 'number':
      sink.ascii(String(value));
      return;
    case 'boolean':
      sink.ascii(value ? 'true' : 'false');
      return;
    case 'string':
      sink.jsonString(value);
      return;
    default:
      break;
  }
  if (isByteArray(value)) {
    sink.bytes(value);
    return;
  }
  if (Array.isArray(value)) {
    sink.byte(0x5b);
    for (let i = 0; i < value.length; i++) {
      if (i > 0) sink.byte(0x2c);
      writeCanonical(sink, value[i]);
    }
    sink.byte(0x5d);
    return;
  }
  const record = value as Record<string, unknown>;
  sink.byte(0x7b);
  let first = true;
  for (const key of Object.keys(record)) {
    const member = record[key];
    if (member === undefined) continue;
    if (!first) sink.byte(0x2c);
    first = false;
    sink.jsonString(key);
    sink.byte(0x3a);
    writeCanonical(sink, member);
  }
  sink.byte(0x7d);
}

/**
 * SHA-256 of exactly the bytes `canonicalizeDocument` returns, without
 * materialising them. Throws CanonicalizationError like `canonicalizeDocument`.
 */
export function canonicalDocumentDigest(doc: Document, opts: CanonicalizeOptions = {}): string {
  const tree = canonify(doc, '', buildSerializeCtx(doc, opts, true));
  const sink = new DigestSink();
  writeCanonical(sink, tree);
  return sink.digestHex();
}

/**
 * Canonical SHA-256 digest (hex) of the document's canonical bytes —
 * the content hash used by revisions and snapshots (ADR-0021/0022).
 */
export function canonicalHash(doc: Document, opts: CanonicalizeOptions = {}): string {
  return canonicalDocumentDigest(doc, opts);
}

/**
 * Content hash used by persistent history and semantic merge/replay.
 * `nextId` is persisted for compatibility but is derived from document ids,
 * so it must not make two semantically identical revisions hash differently.
 */
export function canonicalHistoryHash(doc: Document): string {
  return canonicalHash(doc, { excludeVolatile: true });
}

export { canonicalDigest, sha256Hex, sha256Utf8 } from './sha256';

/** Type-only re-export to keep node shape imports available to callers. */
export type { SceneNode };
