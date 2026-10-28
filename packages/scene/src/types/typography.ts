import type { FontReference } from '@varve/engine';
import type { OpenTypeFeatureMap as SharedOpenTypeFeatureMap } from '@varve/shared';
import type { ManagedColor } from '../colorManagement';
import type { NodeId } from './ids';

// ── Typography types (shared with typography.ts via re-export) ───────────────

export type OpenTypeFeatureTag =
  | 'liga'
  | 'dlig'
  | 'sups'
  | 'subs'
  | 'numr'
  | 'dnom'
  | 'frac'
  | 'afrc'
  | 'zero'
  | 'tnum'
  | 'pnum'
  | 'onum'
  | 'lnum'
  | 'smcp'
  | 'c2sc'
  | 'pcap'
  | 'c2pc'
  | 'unic'
  | 'titl'
  | 'nalt'
  | 'expt'
  | 'fina'
  | 'medi'
  | 'init'
  | 'isol'
  | 'rlig'
  | 'clig'
  | 'calt'
  | 'hlig'
  | 'liga'
  | 'dlig'
  | 'curs'
  | 'mark'
  | 'mkmk'
  | 'locl'
  | 'rclt'
  | 'rvrn'
  | 'kern'
  | 'cpsp'
  | 'case'
  | 'salt'
  | 'ss01'
  | 'ss02'
  | 'ss03'
  | 'ss04'
  | 'ss05'
  | 'ss06'
  | 'ss07'
  | 'ss08'
  | 'ss09'
  | 'ss10'
  | 'ss11'
  | 'ss12'
  | 'ss13'
  | 'ss14'
  | 'ss15'
  | 'ss16'
  | 'ss17'
  | 'ss18'
  | 'ss19'
  | 'ss20'
  | 'cv01'
  | 'cv02'
  | 'cv03'
  | 'cv04'
  | 'cv05'
  | 'cv06'
  | 'cv07'
  | 'cv08'
  | 'cv09'
  | 'cv10'
  | 'cv11'
  | 'cv12'
  | 'cv13'
  | 'cv14'
  | 'cv15'
  | 'aalt'
  | 'abvm'
  | 'blwm'
  | 'ccmp'
  | 'dist';

/** Shared feature values support explicit off/on, indexed values, and source ranges. */
export type OpenTypeFeatureMap = SharedOpenTypeFeatureMap;

export type RegisteredAxisTag = 'wght' | 'wdth' | 'slnt' | 'opsz' | 'ital';

export interface VariableFontAxis {
  tag: string;
  name: string;
  min: number;
  default: number;
  max: number;
  precision?: number;
  isRegistered: boolean;
}

export interface VariableFontInstance {
  name: string;
  coordinates: Record<string, number>;
}

export type VariableFontSettings = Record<string, number>;

export interface CharacterFormat {
  fontFamily?: string;
  /** Exact artifact/member identity; absent on legacy family-only documents. */
  fontReference?: FontReference;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  fontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  textCase?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  textDecoration?: 'none' | 'underline' | 'line-through';
  /**
   * Run text color. ManagedColor since schema 2.13; older documents stored
   * `[r, g, b, a]` sRGB tuples (migrated at load).
   */
  color?: ManagedColor;
  openTypeFeatures?: OpenTypeFeatureMap;
  variableFontSettings?: VariableFontSettings;
  fontVariant?: 'normal' | 'small-caps' | 'all-small-caps';
  baselineShift?: number;
  superscript?: boolean;
  subscript?: boolean;
  kerning?: 'auto' | 'manual' | 'none';
  tracking?: number;
  language?: string;
  /** Keep this grapheme cluster in a compact horizontal-in-vertical span. */
  textCombineUpright?: boolean;
}

export type WritingMode = 'horizontal-tb' | 'vertical-rl' | 'vertical-lr';

export type TextOrientation = 'mixed' | 'upright' | 'sideways';

export type TabStopAlignment = 'left' | 'center' | 'right' | 'decimal';

export interface TabStop {
  position: number;
  alignment: TabStopAlignment;
  alignmentChar?: string;
  leader?: string;
}

