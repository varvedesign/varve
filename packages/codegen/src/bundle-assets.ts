/**
 * Bundle asset plumbing: raster fallbacks and image fills become real files
 * with stable, content-addressed relative paths.
 *
 * Design constraints:
 * - Content-addressed paths make regeneration deterministic — an unchanged
 *   artwork produces the same `assets/<hash>.png`, so a regeneration plan can
 *   prove "unchanged" by path alone.
 * - Deduplication is by decoded bytes (not by node or by data URL spelling),
 *   so the same art used by two nodes ships once.
 * - The scene model's `sha256Hex` is the single hash implementation; bundles
 *   must not invent a second digest format.
 */

import { sha256Hex } from '@varve/scene';
import type { BundleAsset, RasterAsset } from './types';

/**
 * Resolve a bundle's asset profile from emitter options.
 *
 * `assetMode: 'inline'` (the default) keeps raster bytes as data URLs inside
 * the code files — the self-contained snippet profile. `'files'` produces
 * content-addressed asset files and rewrites every reference to the stable
 * relative path — the portable bundle profile. Failed decodes surface in
 * `failedNodeIds` so callers can fail loudly instead of emitting dangling
 * references.
 */
export function resolveBundleAssets(opts: {
  rasterAssets?: Record<string, RasterAsset>;
  assetMode?: 'inline' | 'files';
}): { assetPaths?: Record<string, string>; assets?: BundleAsset[]; failedNodeIds: string[] } {
  if (
    !opts.rasterAssets ||
    Object.keys(opts.rasterAssets).length === 0 ||
    opts.assetMode !== 'files'
  ) {
    return { failedNodeIds: [] };
  }
  const built = buildBundleAssets(opts.rasterAssets);
  return {
    assetPaths: built.pathsByNode,
    assets: built.assets,
    failedNodeIds: built.failedNodeIds,
  };
}

/** Parse a `data:` URL into its MIME type and exact bytes. */
export function dataUrlToBytes(dataUrl: string): { mimeType: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const mimeType = match[1] || 'application/octet-stream';
  const payload = match[3] ?? '';
  if (match[2]) {
    try {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return { mimeType, bytes };
    } catch {
      return null;
    }
  }
  // Percent-encoded (non-base64) data URL.
  try {
    const text = decodeURIComponent(payload);
    return { mimeType, bytes: new TextEncoder().encode(text) };
  } catch {
    return null;
  }
}

/** Encode bytes as a base64 data URL (the inverse of `dataUrlToBytes`). */
export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/** File extension for a raster MIME type. Unknown types keep `.bin`. */
function extensionForMime(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/svg+xml') return 'svg';
  if (mimeType === 'image/avif') return 'avif';
  return 'bin';
}

/**
 * Convert the export compositor's raster fallbacks into bundle assets.
 *
 * Returns `null` for an asset whose data URL cannot be decoded — callers
 * must treat that as a failed fallback (a bundle entry that cannot be
 * written is not a bundle entry), never as an empty file.
 */
export function bundleAssetFromRaster(asset: RasterAsset): BundleAsset | null {
  const decoded = dataUrlToBytes(asset.dataUrl);
  if (!decoded) return null;
  const sha256 = sha256Hex(decoded.bytes);
  return {
    path: `assets/${sha256.slice(0, 16)}.${extensionForMime(decoded.mimeType)}`,
    mimeType: decoded.mimeType,
    bytes: decoded.bytes,
    sha256,
    role: 'raster-fallback',
    pixelWidth: asset.pixelWidth,
    pixelHeight: asset.pixelHeight,
    cssWidth: asset.cssWidth,
    cssHeight: asset.cssHeight,
    sourceNodeId: asset.nodeId,
  };
}

/**
 * Build the deduplicated asset list for a bundle from the compositor's
 * raster fallbacks, plus the `nodeId → relative path` map emitters use to
 * reference them.
 *
 * Two nodes rasterizing to identical bytes share one file; a node whose
 * fallback failed to decode is simply absent from the path map so callers
 * can report it rather than emit a dangling reference.
 */
export function buildBundleAssets(assets: Record<string, RasterAsset>): {
  assets: BundleAsset[];
  pathsByNode: Record<string, string>;
  failedNodeIds: string[];
} {
  const byContent = new Map<string, BundleAsset>();
  // Node IDs are arbitrary document strings, so avoid Object.prototype keys
  // such as "__proto__" changing the lookup object's behavior.
  const pathsByNode: Record<string, string> = Object.create(null);
  const failedNodeIds: string[] = [];

  for (const [nodeId, raster] of Object.entries(assets)) {
    const bundleAsset = bundleAssetFromRaster(raster);
    if (!bundleAsset) {
      failedNodeIds.push(nodeId);
      continue;
    }
    const existing = byContent.get(bundleAsset.sha256);
    if (existing) {
      pathsByNode[nodeId] = existing.path;
    } else {
      byContent.set(bundleAsset.sha256, bundleAsset);
      pathsByNode[nodeId] = bundleAsset.path;
    }
  }

  return { assets: [...byContent.values()], pathsByNode, failedNodeIds };
}
