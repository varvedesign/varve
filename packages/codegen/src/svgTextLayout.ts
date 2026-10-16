/**
 * Measured text layout for the SVG target.
 *
 * SVG has no automatic line wrapping that browsers ship (SVG2 wrapping was
 * never implemented; `foreignObject` is a portability liability), so the
 * portable profile is measured line/run placement: the same shaping and
 * line-breaking the canvas uses (`@varve/engine` shape* + layoutText), baked
 * into explicit `<text>`/`<tspan>` geometry.
 *
 * Source ranges are document-local UTF-16 offsets, so rich runs map back to
 * their scene `CharacterFormat` for per-run styling without re-flowing.
 */

import {
  buildTextLayoutSnapshot,
  itemizeParagraph,
  layoutText,
  type ShapedRun,
  shapeRun,
  shapeText,
  type TextLayoutSnapshot,
} from '@varve/engine';
import type { CharacterFormat, TextNode } from '@varve/scene';
import { escapeXml, rgba } from './shared';

export type SvgTextMeasurer = CanvasRenderingContext2D;

export interface SvgTextLineRun {
  /** Document-local UTF-16 source range. */
  sourceStart: number;
  sourceEnd: number;
  /** Run origin x within the line, in CSS px. */
  x: number;
  width: number;
  direction: 'ltr' | 'rtl';
}

export interface SvgTextLine {
  /** Baseline y in the text node's local space, in CSS px. */
  baseline: number;
  width: number;
  runs: SvgTextLineRun[];
}

export interface SvgMeasuredText {
  lines: SvgTextLine[];
  /** True when content exceeded the authored box (disclosed, not clipped silently). */
  overset: boolean;
}

/** A shared offscreen 2D context for font metrics; null outside the DOM. */
export function createSvgTextMeasurer(): SvgTextMeasurer | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

interface ResolvedFont {
  fontFamily: string;
  fontSize: number;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  letterSpacing?: number;
}

function fontFor(format: CharacterFormat | undefined, node: TextNode): ResolvedFont {
  return {
    fontFamily: format?.fontFamily ?? node.fontFamily ?? 'Inter',
    fontSize: format?.fontSize ?? node.fontSize ?? 16,
    fontWeight: format?.fontWeight ?? node.fontWeight,
    fontStyle: format?.fontStyle ?? node.fontStyle,
    letterSpacing: format?.letterSpacing ?? node.letterSpacing,
  };
}

/**
 * Shape one rich run with its own format and rebase glyph clusters to be
 * paragraph-local (what `layoutText` expects — the same contract
 * `sliceRunsForParagraph` produces for the plain path).
 */
function shapeRichRun(
  text: string,
  runStart: number,
  font: ResolvedFont,
  direction: 'ltr' | 'rtl',
  language: string | undefined,
  ctx: SvgTextMeasurer,
): ShapedRun[] {
  const shaped = shapeRun({
    text,
    fontFamily: font.fontFamily,
    fontSize: font.fontSize,
    fontWeight: font.fontWeight,
    fontStyle: font.fontStyle,
    letterSpacing: font.letterSpacing,
    direction,
    language,
    ctx,
  });
  // Clusters stay paragraph-local (runStart within the paragraph);
  // `layoutText` adds the paragraph's document-local sourceStart itself.
  return shaped.map((run) => ({
    ...run,
    glyphs: run.glyphs.map((glyph) => ({
      ...glyph,
      clusterUtf16: glyph.clusterUtf16 + runStart,
    })),
  }));
}

/**
 * Measured layout for a text node, or null when no metrics are available
 * (the caller keeps its declared fallback and reports the gap).
 */
