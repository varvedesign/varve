import type { Affine, FontReference, FrequencySeparationMethod, LiquifyField } from '@varve/engine';
import type { Effect } from '../appearance';
import type { NodeId } from '../ids';
import type { OpenTypeFeatureMap } from '../typography';
import type { NodeBase } from './base';
import type { CalloutRecipe } from './text';

export interface GroupNode extends NodeBase {
  kind: 'group';
  transform: Affine;
  /** Child node ids in paint order. */
  children: NodeId[];
  /**
   * When true, the group composites as an isolated group (backdrop is
   * transparent black). Default false (non-isolated = pass-through behavior
   * for normal blend mode). Per W3C isolated group behavior §8.3:
   * "An isolated group is one whose elements are composited onto a
   * transparent black initial backdrop."
   */
  isolated?: boolean;
  /** Effects applied to the group as a whole (shadows, blurs, glows). */
  effects: Effect[];
  /**
   * Lightweight provenance for groups created by Image Trace. Enables the
   * Edit Trace / Re-trace workflow: the dialog can be reopened pre-filled
   * with the original options, and re-traces replace this group in place.
   * Deliberately stores no image bytes — only the source node id and a
   * content hash for staleness checks.
   */
  traceMetadata?: TraceMetadata;
  /** Exact source/shaping provenance for a destructive text-to-outlines conversion. */
  outlinedTextMetadata?: OutlinedTextMetadata;
  /**
   * Non-destructive Pathfinder state. The group's direct children are the
   * ordered operands; renderer/export resolvers derive the visible compound
   * geometry from them and never serialize a copied result as authority.
   */
  boolean?: LiveBooleanState;
  /**
   * V2.17+: frequency-separation marker. When present and still linked, the
   * IR builder decodes `low + (high − 128)·2` instead of compositing the two
   * band children as ordinary layers. The marker stores band node ids, never
   * names; an unlinked marker renders as an ordinary group.
   */
  frequencySeparation?: FrequencySeparationState;
  /**
   * V2.17+: shared liquify deformation for a frequency-separation group.
   * Applied to the recombined composite (after the two bands are decoded), so
   * linked tone/detail components stay aligned. Meaningful only on marked
   * groups in this version; ordinary groups ignore it.
   */
  liquify?: LiquifyField;
  /** Parametric comic callout recipe; geometry and text remain ordinary nodes. */
  callout?: CalloutRecipe;
}

/**
 * Persistent frequency-separation linkage. Defined here (next to `GroupNode`)
 * so scene code can rely on it without importing the operations module.
 */
export interface FrequencySeparationState {
  /** Algorithm/serialization version; currently 1. */
  version: 1;
  method: FrequencySeparationMethod;
  /** Gaussian sigma in layer pixels at creation/regeneration time. */
  radius: number;
  lowNodeId: NodeId;
  highNodeId: NodeId;
  /** Wall-clock creation stamp; informational only. */
  createdAt?: number;
}

/**
 * Provenance retained on a group produced by text-to-outlines. Geometry is
 * authoritative after conversion, but this record keeps the logical source,
 * exact font identity, feature/axis choices, and source ranges needed for
 * diagnostics, export reporting, and a future "restore text" workflow.
 */
export interface OutlinedTextMetadata {
  schemaVersion: 1;
  sourceText: string;
  fontFamily?: string;
  fontReference?: FontReference;
  fontIdentity?: string;
  openTypeFeatures?: OpenTypeFeatureMap;
  variableAxes?: Record<string, number>;
  glyphs: Array<{
    nodeId: NodeId;
    glyphId?: number;
    sourceStart?: number;
    sourceEnd?: number;
  }>;
}

/** A live Boolean group evaluates its direct children in this operation. */
export interface LiveBooleanState {
  schemaVersion: 1;
  operation: 'union' | 'subtract' | 'intersect' | 'exclude';
}

/**
 * Versioned provenance for a traced group (see `GroupNode.traceMetadata`).
 * Stored on the group so it survives save/load and undo without embedding
 * raster data in the metadata.
 *
 * v1 stored the trace options and a coarse engine label. v2 adds the full
 * preparation stack, the provider that actually produced the result, the
 * effective trace raster dimensions, and source dimensions so re-tracing is
 * reproducible and honest about resolution. All v2 fields are optional so v1
 * documents keep loading.
 */
export interface TracePrepSnapshot {
  grayscale: boolean;
  invert: boolean;
  contrast: number;
  brightness: number;
  denoise: number;
  threshold: boolean;
  adaptiveThreshold: boolean;
  adaptiveWindow: number;
  adaptiveSensitivity: number;
  removeBackground: boolean;
}

