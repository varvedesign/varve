/**
 * Canonical text layout snapshot.
 *
 * `layoutText()` is the authoritative derived layout for a logical source
 * string: paragraph itemization (UAX #9 + scripts), word-level line breaking
 * (never inside a grapheme), line-local visual run ordering (UAX #9 X8/L2),
 * positioned glyphs, cluster-safe caret stops, and selection geometry.
 *
 * The snapshot is derived and revisioned; it is never serialized as document
 * content. Source text remains logical Unicode order throughout.
 *
 * `buildTextLayoutSnapshot()` is retained as a single-paragraph compatibility
 * entry point for consumers that already hold a `TextShaping` result.
 */

import { ellipseLineWidthProfile, type TextWrapShape } from '@varve/shared';
import {
  isVerticalWritingMode,
  type TextOrientation,
  type VerticalGlyphOrientation,
  verticalOrientationForCluster,
  type WritingMode,
} from '@varve/shared/verticalText';
import { type BreakUnit, graphemeBreakUnits, segmentBreakUnits } from './text/lineBreak';
import {
  buildLineBreakSequence,
  codePointIndexAt,
  isDictionarySegmentedBoundary,
  isLineEdgeProhibitedBreak,
  isProhibitedBreak,
  type LineBreakSequence,
} from './text/lineBreakProhibition';
import type { ItemizedParagraph } from './text/paragraphs';
import { itemizeParagraph, splitParagraphs } from './text/paragraphs';
import { lineVisualRuns } from './text/visualOrder';
import type { ShapedGlyph, ShapedRun, TextShaping } from './types';
import {
  createUnicodeIndexMap,
  normalizeGraphemeRange,
  snapUtf16Offset,
  type UnicodeIndexMap,
} from './unicode/unicodeIndices';

export type CaretAffinity = 'leading' | 'trailing';

export interface TextLayoutIdentity {
  sourceRevision: string;
  fontRevision: string;
  maxWidth: number;
  /** Contour wrapping participates in cache identity; '' means rectangular. */
  lineWidthsKey: string;
  lineHeight: number | null;
  paragraphSpacing: number;
  direction: 'ltr' | 'rtl';
  language: string;
  featureKey: string;
  variationKey: string;
  writingMode: WritingMode;
  textOrientation: TextOrientation;
}

export interface PositionedGlyph extends ShapedGlyph {
  /** Exclusive source UTF-16 cluster end (document-local). */
  sourceEnd: number;
  /** Line-local origin in CSS pixels. */
  x: number;
  /** Baseline-relative y offset in CSS pixels. */
  y: number;
  /** Physical advance along the vertical inline axis. */
  verticalAdvance?: number;
  /** UAX #50/CSS orientation used by the vertical painter. */
  orientation?: 'upright' | 'sideways';
  /**
   * Present when this glyph is one merged tate-chu-yoko (horizontal-in-
   * vertical) cell: the painter draws the whole source span horizontally,
   * scaled by this measured factor to fit the one-em cell, instead of
   * applying the cluster orientation.
   */
  combinedScale?: number;
}

export interface TextLayoutRun {
  /** Document-local source start. */
  sourceStart: number;
  /** Document-local source end. */
  sourceEnd: number;
  /** Run origin x within the line. */
  x: number;
  width: number;
  direction: 'ltr' | 'rtl';
  level: number;
  /** Positioned glyphs in visual order. */
  glyphs: readonly PositionedGlyph[];
  sourceRun: ShapedRun;
}

export interface TextLayoutLine {
  /** Index of the containing paragraph. */
  paragraphIndex: number;
  /** Document-local logical start. */
  sourceStart: number;
  /** Document-local logical end (exclusive). */
  sourceEnd: number;
  top: number;
  baseline: number;
  height: number;
  width: number;
  /** Physical x offset for a vertical column. */
  x?: number;
  /** Runs in visual (left-to-right) order. */
  runs: readonly TextLayoutRun[];
  /** Document-local cluster starts in the line's visual traversal order. */
  visualClusters: readonly number[];
}

export interface CaretStop {
  /** Document-local logical offset. */
  offset: number;
  lineIndex: number;
  x: number;
  /** Inline-axis coordinate for vertical writing. */
  y?: number;
  affinity: CaretAffinity;
  direction: 'ltr' | 'rtl';
}

