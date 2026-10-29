import type { Document } from '../document';
import { isContainer } from '../document';
import { tableContentNodeIds } from '../table';
import type { NodeId, SceneNode } from '../types';

export interface ClosureNodeCollection {
  nodeIds: Set<NodeId>;
  nodes: Record<NodeId, SceneNode>;
  patternDefinitionIds: Set<string>;
  pendingPatternIds: string[];
  patternDefinitions: NonNullable<Document['patternDefinitions']>;
  patternComponentIds: Set<string>;
  patternStyleIds: Set<string>;
  patternVariableIds: Set<string>;
  patternSourceNodes: SceneNode[];
}

function visitNode(doc: Document, collection: ClosureNodeCollection, id: NodeId): void {
  const { nodeIds, nodes } = collection;
  const pending = [id];
  while (pending.length > 0) {
    const currentId = pending.pop()!;
    if (nodeIds.has(currentId)) continue;
    const node = doc.nodes[currentId];
    if (!node) continue;
    nodeIds.add(currentId);
    nodes[currentId] = node;
    if (isContainer(node)) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        pending.push(node.children[index]!);
      }
    }
    // Table cell scene content is intentionally outside the table's child
    // list. It is still part of the editable closure and must travel with
    // the table without becoming an additional visible paste root.
    if (node.kind === 'table') {
      for (const contentId of tableContentNodeIds(node.table)) pending.push(contentId);
    }
  }
}

function visitFillRefs(doc: Document, collection: ClosureNodeCollection, fill: unknown): void {
  const { patternDefinitionIds, pendingPatternIds } = collection;
  if (!fill || typeof fill !== 'object') return;
  const pattern = (fill as { pattern?: { tileSrc?: unknown; definitionId?: unknown } }).pattern;
  if (
    typeof pattern?.definitionId === 'string' &&
    !patternDefinitionIds.has(pattern.definitionId)
  ) {
    patternDefinitionIds.add(pattern.definitionId);
    pendingPatternIds.push(pattern.definitionId);
  }
  if (typeof pattern?.tileSrc === 'string' && doc.nodes[pattern.tileSrc]) {
    visitNode(doc, collection, pattern.tileSrc);
  }
}

function scanNodeDependencies(doc: Document, collection: ClosureNodeCollection): void {
  const { nodeIds, nodes } = collection;
  const visit = (id: NodeId): void => visitNode(doc, collection, id);
  const visitFillReferences = (fill: unknown): void => visitFillRefs(doc, collection, fill);
  // Component masters, path-text targets, linked-story frames, masks, table
  // cell content, and interaction/motion targets are dependencies rather than
  // visible paste roots. Keep discovering those dependencies iteratively so a
  // copied fragment remains editable without turning support nodes into
  // additional top-level pastes.
  let scanned = 0;
  while (scanned < nodeIds.size) {
    const pending = [...nodeIds];
    const id = pending[scanned++];
    if (!id) continue;
    const node = nodes[id];
    if (!node) continue;
    const candidate = node as SceneNode & {
      componentId?: NodeId;
      pathId?: NodeId;
      pathTextSettings?: { pathNodeId?: NodeId };
      storyBinding?: { storyId?: NodeId };
      slots?: Record<string, NodeId>;
      propertyOverrides?: Record<string, string | boolean | NodeId>;
      mask?: {
        sourceNodeId?: NodeId;
        matteSource?: { kind?: string; nodeId?: NodeId };
        rasterMask?: { depthRecipe?: { sourceBinding?: { nodeId?: NodeId } } };
      };
      effects?: Array<{ mask?: { source?: { kind?: string; nodeId?: NodeId } } }>;
    };
    const component = candidate.componentId ? doc.components[candidate.componentId] : undefined;
    if (component) {
      visit(component.masterRootId);
      for (const slot of component.slots) {
        if (slot.defaultContentId) visit(slot.defaultContentId);
      }
      for (const property of component.properties ?? []) {
        if (typeof property.defaultValue === 'string' && doc.nodes[property.defaultValue]) {
          visit(property.defaultValue);
        }
      }
      for (const variant of component.variants ?? []) {
        for (const value of Object.values(variant.propertyValues)) {
          if (typeof value === 'string' && doc.nodes[value]) visit(value);
        }
      }
    }
    for (const childId of Object.values(candidate.slots ?? {})) visit(childId);
    for (const value of Object.values(candidate.propertyOverrides ?? {})) {
      if (typeof value === 'string') visit(value);
    }
    if (candidate.pathId) visit(candidate.pathId);
    if (candidate.pathTextSettings?.pathNodeId) visit(candidate.pathTextSettings.pathNodeId);
    if (candidate.mask?.sourceNodeId) visit(candidate.mask.sourceNodeId);
    if (candidate.mask?.matteSource?.kind === 'scene-node' && candidate.mask.matteSource.nodeId) {
      visit(candidate.mask.matteSource.nodeId);
    }
    if (candidate.mask?.rasterMask?.depthRecipe?.sourceBinding?.nodeId) {
      visit(candidate.mask.rasterMask.depthRecipe.sourceBinding.nodeId);
    }
    for (const effect of candidate.effects ?? []) {
      if (effect.mask?.source?.kind === 'scene-node' && effect.mask.source.nodeId) {
        visit(effect.mask.source.nodeId);
      }
    }
    if (candidate.kind === 'frame' && candidate.mockup) {
      for (const binding of Object.values(candidate.mockup.surfaceBindings)) {
        if (binding.mode === 'live' && binding.nodeId) visit(binding.nodeId);
      }
    }
    for (const fill of candidate.fills ?? []) visitFillReferences(fill);
    if (candidate.styleId) {
      const style = doc.styles?.[candidate.styleId];
      if (style?.type === 'color') visitFillReferences(style.fill);
      if (style?.type === 'effect') {
        for (const effect of style.effects) {
          if (effect.mask?.source.kind === 'scene-node') visit(effect.mask.source.nodeId);
        }
      }
    }
    for (const paintId of candidate.paintRefs ?? []) {
      const paint = doc.paints?.[paintId];
      if (paint) visitFillReferences(paint.fill);
    }
    const storyId = candidate.storyBinding?.storyId;
    const story = storyId ? doc.stories?.[storyId] : undefined;
    if (story) for (const frameId of story.thread) visit(frameId);

    // Interaction payloads are intentionally open-ended, but these keys are
    // the supported node-reference positions. Walking them here preserves a
    // cross-root prototype link while avoiding accidental treatment of labels
    // or arbitrary string values as node IDs.
    const visitInteractionRefs = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const entry of value) visitInteractionRefs(entry);
        return;
      }
      if (!value || typeof value !== 'object') return;
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        if (
          (childKey === 'nodeId' ||
            childKey === 'targetId' ||
            childKey === 'overlayId' ||
            childKey === 'newTargetId' ||
            childKey === 'containerId') &&
          typeof childValue === 'string'
        ) {
          visit(childValue);
        } else {
          visitInteractionRefs(childValue);
        }
      }
    };
    for (const interaction of doc.interactions?.[id] ?? []) visitInteractionRefs(interaction);

    for (const timeline of Object.values(doc.timelines ?? {})) {
      if (timeline.tracks.some((track) => track.nodeId === id)) {
        for (const track of timeline.tracks) visit(track.nodeId);
      }
    }

    for (const edit of Object.values(doc.generativeEdits ?? {})) {
      if (edit.sourceNodeId === id || edit.resultNodeId === id) {
        visit(edit.sourceNodeId);
        if (edit.resultNodeId) visit(edit.resultNodeId);
      }
    }
  }
}

