/**
 * CSS class-based target emitter.
 *
 * Emits one rule per node in the selected subtree. The exported root and its
 * descendants keep their authored local transforms (a child's transform is
 * relative to its parent), so moving a frame on the canvas changes only the
 * root's `left`/`top` and never the internal layout.
 *
 * Research basis: CSS Properties and Values API; CSS Syntax Module Level 3;
 * css-modules/css-modules (class-local scope).
 */

import type {
  FrameNode,
  GradientFill,
  ManagedColor,
  Document as SceneDocument,
  SceneNode,
  VariableStore,
} from '@varve/scene';
import { isImageShape } from '@varve/scene';
import { linearGradientHandles, managedColorToRgba, radialGradientHandles } from '@varve/shared';
import { canEmitAsHtml } from './flattening';
import { toCssClassName, uniqueName } from './naming';
import {
  adjustmentStackTargetGaps,
  colorToHex,
  computeNodePos,
  getChildren,
  hasAuthoredSizing,
  rgba,
  unstableImageSourceReason,
} from './shared';
import { resolveTokenName } from './tokens';
import type { RasterAsset, TargetGap } from './types';

export interface CssExportOptions {
  /** CSS class prefix. Default: node-name. */
  classPrefix?: string;
  /** Color format: 'hex' | 'rgb'. Default: 'hex'. */
  colorFormat?: 'hex' | 'rgb';
  /** Unit for dimensions. Default: 'px'. */
  unit?: 'px' | 'rem';
  /** Base font size for rem units. Default: 16. */
  baseFontSize?: number;
  /** Variable store for resolving token bindings. */
  variableStore?: VariableStore;
  /**
   * Pre-rasterized assets for nodes whose effects have no CSS equivalent.
   * When present, the node renders as a background image instead of the
   * checkerboard placeholder, and its children are not re-emitted (they are
   * already inside the raster).
   */
  rasterAssets?: Record<string, RasterAsset>;
  /**
   * `nodeId → relative path` overrides for raster assets. When a path is
   * present for a node it is emitted instead of the asset's inline data URL —
   * the file-profile of a multi-file bundle. Absent entries fall back to the
   * inline data URL (the self-contained snippet profile).
   */
  assetPaths?: Record<string, string>;
  /**
   * Include hidden (`visible: false`) nodes. Default false: hidden layers are
   * an authored decision, not a conversion failure.
   */
  includeHidden?: boolean;
}

function formatColor(c: ManagedColor, format: 'hex' | 'rgb'): string {
  return format === 'hex' ? colorToHex(c) : rgba(c);
}

/** RGBA string that always carries the color's alpha (gradient stops). */
function stopColor(c: ManagedColor): string {
  return rgba(c);
}

/** A paint whose stored alpha alone is below 1, wrapped in a color-mix. */
function withPaintOpacity(css: string, opacity: number): string {
  if (opacity >= 1) return css;
  const pct = Math.max(0, Math.min(100, opacity * 100));
  return `color-mix(in srgb, ${css} ${pct.toFixed(3)}%, transparent)`;
}

/**
 * Insert an approximate stop for each authored midpoint bias.
 *
 * CSS has no per-stop midpoint syntax; the standard approximation adds an
 * intermediate stop at the biased position with the sRGB-blended color. The
 * deviation from the renderer's interpolation-space blend is sub-pixel for
 * typical biases and is disclosed by the target gaps for exotic cases.
 */
function stopsWithMidpoints(stops: GradientFill['stops']): GradientFill['stops'] {
  const out: GradientFill['stops'] = [];
  for (let i = 0; i < stops.length; i += 1) {
    const stop = stops[i];
    if (!stop) continue;
    out.push(stop);
    const next = stops[i + 1];
    if (!next || stop.midpoint === undefined || stop.midpoint === 0.5) continue;
    const [r1, g1, b1, a1] = managedColorToRgba(stop.color);
    const [r2, g2, b2, a2] = managedColorToRgba(next.color);
    const t = stop.midpoint;
    out.push({
      position: stop.position + (next.position - stop.position) * t,
      color: {
        space: 'rgb',
        r: Math.round(r1 + (r2 - r1) * t),
        g: Math.round(g1 + (g2 - g1) * t),
        b: Math.round(b1 + (b2 - b1) * t),
        a: Math.round(a1 + (a2 - a1) * t),
      },
    });
  }
  return out;
}