export interface SelectionRect {
  lineIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextLayoutParagraphInfo {
  index: number;
  sourceStart: number;
  sourceEnd: number;
  baseDirection: 'ltr' | 'rtl';
  baseLevel: number;
  /** First line index (exclusive end at `lineEnd`). */
  lineStart: number;
  lineEnd: number;
}

export interface TextLayoutSnapshot {
  text: string;
  sourceMap: UnicodeIndexMap;
  identity: TextLayoutIdentity;
  paragraphs: readonly TextLayoutParagraphInfo[];
  lines: readonly TextLayoutLine[];
  caretStops: readonly CaretStop[];
  width: number;
  height: number;
  baseDirection: 'ltr' | 'rtl';
  diagnostics: readonly string[];
}

export interface BuildTextLayoutSnapshotOptions {
  maxWidth: number;
  /**
   * Interior wrap shape. `'ellipse'` gives the line stack a balloon profile,
   * derived here from the number of lines the text forms (the same derivation
   * `@varve/shared` uses for scene geometry). Omit for rectangular wrapping.
   */
  wrapShape?: TextWrapShape | undefined;
  /** Explicit per-line width limits; overrides `wrapShape` when present. */
  lineWidths?: readonly number[] | undefined;
  sourceRevision?: string;
  fontRevision?: string;
  lineHeight?: number;
  paragraphSpacing?: number;
  language?: string;
  featureKey?: string;
  variationKey?: string;
  writingMode?: WritingMode;
  textOrientation?: TextOrientation;
}

/** One paragraph's logical-order shaped runs for `layoutText`. */
export interface LayoutParagraphInput {
  paragraph: ItemizedParagraph;
  /** Logical-order runs; glyph `clusterUtf16` is paragraph-local. */
  runs: readonly ShapedRun[];
}

export interface LayoutTextInput {
  text: string;
  paragraphs: readonly LayoutParagraphInput[];
  maxWidth: number;
  /** Interior wrap shape; see `BuildTextLayoutSnapshotOptions`. */
  wrapShape?: TextWrapShape | undefined;
  /** Explicit per-line width limits; overrides `wrapShape` when present. */
  lineWidths?: readonly number[] | undefined;
  sourceRevision?: string;
  fontRevision?: string;
  lineHeight?: number;
  paragraphSpacing?: number;
  language?: string;
  featureKey?: string;
  variationKey?: string;
  /** Paragraph direction override ('auto' = first-strong). */
  direction?: 'auto' | 'ltr' | 'rtl';
  writingMode?: WritingMode;
  textOrientation?: TextOrientation;
}

/** Logical-order glyph record with paragraph-local cluster bounds. */
interface GlyphRecord {
  run: ShapedRun;
  glyph: ShapedGlyph;
  clusterStart: number;
  clusterEnd: number;
}

interface LayoutUnit {
  unit: BreakUnit;
  records: readonly GlyphRecord[];
  width: number;
  /**
   * This unit is one grapheme of a word too long for the line, produced by the
   * emergency split in `buildLayoutUnits`. UAX #14 joins alphabetics (LB28), so
   * honoring prohibition inside such a run would prevent the word from ever
   * wrapping; the emergency split is exactly UAX #14's documented "no suitable
   * break opportunity" case, so prohibition yields there.
   */
  emergencySplit?: boolean;
}

interface RawLine {
  units: readonly LayoutUnit[];
  width: number;
}

/**
 * Lay out a full logical string through the canonical pipeline. Paragraphs
 * must come from `itemizeText` (or equivalent) and carry logical-order shaped
 * runs with paragraph-local cluster offsets.
 */
export function layoutText(input: LayoutTextInput): TextLayoutSnapshot {
  const sourceMap = createUnicodeIndexMap(input.text);
  const maxWidth = Math.max(0, input.maxWidth);
  const vertical = isVerticalWritingMode(input.writingMode ?? 'horizontal-tb');
  // Contour wrapping: derive the profile from the number of lines the text
  // forms in this width, then re-wrap until the count stabilizes. The derived
  // widths join the identity so a cache cannot serve a rectangular layout for
  // a contour request.
  let lineWidths = input.lineWidths;
  if (!lineWidths?.length && input.wrapShape === 'ellipse' && maxWidth > 0 && !vertical) {
    const count = countWrappedLines(input.paragraphs, maxWidth, undefined);
    lineWidths = ellipseLineWidthProfile({ width: maxWidth, lineCount: count });
    for (let pass = 0; pass < 3; pass++) {
      const next = countWrappedLines(input.paragraphs, maxWidth, lineWidths);
      if (next === lineWidths.length) break;
      lineWidths = ellipseLineWidthProfile({ width: maxWidth, lineCount: next });
    }
  }
  const lines: TextLayoutLine[] = [];
  const paragraphInfos: TextLayoutParagraphInfo[] = [];
  const caretStops: CaretStop[] = [];
  const baseDirection = paragraphBaseDirection(input.paragraphs, input.direction);
  const identity: TextLayoutIdentity = {
    sourceRevision: input.sourceRevision ?? 'unknown',
    fontRevision: input.fontRevision ?? 'unknown',
    maxWidth,
    lineWidthsKey: lineWidths?.length ? lineWidths.join(',') : '',
    lineHeight: input.lineHeight ?? null,
    paragraphSpacing: Math.max(0, input.paragraphSpacing ?? 0),
    direction: baseDirection,
    language: input.language ?? '',
    featureKey: input.featureKey ?? '',
    variationKey: input.variationKey ?? '',
    writingMode: input.writingMode ?? 'horizontal-tb',
    textOrientation: input.textOrientation ?? 'mixed',
  };
  const diagnostics: string[] = [];

  if (vertical) {
    return layoutVerticalText(input, sourceMap, identity, diagnostics, baseDirection);
  }

  for (const { paragraph, runs } of input.paragraphs) {
    const records = buildGlyphRecords(runs, paragraph.text.length);
    if (records.some((record) => record.glyph.glyphId === 0)) {
      diagnostics.push('shaping contains unknown glyph IDs; geometry may be approximate');
    }
    const paragraphLineStart = lines.length;
    // One paragraph-local source map feeds units, wrapping, and caret stops
    // (Intl.Segmenter segmentation is the pipeline's most expensive primitive).
    const paragraphMap = createUnicodeIndexMap(paragraph.text);
    const paragraphLines = layoutParagraphLines(
      paragraph,
      records,
      maxWidth,
      input.lineHeight ?? null,
      paragraphMap,
      lineWidths,
      paragraphLineStart,
    );
    const paragraphTop =
      lines.length > 0
        ? lines[lines.length - 1]!.top +
          lines[lines.length - 1]!.height +
          Math.max(0, input.paragraphSpacing ?? 0)
        : 0;
    const positionedParagraphLines = paragraphLines.map((line) => shiftLine(line, paragraphTop));
    for (const line of positionedParagraphLines) lines.push(line);
    paragraphInfos.push({
      index: paragraph.index,
      sourceStart: paragraph.sourceStart,
      sourceEnd: paragraph.sourceEnd,
      baseDirection: paragraph.baseDirection,
      baseLevel: paragraph.baseLevel,
      lineStart: paragraphLineStart,
      lineEnd: lines.length,
    });
    caretStops.push(
      ...buildCaretStops(paragraph, positionedParagraphLines, paragraphLineStart, paragraphMap),
    );
  }

  const width = lines.reduce((largest, line) => Math.max(largest, line.width), 0);
  const height =
    lines.length === 0 ? 0 : lines[lines.length - 1]!.top + lines[lines.length - 1]!.height;

  return {
    text: input.text,
    sourceMap,
    identity,
    paragraphs: paragraphInfos,
    lines,
    caretStops,
    width,
    height,
    baseDirection,
    diagnostics,
  };
}

function layoutVerticalText(
  input: LayoutTextInput,
  sourceMap: UnicodeIndexMap,
  identity: TextLayoutIdentity,
  diagnostics: string[],
  baseDirection: 'ltr' | 'rtl',
): TextLayoutSnapshot {
  const lines: TextLayoutLine[] = [];
  const paragraphInfos: TextLayoutParagraphInfo[] = [];
  const caretStops: CaretStop[] = [];
  const maxInline = Math.max(0, input.maxWidth);
  let blockOffset = 0;
  let layoutWidth = 0;
  let layoutHeight = 0;

  for (const { paragraph, runs } of input.paragraphs) {
    const records = buildGlyphRecords(runs, paragraph.text.length);
    if (records.some((record) => record.glyph.glyphId === 0)) {
      diagnostics.push('shaping contains unknown glyph IDs; geometry may be approximate');
    }
    const paragraphMap = createUnicodeIndexMap(paragraph.text);
    const paragraphLineStart = lines.length;
    const paragraphLines = layoutVerticalParagraphLines(
      paragraph,
      records,
      maxInline,
      input.lineHeight ?? null,
      paragraphMap,
      identity.textOrientation,
      identity.writingMode,
    );
    const paragraphWidth = paragraphLines.reduce(
      (width, line) => Math.max(width, (line.x ?? 0) + line.width),
      0,
    );
    if (paragraphLineStart > 0) blockOffset += identity.paragraphSpacing;
    const shifted = paragraphLines.map((line) => shiftVerticalLine(line, blockOffset, 0));
    lines.push(...shifted);
    layoutWidth = Math.max(layoutWidth, blockOffset + paragraphWidth);
    layoutHeight = Math.max(layoutHeight, ...shifted.map((line) => line.top + line.height));
    paragraphInfos.push({
      index: paragraph.index,
      sourceStart: paragraph.sourceStart,
      sourceEnd: paragraph.sourceEnd,
      baseDirection: paragraph.baseDirection,
      baseLevel: paragraph.baseLevel,
      lineStart: paragraphLineStart,
      lineEnd: lines.length,
    });
    caretStops.push(
      ...buildVerticalCaretStops(paragraph, shifted, paragraphLineStart, paragraphMap),
    );
    blockOffset += paragraphWidth;
  }

  return {
    text: input.text,
    sourceMap,
    identity,
    paragraphs: paragraphInfos,
    lines,
    caretStops: dedupeCaretStops(caretStops),
    width: layoutWidth,
    height: layoutHeight,
    baseDirection,
    diagnostics,
  };
}

function shiftLine(line: TextLayoutLine, yOffset: number): TextLayoutLine {
  if (yOffset === 0) return line;
  return {
    ...line,
    top: line.top + yOffset,
    baseline: line.baseline + yOffset,
    runs: line.runs.map((run) => ({
      ...run,
      glyphs: run.glyphs.map((glyph) => ({ ...glyph, y: glyph.y + yOffset })),
    })),
  };
}

function shiftVerticalLine(line: TextLayoutLine, xOffset: number, yOffset: number): TextLayoutLine {
  return {
    ...line,
    x: (line.x ?? 0) + xOffset,
    top: line.top + yOffset,
    baseline: line.baseline + yOffset,
    runs: line.runs.map((run) => ({
      ...run,
      x: run.x + xOffset,
      glyphs: run.glyphs.map((glyph) => ({
        ...glyph,
        x: glyph.x + xOffset,
        y: glyph.y + yOffset,
      })),
    })),
  };
}

function paragraphBaseDirection(
  paragraphs: readonly LayoutParagraphInput[],
  direction?: 'auto' | 'ltr' | 'rtl',
): 'ltr' | 'rtl' {
  if (direction === 'ltr' || direction === 'rtl') return direction;
  return paragraphs[0]?.paragraph.baseDirection ?? 'ltr';
}

/**
 * Build logical-order glyph records with paragraph-local cluster bounds.
 * A cluster end is the next distinct cluster start in the paragraph, or the
 * paragraph length for the final cluster.
 */
function buildGlyphRecords(runs: readonly ShapedRun[], textLength: number): GlyphRecord[] {
  const clusterStarts = [...new Set(runs.flatMap((run) => run.glyphs.map((g) => g.clusterUtf16)))]
    .filter((offset) => offset >= 0 && offset < textLength)
    .sort((a, b) => a - b);
  // O(1) cluster-end lookup instead of a per-glyph scan (10k-char paragraphs
  // must not degrade to quadratic time).
  const endByStart = new Map<number, number>();
  for (let i = 0; i < clusterStarts.length; i++) {
    endByStart.set(clusterStarts[i]!, clusterStarts[i + 1] ?? textLength);
  }
  const records: GlyphRecord[] = [];
  for (const run of runs) {
    for (const glyph of run.glyphs) {
      records.push({
        run,
        glyph,
        clusterStart: glyph.clusterUtf16,
        clusterEnd: endByStart.get(glyph.clusterUtf16) ?? textLength,
      });
    }
  }
  return records;
}

/** Group glyph records by cluster start (logical order per cluster). */
function recordsByCluster(records: readonly GlyphRecord[]): Map<number, GlyphRecord[]> {
  const byCluster = new Map<number, GlyphRecord[]>();
  for (const record of records) {
    const list = byCluster.get(record.clusterStart) ?? [];
    list.push(record);
    byCluster.set(record.clusterStart, list);
  }
  return byCluster;
}

/**
 * Segment the paragraph into width-annotated break units. Over-long words are
 * re-broken at grapheme boundaries so a single unbreakable word still wraps.
 */
function buildLayoutUnits(
  paragraph: ItemizedParagraph,
  records: readonly GlyphRecord[],
  maxWidth: number,
  sourceMap: UnicodeIndexMap,
): LayoutUnit[] {
  const byCluster = recordsByCluster(records);
  const attach = graphemeAttachList(sourceMap, byCluster);
  const units: LayoutUnit[] = [];
  let attachCursor = 0;
  for (const unit of segmentBreakUnits(paragraph.text)) {
    // Units and grapheme attachments are both sorted: advance the cursor
    // instead of rescanning the attach list per unit.
    while (attachCursor < attach.length && attach[attachCursor]!.start < unit.start) {
      attachCursor++;
    }
    units.push(makeLayoutUnit(unit, attach, attachCursor));
  }
  if (maxWidth > 0 && records.length > 0) {
    for (let i = 0; i < units.length; i++) {
      const unit = units[i]!;
      if (unit.width > maxWidth && unit.unit.isWord && unit.records.length > 1) {
        const pieces = graphemeBreakUnits(
          unit.unit.start,
          unit.unit.end,
          paragraph.text,
          sourceMap,
        );
        // The pieces stay breakable so an over-long word can still wrap, but a
        // pair the prohibition rules must not separate is kept together inside
        // the piece list: splitting `1234。` and then letting `。` start a line
        // would reintroduce the very violation this pass exists to prevent.
        const grouped = mergeEmergencyPieces(pieces, paragraph.text);
        let pieceCursor = attachCursorOf(attach, grouped[0]!.start);
        units.splice(
          i,
          1,
          ...grouped.map((piece) => {
            pieceCursor = nextAttachCursor(attach, pieceCursor, piece.start);
            return makeLayoutUnit(piece, attach, pieceCursor, true);
          }),
        );
        i += grouped.length - 1;
      }
    }
  }
  return mergeUnbreakableUnits(units, paragraph.text);
}

/**
 * Fold grapheme pieces of an over-long word where UAX #14 prohibits the break
 * between them.
 *
 * The pieces exist to let a word wrap, so they stay individually breakable —
 * but a prohibited pair inside the word is a real violation, not a wrap
 * trade-off: without this, `1234。` at a narrow measure is split into `1234`
 * and `。`, and the full stop begins a line.
 *
 * Only the line-EDGE rules regroup here. The word-internal rules have to
 * yield, because breaking inside this word is the emergency the split exists
 * for: regrouping them rebuilds the original unit and the word stops wrapping
 * (measured: `epsilon` then occupies one 70px line at a 60px measure). See
 * `isLineEdgeProhibitedBreak`.
 *
 * The South East Asian tailoring applies here exactly as it does in
 * `mergeUnbreakableUnits`: LB1 resolves `SA` to `AL` and LB28 then joins every
 * grapheme, so the segmentation boundary must survive regardless (measured:
 * Thai lines of 70px inside a 40px measure).
 */
function mergeEmergencyPieces(pieces: readonly BreakUnit[], text: string): BreakUnit[] {
  if (pieces.length < 2) return [...pieces];
  const sequence = buildLineBreakSequence(text);
  const grouped: BreakUnit[] = [];
  for (const piece of pieces) {
    const previous = grouped[grouped.length - 1];
    if (
      previous &&
      !isDictionarySegmentedBoundary(sequence, piece.start) &&
      isLineEdgeProhibitedAt(sequence, piece.start)
    ) {
      grouped[grouped.length - 1] = {
        start: previous.start,
        end: piece.end,
        text: text.slice(previous.start, piece.end),
        isWhitespace: false,
        isWord: true,
        isBreakable: false,
      };
      continue;
    }
    grouped.push(piece);
  }
  return grouped;
}

/**
 * Fold adjacent units that UAX #14 prohibits a line break between into single
 * units, so the greedy fill can never place a break at a reserved position.
 *
 * Doing this here rather than testing prohibition inside `wrapLines` keeps the
 * wrap loop unchanged and gives JLREQ's push-out (追い出し) behaviour for free:
 * `。` travels with the character before it, `（` with the character after it,
 * and no line ever overhangs its measure. It also covers the rules that exist
 * to keep a *unit* intact rather than to protect a line edge — numbers
 * (LB25), `person(s)` (LB30), Hangul syllable blocks (LB26/LB27), Brahmic
 * orthographic syllables (LB28a) and emoji modifier sequences (LB30b) — which
 * would otherwise be broken apart by the fill loop.
 *
 * Boundaries next to a whitespace unit are left alone. LB7 does prohibit a
 * break before a space, but the fill loop already refuses to break there, and
 * folding the space into the preceding word would start charging trailing
 * spaces against the line measure — the behaviour this pipeline deliberately
 * lets overflow and trims at paint time.
 *
 * Emergency grapheme splits are exempt: they exist precisely because a word
 * had no break opportunity inside it and the line would otherwise overflow, so
 * re-merging them would restore the overflow they were created to remove.
 */
function mergeUnbreakableUnits(units: readonly LayoutUnit[], text: string): LayoutUnit[] {
  if (units.length < 2) return [...units];
  // Built on first use: a paragraph whose unit boundaries all sit next to
  // whitespace (ordinary space-separated text) can never merge, so the common
  // case pays nothing for the class table.
  let sequence: LineBreakSequence | null = null;
  const merged: LayoutUnit[] = [];
  for (const unit of units) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      !previous.unit.isWhitespace &&
      !unit.unit.isWhitespace &&
      !(previous.emergencySplit && unit.emergencySplit)
    ) {
      sequence ??= buildLineBreakSequence(text);
      if (
        !isDictionarySegmentedBoundary(sequence, unit.unit.start) &&
        isBreakProhibitedAt(sequence, unit.unit.start)
      ) {
        merged[merged.length - 1] = {
          unit: {
            start: previous.unit.start,
            end: unit.unit.end,
            text: text.slice(previous.unit.start, unit.unit.end),
            isWhitespace: false,
            isWord: previous.unit.isWord || unit.unit.isWord,
            isBreakable: previous.unit.isBreakable,
          },
          records: [...previous.records, ...unit.records],
          width: previous.width + unit.width,
        };
        continue;
      }
    }
    merged.push(unit);
  }
  return merged;
}

