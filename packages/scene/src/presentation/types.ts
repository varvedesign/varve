import type { EasingDefinition } from '@varve/shared';
import type { NodeId } from '../types';

/** Current on-disk version of the optional presentation metadata envelope. */
export const PRESENTATION_SCHEMA_VERSION = 2 as const;

/** Deterministic slide-to-slide transition kinds. */
export const PRESENTATION_TRANSITION_KINDS = [
  'none',
  'fade',
  'slide',
  'push',
  'wipe',
  'morph',
] as const;

export type PresentationTransitionKind = (typeof PRESENTATION_TRANSITION_KINDS)[number];

/** Screen edge the incoming slide relates to; content travel follows the name. */
export const PRESENTATION_TRANSITION_DIRECTIONS = ['left', 'right', 'up', 'down'] as const;

export type PresentationTransitionDirection = (typeof PRESENTATION_TRANSITION_DIRECTIONS)[number];

export interface PresentationTransition {
  kind: PresentationTransitionKind;
  /**
   * Duration in milliseconds. Fractional values are preserved exactly through
   * persistence, editing, and playback; nothing in the pipeline rounds
   * durations to whole seconds or substitutes an effect default.
   */
  durationMs: number;
  easing?: EasingDefinition;
  direction?: PresentationTransitionDirection;
}

/** Object build effects available to slide playback. */
export const PRESENTATION_BUILD_EFFECTS = [
  'appear',
  'fade',
  'flyIn',
  'flyOut',
  'wipe',
  'zoomIn',
  'zoomOut',
  'pulse',
] as const;

export type PresentationBuildEffect = (typeof PRESENTATION_BUILD_EFFECTS)[number];

export const PRESENTATION_BUILD_TRIGGERS = ['onClick', 'withPrevious', 'afterPrevious'] as const;

export type PresentationBuildTrigger = (typeof PRESENTATION_BUILD_TRIGGERS)[number];

export interface PresentationBuildStep {
  /** Stable id; rehearsal records and undo labels reference it, never an index. */
  id: string;
  /** Target object on the slide frame. */
  nodeId: string;
  effect: PresentationBuildEffect;
  trigger: PresentationBuildTrigger;
  /** Extra delay after the trigger condition is met, in fractional milliseconds. */
  delayMs?: number;
  /** Fractional milliseconds; 0 means the effect completes immediately. */
  durationMs?: number;
  direction?: PresentationTransitionDirection;
  easing?: EasingDefinition;
  /**
   * By-paragraph builds target logical paragraphs (0-based, inclusive) in
   * text order, never visual wrapped lines. Omitted means the whole object.
   */
  paragraphRange?: { from: number; to: number };
}

/** Sanity bounds only; values inside them keep their exact fractional value. */
export const PRESENTATION_TRANSITION_DURATION_LIMIT_MS = 60_000;
export const PRESENTATION_BUILD_DURATION_LIMIT_MS = 120_000;
export const PRESENTATION_BUILD_DELAY_LIMIT_MS = 120_000;
export const MAX_PRESENTATION_BUILDS_PER_SLIDE = 200;

export const PRESENTATION_DEFAULT_TRANSITION_MS = 500;

export interface PresentationSlideLayoutBinding {
  /** Stable identifier for the reusable layout source. */
  sourceId: string;
  /** Ordinary editable frame holding the layout source. */
  sourceFrameId: NodeId;
  /** Source revision last applied to this slide. */
  appliedRevision: number;
  /** Stable role keys mapped to slide-local content node ids. */
  roleNodes: Record<string, NodeId>;
  /** Managed values captured at application time for override detection. */
  managedBaseline?: Record<NodeId, Record<string, unknown>>;
}

/** Theme roles chosen for one slide. Survives detach so re-applying works. */
export interface PresentationSlideThemeBinding {
  themeId: string;
  /** Theme role → slide object id, as chosen by the author. */
  roleNodes: Record<string, NodeId>;
}

export interface PresentationSlideEntry {
  /** Stable id for this deck entry, independent of the referenced frame. */
  id: string;
  /** May remain unresolved after its artwork is removed, for recovery. */
  frameId: NodeId;
  title: string;
  notes?: string;
  skipped?: boolean;
  sectionId?: string;
  layoutBinding?: PresentationSlideLayoutBinding;
  themeBinding?: PresentationSlideThemeBinding;
  /** A per-slide theme reference overrides the deck theme when present. */
  themeId?: string;
  /** Accessibility metadata is independent of paint and layer order. */
  language?: string;
  altText?: string;
  readingOrder?: NodeId[];
  /** Transition played when delivery arrives at this slide from the previous included slide. */
  transition?: PresentationTransition;
  /** Ordered object builds on this slide. Empty arrays are not persisted. */
  builds?: PresentationBuildStep[];
}

export interface PresentationSection {
  id: string;
  title: string;
}

export interface PresentationDeck {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Array order is the only slide sequence; canvas and paint order are ignored. */
  slides: PresentationSlideEntry[];
  sections: PresentationSection[];
  themeId?: string;
  /** Transition used by any slide that does not override it. */
  defaultTransition?: PresentationTransition;
}

export interface PresentationLayoutSource {
  id: string;
  name: string;
  frameId: NodeId;
  revision: number;
  /** Stable role keys on the source frame; values are source node ids. */
  roleNodes: Record<string, NodeId>;
  /** Geometry captured at registration/refresh so edits can be surfaced as stale. */
  geometrySnapshot?: Record<string, Record<string, unknown>>;
}

export interface PresentationTheme {
  id: string;
  name: string;
  /** Role key to document variable id. */
  colorVariables: Record<string, string>;
  /** Role key to document text-style id. */
  textStyles: Record<string, string>;
}

/** Optional document-level deck metadata. Referenced artwork remains ordinary scene nodes. */
export interface PresentationMetadata {
  schemaVersion: typeof PRESENTATION_SCHEMA_VERSION;
  decks: PresentationDeck[];
  layouts: PresentationLayoutSource[];
  themes: PresentationTheme[];
}