/** CSS Color 4 interpolation hint for a gradient's pinned space. */
function interpolationHint(fill: GradientFill): string {
  switch (fill.interpolationSpace) {
    case 'oklab':
      return 'in oklab, ';
    case 'oklch':
      return `in oklch ${fill.hueInterpolation ?? 'shorter'} hue, `;
    case 'hsl':
      return `in hsl ${fill.hueInterpolation ?? 'shorter'} hue, `;
    case 'linear-srgb':
      return 'in srgb-linear, ';
    default:
      return '';
  }
}

function gradientStopList(fill: GradientFill): string {
  return stopsWithMidpoints(fill.stops)
    .map((s) => `${stopColor(s.color)} ${(s.position * 100).toFixed(3)}%`)
    .join(', ');
}

/**
 * Faithful CSS for a scene gradient, or null when the field has no CSS
 * representation (diamond). Geometry comes from the same canonical handles
 * the renderer uses (`@varve/shared` gradientGeometry), expressed against
 * the node's own box in px, so the emitted gradient tracks the authored
 * rotation and transform instead of a guessed angle.
 */
export function gradientToCss(fill: GradientFill, boxW: number, boxH: number): string | null {
  const hint = interpolationHint(fill);
  const stops = gradientStopList(fill);
  if (fill.stops.length === 0) return null;
  const repeating = fill.tilingMode === 'repeat' || fill.tilingMode === 'reflect';

  if (fill.type === 'linear') {
    const { start, end } = linearGradientHandles(fill, { x: 0, y: 0, w: boxW, h: boxH });
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    // CSS 0deg points up and increases clockwise; the handles are in
    // y-down screen space, so the direction vector maps as atan2(dx, -dy).
    const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const fn = repeating ? 'repeating-linear-gradient' : 'linear-gradient';
    return `${fn}(${hint}${angle.toFixed(3)}deg, ${stops})`;
  }

  if (fill.type === 'radial') {
    const { center, uAxisEnd, vAxisEnd } = radialGradientHandles(fill, {
      x: 0,
      y: 0,
      w: boxW,
      h: boxH,
    });
    const rx = Math.hypot(uAxisEnd[0] - center[0], uAxisEnd[1] - center[1]);
    const ry = Math.hypot(vAxisEnd[0] - center[0], vAxisEnd[1] - center[1]);
    const shape =
      Math.abs(rx - ry) < 0.01
        ? `circle ${rx.toFixed(3)}px`
        : `ellipse ${rx.toFixed(3)}px ${ry.toFixed(3)}px`;
    const fn = repeating ? 'repeating-radial-gradient' : 'radial-gradient';
    return `${fn}(${hint}${shape} at ${center[0].toFixed(3)}px ${center[1].toFixed(3)}px, ${stops})`;
  }

  if (fill.type === 'angular') {
    const handles = radialGradientHandles(fill, { x: 0, y: 0, w: boxW, h: boxH });
    // Canvas conic starts on the +u axis (3 o'clock, clockwise); CSS conic
    // starts at 12 o'clock — the same sweep, rotated a quarter turn.
    const ux = handles.uAxisEnd[0] - handles.center[0];
    const uy = handles.uAxisEnd[1] - handles.center[1];
    const from = (Math.atan2(uy, ux) * 180) / Math.PI + 90;
    const fn = repeating ? 'repeating-conic-gradient' : 'conic-gradient';
    return `${fn}(${hint}from ${from.toFixed(3)}deg at ${handles.center[0].toFixed(3)}px ${handles.center[1].toFixed(3)}px, ${stops})`;
  }

  // Diamond has no CSS gradient representation; the caller falls back to the
  // raster path.
  return null;
}

