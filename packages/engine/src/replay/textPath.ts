import { setCanvasFont } from '../canvasFontAliases';
import { fontReferenceKey } from '../font/fontIdentity';
import { flattenShapedRuns, mergePotentialLigatureClusters, placeLinesOnPath } from '../pathText';
import type { ReplayTarget } from '../replayTypes';
import { shapeText } from '../shaping';
import type { RenderItem, Stroke } from '../types';
import { splitGraphemes } from '../unicode/grapheme';
import {
  applyReplayTextSettings,
  applyTextCase,
  effectiveWeight,
  measureTextAdvance,
  replayFontString,
} from './typography';
/**
 * Paint text along a path (text-on-path).
 *
 * Uses the same canonical shaper as point text (shapeText) so that kerning,
 * ligatures, combining marks, BiDi visual order and tracking are all honoured
 * by the path layout. For multiline text, each paragraph is shaped separately
 * and laid on a successive parallel offset curve (stacked outward on the
 * glyph side).
 */
export function paintPathText(
  target: ReplayTarget,
  p: Extract<RenderItem['primitive'], { kind: 'text' }>,
  stroke?: Stroke,
): void {
  const settings = p.pathTextSettings;
  if (!settings) return;

  const shape = p.pathShape;
  if (!shape) return;

  const displayText = applyTextCase(p.text, p.textCase);
  const fw = effectiveWeight(p);
  setCanvasFont(
    target,
    replayFontString(
      p.fontFamily,
      p.fontSize,
      fw,
      p.fontStyle,
      p.openTypeFeatures,
      p.variableAxes,
      displayText,
      p.fontReference ? fontReferenceKey(p.fontReference) : undefined,
    ),
  );
  target.textBaseline = 'alphabetic';
  target.textAlign = 'left';

  const paragraphs = displayText.split('\n');

  // Shape each paragraph through the canonical pipeline so shaping, kerning,
  // ligature and BiDi ordering match point text exactly. Each paragraph is
  // shaped independently so flattenShapedRuns slices by the correct local
  // clusterUtf16 indices.
  const lines: Array<Array<{ text: string; advance: number }>> = paragraphs.map((paragraph) => {
    if (paragraph.length === 0) return [];
    if (target.measureText) {
      const shaping = shapeText(
        paragraph,
        p.fontFamily,
        p.fontSize,
        target as unknown as CanvasRenderingContext2D,
        {
          fontWeight: fw,
          fontStyle: (p.fontStyle as 'normal' | 'italic' | undefined) ?? 'normal',
          letterSpacing: p.letterSpacing,
          tracking: p.tracking,
          direction: (p.direction as 'ltr' | 'rtl' | 'auto' | undefined) ?? 'auto',
          language: p.language,
          openTypeFeatures: p.openTypeFeatures,
          variableAxes: p.variableAxes,
        },
      );
      return mergePotentialLigatureClusters(
        flattenShapedRuns(shaping.runs, paragraph),
        p.openTypeFeatures,
      );
    }
    // No measureText (e.g. pure WASM stub): fall back to grapheme clusters
    // with an estimated advance so they at least stay attached to each other.
    return mergePotentialLigatureClusters(
      splitGraphemes(paragraph).map((ch) => ({
        text: ch,
        advance: p.fontSize * 0.6,
      })),
      p.openTypeFeatures,
    );
  });

  const lineHeightPx = p.fontSize * (p.lineHeight ?? 1.4);

  const placements = placeLinesOnPath(lines, shape, {
    offset: settings.startOffset ?? 0,
    endOffset: settings.endOffset,
    side: settings.side ?? 'top',
    baselineShift: settings.baselineShift,
    flip: settings.flip,
    lineHeightPx,
    fitToInterval: settings.fitToPath,
    reverse: settings.reverse,
  });

  const originalFillStyle = target.fillStyle;

  for (const glyph of placements) {
    target.save();
    target.transform(1, 0, 0, 1, glyph.x, glyph.y);
    const c = Math.cos(glyph.angle);
    const s = Math.sin(glyph.angle);
    target.transform(c, s, -s, c, 0, 0);
    const restoreSettings = applyReplayTextSettings(target, p.openTypeFeatures, p.variableAxes);
    if (stroke && target.strokeText) target.strokeText(glyph.char, 0, 0);
    else if (!stroke) target.fillText(glyph.char, 0, 0);
    restoreSettings();
    target.restore();
  }

  target.fillStyle = originalFillStyle;
}

/**
 * Per-cluster text drawing for kerning-off and glyph-level wordmark editing.
 *
 * Each grapheme cluster is drawn as its own fillText call, which disables
 * cross-cluster pair kerning (the browser only applies kerning within a
 * single text run) while keeping intra-cluster shaping for combining marks.
 * Per-cluster transforms (dx/dy/rotation/scale) and advance overrides are
 * applied from the IR glyphAdjustments; pairAdjustments add extra space
 * between cluster i and cluster i+1 (affecting the next cluster's position).
 * Only used when the display line maps 1:1 onto the source text (no case
 * transform, list prefix, tabs, wrapping, or RTL), so cluster indices stay
 * globally stable.
 */
/** Exported for tests: per-cluster drawing with injected measure stub. */
export function drawClusters(
  target: ReplayTarget,
  line: string,
  x: number,
  y: number,
  letterSpacing: number,
  trackingAdvance: number,
  p: Extract<RenderItem['primitive'], { kind: 'text' }>,
  measure: (text: string) => number = (text) => measureTextAdvance(target, text),
): void {
  const clusters = splitGraphemes(line);
  let cursorX = x;
  for (let ci = 0; ci < clusters.length; ci += 1) {
    const cluster = clusters[ci] as string;
    const adjustment = p.glyphAdjustments?.[ci];
    const advance = measure(cluster) + letterSpacing + trackingAdvance;
    if (
      adjustment &&
      (adjustment.dx !== 0 ||
        adjustment.dy !== 0 ||
        adjustment.rotation !== 0 ||
        adjustment.scaleX !== 1 ||
        adjustment.scaleY !== 1)
    ) {
      target.save();
      target.translate(cursorX + adjustment.dx, y + adjustment.dy);
      if (adjustment.rotation !== 0) target.rotate(adjustment.rotation);
      if (adjustment.scaleX !== 1 || adjustment.scaleY !== 1) {
        target.scale(adjustment.scaleX, adjustment.scaleY);
      }
      target.fillText(cluster, 0, 0);
      target.restore();
    } else {
      target.fillText(cluster, cursorX, y);
    }
    cursorX += advance + (adjustment?.advance ?? 0) + (p.pairAdjustments?.[ci] ?? 0);
  }
}
