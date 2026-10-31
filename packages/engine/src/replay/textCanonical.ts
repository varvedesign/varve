import { openTypeFeaturesToCss, type TextWrapShape } from '@varve/shared';
import { isVerticalWritingMode } from '@varve/shared/verticalText';
import { setCanvasFont } from '../canvasFontAliases';
import { fontReferenceKey } from '../font/fontIdentity';
import type { ReplayTarget } from '../replayTypes';
import { shapeText } from '../shaping';
import { buildTextLayoutSnapshot, type TextLayoutSnapshot } from '../textLayoutSnapshot';
import type { Stroke } from '../types';
import { paintVerticalCanonicalText } from '../verticalTextReplay';
import type { TextPrimitive } from './types';
import {
  applyReplayTextSettings,
  effectiveWeight,
  paintTypographyRun,
  replayFontString,
} from './typography';
/**
 * Stroke a text primitive from the canonical layout so wrapped dialogue and
 * wrapped display type keep their outline on the same lines as their fill.
 *
 * The legacy text stroke split only on `\n`, so an area text node with a
 * stroke painted one long unwrapped line of outline behind wrapped glyphs —
 * invisible in short fixtures, obvious on any lettered balloon or caption.
 *
 * Returns false when the primitive cannot use the canonical snapshot (rich
 * text with advanced paragraph formatting, path text, vertical writing, or a
 * shaping environment without `measureText`), leaving the caller's fallback.
 */
export function paintCanonicalTextStroke(
  target: ReplayTarget,
  p: TextPrimitive,
  _stroke: Stroke,
): boolean {
  if (!target.strokeText) return false;
  if (isVerticalWritingMode(p.writingMode)) return false;
  const snapshot = canonicalTextSnapshot(target, p);
  if (!snapshot) return false;
  const verticalOffset =
    p.textAlignVertical === 'middle'
      ? (p.h - snapshot.height) / 2
      : p.textAlignVertical === 'bottom'
        ? p.h - snapshot.height
        : 0;
  target.textAlign = 'left';
  target.textBaseline = 'alphabetic';
  for (const line of snapshot.lines) {
    const xOffset =
      p.textAlign === 'center'
        ? (p.w - line.width) / 2
        : p.textAlign === 'right'
          ? p.w - line.width
          : 0;
    for (const run of line.runs) {
      const weight =
        p.variableAxes?.wght != null
          ? effectiveWeight(p)
          : Math.max(1, Math.min(1000, run.sourceRun.fontWeight));
      const runText = snapshot.text.slice(run.sourceStart, run.sourceEnd);
      if (runText.length === 0 || runText.includes('\n')) continue;
      const restoreSettings = applyReplayTextSettings(
        target,
        p.openTypeFeatures,
        p.variableAxes,
        run.direction,
      );
      setCanvasFont(
        target,
        replayFontString(
          run.sourceRun.fontFamily,
          run.sourceRun.fontSize,
          weight,
          run.sourceRun.fontStyle,
          p.openTypeFeatures,
          p.variableAxes,
          runText,
          p.fontReference ? fontReferenceKey(p.fontReference) : undefined,
        ),
      );
      target.strokeText(runText, p.x + xOffset + run.x, p.y + verticalOffset + line.baseline);
      restoreSettings();
    }
  }
  return true;
}

/**
 * Contour wrap shape for a balloon text primitive. Area mode only, so a
 * point-text node with a stale box cannot start folding lines, and vertical
 * columns stay rectangular until column profiles exist.
 */
export function textWrapShapeForPrimitive(p: TextPrimitive): TextWrapShape | undefined {
  if (p.textWrapShape !== 'ellipse') return undefined;
  if (p.textMode !== 'area') return undefined;
  if (isVerticalWritingMode(p.writingMode)) return undefined;
  return 'ellipse';
}

function canUseCanonicalTextLayout(p: TextPrimitive): boolean {
  return (
    !p.richText &&
    p.textMode !== 'path' &&
    p.textCase === 'none' &&
    p.listStyle === 'none' &&
    p.textOverflow === 'visible' &&
    p.paragraphSpacing === 0 &&
    p.firstLineIndent === undefined &&
    !p.text.includes('\t') &&
    !p.glyphAdjustments &&
    !p.pairAdjustments &&
    p.letterSpacing === 0 &&
    (p.tracking ?? 0) === 0 &&
    (!p.openTypeFeatures ||
      Object.keys(p.openTypeFeatures).length === 0 ||
      openTypeFeaturesToCss(p.openTypeFeatures) !== undefined) &&
    p.kerningMode !== 'none'
  );
}