interface BackgroundLayer {
  image: string;
  size?: string;
  repeat?: string;
  position?: string;
}

function formatSize(px: number, unit: 'px' | 'rem', base: number): string {
  return unit === 'rem' ? `${px / base}rem` : `${px}px`;
}

function escapeCssString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n|\r|\n/g, '\\a ');
}

/** Base (unsuffixed) class name a node contributes, before uniqueness. */
export function nodeCssClassName(node: SceneNode, prefix?: string): string {
  return prefix ? `${prefix}-${toCssClassName(node.name)}` : toCssClassName(node.name);
}

function className(selector: string): string {
  return selector.startsWith('.') ? selector : `.${selector}`;
}

const BLEND_TO_CSS: Record<string, string> = {
  colorDodge: 'color-dodge',
  colorBurn: 'color-burn',
  hardLight: 'hard-light',
  softLight: 'soft-light',
  plusDarker: 'plus-darker',
  plusLighter: 'plus-lighter',
  darken: 'darken',
  lighten: 'lighten',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  difference: 'difference',
  exclusion: 'exclusion',
};

const CSS_BLEND_MODES = new Set([
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
]);

/**
 * CSS declarations for a single node, excluding its selector.
 *
 * Shared by the plain-CSS emitter and the CSS Modules emitter so the two can
 * never disagree about a node's appearance.
 */