/**
 * Whether UAX #14 prohibits a line break immediately before the unit starting
 * at `utf16Offset`. An offset that is not a code point boundary, or a
 * paragraph whose classes are empty, leaves the position breakable so the
 * engine never loses the ability to wrap.
 */
function isBreakProhibitedAt(sequence: LineBreakSequence, utf16Offset: number): boolean {
  if (sequence.classes.length === 0) return false;
  const codePointIndex = codePointIndexAt(sequence, utf16Offset);
  if (codePointIndex === null) return false;
  return isProhibitedBreak(sequence, codePointIndex);
}

/**
 * Whether the position puts a line-edge-protected character at the start or end
 * of a line. Used where a word-internal prohibition has to yield to the
 * emergency split; see `isLineEdgeProhibitedBreak`.
 */
function isLineEdgeProhibitedAt(sequence: LineBreakSequence, utf16Offset: number): boolean {
  if (sequence.classes.length === 0) return false;
  const codePointIndex = codePointIndexAt(sequence, utf16Offset);
  if (codePointIndex === null) return false;
  return isLineEdgeProhibitedBreak(sequence, codePointIndex);
}

function attachCursorOf(
  attach: Array<{ start: number; records: readonly GlyphRecord[] }>,
  start: number,
): number {
  let cursor = 0;
  while (cursor < attach.length && attach[cursor]!.start < start) cursor++;
  return cursor;
}

