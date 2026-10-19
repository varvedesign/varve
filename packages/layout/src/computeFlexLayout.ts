/**
 * Pure-TS flex layout engine for FrameNode auto-layout.
 *
 * Supports row/column/rowReverse/columnReverse, wrap, gap, padding,
 * alignItems, justifyContent, grow/shrink, per-axis sizing (layoutSizingWidth/
 * layoutSizingHeight, falling back to the legacy unified layoutSizing), and
 * min/max constraints.
 *
 * Research basis: CSS Flexible Box Layout Module Level 1, Figma auto layout.
 */
import type { FrameNode, LayoutSizing, SceneNode } from '@varve/scene';
import {
  axisSizing,
  clampAxis,
  isFlowParticipant,
  measureNodeFootprint,
  type Size,
} from './measure';

export interface LayoutResult {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Occupied footprint used for spacing; geometry dimensions remain w/h. */
  occupiedW?: number;
  occupiedH?: number;
}

export type FlexLayoutDiagnostic =
  | 'invalid-flex-bounds'
  | 'invalid-flex-result'
  | 'main-axis-overflow';

export interface FlexLayoutResult {
  items: LayoutResult[];
  diagnostic?: FlexLayoutDiagnostic;
}

function isRow(dir: string): boolean {
  return dir === 'row' || dir === 'rowReverse';
}

function isReverse(dir: string): boolean {
  return dir === 'rowReverse' || dir === 'columnReverse';
}

/** Cross-axis sizing mode, read from the explicit per-axis field only — the
 *  legacy unified `layoutSizing` never implied cross-axis stretch, only
 *  main-axis fill, so old documents keep their original behavior. */
function explicitAxisSizing(n: SceneNode, axis: 'width' | 'height'): LayoutSizing | undefined {
  return axis === 'width' ? n.layoutSizingWidth : n.layoutSizingHeight;
}

/** Primary-axis grow weight: per-axis/legacy fill sizing, or an explicit frame-item grow factor. */
function primaryGrowWeight(child: SceneNode, primaryAxis: 'width' | 'height'): number {
  const fillGrow = axisSizing(child, primaryAxis) === 'fill' ? 1 : 0;
  const styleGrow = (child as { layoutStyle?: { grow?: number } }).layoutStyle?.grow ?? 0;
  return fillGrow || (Number.isFinite(styleGrow) && styleGrow > 0 ? styleGrow : 0);
}

