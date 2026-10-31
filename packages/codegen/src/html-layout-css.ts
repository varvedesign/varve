/** Layout-only CSS mapping for the semantic HTML emitter. */
import type { LayoutSpec } from './ir-types';

export function sizeValue(px: number, unit: string, base: number): string {
  if (unit === 'rem' && base > 0) return `${(px / base).toFixed(3)}rem`;
  return `${px}px`;
}

function flexLayoutToCss(layout: LayoutSpec, unit: string, base: number): Record<string, string> {
  const props: Record<string, string> = { display: 'flex' };
  const directions: Record<string, string> = {
    row: 'row',
    column: 'column',
    'row-reverse': 'row-reverse',
    'column-reverse': 'column-reverse',
  };
  if (layout.direction && directions[layout.direction]) {
    props['flex-direction'] = directions[layout.direction]!;
  }
  const gapH = layout.gap.left || layout.gap.right;
  const gapV = layout.gap.top || layout.gap.bottom;
  const resolvedGap = Math.max(0, gapH, gapV);
  if (resolvedGap > 0) props.gap = sizeValue(resolvedGap, unit, base);
  if (layout.wrap) props['flex-wrap'] = 'wrap';

  const alignment: Record<string, string> = {
    start: 'flex-start',
    end: 'flex-end',
    center: 'center',
    stretch: 'stretch',
  };
  if (layout.alignItems && alignment[layout.alignItems]) {
    props['align-items'] = alignment[layout.alignItems]!;
  }
  const justification: Record<string, string> = {
    ...alignment,
    'space-between': 'space-between',
    'space-around': 'space-around',
    'space-evenly': 'space-evenly',
  };
  if (layout.justifyContent && justification[layout.justifyContent]) {
    props['justify-content'] = justification[layout.justifyContent]!;
  }
  return props;
}

function gridLayoutToCss(layout: LayoutSpec, unit: string, base: number): Record<string, string> {
  const props: Record<string, string> = { display: 'grid' };
  if (layout.gridTemplateColumns) props['grid-template-columns'] = layout.gridTemplateColumns;
  if (layout.gridTemplateRows) props['grid-template-rows'] = layout.gridTemplateRows;
  const rowGap = Math.max(0, layout.gap.top, layout.gap.bottom);
  const columnGap = Math.max(0, layout.gap.left, layout.gap.right);
  if (rowGap > 0) props['row-gap'] = sizeValue(rowGap, unit, base);
  if (columnGap > 0) props['column-gap'] = sizeValue(columnGap, unit, base);
  return props;
}

function placementToCss(layout: LayoutSpec): Record<string, string> {
  const placement = layout.gridPlacement;
  if (!placement) return {};
  const props: Record<string, string> = {};
  const { column, row, columnSpan, rowSpan } = placement;
  if (column !== 'auto') {
    props['grid-column'] = columnSpan > 1 ? `${column} / span ${columnSpan}` : String(column);
  }
  if (row !== 'auto') props['grid-row'] = rowSpan > 1 ? `${row} / span ${rowSpan}` : String(row);
  return props;
}

function positioningToCss(layout: LayoutSpec, unit: string, base: number): Record<string, string> {
  const props: Record<string, string> = {};
  const pos = layout.position;
  if (pos && pos.type === 'absolute') {
    props.position = 'absolute';
    if (pos.left !== undefined) props.left = sizeValue(pos.left, unit, base);
    if (pos.top !== undefined) props.top = sizeValue(pos.top, unit, base);
    if (pos.right !== undefined) props.right = sizeValue(pos.right, unit, base);
    if (pos.bottom !== undefined) props.bottom = sizeValue(pos.bottom, unit, base);
  } else if (pos && pos.type === 'relative') {
    props.position = 'relative';
  } else if (layout.mode !== 'flex' && layout.mode !== 'grid') {
    props.position = 'relative';
  }
  return props;
}

function dimensionToCss(
  sizing: LayoutSpec['width'],
  unit: string,
  base: number,
): string | undefined {
  if (sizing.mode === 'fixed' && sizing.value > 0) return sizeValue(sizing.value, unit, base);
  if (sizing.mode === 'fill') return '100%';
  if (sizing.mode === 'percent' || sizing.mode === 'relative') return `${sizing.value}%`;
  if (sizing.mode === 'hug') return 'fit-content';
  return undefined;
}

export function layoutToCss(
  layout: LayoutSpec,
  unit: string,
  base: number,
): Record<string, string> {
  const props: Record<string, string> = {
    ...(layout.mode === 'flex' ? flexLayoutToCss(layout, unit, base) : {}),
    ...(layout.mode === 'grid' ? gridLayoutToCss(layout, unit, base) : {}),
    ...placementToCss(layout),
    ...positioningToCss(layout, unit, base),
  };
  const pad = layout.padding;
  if (pad.top || pad.right || pad.bottom || pad.left) {
    props.padding = [pad.top, pad.right, pad.bottom, pad.left]
      .map((value) => sizeValue(value, unit, base))
      .join(' ');
  }
  const width = dimensionToCss(layout.width, unit, base);
  const height = dimensionToCss(layout.height, unit, base);
  if (width) props.width = width;
  if (height) props.height = height;

  const ox = layout.overflow;
  if (ox.x !== 'visible' || ox.y !== 'visible') {
    props.overflow = ox.x === ox.y ? ox.x : `${ox.x} ${ox.y}`;
  }
  if (layout.flex) {
    const f = layout.flex;
    props.flex = `${f.grow} ${f.shrink} ${f.basis === 'auto' ? 'auto' : typeof f.basis === 'number' ? sizeValue(f.basis, unit, base) : f.basis}`;
    if (f.alignSelf) props['align-self'] = f.alignSelf;
    if (f.order && f.order !== 0) props.order = String(f.order);
  }
  return props;
}
