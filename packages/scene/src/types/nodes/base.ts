import type { Adjustment, WarpModifier, WarpSettings } from '@varve/engine';
import type { ManagedColor } from '../../colorManagement';
import type { ExportPreset } from '../../export-types';
import type { LayerColor } from '../../layerColor';
import type { BlendMode } from '../appearance';
import type { PropertyBinding } from '../components';
import type { Fill } from '../fills';
import type { NodeId } from '../ids';
import type { Mask } from '../masks';
import type {
  Constraints,
  GridItemPlacement,
  LayoutAlign,
  LayoutPosition,
  LayoutSizing,
} from './containers';

// ── Base node ───────────────────────────────────────────────────────────────

export interface NodeBase {
  id: NodeId;
  name: string;
  /** Automatic names follow authored content; custom names are user-owned. */
  nameMode?: 'automatic' | 'custom';
  /** Optional 7-color layer tag (Photoshop/Affinity-style). Null = no tag. */
  layerColor?: LayerColor;
  fill: ManagedColor;
  /** P2: stacked fills (solid/gradient/image). When present, takes precedence over `fill`. */
  fills?: Fill[];
  /**
   * V1.8+: Ordered references to shared Paint entities on the Document.
   * When present, these paints are resolved from `Document.paints` and used
   * as the node's effective fill stack, replacing `fills`/`fill` for this node.
   * Each entry is a Paint ID.
   */
  paintRefs?: string[];
  /**
   * Paint order among siblings (0 = bottom). Reorder via Document.move.
   * @deprecated Use `order` (fractional-indexing) instead. This field is set at
   * creation time but never updated by reorder operations — it is vestigial.
   */
  index?: number;
  /** Fractional-indexing order key for CRDT-safe concurrent ordering. */
  order: string;
  visible: boolean;
  locked: boolean;
  /**
   * Solo view: when any node in the document is soloed, only soloed nodes are
   * effectively visible (all others are hidden for display). Reversible and
   * undo-friendly — it is just a boolean flag, never a destructive mutation.
   */
  solo?: boolean;
  /** F6: layer opacity 0-1 (default 1). */
  opacity: number;
  /** F6: CSS blend mode (default 'normal'). */
  blendMode: BlendMode;
  /** F6: rotation in degrees (default 0). Applied to transform on render. */
  rotation: number;
  /**
   * F6: optional variable bindings per property.
   * Keyed by property name (e.g. "fill", "opacity", "x", "y", "width",
   * "height", "rotation", "fontSize", "strokeWeight").
   */
  bindings?: Record<string, PropertyBinding>;
  /** P3: min/preferred/max width for clamp sizing. */
  minWidth?: number;
  preferredWidth?: number;
  maxWidth?: number;
  /** P3: min/preferred/max height for clamp sizing. */
  minHeight?: number;
  preferredHeight?: number;
  maxHeight?: number;
  /** P3: how this node is sized within its parent's auto-layout. */
  layoutSizing?: LayoutSizing;
  /** Width sizing within a layout parent. Falls back to layoutSizing for old documents. */
  layoutSizingWidth?: LayoutSizing;
  /** Authored width percentage for relative sizing. */
  layoutRelativeWidth?: number;
  /** Height sizing within a layout parent. Falls back to layoutSizing for old documents. */
  layoutSizingHeight?: LayoutSizing;
  /** Authored height percentage for relative sizing. */
  layoutRelativeHeight?: number;
  /** Whether this node participates in its parent's flow layout. */
  layoutPosition?: LayoutPosition;
  /** Optional cross-axis alignment override for a flow child. */
  layoutAlign?: LayoutAlign;
  /** P3: grid item placement within a grid parent. */
  gridPlacement?: GridItemPlacement;
  /** Figma-style constraints for responsive child positioning within frames. */
  constraints?: Constraints;
  /** Export presets for this node. */
  presets?: ExportPreset[];
  /** Reference to a reusable style definition. */
  styleId?: NodeId;
  /** Property overrides applied on top of the referenced style. */
  styleOverrides?: Record<string, unknown>;
  /** When true, this node is excluded from snapping calculations. */
  snapExcluded?: boolean;
  /** Native non-destructive mask. Leaf image shapes may own raster masks. */
  mask?: Mask;
  /**
   * Reference to a `Document.iconAssets` entry (v2.x icon system). When set,
   * the node is an icon instance: its visual content was derived from the
   * asset's sanitized SVG and the node carries icon provenance (provider,
   * licence, attribution, variant). Clearing the reference (detach) turns
   * the node into a plain editable group with no icon semantics.
   */
  iconAssetId?: string;
  /**
   * V2.16+: ordered, non-destructive geometry-modifier (warp) stack.
   *
   * The canonical source geometry is never rewritten; disabling or removing
   * these restores the exact source. Controls are normalized to the source
   * bounds unless a modifier sets `coordinateSpace: 'source-local'`. Only
   * shape/text/group/frame nodes may carry warps (see warpOps).
   */
  warps?: WarpModifier[];
  /** V2.16+: evaluation settings for the warp stack (quality/strokes/etc). */
  warpSettings?: WarpSettings;
  /**
   * Object-local nondestructive filter stack. Entries are evaluated in array
   * order against this node's rendered result; unlike AdjustmentNode entries,
   * these filters do not create a separate scene node or backdrop scope.
   */
  smartFilters?: Adjustment[];
  /** Stack-level bypass for Object Filters; absent is enabled for compatibility. */
  smartFiltersEnabled?: boolean;
}