export function layoutSvgText(node: TextNode, ctx: SvgTextMeasurer): SvgMeasuredText | null {
  const wrapWidth = node.textMode === 'area' && typeof node.w === 'number' ? node.w : undefined;
  const lineHeightPx = (node.lineHeight ?? 1.2) * (node.fontSize ?? 16);
  const paragraphSpacingPx = node.paragraphSpacing ?? 0;
  const direction =
    node.direction === 'rtl' ? 'rtl' : node.direction === 'ltr' ? 'ltr' : ('auto' as const);

  if (!node.richText || node.richText.paragraphs.length === 0) {
    // Plain text: one style, the canonical shaping entry point.
    if (!node.text) return { lines: [], overset: false };
    const shaping = shapeRunWrap(node, ctx, direction);
    if (!shaping) return null;
    const snapshot = buildTextLayoutSnapshot(node.text, shaping, {
      maxWidth: wrapWidth ?? Number.MAX_SAFE_INTEGER,
      lineHeight: lineHeightPx,
      language: node.language,
    });
    return fromSnapshot(snapshot, node.h);
  }

  // Rich text: per-run shaping with per-run formats, one layout over all
  // paragraphs so baselines and spacing accumulate exactly once.
  const paragraphs = [];
  const runsByParagraph: ShapedRun[][] = [];
  let docOffset = 0;
  for (const p of node.richText.paragraphs) {
    const visibleRuns = p.runs ?? [];
    const pText = visibleRuns.map((run) => run.text).join('');
    const pDirection =
      p.format?.direction === 'rtl' ? 'rtl' : p.format?.direction === 'ltr' ? 'ltr' : direction;
    const shaped: ShapedRun[] = [];
    let runOffset = 0;
    for (const run of visibleRuns) {
      const font = fontFor(run.format, node);
      shaped.push(
        ...shapeRichRun(
          run.text,
          runOffset,
          font,
          pDirection === 'auto' ? 'ltr' : pDirection,
          node.language,
          ctx,
        ),
      );
      runOffset += run.text.length;
    }
    paragraphs.push(
      itemizeParagraph(
        { index: paragraphs.length, start: docOffset, end: docOffset + pText.length, text: pText },
        pDirection === 'auto' ? 'auto' : pDirection,
      ),
    );
    runsByParagraph.push(shaped);
    docOffset += pText.length + 1; // one U+000A per paragraph boundary
  }

  const snapshot = layoutText({
    text: node.text,
    paragraphs: paragraphs.map((paragraph, i) => ({
      paragraph,
      runs: runsByParagraph[i] ?? [],
    })),
    maxWidth: wrapWidth ?? Number.MAX_SAFE_INTEGER,
    lineHeight: lineHeightPx,
    paragraphSpacing: paragraphSpacingPx,
    language: node.language,
  });
  return fromSnapshot(snapshot, node.h);
}

function shapeRunWrap(node: TextNode, ctx: SvgTextMeasurer, direction: 'ltr' | 'rtl' | 'auto') {
  return shapeText(node.text, node.fontFamily ?? 'Inter', node.fontSize ?? 16, ctx, {
    fontWeight: node.fontWeight,
    fontStyle: node.fontStyle,
    letterSpacing: node.letterSpacing,
    direction,
    language: node.language,
  });
}

function fromSnapshot(
  snapshot: TextLayoutSnapshot,
  boxHeight: number | undefined,
): SvgMeasuredText {
  const lines: SvgTextLine[] = snapshot.lines.map((line) => ({
    baseline: line.baseline,
    width: line.width,
    runs: line.runs.map((run) => ({
      sourceStart: run.sourceStart,
      sourceEnd: run.sourceEnd,
      x: run.x,
      width: run.width,
      direction: run.direction,
    })),
  }));
  // Overset is a derived status, not a clip: the last baseline past the
  // authored box discloses content that will not fit.
  const overset =
    boxHeight !== undefined &&
    lines.length > 0 &&
    (lines[lines.length - 1]?.baseline ?? 0) > boxHeight;
  return { lines, overset };
}

// ── SVG target emission ──────────────────────────────────────────────────────
// Moved out of svg.ts so the emitter keeps its complexity budget; the export
// entry sets the measurer and this module owns everything measured-text.

interface RunFormatRange {
  start: number;
  end: number;
  format?: CharacterFormat;
}

/**
 * Flatten rich paragraphs to the same string this module measured, and
 * record each run's document-local range so measured line runs map back to
 * their formats.
 */
