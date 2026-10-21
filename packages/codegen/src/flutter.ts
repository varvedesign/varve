/**
 * Flutter target emitter.
 *
 * Emits widget expressions (no trailing semicolons — the result is pasted
 * into a widget tree, where a stray `;` inside a children list is a syntax
 * error). Supported natively: linear/radial gradients, drop shadows,
 * image fills, and pre-rasterized fallback surfaces. Everything else is
 * disclosed by `flutterTargetGaps` rather than silently dropped.
 *
 * Research basis: Flutter Widget library (Container, Positioned, Row, Column,
 * Image.asset, BoxDecoration, LinearGradient).
 */

import type { Document as SceneDocument, SceneNode, TextNode, VariableStore } from '@varve/scene';
import { isImageShape } from '@varve/scene';
import { managedColorToRgba } from '@varve/shared';
import { adjustmentStackTargetGaps, colorToHex, computeNodePos, getChildren } from './shared';
import { resolveTokenName } from './tokens';
import type { RasterAsset, TargetGap } from './types';

export interface FlutterExportOptions {
  variableStore?: VariableStore;
  /** Pre-rasterized assets for nodes whose effects have no widget equivalent. */
  rasterAssets?: Record<string, RasterAsset>;
  /**
   * `nodeId → asset bundle path` overrides (e.g. `assets/<hash>.png`). When
   * absent, a raster asset or image fill decodes its embedded bytes via
   * `UriData`, so snippets stay self-contained.
   */
  assetPaths?: Record<string, string>;
}

function tokenToFlutterColor(tokenName: string): string {
  const field = tokenName.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\d)/, '_$1');
  return `Theme.of(context).extension<VarveTokens>()!.${field}`;
}

function colorValue(node: SceneNode, opts?: FlutterExportOptions): string {
  const tokenName = opts?.variableStore
    ? resolveTokenName(node.bindings, 'fill', opts.variableStore)
    : undefined;
  if (tokenName) return tokenToFlutterColor(tokenName);
  const hex = colorToHex(node.fill);
  return `Color(0xFF${hex.slice(1)})`;
}

