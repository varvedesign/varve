import type { Affine } from '@varve/engine';
import type { ManagedColor } from '../colorManagement';
import type { BlendMode } from './appearance';
import type { NodeId } from './ids';

// ── Guide interface ──────────────────────────────────────────────────────────

export interface Guide {
  id: string;
  axis: 'horizontal' | 'vertical';
  position: number;
  /** Page this guide belongs to (multi-page documents). Omitted on legacy flat docs. */
  pageId?: NodeId;
  locked?: boolean;
  color?: string;
}

// ── Surface types ────────────────────────────────────────────────────────────

/**
 * An unbounded organizational surface for exploratory/UI design work.
 *
 * A Design Canvas is Varve's distinct equivalent of Figma's organizational
 * pages. It owns an ordinary group subtree but deliberately has no trim,
 * bleed, spread, master, or print-export semantics. Publishing `Page`s below
 * remain output surfaces for Print workspace documents.
 */
export interface DesignCanvas {
  id: NodeId;
  name: string;
  /** Stable fractional-indexing key for the canvas navigator. */
  order: string;
  /** Transparent group that owns all content scoped to this canvas. */
  contentRoot: NodeId;
}

// ── Layer States (saved view/layer states — Varve-native, no Photoshop comps) ──

export type LayerStateCategory = 'visibility' | 'transforms' | 'appearance';

export interface AppearanceSnapshot {
  opacity?: number;
  blendMode?: BlendMode;
  fill?: ManagedColor;
}

export interface LayerStateCapture {
  visibility?: Record<NodeId, boolean>;
  transforms?: Record<NodeId, Affine>;
  appearance?: Record<NodeId, AppearanceSnapshot>;
}

export interface LayerState {
  /** Stable id (never the node name). */
  id: string;
  name: string;
  categories: LayerStateCategory[];
  captured: LayerStateCapture;
  createdAt: string;
}
