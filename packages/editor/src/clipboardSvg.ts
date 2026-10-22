/**
 * Selection → SVG for the system clipboard.
 *
 * Copy in Varve writes the editable Varve payload (`application/vnd.varve+json`)
 * plus `text/plain`. Neither is artwork to another application, so a copy into
 * Inkscape, Krita or Figma arrived as node names. Graphite's equivalent change
 * (GraphiteEditor/Graphite#4499, resolving #2373) adds an `image/svg+xml`
 * flavour beside the internal payload so the receiving app can take vectors.
 *
 * This deliberately mirrors the existing "Copy as SVG" command rather than
 * exporting a whole document: each root is serialised on its own with the
 * document exporter's `background: 'transparent'` option, its world transform
 * baked in, and the parts are wrapped in one envelope sized to their union.
 * Exporting a synthetic document instead would emit the page backdrop rectangle
 * (paste brought a white box) and drop per-node identity. When there is more
 * than one root, each part's own `<svg>` envelope is stripped and the contents
 * are grouped, exactly as the command does.
 *
 * The flavour is bounded and best-effort: a selection too large to serialise
 * cheaply simply does not get it, and the editable payload is never affected.
 */

import { exportNodeToSvg } from '@varve/codegen';
import {
  type Document,
  type NodeId,
  nodeLocalBounds,
  nodeWorldBounds,
  nodeWorldTransform,
  type SceneNode,
  walkNodes,
} from '@varve/scene';

/** Above this, building the SVG costs more than the convenience is worth. */
export const CLIPBOARD_SVG_MAX_NODES = 2000;
/** The flavour is a convenience; it must never dominate the clipboard payload. */
export const CLIPBOARD_SVG_MAX_BYTES = 2 * 1024 * 1024;

function stripSvgEnvelope(markup: string): string {
  return markup
    .replace(/^\s*<\?xml[^>]*>\s*/i, '')
    .replace(/^\s*<svg[^>]*>/i, '')
    .replace(/<\/svg>\s*$/i, '');
}

/**
 * Build the SVG representation of the given roots, or `null` when it is not
 * worth producing (no roots, too many nodes, a missing mask source, or an
 * exporter failure). Callers treat `null` as "no SVG flavour".
 */
export function buildClipboardSvg(doc: Document, rootIds: readonly NodeId[]): string | null {
  const roots = rootIds.filter((id) => Boolean(doc.nodes[id]));
  if (roots.length === 0) return null;
  try {
    const closure = walkNodes(doc, roots);
    if (closure.size === 0 || closure.size > CLIPBOARD_SVG_MAX_NODES) return null;

    // Mask sources are painted through the container that references them, so
    // they must travel with the selection even though they are not descendants.
    for (const entry of [...closure.values()]) {
      if (entry.node.kind !== 'frame' && entry.node.kind !== 'group') continue;
      const sourceId = entry.node.mask?.type === 'clip' ? entry.node.mask.sourceNodeId : undefined;
      if (!sourceId || closure.has(sourceId) || !doc.nodes[sourceId]) continue;
      for (const [sourceEntryId, sourceEntry] of walkNodes(doc, [sourceId])) {
        closure.set(sourceEntryId, sourceEntry);
      }
      if (closure.size > CLIPBOARD_SVG_MAX_NODES) return null;
    }

    const parts: string[] = [];
    let bounds: { x: number; y: number; w: number; h: number } | null = null;
    for (const id of roots) {
      const node = doc.nodes[id];
      if (!node) continue;
      // Bake the world transform: exporting the local one would place the
      // artwork at its parent's origin once it leaves this document.
      const worldNode = {
        ...node,
        transform: nodeWorldTransform(doc, id),
        rotation: 0,
      } as SceneNode;
      const markup = exportNodeToSvg(worldNode, doc, { background: 'transparent' });
      if (!markup) continue;
      parts.push(markup);
      const next = nodeWorldBounds(doc, id) ?? nodeLocalBounds(node, doc);
      if (!next) continue;
      bounds = bounds
        ? {
            x: Math.min(bounds.x, next.x),
            y: Math.min(bounds.y, next.y),
            w: Math.max(bounds.x + bounds.w, next.x + next.w) - Math.min(bounds.x, next.x),
            h: Math.max(bounds.y + bounds.h, next.y + next.h) - Math.min(bounds.y, next.y),
          }
        : { ...next };
    }
    if (parts.length === 0) return null;

    const svg =
      parts.length === 1
        ? parts[0]!
        : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${
            bounds ? `${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}` : '0 0 1 1'
          }" width="${bounds?.w ?? 1}" height="${bounds?.h ?? 1}"><g>${parts
            .map(stripSvgEnvelope)
            .join('')}</g></svg>`;
    if (!svg || new TextEncoder().encode(svg).byteLength > CLIPBOARD_SVG_MAX_BYTES) return null;
    return svg;
  } catch {
    // A convenience flavour must never break copy itself.
    return null;
  }
}
