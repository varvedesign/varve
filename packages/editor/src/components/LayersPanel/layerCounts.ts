/**
 * Layer-count helpers for the filter bar badge ("N layers" / "M of N layers").
 *
 * Must mirror what the tree actually displays: the count walks the *same*
 * projection scope the rows do — active surface, isolation, and master
 * editing — through `resolveTreeRootIds`, excluding each surface's own
 * contentRoot group (internal plumbing, never shown as a row).
 * `Object.keys(doc.nodes).length` is NOT the right source: it spans every
 * surface in the document plus the contentRoot groups themselves.
 *
 * Sharing the root resolver is the point: when the count derived its own
 * scope it reported the whole canvas while an isolation or master-edit view
 * showed a subtree, so the header disagreed with the rows and Select matches
 * enabled against rows that were not there.
 */

import type { Document, NodeId, SceneNode } from '@varve/scene';
import { isContainer } from '@varve/scene';
import { isPublishingPageSurface } from '../../scene/activeWorkspace';
import { type LayerTreeScope, resolveTreeRootIds } from './useFlatTree';

export type { LayerTreeScope };

/**
 * Derive exactly the scope the Layers tree projects.
 *
 * One derivation shared by the panel's counts and the tree itself, so a
 * workspace's page-surface rule (Print, drawing workflow profiles) cannot
 * drift between the two consumers.
 */
export function resolveLayerTreeScope(
  doc: Document,
  workspaceMode: string,
  isolatedNodeId?: NodeId | null,
  masterEditId?: NodeId | null,
): LayerTreeScope {
  const pageSurface = isPublishingPageSurface(doc, workspaceMode);
  return {
    activePageId: pageSurface ? (doc.activePageId ?? undefined) : undefined,
    designCanvasId: pageSurface ? undefined : doc.activeDesignCanvasId,
    isolatedNodeId: isolatedNodeId ?? undefined,
    masterEditId: masterEditId ?? undefined,
  };
}

/** All node ids in the projection scope, recursively (matches tree rows). */
export function collectActiveSurfaceNodeIds(doc: Document, scope: LayerTreeScope): NodeId[] {
  const ids: NodeId[] = [];
  const queue: NodeId[] = [...resolveTreeRootIds(doc, scope)];
  const seen = new Set<NodeId>();
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor]!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = doc.nodes[id];
    if (!node) continue;
    ids.push(id);
    if (isContainer(node) && node.children.length > 0) {
      for (const child of node.children) queue.push(child);
    }
  }
  return ids;
}

/** Total layer count for the projection scope (excluding content roots). */
export function computeActiveSurfaceLayerCount(doc: Document, scope: LayerTreeScope): number {
  return collectActiveSurfaceNodeIds(doc, scope).length;
}

/** Count of projection-scope nodes matching a predicate (e.g. the layer filter). */
export function countActiveSurfaceNodesMatching(
  doc: Document,
  predicate: (node: SceneNode) => boolean,
  scope: LayerTreeScope,
): number {
  let count = 0;
  for (const id of collectActiveSurfaceNodeIds(doc, scope)) {
    const node = doc.nodes[id];
    if (node && predicate(node)) count++;
  }
  return count;
}
