import {
  type Document,
  deepCloneSubtree,
  type GroupNode,
  isContainer,
  type NodeId,
  objectRepeatTransforms,
  type SceneNode,
  tableContentNodeIds,
} from '@varve/scene';
import { type Affine, multiplyAffine } from '@varve/shared';

/** Hard cap for node materialization through the explicit Expand command. */
export const MAX_OBJECT_REPEAT_EXPANDED_NODES = 50_000;

function subtreeSize(nodes: Record<NodeId, SceneNode>, rootIds: readonly NodeId[]): number {
  const visited = new Set<NodeId>();
  const visit = (id: NodeId) => {
    if (visited.has(id)) return;
    const node = nodes[id];
    if (!node) return;
    visited.add(id);
    if (isContainer(node)) node.children.forEach(visit);
    if (node.kind === 'table') tableContentNodeIds(node.table).forEach(visit);
  };
  rootIds.forEach(visit);
  return visited.size;
}

/**
 * Materialize the evaluated top-level occurrences under a repeated group.
 * Original source nodes remain first and unchanged. Each additional occurrence
 * receives an independent deep clone and a transformed root; generated nodes
 * are ordinary authored scene nodes after this operation.
 */
export function expandObjectRepeat(
  document: Document,
  groupId: NodeId,
): { document: Document; generatedRootIds: NodeId[] } {
  const group = document.nodes[groupId];
  if (group?.kind !== 'group' || !group.objectRepeat) {
    throw new Error('Select a group with a live repeat to expand.');
  }

  const transforms = objectRepeatTransforms(group.objectRepeat);
  const sourceNodeCount = subtreeSize(document.nodes, group.children);
  const projectedNodeCount = sourceNodeCount * Math.max(0, transforms.length - 1);
  if (projectedNodeCount > MAX_OBJECT_REPEAT_EXPANDED_NODES) {
    throw new Error(
      `This repeat would create ${projectedNodeCount.toLocaleString()} nodes; expand is limited to ${MAX_OBJECT_REPEAT_EXPANDED_NODES.toLocaleString()}. Reduce the repeat count or source size first.`,
    );
  }

  let nextId = document.nextId;
  const generatedNodes: Record<NodeId, SceneNode> = {};
  const generatedRootIds: NodeId[] = [];
  const generatedChildIds: NodeId[] = [];

  for (const transform of transforms.slice(1)) {
    for (const sourceId of group.children) {
      const clone = deepCloneSubtree(document.nodes, nextId, sourceId);
      const clonedRoot = clone.nodes[clone.rootId] as
        | (SceneNode & { transform?: Affine })
        | undefined;
      if (
        !clonedRoot ||
        !Array.isArray(clonedRoot.transform) ||
        clonedRoot.transform.length !== 6
      ) {
        throw new Error(
          `Cannot expand source node "${sourceId}" because it has no affine transform.`,
        );
      }
      Object.assign(generatedNodes, clone.nodes);
      generatedNodes[clone.rootId] = {
        ...clonedRoot,
        transform: multiplyAffine(transform, clonedRoot.transform),
      } as SceneNode;
      nextId = clone.nextId;
      generatedChildIds.push(clone.rootId);
      generatedRootIds.push(clone.rootId);
    }
  }

  const nodes = {
    ...document.nodes,
    ...generatedNodes,
    [groupId]: {
      ...group,
      children: [...group.children, ...generatedChildIds],
      objectRepeat: undefined,
    } as GroupNode,
  };

  return {
    document: { ...document, nodes, nextId },
    generatedRootIds,
  };
}

/** Remove a live recipe while keeping exactly its authored source artwork. */
export function releaseObjectRepeat(document: Document, groupId: NodeId): Document {
  const group = document.nodes[groupId];
  if (group?.kind !== 'group' || !group.objectRepeat) return document;
  return {
    ...document,
    nodes: { ...document.nodes, [groupId]: { ...group, objectRepeat: undefined } },
  };
}