function nextAttachCursor(
  attach: Array<{ start: number; records: readonly GlyphRecord[] }>,
  cursor: number,
  start: number,
): number {
  while (cursor < attach.length && attach[cursor]!.start < start) cursor++;
  return cursor;
}

/** Records attached per grapheme start, in source order (shared across units). */
function graphemeAttachList(
  sourceMap: UnicodeIndexMap,
  byCluster: Map<number, GlyphRecord[]>,
): Array<{ start: number; records: readonly GlyphRecord[] }> {
  const list: Array<{ start: number; records: readonly GlyphRecord[] }> = [];
  const boundaries = sourceMap.graphemeBoundaries;
  for (let i = 0; i < boundaries.length - 1; i++) {
    const graphemeStart = boundaries[i]!;
    const graphemeEnd = boundaries[i + 1]!;
    const records: GlyphRecord[] = [];
    for (let cluster = graphemeStart; cluster < graphemeEnd; cluster++) {
      const attached = byCluster.get(cluster);
      if (attached) records.push(...attached);
    }
    list.push({ start: graphemeStart, records });
  }
  return list;
}

function makeLayoutUnit(
  unit: BreakUnit,
  attach: Array<{ start: number; records: readonly GlyphRecord[] }>,
  attachCursor: number,
  emergencySplit = false,
): LayoutUnit {
  const records: GlyphRecord[] = [];
  for (let i = attachCursor; i < attach.length; i++) {
    const entry = attach[i]!;
    if (entry.start >= unit.end) break;
    records.push(...entry.records);
  }
  const width = records.reduce((sum, record) => sum + Math.max(0, record.glyph.xAdvance), 0);
  return emergencySplit ? { unit, records, width, emergencySplit } : { unit, records, width };
}

/**
 * Greedy word-level wrapping. Whitespace never starts a new line and is never
 * dropped: it stays attached to the current line so every source offset
 * remains reachable by a caret (trailing spaces may overflow the line width
 * and are trimmed at paint time). A word that does not fit starts a new line.
 * The paragraph's logical order is preserved: visual reordering happens per
 * line afterwards.
 *
 * Positions the UAX #14 prohibition rules reserve are not break opportunities
 * at all: `buildLayoutUnits` has already merged those neighbours into one
 * unit, so a Japanese line can no longer begin with `。` `、` `」` or a small
 * kana, nor end with `「` or `（`. That realises JLREQ's line-start
 * prohibition (行頭禁則) and line-end prohibition (行末禁則) as push-out
 * (追い出し): the offending character migrates to the next line together with
 * the character it belongs to, so a prohibition never splits a pair the rules
 * keep together. Hanging punctuation (ぶら下げ) is deliberately not
 * implemented; see `docs/architecture/text-pipeline.md`.
 *
 * Prohibition takes precedence over the measure: a unit the rules make
 * indivisible can still be wider than the line (a merged `$7,890` in a 50px
 * box, or a single wide glyph), and such a unit is placed alone and overhangs.
 * That is inherent — no layout both fits and preserves the token — and is
 * pinned by a test rather than left implicit.
 *
 * `lineWidths` narrows specific lines (contour/balloon wrapping). The overall
 * `maxWidth` remains the hard cap; lines past the end of the profile reuse its
 * final entry, so a short profile can never produce an unbounded line.
 */
function wrapLines(
  paragraph: ItemizedParagraph,
  units: readonly LayoutUnit[],
  maxWidth: number,
  lineWidths?: readonly number[] | undefined,
  lineOffset = 0,
): RawLine[] {
  const lines: RawLine[] = [];
  let current: LayoutUnit[] = [];
  let currentWidth = 0;
  const flush = (): void => {
    if (current.length > 0) {
      lines.push({ units: current, width: currentWidth });
      current = [];
      currentWidth = 0;
    }
  };
  const limitForLine = (lineIndex: number): number => {
    if (!lineWidths || lineWidths.length === 0) return maxWidth;
    const entry = lineWidths[Math.min(lineIndex + lineOffset, lineWidths.length - 1)];
    if (!Number.isFinite(entry)) return maxWidth;
    return Math.max(0, Math.min(maxWidth, entry as number));
  };
  for (const unit of units) {
    const limit = limitForLine(lines.length);
    if (limit > 0 && unit.width > 0 && current.length > 0 && currentWidth + unit.width > limit) {
      if (!unit.unit.isWhitespace) {
        // A word does not fit: wrap before it.
        flush();
      }
    }
    current.push(unit);
    currentWidth += unit.width;
  }
  flush();
  if (lines.length === 0 && paragraph.text.length === 0) {
    return [{ units: [], width: 0 }];
  }
  return lines;
}

/** Line count from wrapping alone, used to shape the contour profile. */
function countWrappedLines(
  paragraphs: readonly LayoutParagraphInput[],
  maxWidth: number,
  lineWidths: readonly number[] | undefined,
): number {
  let total = 0;
  let offset = 0;
  for (const { paragraph, runs } of paragraphs) {
    const records = buildGlyphRecords(runs, paragraph.text.length);
    const sourceMap = createUnicodeIndexMap(paragraph.text);
    const units = buildLayoutUnits(paragraph, records, maxWidth, sourceMap);
    const wrapped = wrapLines(paragraph, units, maxWidth, lineWidths, offset);
    total += wrapped.length;
    offset += wrapped.length;
  }
  return total;
}

