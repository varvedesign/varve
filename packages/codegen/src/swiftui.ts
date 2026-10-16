/**
 * SwiftUI target emitter.
 *
 * Supported natively: linear/radial/angular gradient fills (SwiftUI has all
 * three), drop shadows, and pre-rasterized fallback surfaces. A raster
 * surface references the asset-bundle path in file mode (setup tells the
 * consumer to copy `assets/` into the target's resources); in inline mode a
 * raster cannot be expressed without UIKit, so the gap is disclosed instead
 * of emitting broken code.
 *
 * Research basis: SwiftUI View protocol (ZStack, HStack, VStack, frame,
 * foregroundColor, font, Image).
 */

import type {
  GradientFill,
  Document as SceneDocument,
  SceneNode,
  TextNode,
  VariableStore,
} from '@varve/scene';
import { isImageShape } from '@varve/scene';
import { managedColorToRgba } from '@varve/shared';
import { adjustmentStackTargetGaps, colorToHex, computeNodePos, getChildren } from './shared';
import { resolveTokenName } from './tokens';
import type { RasterAsset, TargetGap } from './types';

export interface SwiftUIExportOptions {
  variableStore?: VariableStore;
  /** Pre-rasterized assets for nodes whose effects have no view equivalent. */
  rasterAssets?: Record<string, RasterAsset>;
  /** `nodeId → bundle resource path` overrides (`assets/<hash>.png`). */
  assetPaths?: Record<string, string>;
}

function swiftString(text: string): string {
  // Escaping the backslash first is what makes everything else safe: after
  // it, no `\(` interpolation sequence can form, so parens, dollars, and
  // braces pass through as plain characters.
  return `"${text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`;
}

function colorValue(node: SceneNode, opts?: SwiftUIExportOptions): string {
  const tokenName = opts?.variableStore
    ? resolveTokenName(node.bindings, 'fill', opts.variableStore)
    : undefined;
  if (tokenName) return `Color("${tokenName}")`;
  const hex = colorToHex(node.fill).toUpperCase();
  return `Color(hex: "${hex}")`;
}

function effectColor(effect: { color: SceneNode['fill']; opacity?: number }): string {
  const [r, g, b, a] = managedColorToRgba(effect.color as never);
  const alpha = (a / 255) * (effect.opacity ?? 1);
  return `Color(red: ${(r / 255).toFixed(3)}, green: ${(g / 255).toFixed(3)}, blue: ${(b / 255).toFixed(3)}, opacity: ${alpha.toFixed(3)})`;
}

