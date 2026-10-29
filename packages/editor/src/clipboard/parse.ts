/** Varve clipboard JSON parser and serializer, including the raster-tile node codec. */

import type { DepthMapResource } from '@varve/engine';
import {
  type Document,
  type DocumentAsset,
  type DocumentIconAsset,
  type LayoutGrid,
  type MockupTemplateAsset,
  type RasterLayerNode,
  type RasterMaskAsset,
  type SceneNode,
  serializeTiles,
} from '@varve/scene';
import type { Affine } from '@varve/shared';
import {
  LEGACY_CLIPBOARD_VERSION,
  MAX_CLIPBOARD_JSON_BYTES,
  MAX_CLIPBOARD_NODES,
  VARVE_CLIPBOARD_FORMAT,
  VARVE_CLIPBOARD_VERSION,
} from './mime';
import type { ClipboardData, ClipboardFontDependency } from './types';
import {
  finitePayload,
  isRecord,
  parseClipboardNode,
  validateNodeGraph,
  validClipboardFontDependencies,
  validClipboardFontManifest,
  validClipboardPatternDefinitions,
  validFrameGuideLayouts,
  validResourceMap,
} from './validation';

function serializeClipboardNode(node: SceneNode): SceneNode {
  if (node.kind !== 'rasterLayer') return node;
  const raster = node as RasterLayerNode;
  if (!(raster.tiles instanceof Map)) return node;
  return { ...raster, tiles: serializeTiles(raster.tiles) } as unknown as SceneNode;
}
/** Validate and rehydrate a transport payload before it enters editor state. */
export function parseClipboardData(text: string): ClipboardData | null {
  if (new TextEncoder().encode(text).byteLength > MAX_CLIPBOARD_JSON_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || !Array.isArray(raw.nodes) || raw.nodes.length > MAX_CLIPBOARD_NODES) {
    return null;
  }
  if (
    !validClipboardFontManifest(raw.fontManifest) ||
    !validClipboardFontDependencies(raw.fontDependencies) ||
    !validClipboardPatternDefinitions(raw.patternDefinitions)
  ) {
    return null;
  }
  if (
    raw.format !== undefined &&
    (raw.format !== VARVE_CLIPBOARD_FORMAT ||
      (raw.version !== LEGACY_CLIPBOARD_VERSION &&
        raw.version !== 2 &&
        raw.version !== 3 &&
        raw.version !== 4 &&
        raw.version !== VARVE_CLIPBOARD_VERSION))
  ) {
    return null;
  }
  const nodes: SceneNode[] = [];
  const ids = new Set<string>();
  for (const value of raw.nodes) {
    const node = parseClipboardNode(value);
    if (!node || ids.has(node.id)) return null;
    ids.add(node.id);
    nodes.push(node);
  }
  if (!validateNodeGraph(nodes) || !finitePayload(nodes)) return null;
  const rootIds = raw.rootIds;
  if (
    rootIds !== undefined &&
    (!Array.isArray(rootIds) ||
      rootIds.some((id) => typeof id !== 'string' || !ids.has(id)) ||
      new Set(rootIds).size !== rootIds.length)
  ) {
    return null;
  }
  const dependencyIds = raw.dependencyIds;
  if (
    dependencyIds !== undefined &&
    (!Array.isArray(dependencyIds) ||
      dependencyIds.some((id) => typeof id !== 'string' || !ids.has(id)) ||
      new Set(dependencyIds).size !== dependencyIds.length ||
      (Array.isArray(rootIds) && dependencyIds.some((id) => rootIds.includes(id))))
  ) {
    return null;
  }
  if (
    !validResourceMap(raw.depthMaps) ||
    !validResourceMap(raw.rasterMaskAssets) ||
    !validResourceMap(raw.assets) ||
    !validResourceMap(raw.iconAssets) ||
    !validResourceMap(raw.mockupTemplates) ||
    !validResourceMap(raw.generativeEdits) ||
    !validResourceMap(raw.components) ||
    !validResourceMap(raw.styles) ||
    !validResourceMap(raw.paints) ||
    !validResourceMap(raw.variableStore) ||
    !validResourceMap(raw.interactions) ||
    !validResourceMap(raw.timelines) ||
    !validResourceMap(raw.stories) ||
    !validResourceMap(raw.motionExtensions) ||
    !validResourceMap(raw.motionPresets) ||
    !validFrameGuideLayouts(raw.frameGuideLayouts, ids)
  ) {
    return null;
  }
  if (raw.patternDefinitions !== undefined && !finitePayload(raw.patternDefinitions)) return null;
  if (
    raw.worldAnchor !== undefined &&
    (!isRecord(raw.worldAnchor) ||
      Object.values(raw.worldAnchor).some(
        (anchor) =>
          !Array.isArray(anchor) ||
          anchor.length !== 6 ||
          anchor.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry)),
      ))
  ) {
    return null;
  }
  return {
    ...(raw.format === VARVE_CLIPBOARD_FORMAT
      ? {
          format: VARVE_CLIPBOARD_FORMAT as typeof VARVE_CLIPBOARD_FORMAT,
          version:
            raw.version === VARVE_CLIPBOARD_VERSION
              ? VARVE_CLIPBOARD_VERSION
              : raw.version === 4
                ? 4
                : raw.version === 2
                  ? 2
                  : raw.version === 3
                    ? 3
                    : LEGACY_CLIPBOARD_VERSION,
        }
      : {}),
    ...(typeof raw.sourceDocumentId === 'string' ? { sourceDocumentId: raw.sourceDocumentId } : {}),
    ...(typeof raw.sourcePageId === 'string' ? { sourcePageId: raw.sourcePageId } : {}),
    nodes,
    ...(rootIds ? { rootIds: [...rootIds] } : {}),
    ...(dependencyIds ? { dependencyIds: [...dependencyIds] } : {}),
    ...(isRecord(raw.depthMaps) ? { depthMaps: raw.depthMaps as ClipboardData['depthMaps'] } : {}),
    ...(validClipboardFontManifest(raw.fontManifest)
      ? { fontManifest: raw.fontManifest as ClipboardData['fontManifest'] }
      : {}),
    ...(Array.isArray(raw.fontDependencies)
      ? { fontDependencies: raw.fontDependencies as ClipboardFontDependency[] }
      : {}),
    ...(isRecord(raw.rasterMaskAssets)
      ? { rasterMaskAssets: raw.rasterMaskAssets as ClipboardData['rasterMaskAssets'] }
      : {}),
    ...(isRecord(raw.assets) ? { assets: raw.assets as ClipboardData['assets'] } : {}),
    ...(isRecord(raw.iconAssets)
      ? { iconAssets: raw.iconAssets as ClipboardData['iconAssets'] }
      : {}),
    ...(isRecord(raw.mockupTemplates)
      ? { mockupTemplates: raw.mockupTemplates as ClipboardData['mockupTemplates'] }
      : {}),
    ...(isRecord(raw.generativeEdits)
      ? { generativeEdits: raw.generativeEdits as ClipboardData['generativeEdits'] }
      : {}),
    ...(isRecord(raw.components)
      ? { components: raw.components as ClipboardData['components'] }
      : {}),
    ...(isRecord(raw.styles) ? { styles: raw.styles as ClipboardData['styles'] } : {}),
    ...(isRecord(raw.paints) ? { paints: raw.paints as ClipboardData['paints'] } : {}),
    ...(isRecord(raw.patternDefinitions)
      ? { patternDefinitions: raw.patternDefinitions as ClipboardData['patternDefinitions'] }
      : {}),
    ...(isRecord(raw.variableStore)
      ? { variableStore: raw.variableStore as unknown as ClipboardData['variableStore'] }
      : {}),
    ...(isRecord(raw.interactions)
      ? { interactions: raw.interactions as ClipboardData['interactions'] }
      : {}),
    ...(isRecord(raw.timelines) ? { timelines: raw.timelines as ClipboardData['timelines'] } : {}),
    ...(isRecord(raw.stories) ? { stories: raw.stories as ClipboardData['stories'] } : {}),
    ...(isRecord(raw.motionExtensions)
      ? { motionExtensions: raw.motionExtensions as ClipboardData['motionExtensions'] }
      : {}),
    ...(isRecord(raw.motionPresets)
      ? { motionPresets: raw.motionPresets as ClipboardData['motionPresets'] }
      : {}),
    ...(isRecord(raw.worldAnchor)
      ? { worldAnchor: raw.worldAnchor as ClipboardData['worldAnchor'] }
      : {}),
    ...(isRecord(raw.frameGuideLayouts)
      ? { frameGuideLayouts: raw.frameGuideLayouts as ClipboardData['frameGuideLayouts'] }
      : {}),
  };
}
export function serializeClipboardData(
  nodes: SceneNode[],
  rasterMaskAssets?: Record<string, RasterMaskAsset>,
  assets?: Record<string, DocumentAsset>,
  iconAssets?: Record<string, DocumentIconAsset>,
  worldAnchor?: Record<string, Affine>,
  rootIds?: string[],
  mockupTemplates?: Record<string, MockupTemplateAsset>,
  sourceDocumentId?: string,
  generativeEdits?: NonNullable<Document['generativeEdits']>,
  components?: Document['components'],
  styles?: Document['styles'],
  paints?: Document['paints'],
  variableStore?: Document['variableStore'],
  interactions?: Document['interactions'],
  timelines?: Document['timelines'],
  stories?: Document['stories'],
  motionExtensions?: Document['motionExtensions'],
  motionPresets?: Document['motionPresets'],
  dependencyIds?: string[],
  depthMaps?: Record<string, DepthMapResource>,
  fontManifest?: Document['fontManifest'],
  fontDependencies?: ClipboardFontDependency[],
  frameGuideLayouts?: Record<string, LayoutGrid[]>,
  patternDefinitions?: Document['patternDefinitions'],
  sourcePageId?: string,
): string {
  const data: ClipboardData = {
    format: VARVE_CLIPBOARD_FORMAT,
    version: VARVE_CLIPBOARD_VERSION,
    ...(sourceDocumentId ? { sourceDocumentId } : {}),
    ...(sourcePageId ? { sourcePageId } : {}),
    nodes: nodes.map(serializeClipboardNode),
    ...(rootIds && rootIds.length > 0 ? { rootIds: [...rootIds] } : {}),
    ...(dependencyIds && dependencyIds.length > 0 ? { dependencyIds: [...dependencyIds] } : {}),
    ...(depthMaps && Object.keys(depthMaps).length > 0 ? { depthMaps } : {}),
    ...(fontManifest ? { fontManifest } : {}),
    ...(fontDependencies && fontDependencies.length > 0 ? { fontDependencies } : {}),
    ...(rasterMaskAssets && Object.keys(rasterMaskAssets).length > 0 ? { rasterMaskAssets } : {}),
    ...(assets && Object.keys(assets).length > 0 ? { assets } : {}),
    ...(iconAssets && Object.keys(iconAssets).length > 0 ? { iconAssets } : {}),
    ...(mockupTemplates && Object.keys(mockupTemplates).length > 0 ? { mockupTemplates } : {}),
    ...(worldAnchor && Object.keys(worldAnchor).length > 0 ? { worldAnchor } : {}),
    ...(frameGuideLayouts && Object.keys(frameGuideLayouts).length > 0
      ? { frameGuideLayouts }
      : {}),
    ...(generativeEdits && Object.keys(generativeEdits).length > 0 ? { generativeEdits } : {}),
    ...(components && Object.keys(components).length > 0 ? { components } : {}),
    ...(styles && Object.keys(styles).length > 0 ? { styles } : {}),
    ...(paints && Object.keys(paints).length > 0 ? { paints } : {}),
    ...(patternDefinitions && Object.keys(patternDefinitions).length > 0
      ? { patternDefinitions }
      : {}),
    ...(variableStore && Object.keys(variableStore.variables).length > 0 ? { variableStore } : {}),
    ...(interactions && Object.keys(interactions).length > 0 ? { interactions } : {}),
    ...(timelines && Object.keys(timelines).length > 0 ? { timelines } : {}),
    ...(stories && Object.keys(stories).length > 0 ? { stories } : {}),
    ...(motionExtensions && Object.keys(motionExtensions).length > 0 ? { motionExtensions } : {}),
    ...(motionPresets && Object.keys(motionPresets).length > 0 ? { motionPresets } : {}),
  };
  return JSON.stringify(data);
}
