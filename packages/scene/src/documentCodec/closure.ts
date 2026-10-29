import type { Document } from '../document';
import type { NodeId } from '../types';
import { collectClosureNodes } from './closureNodes';
import { collectClosureResources } from './closureResources';
import type { DocumentClosure } from './types';

export function collectNodeClosure(doc: Document, rootIds: NodeId[]): DocumentClosure {
  const collection = collectClosureNodes(doc, rootIds);
  return {
    nodeIds: collection.nodeIds,
    nodes: collection.nodes,
    ...collectClosureResources(doc, collection),
  };
}