export function canonicalTextSnapshot(
  target: ReplayTarget,
  p: TextPrimitive,
): TextLayoutSnapshot | null {
  if (!canUseCanonicalTextLayout(p)) return null;

  const maxWidth = p.textMode === 'area' ? (isVerticalWritingMode(p.writingMode) ? p.h : p.w) : 0;
  const shaping =
    p.shaping ??
    (() => {
      if (!target.measureText) return undefined;
      const direction = p.direction ?? 'auto';
      const language = p.language ?? '';
      // Do not cache browser measurement here: this layer has no font-face
      // revision token, and a late-loaded face must invalidate geometry.
      return shapeText(
        p.text,
        p.fontFamily,
        p.fontSize,
        target as unknown as CanvasRenderingContext2D,
        {
          // The canonical path shapes and then paints from `run.font`, so the
          // axis has to be folded in here too — patching only the fallback
          // painter left the common case unchanged.
          fontWeight: effectiveWeight(p),
          fontStyle: p.fontStyle,
          letterSpacing: p.letterSpacing,
          tracking: p.tracking,
          openTypeFeatures: p.openTypeFeatures,
          variableAxes: p.variableAxes,
          fontReference: p.fontReference,
          direction,
          language,
          writingMode: p.writingMode,
        },
      );
    })();

  if (!shaping) return null;
  return buildTextLayoutSnapshot(p.text, shaping, {
    maxWidth,
    wrapShape: textWrapShapeForPrimitive(p),
    lineHeight: p.fontSize * p.lineHeight,
    language: p.language,
    writingMode: p.writingMode,
    textOrientation: p.textOrientation,
  });
}

export function paintCanonicalText(
  target: ReplayTarget,
  p: TextPrimitive,
  snapshot: TextLayoutSnapshot,
): void {
  if (isVerticalWritingMode(p.writingMode)) {
    paintVerticalCanonicalText(target, p, snapshot);
    return;
  }
  const verticalOffset =
    p.textAlignVertical === 'middle'
      ? (p.h - snapshot.height) / 2
      : p.textAlignVertical === 'bottom'
        ? p.h - snapshot.height
        : 0;
  const originalFillStyle = target.fillStyle;
  target.textAlign = 'left';
  target.textBaseline = 'alphabetic';

  for (const line of snapshot.lines) {
    const xOffset =
      p.textAlign === 'center'
        ? (p.w - line.width) / 2
        : p.textAlign === 'right'
          ? p.w - line.width
          : 0;
    for (const run of line.runs) {
      // The shaped run carries the weight it was measured at. The axis has to
      // win here as well: shaping with the effective weight is not enough,
      // because this is where the font actually gets assigned before drawing.
      const weight =
        p.variableAxes?.wght != null
          ? effectiveWeight(p)
          : Math.max(1, Math.min(1000, run.sourceRun.fontWeight));
      // Canvas2D has no portable glyph-ID drawing API. Painting every shaped
      // glyph by slicing its source cluster is therefore incorrect: it
      // disables ligatures and contextual joining. Keep the logical source
      // run intact and let the browser's native shaper paint it as one unit.
      const runText = snapshot.text.slice(run.sourceStart, run.sourceEnd);
      if (runText.length > 0 && !runText.includes('\n')) {
        const restoreSettings = applyReplayTextSettings(
          target,
          p.openTypeFeatures,
          p.variableAxes,
          run.direction,
        );
        paintTypographyRun(target, {
          family: run.sourceRun.fontFamily,
          text: runText,
          x: p.x + xOffset + run.x,
          y: p.y + verticalOffset + line.baseline,
          fontSize: run.sourceRun.fontSize,
          fontWeight: weight,
          fontStyle: run.sourceRun.fontStyle,
          features: p.openTypeFeatures,
          axes: p.variableAxes,
          faceKey: p.fontReference ? fontReferenceKey(p.fontReference) : undefined,
        });
        restoreSettings();
      }
    }
    if (p.textDecoration === 'underline' || p.textDecoration === 'line-through') {
      const decoY =
        p.y +
        verticalOffset +
        line.baseline +
        (p.textDecoration === 'underline' ? p.fontSize * 0.3 : -p.fontSize * 0.3);
      target.beginPath();
      target.moveTo(p.x + xOffset, decoY);
      target.lineTo(p.x + xOffset + line.width, decoY);
      target.strokeStyle = target.fillStyle;
      target.lineWidth = 1;
      target.stroke();
    }
  }
  target.fillStyle = originalFillStyle;
}
