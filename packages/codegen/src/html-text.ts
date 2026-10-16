/**
 * HTML text utilities for the IR-HTML target: escaping, size formatting,
 * and the rich-text paragraph renderer.
 *
 * Kept out of `html.ts` so the emitter's complexity budget stays on layout
 * and appearance; this module owns everything text-content shaped.
 */

import type { TextContent, TypographySpec } from './ir-types';

/** Escape text for HTML body content, exactly once. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Format a px value against the export unit and base font size. */
export function sizeValue(px: number, unit: string, base: number): string {
  if (unit === 'rem' && base > 0) return `${(px / base).toFixed(3)}rem`;
  return `${px}px`;
}

/**
 * Inline style declarations for one run, emitting only properties that
 * differ from the node's own typography — the text node style is already on
 * the wrapping element, so identical runs produce no spans at all.
 */
function runStyleToCss(
  style: Partial<TypographySpec>,
  nodeDefault: TypographySpec,
  unit: string,
  base: number,
): string {
  const parts: string[] = [];
  if (style.fontFamily && style.fontFamily !== nodeDefault.fontFamily) {
    parts.push(
      `font-family: ${style.fontFamily.includes(' ') ? `"${style.fontFamily}"` : style.fontFamily}`,
    );
  }
  if (style.fontSize !== undefined && style.fontSize !== nodeDefault.fontSize) {
    parts.push(`font-size: ${sizeValue(style.fontSize, unit, base)}`);
  }
  if (style.fontWeight !== undefined && style.fontWeight !== nodeDefault.fontWeight) {
    parts.push(`font-weight: ${style.fontWeight}`);
  }
  if (style.fontStyle && style.fontStyle !== 'normal') parts.push(`font-style: ${style.fontStyle}`);
  if (style.color && style.color !== nodeDefault.color) parts.push(`color: ${style.color}`);
  if (style.lineHeight !== undefined && style.lineHeight !== nodeDefault.lineHeight) {
    parts.push(`line-height: ${style.lineHeight}`);
  }
  if (style.letterSpacing !== undefined && style.letterSpacing !== nodeDefault.letterSpacing) {
    parts.push(`letter-spacing: ${sizeValue(style.letterSpacing, unit, base)}`);
  }
  if (style.textTransform && style.textTransform !== 'none') {
    parts.push(`text-transform: ${style.textTransform}`);
  }
  if (style.decoration && style.decoration !== 'none') {
    parts.push(`text-decoration: ${style.decoration}`);
  }
  return parts.join('; ');
}

/**
 * Paragraph structure for rich text: one `<p>` per authored paragraph (a
 * deliberate blank line renders `<p><br /></p>`), styled spans only where a
 * run differs from the node typography. Content is HTML-escaped exactly
 * once, here — markup-like design text stays literal text.
 */
export function richTextToHtml(
  text: TextContent,
  typo: TypographySpec,
  unit: string,
  base: number,
): string {
  const paragraphs = text.paragraphs;
  if (!paragraphs || paragraphs.length === 0) return escapeHtml(text.value);
  return paragraphs
    .map((p) => {
      const pStyle: string[] = [];
      if (p.textAlign && p.textAlign !== (typo.textAlign ?? 'left')) {
        pStyle.push(`text-align: ${p.textAlign}`);
      }
      if (p.direction && p.direction !== 'ltr') {
        pStyle.push(`direction: ${p.direction}`, 'unicode-bidi: plaintext');
      }
      const openTag = pStyle.length > 0 ? `<p style="${pStyle.join('; ')}">` : '<p>';
      if (!p.runs || p.runs.length === 0) return `${openTag}<br /></p>`;
      const inner = p.runs
        .map((run) => {
          const escaped = escapeHtml(run.text);
          const style = runStyleToCss(run.style, typo, unit, base);
          return style ? `<span style="${style}">${escaped}</span>` : escaped;
        })
        .join('');
      return `${openTag}${inner}</p>`;
    })
    .join('');
}
