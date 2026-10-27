/**
 * The nine bounded preview windows, named exactly the way they are shown.
 *
 * Shared by the dialog, which describes the region currently previewed, and the
 * preview panel, which offers the choices — so the menu and the caption can
 * never drift into spelling the same region two ways.
 *
 * Keys are `${x},${y}` using the fractional source-relative focus values the
 * pipeline already consumes: 0/0.5/1 on each axis.
 */

export const REGION_NAMES: Record<string, string> = {
  '0,0': 'Top left',
  '0.5,0': 'Top center',
  '1,0': 'Top right',
  '0,0.5': 'Middle left',
  '0.5,0.5': 'Center',
  '1,0.5': 'Middle right',
  '0,1': 'Bottom left',
  '0.5,1': 'Bottom center',
  '1,1': 'Bottom right',
};

export function regionKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** The choices, in reading order, for the region `Select`. */
export function regionOptions(): { value: string; label: string }[] {
  return Object.entries(REGION_NAMES).map(([value, label]) => ({ value, label }));
}

/**
 * What the preview currently shows, in the source's own pixels.
 *
 * When the crop already covers the entire source the region choice is doing
 * nothing, so say that rather than printing two identical dimensions. `x` is
 * used rather than a multiplication sign because the emoji/icon audit bans
 * that glyph in rendered strings, and it matches the `952x1696px` output
 * readout elsewhere in this dialog.
 */
export function describeInspectRegion(
  region: { width: number; height: number },
  sourceWidth: number,
  sourceHeight: number,
  focus: { x: number; y: number },
): string {
  const coversWhole =
    region.width >= Math.max(1, sourceWidth) && region.height >= Math.max(1, sourceHeight);
  if (coversWhole) return `Whole image · ${sourceWidth} x ${sourceHeight} px`;
  const name = REGION_NAMES[regionKey(focus.x, focus.y)] ?? 'Selected region';
  return `${name} · ${region.width} x ${region.height} px of ${sourceWidth} x ${sourceHeight} px`;
}
