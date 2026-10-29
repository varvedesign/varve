import type { ResizeHandle } from '@varve/shared';
import type { IsometricSnapTarget } from '../isometricSnapping';

export interface SnapGuide {
  axis: 'horizontal' | 'vertical';
  position: number;
  label?: string;
  distance?: number;
  /** Stable identity of the target that produced this guide. */
  targetId?: string;
  /** Source and target features used by the solver (for feedback/debugging). */
  sourceFeature?: string;
  targetFeature?: string;
  /** The space in which position and correction are expressed. */
  referenceSpace?: 'world';
  /** Signed movement correction applied to the raw proposal on this axis. */
  correction?: number;
  /**
   * World position of a point-target snap (isometric lattice intersections).
   * When present, overlays render a crosshair at this point instead of an
   * axis-aligned line; `axis`/`position` remain a legacy fallback.
   */
  point?: { x: number; y: number };
  /** Finite winning segment for transformed layout feedback. */
  segment?: { start: { x: number; y: number }; end: { x: number; y: number } };
  type?:
    | 'guide'
    | 'layout-grid'
    | 'page-layout'
    | 'edge'
    | 'center'
    | 'midpoint'
    | 'spacing'
    | 'rotation'
    | 'size-match';
}

export interface GridSnapConfig {
  spacingX: number;
  spacingY: number;
  offsetX?: number;
  offsetY?: number;
  /** Rotation in radians around the configured grid origin. */
  rotation?: number;
}

export interface SnapBoxOptions {
  zoom?: number;
  /** Magnetic acquisition tolerance in CSS pixels. */
  tolerancePx?: number;
  otherBounds?: Array<{ x: number; y: number; w: number; h: number }>;
  /** Page, frame, and authored guide lines available to handle snapping. */
  lineTargets?: SnapLineTarget[];
  /** Finite transformed guide segments available to selection-box movement. */
  layoutGuideSegments?: SnapSegmentTarget[];
  /** Handle that produced this box. Enables anchor-preserving resize snaps. */
  resizeHandle?: ResizeHandle;
  /** A centred resize has no fixed opposite edge. */
  resizeCentered?: boolean;
  /** Keep the aspect ratio selected by the resize policy while snapping. */
  resizeProportional?: boolean;
  grid?: number | GridSnapConfig;
  layoutGridStep?: number;
  pixelGridSnap?: boolean;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
  /** Structured matches retained for overlays, diagnostics, and invalidation. */
  matches?: SnapMatch[];
}

export interface SnapMatch {
  targetId: string;
  sourceFeature: string;
  targetFeature: string;
  referenceSpace: 'world';
  correction: { x: number; y: number };
  category: NonNullable<SnapGuide['type']>;
}

/** A single world-axis line that a selection edge or centre can acquire. */
export interface SnapLineTarget {
  axis: 'horizontal' | 'vertical';
  position: number;
  id?: string;
  type?: SnapGuide['type'];
}

/** Finite oriented segment target used by transformed frame/page layouts. */
export interface SnapSegmentTarget {
  start: { x: number; y: number };
  end: { x: number; y: number };
  id?: string;
  type?: SnapGuide['type'];
}

export interface SnapTarget {
  id: string;
  bounds: { x: number; y: number; w: number; h: number };
  /** Optional hierarchy metadata used to make candidate scope explicit. */
  parentId?: string | null;
}

/** Sticky snap session — tracks active snap locks per axis (hysteresis). */
export interface SnapLock {
  guidePosition: number;
  snappedCoord: number;
  targetId?: string;
  sourceFeature?: string;
  targetFeature?: string;
  type?: SnapGuide['type'];
  referenceSpace?: 'world';
}

export interface SnapSession {
  stickyX: SnapLock | null;
  stickyY: SnapLock | null;
}

export interface SnapOptions {
  /** Current zoom for screen-pixel threshold scaling. Default 1. */
  zoom?: number;
  /** Magnetic acquisition/release tolerance in CSS pixels. */
  tolerancePx?: number;
  /** Prior sticky session for hysteresis. */
  session?: SnapSession | null;
  /** Unsnapped proposal for this sample. Required when a caller retains a corrected box. */
  rawIntent?: { x: number; y: number };
  /** Enable sticky (hysteresis) snap. Default true. */
  sticky?: boolean;
  /** Permanent ruler guides that objects can snap to. */
  guideTargets?: Array<{ axis: 'horizontal' | 'vertical'; position: number; id?: string }>;
  /** Layout grid cell size for frame grid snapping (world units). */
  layoutGridStep?: number;
  /** Authored frame layout-guide line targets in world coordinates. */
  layoutGridTargets?: Array<{ axis: 'horizontal' | 'vertical'; position: number; id?: string }>;
  /** Finite world-space layout segments; a winning projection moves both axes together. */
  layoutGuideSegments?: SnapSegmentTarget[];
  /** Pixel grid snapping (snaps to integer pixel coordinates). */
  pixelGridSnap?: boolean;
  /**
   * Isometric lattice snapping. Applied as one joint 2-D translation so a
   * multi-object selection keeps its internal arrangement. Competes with the
   * winning Cartesian/guide/object candidates by distance; the closer target
   * wins and exact ties prefer the isometric grid.
   */
  isometric?: IsometricSnapTarget;
  /**
   * Explicit source features for isometric snapping, in world space. Callers
   * pass the object's own anchors (path anchors, corners, line endpoints);
   * when absent the selection box corners/edges/centre are used.
   */
  snapFeatures?: readonly import('@varve/scene').Vec2[];
}

export const SNAP_RANGE_PX = 200;
export const DEFAULT_SNAP_TOLERANCE_PX = 8;
export const SNAP_TOLERANCE_MIN_PX = 1;
export const SNAP_TOLERANCE_MAX_PX = 32;

export type SnapTargetInput = { x: number; y: number; w: number; h: number } | SnapTarget;

export interface NormalizedSnapTarget extends SnapTarget {
  originalIndex: number;
  explicitId: boolean;
}