export function cssDeclarationsForNode(
  node: SceneNode,
  doc: SceneDocument,
  opts?: CssExportOptions,
  parentLayout?: ParentLayout,
): string[] {
  const colorFmt = opts?.colorFormat ?? 'hex';
  const unit = opts?.unit ?? 'px';
  const base = opts?.baseFontSize ?? 16;
  const lines: string[] = [];
  const pos = computeNodePos(node);

  // A frame with authored auto-layout is a flow container. Its children are
  // flex/grid items, not absolutely-positioned boxes: emitting `display: flex`
  // and `position: absolute` on the same subtree silently discarded the
  // authored layout entirely. A child that is explicitly positioned
  // (`layoutPosition: 'absolute'`) keeps the absolute path, and so do
  // adjustment layers, which are filters rather than flow content.
  const isFlowItem =
    parentLayout !== undefined &&
    node.kind !== 'adjustment' &&
    (node as { layoutPosition?: string }).layoutPosition !== 'absolute';

  if (isFlowItem) {
    lines.push('position: static;');
  } else {
    lines.push('position: absolute;');
    lines.push(`left: ${formatSize(pos.x, unit, base)};`);
    lines.push(`top: ${formatSize(pos.y, unit, base)};`);
  }

  // A raster fallback replaces the node's own geometry with an image placed
  // over the same box, so the box is still emitted.
  const asset = opts?.rasterAssets?.[node.id];
  const flatten = canEmitAsHtml(node, doc);
  const needsRaster = !asset && flatten.emitAs === 'image';

  if (needsRaster) {
    lines.push('box-sizing: border-box;');
    lines.push(`/* raster fallback required: ${flatten.reasons.join(', ')} */`);
    lines.push(`background: repeating-conic-gradient(#eee 0% 25%, #fff 0% 50%) 50% / 20px 20px;`);
    lines.push(`display: flex;`);
    lines.push(`align-items: center;`);
    lines.push(`justify-content: center;`);
    lines.push(`text-align: center;`);
    lines.push(`font-size: ${formatSize(12, unit, base)};`);
    lines.push(`color: #999;`);
    lines.push(`padding: ${formatSize(8, unit, base)};`);
  }

  const paintsFill = node.kind !== 'group' && node.kind !== 'adjustment';
  // A group is a pure container: the canvas renderer replays its children and
  // paints no fill, no clip, and no box. Emitting a background rectangle and a
  // fabricated 200x160 size put pixels on screen that the design never had.
  const needsBox = node.kind !== 'text' && node.kind !== 'group';

  const widthSizing = node.layoutSizingWidth ?? node.layoutSizing;
  const heightSizing = node.layoutSizingHeight ?? node.layoutSizing;

  if (isFlowItem && parentLayout) {
    // Flow sizing: the container's gap/padding/alignment and the child's
    // authored grow/shrink decide the box, exactly as on the canvas.
    const mainIsWidth = parentLayout.direction === 'row';
    const mainSizing = mainIsWidth ? widthSizing : heightSizing;
    if (mainSizing === 'fill') {
      lines.push('flex: 1 1 0;');
      lines.push(mainIsWidth ? 'min-width: 0;' : 'min-height: 0;');
    } else if (mainSizing === 'hug') {
      lines.push('flex: 0 0 auto;');
    } else if (mainSizing === 'relative') {
      const pct = mainIsWidth
        ? (node.layoutRelativeWidth ?? 100)
        : (node.layoutRelativeHeight ?? 100);
      lines.push(`flex: 0 0 ${pct}%;`);
    } else {
      const mainSize = mainIsWidth ? pos.w : pos.h;
      lines.push(`flex: 0 0 ${formatSize(mainSize, unit, base)};`);
    }
    const crossSizing = mainIsWidth ? heightSizing : widthSizing;
    if (crossSizing === 'fill') {
      lines.push(mainIsWidth ? 'align-self: stretch;' : 'align-self: stretch;');
    } else if (crossSizing === 'hug') {
      // Content-driven on the cross axis: no explicit size.
    } else if (crossSizing === 'relative') {
      const pct = mainIsWidth
        ? (node.layoutRelativeHeight ?? 100)
        : (node.layoutRelativeWidth ?? 100);
      lines.push(mainIsWidth ? `height: ${pct}%;` : `width: ${pct}%;`);
    } else {
      lines.push(
        mainIsWidth
          ? `height: ${formatSize(pos.h, unit, base)};`
          : `width: ${formatSize(pos.w, unit, base)};`,
      );
    }
  } else if (needsBox || hasAuthoredSizing(node)) {
    lines.push(`width: ${formatSize(pos.w, unit, base)};`);
    lines.push(`height: ${formatSize(pos.h, unit, base)};`);
  }

  if (widthSizing === 'relative') {
    lines.push(`width: ${node.layoutRelativeWidth ?? 100}%;`);
  } else if (widthSizing === 'fill' && !isFlowItem) {
    lines.push('width: 100%;');
  } else if (widthSizing === 'hug' && !isFlowItem) {
    lines.push('width: max-content;');
  }
  if (heightSizing === 'relative') {
    lines.push(`height: ${node.layoutRelativeHeight ?? 100}%;`);
  } else if (heightSizing === 'fill' && !isFlowItem) {
    lines.push('height: 100%;');
  } else if (heightSizing === 'hug' && !isFlowItem) {
    lines.push('height: max-content;');
  }
  if (typeof node.minWidth === 'number')
    lines.push(`min-width: ${formatSize(node.minWidth, unit, base)};`);
  if (typeof node.maxWidth === 'number')
    lines.push(`max-width: ${formatSize(node.maxWidth, unit, base)};`);
  if (typeof node.minHeight === 'number')
    lines.push(`min-height: ${formatSize(node.minHeight, unit, base)};`);
  if (typeof node.maxHeight === 'number')
    lines.push(`max-height: ${formatSize(node.maxHeight, unit, base)};`);

  if (asset) {
    const assetUrl = opts?.assetPaths?.[node.id] ?? asset.dataUrl;
    lines.push(`background-image: url("${escapeCssString(assetUrl)}");`);
    lines.push('background-size: 100% 100%;');
    lines.push('background-repeat: no-repeat;');
  } else if (!needsRaster) {
    const tokenName = opts?.variableStore
      ? resolveTokenName(node.bindings, 'fill', opts.variableStore)
      : undefined;
    if (node.kind === 'text') {
      // A text node's fill is its glyph colour, not a box background.
      lines.push(
        tokenName ? `color: var(--${tokenName});` : `color: ${formatColor(node.fill, colorFmt)};`,
      );
    } else if (paintsFill && (node.fills?.some((f) => f.visible !== false) ?? false)) {
      // Layered fill stack. CSS background-image layers composite top-first,
      // while a fill stack paints bottom-first — so the emission walks the
      // authored stack in reverse. A topmost solid becomes a gradient layer
      // too: `background-color` would paint below every image layer and
      // silently reorder the authored stack.
      const layers: BackgroundLayer[] = [];
      for (const fill of [...(node.fills ?? [])].reverse()) {
        if (fill.visible === false) continue;
        if (fill.type === 'solid' && fill.color) {
          layers.push({
            image: withPaintOpacity(formatColor(fill.color, colorFmt), fill.opacity ?? 1),
          });
        } else if (fill.type === 'gradient' && fill.gradient) {
          const css = gradientToCss(fill.gradient, pos.w, pos.h);
          if (css) layers.push({ image: withPaintOpacity(css, fill.opacity ?? 1) });
        } else if (fill.type === 'image' && fill.image?.src) {
          layers.push({
            image: `url("${escapeCssString(fill.image.src)}")`,
            size:
              fill.image.fit === 'fill'
                ? 'cover'
                : fill.image.fit === 'fit'
                  ? 'contain'
                  : fill.image.fit === 'stretch'
                    ? '100% 100%'
                    : 'auto',
            repeat: fill.image.fit === 'tile' ? 'repeat' : 'no-repeat',
            position: 'center',
          });
        }
      }
      if (layers.length > 0) {
        lines.push(`background-image: ${layers.map((l) => l.image).join(', ')};`);
        if (layers.some((l) => l.size)) {
          lines.push(`background-size: ${layers.map((l) => l.size ?? 'auto').join(', ')};`);
          lines.push(
            `background-repeat: ${layers.map((l) => l.repeat ?? 'no-repeat').join(', ')};`,
          );
          lines.push(
            `background-position: ${layers.map((l) => l.position ?? '0% 0%').join(', ')};`,
          );
        }
      } else {
        lines.push(
          tokenName
            ? `background: var(--${tokenName});`
            : `background: ${formatColor(node.fill, colorFmt)};`,
        );
      }
    } else if (paintsFill) {
      lines.push(
        tokenName
          ? `background: var(--${tokenName});`
          : `background: ${formatColor(node.fill, colorFmt)};`,
      );
    }
  }

  if (node.kind === 'text') {
    const fontSize = node.fontSize ?? 16;
    lines.push(`font-size: ${formatSize(fontSize, unit, base)};`);
    lines.push(`font-family: ${fontStack(node.fontFamily)};`);
    if (node.fontWeight !== undefined) lines.push(`font-weight: ${node.fontWeight};`);
    if (node.fontStyle && node.fontStyle !== 'normal') lines.push(`font-style: ${node.fontStyle};`);
    if (node.lineHeight !== undefined) lines.push(`line-height: ${node.lineHeight};`);
    if (node.letterSpacing)
      lines.push(`letter-spacing: ${formatSize(node.letterSpacing, unit, base)};`);
    if (node.textAlign && node.textAlign !== 'left') lines.push(`text-align: ${node.textAlign};`);
    lines.push('white-space: pre-wrap;');
    if (node.textDecoration && node.textDecoration !== 'none') {
      lines.push(`text-decoration: ${node.textDecoration};`);
    }
    if (node.writingMode && node.writingMode !== 'horizontal-tb') {
      lines.push(`writing-mode: ${node.writingMode};`);
    }
  }

  const radius = (node as { cornerRadius?: number | [number, number, number, number] })
    .cornerRadius;
  if (radius !== undefined) {
    lines.push(
      `border-radius: ${Array.isArray(radius) ? radius.map((v) => formatSize(v, unit, base)).join(' ') : formatSize(radius, unit, base)};`,
    );
  }

  const frame = node.kind === 'frame' ? (node as FrameNode) : undefined;
  if (frame && frame.clipContent !== false) {
    lines.push('overflow: hidden;');
  }

  if (frame?.layoutStyle) {
    const l = frame.layoutStyle;
    // A frame's authored w/h is its whole box; padding is inside it. Without
    // border-box the rendered frame grew by its padding (560x56 became
    // 592x72), so every child inherited the wrong content box.
    lines.push('box-sizing: border-box;');
    if (l.mode === 'grid') {
      lines.push('display: grid;');
      if (l.gridTemplateColumns) lines.push(`grid-template-columns: ${l.gridTemplateColumns};`);
      if (l.gridTemplateRows) lines.push(`grid-template-rows: ${l.gridTemplateRows};`);
      const rowGap = l.rowGap ?? l.gap;
      const columnGap = l.columnGap ?? l.gap;
      if (rowGap !== 0) lines.push(`row-gap: ${formatSize(Math.max(0, rowGap), unit, base)};`);
      if (columnGap !== 0)
        lines.push(`column-gap: ${formatSize(Math.max(0, columnGap), unit, base)};`);
    } else {
      lines.push('display: flex;');
      const direction =
        l.direction === 'rowReverse'
          ? 'row-reverse'
          : l.direction === 'columnReverse'
            ? 'column-reverse'
            : l.direction;
      lines.push(`flex-direction: ${direction};`);
      if (l.wrap) lines.push('flex-wrap: wrap;');
      // CSS has no negative gap. Keep the authored overlap in the document and
      // emit the closest safe snapshot while targetGaps reports the loss.
      if (l.gap !== 0) lines.push(`gap: ${formatSize(Math.max(0, l.gap), unit, base)};`);
    }
    const alignItems =
      l.alignItems === 'start' ? 'flex-start' : l.alignItems === 'end' ? 'flex-end' : l.alignItems;
    if (alignItems) lines.push(`align-items: ${alignItems};`);
    const justifyContent =
      l.justifyContent === 'start'
        ? 'flex-start'
        : l.justifyContent === 'end'
          ? 'flex-end'
          : l.justifyContent === 'spaceBetween'
            ? 'space-between'
            : l.justifyContent === 'spaceAround'
              ? 'space-around'
              : l.justifyContent === 'spaceEvenly'
                ? 'space-evenly'
                : l.justifyContent;
    if (justifyContent) lines.push(`justify-content: ${justifyContent};`);
    if (l.padding) {
      const pad = l.padding;
      if (pad[0] || pad[1] || pad[2] || pad[3]) {
        lines.push(
          `padding: ${[pad[0], pad[1], pad[2], pad[3]].map((v) => formatSize(v, unit, base)).join(' ')};`,
        );
      }
    }
  }

  // Opacity and blend mode
  const rawOpacity = node.opacity ?? 1;
  if (rawOpacity < 1) lines.push(`opacity: ${rawOpacity};`);
  const blend = node.blendMode;
  if (blend && blend !== 'normal' && blend !== 'passThrough') {
    const cssBlend = BLEND_TO_CSS[blend];
    if (cssBlend && CSS_BLEND_MODES.has(cssBlend)) lines.push(`mix-blend-mode: ${cssBlend};`);
  }

  // Shadows map to box-shadow: drop shadows directly; inner shadows as the
  // `inset` variant, which follows the same border-radius geometry. Blurs are
  // native CSS filters — a layer blur composes the element and its subtree,
  // a background blur samples whatever paints behind the element.
  const shadows = (node.effects ?? [])
    .filter(
      (e): e is Extract<typeof e, { x: number }> =>
        (e.type === 'dropShadow' || e.type === 'innerShadow') && e.visible !== false,
    )
    .map((e) => {
      const [r, g, b, alpha] = managedColorToRgba(e.color);
      const color = `rgba(${r},${g},${b},${((alpha / 255) * (e.opacity ?? 1)).toFixed(3)})`;
      const box = `${formatSize(e.x, unit, base)} ${formatSize(e.y, unit, base)} ${formatSize(e.blur, unit, base)} ${formatSize(e.spread, unit, base)} ${color}`;
      return e.type === 'innerShadow' ? `inset ${box}` : box;
    });
  if (shadows.length > 0) lines.push(`box-shadow: ${shadows.join(', ')};`);

  const blurFilters: string[] = [];
  for (const e of node.effects ?? []) {
    if (e.visible === false) continue;
    if (e.type === 'layerBlur') blurFilters.push(`blur(${formatSize(e.radius, unit, base)})`);
    else if (e.type === 'backgroundBlur')
      blurFilters.push(`backdrop-blur(${formatSize(e.radius, unit, base)})`);
  }
  const layerBlur = blurFilters.filter((f) => f.startsWith('blur('));
  if (layerBlur.length > 0) lines.push(`filter: ${layerBlur.join(' ')};`);
  const backdropBlur = blurFilters.filter((f) => f.startsWith('backdrop-blur('));
  if (backdropBlur.length > 0) lines.push(`backdrop-filter: ${backdropBlur.join(' ')};`);

  return lines;
}