/** Lay out one paragraph into positioned lines (left-aligned line boxes). */
function layoutParagraphLines(
  paragraph: ItemizedParagraph,
  records: readonly GlyphRecord[],
  maxWidth: number,
  lineHeightOverride: number | null,
  sourceMap: UnicodeIndexMap,
  lineWidths?: readonly number[] | undefined,
  lineOffset = 0,
): TextLayoutLine[] {
  const units = buildLayoutUnits(paragraph, records, maxWidth, sourceMap);
  const rawLines = wrapLines(paragraph, units, maxWidth, lineWidths, lineOffset);
  const lines: TextLayoutLine[] = [];
  let top = 0;
  for (const raw of rawLines) {
    const runLineHeight = raw.units
      .flatMap((unit) => unit.records)
      .reduce((largest, record) => Math.max(largest, record.run.lineHeight ?? 0), 0);
    lines.push(positionLine(paragraph, raw, top, Math.max(lineHeightOverride ?? 0, runLineHeight)));
    top += lines[lines.length - 1]!.height;
  }
  return lines;
}

/** Position one raw line into a TextLayoutLine with visual run order. */
function positionLine(
  paragraph: ItemizedParagraph,
  raw: RawLine,
  top: number,
  lineHeightOverride: number | null,
): TextLayoutLine {
  const byCluster = recordsByCluster(raw.units.flatMap((unit) => unit.records));
  const clusters = [...byCluster.keys()].sort((a, b) => a - b);
  const logicalStart = clusters.length > 0 ? clusters[0]! : 0;
  const logicalEnd =
    clusters.length > 0 ? Math.max(...clusters.map((c) => byCluster.get(c)![0]!.clusterEnd)) : 0;
  const visualRuns = lineVisualRuns(paragraph, logicalStart, logicalEnd);

  const groups: Array<{ visualRun: (typeof visualRuns)[number]; records: GlyphRecord[] }> = [];
  for (const visualRun of visualRuns) {
    const runClusters = clusters
      .filter((cluster) => cluster >= visualRun.start && cluster < visualRun.end)
      .sort((a, b) => (visualRun.direction === 'rtl' ? b - a : a - b));
    const runRecords = runClusters.flatMap((cluster) => byCluster.get(cluster) ?? []);
    let current: GlyphRecord[] = [];
    let currentSourceRun: ShapedRun | undefined;
    for (const record of runRecords) {
      if (currentSourceRun !== undefined && record.run !== currentSourceRun) {
        groups.push({ visualRun, records: current });
        current = [];
      }
      currentSourceRun = record.run;
      current.push(record);
    }
    if (current.length > 0) groups.push({ visualRun, records: current });
  }

  const positioned: PositionedGlyph[] = [];
  const lineRuns: TextLayoutRun[] = [];
  let ascent = 0;
  let descent = 0;
  for (const group of groups) {
    const sourceRun = group.records[0]!.run;
    ascent = Math.max(ascent, sourceRun.ascent);
    descent = Math.max(descent, sourceRun.descent);
  }
  const baseline = top + ascent;
  let runLeft = 0;
  for (const group of groups) {
    const sourceRun = group.records[0]!.run;
    const runWidth = group.records.reduce(
      (sum, record) => sum + Math.max(0, record.glyph.xAdvance),
      0,
    );
    const glyphs = positionRunGlyphs(paragraph, group.records, runLeft, runWidth, baseline);
    const minX = Math.min(...glyphs.map((g) => g.x));
    lineRuns.push({
      sourceStart: Math.min(...glyphs.map((glyph) => glyph.clusterUtf16)),
      sourceEnd: Math.max(...glyphs.map((glyph) => glyph.sourceEnd)),
      x: minX,
      width: runWidth,
      direction: sourceRun.direction,
      level: sourceRun.level,
      glyphs,
      sourceRun,
    });
    positioned.push(...glyphs);
    runLeft += runWidth;
  }

  const width = raw.width;
  const height = Math.max(lineHeightOverride ?? 0, ascent + descent);
  const visualClusters = distinctClusterStarts(positioned);
  return {
    paragraphIndex: paragraph.index,
    sourceStart: paragraph.sourceStart + logicalStart,
    sourceEnd: paragraph.sourceStart + logicalEnd,
    top,
    baseline: top + ascent,
    height,
    width,
    runs: lineRuns,
    visualClusters,
  };
}

/**
 * Position one visual run's glyphs. Glyphs arrive in visual order (left-to-
 * right on screen) from the shaping backend, so the pen always advances
 * positively; run direction only affects caret/selection edge semantics.
 */
function positionRunGlyphs(
  paragraph: ItemizedParagraph,
  records: readonly GlyphRecord[],
  runLeft: number,
  _runWidth: number,
  baseline: number,
): PositionedGlyph[] {
  const positioned: PositionedGlyph[] = [];
  let cursor = runLeft;
  for (const record of records) {
    positioned.push({
      ...record.glyph,
      sourceEnd: paragraph.sourceStart + record.clusterEnd,
      x: cursor + record.glyph.xOffset,
      y: baseline + record.glyph.yOffset,
      clusterUtf16: paragraph.sourceStart + record.glyph.clusterUtf16,
    });
    cursor += Math.max(0, record.glyph.xAdvance);
  }
  return positioned;
}

interface VerticalClusterRecord {
  text: string;
  start: number;
  end: number;
  records: readonly GlyphRecord[];
  orientation: VerticalGlyphOrientation;
  advance: number;
  /** Set when consecutive combined clusters were merged into this one cell. */
  combined?: true;
}

/**
 * Tate-chu-yoko is authored for digit pairs; cap the merge so a misapplied
 * long run cannot collapse an entire sentence into one cell.
 */
const MAX_COMBINED_CLUSTERS = 4;

/** The single shared run when every record in the cell opts into combining, else null. */
function combinedCellRun(cluster: VerticalClusterRecord): ShapedRun | null {
  const first = cluster.records[0];
  if (!first?.run.textCombineUpright) return null;
  const run = first.run;
  return cluster.records.every((record) => record.run === run) ? run : null;
}

/** Coalesce consecutive tate-chu-yoko clusters into single one-em cells. */
function mergeCombinedClusters(
  clusters: readonly VerticalClusterRecord[],
): VerticalClusterRecord[] {
  const out: VerticalClusterRecord[] = [];
  let index = 0;
  while (index < clusters.length) {
    const run = combinedCellRun(clusters[index]!);
    if (!run) {
      out.push(clusters[index]!);
      index += 1;
      continue;
    }
    let end = index + 1;
    while (
      end < clusters.length &&
      end - index < MAX_COMBINED_CLUSTERS &&
      combinedCellRun(clusters[end]!) === run &&
      clusters[end]!.start === clusters[end - 1]!.end
    ) {
      end += 1;
    }
    if (end - index === 1) {
      out.push(clusters[index]!);
      index += 1;
      continue;
    }
    const merged = clusters.slice(index, end);
    out.push({
      text: merged.map((cluster) => cluster.text).join(''),
      start: merged[0]!.start,
      end: merged[merged.length - 1]!.end,
      records: merged.flatMap((cluster) => cluster.records),
      orientation: 'upright',
      // A combined cell is one em tall regardless of the sideways advances
      // its digit clusters would use unmerged.
      advance: merged.reduce(
        (max, cluster) =>
          Math.max(
            max,
            cluster.records.reduce((size, record) => Math.max(size, record.run.fontSize), 0),
          ),
        0,
      ),
      combined: true,
    });
    index = end;
  }
  return out;
}

