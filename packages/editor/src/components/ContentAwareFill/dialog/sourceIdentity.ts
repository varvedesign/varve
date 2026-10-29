import { cachedImageDims, getImageCache } from '@varve/engine';
import { fingerprintImageData } from '../../../context/imageFingerprint';
import { MAX_SOURCE_IDENTITY_PIXELS } from './constants';

/** Read the current source pixels for a last-mile Object Selection freshness check. */
export async function readCurrentSourceIdentity(
  src: string,
): Promise<{ width: number; height: number; fingerprint: string } | null> {
  if (typeof document === 'undefined' || !src) return null;
  try {
    const cache = getImageCache();
    cache.evict(src);
    const image = await cache.load(src);
    const { width, height } = cachedImageDims(image);
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return null;
    }
    // Identity verification itself must not defeat the image-inference memory
    // guard. Embedded/blob sources are handled without this read below; this
    // limit protects mutable URL sources from a second full-resolution buffer.
    if (width * height > MAX_SOURCE_IDENTITY_PIXELS) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);
    return {
      width,
      height,
      fingerprint: await fingerprintImageData(context.getImageData(0, 0, width, height)),
    };
  } catch {
    return null;
  }
}
