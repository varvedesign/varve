import { isVerticalWritingMode } from '@varve/shared/verticalText';
import { setCanvasFont } from '../canvasFontAliases';
import { fontReferenceKey } from '../font/fontIdentity';
import type { ReplayTarget } from '../replayTypes';
import { layoutRichTextSnapshot } from '../richTextLayout';
import { layoutRichText } from '../textLayout';
import type { TextLayoutSnapshot } from '../textLayoutSnapshot';
import type { RenderItem } from '../types';
import { paintVerticalCanonicalRichText } from '../verticalTextReplay';
import { rgba } from './color';
import { textWrapShapeForPrimitive } from './textCanonical';
import {
  applyReplayTextSettings,
  detectRTL,
  measureTextAdvance,
  paintTypographyRun,
  replayFontString,
} from './typography';
/** Paint rich text using the typography layout engine. */
export function paintRichText(
  target: ReplayTarget,
  p: Extract<RenderItem['primitive'], { kind: 'text' }>,
): void {
  if (target.measureText) {
    const richText = p.richText! as import('../types').RichText;
    const hasAdvancedParagraphFormatting = richText.paragraphs.some((paragraph) => {
      const format = paragraph.format;
      return format?.maxLines !== undefined || format?.textOverflow !== undefined;
    });
    if (!hasAdvancedParagraphFormatting || isVerticalWritingMode(p.writingMode)) {
      const snapshot = layoutRichTextSnapshot(
        richText,
        {
          fontFamily: p.fontFamily,
          fontReference: p.fontReference,
          fontSize: p.fontSize,
          fontWeight: p.fontWeight,
          fontStyle: p.fontStyle,
          letterSpacing: p.letterSpacing,
          tracking: p.tracking ?? 0,
          lineHeight: p.lineHeight,
          direction: p.direction,
          language: p.language,
          openTypeFeatures: p.openTypeFeatures,
          variableAxes: p.variableAxes,
          writingMode: p.writingMode,
          textOrientation: p.textOrientation,
        },
        target as import('../richTextLayout').RichTextMeasureContext,
        {
          maxWidth: p.textMode === 'area' ? (isVerticalWritingMode(p.writingMode) ? p.h : p.w) : 0,
          wrapShape: textWrapShapeForPrimitive(p),
          lineHeight: p.fontSize * p.lineHeight,
          paragraphSpacing: p.paragraphSpacing,
          language: p.language,
          writingMode: p.writingMode,
          textOrientation: p.textOrientation,
        },
      );
      paintCanonicalRichText(target, p, richText, snapshot);
      return;
    }
  }
  const defaultFormat = {
    fontSize: p.fontSize,
    fontFamily: p.fontFamily,
    fontWeight: p.fontWeight,
    fontStyle: p.fontStyle,
    letterSpacing: p.letterSpacing,
    tracking: p.tracking ?? 0,
    lineHeight: p.lineHeight,
    textCase: p.textCase,
    textDecoration: p.textDecoration,
  };
  const positioned = layoutRichText(
    p.richText! as import('../textLayout').RichTextInput,
    p.textMode === 'area' ? p.w : 0,
    defaultFormat,
  );

  let yOffset = 0;
  if (p.textAlignVertical === 'middle') yOffset = (p.h - positioned.height) / 2;
  else if (p.textAlignVertical === 'bottom') yOffset = p.h - positioned.height;

  const originalFillStyle = target.fillStyle;

  const richIsRTL = p.direction === 'rtl' || (p.direction !== 'ltr' && detectRTL(p.text));

  for (const line of positioned.lines) {
    const lineWidth = line.runs.reduce((sum, r) => sum + r.width, 0);
    let xOffset = 0;
    let wordSpacingAdjust = 0;
    if (p.textAlign === 'center') {
      xOffset = (p.w - lineWidth) / 2;
    } else if (p.textAlign === 'right' || (richIsRTL && p.textAlign === 'left')) {
      // RTL: align to the right edge so the browser's native BiDi reorder works.
      target.textAlign = 'right';
      xOffset = p.w - lineWidth;
    } else if (p.textAlign === 'justify') {
      // Justify: count inter-word gaps and distribute remaining space
      let totalGaps = 0;
      for (const run of line.runs) {
        const spaces = (run.text.match(/\s/g) || []).length;
        totalGaps += spaces;
      }
      if (totalGaps > 0 && lineWidth < p.w) {
        wordSpacingAdjust = (p.w - lineWidth) / totalGaps;
      }
    }

    for (const run of line.runs) {
      const runFormat = run.format;
      setCanvasFont(
        target,
        replayFontString(
          runFormat.fontFamily ?? p.fontFamily,
          runFormat.fontSize ?? p.fontSize,
          runFormat.fontWeight ?? p.fontWeight,
          runFormat.fontStyle ?? p.fontStyle,
          runFormat.openTypeFeatures ?? p.openTypeFeatures,
          runFormat.variableFontSettings ?? p.variableAxes,
          run.text,
          runFormat.fontReference
            ? fontReferenceKey(runFormat.fontReference)
            : p.fontReference
              ? fontReferenceKey(p.fontReference)
              : undefined,
        ),
      );
      // Run color is ManagedColor since schema 2.14; legacy tuples still
      // render (clipboard fragments, external IR). rgba() handles both.
      if (runFormat?.color) {
        target.fillStyle = rgba(runFormat.color);
      }
      const restoreSettings = applyReplayTextSettings(
        target,
        runFormat.openTypeFeatures ?? p.openTypeFeatures,
        runFormat.variableFontSettings ?? p.variableAxes,
      );
      if (wordSpacingAdjust > 0 && /\s/.test(run.text)) {
        // Distribute extra space between words within this run
        const parts = run.text.split(/(\s+)/);
        let runX = p.x + run.x + xOffset;
        for (const part of parts) {
          if (part === '') continue;
          if (/^\s+$/.test(part)) {
            runX += measureTextAdvance(target, part) + wordSpacingAdjust;
          } else {
            target.fillText(part, runX, p.y + run.y + yOffset);
            runX += measureTextAdvance(target, part);
          }
        }
      } else {
        target.fillText(run.text, p.x + run.x + xOffset, p.y + run.y + yOffset);
      }

      if (
        run.format.textDecoration === 'underline' ||
        run.format.textDecoration === 'line-through'
      ) {
        const decoY =
          run.format.textDecoration === 'underline'
            ? p.y + run.y + yOffset + run.format.fontSize * 1.1
            : p.y + run.y + yOffset + run.format.fontSize * 0.5;
        target.beginPath();
        target.moveTo(p.x + run.x + xOffset, decoY);
        target.lineTo(p.x + run.x + xOffset + run.width, decoY);
        target.strokeStyle = target.fillStyle;
        target.lineWidth = 1;
        target.stroke();
      }

      restoreSettings();
      target.fillStyle = originalFillStyle;
    }
  }
}

