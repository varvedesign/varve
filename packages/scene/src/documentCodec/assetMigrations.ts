import {
  hashContent,
  isAssetReferenced,
  mimeTypeFromDataUrl,
  pruneUnusedIccProfiles,
  validateDocumentAsset,
  validateIccProfileEntry,
} from '../assets';
import type { Document } from '../document';
import { isIconAssetReferenced, validateIconAsset } from '../iconAsset';
import type { NodeId, SceneNode } from '../types';
import { normalizeImageFillData } from '../types';
import { rehydrateEmbeddedAssetSrc } from '../version';
import type { DocumentCodecWarning } from './types';
import { warning } from './validation';

/**
 * Sanitize Document.iconAssets: drop structurally invalid entries with a
 * warning, then prune entries no longer referenced by any node's
 * `iconAssetId`. Unreferenced assets are safe to drop because the icon's
 * vector data already lives in the node subtree (the asset is provenance
 * metadata, not the payload).
 */
export function sanitizeIconAssetState(doc: Document, warnings: DocumentCodecWarning[]): Document {
  if (!doc.iconAssets) return doc;
  const validAssets = Object.fromEntries(
    Object.entries(doc.iconAssets).filter(([assetId, asset]) => {
      const error = validateIconAsset(asset);
      if (!error) return true;
      warnings.push(
        warning('document.invalid-icon-asset', error, 'error', `iconAssets.${assetId}`),
      );
      return false;
    }),
  );
  const referenced = Object.fromEntries(
    Object.entries(validAssets).filter(([assetId]) => isIconAssetReferenced(doc, assetId)),
  );
  return {
    ...doc,
    iconAssets: Object.keys(referenced).length > 0 ? referenced : undefined,
  };
}

/**
 * Sanitize Document.assets (v2.6+, see ./assets.ts): drop structurally
 * invalid entries with a warning, materialize `ImageFillData.src` from the
 * (now-valid) asset table so every downstream reader sees a normal src
 * string, then garbage-collect entries no longer referenced by any node or
 * paint. Mirrors sanitizeRasterMaskState's drop/repair/prune shape above.
 */
/**
 * Maximum inline data URL payload size to auto-register as an asset (10 MB).
 * Larger payloads are logged and left inline to avoid blocking document load.
 */
const MAX_INLINE_ASSET_BYTES = 10_000_000;

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/svg+xml',
]);

/**
 * Normalize inline image fills — detect images with inline data URLs that
 * lack an assetId, create deduplicated asset entries, and set assetId on
 * the fill. This ensures drag-and-drop, paste, and import-created image
 * fills benefit from content-hash dedup and portable archive packing.
 *
 * Runs as part of DocumentCodec.decode so every loaded document is normalized.
 * The src field is preserved (rehydrateEmbeddedAssetSrc will continue to work);
 * the assetId is added alongside it.
 */
export function normalizeInlineImageFills(
  doc: Document,
  warnings: DocumentCodecWarning[],
): Document {
  let changed = false;
  let assets = doc.assets ? { ...doc.assets } : undefined;

  /**
   * Process a single ImageFillData, creating an asset if it has an inline
   * data URL but no assetId. Returns the (possibly updated) image fill data.
   */
  function processImageFill(
    imageFill: {
      src?: string;
      assetId?: string;
      imageWidth?: number;
      imageHeight?: number;
    },
    nodeId: string,
    fillIndex: number,
  ): void {
    const src = imageFill.src;
    if (!src?.startsWith('data:image/')) return;
    if (imageFill.assetId) return; // already registered

    // Check MIME type
    const mimeType = mimeTypeFromDataUrl(src);
    if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
      warnings.push(
        warning(
          'document.unsupported-inline-image-format',
          `Image fill on node ${nodeId} fill[${fillIndex}] has unsupported format '${mimeType}'`,
          'warning',
          `${nodeId}.fills[${fillIndex}]`,
        ),
      );
      return;
    }

    // Check payload size (approximate from data URL length)
    const payloadStart = src.indexOf(',') + 1;
    const payload = payloadStart > 0 ? src.slice(payloadStart) : '';
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
    const approxSize = Math.floor((payload.length * 3) / 4) - padding;
    if (approxSize > MAX_INLINE_ASSET_BYTES) {
      warnings.push(
        warning(
          'document.oversized-inline-image',
          `Image fill on node ${nodeId} fill[${fillIndex}] (${approxSize} bytes) exceeds inline asset limit`,
          'info',
          `${nodeId}.fills[${fillIndex}]`,
        ),
      );
      // Don't block load — leave inline
      return;
    }

    const hash = hashContent(src);
    const assetId = `asset-${hash}`;

    // Check if asset already exists
    if (assets?.[assetId]) {
      imageFill.assetId = assetId;
      changed = true;
      return;
    }

    // Create the asset entry
    if (!assets) assets = {};
    assets[assetId] = {
      id: assetId,
      storage: 'embedded' as const,
      mimeType,
      dataUrl: src,
      naturalWidth: imageFill.imageWidth ?? 0,
      naturalHeight: imageFill.imageHeight ?? 0,
      byteLength: approxSize,
      hash,
    };
    imageFill.assetId = assetId;
    changed = true;
  }

  // Scan all nodes
  for (const [nodeId, node] of Object.entries(doc.nodes)) {
    if (!node?.fills) continue;
    for (let i = 0; i < node.fills.length; i++) {
      const fill = node.fills[i];
      if (fill?.type === 'image' && fill.image) {
        processImageFill(fill.image, nodeId, i);
      }
    }
  }

  // Scan shared paints
  if (doc.paints) {
    for (const [paintId, paint] of Object.entries(doc.paints)) {
      if (paint.fill?.type === 'image' && paint.fill.image) {
        processImageFill(paint.fill.image, `paint:${paintId}`, 0);
      }
    }
  }

  if (!changed) return doc;
  return { ...doc, assets };
}

