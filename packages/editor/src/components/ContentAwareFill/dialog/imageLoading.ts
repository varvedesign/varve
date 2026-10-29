import { type CachedImage, cachedImageDims, getImageCache } from '@varve/engine';
import type { VisibleSourceOverlay } from './sourceOverlays';

export async function loadBoundedImageSource(
  src: string,
  sourceWidth: number,
  sourceHeight: number,
  maxDimension: number,
): Promise<CachedImage> {
  return getImageCache().loadAtSize(
    src,
    maxDimension,
    sourceWidth > 0 && sourceHeight > 0 ? { width: sourceWidth, height: sourceHeight } : undefined,
  );
}

/**
 * Build the currently visible source at proxy resolution. Bounded accepted
 * edits are stored as transparent patches above the immutable base fill; a
 * repeated edit must see those patches in its context or it would regress to
 * the original pixels on the next generation.
 */
export async function loadVisibleImageSource(
  source: string,
  sourceWidth: number,
  sourceHeight: number,
  maxDimension: number,
  overlays: readonly VisibleSourceOverlay[],
): Promise<CachedImage | HTMLCanvasElement> {
  const base = await loadBoundedImageSource(source, sourceWidth, sourceHeight, maxDimension);
  if (overlays.length === 0) return base;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('Visible source dimensions are unavailable');
  }
  const baseDimensions = cachedImageDims(base);
  if (!baseDimensions.width || !baseDimensions.height) {
    throw new Error('Visible source proxy dimensions are unavailable');
  }
  const canvas = document.createElement('canvas');
  canvas.width = baseDimensions.width;
  canvas.height = baseDimensions.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Visible source proxy canvas is unavailable');
  context.drawImage(base, 0, 0, canvas.width, canvas.height);

  for (const overlay of overlays) {
    const patch = await loadBoundedImageSource(
      overlay.src,
      overlay.width,
      overlay.height,
      maxDimension,
    );
    const patchDimensions = cachedImageDims(patch);
    if (!patchDimensions.width || !patchDimensions.height) {
      throw new Error('Visible generative overlay dimensions are unavailable');
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      patch,
      0,
      0,
      patchDimensions.width,
      patchDimensions.height,
      (overlay.x / sourceWidth) * canvas.width,
      (overlay.y / sourceHeight) * canvas.height,
      (overlay.frameWidth / sourceWidth) * canvas.width,
      (overlay.frameHeight / sourceHeight) * canvas.height,
    );
  }
  return canvas;
}

export function imageSourceDims(image: CachedImage | HTMLCanvasElement): {
  width: number;
  height: number;
} {
  return image instanceof HTMLCanvasElement
    ? { width: image.width, height: image.height }
    : cachedImageDims(image);
}

export async function loadImageToImageData(
  src: string,
  targetWidth?: number,
  targetHeight?: number,
  sourceWidth = 0,
  sourceHeight = 0,
): Promise<ImageData> {
  if (!targetWidth || !targetHeight || targetWidth <= 0 || targetHeight <= 0) {
    throw new Error('A bounded target size is required');
  }
  const image = await loadBoundedImageSource(
    src,
    sourceWidth,
    sourceHeight,
    Math.max(targetWidth, targetHeight),
  );
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Failed to get canvas context');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}
