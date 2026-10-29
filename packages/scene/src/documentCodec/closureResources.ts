import type { Document } from '../document';
import { getOwnRasterMaskAsset } from '../masks';
import type { NodeId, SceneNode } from '../types';
import type { ClosureNodeCollection } from './closureNodes';
import { collectFontManifestClosure } from './fontManifest';
import type { DocumentClosure } from './types';

export type ClosureResources = Omit<DocumentClosure, 'nodeIds' | 'nodes'>;

export function collectClosureResources(
  doc: Document,
  collection: ClosureNodeCollection,
): ClosureResources {
  const {
    nodeIds,
    nodes,
    patternDefinitions,
    patternComponentIds,
    patternStyleIds,
    patternVariableIds,
    patternSourceNodes,
  } = collection;
  const components: NonNullable<Document['components']> = {};
  const styles: NonNullable<Document['styles']> = {};
  const paints: NonNullable<Document['paints']> = {};
  const interactions: NonNullable<Document['interactions']> = {};
  const stories: NonNullable<Document['stories']> = {};
  const timelines: NonNullable<Document['timelines']> = {};
  const motionExtensions: NonNullable<Document['motionExtensions']> = {};
  const motionPresets: NonNullable<Document['motionPresets']> = {};
  const variableIds = new Set<string>(patternVariableIds);
  const collectionIds = new Set<string>();
  const timelineIds = new Set<string>();
  for (const node of Object.values(nodes)) {
    const candidate = node as SceneNode & {
      componentId?: NodeId;
      styleId?: string;
      paintRefs?: string[];
      bindings?: Record<string, { variableId?: string }>;
      storyBinding?: { storyId?: NodeId };
    };
    if (candidate.componentId) {
      const component = doc.components[candidate.componentId];
      if (component && nodeIds.has(component.masterRootId)) components[component.id] = component;
    }
    if (candidate.styleId && doc.styles?.[candidate.styleId]) {
      styles[candidate.styleId] = doc.styles[candidate.styleId]!;
    }
    for (const paintId of candidate.paintRefs ?? []) {
      const paint = doc.paints?.[paintId];
      if (paint) paints[paintId] = paint;
    }
    for (const binding of Object.values(candidate.bindings ?? {})) {
      if (binding.variableId) variableIds.add(binding.variableId);
    }
    const nodeInteractions = doc.interactions?.[node.id];
    if (nodeInteractions) interactions[node.id] = nodeInteractions;
    const storyId = candidate.storyBinding?.storyId;
    if (storyId && doc.stories?.[storyId]) stories[storyId] = doc.stories[storyId]!;
    for (const [timelineId, timeline] of Object.entries(doc.timelines ?? {})) {
      if (timeline.tracks.some((track) => nodeIds.has(track.nodeId))) {
        timelineIds.add(timelineId);
        timelines[timelineId] = timeline;
      }
    }
  }
  for (const componentId of patternComponentIds) {
    const component = doc.components[componentId];
    if (component && nodeIds.has(component.masterRootId)) components[component.id] = component;
  }
  for (const styleId of patternStyleIds) {
    const style = doc.styles?.[styleId];
    if (style) styles[styleId] = style;
  }
  // Include nested motion timelines and the variable collections/aliases that
  // own every referenced variable. Alias values may use either a variable id
  // or its authored name, and may cross collection boundaries, so resolve the
  // transitive chain before slicing the store.
  let changed = true;
  while (changed) {
    changed = false;
    for (const timeline of Object.values(timelines)) {
      for (const track of timeline.tracks) {
        if (track.nestedTimelineId && !timelineIds.has(track.nestedTimelineId)) {
          const nested = doc.timelines?.[track.nestedTimelineId];
          if (nested) {
            timelineIds.add(nested.id);
            timelines[nested.id] = nested;
            changed = true;
          }
        }
      }
    }
  }
  const variableStoreSource = doc.variableStore;
  const variableByName = new Map(
    Object.values(variableStoreSource?.variables ?? {}).map((variable) => [
      variable.name,
      variable,
    ]),
  );
  const collectionVariableIds = (
    collection: NonNullable<Document['variableStore']>['collections'][string],
  ) => {
    const ids = [...collection.variableIds];
    const walkGroups = (groups: typeof collection.groups): void => {
      for (const group of groups ?? []) {
        ids.push(...group.variableIds);
        walkGroups(group.groups);
      }
    };
    walkGroups(collection.groups);
    return ids;
  };
  let variableClosureChanged = true;
  while (variableClosureChanged) {
    variableClosureChanged = false;
    for (const id of [...variableIds]) {
      const variable = variableStoreSource?.variables[id];
      if (!variable) continue;
      for (const raw of Object.values(variable.valuesByMode)) {
        if (typeof raw !== 'string') continue;
        for (const match of raw.matchAll(/\{([^}]+)\}/g)) {
          const target = variableStoreSource?.variables[match[1]!] ?? variableByName.get(match[1]!);
          if (target && !variableIds.has(target.id)) {
            variableIds.add(target.id);
            variableClosureChanged = true;
          }
        }
      }
    }
    for (const collection of Object.values(variableStoreSource?.collections ?? {})) {
      if (!collectionVariableIds(collection).some((id) => variableIds.has(id))) continue;
      if (!collectionIds.has(collection.id)) {
        collectionIds.add(collection.id);
        variableClosureChanged = true;
      }
      for (const variableId of collectionVariableIds(collection)) {
        if (!variableIds.has(variableId)) {
          variableIds.add(variableId);
          variableClosureChanged = true;
        }
      }
    }
  }
  const variableStore = doc.variableStore
    ? {
        ...doc.variableStore,
        variables: Object.fromEntries(
          Object.entries(doc.variableStore.variables).filter(([id]) => variableIds.has(id)),
        ),
        collections: Object.fromEntries(
          Object.entries(doc.variableStore.collections).filter(([id]) => collectionIds.has(id)),
        ),
        activeCollectionId: collectionIds.has(doc.variableStore.activeCollectionId)
          ? doc.variableStore.activeCollectionId
          : '',
      }
    : undefined;
  for (const [id, extension] of Object.entries(doc.motionExtensions ?? {})) {
    if (nodeIds.has(extension.nodeId)) motionExtensions[id] = extension;
  }
  for (const [id, preset] of Object.entries(doc.motionPresets ?? {})) {
    if (timelineIds.has(preset.timelineId)) motionPresets[id] = preset;
  }
  const rasterMaskAssets: NonNullable<Document['rasterMaskAssets']> = {};
  const depthMapIds = new Set<string>();
  const allClosureNodes = [...Object.values(nodes), ...patternSourceNodes];
  for (const node of allClosureNodes) {
    const assetId = node.mask?.rasterMask?.assetId;
    const asset = assetId ? getOwnRasterMaskAsset(doc, assetId) : undefined;
    if (assetId && asset) rasterMaskAssets[assetId] = asset;
    const correctionAssetId = node.mask?.rasterMask?.depthRecipe?.correction?.assetId;
    const correctionAsset = correctionAssetId
      ? getOwnRasterMaskAsset(doc, correctionAssetId)
      : undefined;
    if (correctionAsset) rasterMaskAssets[correctionAsset.id] = correctionAsset;
    const recipeDepthMapId = node.mask?.rasterMask?.depthRecipe?.depthMapId;
    if (recipeDepthMapId) depthMapIds.add(recipeDepthMapId);
    for (const effect of ('effects' in node ? node.effects : []) ?? []) {
      if (effect.type === 'depthBlur') depthMapIds.add(effect.depthMapId);
    }
  }
  const depthMaps: NonNullable<Document['depthMaps']> = {};
  for (const id of depthMapIds) {
    const resource = doc.depthMaps?.[id];
    if (resource) depthMaps[id] = resource;
  }
  const assets: NonNullable<Document['assets']> = {};
  for (const node of allClosureNodes) {
    for (const fill of node.fills ?? []) {
      const assetId = fill.type === 'image' ? fill.image?.assetId : undefined;
      const asset = assetId ? doc.assets?.[assetId] : undefined;
      if (assetId && asset) assets[assetId] = asset;
    }
    if (node.kind === 'frame' && node.mockup) {
      for (const binding of Object.values(node.mockup.surfaceBindings)) {
        const asset =
          binding.mode === 'snapshot' && binding.assetId
            ? doc.assets?.[binding.assetId]
            : undefined;
        if (asset) assets[asset.id] = asset;
      }
    }
  }
  for (const definition of Object.values(patternDefinitions)) {
    if (definition.source.kind === 'raster') {
      const asset = doc.assets?.[definition.source.assetId];
      if (asset) assets[asset.id] = asset;
    } else if (definition.source.kind === 'vector') {
      for (const assetId of definition.source.assetIds) {
        const asset = doc.assets?.[assetId];
        if (asset) assets[asset.id] = asset;
      }
      for (const sourceNode of Object.values(definition.source.nodes)) {
        for (const fill of sourceNode.fills ?? []) {
          const assetId = fill.type === 'image' ? fill.image?.assetId : undefined;
          const asset = assetId ? doc.assets?.[assetId] : undefined;
          if (asset) assets[asset.id] = asset;
        }
      }
    }
  }
  const iconAssets: NonNullable<Document['iconAssets']> = {};
  for (const node of allClosureNodes) {
    const assetId = node.iconAssetId;
    const asset = assetId ? doc.iconAssets?.[assetId] : undefined;
    if (assetId && asset) iconAssets[assetId] = asset;
  }
  const mockupTemplates: NonNullable<Document['mockupTemplates']> = {};
  for (const node of Object.values(nodes)) {
    if (node.kind !== 'frame' || !node.mockup) continue;
    const template = node.mockup.templateId
      ? doc.mockupTemplates?.[node.mockup.templateId]
      : undefined;
    if (template) mockupTemplates[template.id] = template;
  }
  // Template-referenced raster assets (photographic plate, clip/occlusion
  // coverage) are part of the resource closure even though no node fill
  // points at them directly.
  for (const template of Object.values(mockupTemplates)) {
    const referenced = [
      template.plateImage?.assetId,
      ...template.surfaces.flatMap((surface) => [
        surface.clipMaskAssetId,
        surface.occlusionMaskAssetId,
      ]),
    ];
    for (const assetId of referenced) {
      const asset = assetId ? doc.assets?.[assetId] : undefined;
      if (assetId && asset) assets[assetId] = asset;
    }
  }
  const generativeEdits: NonNullable<Document['generativeEdits']> = {};
  for (const [editId, edit] of Object.entries(doc.generativeEdits ?? {})) {
    if (nodeIds.has(edit.sourceNodeId) || (edit.resultNodeId && nodeIds.has(edit.resultNodeId))) {
      generativeEdits[editId] = edit;
      for (const variation of edit.variations) {
        const asset = doc.assets?.[variation.assetId];
        if (asset) assets[asset.id] = asset;
        if (variation.thumbnailAssetId) {
          const thumbnail = doc.assets?.[variation.thumbnailAssetId];
          if (thumbnail) assets[thumbnail.id] = thumbnail;
        }
        if (variation.contextAssetId) {
          const context = doc.assets?.[variation.contextAssetId];
          if (context) assets[context.id] = context;
        }
      }
      const maskIds = [
        edit.maskAssetId,
        edit.masks.userMaskAssetId,
        edit.masks.inferenceMaskAssetId,
        edit.masks.compositeMaskAssetId,
      ];
      for (const maskId of maskIds) {
        if (maskId) {
          const mask = getOwnRasterMaskAsset(doc, maskId);
          if (mask) rasterMaskAssets[mask.id] = mask;
        }
      }
      for (const sourceAssetId of [edit.sourceAssetId, edit.sourceSnapshotAssetId]) {
        const sourceAsset = sourceAssetId ? doc.assets?.[sourceAssetId] : undefined;
        if (sourceAsset) assets[sourceAsset.id] = sourceAsset;
      }
    }
  }
  const fontNodes = Object.fromEntries(allClosureNodes.map((node) => [node.id, node]));
  const fontManifest = collectFontManifestClosure(doc, fontNodes, styles);
  return {
    ...(fontManifest ? { fontManifest } : {}),
    components: Object.keys(components).length > 0 ? components : undefined,
    styles: Object.keys(styles).length > 0 ? styles : undefined,
    paints: Object.keys(paints).length > 0 ? paints : undefined,
    patternDefinitions: Object.keys(patternDefinitions).length > 0 ? patternDefinitions : undefined,
    variableStore:
      variableStore && Object.keys(variableStore.variables).length > 0 ? variableStore : undefined,
    interactions: Object.keys(interactions).length > 0 ? interactions : undefined,
    timelines: Object.keys(timelines).length > 0 ? timelines : undefined,
    stories: Object.keys(stories).length > 0 ? stories : undefined,
    motionExtensions: Object.keys(motionExtensions).length > 0 ? motionExtensions : undefined,
    motionPresets: Object.keys(motionPresets).length > 0 ? motionPresets : undefined,
    rasterMaskAssets: Object.keys(rasterMaskAssets).length > 0 ? rasterMaskAssets : undefined,
    depthMaps: Object.keys(depthMaps).length > 0 ? depthMaps : undefined,
    assets: Object.keys(assets).length > 0 ? assets : undefined,
    iconAssets: Object.keys(iconAssets).length > 0 ? iconAssets : undefined,
    mockupTemplates: Object.keys(mockupTemplates).length > 0 ? mockupTemplates : undefined,
    generativeEdits: Object.keys(generativeEdits).length > 0 ? generativeEdits : undefined,
  };
}