/** Position logical grapheme clusters into vertical columns. */
function layoutVerticalParagraphLines(
  paragraph: ItemizedParagraph,
  records: readonly GlyphRecord[],
  maxInline: number,
  lineHeightOverride: number | null,
  sourceMap: UnicodeIndexMap,
  textOrientation: TextOrientation,
  writingMode: WritingMode,
): TextLayoutLine[] {
  const byCluster = recordsByCluster(records);
  const clusters: VerticalClusterRecord[] = [];
  let boundaryIndex = 0;
  while (boundaryIndex < sourceMap.graphemes.length) {
    const grapheme = sourceMap.graphemes[boundaryIndex]!;
    const attached = byCluster.get(grapheme.index) ?? [];
    let end = grapheme.index + grapheme.segment.length;
    for (const record of attached) end = Math.max(end, record.clusterEnd);
    while (
      boundaryIndex + 1 < sourceMap.graphemes.length &&
      sourceMap.graphemes[boundaryIndex + 1]!.index < end
    ) {
      boundaryIndex++;
      end = Math.max(
        end,
        sourceMap.graphemes[boundaryIndex]!.index +
          sourceMap.graphemes[boundaryIndex]!.segment.length,
      );
    }
    const clusterText = sourceMap.text.slice(grapheme.index, end);
    const clusterRecords = attached.length > 0 ? attached : [];
    const fontSize = clusterRecords.reduce(
      (size, record) => Math.max(size, record.run.fontSize),
      0,
    );
    const nativeAdvance = clusterRecords.reduce(
      (advance, record) => Math.max(advance, Math.abs(record.glyph.yAdvance)),
      0,
    );
    const orientation = verticalOrientationForCluster(clusterText, textOrientation);
    // Sideways clusters flow with their shaped horizontal advances (the CSS
    // `sideways` metric contract) so a rotated Latin run keeps its natural
    // rhythm; upright clusters keep the one-em cell.
    const advance =
      orientation === 'sideways'
        ? Math.max(
            clusterRecords.reduce((sum, record) => sum + Math.abs(record.glyph.xAdvance), 0),
            1,
          )
        : Math.max(nativeAdvance, fontSize || lineHeightOverride || 16);
    clusters.push({
      text: clusterText,
      start: grapheme.index,
      end,
      records: clusterRecords,
      orientation,
      advance,
    });
    boundaryIndex++;
  }

  const cells = mergeCombinedClusters(clusters);

  if (cells.length === 0) {
    const width = Math.max(lineHeightOverride ?? 16, 1);
    return [
      {
        paragraphIndex: paragraph.index,
        sourceStart: paragraph.sourceStart,
        sourceEnd: paragraph.sourceEnd,
        top: 0,
        baseline: width / 2,
        height: 0,
        width,
        x: 0,
        runs: [],
        visualClusters: [],
      },
    ];
  }

  const columnWidth = Math.max(
    lineHeightOverride ?? 0,
    ...cells.flatMap((cluster) =>
      cluster.records.map((record) => record.run.lineHeight ?? record.run.fontSize * 1.2),
    ),
    1,
  );
  const columns: VerticalClusterRecord[][] = [];
  let current: VerticalClusterRecord[] = [];
  let currentHeight = 0;
  const flush = (): void => {
    if (current.length > 0) columns.push(current);
    current = [];
    currentHeight = 0;
  };
  // Vertical writing obeys the same UAX #14 prohibition as horizontal. The
  // columns are filled cluster by cluster rather than unit by unit, so the
  // prohibition is applied by push-out (追い出し) here: when the break would
  // land between a cluster and a predecessor it must not be separated from,
  // that trailing group moves to the next column with the incoming cluster
  // instead of the incoming cluster leaving it stranded.
  const sequence = buildLineBreakSequence(paragraph.text);
  for (const cluster of cells) {
    if (maxInline > 0 && current.length > 0 && currentHeight + cluster.advance > maxInline) {
      let moved: VerticalClusterRecord[] = [];
      let movedHeight = 0;
      if (isBreakProhibitedAt(sequence, cluster.start)) {
        let cut = current.length - 1;
        while (cut > 0 && isBreakProhibitedAt(sequence, current[cut]!.start)) cut--;
        if (cut > 0) {
          moved = current.slice(cut);
          movedHeight = moved.reduce((sum, entry) => sum + entry.advance, 0);
          current = current.slice(0, cut);
          currentHeight -= movedHeight;
        }
      }
      // `cut === 0` leaves the whole column unbreakable: fall through to a
      // plain break rather than growing the column without limit. That is the
      // documented emergency mode, and it cannot loop because `moved` is empty.
      flush();
      if (moved.length > 0) {
        current = moved;
        currentHeight = movedHeight;
      }
    }
    current.push(cluster);
    currentHeight += cluster.advance;
  }
  flush();

  return columns.map((column, index) => {
    const top = 0;
    const height = column.reduce((sum, cluster) => sum + cluster.advance, 0);
    const x =
      writingMode === 'vertical-rl'
        ? (columns.length - index - 1) * columnWidth
        : index * columnWidth;
    const inlineOffsetByCluster = new Map<number, number>();
    let inlineOffset = 0;
    for (const cluster of column) {
      inlineOffsetByCluster.set(cluster.start, inlineOffset);
      inlineOffset += cluster.advance;
    }
    const first = column[0]!;
    const last = column[column.length - 1]!;
    // One glyph group per cell; a combined (tate-chu-yoko) cell emits a
    // single glyph spanning its merged source range.
    const groups: Array<{ sourceRun: ShapedRun; glyphs: PositionedGlyph[] }> = [];
    for (const cluster of column) {
      if (cluster.records.length === 0) continue;
      const cellInlineOffset = inlineOffsetByCluster.get(cluster.start) ?? 0;
      if (cluster.combined) {
        const measuredWidth = cluster.records.reduce(
          (sum, record) => sum + Math.abs(record.glyph.xAdvance),
          0,
        );
        const base = cluster.records[0]!;
        groups.push({
          sourceRun: base.run,
          glyphs: [
            {
              ...base.glyph,
              clusterUtf16: paragraph.sourceStart + cluster.start,
              sourceEnd: paragraph.sourceStart + cluster.end,
              x: x + columnWidth / 2 + base.glyph.xOffset,
              y: cellInlineOffset + cluster.advance / 2,
              verticalAdvance: cluster.advance,
              xAdvance: cluster.advance,
              orientation: 'upright',
              combinedScale: measuredWidth > 0 ? Math.min(1, cluster.advance / measuredWidth) : 1,
            },
          ],
        });
        continue;
      }
      const glyphs = cluster.records.map((record) => {
        const glyph: PositionedGlyph = {
          ...record.glyph,
          clusterUtf16: paragraph.sourceStart + record.clusterStart,
          sourceEnd: paragraph.sourceStart + record.clusterEnd,
          x: x + columnWidth / 2 + record.glyph.xOffset,
          y: (inlineOffsetByCluster.get(record.clusterStart) ?? 0) + cluster.advance / 2,
          verticalAdvance: cluster.advance,
          orientation: cluster.orientation,
        };
        return glyph;
      });
      const output = { sourceRun: cluster.records[0]!.run, glyphs };
      const previous = groups[groups.length - 1];
      if (previous?.sourceRun === output.sourceRun) previous.glyphs.push(...glyphs);
      else groups.push(output);
    }
    const lineRuns: TextLayoutRun[] = [];
    const positioned: PositionedGlyph[] = [];
    for (const group of groups) {
      const sourceStart = Math.min(...group.glyphs.map((glyph) => glyph.clusterUtf16));
      const sourceEnd = Math.max(...group.glyphs.map((glyph) => glyph.sourceEnd));
      lineRuns.push({
        sourceStart,
        sourceEnd,
        x,
        width: columnWidth,
        direction: group.sourceRun.direction,
        level: group.sourceRun.level,
        glyphs: group.glyphs,
        sourceRun: group.sourceRun,
      });
      positioned.push(...group.glyphs);
    }
    return {
      paragraphIndex: paragraph.index,
      sourceStart: paragraph.sourceStart + first.start,
      sourceEnd: paragraph.sourceStart + last.end,
      top,
      baseline: columnWidth / 2,
      height,
      width: columnWidth,
      x,
      runs: lineRuns,
      visualClusters: distinctClusterStarts(positioned),
    };
  });
}

