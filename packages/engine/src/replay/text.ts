import { hasPotentialStandardLigatureSequence } from '@varve/shared';
import { setCanvasFont } from '../canvasFontAliases';
import { fontReferenceKey } from '../font/fontIdentity';
import type { ReplayTarget } from '../replayTypes';
import type { RenderItem } from '../types';
import { canonicalTextSnapshot, paintCanonicalText } from './textCanonical';
import { drawClusters, paintPathText } from './textPath';
import { paintRichText } from './textRich';
import {
  applyReplayTextSettings,
  applyReplayTextSpacing,
  applyTextCase,
  detectRTL,
  effectiveWeight,
  ellipsizeText,
  measureTextAdvance,
  replayFontString,
} from './typography';
/** Paint a text primitive via Canvas2D `fillText` with full typography support. */
export function paintText(
  target: ReplayTarget,
  p: Extract<RenderItem['primitive'], { kind: 'text' }>,
): void {
  if (p.textMode === 'path' && p.pathTextSettings) {
    // A missing/deleted path must not make the logical text disappear. The
    // inspector reports the missing reference; replay keeps the source
    // visible as ordinary text until the user reattaches or detaches it.
    if (p.pathShape) {
      paintPathText(target, p);
      return;
    }
  }
  if (p.richText) {
    paintRichText(target, p);
    return;
  }
  const snapshot = canonicalTextSnapshot(target, p);
  if (snapshot) {
    paintCanonicalText(target, p, snapshot);
    return;
  }

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
      p.text,
      p.fontReference ? fontReferenceKey(p.fontReference) : undefined,
    ),
  );

  // Text baseline from vertical alignment.
  // When textAlignVertical='bottom', use 'bottom' baseline so descenders
  // (g, j, p, q, y) stay inside the text box rather than extending below it.
  const baselineMap: Record<string, CanvasTextBaseline> = {
    top: 'top',
    middle: 'middle',
    bottom: 'bottom',
  };
  target.textBaseline = baselineMap[p.textAlignVertical] ?? 'top';

  // Determine paragraph direction: explicit override or auto-detect from content.
  // When RTL, set textAlign='right' so the browser's native BiDi engine reorders
  // runs within fillText(). Our shaped data (shapeRun) handles caret/hit-testing.
  const isRTL = p.direction === 'rtl' || (p.direction !== 'ltr' && detectRTL(p.text));
  target.textAlign = isRTL && p.textAlign === 'left' ? 'right' : (p.textAlign as CanvasTextAlign);

  // Apply text case transform
  const displayText = applyTextCase(p.text, p.textCase);

  const trackingAdvance = ((p.tracking ?? 0) * p.fontSize) / 1000;
  const measureLine = (value: string): number => {
    let width = 0;
    for (let index = 0; index < value.length; index++) {
      width += measureTextAdvance(target, value[index] ?? '');
      if (index < value.length - 1) width += p.letterSpacing + trackingAdvance;
    }
    return width;
  };

  const wrapLine = (value: string): string[] => {
    if (p.textMode !== 'area' || p.w <= 0 || measureLine(value) <= p.w) return [value];
    const result: string[] = [];
    let current = '';
    const commit = (): void => {
      const line = current.trimEnd();
      if (line.length > 0) result.push(line);
      current = '';
    };
    for (const token of value.split(/(\s+)/)) {
      if (token.length === 0) continue;
      const candidate = current + token;
      if (current.length > 0 && measureLine(candidate) > p.w) commit();
      if (measureLine(token) <= p.w) {
        current += current.length === 0 ? token.trimStart() : token;
        continue;
      }
      for (const char of token) {
        if (current.length > 0 && measureLine(current + char) > p.w) commit();
        current += char;
      }
    }
    commit();
    return result.length > 0 ? result : [''];
  };

  // Expand tabs using tab stops or default tab width
  function expandTabs(text: string, xStart: number): string {
    if (!text.includes('\t')) return text;
    const stops = p.tabStops;
    if (stops && stops.length > 0) {
      // Tab stops: advance to next stop position
      const slines: string[] = [];
      const parts = text.split('\t');
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i] ?? '';
        if (i === 0) {
          slines.push(part);
          continue;
        }
        // Compute current x position based on accumulated content width
        let currentX = xStart;
        for (const prev of slines) {
          currentX += measureTextAdvance(target, prev);
        }
        // Find the next tab stop > currentX
        let nextStop = currentX + measureTextAdvance(target, ' ') * 8;
        for (const stop of stops) {
          if (stop.position > currentX + xStart) {
            nextStop = stop.position - xStart;
            break;
          }
        }
        const spaceWidth = measureTextAdvance(target, ' ');
        const spacesNeeded = Math.max(1, Math.ceil((nextStop - currentX) / spaceWidth));
        slines.push(' '.repeat(spacesNeeded) + part);
      }
      return slines.join('');
    }
    // Default tab width: 8 spaces
    const tabWidth = (p.tabSize ?? 8) * measureTextAdvance(target, ' ');
    const lines: string[] = [];
    const parts = text.split('\t');
    for (let i = 0; i < parts.length; i++) {
      if (i === 0) {
        lines.push(parts[i] ?? '');
        continue;
      }
      let currentX = xStart;
      for (const prev of lines) {
        currentX += measureTextAdvance(target, prev);
      }
      const tabStop = Math.ceil((currentX - xStart + 1) / tabWidth) * tabWidth + xStart;
      const spaceWidth = measureTextAdvance(target, ' ');
      const spacesNeeded = Math.max(1, Math.ceil((tabStop - currentX) / spaceWidth));
      lines.push(' '.repeat(spacesNeeded) + (parts[i] ?? ''));
    }
    return lines.join('');
  }

  // Split into lines and expand tabs
  const rawLines = displayText.split('\n').flatMap((line) => wrapLine(expandTabs(line, p.x)));

  // Build list prefix for each line
  const lines: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i] ?? '';
    if (p.listStyle === 'disc') line = `• ${line}`;
    else if (p.listStyle === 'circle') line = `○ ${line}`;
    else if (p.listStyle === 'square') line = `[ ] ${line}`;
    else if (p.listStyle === 'decimal') line = `${i + 1}. ${line}`;
    lines.push(line);
  }

  // Compute line metrics
  const lh = p.fontSize * p.lineHeight;
  const ps = p.paragraphSpacing;
  const ls = p.letterSpacing;
  const tr = ((p.tracking ?? 0) * p.fontSize) / 1000;

  const constrainedOverflow =
    p.textMode === 'area' && (p.textOverflow === 'clip' || p.textOverflow === 'ellipsis');
  const shouldClipToFrame = constrainedOverflow && p.w > 0 && p.h > 0;
  if (shouldClipToFrame) {
    target.save();
    target.beginPath();
    target.rect(p.x, p.y, p.w, p.h);
    target.clip();
  }

  // Compute text overflow: visible text
  const visibleLines: Array<{ text: string; y: number }> = [];
  const currentY = p.y;
  let hasVerticalOverflow = false;
  for (let i = 0; i < lines.length; i++) {
    const yPos = currentY + i * lh + (i > 0 ? ps : 0);
    if (constrainedOverflow && yPos + lh > p.y + p.h) {
      hasVerticalOverflow = true;
      break;
    }
    visibleLines.push({ text: lines[i] ?? '', y: yPos });
  }

  // Adjust Y for vertical alignment
  const totalHeight = visibleLines.length * lh + Math.max(0, visibleLines.length - 1) * ps;
  let yOffset = 0;
  if (p.textAlignVertical === 'middle') {
    yOffset = (p.h - totalHeight) / 2;
  } else if (p.textAlignVertical === 'bottom') {
    yOffset = p.h - totalHeight;
  }

  // Draw each line
  for (const vl of visibleLines) {
    const y = vl.y + yOffset;
    const text = vl.text;

    // Handle overflow ellipsis
    let displayLine = text;
    if (p.textOverflow === 'ellipsis' && (hasVerticalOverflow || measureLine(text) > p.w)) {
      setCanvasFont(
        target,
        replayFontString(
          p.fontFamily,
          p.fontSize,
          fw,
          p.fontStyle,
          p.openTypeFeatures,
          p.variableAxes,
          displayLine,
          p.fontReference ? fontReferenceKey(p.fontReference) : undefined,
        ),
      );
      displayLine = ellipsizeText(text, p.w, measureLine);
    }

    // Calculate x origin based on text alignment within the box
    let xOrigin: number;
    let extraWordSpacing = 0;
    if (p.textAlign === 'center') {
      xOrigin = p.x + p.w / 2;
    } else if (p.textAlign === 'right') {
      xOrigin = p.x + p.w;
    } else if (p.textAlign === 'justify') {
      xOrigin = p.x;
      // Justify: distribute extra space between words
      if (displayLine.length > 0) {
        setCanvasFont(
          target,
          replayFontString(
            p.fontFamily,
            p.fontSize,
            fw,
            p.fontStyle,
            p.openTypeFeatures,
            p.variableAxes,
            displayLine,
            p.fontReference ? fontReferenceKey(p.fontReference) : undefined,
          ),
        );
        const totalTextWidth =
          measureTextAdvance(target, displayLine.replace(/\s/g, '')) +
          (displayLine.split(/\s+/).length - 1) * measureTextAdvance(target, ' ');
        const gaps = (displayLine.match(/\s/g) || []).length;
        if (gaps > 0 && totalTextWidth < p.w) {
          extraWordSpacing = (p.w - totalTextWidth) / gaps;
        }
      }
    } else {
      xOrigin = p.x;
    }

    // Apply first-line indent (first line only)
    const isFirstLine = vl === visibleLines[0];
    const lineIndent = isFirstLine && p.firstLineIndent ? p.firstLineIndent : 0;

    // Draw text with letter spacing if needed
    const drawOriginX = xOrigin + lineIndent;
    const hasGlyphAdjustments =
      p.glyphAdjustments !== undefined && Object.keys(p.glyphAdjustments).length > 0;
    const hasPairAdjustments =
      p.pairAdjustments !== undefined && Object.keys(p.pairAdjustments).length > 0;
    const glyphControlled = p.kerningMode === 'none' || hasGlyphAdjustments || hasPairAdjustments;
    // Cluster drawing needs a 1:1 display line -> source text mapping so
    // cluster indices remain globally stable (no case transform, list
    // prefix, tabs, wrapping, RTL, or justify word-spacing).
    const clusterSafe =
      glyphControlled &&
      lines.length === 1 &&
      lines[0] === text &&
      !isRTL &&
      p.textAlign !== 'justify' &&
      extraWordSpacing === 0 &&
      !hasPotentialStandardLigatureSequence(displayLine, p.openTypeFeatures);
    const mustPreserveLigature =
      hasPotentialStandardLigatureSequence(displayLine, p.openTypeFeatures) &&
      (glyphControlled || ls !== 0 || tr !== 0);
    if (mustPreserveLigature) {
      // Canvas2D has no portable glyph-ID draw call. Do not split a likely
      // `liga` sequence just to honour a per-cluster adjustment or spacing;
      // that would silently replace the ligature with unrelated glyphs.
      const restoreSettings = applyReplayTextSettings(
        target,
        p.openTypeFeatures,
        p.variableAxes,
        isRTL ? 'rtl' : 'ltr',
      );
      const restoreSpacing = applyReplayTextSpacing(target, ls + tr);
      target.fillText(displayLine, drawOriginX, y);
      restoreSpacing();
      restoreSettings();
    } else if (clusterSafe) {
      drawClusters(target, displayLine, drawOriginX, y, ls, tr, p);
    } else if (
      (ls !== 0 ||
        tr !== 0 ||
        extraWordSpacing > 0 ||
        (p.kerningMode === 'none' && glyphControlled)) &&
      displayLine.length > 1
    ) {
      // Per-character or per-word rendering for custom spacing. Also used as
      // the kerning-off fallback when the cluster path is unavailable.
      const words = displayLine.split(/(\s+)/);
      let cursorX = drawOriginX;
      for (const word of words) {
        if (word === '') continue;
        const isSpace = /^\s+$/.test(word);
        if (isSpace) {
          // Draw spaces as advance only
          cursorX += measureTextAdvance(target, word) + extraWordSpacing;
          continue;
        }
        if ((ls !== 0 || tr !== 0) && word.length > 1) {
          // Letter spacing / tracking per character
          for (let ci = 0; ci < word.length; ci++) {
            const char = word[ci] ?? '';
            target.fillText(char, cursorX, y);
            cursorX += measureTextAdvance(target, char) + ls + tr;
          }
        } else {
          target.fillText(word, cursorX, y);
          cursorX += measureTextAdvance(target, word);
        }
      }
    } else {
      target.fillText(displayLine, drawOriginX, y);
    }

    // Text decoration: underline
    if (p.textDecoration === 'underline' || p.textDecoration === 'line-through') {
      const decoY = p.textDecoration === 'underline' ? y + p.fontSize * 1.1 : y + p.fontSize * 0.5;
      const decoX1 = p.textAlign === 'center' ? p.x : p.x;
      const decoX2 = p.textAlign === 'center' ? p.x + p.w : p.x + p.w;
      target.beginPath();
      target.moveTo(decoX1, decoY);
      target.lineTo(decoX2, decoY);
      target.strokeStyle = target.fillStyle;
      target.lineWidth = 1;
      target.stroke();
    }
  }

  if (shouldClipToFrame) target.restore();
}