export interface TraceMetadata {
  schemaVersion: 1 | 2;
  /** The image node this trace was generated from. */
  sourceNodeId: NodeId;
  /** Content hash of the source pixels at trace time (sha256 hex), when known. */
  sourceHash?: string;
  /** Trace mode: monochrome outline / grayscale / limited color / pixel art. */
  mode: 'monochrome' | 'grayscale' | 'color' | 'pixel-art';
  /** Filled silhouette vs stroked centerline. */
  traceMode: 'silhouette' | 'centerline';
  threshold: number;
  foreground: 'dark' | 'light';
  alphaThreshold: number;
  minArea: number;
  simplifyTolerance: number;
  maxPaths: number;
  maxColors: number;
  compoundHoles: boolean;
  /** v2: region output structure for multi-color modes. */
  structure?: 'cutout' | 'stacked';
  cornerAngle: number;
  /** Maximum Bezier fitting error in pixels (0.1–10). Default 1.0. */
  maxError?: number;
  centerlineWidth: number;
  centerlinePrune: number;
  /** v2: full source preparation stack, for faithful re-tracing. */
  prep?: TracePrepSnapshot;
  /** v2: provider id that produced the result (e.g. `native-trace`). */
  providerId?: string;
  /** v2: effective raster dimensions the provider traced, in pixels. */
  traceWidth?: number;
  traceHeight?: number;
  /** v2: source image pixel dimensions at trace time. */
  sourceWidth?: number;
  sourceHeight?: number;
  /** Which engine produced the result (native Rust / TS worker / WASM). */
  engine: 'native' | 'worker' | 'wasm' | 'direct';
  /** Result statistics at trace time. */
  stats: {
    pathCount: number;
    pointCount: number;
    holeCount: number;
    omittedHoles: number;
  };
  /** Milliseconds spent tracing (engine time only, informational). */
  traceMs?: number;
  createdAt: number;
}

// ── Live Trace Types ─────────────────────────────────────────────────────────

export interface LiveTraceParams {
  mode: 'monochrome' | 'grayscale' | 'color' | 'pixel-art';
  threshold: number;
  foreground: 'dark' | 'light';
  alphaThreshold: number;
  minArea: number;
  simplifyTolerance: number;
  maxPaths: number;
  maxColors: number;
  compoundHoles: boolean;
  /** Schema version. 1 = pre-overhaul (no bezier/centerline). 2 = current. */
  traceVersion?: number;
  /** Trace mode: silhouette (filled paths) or centerline (stroked paths). */
  traceMode?: 'silhouette' | 'centerline';
  /** Interior angle threshold for sharp corners (degrees, 90-180). Default 135. */
  cornerAngle?: number;
  /** Maximum Bezier fitting error in pixels (0.1-10). Default 1.0. */
  maxError?: number;
  /** Target stroke width for centerline mode in pixels (1-50). Default 2. */
  centerlineWidth?: number;
  /** Minimum branch length to keep for centerline mode in pixels (1-100). Default 4. */
  centerlinePrune?: number;
}

const CURRENT_TRACE_VERSION = 2;

export function defaultLiveTraceParams(): LiveTraceParams {
  return {
    mode: 'monochrome',
    threshold: 128,
    foreground: 'dark',
    alphaThreshold: 1,
    minArea: 4,
    simplifyTolerance: 0.75,
    maxPaths: 1000,
    maxColors: 8,
    compoundHoles: true,
    traceVersion: CURRENT_TRACE_VERSION,
    traceMode: 'silhouette',
    cornerAngle: 135,
    maxError: 1.0,
    centerlineWidth: 2,
    centerlinePrune: 4,
  };
}

/** Migrate LiveTraceParams from older schema versions to the current one. */
export function migrateLiveTraceParams(params: Partial<LiveTraceParams>): Partial<LiveTraceParams> {
  const version = params.traceVersion ?? 1;
  if (version >= CURRENT_TRACE_VERSION) return params;
  const migrated = { ...params, traceVersion: CURRENT_TRACE_VERSION };
  if (version < 2) {
    if (migrated.traceMode === undefined) migrated.traceMode = 'silhouette';
    if (migrated.cornerAngle === undefined) migrated.cornerAngle = 135;
    if (migrated.maxError === undefined) migrated.maxError = 1.0;
    if (migrated.centerlineWidth === undefined) migrated.centerlineWidth = 2;
    if (migrated.centerlinePrune === undefined) migrated.centerlinePrune = 4;
  }
  return migrated;
}

export interface LiveTraceState {
  sourceNodeId: NodeId;
  params: LiveTraceParams;
  resolvedAt: number | null;
  lastError: string | null;
  /** ID of the generated vector group that visually replaces the source while live trace is active. */
  traceGroupId?: NodeId;
}
