import { openTypeFeaturesToCss } from '@varve/shared';
import {
  drawCanvasOpenTypeText,
  resolveCanvasFontFamily,
  setCanvasFont,
} from '../canvasFontAliases';
import { fontReferenceKey } from '../font/fontIdentity';
import type { ReplayTarget } from '../replayTypes';
import type { RenderItem } from '../types';
import type { ReplayTextSettingsTarget } from './types';
/**
 * Prime generated font aliases before replay paints any authored text.
 *
 * Chromium can retain the fallback selected for a generated family on a
 * Canvas2D context after the context has first measured the source family.
 * A ready alias therefore has to be the first typography lookup on a fresh
 * replay target. This is a no-op in workers/non-DOM runtimes and for ordinary
 * text, so the common path keeps its existing hot-loop behaviour.
 */
export function primeCanvasTypographyAliases(
  target: ReplayTarget,
  items: readonly RenderItem[],
): void {
  if (typeof document === 'undefined' || !target.measureText) return;
  const previousFont = target.font;
  try {
    for (const item of items) {
      const primitive = item.primitive;
      if (primitive.kind !== 'text') continue;
      primeCanvasTypographyAlias(target, {
        family: primitive.fontFamily,
        size: primitive.fontSize,
        weight: effectiveWeight(primitive),
        style: primitive.fontStyle,
        features: primitive.openTypeFeatures,
        axes: primitive.variableAxes,
        text: primitive.text,
        faceKey: primitive.fontReference ? fontReferenceKey(primitive.fontReference) : undefined,
      });
      for (const paragraph of primitive.richText?.paragraphs ?? []) {
        for (const run of paragraph.runs) {
          const format = run.format;
          primeCanvasTypographyAlias(target, {
            family: format?.fontFamily ?? primitive.fontFamily,
            size: format?.fontSize ?? primitive.fontSize,
            weight: format?.fontWeight ?? effectiveWeight(primitive),
            style: format?.fontStyle ?? primitive.fontStyle,
            features: format?.openTypeFeatures ?? primitive.openTypeFeatures,
            axes: format?.variableFontSettings ?? primitive.variableAxes,
            text: run.text,
            faceKey: format?.fontReference
              ? fontReferenceKey(format.fontReference)
              : primitive.fontReference
                ? fontReferenceKey(primitive.fontReference)
                : undefined,
          });
        }
      }
    }
  } finally {
    target.font = previousFont;
  }
}

function primeCanvasTypographyAlias(
  target: ReplayTarget,
  input: {
    family: string;
    size: number;
    weight: number;
    style: string;
    features?: import('@varve/shared').OpenTypeFeatureMap;
    axes?: Record<string, number>;
    text: string;
    faceKey?: string;
  },
): void {
  const hasFeatures = Object.keys(input.features ?? {}).length > 0;
  const hasCustomAxes = Object.keys(input.axes ?? {}).some((tag) => tag !== 'wght');
  if (!hasFeatures && !hasCustomAxes) return;
  const alias = resolveCanvasFontFamily(
    input.family,
    input.features,
    input.axes,
    input.text,
    input.faceKey,
  );
  if (alias === input.family) return;
  const style = input.style === 'italic' ? 'italic ' : '';
  const weight = Math.max(1, Math.min(1000, input.weight));
  setCanvasFont(target, `${style}${weight} ${input.size}px "${alias}"`);
  target.measureText?.(input.text);
}

/** Apply text case transform to a string. */
export function applyTextCase(text: string, textCase: string): string {
  switch (textCase) {
    case 'uppercase':
      return text.toUpperCase();
    case 'lowercase':
      return text.toLowerCase();
    case 'capitalize':
      return text.replace(/\b\w/g, (c) => c.toUpperCase());
    default:
      return text;
  }
}

/**
 * Auto-detect whether a text string is predominantly RTL.
 * Scans for the first strong directional character (UAX #9 P2/P3).
 * Returns true if the first strong char is Hebrew or Arabic.
 */
