/** Shared authored-alpha check for targets that forbid live transparency. */
export interface PdfTransparencyNode {
  opacity?: number;
  fill?: { a?: number };
  fills?: readonly {
    visible?: boolean;
    opacity?: number;
    color?: { a?: number };
    gradient?: { stops?: readonly { color?: { a?: number } }[] };
  }[];
  strokes?: readonly { visible?: boolean; opacity?: number; color?: { a?: number } }[];
}

/** True when a node, active fill, gradient stop, or stroke uses authored alpha. */
export function hasPdfX1aTransparency(node: PdfTransparencyNode): boolean {
  const hasTransparentColor = (color?: { a?: number }) =>
    typeof color?.a === 'number' && color.a < 255;
  const activeFills = node.fills ?? [];
  const hasActiveFillAlpha = activeFills.some(
    (fill) =>
      fill.visible !== false &&
      (hasTransparentColor(fill.color) ||
        fill.gradient?.stops?.some((stop) => hasTransparentColor(stop.color)) === true),
  );
  const hasFillOpacity = activeFills.some(
    (fill) => fill.visible !== false && typeof fill.opacity === 'number' && fill.opacity < 1,
  );
  const hasStrokeAlpha = (node.strokes ?? []).some(
    (stroke) =>
      stroke.visible !== false &&
      ((typeof stroke.opacity === 'number' && stroke.opacity < 1) ||
        hasTransparentColor(stroke.color)),
  );

  return (
    (typeof node.opacity === 'number' && node.opacity < 1) ||
    hasFillOpacity ||
    hasActiveFillAlpha ||
    hasStrokeAlpha ||
    (activeFills.length === 0 && hasTransparentColor(node.fill))
  );
}
