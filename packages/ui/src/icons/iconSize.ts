/**
 * One icon size scale for every icon family.
 *
 * Call sites used to pass ~35 different sizes (0.65em ... 2.5em, 10px ... 48px),
 * and an em size is a different pixel size in every font size, so the same glyph
 * rendered at anything from 10px to 17px depending on where it sat. The semantic
 * `sm`/`md`/`lg`/`xl` tokens were also one step off the `--icon-size-*` CSS
 * tokens (`sm` was 14px there, 16px here).
 *
 * Every icon primitive (`Icon`, `SolidIcon`, `TablerIcon`) now resolves its
 * `size` through `resolveIconSize`: a token name maps to the canonical pixel
 * size, and a legacy raw size snaps to the nearest step. Sizes above the scale
 * (illustrations, empty states) pass through unchanged.
 */
import { ICON_SIZES, type IconSize } from '../tokens/iconTokens';

export type { IconSize };
export type IconSizeInput = number | string | IconSize;

/** Snap bands, in px: an icon at or below `max` takes `size`. */
const PX_BANDS: ReadonlyArray<{ max: number; size: IconSize }> = [
  { max: 11, size: 'xs' },
  { max: 16, size: 'sm' },
  { max: 20, size: 'md' },
  { max: 28, size: 'lg' },
  { max: 36, size: 'xl' },
];

/** The same bands for an em size (relative to a ~14px text size). */
const EM_BANDS: ReadonlyArray<{ max: number; size: IconSize }> = [
  { max: 0.7, size: 'xs' },
  { max: 1.15, size: 'sm' },
  { max: 1.4, size: 'md' },
  { max: 2, size: 'lg' },
  { max: 2.75, size: 'xl' },
];

function snap(value: number, bands: typeof PX_BANDS): IconSize | null {
  for (const band of bands) if (value <= band.max) return band.size;
  return null;
}

export function isIconSizeName(value: unknown): value is IconSize {
  return typeof value === 'string' && value in ICON_SIZES;
}

/**
 * Resolve any accepted icon size to a pixel size (or, for values outside the
 * scale, the original value). `undefined` is the default inline size (`sm`).
 */
export function resolveIconSize(size: IconSizeInput | undefined): number | string {
  if (size === undefined) return ICON_SIZES.sm;
  if (isIconSizeName(size)) return ICON_SIZES[size];
  if (typeof size === 'number') {
    const step = snap(size, PX_BANDS);
    return step ? ICON_SIZES[step] : size;
  }
  const match = /^\s*(\d*\.?\d+)\s*(em|rem|px)\s*$/.exec(size);
  if (!match) return size;
  const value = Number(match[1]);
  const unit = match[2];
  const step =
    unit === 'em' ? snap(value, EM_BANDS) : snap(unit === 'rem' ? value * 16 : value, PX_BANDS);
  return step ? ICON_SIZES[step] : size;
}
