import type { Affine, FontReference } from '@varve/engine';
import type { TextWrapShape } from '@varve/shared';
import type { Effect, Stroke } from '../appearance';
import type { NodeId } from '../ids';
import type {
  GlyphAdjustment,
  KerningMode,
  OpenTypeFeatureMap,
  PathTextSettings,
  RichText,
  TextFrameBinding,
  TextMode,
  TextOrientation,
  WritingMode,
} from '../typography';
import type { AdaptiveContrastState } from './adjustment';
import type { NodeBase } from './base';

export interface TextNode extends NodeBase {
  kind: 'text';
  text: string;
  transform: Affine;
  /** Local text-container width. Present for area/fixed text, omitted for point text. */
  w?: number;
  /** Local text-container height. Present for area/fixed text, omitted for point text. */
  h?: number;
  /** Font size in px at 1x; variable-bindable across breakpoints (task 1.3). */
  fontSize: number;
  /** F6: font family — CSS-safe name or exact font. */
  fontFamily?: string;
  /** Exact artifact/member identity; absent on legacy family-only documents. */
  fontReference?: FontReference;
  /** F6: font weight as CSS numeric or keyword. */
  fontWeight?: number;
  /** F6: font style (normal/italic). */
  fontStyle?: 'normal' | 'italic';
  /** F6: line-height multiplier. */
  lineHeight?: number;
  /** F6: letter-spacing in px. */
  letterSpacing?: number;
  /** Typographic tracking in 1/1000 em units, added between glyphs. */
  tracking?: number;
  /** F6: paragraph spacing in px. */
  paragraphSpacing?: number;
  /** F6: text alignment. */
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  /** F6: vertical text alignment. */
  textAlignVertical?: 'top' | 'middle' | 'bottom';
  /** F6: text transform. */
  textCase?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  /** F6: text decoration. */
  textDecoration?: 'none' | 'underline' | 'line-through';
  /** F6: list style for multi-line text. */
  listStyle?: 'none' | 'disc' | 'decimal' | 'circle' | 'square';
  /** F6: text truncation/overflow behaviour. */
  textOverflow?: 'clip' | 'ellipsis' | 'visible';
  /** F6: resizing mode — auto-width/auto-height/fixed. */
  textResizing?: 'autoWidth' | 'autoHeight' | 'fixed';
  /** OpenType feature values/ranges; absent entries inherit the resolved style. */
  openTypeFeatures?: OpenTypeFeatureMap;
  /**
   * Kerning mode. 'auto' uses font pair kerning (browser/rustybuzz default).
   * 'none' disables pair kerning between clusters while tracking, manual
   * pair adjustments, and ligature behavior remain independent.
   */
  kerningMode?: KerningMode;
  /**
   * Per-cluster glyph adjustments keyed by grapheme-cluster index. When
   * present, the renderer draws cluster-by-cluster so offsets, rotations,
   * and scales apply without corrupting ordinary text behavior. The map is
   * explicitly invalidated when source text changes; it is never treated as
   * a glyph-array or glyph-ID cache.
   */
  glyphAdjustments?: Record<number, GlyphAdjustment>;
  /**
   * Manual pair spacing: px of extra space between cluster i and cluster
   * i+1, keyed by the index of the preceding cluster. Applies in both
   * kerning modes.
   */
  pairAdjustments?: Record<number, number>;
  /** Variable font axis values (e.g. { wght: 500, wdth: 75 }). */
  variableAxes?: Record<string, number>;
  /** Rich text content (paragraphs with runs). When set, overrides `text`. */
  richText?: RichText;
  /** Story thread membership (v2.18, ADR-0159); absent for single-frame text. */
  storyBinding?: TextFrameBinding;
  /** Text mode: point, area, path, or auto. */
  textMode?: TextMode;
  /** Path text settings (when textMode === 'path'). */
  pathTextSettings?: PathTextSettings;
  /** Text direction: 'ltr', 'rtl', or 'auto' (auto-detect from content). */
  direction?: 'ltr' | 'rtl' | 'auto';
  /** Logical writing mode; omitted means the legacy horizontal default. */
  writingMode?: WritingMode;
  /** Cluster orientation in vertical writing; omitted means mixed. */
  textOrientation?: TextOrientation;
  /**
   * Interior wrap shape for soft wrapping. `'ellipse'` narrows the first and
   * last lines so the text mass follows a round balloon (comic dialogue).
   * Authored intent only: the per-line widths are derived by
   * `resolveTextWrapLineWidths` in `@varve/shared`, never serialized.
   */
  textWrapShape?: TextWrapShape;
  /** ISO language tag for language-specific shaping (e.g. 'ar', 'hi', 'th'). */
  language?: string;
  /** F6: stacked strokes on text. */
  strokes: Stroke[];
  /** F6: stacked effects on text. */
  effects: Effect[];
  /** Phase 5: Reference to a path/vector node whose shape the text follows. */
  pathId?: NodeId;
  /** Phase 5: 0-1 offset along the path to start text (default 0). */
  pathOffset?: number;
  /** Phase 5: Which side of the path text appears on. */
  pathSide?: 'top' | 'bottom';
  /**
   * Adaptive contrast settings for automatic text colour adjustment.
   * When enabled, the rendered text colour is adjusted to meet WCAG contrast
   * targets against the composited backdrop, while the stored fill remains
   * the author's original choice.
   */
  adaptiveContrast?: AdaptiveContrastState;
}

export type CalloutFitPolicy = 'fit-balloon' | 'reflow' | 'overflow';

/** How one logical balloon tail is drawn. */
export type CalloutTailStyle = 'pointed' | 'thought';

/**
 * One logical tail. A pointed tail is one editable path; a thought tail is a
 * chain of decreasing circles. `nodeIds` lists the nodes that draw it, so
 * membership stays explicit and ordinary scene operations (delete, layer
 * visibility, export) keep working on the pieces.
 */
export interface CalloutTail {
  nodeIds: NodeId[];
  style: CalloutTailStyle;
  /** Signed bend as a fraction of the tail length (-1..1); pointed tails only. */
  curve?: number;
  /** Base width in px; pointed tails only. */
  baseWidth?: number;
  /** Circle count for a thought chain. */
  bubbleCount?: number;
}

export interface CalloutRecipe {
  version: 1;
  kind: 'speech' | 'thought' | 'caption' | 'whisper' | 'shout' | 'burst' | 'cloud';
  bodyNodeId: NodeId;
  textNodeId: NodeId;
  /**
   * Decorative outline node for shaped balloons (burst, cloud). The body stays
   * the text container and geometry authority; the outline is an ordinary star
   * shape painted behind the tails and body so it can be stroked and resized
   * with the balloon. Absent for rect-bodied kinds.
   */
  outlineNodeId?: NodeId;
  tailNodeIds: NodeId[];
  padding: number;
  fitToText?: boolean;
  /** Explicit overflow policy; never silently shrinks the authored type. */
  fitPolicy?: CalloutFitPolicy;
  /** False after the author directly edits the generated body path. */
  parametric: boolean;
  /**
   * Explicit interior wrap-shape override. Absent means "follow the kind's
   * default", so switching a balloon to a caption reaches the rectangle and
   * switching back to a shout reaches the contour. Set only by an explicit
   * author choice.
   */
  wrapShape?: TextWrapShape;
  /**
   * Logical tail grouping. Optional and additive: recipes written before it
   * exist are read as one pointed tail per `tailNodeIds` entry.
   */
  tails?: CalloutTail[];
}
