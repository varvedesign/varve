/**
 * Shared vertical-writing semantics.
 *
 * This module deliberately works on grapheme-cluster strings rather than
 * individual UTF-16 code units. The renderer and editor can therefore use the
 * same orientation decision without splitting combining sequences, emoji ZWJ
 * sequences, or other user-perceived characters.
 */

import { VERTICAL_ORIENTATION_RANGES } from './verticalOrientationData';

export type WritingMode = 'horizontal-tb' | 'vertical-rl' | 'vertical-lr';
export type TextOrientation = 'mixed' | 'upright' | 'sideways';
export type VerticalGlyphOrientation = 'upright' | 'sideways';

/** Vertical_Orientation values from the generated UAX #50 table. */
const ORIENTATION_UPRIGHT = 0;
const ORIENTATION_TRANSFORMED_UPRIGHT = 2;
const ORIENTATION_TRANSFORMED_ROTATED = 3;

export function isVerticalWritingMode(mode: WritingMode | undefined): boolean {
  return mode === 'vertical-rl' || mode === 'vertical-lr';
}

/** HarfBuzz/rustybuzz direction for the inline axis of a vertical paragraph. */
export function verticalShapingDirection(
  mode: WritingMode | undefined,
): 'ltr' | 'rtl' | 'ttb' | 'btt' {
  return isVerticalWritingMode(mode) ? 'ttb' : 'ltr';
}

/** Binary search over the generated [first, last, value] range table. */
function verticalOrientationOfCodePoint(codePoint: number): number | undefined {
  let low = 0;
  let high = VERTICAL_ORIENTATION_RANGES.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const range = VERTICAL_ORIENTATION_RANGES[mid]!;
    if (codePoint < range[0]) high = mid - 1;
    else if (codePoint > range[1]) low = mid + 1;
    else return range[2];
  }
  return undefined;
}

/**
 * Resolve the CSS/UAX #50 orientation for one extended grapheme cluster in
 * `mixed` mode. The pinned UCD Vertical_Orientation table is the authority:
 * upright (U and Tu-with-fallback) versus rotated a quarter turn clockwise
 * (R and Tr-with-fallback, the correct fallback when a font supplies no
 * `vert`/`vrt2` vertical form).
 *
 * Two documented policy layers sit on top of the table, matching browser
 * practice:
 * - A cluster containing U+FE0F (emoji presentation selector) is upright;
 *   platform emoji fonts supply upright color glyphs and rotating them is
 *   never correct.
 * - Extended_Pictographic bases are upright even where the table defaults
 *   them to R (for example U+2764 or U+231A, which the data file omits):
 *   browsers present them upright through the color emoji font.
 *
 * U+FE00/U+FE01 (vertical/horizontal presentation selectors) switch the
 * orientation of Tu/Tr bases, which are exactly the characters with
 * typographic vertical forms.
 */
export function verticalOrientationForCluster(
  cluster: string,
  orientation: TextOrientation = 'mixed',
): VerticalGlyphOrientation {
  if (orientation === 'upright') return 'upright';
  if (orientation === 'sideways') return 'sideways';
  if (cluster.length === 0) return 'upright';
  if (cluster.includes('\u{FE0F}')) return 'upright';

  const base = cluster.replace(/^\p{M}+/u, '');
  if (base.length === 0) return 'upright';
  const first = base.codePointAt(0)!;
  if (/\p{Extended_Pictographic}/u.test(String.fromCodePoint(first))) {
    return 'upright';
  }

  const value = verticalOrientationOfCodePoint(first);
  if (value === undefined) return 'sideways';
  if (value === ORIENTATION_TRANSFORMED_UPRIGHT || value === ORIENTATION_TRANSFORMED_ROTATED) {
    if (base.includes('\u{FE00}')) return 'upright';
    if (base.includes('\u{FE01}')) return 'sideways';
  }
  return value === ORIENTATION_UPRIGHT || value === ORIENTATION_TRANSFORMED_UPRIGHT
    ? 'upright'
    : 'sideways';
}
