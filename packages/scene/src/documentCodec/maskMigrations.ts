import { hashContent } from '../assets';
import { validateDepthMaskRecipe } from '../depthMaskRecipe';
import type { Document } from '../document';
import { isContainer } from '../document';
import { isVisualMaskTarget } from '../maskCapability';
import { validateMaskSource, validateRasterMaskAsset } from '../masks';
import { resolveNodePaints } from '../paint';
import { sha256Utf8 } from '../sha256';
import type { NodeId, RasterMaskAsset, SceneNode } from '../types';
import type { DocumentCodecWarning } from './types';
import { warning } from './validation';

export function hasImageFill(doc: Document, node: SceneNode): boolean {
  return (
    node.kind === 'shape' &&
    resolveNodePaints(node as unknown as Parameters<typeof resolveNodePaints>[0], doc).some(
      (fill) => fill.type === 'image' && fill.image,
    )
  );
}

function hasDepthMaskSource(doc: Document, node: SceneNode): boolean {
  if (node.kind !== 'adjustment') return false;
  const sourceId = node.mask?.rasterMask?.depthRecipe?.sourceBinding.nodeId;
  const source = sourceId ? doc.nodes[sourceId] : undefined;
  return source ? hasImageFill(doc, source) : false;
}

/**
 * Upgrade the short content id emitted by the first browser generative-mask
 * implementation. `checksum` is a SHA-256 field, so the old 16-hex FNV id
 * made DocumentCodec discard otherwise valid masks during save/reopen.
 */
function upgradeLegacyRasterMaskChecksum(asset: RasterMaskAsset): RasterMaskAsset {
  if (
    typeof asset.checksum !== 'string' ||
    !/^[a-f0-9]{16}$/.test(asset.checksum) ||
    hashContent(asset.dataUrl) !== asset.checksum
  ) {
    return asset;
  }
  return { ...asset, checksum: sha256Utf8(asset.dataUrl) };
}

export function sanitizeRasterMaskState(doc: Document, warnings: DocumentCodecWarning[]): Document {
  const normalizedAssets = Object.entries(doc.rasterMaskAssets ?? {}).map(
    ([assetId, asset]) => [assetId, upgradeLegacyRasterMaskChecksum(asset)] as const,
  );
  const validAssets = Object.fromEntries(
    normalizedAssets.filter(([assetId, asset]) => {
      const error = validateRasterMaskAsset(asset);
      if (!error) return true;
      warnings.push(
        warning('document.invalid-raster-mask', error, 'error', `rasterMaskAssets.${assetId}`),
      );
      return false;
    }),
  );
  const candidate = { ...doc, rasterMaskAssets: validAssets };
  const nodes: Record<NodeId, SceneNode> = {};
  const referencedAssets = new Set<string>();
  const invalidatedAssets = new Set<string>();

  for (const [nodeId, node] of Object.entries(doc.nodes)) {
    const rasterMask = node.mask?.rasterMask;
    if (!rasterMask) {
      nodes[nodeId] = node;
      continue;
    }
    const targetError =
      rasterMask.coordinateSpace === 'source-image-pixels'
        ? !hasImageFill(candidate, node) && !hasDepthMaskSource(candidate, node)
          ? 'Source-pixel raster masks require an image-filled shape node'
          : null
        : rasterMask.coordinateSpace === 'container-local-pixels'
          ? node.kind !== 'frame'
            ? 'Container-local raster masks require a frame node'
            : null
          : rasterMask.coordinateSpace === 'node-local-pixels' && !isVisualMaskTarget(node)
            ? 'Node-local raster masks require a visual leaf node'
            : null;
    const error = validateMaskSource(candidate, node.mask!) ?? targetError;
    if (error) {
      warnings.push(
        warning('document.invalid-raster-mask', `${nodeId}: ${error}`, 'error', `${nodeId}.mask`),
      );
      invalidatedAssets.add(rasterMask.assetId);
      const { mask: _invalidMask, ...rest } = node;
      nodes[nodeId] = rest as SceneNode;
      continue;
    }
    if (rasterMask.depthRecipe) {
      const recipeError = validateDepthMaskRecipe(rasterMask.depthRecipe, candidate);
      if (recipeError) {
        warnings.push(
          warning(
            'document.invalid-depth-mask-recipe',
            `${nodeId}: ${recipeError}; the last resolved raster mask was retained`,
            'warning',
            `${nodeId}.mask.rasterMask.depthRecipe`,
          ),
        );
        // A missing depth resource is recoverable: the immutable resolved
        // coverage can still protect an adjustment's output while the user
        // imports/relinks the map. Only discard the recipe when its source
        // binding cannot be proved safe; image masks can fall back to the
        // established generic raster-mask form.
        const retainAdjustmentRecipe =
          node.kind === 'adjustment' && hasDepthMaskSource(candidate, node);
        nodes[nodeId] = retainAdjustmentRecipe
          ? node
          : ({
              ...node,
              mask: { ...node.mask!, rasterMask: { ...rasterMask, depthRecipe: undefined } },
            } as SceneNode);
        referencedAssets.add(rasterMask.assetId);
        continue;
      }
    }
    referencedAssets.add(rasterMask.assetId);
    nodes[nodeId] = node;
  }

  const rasterMaskAssets = Object.fromEntries(
    Object.entries(validAssets).filter(
      ([assetId]) => !invalidatedAssets.has(assetId) || referencedAssets.has(assetId),
    ),
  );
  return {
    ...doc,
    nodes,
    rasterMaskAssets: Object.keys(rasterMaskAssets).length > 0 ? rasterMaskAssets : undefined,
  };
}

