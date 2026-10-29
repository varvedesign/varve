import type { Document } from '../document';
import { validatePhotoSourceBinding, validateRetouchProvenance } from '../photoSource';
import { deserializeTiles, type SerializableTiles } from '../rasterLayer';
import type { NodeId, SceneNode } from '../types';
import type { DocumentCodecWarning } from './types';
import { isRecord, warning } from './validation';

/** Validate photographic source bindings without discarding unknown operations. */
export function validatePhotoSourceState(
  doc: Document,
  warnings: DocumentCodecWarning[],
): Document {
  for (const [nodeId, node] of Object.entries(doc.nodes)) {
    for (const [fillIndex, fill] of (node.fills ?? []).entries()) {
      if (fill.type !== 'image' || !fill.image?.photoSource) continue;
      const binding = fill.image.photoSource;
      const validation = validatePhotoSourceBinding(binding);
      if (!validation.valid) {
        warnings.push(
          warning(
            'document.invalid-photo-source',
            `Photo source binding was retained for manual recovery: ${validation.errors.join('; ')}`,
            'warning',
            `nodes.${nodeId}.fills.${fillIndex}.image.photoSource`,
          ),
        );
        continue;
      }
      const missingSources = binding.sourceAssetIds.filter((assetId) => !doc.assets?.[assetId]);
      if (!doc.assets?.[binding.derivedAssetId]) missingSources.push(binding.derivedAssetId);
      if (binding.masterAssetId && !doc.assets?.[binding.masterAssetId]) {
        missingSources.push(binding.masterAssetId);
      }
      if (missingSources.length > 0) {
        warnings.push(
          warning(
            'document.missing-photo-source-assets',
            `Photo source binding references missing asset(s): ${missingSources.join(', ')}`,
            'warning',
            `nodes.${nodeId}.fills.${fillIndex}.image.photoSource`,
          ),
        );
      }
    }
  }
  return doc;
}

/** Keep baked repair metadata recoverable while surfacing malformed ownership. */
export function validateRetouchProvenanceState(
  doc: Document,
  warnings: DocumentCodecWarning[],
): Document {
  for (const [nodeId, node] of Object.entries(doc.nodes)) {
    if (node.kind !== 'rasterLayer' || !node.retouchProvenance) continue;
    const provenance = node.retouchProvenance;
    const validation = validateRetouchProvenance(provenance);
    if (!validation.valid) {
      warnings.push(
        warning(
          'document.invalid-retouch-provenance',
          `Retouch provenance was retained for manual recovery: ${validation.errors.join('; ')}`,
          'warning',
          `nodes.${nodeId}.retouchProvenance`,
        ),
      );
      continue;
    }
    if (!doc.nodes[provenance.sourceNodeId]) {
      warnings.push(
        warning(
          'document.missing-retouch-source',
          `Retouch layer ${nodeId} references missing source node ${provenance.sourceNodeId}; its pixels were retained`,
          'warning',
          `nodes.${nodeId}.retouchProvenance.sourceNodeId`,
        ),
      );
    }
  }
  return doc;
}

export function normalizeRasterTiles(
  nodeId: NodeId,
  node: SceneNode,
  warnings: DocumentCodecWarning[],
): SceneNode {
  if (node.kind !== 'rasterLayer') return node;
  if (node.tiles instanceof Map) return node;

  const rawTiles = (node as unknown as { tiles?: unknown }).tiles;
  if (!isRecord(rawTiles)) {
    warnings.push(
      warning(
        'document.raster-tiles-missing',
        `Raster layer ${nodeId} had no valid tile collection; it was opened empty`,
        'warning',
        `${nodeId}.tiles`,
      ),
    );
    return { ...node, tiles: new Map() };
  }

  const tiles = deserializeTiles(rawTiles as SerializableTiles);
  if (Object.keys(rawTiles).length !== tiles.size) {
    warnings.push(
      warning(
        'document.raster-tiles-repaired',
        `Raster layer ${nodeId} contained invalid tile data; invalid tiles were discarded`,
        'warning',
        `${nodeId}.tiles`,
      ),
    );
  }
  return { ...node, tiles };
}