export function detectRTL(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i) ?? 0;
    // Hebrew: U+0590–U+05FF, U+FB1D–U+FB4F
    if (code >= 0x0590 && code <= 0x05ff) return true;
    if (code >= 0xfb1d && code <= 0xfb4f) return true;
    // Arabic: U+0600–U+06FF, U+0750–U+077F, U+0870–U+08FF, U+FB50–U+FDFF, U+FE70–U+FEFF
    if (code >= 0x0600 && code <= 0x06ff) return true;
    if (code >= 0x0750 && code <= 0x077f) return true;
    if (code >= 0x0870 && code <= 0x08ff) return true;
    if (code >= 0xfb50 && code <= 0xfdff) return true;
    if (code >= 0xfe70 && code <= 0xfeff) return true;
    if (code >= 0x1ec70 && code <= 0x1ecbf) return true;
    if (code >= 0x1ee00 && code <= 0x1eeff) return true;
    // Strong LTR found first → not RTL
    if (
      (code >= 0x0041 && code <= 0x005a) ||
      (code >= 0x0061 && code <= 0x007a) ||
      (code >= 0x00c0 && code <= 0x024f) ||
      (code >= 0x0370 && code <= 0x03ff) ||
      (code >= 0x0400 && code <= 0x04ff) ||
      (code >= 0x0900 && code <= 0x0d7f) ||
      (code >= 0x0e00 && code <= 0x0eff) ||
      (code >= 0x1000 && code <= 0x10ff) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0x3040 && code <= 0x30ff)
    ) {
      return false;
    }
    if (code > 0xffff) i++; // skip surrogate low
  }
  return false;
}

/**
 * Apply optional Canvas typography extensions without manufacturing support.
 * Chromium/WebKit versions that do not expose these properties keep their
 * native whole-run shaping; range settings remain a glyph-ID-backend concern.
 */
export function applyReplayTextSettings(
  target: ReplayTarget,
  features: import('@varve/shared').OpenTypeFeatureMap | undefined,
  axes: Record<string, number> | undefined,
  direction?: 'ltr' | 'rtl',
): () => void {
  const candidate = target as ReplayTextSettingsTarget;
  const previous: Array<() => void> = [];
  if ('fontFeatureSettings' in candidate) {
    const value = candidate.fontFeatureSettings;
    previous.push(() => {
      candidate.fontFeatureSettings = value;
    });
    candidate.fontFeatureSettings = openTypeFeaturesToCss(features) ?? 'normal';
  }
  if ('fontVariationSettings' in candidate) {
    const value = candidate.fontVariationSettings;
    previous.push(() => {
      candidate.fontVariationSettings = value;
    });
    const settings = Object.entries(axes ?? {})
      .filter(([tag]) => tag !== 'wght')
      .map(([tag, axisValue]) => `"${tag}" ${axisValue}`)
      .join(', ');
    candidate.fontVariationSettings = settings || 'normal';
  }
  if (direction && 'direction' in candidate) {
    const value = candidate.direction;
    previous.push(() => {
      candidate.direction = value;
    });
    candidate.direction = direction;
  }
  return () => {
    for (let index = previous.length - 1; index >= 0; index -= 1) previous[index]!();
  };
}

/**
 * Preserve an active ligature when a spacing request cannot be represented by
 * this Canvas2D implementation. Splitting the source string would change the
 * glyph sequence; a whole-run draw is the safer, visibly bounded fallback.
 */
export function applyReplayTextSpacing(target: ReplayTarget, spacing: number): () => void {
  const candidate = target as ReplayTarget & { letterSpacing?: string };
  if (!('letterSpacing' in candidate)) return () => {};
  const previous = candidate.letterSpacing;
  candidate.letterSpacing = `${spacing}px`;
  return () => {
    candidate.letterSpacing = previous;
  };
}

/**
 * Effective weight for a Canvas2D font string.
 *
 * A CanvasRenderingContext2D `font` is a CSS font shorthand, and the
 * shorthand has no slot for `font-variation-settings` — so the axis values
 * the inspector writes never reached the canvas, and dragging a weight axis
 * changed the document while the glyphs stayed exactly as they were. The
 * shorthand's weight *does* drive a variable font's `wght` axis, so folding
 * that axis into the weight slot is how this renderer honours it.
 *
 * Only `wght` can be expressed this way. Axes like `opsz`, `wdth` and `slnt`
 * have no shorthand equivalent and are still applied only where the outline
 * path runs (textOutlines.ts sets them on the parsed font), not in this
 * Canvas2D preview.
 */
export function effectiveWeight(p: {
  fontWeight: number;
  variableAxes?: Record<string, number>;
}): number {
  const axis = p.variableAxes?.wght;
  const weight = typeof axis === 'number' && Number.isFinite(axis) ? axis : p.fontWeight;
  return Math.max(1, Math.min(1000, weight));
}

