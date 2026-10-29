/** Bounded clipboard payload validation: node graphs, resources, fonts, patterns, finite values. */

import type { FontReference } from '@varve/engine/font';
import {
  type Document,
  deserializeTiles,
  type SceneNode,
  type SerializableTiles,
  validatePatternDefinitionDependencies,
} from '@varve/scene';
import { base64ToBytes } from './fonts';
import {
  MAX_CLIPBOARD_DEPTH,
  MAX_CLIPBOARD_FONT_BYTES,
  MAX_CLIPBOARD_FONT_DEPENDENCIES,
  MAX_CLIPBOARD_NODES,
} from './mime';
import type { ClipboardFontDependency } from './types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function parseClipboardNode(value: unknown): SceneNode | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.kind !== 'string') {
    return null;
  }
  if (
    !['shape', 'text', 'group', 'frame', 'table', 'adjustment', 'path', 'rasterLayer'].includes(
      value.kind,
    )
  ) {
    return null;
  }
  if (value.id.length === 0 || value.id.length > 256) return null;
  if (
    'transform' in value &&
    (!Array.isArray(value.transform) ||
      value.transform.length !== 6 ||
      value.transform.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry)))
  ) {
    return null;
  }
  if ((value.kind === 'group' || value.kind === 'frame') && !Array.isArray(value.children)) {
    return null;
  }
  if (
    (value.kind === 'group' || value.kind === 'frame') &&
    (value.children as unknown[]).some((child) => typeof child !== 'string' || child.length > 256)
  ) {
    return null;
  }
  if (value.kind !== 'rasterLayer' || value.tiles instanceof Map) {
    return value as unknown as SceneNode;
  }
  if (!isRecord(value.tiles)) return value as unknown as SceneNode;
  try {
    return {
      ...value,
      tiles: deserializeTiles(value.tiles as unknown as SerializableTiles),
    } as unknown as SceneNode;
  } catch {
    return null;
  }
}
export function validateNodeGraph(nodes: SceneNode[]): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const state = new Map<string, 0 | 1 | 2>();
  for (const root of nodes) {
    if (state.get(root.id) === 2) continue;
    const stack: Array<{ id: string; depth: number; exit: boolean }> = [
      { id: root.id, depth: 0, exit: false },
    ];
    while (stack.length > 0) {
      const current = stack.pop()!;
      const node = byId.get(current.id);
      if (!node || current.depth > MAX_CLIPBOARD_DEPTH) return false;
      if (current.exit) {
        state.set(current.id, 2);
        continue;
      }
      if (state.get(current.id) === 1) return false;
      if (state.get(current.id) === 2) continue;
      state.set(current.id, 1);
      stack.push({ id: current.id, depth: current.depth, exit: true });
      if (node.kind === 'group' || node.kind === 'frame') {
        for (let index = node.children.length - 1; index >= 0; index -= 1) {
          stack.push({ id: node.children[index]!, depth: current.depth + 1, exit: false });
        }
      }
    }
  }
  return true;
}
export function validResourceMap(value: unknown): boolean {
  if (!value) return true;
  if (!isRecord(value) || Object.keys(value).length > MAX_CLIPBOARD_NODES) return false;
  return Object.values(value).every((entry) => isRecord(entry) && finitePayload(entry));
}
export function validFrameGuideLayouts(value: unknown, nodeIds: ReadonlySet<string>): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || Object.keys(value).length > MAX_CLIPBOARD_NODES) return false;
  for (const [ownerId, entries] of Object.entries(value)) {
    if (!nodeIds.has(ownerId) || !Array.isArray(entries) || entries.length > 32) return false;
    for (const entry of entries) {
      if (!isRecord(entry) || entry.type !== 'layout' || entry.frameId !== ownerId) return false;
      if (typeof entry.id !== 'string' || entry.id.length === 0 || entry.id.length > 256)
        return false;
      if (!finitePayload(entry)) return false;
    }
  }
  return true;
}
export function validClipboardFontReference(value: unknown): value is FontReference {
  if (!isRecord(value) || typeof value.artifactHash !== 'string') return false;
  if (!/^[0-9a-f]{64}$/i.test(value.artifactHash)) return false;
  return (
    value.collectionIndex === undefined ||
    (typeof value.collectionIndex === 'number' &&
      Number.isInteger(value.collectionIndex) &&
      value.collectionIndex >= 0)
  );
}
export function validClipboardFontDependencies(value: unknown): value is ClipboardFontDependency[] {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > MAX_CLIPBOARD_FONT_DEPENDENCIES) return false;
  let totalBytes = 0;
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      typeof candidate.family !== 'string' ||
      candidate.family.length > 512
    ) {
      return false;
    }
    if (
      candidate.fontReference !== undefined &&
      !validClipboardFontReference(candidate.fontReference)
    ) {
      return false;
    }
    if (
      !['embedded', 'metadata-only', 'missing', 'restricted'].includes(String(candidate.status))
    ) {
      return false;
    }
    if (candidate.dataBase64 !== undefined) {
      if (
        typeof candidate.dataBase64 !== 'string' ||
        candidate.dataBase64.length > Math.ceil((MAX_CLIPBOARD_FONT_BYTES * 4) / 3) + 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          candidate.dataBase64,
        )
      ) {
        return false;
      }
      const bytes = base64ToBytes(candidate.dataBase64);
      if (!bytes) return false;
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_CLIPBOARD_FONT_BYTES) return false;
    }
    if (!finitePayload(candidate)) return false;
  }
  return true;
}
export function validClipboardFontManifest(value: unknown): value is Document['fontManifest'] {
  if (value === undefined) return true;
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2)) return false;
  return Array.isArray(value.fonts) && value.fonts.length <= MAX_CLIPBOARD_FONT_DEPENDENCIES;
}
export function validClipboardPatternDefinitions(
  value: unknown,
): value is NonNullable<Document['patternDefinitions']> {
  if (value === undefined) return true;
  if (!isRecord(value) || !finitePayload(value)) return false;
  for (const [id, entry] of Object.entries(value)) {
    if (
      !isRecord(entry) ||
      entry.id !== id ||
      typeof entry.name !== 'string' ||
      !Number.isInteger(entry.revision) ||
      (entry.revision as number) < 1 ||
      !isRecord(entry.cell) ||
      ![entry.cell.x, entry.cell.y, entry.cell.width, entry.cell.height].every(
        (number) => typeof number === 'number' && Number.isFinite(number),
      ) ||
      (entry.cell.width as number) <= 0 ||
      (entry.cell.height as number) <= 0 ||
      !isRecord(entry.repeat) ||
      !isRecord(entry.source)
    ) {
      return false;
    }
    if (
      entry.dependencyPatternIds !== undefined &&
      (!Array.isArray(entry.dependencyPatternIds) ||
        entry.dependencyPatternIds.some((dependency) => typeof dependency !== 'string'))
    ) {
      return false;
    }
    const source = entry.source as Record<string, unknown>;
    if (source.kind === 'vector') {
      const rootIds = source.rootIds;
      const sourceNodes = source.nodes;
      if (
        !Array.isArray(rootIds) ||
        rootIds.length === 0 ||
        new Set(rootIds).size !== rootIds.length ||
        !isRecord(sourceNodes) ||
        !Array.isArray(source.assetIds) ||
        !Array.isArray(source.styleIds) ||
        !Array.isArray(source.componentIds) ||
        rootIds.some((rootId) => typeof rootId !== 'string' || !isRecord(sourceNodes[rootId])) ||
        [...source.assetIds, ...source.styleIds, ...source.componentIds].some(
          (dependencyId) => typeof dependencyId !== 'string',
        )
      ) {
        return false;
      }
      const motifNodes = Object.entries(sourceNodes).map(([nodeId, value]) => {
        const parsed = parseClipboardNode(value);
        return parsed?.id === nodeId ? parsed : null;
      });
      const parsedMotifNodes = motifNodes.filter((node): node is SceneNode => node !== null);
      if (
        motifNodes.some((node) => node === null) ||
        !validateNodeGraph(parsedMotifNodes) ||
        rootIds.some((rootId) => typeof rootId !== 'string')
      ) {
        return false;
      }
    } else if (
      entry.source.kind === 'raster' &&
      (typeof source.assetId !== 'string' ||
        typeof source.width !== 'number' ||
        !Number.isFinite(source.width) ||
        source.width <= 0 ||
        typeof source.height !== 'number' ||
        !Number.isFinite(source.height) ||
        source.height <= 0)
    ) {
      return false;
    } else if (source.kind === 'procedural' && !isRecord(source.recipe)) {
      return false;
    } else if (!['vector', 'raster', 'procedural'].includes(String(source.kind))) {
      return false;
    }
  }
  return (
    validatePatternDefinitionDependencies(value as NonNullable<Document['patternDefinitions']>)
      .length === 0
  );
}
/** Reject NaN/Infinity anywhere in a transported fragment without recursive stack growth. */
export function finitePayload(value: unknown): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.depth > MAX_CLIPBOARD_DEPTH) return false;
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) return false;
      continue;
    }
    if (Array.isArray(current.value)) {
      for (const child of current.value) stack.push({ value: child, depth: current.depth + 1 });
      continue;
    }
    if (isRecord(current.value)) {
      for (const child of Object.values(current.value)) {
        stack.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
  return true;
}