function flattenRichForRanges(node: TextNode): { text: string; ranges: RunFormatRange[] } {
  let text = '';
  const ranges: RunFormatRange[] = [];
  for (const paragraph of node.richText?.paragraphs ?? []) {
    for (const run of paragraph.runs ?? []) {
      ranges.push({ start: text.length, end: text.length + run.text.length, format: run.format });
      text += run.text;
    }
    text += '\n';
  }
  return { text: text.replace(/\n$/, ''), ranges };
}

function formatAt(ranges: RunFormatRange[], offset: number): CharacterFormat | undefined {
  for (const range of ranges) {
    if (offset >= range.start && offset < range.end) return range.format;
  }
  return undefined;
}

function alignOffset(align: TextNode['textAlign'], lineWidth: number, boxWidth: number): number {
  if (align === 'center') return (boxWidth - lineWidth) / 2;
  if (align === 'right') return boxWidth - lineWidth;
  return 0;
}

/**
 * Measured emission: lines and runs placed from the engine's own shaping and
 * line breaking (the portable SVG profile — no foreignObject, no SVG2
 * auto-wrap). Returns null when measurement is unavailable or inapplicable
 * (case transforms and list prefixes change advance widths after shaping, so
 * those keep the declared heuristic in svg.ts).
 */
export function emitMeasuredTextContent(
  node: TextNode,
  indent: string,
  ctx: SvgTextMeasurer,
): string | null {
  if (node.textCase && node.textCase !== 'none') return null;
  if (node.listStyle) return null;
  if (node.textMode !== 'area' || typeof node.w !== 'number') return null;
  if (node.pathTextSettings) return null;

  const measured = layoutSvgText(node, ctx);
  if (!measured) return null;

  const childIndent = `${indent}  `;
  const boxWidth = node.w;
  const parts: string[] = [];

  if (!node.richText) {
    for (const line of measured.lines) {
      const offset = alignOffset(node.textAlign, line.width, boxWidth);
      // Plain text: emit each layout run so alignment and BiDi order are
      // exact; runs share the <text> element's font attributes.
      for (const run of line.runs) {
        const text = (node.text ?? '').slice(run.sourceStart, run.sourceEnd);
        parts.push(
          `${childIndent}<tspan x="${(run.x + offset).toFixed(2)}" y="${line.baseline.toFixed(2)}">${escapeXml(text)}</tspan>`,
        );
      }
    }
  } else {
    // Slice from the same flattened story that was measured — `node.text`
    // can be stale when richText overrides it.
    const { text: flatText, ranges } = flattenRichForRanges(node);
    for (const line of measured.lines) {
      const offset = alignOffset(node.textAlign, line.width, boxWidth);
      for (const run of line.runs) {
        if (run.sourceEnd <= run.sourceStart) continue;
        const format = formatAt(ranges, run.sourceStart);
        const text = flatText.slice(run.sourceStart, run.sourceEnd);
        const runAttrs: string[] = [
          `x="${(run.x + offset).toFixed(2)}"`,
          `y="${line.baseline.toFixed(2)}"`,
        ];
        if (format?.fontFamily) runAttrs.push(`font-family="${escapeXml(format.fontFamily)}"`);
        if (format?.fontSize) runAttrs.push(`font-size="${format.fontSize}"`);
        if (format?.fontWeight) runAttrs.push(`font-weight="${format.fontWeight}"`);
        if (format?.fontStyle === 'italic') runAttrs.push('font-style="italic"');
        if (format?.letterSpacing) runAttrs.push(`letter-spacing="${format.letterSpacing}"`);
        if (format?.textDecoration && format.textDecoration !== 'none') {
          runAttrs.push(`text-decoration="${format.textDecoration}"`);
        }
        if (format?.color) runAttrs.push(`fill="${rgba(format.color)}"`);
        if (run.direction === 'rtl') {
          runAttrs.push('direction="rtl"', 'unicode-bidi="bidi-override"');
        }
        parts.push(`${childIndent}<tspan ${runAttrs.join(' ')}>${escapeXml(text)}</tspan>`);
      }
    }
  }

  if (measured.overset) {
    parts.push(
      `${childIndent}<!-- varve: text overset - the measured lines exceed the authored box height -->`,
    );
  }
  return parts.length > 0 ? parts.join('\n') : '';
}
