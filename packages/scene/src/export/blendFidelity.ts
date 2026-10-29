/**
 * Blend-mode fidelity for export targets.
 *
 * `packages/engine/src/blendModeCatalog.ts` already declares the interoperable
 * PDF name of every blend mode this product exposes (`BlendModeDefinition.pdf`).
 * This module turns that single declaration into the two answers an exporter
 * needs — "can this target write the mode?" and "which objects would come out
 * compositing differently from the canvas?" — so the writer, the preflight, and
 * the export entry points cannot disagree about it.
 *
 * Why this exists: the PDF/X writers never read a node's `blendMode`, so a
 * document that composited with `multiply` on screen exported as plain art
 * while the catalog reported the format as handling blend modes. A mode that
 * cannot be written has to be *reported* against the objects that use it, never
 * quietly replaced with `Normal`.
 */

import { blendModeDefinition } from '@varve/engine';
import type { FeatureSupportLevel } from './capabilities';

/**
 * The structural slice of a node this module reads.
 *
 * Deliberately not the document node type: the same rule has to run over
 * document nodes (preflight) and over flattened engine nodes (the encoders),
 * and both carry a string id, a name, a `blendMode` and stacked `fills`.
 */
export interface BlendFidelityNode {
  id: string;
  name?: string;
  blendMode?: string;
  fills?: readonly { visible?: boolean; blendMode?: string }[] | undefined;
}

/** A node whose paint the target cannot reproduce faithfully. */
export interface UnrepresentedBlend {
  nodeId: string;
  /** Authored node name, so a message can point at the object. */
  nodeName: string;
  /** Product label of the offending mode (e.g. "Plus Lighter"). */
  modeLabel: string;
  /** Where the mode is applied. */
  scope: 'object' | 'fill';
}

/**
 * True when `target` can reproduce `mode`.
 *
 * - `Normal` is what a page paints by default, and `passThrough` is a group
 *   policy whose node-level effect is also `Normal`.
 * - `native` means the writer carries the mode itself, which it can only do
 *   when the catalog names a PDF equivalent.
 * - `flatten` and `rasterized` mean the path preserves the appearance by
 *   rasterizing the affected subtree, so any mode survives.
 * - `blocked` means the target cannot carry the mode and nothing compensates.
 */
export function isBlendModeRepresentable(mode: string, target: FeatureSupportLevel): boolean {
  if (mode === 'normal' || mode === 'passThrough') return true;
  if (target === 'blocked') return false;
  if (target === 'native') return blendModeDefinition(mode)?.pdf != null;
  return true;
}

/** Nodes using a blend mode that the target cannot reproduce. */
export function findUnrepresentedBlends(
  nodes: readonly BlendFidelityNode[],
  target: FeatureSupportLevel,
): UnrepresentedBlend[] {
  const found: UnrepresentedBlend[] = [];
  for (const node of nodes) {
    const nodeName = node.name ?? node.id;
    if (node.blendMode && !isBlendModeRepresentable(node.blendMode, target)) {
      found.push({
        nodeId: node.id,
        nodeName,
        modeLabel: blendModeDefinition(node.blendMode)?.label ?? node.blendMode,
        scope: 'object',
      });
    }
    for (const fill of node.fills ?? []) {
      if (fill.visible === false || !fill.blendMode) continue;
      if (isBlendModeRepresentable(fill.blendMode, target)) continue;
      found.push({
        nodeId: node.id,
        nodeName,
        modeLabel: blendModeDefinition(fill.blendMode)?.label ?? fill.blendMode,
        scope: 'fill',
      });
    }
  }
  return found;
}

/**
 * A message naming the objects that block a faithful export, or `null` when
 * nothing does.
 *
 * Kept as one function so every entry point that has to refuse an export gives
 * the same explanation: which objects, which modes, and what to do instead.
 */
export function describeUnrepresentedBlends(
  nodes: readonly BlendFidelityNode[],
  target: FeatureSupportLevel,
  options: { formatLabel: string; alternative: string },
): string | null {
  const found = findUnrepresentedBlends(nodes, target);
  if (found.length === 0) return null;
  const names = [...new Set(found.map((entry) => entry.nodeName))];
  const shown = names.slice(0, 3).join(', ');
  const rest = names.length > 3 ? ` and ${names.length - 3} more` : '';
  const modes = [...new Set(found.map((entry) => entry.modeLabel))].join(', ');
  return (
    `${options.formatLabel} cannot carry the blend mode${found.length === 1 ? '' : 's'} used here: ` +
    `${modes} on ${shown}${rest}. Exporting would print those objects as if they were Normal, ` +
    `which is not what the canvas shows. ${options.alternative}`
  );
}
