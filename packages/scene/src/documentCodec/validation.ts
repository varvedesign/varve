import type { NodeId, SceneNode } from '../types';
import { resolveDocumentVersion } from '../version';
import type { DocumentCodecWarning } from './types';

export function warning(
  code: string,
  message: string,
  severity: DocumentCodecWarning['severity'] = 'warning',
  path?: string,
): DocumentCodecWarning {
  return path ? { code, message, severity, path } : { code, message, severity };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * A version field Varve cannot read is not a reason to refuse the file.
 *
 * Varve writes `formatVersion` as a numeric string; a JSON number, boolean,
 * array or object in that position means foreign or corrupted bytes. The
 * document is still opened — without migrations — and the reason is reported
 * instead of failing the open (storytold/designcraft #1049, #744).
 */
export function unrecognizedVersionWarnings(raw: Record<string, unknown>): DocumentCodecWarning[] {
  const resolution = resolveDocumentVersion(raw.formatVersion);
  if (resolution.kind !== 'unrecognized') return [];
  const shown = Array.isArray(resolution.raw)
    ? 'an array'
    : isRecord(resolution.raw)
      ? 'an object'
      : `${typeof resolution.raw} ${String(resolution.raw)}`;
  return [
    warning(
      'document.unrecognized-version',
      `The document's version field is not a version Varve can read (${shown}). The file was opened without running migrations, so features from a newer or unknown version may not be supported.`,
      'warning',
      'formatVersion',
    ),
  ];
}

export function validateShape(raw: Record<string, unknown>): string | null {
  if (typeof raw.id !== 'string') return 'Document id must be a string';
  if (typeof raw.name !== 'string') return 'Document name must be a string';
  if (!Array.isArray(raw.rootChildren)) return 'Document rootChildren must be an array';
  if (!isRecord(raw.nodes)) return 'Document nodes must be an object';
  if (!isRecord(raw.components)) return 'Document components must be an object';
  if (typeof raw.nextId !== 'number') return 'Document nextId must be a number';
  return null;
}

export function validateRuntimeCollections(raw: Record<string, unknown>): string | null {
  if (isRecord(raw.nodes)) {
    for (const [nodeId, node] of Object.entries(raw.nodes)) {
      if (!isRecord(node)) return `Document node ${nodeId} must be an object`;
    }
  }
  if (raw.rasterMaskAssets !== undefined) {
    if (!isRecord(raw.rasterMaskAssets)) return 'Document rasterMaskAssets must be an object';
    for (const [assetId, asset] of Object.entries(raw.rasterMaskAssets)) {
      if (!isRecord(asset)) return `Raster mask asset ${assetId} must be an object`;
    }
  }
  if (raw.assets !== undefined) {
    if (!isRecord(raw.assets)) return 'Document assets must be an object';
    for (const [assetId, asset] of Object.entries(raw.assets)) {
      if (!isRecord(asset)) return `Document asset ${assetId} must be an object`;
    }
  }
  if (raw.patternDefinitions !== undefined) {
    if (!isRecord(raw.patternDefinitions)) return 'Document patternDefinitions must be an object';
    for (const [patternId, definition] of Object.entries(raw.patternDefinitions)) {
      if (!isRecord(definition)) return `Pattern definition ${patternId} must be an object`;
    }
  }
  if (raw.depthMaps !== undefined) {
    if (!isRecord(raw.depthMaps)) return 'Document depthMaps must be an object';
    for (const [depthMapId, depthMap] of Object.entries(raw.depthMaps)) {
      if (!isRecord(depthMap)) return `Depth map resource ${depthMapId} must be an object`;
      // Decode-time validation is deliberately deferred to deserializeDepthMap.
      // A newer or corrupt resource must not make the whole document unloadable;
      // the renderer can keep the source pixels and report a controlled warning.
    }
  }
  if (raw.iccProfiles !== undefined) {
    if (!isRecord(raw.iccProfiles)) return 'Document iccProfiles must be an object';
    for (const [profileId, entry] of Object.entries(raw.iccProfiles)) {
      if (!isRecord(entry)) return `ICC profile ${profileId} must be an object`;
    }
  }
  if (raw.generativeEdits !== undefined) {
    if (!isRecord(raw.generativeEdits)) return 'Document generativeEdits must be an object';
  }
  if (raw.iconAssets !== undefined) {
    if (!isRecord(raw.iconAssets)) return 'Document iconAssets must be an object';
    for (const [assetId, asset] of Object.entries(raw.iconAssets)) {
      if (!isRecord(asset)) return `Icon asset ${assetId} must be an object`;
    }
  }
  return null;
}

export function maxNumericNodeId(nodes: Record<NodeId, SceneNode>): number {
  let max = 0;
  for (const id of Object.keys(nodes)) {
    // Legacy sequential ids (`n12`) and minted collision-resistant ids
    // (`n12_3fa9...`, ADR-0025) both carry a counter component.
    const match = /^n(\d+)(?:_[0-9a-f]+)?$/.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

export function malformedLegacyBackgroundRemovalWarnings(
  raw: Record<string, unknown>,
): DocumentCodecWarning[] {
  if (!isRecord(raw.nodes)) return [];
  const warnings: DocumentCodecWarning[] = [];
  for (const [nodeId, value] of Object.entries(raw.nodes)) {
    if (!isRecord(value) || !('backgroundRemoval' in value)) continue;
    const legacy = value.backgroundRemoval;
    if (
      legacy === null ||
      typeof legacy !== 'object' ||
      typeof (legacy as { maskDataUrl?: unknown }).maskDataUrl !== 'string'
    ) {
      warnings.push(
        warning(
          'document.invalid-legacy-background-removal',
          `Node ${nodeId} had malformed legacy background removal state; it was removed`,
          'error',
          `${nodeId}.backgroundRemoval`,
        ),
      );
    }
  }
  return warnings;
}