function isSupportedClipSource(node: SceneNode | undefined): boolean {
  if (!node) return false;
  if (node.kind === 'frame') return true;
  if (node.kind !== 'shape') return false;
  return (
    node.shape.kind !== 'line' &&
    node.shape.kind !== 'arrow' &&
    (node.shape.kind !== 'path' || node.shape.closed)
  );
}

/**
 * Recover malformed structural masks at the persistence boundary. Keeping the
 * container and its children is lossless; only the unusable relationship is
 * removed, with a warning callers can surface to the user.
 */
export function sanitizeStructuralMaskState(
  doc: Document,
  warnings: DocumentCodecWarning[],
): Document {
  let changed = false;
  const nodes: Record<NodeId, SceneNode> = { ...doc.nodes };
  for (const [nodeId, node] of Object.entries(doc.nodes)) {
    const mask = node.mask;
    if (!mask || mask.rasterMask) continue;

    let error = validateMaskSource(doc, mask);
    if (!error && !['clip', 'alpha', 'luminance'].includes(mask.type)) {
      error = 'Mask type is unsupported';
    }
    if (!error && mask.vectorMask && !mask.vectorMask.closed) {
      error = 'Vector masks must use a closed path';
    }
    if (!error && mask.sourceNodeId) {
      const source = doc.nodes[mask.sourceNodeId];
      if (!source) {
        error = `Missing mask source ${mask.sourceNodeId}`;
      } else if (isContainer(node) && !node.children.includes(mask.sourceNodeId)) {
        error = `Mask source ${mask.sourceNodeId} must be a direct child of ${nodeId}`;
      } else if (mask.type === 'clip' && !mask.vectorMask && !isSupportedClipSource(source)) {
        error = `Mask source ${mask.sourceNodeId} cannot produce a closed clipping outline`;
      }
    }
    if (!error) continue;

    const { mask: _invalidMask, ...rest } = node;
    nodes[nodeId] = rest as SceneNode;
    changed = true;
    warnings.push(
      warning(
        'document.invalid-structural-mask',
        `${nodeId}: ${error}`,
        'warning',
        `${nodeId}.mask`,
      ),
    );
  }
  return changed ? { ...doc, nodes } : doc;
}