export function sanitizeImageAssetState(doc: Document, warnings: DocumentCodecWarning[]): Document {
  const validAssets = Object.fromEntries(
    Object.entries(doc.assets ?? {}).filter(([assetId, asset]) => {
      const error = validateDocumentAsset(asset);
      if (!error) return true;
      warnings.push(warning('document.invalid-image-asset', error, 'error', `assets.${assetId}`));
      return false;
    }),
  );
  const withValidAssets: Document = {
    ...doc,
    assets: Object.keys(validAssets).length > 0 ? validAssets : undefined,
  };
  const rehydrated = rehydrateEmbeddedAssetSrc(
    withValidAssets as unknown as Record<string, unknown>,
  ) as unknown as Document;

  const referencedAssets = Object.fromEntries(
    Object.entries(validAssets).filter(([assetId]) => isAssetReferenced(rehydrated, assetId)),
  );
  // ICC profiles are validated and pruned with the same pass: an entry with
  // invalid payload is dropped (with a warning), and entries no longer
  // referenced by any surviving asset metadata are garbage-collected.
  const validProfiles = Object.fromEntries(
    Object.entries(rehydrated.iccProfiles ?? {}).filter(([profileId, entry]) => {
      const error = validateIccProfileEntry(entry);
      if (!error) return true;
      warnings.push(
        warning('document.invalid-icc-profile', error, 'error', `iccProfiles.${profileId}`),
      );
      return false;
    }),
  );
  const withProfiles = {
    ...rehydrated,
    iccProfiles: Object.keys(validProfiles).length > 0 ? validProfiles : undefined,
  };
  const prunedProfiles = pruneUnusedIccProfiles(withProfiles);
  return {
    ...prunedProfiles,
    assets: Object.keys(referencedAssets).length > 0 ? referencedAssets : undefined,
  };
}

export function normalizeImageFillGeometry(doc: Document): Document {
  const normalizeImage = (image: NonNullable<SceneNode['fills']>[number]['image']) => {
    if (!image) return image;
    const asset = image.assetId ? doc.assets?.[image.assetId] : undefined;
    return normalizeImageFillData(
      image,
      asset ? { width: asset.naturalWidth, height: asset.naturalHeight } : undefined,
    );
  };
  const nodes = Object.fromEntries(
    Object.entries(doc.nodes).map(([nodeId, node]) => [
      nodeId,
      node.fills
        ? {
            ...node,
            fills: node.fills.map((fill) =>
              fill.type === 'image' && fill.image
                ? { ...fill, image: normalizeImage(fill.image) }
                : fill,
            ),
          }
        : node,
    ]),
  ) as Record<NodeId, SceneNode>;
  const paints = doc.paints
    ? Object.fromEntries(
        Object.entries(doc.paints).map(([paintId, paint]) => [
          paintId,
          paint.fill.type === 'image' && paint.fill.image
            ? {
                ...paint,
                fill: { ...paint.fill, image: normalizeImage(paint.fill.image) },
              }
            : paint,
        ]),
      )
    : undefined;

  return {
    ...doc,
    nodes,
    ...(paints ? { paints } : {}),
  };
}
