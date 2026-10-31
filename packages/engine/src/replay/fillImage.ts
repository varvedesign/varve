import { getImageCache } from '../imageCache';
import { imagePlaceholderFill } from '../imagePlaceholder';
import {
  computeImagePlacement,
  type ImagePlacement,
  type ImagePlacementRect,
} from '../imagePlacement';
import {
  projectedLongEdgeForTransform,
  type ReplayImagePolicy,
  resolveReplayImage,
} from '../mockup/warpReplay';
import type { ReplayTarget } from '../replayTypes';
import type { FillIR, RenderItem } from '../types';
import { maskSourceScale, renderMaskedImageSample } from './fillImageMask';
import { drawPlacedImageSample } from './imageSample';
import { primitiveBounds } from './primitiveBounds';
import { replayRuntime } from './runtime';
/** Paint an image fill over the primitive bounds. */
export function paintImageFill(
  target: ReplayTarget,
  fill: Extract<FillIR, { type: 'image' }>,
  item: RenderItem,
): void {
  const bounds = primitiveBounds(item.primitive);
  const bw = bounds.w || 1;
  const bh = bounds.h || 1;
  const baseImagePolicy = replayRuntime.imagePolicy as ReplayImagePolicy | undefined;
  const maxSourceDim = baseImagePolicy?.resolveMaxSourceDim?.({
    projectedLongEdge: projectedLongEdgeForTransform(bw, bh, target.getTransform?.()),
    sourceWidth: fill.imageWidth,
    sourceHeight: fill.imageHeight,
  });
  const imagePolicy =
    maxSourceDim && maxSourceDim > 0 ? { ...baseImagePolicy, maxSourceDim } : baseImagePolicy;

  const image = resolveReplayImage(
    fill.src,
    replayRuntime.imageLookup,
    getImageCache(),
    fill.frame,
    {
      ...imagePolicy,
      sourceWidth: fill.imageWidth,
      sourceHeight: fill.imageHeight,
    },
  );

  if (!target.drawImage) {
    target.fillRect(bounds.x, bounds.y, bw, bh);
    return;
  }

  if (!image) {
    const prev = target.fillStyle;
    target.fillStyle = imagePlaceholderFill(fill.src);
    target.fillRect(bounds.x, bounds.y, bw, bh);
    target.fillStyle = prev;
    return;
  }

  const sizedImage = image as CanvasImageSource & {
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
  };
  const fullSourceWidth = fill.imageWidth || sizedImage.naturalWidth || sizedImage.width || bw;
  const fullSourceHeight = fill.imageHeight || sizedImage.naturalHeight || sizedImage.height || bh;
  const actualSourceWidth = sizedImage.naturalWidth || sizedImage.width || fullSourceWidth;
  const actualSourceHeight = sizedImage.naturalHeight || sizedImage.height || fullSourceHeight;
  const sourceScale = {
    x: actualSourceWidth / Math.max(1, fullSourceWidth),
    y: actualSourceHeight / Math.max(1, fullSourceHeight),
  };

  const placement = computeImagePlacement({
    fit: fill.fit ?? 'fill',
    sourceWidth: fullSourceWidth,
    sourceHeight: fullSourceHeight,
    bounds,
    x: fill.x ?? 0,
    y: fill.y ?? 0,
    scale: fill.scale ?? 1,
    sourceCrop: fill.crop,
    rotation: fill.rotation,
    flipH: fill.flipH,
    flipV: fill.flipV,
  });
  if (!placement) return;
  const { x: dx, y: dy, w: dw, h: dh } = placement.drawRect;

  if (placement.fit === 'tile') {
    for (let ty = dy; ty < bounds.y + bh; ty += dh) {
      for (let tx = dx; tx < bounds.x + bw; tx += dw) {
        const tileRect = { x: tx, y: ty, w: dw, h: dh };
        const sampleRect = offsetSampleRect(placement, tileRect);
        drawPlacedImageSample(target, image, placement, tileRect, sampleRect, sourceScale);
      }
    }
    return;
  }

  // Apply alpha mask via offscreen compositing (background removal on shape nodes).
  // Worker capability checks reject these scenes because workers have no DOM canvas.
  if (fill.alphaMask && typeof document !== 'undefined') {
    const maskImg = getImageCache().getImage(fill.alphaMask);
    // Trigger async load for mask if not yet cached (mirrors base image load pattern)
    if (!maskImg) {
      const maskEntry = getImageCache().get(fill.alphaMask);
      if (!maskEntry || maskEntry.state === 'idle') {
        getImageCache()
          .load(fill.alphaMask)
          .catch(() => {
            /* errors recorded in cache entry */
          });
      }
    }
    if (maskImg) {
      const maskScale = maskSourceScale(maskImg, fullSourceWidth, fullSourceHeight);
      try {
        const masked = renderMaskedImageSample(
          image,
          maskImg,
          placement,
          bounds,
          fill.src,
          fill.alphaMask,
          sourceScale,
          maskScale,
        );
        if (masked) {
          target.drawImage(masked, bounds.x, bounds.y, bounds.w, bounds.h);
        } else {
          drawPlacedImageSample(
            target,
            image,
            placement,
            placement.drawRect,
            placement.sampleDrawRect,
            sourceScale,
          );
        }
      } catch {
        drawPlacedImageSample(
          target,
          image,
          placement,
          placement.drawRect,
          placement.sampleDrawRect,
        );
      }
    } else {
      drawPlacedImageSample(
        target,
        image,
        placement,
        placement.drawRect,
        placement.sampleDrawRect,
        sourceScale,
      );
    }
  } else {
    drawPlacedImageSample(
      target,
      image,
      placement,
      placement.drawRect,
      placement.sampleDrawRect,
      sourceScale,
    );
  }
}

function offsetSampleRect(
  placement: ImagePlacement,
  drawRect: ImagePlacementRect,
): ImagePlacementRect {
  return {
    x: placement.sampleDrawRect.x + drawRect.x - placement.drawRect.x,
    y: placement.sampleDrawRect.y + drawRect.y - placement.drawRect.y,
    w: placement.sampleDrawRect.w,
    h: placement.sampleDrawRect.h,
  };
}
