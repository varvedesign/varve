import { putMaskCoverage } from '../maskOperations';
import { MAX_PREVIEW_PIXELS, MAX_VARIATION_THUMBNAIL_DIMENSION } from './constants';

export function previewRasterDimensions(
  width: number,
  height: number,
): { width: number; height: number } {
  const scale = Math.min(1, Math.sqrt(MAX_PREVIEW_PIXELS / Math.max(1, width * height)));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function maskCoverageDataUrl(coverage: Uint8Array, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  putMaskCoverage(context, coverage, { width, height });
  return canvas.toDataURL('image/png');
}

export function imageDataDataUrl(imageData: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

export function thumbnailDimensions(
  width: number,
  height: number,
): { width: number; height: number } {
  const scale = Math.min(1, MAX_VARIATION_THUMBNAIL_DIMENSION / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Encode only a bounded preview for inactive variation cards. */
export function thumbnailDataUrlFromCanvas(source: HTMLCanvasElement): string {
  const dimensions = thumbnailDimensions(source.width, source.height);
  if (dimensions.width === source.width && dimensions.height === source.height) {
    return source.toDataURL('image/png');
  }
  const thumbnail = document.createElement('canvas');
  thumbnail.width = dimensions.width;
  thumbnail.height = dimensions.height;
  const context = thumbnail.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'medium';
  context.drawImage(source, 0, 0, dimensions.width, dimensions.height);
  return thumbnail.toDataURL('image/png');
}