function distinctClusterStarts(glyphs: readonly PositionedGlyph[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const glyph of glyphs) {
    if (!seen.has(glyph.clusterUtf16)) {
      seen.add(glyph.clusterUtf16);
      result.push(glyph.clusterUtf16);
    }
  }
  return result;
}

/**
 * Cluster-safe caret stops per line: leading/trailing stops per distinct
 * shaped cluster plus line-edge stops. Offsets are snapped to extended
 * grapheme boundaries so a shaper that reports per-character clusters can
 * never create an illegal insertion point inside a combining sequence.
 */
function buildCaretStops(
  paragraph: ItemizedParagraph,
  lines: readonly TextLayoutLine[],
  lineIndexOffset = 0,
  sourceMap: UnicodeIndexMap = createUnicodeIndexMap(paragraph.text),
): CaretStop[] {
  const snap = (paragraphLocal: number, bias: 'floor' | 'ceil'): number =>
    paragraph.sourceStart + snapUtf16Offset(sourceMap, paragraphLocal, bias);
  const stops: CaretStop[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
    const baseRtl = paragraph.baseLevel % 2 === 1;
    stops.push({
      offset: line.sourceStart,
      lineIndex: lineIndex + lineIndexOffset,
      x: baseRtl ? line.width : 0,
      affinity: 'leading',
      direction: paragraph.baseDirection,
    });
    stops.push({
      offset: line.sourceEnd,
      lineIndex: lineIndex + lineIndexOffset,
      x: baseRtl ? 0 : line.width,
      affinity: 'trailing',
      direction: paragraph.baseDirection,
    });
    for (const run of line.runs) {
      const isRtl = run.direction === 'rtl';
      let previousCluster = -1;
      for (const glyph of run.glyphs) {
        const clusterStart = snap(glyph.clusterUtf16 - paragraph.sourceStart, 'floor');
        if (clusterStart === previousCluster) continue;
        previousCluster = clusterStart;
        const clusterEnd = snap(glyph.sourceEnd - paragraph.sourceStart, 'ceil');
        const before = isRtl ? glyph.x + glyph.xAdvance : glyph.x;
        const after = isRtl ? glyph.x : glyph.x + glyph.xAdvance;
        stops.push({
          offset: clusterStart,
          lineIndex: lineIndex + lineIndexOffset,
          x: before,
          affinity: 'leading',
          direction: run.direction,
        });
        stops.push({
          offset: clusterEnd,
          lineIndex: lineIndex + lineIndexOffset,
          x: after,
          affinity: 'trailing',
          direction: run.direction,
        });
      }
    }
  }
  return dedupeCaretStops(stops);
}

function buildVerticalCaretStops(
  paragraph: ItemizedParagraph,
  lines: readonly TextLayoutLine[],
  lineIndexOffset: number,
  sourceMap: UnicodeIndexMap,
): CaretStop[] {
  const snap = (paragraphLocal: number, bias: 'floor' | 'ceil'): number =>
    paragraph.sourceStart + snapUtf16Offset(sourceMap, paragraphLocal, bias);
  const stops: CaretStop[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const lineIndex = index + lineIndexOffset;
    const x = line.x ?? 0;
    stops.push({
      offset: line.sourceStart,
      lineIndex,
      x,
      y: line.top,
      affinity: 'leading',
      direction: paragraph.baseDirection,
    });
    stops.push({
      offset: line.sourceEnd,
      lineIndex,
      x,
      y: line.top + line.height,
      affinity: 'trailing',
      direction: paragraph.baseDirection,
    });
    for (const run of line.runs) {
      let previousCluster = -1;
      for (const glyph of run.glyphs) {
        const clusterStart = snap(glyph.clusterUtf16 - paragraph.sourceStart, 'floor');
        if (clusterStart === previousCluster) continue;
        previousCluster = clusterStart;
        const clusterEnd = snap(glyph.sourceEnd - paragraph.sourceStart, 'ceil');
        const advance = glyph.verticalAdvance ?? Math.max(0, glyph.yAdvance);
        const before = glyph.y - advance / 2;
        const after = glyph.y + advance / 2;
        stops.push({
          offset: clusterStart,
          lineIndex,
          x,
          y: before,
          affinity: 'leading',
          direction: run.direction,
        });
        stops.push({
          offset: clusterEnd,
          lineIndex,
          x,
          y: after,
          affinity: 'trailing',
          direction: run.direction,
        });
      }
    }
  }
  return stops;
}

