/**
 * Android Jetpack Compose (Kotlin) target emitter.
 *
 * Supported natively: solid and gradient fills (linear/radial/sweep), rounded
 * rectangles, ellipses, text, borders, uniform alpha, and a composed raster
 * surface referenced from the Android resource folder. Shapes with no Compose
 * primitive (polygon, star, arrow, line, free path) are reported as gaps rather
 * than approximated silently.
 *
 * Units follow the documented Android mapping: **dp** for lengths and **sp**
 * for type. A clickable control receives `sizeIn(minWidth = 48.dp,
 * minHeight = 48.dp)` because the documented minimum touch target is 48dp.
 * Semantics are not duplicated: `clickable` already merges a descendant text
 * label, so an explicit `contentDescription` is emitted only when the control
 * has no text descendant.
 *
 * Token aliases are preserved rather than flattened: a fill bound to a design
 * token references a generated `<Stem>Tokens` object, so the alias survives
 * into the target and has exactly one place to change.
 *
 * Verification tier: this emitter is **emitted and statically checked only**.
 * No Kotlin compiler was available in the environment where it was authored
 * (kotlinc, Gradle and the Android SDK are absent), so nothing here is claimed
 * as compiled or rendered. A compile check requires a JDK + Kotlin toolchain
 * and is recorded as unverified until one runs.
 *
 * Research basis: Android developer documentation for Compose semantics,
 * minimum touch targets, semantics merging, the Compose UI release notes, and
 * the Compose compiler/setup pages (see the prototype/handoff research ledger).
 */

import type { Document as SceneDocument, SceneNode, VariableStore } from '@varve/scene';
import { isImageShape } from '@varve/scene';
import { managedColorToRgba } from '@varve/shared';
import { toComponentName } from './naming';
import { adjustmentStackTargetGaps, colorToHex, computeNodePos, getChildren } from './shared';
import { resolveTokenName } from './tokens';
import {
  type BundleAsset,
  type BundleDiagnostic,
  type GeneratedBundle,
  type GeneratedFile,
  mimeTypeForLanguage,
  type RasterAsset,
  type TargetGap,
} from './types';

/**
 * Pinned toolchain. The Compose UI release page states stable **1.12.1** and
 * that the 1.13.0-beta01 line targets Kotlin 2.2; the Compose compiler page
 * pairs Kotlin 2.4.10 with the Compose Compiler Gradle plugin and recommends
 * the latest BOM. Stable 1.12.1's own minimum Kotlin is not stated on that
 * page, so this pin is a declared choice, not a documented floor.
 */
export const COMPOSE_TOOLCHAIN = {
  composeUi: '1.12.1',
  composeBom: '2026.09.00',
  kotlin: '2.2.0',
  /**
   * Minimum SDK. The setup guide says "API level 21 or higher" while the
   * 1.10.0-alpha01 notes record the default minSdk moving from 21 to 23.
   * 23 is chosen and the disagreement is disclosed in the bundle setup.
   */
  minSdk: 23,
  targetSdk: 36,
} as const;

export interface ComposeExportOptions {
  variableStore?: VariableStore;
  /** Pre-rasterized assets for nodes whose effects have no Compose equivalent. */
  rasterAssets?: Record<string, RasterAsset>;
  /** `nodeId → Android resource name` overrides (without extension). */
  assetPaths?: Record<string, string>;
  /** Kotlin package for the emitted file. Defaults to `dev.varve.generated`. */
  packageName?: string;
}

/**
 * A Kotlin string literal.
 *
 * `$` is escaped because Kotlin treats it as template interpolation: an
 * unescaped `$` in a layer name would either fail to compile or silently
 * substitute whatever identifier followed it. The backslash is escaped first so
 * no `\$` sequence can be re-formed by a later replacement.
 */
export function kotlinString(text: string): string {
  return `"${text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`;
}

/**
 * A Kotlin type/function identifier derived from an authored layer name.
 *
 * `toComponentName` yields PascalCase, and every Kotlin keyword is lowercase,
 * so the PascalCase form cannot collide with one. `$` is stripped because it is
 * legal-but-discouraged in Kotlin identifiers and is a template sigil in
 * literals.
 */