function fontStack(family?: string): string {
  if (!family) return "'Inter', system-ui, sans-serif";
  return `'${family.replace(/'/g, "\\'")}', system-ui, sans-serif`;
}

/** Options threadable through the recursive walk. */
interface WalkContext {
  doc: SceneDocument;
  opts?: CssExportOptions;
  used: Set<string>;
}

/** Authored auto-layout context of a parent, for sizing flow children. */
export interface ParentLayout {
  mode: 'flex' | 'grid';
  direction: 'row' | 'column';
}

function parentLayoutOf(parent: SceneNode | undefined): ParentLayout | undefined {
  if (parent?.kind !== 'frame') return undefined;
  const style = parent.layoutStyle;
  if (!style) return undefined;
  const isRow = style.direction === 'row' || style.direction === 'rowReverse';
  return { mode: style.mode, direction: isRow ? 'row' : 'column' };
}

/**
 * Emit one rule per node in the subtree rooted at `node`.
 *
 * Returns the rules in depth-first paint order (root first), paired with the
 * class name assigned to each node so callers can build the matching element
 * tree.
 */
export function collectCssRules(
  node: SceneNode,
  ctx: WalkContext,
): Array<{ node: SceneNode; className: string; declarations: string[]; children: string[] }> {
  const out: Array<{
    node: SceneNode;
    className: string;
    declarations: string[];
    children: string[];
  }> = [];

  // Reserve (without emitting) a subtree whose parent is replaced by a raster
  // image, so its class names are not reused by unrelated later nodes.
  const reserveOnly = (current: SceneNode): void => {
    if (current.visible === false && !ctx.opts?.includeHidden) return;
    uniqueName(nodeCssClassName(current, ctx.opts?.classPrefix), ctx.used);
    for (const child of getChildren(ctx.doc, current)) reserveOnly(child);
  };

  const visit = (current: SceneNode, parent?: SceneNode): string | null => {
    if (current.visible === false && !ctx.opts?.includeHidden) return null;
    const className = uniqueName(nodeCssClassName(current, ctx.opts?.classPrefix), ctx.used);
    const asset = ctx.opts?.rasterAssets?.[current.id];
    const flatten = canEmitAsHtml(current, ctx.doc);
    const parentLayout = parentLayoutOf(parent);
    const rule = {
      node: current,
      className,
      declarations: cssDeclarationsForNode(current, ctx.doc, ctx.opts, parentLayout),
      children: [] as string[],
    };
    out.push(rule);

    const kids = asset ? [] : getChildren(ctx.doc, current);
    if (kids.length > 0 && flatten.emitAs !== 'image') {
      for (const child of kids) {
        const childName = visit(child, current);
        if (childName) rule.children.push(childName);
      }
    } else {
      for (const child of kids) reserveOnly(child);
    }
    return className;
  };

  visit(node);
  return out;
}