function richTextFormatAt(
  richText: import('../types').RichText,
  offset: number,
): import('../types').CharacterFormat {
  let cursor = 0;
  for (const paragraph of richText.paragraphs) {
    for (const run of paragraph.runs) {
      if (offset >= cursor && offset < cursor + run.text.length) return run.format ?? {};
      cursor += run.text.length;
    }
    cursor += 1;
  }
  return {};
}

function paintCanonicalRichText(
  target: ReplayTarget,
  p: Extract<RenderItem['primitive'], { kind: 'text' }>,
  richText: import('../types').RichText,
  snapshot: TextLayoutSnapshot,
): void {
  if (isVerticalWritingMode(p.writingMode)) {
    paintVerticalCanonicalRichText(target, p, richText, snapshot);
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
      const format = richTextFormatAt(richText, run.sourceStart);
      const weight = Math.max(1, Math.min(1000, format.fontWeight ?? run.sourceRun.fontWeight));
      const size = format.fontSize ?? run.sourceRun.fontSize;
      const family = format.fontFamily ?? run.sourceRun.fontFamily;
      const runText = snapshot.text.slice(run.sourceStart, run.sourceEnd);
      if (runText.length === 0 || runText.includes('\n')) continue;
      const features = format.openTypeFeatures ?? p.openTypeFeatures;
      const axes = format.variableFontSettings ?? p.variableAxes;
      const faceKey = format.fontReference
        ? fontReferenceKey(format.fontReference)
        : p.fontReference
          ? fontReferenceKey(p.fontReference)
          : undefined;
      if (format.color) target.fillStyle = rgba(format.color);
      const restoreSettings = applyReplayTextSettings(target, features, axes, run.direction);
      paintTypographyRun(target, {
        family,
        text: runText,
        x: p.x + xOffset + run.x,
        y: p.y + verticalOffset + line.baseline,
        fontSize: size,
        fontWeight: weight,
        fontStyle: format.fontStyle ?? run.sourceRun.fontStyle,
        features,
        axes,
        faceKey,
      });
      restoreSettings();
      target.fillStyle = originalFillStyle;
    }
  }
}