function dedupeCaretStops(stops: readonly CaretStop[]): CaretStop[] {
  const seen = new Set<string>();
  return stops.filter((stop) => {
    // Same line, offset, affinity, AND x: a line-edge stop and a cluster
    // boundary can share an offset with different x (RTL line ends); both
    // positions are legal caret locations and must be kept.
    const key = `${stop.lineIndex}:${stop.offset}:${stop.affinity}:${Math.round(stop.x * 100)}:${Math.round((stop.y ?? 0) * 100)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Single-paragraph compatibility entry point. `shaping.runs` must be in
 * logical order with document-local cluster offsets (single paragraph).
 */
export function buildTextLayoutSnapshot(
  text: string,
  shaping: TextShaping,
  options: BuildTextLayoutSnapshotOptions,
): TextLayoutSnapshot {
  const direction = shaping.baseDirection === 'rtl' ? 'rtl' : 'ltr';
  // Plain text arrives shaped as one continuous run set, but an explicit
  // U+000A still has to start a new line. Splitting here (rather than teaching
  // wrapLines about newlines, which only ever breaks on maxWidth) reuses the
  // multi-paragraph path that rich text already takes, so caret stops, BiDi
  // run ordering, and blank-line height all keep working.
  const paragraphs =
    text.length === 0
      ? [{ paragraph: emptyItemizedParagraph(shaping.baseDirection), runs: shaping.runs }]
      : splitParagraphs(text).map((range) => ({
          paragraph: itemizeParagraph(range, direction),
          runs: sliceRunsForParagraph(shaping.runs, range.start, range.end),
        }));
  return layoutText({
    text,
    paragraphs,
    maxWidth: options.maxWidth,
    wrapShape: options.wrapShape,
    lineWidths: options.lineWidths,
    sourceRevision: options.sourceRevision,
    fontRevision: options.fontRevision,
    lineHeight: options.lineHeight ?? shaping.height,
    paragraphSpacing: options.paragraphSpacing,
    language: options.language,
    featureKey: options.featureKey,
    variationKey: options.variationKey,
    writingMode: options.writingMode,
    textOrientation: options.textOrientation,
  });
}

/**
 * Narrow whole-string shaped runs to one paragraph, rebasing glyph clusters to
 * paragraph-local offsets (what `layoutText` expects).
 *
 * The newline itself sits at `end`, so it falls outside every slice and never
 * reaches a painter — the break is carried by the paragraph split instead of by
 * a glyph.
 */
function sliceRunsForParagraph(
  runs: readonly ShapedRun[],
  start: number,
  end: number,
): ShapedRun[] {
  const sliced: ShapedRun[] = [];
  for (const run of runs) {
    const glyphs: ShapedGlyph[] = [];
    let width = 0;
    for (const glyph of run.glyphs) {
      if (glyph.clusterUtf16 < start || glyph.clusterUtf16 >= end) continue;
      glyphs.push({ ...glyph, clusterUtf16: glyph.clusterUtf16 - start });
      width += glyph.xAdvance;
    }
    if (glyphs.length > 0) sliced.push({ ...run, glyphs, width });
  }
  return sliced;
}

function emptyItemizedParagraph(direction: 'ltr' | 'rtl'): ItemizedParagraph {
  return {
    index: 0,
    sourceStart: 0,
    sourceEnd: 0,
    text: '',
    baseDirection: direction,
    baseLevel: direction === 'rtl' ? 1 : 0,
    runs: [],
    levels: [],
    mirroredCharacters: new Map(),
    scriptedRuns: [],
  };
}

/** Map a snapshot's line/width coordinates onto the object layout (kept). */
export function hitTestTextLayout(snapshot: TextLayoutSnapshot, x: number, y: number): CaretStop {
  if (isVerticalWritingMode(snapshot.identity.writingMode)) {
    const lineIndex = snapshot.lines.reduce((best, line, index) => {
      const bestLine = snapshot.lines[best]!;
      const bestDistance = distanceToVerticalLine(bestLine, x);
      const distance = distanceToVerticalLine(line, x);
      return distance < bestDistance ? index : best;
    }, 0);
    const line = snapshot.lines[lineIndex];
    if (!line) {
      return {
        offset: 0,
        lineIndex: 0,
        x: 0,
        y: 0,
        affinity: 'leading',
        direction: snapshot.baseDirection,
      };
    }
    const candidates = snapshot.caretStops.filter((stop) => stop.lineIndex === lineIndex);
    return candidates.reduce(
      (best, candidate) =>
        Math.abs((candidate.y ?? line.top) - y) < Math.abs((best.y ?? line.top) - y)
          ? candidate
          : best,
      candidates[0] ?? {
        offset: line.sourceStart,
        lineIndex,
        x: line.x ?? 0,
        y: line.top,
        affinity: 'leading' as const,
        direction: snapshot.baseDirection,
      },
    );
  }
  const lineIndex = snapshot.lines.reduce((best, line, index) => {
    const bestLine = snapshot.lines[best]!;
    const bestDistance = distanceToLine(bestLine, y);
    const distance = distanceToLine(line, y);
    return distance < bestDistance ? index : best;
  }, 0);
  const line = snapshot.lines[lineIndex];
  if (!line) {
    return {
      offset: 0,
      lineIndex: 0,
      x: 0,
      affinity: 'leading',
      direction: snapshot.baseDirection,
    };
  }
  const candidates = snapshot.caretStops.filter((stop) => stop.lineIndex === lineIndex);
  return candidates.reduce(
    (best, candidate) => (Math.abs(candidate.x - x) < Math.abs(best.x - x) ? candidate : best),
    candidates[0] ?? {
      offset: line.sourceStart,
      lineIndex,
      x: snapshot.baseDirection === 'rtl' ? line.width : 0,
      affinity: 'leading' as const,
      direction: snapshot.baseDirection,
    },
  );
}

function distanceToLine(line: TextLayoutLine, y: number): number {
  if (y < line.top) return line.top - y;
  if (y > line.top + line.height) return y - (line.top + line.height);
  return 0;
}

function distanceToVerticalLine(line: TextLayoutLine, x: number): number {
  const left = line.x ?? 0;
  if (x < left) return left - x;
  if (x > left + line.width) return x - (left + line.width);
  return 0;
}

export function textLayoutSnapshotCacheKey(text: string, identity: TextLayoutIdentity): string {
  return JSON.stringify([
    text,
    identity.sourceRevision,
    identity.fontRevision,
    identity.maxWidth,
    identity.lineWidthsKey,
    identity.lineHeight,
    identity.direction,
    identity.writingMode,
    identity.textOrientation,
    identity.language,
    identity.featureKey,
    identity.variationKey,
  ]);
}

/**
 * Selection geometry for a logical range: one or more visually discontiguous
 * rectangles per line. Endpoints are snapped to grapheme boundaries; whole
 * lines selected produce a full-line rectangle.
 */
export function selectionRects(
  snapshot: TextLayoutSnapshot,
  start: number,
  end: number,
): SelectionRect[] {
  const range = normalizeGraphemeRange(snapshot.sourceMap, start, end);
  if (isVerticalWritingMode(snapshot.identity.writingMode)) {
    return verticalSelectionRects(snapshot, range.start, range.end);
  }
  const rects: SelectionRect[] = [];
  for (let lineIndex = 0; lineIndex < snapshot.lines.length; lineIndex++) {
    const line = snapshot.lines[lineIndex]!;
    if (range.start <= line.sourceStart && range.end >= line.sourceEnd) {
      rects.push({ lineIndex, x: 0, y: line.top, width: line.width, height: line.height });
      continue;
    }
    const selected = line.runs.flatMap((run) =>
      run.glyphs.filter((glyph) => glyph.clusterUtf16 < range.end && glyph.sourceEnd > range.start),
    );
    if (selected.length === 0) continue;
    const ordered = [...selected].sort((a, b) => a.x - b.x);
    let fragment: PositionedGlyph[] = [];
    const flush = (): void => {
      if (fragment.length === 0) return;
      const left = Math.min(...fragment.map((glyph) => glyph.x));
      const right = Math.max(...fragment.map((glyph) => glyph.x + glyph.xAdvance));
      rects.push({ lineIndex, x: left, y: line.top, width: right - left, height: line.height });
      fragment = [];
    };
    for (const glyph of ordered) {
      const previous = fragment[fragment.length - 1];
      if (previous && glyph.x > previous.x + previous.xAdvance + 0.01) flush();
      fragment.push(glyph);
    }
    flush();
  }
  return rects;
}

function verticalSelectionRects(
  snapshot: TextLayoutSnapshot,
  start: number,
  end: number,
): SelectionRect[] {
  const rects: SelectionRect[] = [];
  for (let lineIndex = 0; lineIndex < snapshot.lines.length; lineIndex++) {
    const line = snapshot.lines[lineIndex]!;
    if (start <= line.sourceStart && end >= line.sourceEnd) {
      rects.push({
        lineIndex,
        x: line.x ?? 0,
        y: line.top,
        width: line.width,
        height: line.height,
      });
      continue;
    }
    const selected = line.runs.flatMap((run) =>
      run.glyphs.filter((glyph) => glyph.clusterUtf16 < end && glyph.sourceEnd > start),
    );
    if (selected.length === 0) continue;
    const top = Math.min(
      ...selected.map((glyph) => glyph.y - (glyph.verticalAdvance ?? Math.abs(glyph.yAdvance)) / 2),
    );
    const bottom = Math.max(
      ...selected.map((glyph) => glyph.y + (glyph.verticalAdvance ?? Math.abs(glyph.yAdvance)) / 2),
    );
    rects.push({
      lineIndex,
      x: line.x ?? 0,
      y: top,
      width: line.width,
      height: bottom - top,
    });
  }
  return rects;
}

export class TextLayoutSnapshotCache {
  private readonly entries = new Map<string, TextLayoutSnapshot>();

  constructor(private readonly maxEntries = 128) {}

  get(key: string): TextLayoutSnapshot | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, snapshot: TextLayoutSnapshot): void {
    this.entries.delete(key);
    this.entries.set(key, snapshot);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
