import type { Affine } from '@varve/engine';
import type { TableModel } from '../../table';
import type { Effect, Stroke } from '../appearance';
import type { NodeId } from '../ids';
import type { NodeBase } from './base';

// ── Constraints types (Figma-style responsive positioning) ─────────────────

export type ConstraintAxis = 'min' | 'max' | 'center' | 'centerOffset' | 'stretch' | 'scale';

export interface Constraints {
  horizontal: ConstraintAxis;
  vertical: ConstraintAxis;
}

/** B2: TypeScript mirror of strata-layout LayoutStyle (Rust). */
export type LayoutMode = 'flex' | 'grid';

export type FlexDirection = 'row' | 'column' | 'rowReverse' | 'columnReverse';

export interface LayoutStyle {
  mode: LayoutMode;
  /** Optional versioned layout semantics. Missing values preserve legacy document behavior. */
  layoutSemanticsVersion?: 1 | 2;
  direction: FlexDirection;
  gap: number;
  wrap: boolean;
  /** [top, right, bottom, left] in px. */
  padding: [number, number, number, number];
  grow: number;
  shrink: number;
  /** F6: alignment and justification. */
  alignItems?: 'start' | 'center' | 'end' | 'stretch';
  justifyContent?: 'start' | 'center' | 'end' | 'spaceBetween' | 'spaceAround' | 'spaceEvenly';
  /** P3: Grid template columns (e.g., "1fr 200px 1fr", "repeat(3, 1fr)"). */
  gridTemplateColumns?: string;
  /** Stable per-track identity; when present this array is authoritative over the template string. */
  gridColumnTracks?: GridTrack[];
  /** P3: Grid template rows (e.g., "auto 1fr auto"). */
  gridTemplateRows?: string;
  /** Stable per-track identity; when present this array is authoritative over the template string. */
  gridRowTracks?: GridTrack[];
  /** P3: Grid auto-flow: "row" | "column" | "row-dense" | "column-dense". */
  gridAutoFlow?: 'row' | 'column' | 'rowDense' | 'columnDense';
  /** P3: Row gap (separate from `gap` for grid). */
  rowGap?: number;
  /** P3: Column gap (separate from `gap` for grid). */
  columnGap?: number;
  /** Include visible stroke footprints in stack/grid padding and gaps. */
  includeBordersInLayout?: boolean;
  /** Paint order for overlapping flow items; authored order remains unchanged. */
  overlapOrder?: 'legacy' | 'firstOnTop' | 'lastOnTop';
}

/** How a child is sized within its parent's auto-layout. */
export type LayoutSizing = 'fixed' | 'hug' | 'fill' | 'relative';

export type LayoutPosition = 'flow' | 'absolute';

export type LayoutAlign = 'inherit' | 'start' | 'center' | 'end' | 'stretch';

/** A persisted grid track definition with an identity that survives reorder and resize. */
export interface GridTrack {
  id: string;
  size: string;
}

/** Grid item placement (column/row start/end or span). */
export interface GridItemPlacement {
  gridColumnStart?: number;
  gridColumnEnd?: number;
  gridColumnStartTrackId?: string;
  gridColumnSpan?: number;
  gridRowStart?: number;
  gridRowEnd?: number;
  gridRowStartTrackId?: string;
  gridRowSpan?: number;
}

export interface FrameNode extends NodeBase {
  kind: 'frame';
  /**
   * Semantic frame role. `exportRegion` marks an export-only region: it is
   * stored as a frame for schema and tooling compatibility, but it paints
   * nothing, adopts no children, and offers no auto-layout. Absent means an
   * ordinary frame.
   */
  frameRole?: 'frame' | 'exportRegion';
  transform: Affine;
  /** Frame width in world-space px. Set at creation; updated by resize. */
  w: number;
  /** Frame height in world-space px. Set at creation; updated by resize. */
  h: number;
  /** Child node ids in paint order. Slot bindings (task 1.1) extend this. */
  children: NodeId[];
  /** If this frame is a component instance, the component it instantiates. */
  componentId?: NodeId;
  /** Slot fills: slotId -> child NodeId (filled in task 1.1). */
  slots?: Record<string, NodeId>;
  /** B2: CSS layout properties (Taffy-backed). */
  layoutStyle?: LayoutStyle;
  /** Toggle clipping of children outside the frame bounds. Default true. */
  clipContent?: boolean;
  /** Active variant id for this component instance. */
  variant?: string;
  /** Per-property overrides on top of the variant/base component. */
  propertyOverrides?: Record<string, string | boolean | NodeId>;
  /** Last-synced property snapshot for override detection (component instances). */
  syncBaseline?: Record<string, unknown>;
  /** Mockup presentation instance (v2.16+). See mockup/types.ts. */
  mockup?: import('../../mockup/types').MockupInstanceData;
  /** F6: strokes on frame. */
  strokes: Stroke[];
  /** F6: effects on frame. */
  effects: Effect[];
  /** Uniform or per-corner radius for frame corners. */
  cornerRadius?: number | [number, number, number, number];
  /** Corner smoothing percentage (0-100, Sketch-style continuous corners). */
  cornerSmoothing?: number;
  /** Optional semantic panel metadata; frame geometry remains authoritative. */
  panel?: PanelMetadata;
}

export interface PanelMetadata {
  version: 1;
  panelId: string;
  readingOrder?: number;
  readingDirection?: 'ltr' | 'rtl';
  gutter?: number;
  /** Freeform/diagonal panels may provide a clipping path node. */
  clipPathId?: NodeId;
}

/**
 * V2.15+: native responsive table (ADR-0016).
 *
 * A table is a semantic document capability, not a collection of frames.
 * Content is data-backed (cells are lightweight records with stable ids);
 * the render layer compiles the model into grid primitives per frame and the
 * persistent document never flattens it. Row/column/cell ids are stable
 * across edits, spans, reordering, undo, clipboard round trips, and
 * collaboration.
 */
export interface TableNode extends NodeBase {
  kind: 'table';
  transform: Affine;
  /** Table frame width (the layout target; tracks resolve against it). */
  w: number;
  /** Table frame height. */
  h: number;
  table: TableModel;
  /** Clip cell content to the table bounds. Default true. */
  clipContent?: boolean;
  /** F6: strokes on the table frame. */
  strokes: Stroke[];
  /** F6: effects on the table frame. */
  effects: Effect[];
  cornerRadius?: number;
  cornerSmoothing?: number;
}