export function replayFontString(
  family: string,
  fontSize: number,
  fontWeight: number,
  fontStyle: string | undefined,
  features: import('@varve/shared').OpenTypeFeatureMap | undefined,
  axes: Record<string, number> | undefined,
  text?: string,
  faceKey?: string,
): string {
  const style = fontStyle === 'italic' ? 'italic ' : '';
  const weight = Math.max(1, Math.min(1000, fontWeight));
  const resolvedFamily = resolveCanvasFontFamily(family, features, axes, text, faceKey);
  return `${style}${weight} ${fontSize}px "${resolvedFamily}"`;
}

/** Paint one logical run, using parsed OpenType paths when Canvas2D cannot
 * carry authored feature or custom-axis settings through fillText. */
export function paintTypographyRun(
  target: ReplayTarget,
  input: {
    family: string;
    text: string;
    x: number;
    y: number;
    fontSize: number;
    fontWeight: number;
    fontStyle?: string;
    features?: import('@varve/shared').OpenTypeFeatureMap;
    axes?: Record<string, number>;
    faceKey?: string;
  },
): void {
  setCanvasFont(
    target,
    replayFontString(
      input.family,
      input.fontSize,
      input.fontWeight,
      input.fontStyle,
      input.features,
      input.axes,
      input.text,
      input.faceKey,
    ),
  );
  const advanced =
    Object.keys(input.features ?? {}).length > 0 ||
    Object.keys(input.axes ?? {}).some((tag) => tag !== 'wght');
  const drawn =
    advanced &&
    drawCanvasOpenTypeText(target, {
      family: input.family,
      text: input.text,
      x: input.x,
      y: input.y,
      fontSize: input.fontSize,
      fontWeight: input.fontWeight,
      fontStyle: input.fontStyle,
      features: input.features,
      axes: { ...(input.axes ?? {}), wght: input.fontWeight },
      faceKey: input.faceKey,
    });
  if (!drawn) target.fillText(input.text, input.x, input.y);
}

export function ellipsizeText(
  text: string,
  maxWidth: number,
  measure: (value: string) => number,
): string {
  const suffix = '…';
  if (maxWidth <= 0 || measure(suffix) > maxWidth) return '';
  const clusters = Array.from(text);
  if (measure(text + suffix) <= maxWidth) return text + suffix;
  while (clusters.length > 0 && measure(`${clusters.join('')}${suffix}`) > maxWidth) {
    clusters.pop();
  }
  return `${clusters.join('')}${suffix}`;
}

/** Module-level cached canvas + context for measureText calls (created lazily). */
let _measureCanvasOffscreen: OffscreenCanvas | HTMLCanvasElement | null = null;
let _measureCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

function _ensureMeasureContext(): void {
  if (_measureCtx) return;
  if (typeof OffscreenCanvas !== 'undefined') {
    _measureCanvasOffscreen = new OffscreenCanvas(4096, 1);
    _measureCtx = _measureCanvasOffscreen.getContext('2d');
  }
  if (!_measureCtx && typeof document !== 'undefined') {
    _measureCanvasOffscreen = document.createElement('canvas');
    _measureCanvasOffscreen.width = 4096;
    _measureCanvasOffscreen.height = 1;
    _measureCtx = _measureCanvasOffscreen.getContext('2d');
  }
}

/** Measure the width of a single character in the current canvas font. Falls back to an estimate. */
export function measureTextAdvance(target: ReplayTarget, char: string): number {
  _ensureMeasureContext();
  const fallback = char.length * (target.font ? parseFontSize(target.font) * 0.6 : 0);
  if (!_measureCtx) return fallback;
  _measureCtx.font = target.font;
  const measured = _measureCtx.measureText(char).width;
  return Number.isFinite(measured) && (measured > 0 || char.length === 0) ? measured : fallback;
}

function parseFontSize(font: string): number {
  const pxIndex = font.indexOf('px');
  if (pxIndex < 1) return 16;
  let start = pxIndex - 1;
  while (start >= 0) {
    const code = font.charCodeAt(start);
    if ((code >= 0x30 && code <= 0x39) || code === 0x2e) {
      start--;
      continue;
    }
    break;
  }
  const parsed = Number.parseFloat(font.slice(start + 1, pxIndex));
  return Number.isFinite(parsed) ? parsed : 16;
}
