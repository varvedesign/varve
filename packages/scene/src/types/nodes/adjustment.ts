import type { Adjustment, Affine, LiquifyField, LiquifyFreezeMask } from '@varve/engine';
import type { ManagedColor } from '../../colorManagement';
import type { Effect } from '../appearance';
import type { NodeId } from '../ids';
import type { NodeBase } from './base';

export type AdaptiveContrastPolicy = 'wcag-aa' | 'wcag-aaa' | 'custom';

export interface AdaptiveContrastState {
  enabled: boolean;
  policy: AdaptiveContrastPolicy;
  lightColor?: ManagedColor;
  darkColor?: ManagedColor;
  customRatio?: number;
  hysteresis?: number;
  lastResolved?: number;
  resolvedColor?: ManagedColor;
}

export type AdjustmentScope =
  | { mode: 'image-local'; targetNodeId: NodeId }
  | { mode: 'explicit-targets'; targetNodeIds: NodeId[] }
  | { mode: 'container-descendant'; containerId: NodeId; includeNested: boolean }
  | { mode: 'document' };

// ── Adjustment Layer Types (Phase 1) ─────────────────────────────────────────

export type AdjustmentType = 'curves' | 'levels' | 'selectiveColor' | 'hsl' | 'exposure';

export interface AdjustmentCurvesPoint {
  x: number;
  y: number;
}

export interface AdjustmentCurves {
  channel: 'rgb' | 'red' | 'green' | 'blue';
  points: AdjustmentCurvesPoint[];
}

export interface AdjustmentLevels {
  channel: 'rgb' | 'red' | 'green' | 'blue';
  inputBlack: number;
  inputWhite: number;
  gamma: number;
  outputBlack: number;
  outputWhite: number;
}

export type SelectiveColorTarget =
  | 'red'
  | 'green'
  | 'blue'
  | 'cyan'
  | 'magenta'
  | 'yellow'
  | 'white'
  | 'neutral'
  | 'black';

export interface AdjustmentSelectiveColor {
  color: SelectiveColorTarget;
  cyan: number;
  magenta: number;
  yellow: number;
  black: number;
  method: 'absolute' | 'relative';
}

export type AdjustmentParams = AdjustmentCurves | AdjustmentLevels | AdjustmentSelectiveColor;

export interface AdjustmentNode extends NodeBase {
  kind: 'adjustment';
  adjustmentType: AdjustmentType;
  params: AdjustmentParams;
  transform: Affine;
  /** When true, only affects the layer directly below this adjustment.
   *  @deprecated Use `scope` field instead (v2.3+). This field is read
   *  during migration and during legacy scope resolution when `scope` is absent. */
  clipping: boolean;
  effects: Effect[];
  /** Nondestructive adjustment entries applied in sequence. */
  adjustments?: Adjustment[];
  /**
   * V2.3+: Explicit targeting scope that determines which nodes this
   * adjustment affects. When absent, legacy clipping-mode resolution is used
   * (sibling-below in paint order).
   *
   * See `AdjustmentScope` in `./adjustmentScope` for mode definitions.
   */
  scope?: AdjustmentScope;
}

// ── Raster Layer Node ─────────────────────────────────────────────────────────

export interface RasterTile {
  /** RGBA pixel data (128 * 128 * 4 bytes per tile). */
  pixels: Uint8ClampedArray;
  /** Monotonic version for cache invalidation. */
  version: number;
}

export interface RasterLayerNode extends NodeBase {
  kind: 'rasterLayer';
  /** Canvas width in pixels. */
  width: number;
  /** Canvas height in pixels. */
  height: number;
  /** Whether to constrain drawing to pixel grid. */
  pixelMode: boolean;
  /** Tile storage: key = "{col}:{row}" in 128×128 grid. */
  tiles: Map<string, RasterTile>;
  /** Local transform for positioning/rotation/scale. */
  transform: Affine;
  /** Optional source revision for an explicitly baked photographic repair. */
  retouchProvenance?: import('../../photoSource').RetouchProvenance;
  /** Non-destructive appearance effects applied to the composited raster. */
  effects?: Effect[];
  /**
   * V2.17+: non-destructive liquify deformation. The source tiles are never
   * rewritten by brush strokes; the deformation is resampled during IR build,
   * so the field stays re-editable and reversible. Absent = no deformation.
   */
  liquify?: LiquifyField;
  /**
   * V2.17+: marks this raster as a band of a linked frequency separation.
   * Rendering substitutes the decoded composite for the tone band and hides
   * the encoded detail band; the raw tiles remain the editable source. Set at
   * creation, cleared by flatten, remapped by clone.
   */
  frequencySeparationRole?: {
    groupId: NodeId;
    role: 'low' | 'high';
  };
  /**
   * V2.17+: frozen (protected) coverage for subsequent liquify strokes.
   * Authoring-only data: it never affects rendering. Absent = nothing frozen.
   */
  liquifyFreeze?: LiquifyFreezeMask;
}