function collectPatternDefinitions(doc: Document, collection: ClosureNodeCollection): void {
  const {
    patternDefinitionIds,
    pendingPatternIds,
    patternDefinitions,
    patternComponentIds,
    patternStyleIds,
    patternVariableIds,
    patternSourceNodes,
  } = collection;
  const visit = (id: NodeId): void => visitNode(doc, collection, id);
  const visitFillReferences = (fill: unknown): void => visitFillRefs(doc, collection, fill);
  for (let index = 0; index < pendingPatternIds.length; index += 1) {
    const patternId = pendingPatternIds[index]!;
    const definition = doc.patternDefinitions?.[patternId];
    if (!definition) continue;
    patternDefinitions[patternId] = definition;
    for (const dependencyId of definition.dependencyPatternIds ?? []) {
      if (!patternDefinitionIds.has(dependencyId)) {
        patternDefinitionIds.add(dependencyId);
        pendingPatternIds.push(dependencyId);
      }
    }
    if (definition.source.kind === 'vector') {
      for (const node of Object.values(definition.source.nodes)) {
        patternSourceNodes.push(node);
        for (const fill of node.fills ?? []) visitFillReferences(fill);
        const sourceMaskId = node.mask?.sourceNodeId;
        if (sourceMaskId && doc.nodes[sourceMaskId]) visit(sourceMaskId);
        const pathNodeId = node.kind === 'text' ? node.pathTextSettings?.pathNodeId : undefined;
        if (pathNodeId && doc.nodes[pathNodeId]) visit(pathNodeId);
        const candidate = node as SceneNode & {
          componentId?: string;
          styleId?: string;
          bindings?: Record<string, { variableId?: string }>;
        };
        if (candidate.componentId) {
          patternComponentIds.add(candidate.componentId);
          const component = doc.components[candidate.componentId];
          if (component) visit(component.masterRootId);
        }
        if (candidate.styleId) patternStyleIds.add(candidate.styleId);
        for (const binding of Object.values(candidate.bindings ?? {})) {
          if (binding.variableId) patternVariableIds.add(binding.variableId);
        }
      }
      for (const styleId of definition.source.styleIds) patternStyleIds.add(styleId);
    }
  }
}

export function collectClosureNodes(doc: Document, rootIds: NodeId[]): ClosureNodeCollection {
  const collection: ClosureNodeCollection = {
    nodeIds: new Set<NodeId>(),
    nodes: {},
    patternDefinitionIds: new Set<string>(),
    pendingPatternIds: [],
    patternDefinitions: {},
    patternComponentIds: new Set<string>(),
    patternStyleIds: new Set<string>(),
    patternVariableIds: new Set<string>(),
    patternSourceNodes: [],
  };
  for (const id of rootIds) visitNode(doc, collection, id);
  scanNodeDependencies(doc, collection);
  collectPatternDefinitions(doc, collection);
  return collection;
}