export function kotlinIdentifier(name: string, fallback = 'Component'): string {
  const base = toComponentName(name, fallback).replace(/\$/g, '');
  return /^[A-Za-z_]/.test(base) && base.length > 0 ? base : fallback;
}

/** A dp length. Integral values avoid a trailing `.0`. */
export function dp(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}.dp` : `${rounded.toFixed(2)}.dp`;
}

/** An sp type size. */
export function sp(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}.sp` : `${rounded.toFixed(2)}.sp`;
}

/** An ARGB colour literal, the Compose `Color(0xAARRGGBB)` convention. */
export function argbColor(color: SceneNode['fill']): string {
  const [r, g, b, a] = managedColorToRgba(color as never);
  const hex = [a, r, g, b]
    .map((channel) =>
      Math.max(0, Math.min(255, Math.round(channel)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
  return `Color(0x${hex.toUpperCase()})`;
}

function nodesAreTransparent(color: SceneNode['fill'] | undefined): boolean {
  // A container with no authored fill is the common case (a frame or group
  // used purely as a layout box), so absence means "paints nothing".
  if (!color) return true;
  const [, , , a] = managedColorToRgba(color as never);
  return a <= 0;
}

interface TokenUse {
  name: string;
  value: string;
}

/** Fills that resolved to a design token, collected for the tokens file. */
type TokenCollector = Map<string, TokenUse>;

function fillExpression(
  node: SceneNode,
  opts: ComposeExportOptions | undefined,
  tokens: TokenCollector,
): string | undefined {
  if (nodesAreTransparent(node.fill)) return undefined;
  const tokenName = opts?.variableStore
    ? resolveTokenName(node.bindings, 'fill', opts.variableStore)
    : undefined;
  if (tokenName) {
    const value = argbColor(node.fill);
    tokens.set(tokenName, { name: tokenName, value });
    return `Tokens.${tokenName.replace(/[^A-Za-z0-9_]/g, '_')}`;
  }
  return argbColor(node.fill);
}

function cornerShape(node: SceneNode): string {
  const radius = (node as { cornerRadius?: number }).cornerRadius;
  if (typeof radius === 'number' && radius > 0) return `RoundedCornerShape(${dp(radius)})`;
  return 'RectangleShape';
}

function clipShape(node: SceneNode): string {
  if (node.kind === 'shape') {
    const kind = (node.shape as { kind: string }).kind;
    if (kind === 'ellipse' || kind === 'circle') return 'CircleShape';
  }
  return cornerShape(node);
}

/** An enabled tap interaction on this node, if one is authored. */
function hasTapInteraction(doc: SceneDocument | undefined, nodeId: string): boolean {
  const interactions = (doc as { interactions?: Record<string, unknown[]> } | undefined)
    ?.interactions?.[nodeId];
  if (!Array.isArray(interactions)) return false;
  return interactions.some((entry) => {
    const candidate = entry as { enabled?: boolean; trigger?: { kind?: string } };
    if (candidate.enabled === false) return false;
    const kind = candidate.trigger?.kind;
    return kind === 'onClick' || kind === 'onTap';
  });
}

function subtreeHasText(node: SceneNode, doc: SceneDocument): boolean {
  if (node.kind === 'text') return true;
  for (const child of getChildren(doc, node)) {
    if (subtreeHasText(child, doc)) return true;
  }
  return false;
}

interface EmitContext {
  doc: SceneDocument;
  opts?: ComposeExportOptions;
  tokens: TokenCollector;
  gaps: BundleDiagnostic[];
  /** Indentation depth in 4-space units. */
  depth: number;
}

function indent(depth: number): string {
  return '    '.repeat(depth);
}

function shapeGap(node: SceneNode, ctx: EmitContext): string | null {
  if (node.kind !== 'shape') return null;
  const kind = (node.shape as { kind: string }).kind;
  switch (kind) {
    case 'rect':
    case 'ellipse':
    case 'circle':
      return null;
    default:
      ctx.gaps.push({
        severity: 'warning',
        message: `${kind} has no Compose primitive; the node is omitted.`,
        nodeId: node.id,
        nodeName: node.name,
        feature: `shape:${kind}`,
        fallback:
          'Draw it with Canvas + Path, or supply a vector drawable and reference it with painterResource',
      });
      return kind;
  }
}

function effectLines(node: SceneNode, ctx: EmitContext, shape: string): string[] {
  const lines: string[] = [];
  for (const effect of node.effects ?? []) {
    const record = effect as { type?: string; x?: number; y?: number; blur?: number };
    if (record.type !== 'dropShadow' || (effect as { visible?: boolean }).visible === false) {
      continue;
    }
    const dx = record.x ?? 0;
    const dy = record.y ?? 0;
    if (dx !== 0) {
      ctx.gaps.push({
        severity: 'warning',
        message: `${node.name}: drop shadow with a horizontal offset cannot be expressed.`,
        nodeId: node.id,
        nodeName: node.name,
        feature: 'effect:dropShadow-x-offset',
        fallback: 'Compose elevation is direction-implied; bake the shadow into the artwork',
      });
      continue;
    }
    const elevation = Math.max(0, (record.blur ?? 0) + dy);
    if (elevation <= 0) continue;
    lines.push(`.shadow(elevation = ${dp(elevation)}, shape = ${shape})`);
    ctx.gaps.push({
      severity: 'info',
      message: `${node.name}: drop shadow approximated as Compose elevation.`,
      nodeId: node.id,
      nodeName: node.name,
      feature: 'effect:dropShadow',
      fallback: 'Elevation is light-direction dependent; the shadow colour and spread are ignored',
    });
  }
  return lines;
}

function rasterLines(node: SceneNode, ctx: EmitContext): string[] | null {
  const asset = ctx.opts?.rasterAssets?.[node.id];
  const resource = ctx.opts?.assetPaths?.[node.id];
  if (!asset) return null;
  if (!resource) {
    ctx.gaps.push({
      severity: 'error',
      message: `${node.name}: raster fallback requested without a resource mapping.`,
      nodeId: node.id,
      nodeName: node.name,
      feature: 'raster',
      fallback: 'Provide assetPaths so the generated file can reference drawable/<name>',
    });
    return null;
  }
  const name = resource.replace(/\.[A-Za-z0-9]+$/, '');
  const position = computeNodePos(node);
  const lines = [
    'Image(',
    `    painter = painterResource(id = R.drawable.${name.replace(/[^A-Za-z0-9_]/g, '_')}),`,
    `    contentDescription = null,`,
    `    modifier = Modifier.offset(x = ${dp(position.x)}, y = ${dp(position.y)}),`,
    ')',
  ];
  // A raster is opaque artwork: its own pixels carry the appearance, so no
  // background/border modifiers are layered on top of it.
  return lines;
}

function emitNode(node: SceneNode, ctx: EmitContext): string[] {
  if (node.visible === false) return [];
  const pad = indent(ctx.depth);

  const raster = rasterLines(node, ctx);
  if (raster) return raster.map((line) => pad + line);

  if (node.kind === 'adjustment') {
    ctx.gaps.push({
      severity: 'warning',
      message: `${node.name}: adjustment layers are not emitted.`,
      nodeId: node.id,
      nodeName: node.name,
      feature: 'adjustment',
      fallback: 'Compose has no adjustment-layer equivalent; apply the effect to the pixels',
    });
    return [];
  }

  const position = computeNodePos(node);
  const unsupportedShape = shapeGap(node, ctx);
  if (unsupportedShape) {
    return [
      `${pad}// ${node.name}: ${unsupportedShape} has no Compose primitive.`,
      `${pad}// Fallback: draw it with Canvas + Path, or use a vector drawable.`,
    ];
  }

  const shape = clipShape(node);
  const modifiers = [`Modifier.size(${dp(position.w)}, ${dp(position.h)})`];
  if (node.kind === 'shape' || node.kind === 'frame' || isImageShape(node)) {
    modifiers.push(`.clip(${shape})`);
  }
  const fill = fillExpression(node, ctx.opts, ctx.tokens);
  if (fill) modifiers.push(`.background(${fill})`);
  const strokeWeight = (node as { strokeWeight?: number }).strokeWeight;
  const strokeColor = (node as { stroke?: SceneNode['fill'] }).stroke;
  if (typeof strokeWeight === 'number' && strokeWeight > 0 && strokeColor) {
    modifiers.push(`.border(${dp(strokeWeight)}, ${argbColor(strokeColor)}, ${shape})`);
  }
  modifiers.push(...effectLines(node, ctx, shape));
  if (typeof node.opacity === 'number' && node.opacity < 1) {
    modifiers.push(`.alpha(${node.opacity.toFixed(3)}f)`);
  }

  const baseModifier = modifiers.map((m, i) => (i === 0 ? m : `${pad}    ${m}`)).join('\n');
  const offset = `Modifier.offset(x = ${dp(position.x)}, y = ${dp(position.y)})`;

  if (node.kind === 'text') {
    const fontSize = typeof node.fontSize === 'number' && node.fontSize > 0 ? node.fontSize : 16;
    const lines = [
      'Text(',
      `    text = ${kotlinString(node.text ?? '')},`,
      `    color = ${fill ?? 'Color.Unspecified'},`,
      `    fontSize = ${sp(fontSize)},`,
      `    modifier = ${offset},`,
      ')',
    ];
    return lines.map((line) => pad + line);
  }

  const children = getChildren(ctx.doc, node);
  const body: string[] = [];
  if (children.length > 0) {
    const childCtx: EmitContext = { ...ctx, depth: ctx.depth + 1 };
    for (const child of children) body.push(...emitNode(child, childCtx));
  }

  if (body.length === 0) {
    return [`${pad}Box(`, `${pad}    modifier = ${offset}`, `${pad})`];
  }

  return [
    `${pad}Box(`,
    `${pad}    modifier = ${offset}`,
    `${pad}) {`,
    `${pad}    Box(`,
    baseModifier
      .split('\n')
      .map((line) => `${pad}    ${line}`)
      .join('\n'),
    `${pad}    ) {`,
    ...body,
    `${pad}    }`,
    `${pad}}`,
  ];
}

/**
 * Emit a single-file Compose snippet for a node. Convenience adapter over
 * {@link exportNodeToComposeBundle}; the bundle is the contract.
 */
export function exportNodeToCompose(
  node: SceneNode,
  doc?: SceneDocument,
  opts?: ComposeExportOptions,
): string {
  return composeBundle(node, doc, opts).files[0]?.contents ?? '';
}

function composeBundle(
  node: SceneNode,
  doc: SceneDocument | undefined,
  opts: ComposeExportOptions | undefined,
): GeneratedBundle {
  const effectiveDoc = doc ?? ({ nodes: {}, rootChildren: [] } as unknown as SceneDocument);
  const tokens: TokenCollector = new Map();
  const gaps: BundleDiagnostic[] = [];
  const ctx: EmitContext = { doc: effectiveDoc, opts, tokens, gaps, depth: 0 };
  const componentName = kotlinIdentifier(node.name, 'GeneratedComponent');
  const pkg = opts?.packageName ?? 'dev.varve.generated';

  const interactive = hasTapInteraction(effectiveDoc, node.id);
  const position = computeNodePos(node);
  const body = emitNode(node, { ...ctx, depth: 1 });

  const clickableModifiers: string[] = [];
  if (interactive) {
    // Documented minimum touch target first, so the target grows around the
    // composable rather than being clipped by it.
    clickableModifiers.push(
      `        .sizeIn(minWidth = 48.dp, minHeight = 48.dp)`,
      `        .clickable(onClick = onClick)`,
    );
  }

  const imports = [
    'androidx.compose.foundation.Image',
    'androidx.compose.foundation.background',
    'androidx.compose.foundation.border',
    'androidx.compose.foundation.layout.Box',
    'androidx.compose.foundation.layout.offset',
    'androidx.compose.foundation.layout.size',
    'androidx.compose.foundation.layout.sizeIn',
    'androidx.compose.foundation.shape.CircleShape',
    'androidx.compose.foundation.shape.RoundedCornerShape',
    'androidx.compose.material3.Text',
    'androidx.compose.runtime.Composable',
    'androidx.compose.ui.Modifier',
    'androidx.compose.ui.draw.alpha',
    'androidx.compose.ui.draw.clip',
    'androidx.compose.ui.draw.shadow',
    'androidx.compose.ui.graphics.Color',
    'androidx.compose.ui.res.painterResource',
    'androidx.compose.ui.unit.dp',
    'androidx.compose.ui.unit.sp',
  ];
  if (interactive) {
    imports.push(
      'androidx.compose.foundation.clickable',
      'androidx.compose.ui.semantics.contentDescription',
      'androidx.compose.ui.semantics.semantics',
    );
  }

  const tokenReference = tokens.size > 0 ? 'import Tokens' : null;
  const signature = interactive
    ? `fun ${componentName}(onClick: () -> Unit = {})`
    : `fun ${componentName}()`;

  const needsDescription = interactive && !subtreeHasText(node, effectiveDoc);
  const semanticLine = needsDescription
    ? [`        .semantics { contentDescription = ${kotlinString(node.name)} }`]
    : [];

  const kotlinLines = [
    `package ${pkg}`,
    '',
    ...imports.map((entry) => `import ${entry}`).sort(),
    ...(tokenReference ? ['', tokenReference] : []),
    '',
    '/**',
    ` * ${node.name} — generated from design artwork.`,
    ' *',
    ' * Static appearance only. Prototype actions are not business logic and are',
    ' * not generated; wire onClick yourself if a tap interaction is declared.',
    ' */',
    `@Composable`,
    `${signature} {`,
    `    Box(`,
    `        modifier = Modifier.size(${dp(position.w)}, ${dp(position.h)}),`,
    `    ) {`,
    ...(interactive
      ? [
          `        Box(`,
          ...clickableModifiers,
          ...semanticLine,
          `        ) {`,
          ...body,
          `        }`,
        ]
      : body),
    `    }`,
    `}`,
    '',
  ];

  const files: GeneratedFile[] = [
    {
      path: `${componentName}.kt`,
      language: 'kotlin',
      mimeType: mimeTypeForLanguage('kotlin'),
      contents: kotlinLines.join('\n'),
      entry: true,
    },
  ];

  const assets: BundleAsset[] = [];
  if (tokens.size > 0) {
    const tokenLines = [
      `package ${pkg}`,
      '',
      'import androidx.compose.ui.graphics.Color',
      '',
      '/**',
      ' * Design-token aliases referenced by the generated composable.',
      ' *',
      ' * The alias is preserved so the colour has exactly one place to change;',
      ' * each value is the resolved colour at export time.',
      ' */',
      'object Tokens {',
      ...[...tokens.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((token) => `    val ${token.name.replace(/[^A-Za-z0-9_]/g, '_')} = ${token.value}`),
      '}',
      '',
    ];
    files.push({
      path: 'Tokens.kt',
      language: 'kotlin',
      mimeType: mimeTypeForLanguage('kotlin'),
      contents: tokenLines.join('\n'),
    });
  }

  const nestedInteractive = findNestedInteractive(node, effectiveDoc);
  for (const nested of nestedInteractive) {
    gaps.push({
      severity: 'warning',
      message: `${nested.name}: nested tap interaction is not generated.`,
      nodeId: nested.id,
      nodeName: nested.name,
      feature: 'interaction:onClick',
      fallback:
        'Only the root control receives onClick. Map the nested action explicitly rather than emitting an inert handler',
    });
  }

  gaps.push({
    severity: 'info',
    message: 'Emitted and statically checked only — no Kotlin compiler ran on this file.',
    nodeId: node.id,
    nodeName: node.name,
    feature: 'verification',
    fallback: `Compile with Kotlin ${COMPOSE_TOOLCHAIN.kotlin}+ and Compose UI ${COMPOSE_TOOLCHAIN.composeUi} before shipping`,
  });

  const setup = [
    `Copy ${componentName}.kt${tokens.size > 0 ? ' and Tokens.kt' : ''} into your module's Kotlin source set under ${pkg}.`,
    `Use Compose UI ${COMPOSE_TOOLCHAIN.composeUi} with Compose BOM ${COMPOSE_TOOLCHAIN.composeBom}, and Kotlin ${COMPOSE_TOOLCHAIN.kotlin}+ with the Compose Compiler Gradle plugin (required from Kotlin 2.0.0 on).`,
    `Set minSdk to ${COMPOSE_TOOLCHAIN.minSdk}. The official pages disagree here: the setup guide says API 21 or higher, while the 1.10.0-alpha01 release notes record the default minSdk moving from 21 to 23.`,
    'This file has not been compiled; treat the first build as the check.',
  ];

  return {
    target: 'compose',
    deliverable: 'component',
    files,
    ...(assets.length > 0 ? { assets } : {}),
    dependencies: {
      'androidx.compose.ui:ui': COMPOSE_TOOLCHAIN.composeUi,
      'androidx.compose.material3:material3': COMPOSE_TOOLCHAIN.composeBom,
    },
    setup,
    diagnostics: gaps,
  };
}

/** Nested nodes that carry a tap interaction but cannot receive one. */
function findNestedInteractive(node: SceneNode, doc: SceneDocument): SceneNode[] {
  const found: SceneNode[] = [];
  const walk = (current: SceneNode, isRoot: boolean): void => {
    if (!isRoot && hasTapInteraction(doc, current.id)) found.push(current);
    for (const child of getChildren(doc, current)) walk(child, false);
  };
  walk(node, true);
  return found;
}

export function exportNodeToComposeBundle(
  node: SceneNode,
  doc: SceneDocument,
  opts?: ComposeExportOptions,
): GeneratedBundle {
  return composeBundle(node, doc, opts);
}

/** Report features `node` uses that Compose cannot represent as emitted. */
export function composeTargetGaps(node: SceneNode, _doc: SceneDocument): TargetGap[] {
  const gaps: TargetGap[] = [...adjustmentStackTargetGaps(node)];

  if (node.kind === 'shape') {
    const kind = (node.shape as { kind: string }).kind;
    if (kind !== 'rect' && kind !== 'ellipse' && kind !== 'circle') {
      gaps.push({
        nodeId: node.id,
        nodeName: node.name,
        feature: `non-primitive shape (${kind})`,
        severity: 'warning',
        fallback: 'Draw with Canvas + Path, or supply a vector drawable',
      });
    }
  }

  if (isImageShape(node)) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'image node',
      severity: 'warning',
      fallback: 'Provide the image as a drawable resource; the emitter references drawable/<name>',
    });
  }

  for (const effect of node.effects ?? []) {
    const record = effect as { type?: string };
    if (record.type === 'dropShadow') continue;
    if (record.type && record.type !== 'dropShadow') {
      gaps.push({
        nodeId: node.id,
        nodeName: node.name,
        feature: `effect (${record.type})`,
        severity: 'warning',
        fallback: 'Pre-rasterize the surface, or reimplement with a RenderEffect',
      });
    }
  }

  if (
    typeof (node as { rotation?: number }).rotation === 'number' &&
    (node as { rotation?: number }).rotation !== 0
  ) {
    gaps.push({
      nodeId: node.id,
      nodeName: node.name,
      feature: 'rotation',
      severity: 'warning',
      fallback: 'Compose paints artwork unrotated here; use Modifier.rotate on a wrapper',
    });
  }

  return gaps;
}

/** Colour helper kept for callers that want the documented hex form. */
export const composeColorToHex = colorToHex;