function effectColor(effect: { color: SceneNode['fill']; opacity?: number }): string {
  const [r, g, b, a] = managedColorToRgba(effect.color as never);
  const alpha = (a / 255) * (effect.opacity ?? 1);
  return `Color.fromRGBO(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

function dartString(text: string): string {
  // Single-quoted Dart literal: escape the delimiters, control characters,
  // and the interpolation syntax so design text is encoded exactly once.
  return `'${text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\$/g, '\\$')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}'`;
}

/**
 * Wrap an emitted widget in Transform.rotate when the node carries a
 * non-zero `rotation` field. The canvas renderer rotates about the node
 * origin (0,0 local — the element's top-left), which is Alignment.topLeft.
 */
function rotatedChild(node: SceneNode, inner: string, depth: number): string {
  const rot = node.rotation ?? 0;
  if (rot === 0) return inner;
  const ind = '  '.repeat(depth);
  return `${ind}Transform.rotate(\n${ind}  angle: ${rot} * math.pi / 180,\n${ind}  alignment: Alignment.topLeft,\n${ind}  child: ${inner},\n${ind})`;
}

/** The pre-rasterized surface for a node, if one was composed. */
function rasterFor(node: SceneNode, opts?: FlutterExportOptions): RasterAsset | undefined {
  return opts?.rasterAssets?.[node.id];
}

/** Decoding expression for embedded image bytes (data URL → Uint8List). */
function imageBytesExpr(dataUrl: string): string {
  return `UriData.parse(${dartString(dataUrl)}).contentAsBytes()`;
}

/**
 * An Image widget for a raster fallback. The composed PNG carries the
 * effect-expansion padding (content anchored at `(left, top)`), so the
 * emitted box is the expanded size and the image fills it exactly.
 */
function emitRasterImage(node: SceneNode, depth: number, opts?: FlutterExportOptions): string {
  const asset = rasterFor(node, opts);
  if (!asset) return '';
  const pos = computeNodePos(node);
  const expansion = asset.expansion ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const width = pos.w + expansion.left + expansion.right;
  const height = pos.h + expansion.top + expansion.bottom;
  const ind = '  '.repeat(depth);
  const path = opts?.assetPaths?.[node.id];
  const imageExpr = path
    ? `Image.asset(${dartString(path)}, width: ${width}, height: ${height}, fit: BoxFit.fill)`
    : `Image.memory(${imageBytesExpr(asset.dataUrl)}, width: ${width}, height: ${height}, fit: BoxFit.fill)`;
  return `${ind}Positioned(\n${ind}  left: ${pos.x - expansion.left},\n${ind}  top: ${pos.y - expansion.top},\n${ind}  child: ${imageExpr},\n${ind})`;
}

/** BoxDecoration parameters for fills and shadows that widgets paint natively. */
function decorationLines(node: SceneNode, ind: string): string[] {
  const lines: string[] = [];
  const gradient = (node.fills ?? []).find(
    (f) => f.visible !== false && f.type === 'gradient' && f.gradient,
  );
  if (gradient?.type === 'gradient' && gradient.gradient) {
    const g = gradient.gradient;
    const visibleStops = g.stops.filter((s) => s.position >= 0 && s.position <= 1);
    if (visibleStops.length > 0) {
      const colors = visibleStops
        .map((s) => {
          const [r, gg, b, a] = managedColorToRgba(s.color);
          return `Color.fromRGBO(${r}, ${gg}, ${b}, ${(a / 255).toFixed(3)})`;
        })
        .join(', ');
      const stops = visibleStops.map((s) => s.position.toFixed(3)).join(', ');
      if (g.type === 'linear') {
        // Authored rotation 0 runs left-to-right; express it as begin/end
        // alignment on the unit square so the emitted axis matches.
        const rad = ((g.rotation ?? 0) * Math.PI) / 180;
        const beginX = (1 - Math.cos(rad)) / 2;
        const beginY = (1 - Math.sin(rad)) / 2;
        lines.push(
          `${ind}gradient: LinearGradient(\n${ind}  begin: Alignment(${beginX.toFixed(3)}, ${beginY.toFixed(3)}),\n${ind}  end: Alignment(${(1 - beginX).toFixed(3)}, ${(1 - beginY).toFixed(3)}),\n${ind}  colors: [${colors}],\n${ind}  stops: [${stops}],\n${ind}),`,
        );
      } else if (g.type === 'radial') {
        lines.push(
          `${ind}gradient: RadialGradient(\n${ind}  colors: [${colors}],\n${ind}  stops: [${stops}],\n${ind}),`,
        );
      }
      // Angular and diamond stay in flutterTargetGaps — no sweep/diamond
      // gradient exists in the widget library without a custom shader.
    }
  }

  const shadows = (node.effects ?? []).filter(
    (e): e is Extract<typeof e, { x: number }> => e.type === 'dropShadow' && e.visible !== false,
  );
  if (shadows.length > 0) {
    const boxes = shadows
      .map(
        (e) =>
          `BoxShadow(color: ${effectColor(e)}, offset: Offset(${e.x}, ${e.y}), blurRadius: ${e.blur}, spreadRadius: ${e.spread})`,
      )
      .join(', ');
    lines.push(`${ind}boxShadow: [${boxes}],`);
  }
  return lines;
}

function containerBlock(
  node: SceneNode,
  ind: string,
  extraInnerIndent: number,
  opts?: FlutterExportOptions,
): string {
  const pos = computeNodePos(node);
  const inner = '  '.repeat(extraInnerIndent);
  const decoration = decorationLines(node, `${ind}${inner}  `);
  const lines = [
    `${ind}Container(`,
    `${ind}${inner}width: ${pos.w},`,
    `${ind}${inner}height: ${pos.h},`,
    `${ind}${inner}color: ${colorValue(node, opts)},`,
    ...(decoration.length > 0
      ? [`${ind}${inner}decoration: BoxDecoration(`, ...decoration, `${ind}${inner}),`]
      : []),
    `${ind})`,
  ];
  return lines.join('\n');
}

function emitShape(node: SceneNode, depth: number, opts?: FlutterExportOptions): string {
  if (rasterFor(node, opts)) return emitRasterImage(node, depth, opts);
  const ind = '  '.repeat(depth);
  const pos = computeNodePos(node);

  const imgFill = (node.fills ?? []).find((f) => f.visible !== false && f.type === 'image');
  if (imgFill?.type === 'image' && imgFill.image) {
    const path = opts?.assetPaths?.[node.id] ?? imgFill.image.src;
    const fit =
      imgFill.image.fit === 'fit'
        ? 'BoxFit.contain'
        : imgFill.image.fit === 'stretch'
          ? 'BoxFit.fill'
          : 'BoxFit.cover';
    const imageExpr = path.startsWith('data:')
      ? `Image.memory(${imageBytesExpr(path)}, fit: ${fit})`
      : `Image.asset(${dartString(path)}, fit: ${fit})`;
    const shadowLines = decorationLines(node, `${ind}    `);
    if (shadowLines.length === 0) {
      return `${ind}Positioned(\n${ind}  left: ${pos.x},\n${ind}  top: ${pos.y},\n${ind}  child: SizedBox(\n${ind}    width: ${pos.w},\n${ind}    height: ${pos.h},\n${ind}    child: ${imageExpr},\n${ind}  ),\n${ind})`;
    }
    return `${ind}Positioned(\n${ind}  left: ${pos.x},\n${ind}  top: ${pos.y},\n${ind}  child: Container(\n${ind}    width: ${pos.w},\n${ind}    height: ${pos.h},\n${ind}    decoration: BoxDecoration(\n${shadowLines.join('\n')}\n${ind}    ),\n${ind}    child: ${imageExpr},\n${ind}  ),\n${ind})`;
  }

  return `${ind}Positioned(\n${ind}  left: ${pos.x},\n${ind}  top: ${pos.y},\n${ind}  child: ${rotatedChild(node, containerBlock(node, ind, 2, opts), depth + 1)},\n${ind})`;
}

function emitText(node: TextNode, depth: number, opts?: FlutterExportOptions): string {
  if (rasterFor(node, opts)) return emitRasterImage(node, depth, opts);
  const ind = '  '.repeat(depth);
  const text = [
    `${ind}Text(`,
    `${ind}  ${dartString(node.text ?? '')},`,
    `${ind}  style: TextStyle(`,
    `${ind}    fontSize: ${node.fontSize ?? 16},`,
    `${ind}    color: ${colorValue(node, opts)},`,
    `${ind}  ),`,
    `${ind})`,
  ].join('\n');
  return rotatedChild(node, text, depth);
}

function emitContainer(
  node: SceneNode,
  doc: SceneDocument,
  depth: number,
  opts?: FlutterExportOptions,
): string {
  if (rasterFor(node, opts)) return emitRasterImage(node, depth, opts);
  const ind = '  '.repeat(depth);
  const children = getChildren(doc, node);
  const body = children.map((child) => emitNode(child, doc, depth + 2, opts)).join(',\n');

  if (node.kind === 'frame' && node.layoutStyle) {
    const ls = node.layoutStyle;
    const widget = ls.direction === 'row' ? 'Row' : 'Column';
    const props: string[] = [];
    if (ls.gap > 0) {
      props.push(`${ind}  spacing: ${ls.gap},`);
    }
    if (ls.padding?.some((v) => v !== 0)) {
      props.push(
        `${ind}  padding: EdgeInsets.fromLTRB(${ls.padding[3]}, ${ls.padding[0]}, ${ls.padding[1]}, ${ls.padding[2]}),`,
      );
    }
    props.push(`${ind}  children: [\n${body}\n${ind}  ],`);
    return `${ind}${widget}(\n${props.join('\n')}\n${ind})`;
  }

  if (children.length === 0) {
    return containerBlock(node, ind, 0, opts);
  }

  return `${ind}Stack(\n${ind}  children: [\n${body}\n${ind}  ],\n${ind})`;
}

function emitNode(
  node: SceneNode,
  doc: SceneDocument,
  depth: number,
  opts?: FlutterExportOptions,
): string {
  if (node.kind === 'text') return emitText(node, depth, opts);
  if (node.kind === 'frame' || node.kind === 'group') {
    return emitContainer(node, doc, depth, opts);
  }
  return emitShape(node, depth, opts);
}

export function exportNodeToFlutter(
  node: SceneNode,
  doc?: SceneDocument,
  opts?: FlutterExportOptions,
): string {
  const effectiveDoc = doc ?? ({ nodes: {}, rootChildren: [] } as unknown as SceneDocument);
  return emitNode(node, effectiveDoc, 0, opts);
}

/**
 * Report features used by `node` that Flutter widgets cannot represent
 * without custom code (CustomPainter, ShaderMask, BackdropFilter, etc.).
 */
export function flutterTargetGaps(node: SceneNode, _doc: SceneDocument): TargetGap[] {
  const gaps: TargetGap[] = [...adjustmentStackTargetGaps(node)];

  if (isImageShape(node)) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'image node',
      severity: 'warning',
      fallback:
        'Image fills emit Image.memory from the embedded bytes; declare a bundled asset for production builds',
    });
  }

  if (node.kind === 'shape' && node.shape.kind !== 'rect' && node.shape.kind !== 'ellipse') {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: `non-standard shape (${node.shape.kind})`,
      severity: 'error',
      fallback: 'Use CustomPainter with Canvas.drawPath()',
    });
  }

  const fills = node.fills ?? [];
  if (
    fills.some(
      (f) =>
        f.type === 'gradient' &&
        f.gradient &&
        (f.gradient.type === 'angular' || f.gradient.type === 'diamond'),
    )
  ) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'angular/diamond gradient fill',
      severity: 'warning',
      fallback: 'Use a CustomPainter sweep gradient or compose the pre-rasterized surface',
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
      fallback: 'Use BackdropFilter(filter: ImageFilter.blur(...))',
    });
  }
  if (effects.some((e) => e.type === 'layerBlur')) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'layer blur effect',
      severity: 'warning',
      fallback: 'Use ImageFilter.blur() wrapped in a BackdropFilter widget',
    });
  }
  if (effects.some((e) => e.type === 'innerShadow' && e.visible !== false)) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'inner shadow effect',
      severity: 'warning',
      fallback: 'Compose the pre-rasterized surface; Flutter has no inset box shadow',
    });
  }

  return gaps;
}