function relativePercent(child: SceneNode, axis: 'width' | 'height'): number {
  const value = axis === 'width' ? child.layoutRelativeWidth : child.layoutRelativeHeight;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function isGrowParticipant(child: SceneNode, axis: 'width' | 'height'): boolean {
  // A legacy grow factor makes an item flexible even when the old unified
  // sizing field says fixed. Relative sizing remains literal and therefore
  // takes precedence over grow.
  return axisSizing(child, axis) !== 'relative' && primaryGrowWeight(child, axis) > 0;
}

function primaryMin(child: SceneNode, axis: 'width' | 'height'): number {
  const value = axis === 'width' ? child.minWidth : child.minHeight;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function primaryNatural(size: Size, row: boolean): number {
  return row ? size.w : size.h;
}

function withPrimary(size: Size, value: number, row: boolean): Size {
  return row ? { ...size, w: value } : { ...size, h: value };
}

function crossNatural(size: Size, row: boolean): number {
  return row ? size.h : size.w;
}

/** Redistribute overflow released when a shrinkable item reaches its minimum. */
function shrinkLineSizes(
  children: SceneNode[],
  sizes: Size[],
  indices: number[],
  axis: 'width' | 'height',
  row: boolean,
  available: number,
  gap: number,
): void {
  let overflow =
    indices.reduce((sum, index) => sum + primaryNatural(sizes[index]!, row), 0) +
    Math.max(0, indices.length - 1) * gap -
    available;
  if (overflow <= 0) return;

  const factors = new Map<number, number>();
  const active = new Set<number>();
  for (const index of indices) {
    const raw = (children[index] as { layoutStyle?: { shrink?: number } }).layoutStyle?.shrink;
    const factor = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, raw) : 0;
    const min = constraintsActive(children[index]!, axis) ? primaryMin(children[index]!, axis) : 0;
    if (factor > 0 && primaryNatural(sizes[index]!, row) > min) {
      factors.set(index, factor);
      active.add(index);
    }
  }

  // Each pass either finishes the remaining shrink or freezes at least one
  // item at its lower bound, so work is bounded by the line length.
  let guard = 0;
  while (overflow > 0.001 && active.size > 0 && guard++ <= indices.length) {
    const weightTotal = [...active].reduce((sum, index) => sum + factors.get(index)!, 0);
    if (weightTotal <= 0) return;
    const reductions: Array<{ index: number; amount: number; frozen: boolean }> = [];
    let released = 0;
    for (const index of active) {
      const child = children[index]!;
      const current = primaryNatural(sizes[index]!, row);
      const min = constraintsActive(child, axis) ? primaryMin(child, axis) : 0;
      const share = (overflow * factors.get(index)!) / weightTotal;
      const amount = Math.min(share, Math.max(0, current - min));
      reductions.push({ index, amount, frozen: amount + 0.001 < share });
      released += amount;
    }
    for (const reduction of reductions) {
      const size = sizes[reduction.index]!;
      sizes[reduction.index] = withPrimary(size, primaryNatural(size, row) - reduction.amount, row);
      if (reduction.frozen) active.delete(reduction.index);
    }
    overflow = Math.max(0, overflow - released);
    if (reductions.every((reduction) => !reduction.frozen)) break;
  }
}

/** Legacy nodes had no sizing field and expected min/max to clamp geometry.
 * Explicit Fixed mode is different: its authored bounds remain inactive. */
function constraintsActive(child: SceneNode, axis: 'width' | 'height'): boolean {
  const explicit = axis === 'width' ? child.layoutSizingWidth : child.layoutSizingHeight;
  const unified = child.layoutSizing;
  if (explicit !== undefined) return explicit !== 'fixed';
  if (unified !== undefined) return unified !== 'fixed';
  return true;
}

/** Resolve flexible sizes with freezing/redistribution rather than a one-shot clamp. */
function resolvePrimarySizes(
  children: SceneNode[],
  natural: Size[],
  axis: 'width' | 'height',
  available: number,
  gap: number,
  row: boolean,
): Size[] {
  const values = natural.map((size) => (row ? size.w : size.h));
  const gapTotal = Math.max(0, children.length - 1) * gap;
  const growIndices = children
    .map((child, index) => (isGrowParticipant(child, axis) ? index : -1))
    .filter((index) => index >= 0);
  const growSet = new Set(growIndices);
  const definiteTotal = children.reduce(
    (sum, child, index) =>
      sum + (growSet.has(index) || axisSizing(child, axis) === 'relative' ? 0 : values[index]!),
    0,
  );
  const relativeIndices = children
    .map((child, index) => (axisSizing(child, axis) === 'relative' ? index : -1))
    .filter((index) => index >= 0);
  const relativeBudget = Math.max(0, available - definiteTotal - gapTotal);
  for (const index of growIndices) {
    values[index] = 0;
  }
  for (const index of relativeIndices) {
    values[index] = clampAxis(
      relativeBudget * (relativePercent(children[index]!, axis) / 100),
      children[index]!,
      axis,
    );
  }

  const fillIndices = growIndices;
  const fixedAndRelative = values.reduce(
    (sum, value, index) => sum + (growSet.has(index) ? 0 : value),
    0,
  );
  let remaining = available - fixedAndRelative - gapTotal;

  // Preserve minimums even when the container cannot fit its contents.
  if (remaining < 0) {
    for (const index of fillIndices) {
      const min = axis === 'width' ? children[index]!.minWidth : children[index]!.minHeight;
      values[index] = typeof min === 'number' ? Math.max(0, min) : 0;
    }
    return values.map((value, index) => {
      const child = children[index]!;
      const resolved = constraintsActive(child, axis) ? clampAxis(value, child, axis) : value;
      return row ? { w: resolved, h: natural[index]!.h } : { w: natural[index]!.w, h: resolved };
    });
  }

  // Freeze items that hit a bound and distribute the residual among the rest.
  const unfrozen = new Set(fillIndices);
  let guard = 0;
  while (unfrozen.size > 0 && remaining >= 0 && guard++ <= children.length + 1) {
    const weightTotal = [...unfrozen].reduce(
      (sum, index) => sum + primaryGrowWeight(children[index]!, axis),
      0,
    );
    if (weightTotal <= 0) break;
    let froze = false;
    for (const index of [...unfrozen]) {
      const child = children[index]!;
      const proposed = remaining * (primaryGrowWeight(child, axis) / weightTotal);
      const clamped = clampAxis(proposed, child, axis);
      values[index] = clamped;
      const min = axis === 'width' ? child.minWidth : child.minHeight;
      const max = axis === 'width' ? child.maxWidth : child.maxHeight;
      if (
        (typeof min === 'number' && proposed < min) ||
        (typeof max === 'number' && proposed > max)
      ) {
        unfrozen.delete(index);
        remaining -= clamped;
        froze = true;
      }
    }
    if (!froze) {
      remaining = 0;
      break;
    }
  }
  if (unfrozen.size > 0 && remaining > 0) {
    const weightTotal = [...unfrozen].reduce(
      (sum, index) => sum + primaryGrowWeight(children[index]!, axis),
      0,
    );
    for (const index of unfrozen) {
      values[index] = clampAxis(
        remaining * (primaryGrowWeight(children[index]!, axis) / weightTotal),
        children[index]!,
        axis,
      );
    }
  }

  return values.map((value, index) => {
    const child = children[index]!;
    const resolved = constraintsActive(child, axis) ? clampAxis(value, child, axis) : value;
    return row ? { w: resolved, h: natural[index]!.h } : { w: natural[index]!.w, h: resolved };
  });
}

export function computeFlexLayoutDetailed(
  frame: FrameNode,
  allChildren: SceneNode[],
): FlexLayoutResult {
  const style = frame.layoutStyle;
  if (!style) return { items: [] };

  const children = allChildren.filter(isFlowParticipant);
  if (children.length === 0) return { items: [] };

  const [pt, pr, pb, pl] = style.padding;
  const row = isRow(style.direction);
  const rev = isReverse(style.direction);
  const wrap = style.wrap === true;
  const primaryGap = row ? (style.columnGap ?? style.gap) : (style.rowGap ?? style.gap);
  const crossGap = row ? (style.rowGap ?? style.gap) : (style.columnGap ?? style.gap);

  const frameW = frame.w ?? 400;
  const frameH = frame.h ?? 200;
  if (
    ![
      frameW,
      frameH,
      style.gap,
      style.columnGap ?? style.gap,
      style.rowGap ?? style.gap,
      ...style.padding,
    ].every(Number.isFinite) ||
    frameW < 0 ||
    frameH < 0 ||
    style.padding.some((value) => value < 0)
  ) {
    return { items: [], diagnostic: 'invalid-flex-bounds' };
  }
  const availW = Math.max(0, frameW - pl - pr);
  const availH = Math.max(0, frameH - pt - pb);
  const primaryAxis: 'width' | 'height' = row ? 'width' : 'height';
  const crossAxis: 'width' | 'height' = row ? 'height' : 'width';
  const avail = row ? availW : availH;
  const crossAvail = row ? availH : availW;

  // ── Measure intrinsic sizes and resolve primary-axis constraints ──
  const footprints = children.map(measureNodeFootprint);
  const naturalSizes = footprints.map((footprint) =>
    style.includeBordersInLayout === true ? footprint.occupied : footprint.geometry,
  );
  // Wrapping uses hypothetical bases, before flexible space is assigned. A
  // Fill item contributes its minimum (or zero) here, then receives its share
  // only after its line is known. Resolving Fill against the whole container
  // first makes every child appear to fit and prevents line-local allocation.
  const lines: Array<{ indices: number[]; totalSize: number }> = [];
  let currentLine: number[] = [];
  let cursor = 0;

  const order = rev
    ? [...Array(children.length).keys()].reverse()
    : [...Array(children.length).keys()];

  for (const i of order) {
    const child = children[i]!;
    const natural = naturalSizes[i]!;
    const sizing = axisSizing(child, primaryAxis);
    const itemSize =
      sizing === 'fill' || isGrowParticipant(child, primaryAxis)
        ? primaryMin(child, primaryAxis)
        : primaryNatural(natural, row);
    const itemGap = currentLine.length > 0 ? primaryGap : 0;

    if (wrap && cursor + itemGap + itemSize > avail && currentLine.length > 0) {
      lines.push({ indices: currentLine, totalSize: 0 });
      currentLine = [];
      cursor = 0;
    }

    currentLine.push(i);
    cursor += (currentLine.length > 1 ? primaryGap : 0) + itemSize;
  }
  if (currentLine.length > 0) {
    lines.push({ indices: currentLine, totalSize: 0 });
  }

  // Resolve flexible sizes independently for each final line. A wrapped line
  // gets the full available main-axis budget, as CSS flex lines do.
  const sizes = new Array<Size>(children.length);
  let hasMainAxisOverflow = false;
  for (const line of lines) {
    const lineChildren = line.indices.map((index) => children[index]!);
    const lineNatural = line.indices.map((index) => naturalSizes[index]!);
    const resolved = resolvePrimarySizes(
      lineChildren,
      lineNatural,
      primaryAxis,
      avail,
      primaryGap,
      row,
    );
    let lineTotal = 0;
    for (let offset = 0; offset < line.indices.length; offset++) {
      const index = line.indices[offset]!;
      sizes[index] = resolved[offset]!;
      lineTotal += primaryNatural(resolved[offset]!, row);
    }
    lineTotal += Math.max(0, line.indices.length - 1) * primaryGap;
    if (lineTotal > avail) {
      shrinkLineSizes(children, sizes, line.indices, primaryAxis, row, avail, primaryGap);
    }
    const finalLineTotal =
      line.indices.reduce((sum, index) => sum + primaryNatural(sizes[index]!, row), 0) +
      Math.max(0, line.indices.length - 1) * primaryGap;
    if (finalLineTotal > avail + 0.001) hasMainAxisOverflow = true;
    if (row) {
      for (let offset = 0; offset < line.indices.length; offset++) {
        const index = line.indices[offset]!;
        const child = children[index]!;
        const allocated = sizes[index]!;
        if (
          child.kind !== 'text' ||
          axisSizing(child, 'width') === 'fixed' ||
          Math.abs(allocated.w - lineNatural[offset]!.w) <= 0.001
        ) {
          continue;
        }
        const remeasured = measureNodeFootprint({ ...child, w: allocated.w });
        sizes[index] = {
          ...allocated,
          h: style.includeBordersInLayout === true ? remeasured.occupied.h : remeasured.geometry.h,
        };
      }
    }
    line.totalSize = line.indices.reduce(
      (maximum, index) => Math.max(maximum, crossNatural(sizes[index]!, row)),
      0,
    );
  }

  // ── Distribute lines along cross-axis, align items per line ─────
  const results: LayoutResult[] = [];
  const resultById = new Map<string, LayoutResult>();
  let crossCursor = row ? pt : pl;

  for (const line of lines) {
    let primaryCursor = row ? pl : pt;

    for (const i of line.indices) {
      const sz = sizes[i]!;
      const child = children[i]!;

      let cw = sz.w;
      let ch = sz.h;

      // Per-child cross-axis override: explicit layoutAlign wins; otherwise an
      // explicit cross-axis 'fill' sizing implies stretch; otherwise inherit
      // the parent's alignItems. A child whose cross-axis sizing is 'hug'
      // never stretches — hug is an authoritative "sized by my own content"
      // commitment that would otherwise fight recursively with a hugging
      // frame's own intrinsic measurement (parent stretches it, then its own
      // hug pass shrinks it back).
      const alignOverride = child.layoutAlign ?? 'inherit';
      const crossFill = explicitAxisSizing(child, crossAxis) === 'fill';
      let effectiveAlign =
        alignOverride !== 'inherit'
          ? alignOverride
          : crossFill
            ? 'stretch'
            : (style.alignItems ?? 'start');
      if (effectiveAlign === 'stretch' && axisSizing(child, crossAxis) === 'hug') {
        effectiveAlign = 'start';
      }

      if (effectiveAlign === 'stretch') {
        if (row) ch = crossAvail;
        else cw = crossAvail;
      }
      const crossValue = row ? ch : cw;
      const clampedCross = constraintsActive(child, crossAxis)
        ? clampAxis(crossValue, child, crossAxis)
        : crossValue;
      if (row) ch = clampedCross;
      else cw = clampedCross;

      let cx = row ? primaryCursor : crossCursor;
      let cy = row ? crossCursor : primaryCursor;
      if (row && effectiveAlign !== 'start') {
        if (effectiveAlign === 'center') cy = crossCursor + (crossAvail - ch) / 2;
        else if (effectiveAlign === 'end') cy = crossCursor + crossAvail - ch;
      } else if (!row && effectiveAlign !== 'start') {
        if (effectiveAlign === 'center') cx = crossCursor + (crossAvail - cw) / 2;
        else if (effectiveAlign === 'end') cx = crossCursor + crossAvail - cw;
      }

      const footprint = footprints[i]!;
      const geometryW =
        style.includeBordersInLayout === true
          ? Math.max(0, cw - (footprint.occupied.w - footprint.geometry.w))
          : cw;
      const geometryH =
        style.includeBordersInLayout === true
          ? Math.max(0, ch - (footprint.occupied.h - footprint.geometry.h))
          : ch;
      const result = {
        id: child.id,
        x: cx,
        y: cy,
        w: geometryW,
        h: geometryH,
        ...(style.includeBordersInLayout === true ? { occupiedW: cw, occupiedH: ch } : {}),
      };
      results.push(result);
      resultById.set(child.id, result);
      primaryCursor += (row ? cw : ch) + primaryGap;
    }

    crossCursor += line.totalSize + crossGap;
  }

  // ── Apply justifyContent to primary axis within each line ────
  const justify = style.justifyContent ?? 'start';
  if (justify !== 'start' && lines.length > 0) {
    for (const line of lines) {
      const lineResults = line.indices
        .map((i) => resultById.get(children[i]!.id))
        .filter((r): r is LayoutResult => Boolean(r));
      if (lineResults.length === 0) continue;

      const totalSize = lineResults.reduce(
        (s, r) => s + (row ? (r.occupiedW ?? r.w) : (r.occupiedH ?? r.h)),
        0,
      );
      const lineGaps = (lineResults.length - 1) * primaryGap;
      const free = (row ? availW : availH) - totalSize - lineGaps;

      if (free <= 0) continue;

      if (justify === 'center' || justify === 'end') {
        const offset = justify === 'center' ? free / 2 : free;
        for (const r of lineResults) {
          if (row) r.x += offset;
          else r.y += offset;
        }
        continue;
      }

      // spaceBetween / spaceAround / spaceEvenly: each item's baseline
      // position (from the sequential pass above) already includes the
      // configured `gap`, so these only add the *extra* free space per
      // boundary crossed — not item width, which is already baked in.
      let perGap: number;
      let extra: number;
      if (justify === 'spaceBetween') {
        perGap = free / Math.max(1, lineResults.length - 1);
        extra = 0;
      } else if (justify === 'spaceAround') {
        perGap = free / lineResults.length;
        extra = perGap / 2;
      } else {
        perGap = free / (lineResults.length + 1);
        extra = perGap;
      }
      for (const r of lineResults) {
        if (row) r.x += extra;
        else r.y += extra;
        extra += perGap;
      }
    }
  }

  if (
    !results.every(
      (result) =>
        [result.x, result.y, result.w, result.h].every(Number.isFinite) &&
        result.w >= 0 &&
        result.h >= 0,
    )
  ) {
    return { items: [], diagnostic: 'invalid-flex-result' };
  }
  return {
    items: results,
    ...(hasMainAxisOverflow ? { diagnostic: 'main-axis-overflow' as const } : {}),
  };
}

/** Compatibility adapter for callers that only need the resolved rectangles. */
export function computeFlexLayout(frame: FrameNode, allChildren: SceneNode[]): LayoutResult[] {
  return computeFlexLayoutDetailed(frame, allChildren).items;
}