export interface ParagraphFormat {
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textAlignVertical?: 'top' | 'middle' | 'bottom';
  lineHeight?: number;
  paragraphSpacing?: number;
  paragraphIndent?: number;
  firstLineIndent?: number;
  listStyle?: 'none' | 'disc' | 'decimal' | 'circle' | 'square';
  listIndent?: number;
  hangingIndent?: boolean;
  hangingQuotes?: boolean;
  hangingLists?: boolean;
  maxLines?: number;
  textOverflow?: 'clip' | 'ellipsis' | 'visible';
  hyphenation?: boolean;
  keepWithNext?: boolean;
  keepTogether?: boolean;
  widowControl?: boolean;
  orphanControl?: boolean;
  dropCapLines?: number;
  dropCapChars?: number;
  direction?: 'ltr' | 'rtl';
  writingMode?: WritingMode;
  /** Orientation of grapheme clusters when the paragraph is vertical. */
  textOrientation?: TextOrientation;
  columnCount?: number;
  columnGap?: number;
  columnRuleWidth?: number;
  /** Column-rule color. ManagedColor since schema 2.13 (was an sRGB tuple). */
  columnRuleColor?: ManagedColor;
  tabStops?: TabStop[];
  tabSize?: number;
}

export interface TextRun {
  text: string;
  format?: CharacterFormat;
  characterStyleId?: NodeId;
}

export interface Paragraph {
  runs: TextRun[];
  format?: ParagraphFormat;
  paragraphStyleId?: NodeId;
}

export interface RichText {
  paragraphs: Paragraph[];
  /** Optional source-ranged ruby/furigana annotations for comic lettering. */
  ruby?: RubyAnnotation[];
}

/** Ruby annotation anchored to UTF-16 offsets in the flattened story text. */
export interface RubyAnnotation {
  start: number;
  end: number;
  text: string;
  language?: string;
  position?: 'over' | 'under' | 'inter-character';
  /** Set when the base range changed and needs author review. */
  stale?: boolean;
}

// ── Text Stories (v2.18, ADR-0159) ─────────────────────────────────────────

/**
 * Authoritative story model: one story owns the text content; linked text
 * frames reference it through a thread binding and display derived ranges
 * from composition (M10). The story is the single source of truth — frame
 * text is never duplicated across linked frames.
 */
export interface TextStory {
  id: NodeId;
  name: string;
  /** Authoritative rich-text content. */
  content: RichText;
  /** Ordered frame ids in the thread (paint/composition order). */
  thread: NodeId[];
  /** Language tag for shaping/hyphenation (e.g. "en", "ar"). */
  language?: string;
  /** Optional speaker and production metadata used by comic transcripts. */
  speaker?: string;
  dialogueKind?: 'speech' | 'thought' | 'caption' | 'sfx' | 'narration';
}

/**
 * A frame's membership in a story thread. Frames without a binding keep
 * their own `richText` (single-frame default, pre-story documents).
 */
export interface TextFrameBinding {
  storyId: NodeId;
  /** Index into the story's thread array. */
  threadIndex: number;
}

/**
 * Per-cluster glyph adjustment for wordmark-level typography.
 *
 * Keyed by grapheme-cluster index (UAX #29, via Intl.Segmenter) in the
 * node's text — NOT by shaped-glyph id or UTF-16 code unit — so adjustments
 * survive font/size/kerning/ligature changes deterministically. Text
 * content edits invalidate the map (policy enforced by the editor).
 */
export interface GlyphAdjustment {
  /** Horizontal offset in px (local space). */
  dx: number;
  /** Vertical offset in px (local space). */
  dy: number;
  /** Advance override in px (adds to the measured cluster advance). */
  advance: number;
  /** Rotation in radians around the cluster origin. */
  rotation: number;
  /** Horizontal scale factor. */
  scaleX: number;
  /** Vertical scale factor. */
  scaleY: number;
}

/** Kerning modes that are actually implemented by the render pipeline. */
export type KerningMode = 'auto' | 'none';

export type TextMode = 'point' | 'area' | 'path' | 'auto';

export interface PathTextSettings {
  pathNodeId: NodeId;
  startOffset?: number;
  endOffset?: number;
  side?: 'top' | 'bottom';
  flip?: boolean;
  baselineShift?: number;
  /**
   * Stretch or squeeze inter-cluster tracking so each line spans the
   * usable interval exactly. Glyph shapes are never distorted; spacing
   * absorbs the difference. Off by default — path layout always clips.
   */
  fitToPath?: boolean;
  /**
   * Reverse the visual reading direction: glyphs are placed from the end
   * of the usable interval toward the start and each glyph's tangent
   * angle is flipped by π. Combined with `side`, this lets bottom-of-circle
   * text read left-to-right in the normal orientation, which is the
   * standard for badges and seals.
   */
  reverse?: boolean;
}
