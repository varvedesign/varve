import type { ImagePlacement, ImagePlacementRect } from '../imagePlacement';
import type { ReplayTarget } from '../replayTypes';
import { drawPlacedImageSample } from './imageSample';

const MASK_CACHE_MAX_ENTRIES = 24;
const MASK_CACHE_MAX_PIXELS = 16_777_216;
const maskedImageCache = new Map<string, HTMLCanvasElement>();
const maskedImageSourceIds = new WeakMap<object, number>();
let maskedImageCachePixels = 0;
let nextMaskedImageSourceId = 1;

function maskedImageSourceId(source: CanvasImageSource): number {
  const object = source as unknown as object;
  const existing = maskedImageSourceIds.get(object);
  if (existing !== undefined) return existing;
  const id = nextMaskedImageSourceId++;
  maskedImageSourceIds.set(object, id);
  return id;
}

/** Map original source pixels into a bounded mask proxy's pixel grid. */
export function maskSourceScale(
  mask: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
) {
  const sized = mask as {
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
  };
  return {
    x: (sized.naturalWidth || sized.width || sourceWidth) / sourceWidth,
    y: (sized.naturalHeight || sized.height || sourceHeight) / sourceHeight,
  };
}

export function renderMaskedImageSample(
  image: CanvasImageSource,
  mask: CanvasImageSource,
  placement: ImagePlacement,
  bounds: ImagePlacementRect,
  imageKey: string,
  maskKey: string,
  sourceScale = { x: 1, y: 1 },
  maskScale = { x: 1, y: 1 },
): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const width = Math.max(1, Math.ceil(bounds.w));
  const height = Math.max(1, Math.ceil(bounds.h));
  const pixels = width * height;
  if (
    !Number.isSafeInteger(pixels) ||
    pixels > MASK_CACHE_MAX_PIXELS ||
    width > 8192 ||
    height > 8192
  ) {
    return null;
  }
  const key = [
    imageKey,
    maskKey,
    maskedImageSourceId(image),
    maskedImageSourceId(mask),
    width,
    height,
    placement.drawRect.x - bounds.x,
    placement.drawRect.y - bounds.y,
    placement.drawRect.w,
    placement.drawRect.h,
    placement.sourceRect.x,
    placement.sourceRect.y,
    placement.sourceRect.w,
    placement.sourceRect.h,
    sourceScale.x,
    sourceScale.y,
    maskScale.x,
    maskScale.y,
    placement.rotation,
    placement.flipH,
    placement.flipV,
  ].join('|');
  const cached = maskedImageCache.get(key);
  if (cached) {
    maskedImageCache.delete(key);
    maskedImageCache.set(key, cached);
    return cached;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.translate(-bounds.x, -bounds.y);
  drawPlacedImageSample(
    context as unknown as ReplayTarget,
    image,
    placement,
    placement.drawRect,
    placement.sampleDrawRect,
    sourceScale,
  );
  context.globalCompositeOperation = 'destination-in';
  drawPlacedImageSample(
    context as unknown as ReplayTarget,
    mask,
    placement,
    placement.drawRect,
    placement.sampleDrawRect,
    maskScale,
  );

  maskedImageCache.set(key, canvas);
  maskedImageCachePixels += pixels;
  while (
    maskedImageCache.size > MASK_CACHE_MAX_ENTRIES ||
    maskedImageCachePixels > MASK_CACHE_MAX_PIXELS
  ) {
    const oldest = maskedImageCache.entries().next().value as
      | [string, HTMLCanvasElement]
      | undefined;
    if (!oldest) break;
    maskedImageCache.delete(oldest[0]);
    maskedImageCachePixels -= oldest[1].width * oldest[1].height;
  }
  return canvas;
}
