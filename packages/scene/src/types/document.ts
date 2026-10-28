import type { BleedConfig, SafeAreaConfig, SlugConfig } from '../colorManagement';
import type { Guide } from './canvas';
import type { ComponentDefinition, Style } from './components';
import type { NodeId } from './ids';
import type { SceneNode } from './nodes/union';

export interface DocumentBase {
  nodes: Record<NodeId, SceneNode>;
  nextId: number;
  components: Record<NodeId, ComponentDefinition>;
  styles?: Record<string, Style>;
  installedLibraries?: Array<{
    id: string;
    name: string;
    version: string;
    installedAt: string;
  }>;
}

// ── Publishing page type ────────────────────────────────────────────────────

export interface Page {
  id: NodeId;
  name: string;
  width: number;
  height: number;
  /** Stable fractional-indexing order key for page sequencing. */
  order: PageOrder;
  /** Per-page bleed override (inherits from Document.bleed when unset). */
  bleed?: BleedConfig;
  /** Per-page safe area override (inherits from Document.safeArea when unset). */
  safeArea?: SafeAreaConfig;
  /** Per-page slug override (inherits from Document.slug when unset). */
  slug?: SlugConfig;
  /** Page-level background shape layer ids (rendered behind content). */
  backgrounds: NodeId[];
  /** Group node id that holds all page content as children. */
  contentRoot: NodeId;
  /** Optional ruler origin offset within the page (artboard-local px). */
  rulerOrigin?: { x: number; y: number };
  /** ID of the master page applied to this page (unset = no master). */
  masterPageId?: NodeId;
  /** Optional page-layout override; values are canonical document pixels. */
  layout?: PageLayoutSettings;
  /** Per-node overrides against the applied master. Keyed by master node ID. */
  masterOverrides?: Record<NodeId, MasterOverride>;
  /** Print/export settings for this page. */
  printSettings?: PagePrintSettings;
  /**
   * Pasteboard placement (world/pasteboard coordinates of the trim box
   * top-left). Absent = resolved deterministically by the pasteboard layout
   * engine. Placement is layout metadata, never content: moving a page must
   * not mutate any node transform (ADR-0124).
   */
  placement?: PagePlacement;
}

// ── Page ordering ──────────────────────────────────────────────────────────────

/** Stable ordering key for pages (fractional-indexing). */
export type PageOrder = string;

// ── Pasteboard placement ───────────────────────────────────────────────────────

/** World/pasteboard coordinates of a page or spread origin (top-left). */
export interface PagePlacement {
  x: number;
  y: number;
}

// ── Page side classification ──────────────────────────────────────────────────

/** Left/right page classification for facing-page spreads. */
export type PageSide = 'left' | 'right' | 'none';

// ── Master pages ──────────────────────────────────────────────────────────────

export type MasterAppliesTo = 'all' | 'left' | 'right';

export interface MasterPage {
  id: NodeId;
  name: string;
  width: number;
  height: number;
  /** Group node that holds all master content as children. */
  contentRoot: NodeId;
  /** Whether this master applies to all, left, or right pages. */
  appliesTo: MasterAppliesTo;
  /** Optional description shown in the masters panel. */
  description?: string;
  /** Optional layout defaults inherited by pages using this master. */
  layout?: PageLayoutSettings;
}

/**
 * Publishing-page layout settings. These are deliberately separate from a
 * frame's responsive auto-layout: margins/columns describe the page's
 * composition guides and never reposition authored objects by themselves.
 * Values are stored in canonical document pixels; the UI may present them in
 * another unit without changing the persisted geometry.
 */
export interface PageLayoutSettings {
  margins: {
    top: number;
    bottom: number;
    inside: number;
    outside: number;
  };
  columns: {
    count: number;
    gutter: number;
  };
  /** Independent horizontal tracks; omitted means one full-width row. */
  rows?: {
    count: number;
    gutter: number;
  };
  /** Display/snap styling is independent from frame auto-layout. */
  display?: boolean;
  snapEnabled?: boolean;
  locked?: boolean;
  color?: string;
  opacity?: number;
}

// ── Arrange operations ─────────────────────────────────────────────────────────

export type ArrangeOp = 'front' | 'back' | 'forward' | 'backward';

/** How a node is overridden on a derived page. */
export type MasterOverrideType = 'modified' | 'hidden' | 'deleted';

export interface MasterOverride {
  /** ID of the master's node that is being overridden. */
  masterNodeId: NodeId;
  /** Type of override. */
  type: MasterOverrideType;
  /** When type='modified': the replacement node (a local copy with changes). */
  localNodeId?: NodeId;
  /** When type='hidden': the node is invisible on this page. */
}

// ── Editorial spreads ─────────────────────────────────────────────────────────

/** Spread topology kind (ADR-0128/0129). */
export type SpreadKind = 'single' | 'facing' | 'foldout' | 'custom';

export interface Spread {
  id: NodeId;
  /** One page (single-page spread) or two pages (facing-page spread). */
  pageIds: [NodeId] | [NodeId, NodeId];
  /** Spread-level guides. */
  guides?: Guide[];
  /** Topology kind; absent = derived from facing-pages config. */
  kind?: SpreadKind;
  /**
   * Pasteboard placement of the spread origin (top-left of the first page).
   * Absent = resolved from member page placement or the layout engine
   * (ADR-0124).
   */
  placement?: PagePlacement;
}

// ── Facing pages configuration ────────────────────────────────────────────────

export interface FacingPagesConfig {
  enabled: boolean;
  /** Whether the first page is on the right side (default true). */
  startOnRight: boolean;
  /** Whether a blank page is inserted to ensure the first page is right-side. */
  autoInsertBlank?: boolean;
  /** Binding direction (default ltr); mirrors side classification (ADR-0129). */
  bindingDirection?: 'ltr' | 'rtl';
}

/**
 * Spread persistence model (ADR-0128):
 * - `derived`: spreads are a pure projection of page order (default).
 * - `custom`: spreads are user-authored records with stable ids; the derived
 *   projection never overwrites them.
 */
export type SpreadModel = 'derived' | 'custom';

// ── Page numbering and sections ───────────────────────────────────────────────

export type PageNumberStyle = 'decimal' | 'upperRoman' | 'lowerRoman' | 'upperAlpha' | 'lowerAlpha';

export interface PageSection {
  id: NodeId;
  name: string;
  /** Page order key where this section begins. */
  startPageOrder: PageOrder;
  /** Numbering style for this section. */
  numberStyle: PageNumberStyle;
  /** Starting page number (1-indexed; default 1). */
  startNumber: number;
  /** Whether page numbers are shown on pages in this section. */
  showPageNumber: boolean;
  /** Optional prefix before the number (e.g. "A-" for appendix). */
  prefix?: string;
}

// ── Print/Export settings (per-page overrides) ─────────────────────────────────

export interface PagePrintSettings {
  /** Whether this page is excluded from export. */
  excludeFromExport?: boolean;
  /** Per-page DPI override. */
  dpiOverride?: number;
  /** Per-page rotation for export (degrees, 0/90/180/270). */
  exportRotation?: 0 | 90 | 180 | 270;
}