export function exportNodeToCss(
  node: SceneNode,
  doc: SceneDocument,
  opts?: CssExportOptions,
): string {
  const rules = collectCssRules(node, { doc, opts, used: new Set<string>() });
  return rules
    .map(
      (rule) =>
        `${className(rule.className)} {\n${rule.declarations.map((d) => `  ${d}`).join('\n')}\n}`,
    )
    .join('\n\n');
}

/**
 * Report features used by `node` that plain CSS classes cannot represent.
 *
 * Checks: non-rectangular shapes (need SVG), gradient fills needing complex
 * CSS syntax, image fills requiring a URL source, blur effects, and any
 * subtree the flattening analysis marks for raster fallback.
 */
export function cssTargetGaps(node: SceneNode, _doc: SceneDocument): TargetGap[] {
  const gaps: TargetGap[] = [...adjustmentStackTargetGaps(node)];

  if (node.kind === 'frame' && node.layoutStyle && node.layoutStyle.gap < 0) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'negative stack spacing',
      severity: 'warning',
      fallback:
        'CSS gap is emitted as zero; use a resolved snapshot or explicit offsets for overlap',
    });
  }

  if (isImageShape(node)) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'image node',
      severity: 'warning',
      fallback: 'Use background-image with a URL or an <img> tag',
    });
    const src = node.fills?.find((f) => f.type === 'image' && f.image?.src)?.image?.src;
    const reason = src ? unstableImageSourceReason(src) : null;
    if (reason) {
      gaps.push({
        nodeId: node.id,
        nodeName: node.name,
        feature: 'unportable image source',
        severity: 'error',
        fallback: reason,
      });
    }
  }

  if (node.kind === 'shape' && node.shape.kind !== 'rect') {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: `non-rectangular shape (${node.shape.kind})`,
      severity: 'warning',
      fallback: 'Use clip-path or an inline SVG element',
    });
  }

  const fills = node.fills ?? [];
  if (fills.some((f) => f.type === 'gradient')) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'gradient fill',
      severity: 'warning',
      fallback: 'Use background: linear-gradient(...) or conic-gradient(...)',
    });
  }

  const effects =
    node.kind === 'shape' || node.kind === 'text' || node.kind === 'frame' || node.kind === 'group'
      ? (node.effects ?? [])
      : [];
  if (effects.some((e) => e.type === 'backgroundBlur')) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'background blur effect',
      severity: 'warning',
      fallback: 'Use backdrop-filter: blur(...) with browser prefix if needed',
    });
  }
  if (effects.some((e) => e.type === 'innerShadow')) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'inner shadow effect',
      severity: 'warning',
      fallback: 'Drop shadows map to box-shadow; inner shadows need a raster fallback',
    });
  }
  if (
    (node as { strokes?: unknown[] }).strokes?.some(
      (s) => (s as { visible?: boolean }).visible !== false,
    )
  ) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'stroke',
      severity: 'info',
      fallback: 'Emit border or outline manually; stroke alignment is not preserved',
    });
  }

  // Flattening analysis: check if node needs full raster fallback
  const emitResult = canEmitAsHtml(node, _doc);
  if (emitResult.emitAs !== 'native') {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: `complex rendering (${emitResult.reasons.join(', ')})`,
      severity: 'warning',
      fallback: 'Use a pre-rendered raster image or implement the effect in CSS/JS',
    });
  }

  return gaps;
}