/** Gradient expression for fills SwiftUI paints natively, else undefined. */
function gradientExpr(
  fill: { type: string; gradient: GradientFill },
  boxW: number,
  boxH: number,
): string | undefined {
  const g = fill.gradient;
  const visibleStops = g.stops.filter((s) => s.position >= 0 && s.position <= 1);
  if (visibleStops.length === 0) return undefined;
  const stops = visibleStops
    .map((s) => {
      const [r, gg, b, a] = managedColorToRgba(s.color);
      return `.init(color: Color(red: ${(r / 255).toFixed(3)}, green: ${(gg / 255).toFixed(3)}, blue: ${(b / 255).toFixed(3)}, opacity: ${(a / 255).toFixed(3)}), location: ${s.position.toFixed(3)})`;
    })
    .join(', ');
  if (g.type === 'linear') {
    const rad = ((g.rotation ?? 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    // UnitPoint corners matching the authored axis direction (0 = left-to-right).
    const startX = (1 - cos) / 2;
    const startY = (1 - sin) / 2;
    return `LinearGradient(stops: [${stops}], startPoint: UnitPoint(x: ${startX.toFixed(3)}, y: ${startY.toFixed(3)}), endPoint: UnitPoint(x: ${(1 - startX).toFixed(3)}, y: ${(1 - startY).toFixed(3)}))`;
  }
  if (g.type === 'radial') {
    // The renderer's radial field spans the box diagonal from the center.
    const endRadius = Math.hypot(boxW, boxH) / 2;
    return `RadialGradient(stops: [${stops}], center: .center, startRadius: 0, endRadius: ${endRadius.toFixed(3)})`;
  }
  if (g.type === 'angular') {
    return `AngularGradient(stops: [${stops}], center: .center)`;
  }
  return undefined;
}

function rasterFor(node: SceneNode, opts?: SwiftUIExportOptions): RasterAsset | undefined {
  return opts?.rasterAssets?.[node.id];
}

/**
 * An Image view for a composed raster surface. File mode resolves the
 * bundle resource (the setup steps tell the consumer to copy the assets
 * folder into the target); inline mode cannot express raster bytes without
 * UIKit, so callers emit the gap instead.
 */
function rasterImageExpr(node: SceneNode, opts?: SwiftUIExportOptions): string | undefined {
  const asset = rasterFor(node, opts);
  if (!asset) return undefined;
  const path = opts?.assetPaths?.[node.id];
  if (!path) return undefined;
  // Resource names drop the extension — the bundle lookup convention.
  const resource = path.replace(/\.[a-zA-Z0-9]+$/, '');
  return `Image(decorative: ${swiftString(resource)}, bundle: .main)`;
}

function shadowModifiers(node: SceneNode): string {
  const shadows = (node.effects ?? []).filter(
    (e): e is Extract<typeof e, { x: number }> => e.type === 'dropShadow' && e.visible !== false,
  );
  // SwiftUI applies one .shadow per modifier; the first shadow carries the
  // radius (no spread — the gap list discloses that), the rest chain after.
  return shadows
    .map((e) => `.shadow(color: ${effectColor(e)}, radius: ${e.blur / 2}, x: ${e.x}, y: ${e.y})`)
    .join('\n  ');
}

function emitShape(node: SceneNode, depth: number, opts?: SwiftUIExportOptions): string {
  const pos = computeNodePos(node);
  const ind = '  '.repeat(depth);
  const raster = rasterFor(node, opts);
  if (raster && opts?.assetPaths?.[node.id]) {
    const expansion = raster.expansion ?? { left: 0, top: 0, right: 0, bottom: 0 };
    const width = pos.w + expansion.left + expansion.right;
    const height = pos.h + expansion.top + expansion.bottom;
    return `${ind}${rasterImageExpr(node, opts)}\n${ind}  .frame(width: ${width}, height: ${height})\n${ind}  .position(x: ${pos.x - expansion.left + width / 2}, y: ${pos.y - expansion.top + height / 2})`;
  }

  const gradientFill = (node.fills ?? []).find(
    (f) => f.visible !== false && f.type === 'gradient' && f.gradient,
  );
  const gradient =
    gradientFill?.type === 'gradient' && gradientFill.gradient
      ? gradientExpr({ type: gradientFill.type, gradient: gradientFill.gradient }, pos.w, pos.h)
      : undefined;
  const paint = gradient ?? colorValue(node, opts);
  const rounded = (node as { cornerRadius?: number }).cornerRadius;
  const shapeExpr =
    gradient !== undefined || typeof rounded === 'number'
      ? `RoundedRectangle(cornerRadius: ${typeof rounded === 'number' ? rounded : 0})\n${ind}  .fill(${paint})`
      : paint;

  const shadow = shadowModifiers(node);
  return `${ind}${shapeExpr}\n${ind}  .frame(width: ${pos.w}, height: ${pos.h})\n${ind}  .position(x: ${pos.x + pos.w / 2}, y: ${pos.y + pos.h / 2})${shadow ? `\n${ind}  ${shadow}` : ''}`;
}

/** SwiftUI Font.Weight name for a numeric CSS weight. */
function swiftFontWeight(weight: number): string {
  const names: Record<number, string> = {
    100: '.thin',
    200: '.extraLight',
    300: '.light',
    400: '.regular',
    500: '.medium',
    600: '.semibold',
    700: '.bold',
    800: '.heavy',
    900: '.black',
  };
  const clamped = Math.max(100, Math.min(900, Math.round(weight / 100) * 100));
  return names[clamped] ?? '.regular';
}

/**
 * Per-run modifiers that differ from the text node's own typography. The
 * concatenated `Text`'s trailing `.font`/`.foregroundColor` provide the
 * base; run modifiers win where present.
 */
function swiftRunModifiers(
  format: import('@varve/scene').CharacterFormat | undefined,
  node: TextNode,
): string {
  if (!format) return '';
  let mods = '';
  if (format.fontWeight !== undefined && format.fontWeight !== node.fontWeight) {
    mods += `.fontWeight(${swiftFontWeight(format.fontWeight)})`;
  }
  if (format.fontStyle === 'italic') mods += '.italic()';
  if (format.color) {
    const [r, g, b, a] = managedColorToRgba(format.color as never);
    const [nr, ng, nb, na] = managedColorToRgba(node.fill as never);
    // Identical ink is the node default; the trailing base modifier carries it.
    if (r !== nr || g !== ng || b !== nb || a !== na) {
      mods += `.foregroundColor(Color(red: ${(r / 255).toFixed(3)}, green: ${(g / 255).toFixed(3)}, blue: ${(b / 255).toFixed(3)}, opacity: ${(a / 255).toFixed(3)}))`;
    }
  }
  if (format.fontSize !== undefined && format.fontSize !== node.fontSize) {
    mods += `.font(.system(size: ${format.fontSize}))`;
  }
  if (format.textDecoration === 'underline') mods += '.underline()';
  else if (format.textDecoration === 'line-through') mods += '.strikethrough()';
  return mods;
}

function emitText(node: TextNode, depth: number, opts?: SwiftUIExportOptions): string {
  const ind = '  '.repeat(depth);
  const raster = rasterFor(node, opts);
  if (raster && opts?.assetPaths?.[node.id]) {
    const pos = computeNodePos(node);
    return `${ind}${rasterImageExpr(node, opts)}\n${ind}  .frame(width: ${pos.w}, height: ${pos.h})\n${ind}  .position(x: ${pos.x + pos.w / 2}, y: ${pos.y + pos.h / 2})`;
  }

  const paragraphs = node.richText?.paragraphs;
  if (paragraphs && paragraphs.length > 0) {
    // SwiftUI concatenates styled Text values with `+`; each run carries
    // only its deltas, and paragraph boundaries are newline parts so the
    // result is one selectable Text view.
    const parts: string[] = [];
    paragraphs.forEach((p, pIndex) => {
      if (pIndex > 0) parts.push(`Text("\\n")`);
      const runs = (p.runs ?? []).filter((run) => run.text.length > 0);
      for (const run of runs) {
        parts.push(`Text(${swiftString(run.text)})${swiftRunModifiers(run.format, node)}`);
      }
    });
    const shadow = shadowModifiers(node);
    const concatenated = parts.join(' +\n   ');
    return `${ind}(${concatenated})\n${ind}  .font(.system(size: ${node.fontSize ?? 16}))\n${ind}  .foregroundColor(${colorValue(node, opts)})${shadow ? `\n${ind}  ${shadow}` : ''}`;
  }

  const shadow = shadowModifiers(node);
  return `${ind}Text(${swiftString(node.text ?? '')})\n${ind}  .font(.system(size: ${node.fontSize ?? 16}))\n${ind}  .foregroundColor(${colorValue(node, opts)})${shadow ? `\n${ind}  ${shadow}` : ''}`;
}

function emitContainer(
  node: SceneNode,
  doc: SceneDocument,
  depth: number,
  opts?: SwiftUIExportOptions,
): string {
  if (rasterFor(node, opts) && opts?.assetPaths?.[node.id]) {
    const pos = computeNodePos(node);
    const ind = '  '.repeat(depth);
    const expansion = rasterFor(node, opts)!.expansion ?? { left: 0, top: 0, right: 0, bottom: 0 };
    const width = pos.w + expansion.left + expansion.right;
    const height = pos.h + expansion.top + expansion.bottom;
    return `${ind}${rasterImageExpr(node, opts)}\n${ind}  .frame(width: ${width}, height: ${height})\n${ind}  .position(x: ${pos.x - expansion.left + width / 2}, y: ${pos.y - expansion.top + height / 2})`;
  }
  const children = getChildren(doc, node);
  const body = children.map((child) => emitNode(child, doc, depth + 1, opts)).join('\n');

  if (node.kind === 'frame' && node.layoutStyle) {
    const ls = node.layoutStyle;
    let result = '';
    if (ls.padding?.some((v) => v !== 0)) {
      const [t, r, b, l] = ls.padding;
      result += `${'  '.repeat(depth)}.padding(EdgeInsets(top: ${t}, leading: ${l}, bottom: ${b}, trailing: ${r}))\n`;
    }
    if (ls.direction === 'row') {
      const spacing = ls.gap > 0 ? `spacing: ${ls.gap}` : '';
      result = `HStack(${spacing}) {\n${body}\n${'  '.repeat(depth)}}${result ? `\n${result}` : ''}`;
    } else {
      const spacing = ls.gap > 0 ? `spacing: ${ls.gap}` : '';
      result = `VStack(${spacing}) {\n${body}\n${'  '.repeat(depth)}}${result ? `\n${result}` : ''}`;
    }
    return `${'  '.repeat(depth)}${result}`;
  }

  if (children.length === 0) {
    const pos = computeNodePos(node);
    const color = colorValue(node, opts);
    const shadow = shadowModifiers(node);
    return `${'  '.repeat(depth)}${color}\n${'  '.repeat(depth)}  .frame(width: ${pos.w}, height: ${pos.h})${shadow ? `\n${'  '.repeat(depth)}  ${shadow}` : ''}`;
  }

  return `${'  '.repeat(depth)}ZStack {\n${body}\n${'  '.repeat(depth)}}`;
}

function emitNode(
  node: SceneNode,
  doc: SceneDocument,
  depth: number,
  opts?: SwiftUIExportOptions,
): string {
  if (node.kind === 'text') return emitText(node, depth, opts);
  if (node.kind === 'frame' || node.kind === 'group') {
    return emitContainer(node, doc, depth, opts);
  }
  return emitShape(node, depth, opts);
}

export function exportNodeToSwiftUI(
  node: SceneNode,
  doc?: SceneDocument,
  opts?: SwiftUIExportOptions,
): string {
  const effectiveDoc = doc ?? ({ nodes: {}, rootChildren: [] } as unknown as SceneDocument);
  return emitNode(node, effectiveDoc, 0, opts);
}

/**
 * Report features used by `node` that SwiftUI views cannot represent
 * without custom Path/Shape code or additional modifiers.
 */
export function swiftuiTargetGaps(node: SceneNode, _doc: SceneDocument): TargetGap[] {
  const gaps: TargetGap[] = [...adjustmentStackTargetGaps(node)];

  if (isImageShape(node)) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'image node',
      severity: 'warning',
      fallback:
        'Declare the asset folder in the target resources; image fills emit Image(decorative:bundle:)',
    });
  }

  if (node.kind === 'shape' && node.shape.kind !== 'rect' && node.shape.kind !== 'ellipse') {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: `non-standard shape (${node.shape.kind})`,
      severity: 'warning',
      fallback: 'Implement a custom Shape with a Path { path in ... } body',
    });
  }

  const fills = node.fills ?? [];
  if (fills.some((f) => f.type === 'gradient' && f.gradient && f.gradient.type === 'diamond')) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'diamond gradient fill',
      severity: 'warning',
      fallback: 'Compose the pre-rasterized surface; SwiftUI has no diamond gradient shape style',
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
      fallback: 'Use .background(.ultraThinMaterial)',
    });
  }
  if (effects.some((e) => e.type === 'layerBlur')) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'layer blur effect',
      severity: 'warning',
      fallback: 'Use .blur(radius:) — note it composites differently than a baked layer blur',
    });
  }
  if (effects.some((e) => e.type === 'innerShadow' && e.visible !== false)) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'inner shadow effect',
      severity: 'warning',
      fallback: 'Use ShapeStyle .shadow(.inner(...)) (macOS 13+/iOS 16+) or compose the surface',
    });
  }
  if (effects.some((e) => e.type === 'dropShadow' && e.visible !== false && e.spread !== 0)) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'drop shadow spread',
      severity: 'warning',
      fallback: 'SwiftUI shadows have no spread; grow the shape or compose the surface',
    });
  }

  return gaps;
}
