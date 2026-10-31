import type { ImagePlacement, ImagePlacementRect } from '../imagePlacement';
import type { ReplayTarget } from '../replayTypes';

/** Draw a placed image sample, honoring the placement's rotation and flips. */
export function drawPlacedImageSample(
  target: ReplayTarget,
  image: CanvasImageSource,
  placement: ImagePlacement,
  drawRect: ImagePlacementRect,
  sampleDrawRect: ImagePlacementRect,
  sourceScale = { x: 1, y: 1 },
): void {
  const { x, y, w, h } = placement.sourceRect;
  const sx = x * sourceScale.x;
  const sy = y * sourceScale.y;
  const sw = w * sourceScale.x;
  const sh = h * sourceScale.y;
  const hasTransform = placement.rotation !== 0 || placement.flipH || placement.flipV;
  if (!hasTransform) {
    target.drawImage?.(
      image,
      sx,
      sy,
      sw,
      sh,
      sampleDrawRect.x,
      sampleDrawRect.y,
      sampleDrawRect.w,
      sampleDrawRect.h,
    );
    return;
  }
  const cx = drawRect.x + drawRect.w / 2;
  const cy = drawRect.y + drawRect.h / 2;
  target.save();
  applyImageTransform(target, cx, cy, placement.rotation, placement.flipH, placement.flipV);
  target.drawImage?.(
    image,
    sx,
    sy,
    sw,
    sh,
    sampleDrawRect.x - cx,
    sampleDrawRect.y - cy,
    sampleDrawRect.w,
    sampleDrawRect.h,
  );
  target.restore();
}

/**
 * Apply rotation and flip transforms to the canvas context, centered at (cx, cy).
 * The caller is responsible for save/restore and must draw centered at origin
 * (i.e. drawImage with dest rect centered at 0,0).
 */
function applyImageTransform(
  ctx: ReplayTarget,
  cx: number,
  cy: number,
  rotationDeg: number,
  flipH?: boolean,
  flipV?: boolean,
): void {
  ctx.translate(cx, cy);
  if (Math.abs(((rotationDeg % 360) + 360) % 360) > 0.001) {
    ctx.rotate((rotationDeg * Math.PI) / 180);
  }
  const scaleX = flipH ? -1 : 1;
  const scaleY = flipV ? -1 : 1;
  if (scaleX !== 1 || scaleY !== 1) {
    ctx.scale(scaleX, scaleY);
  }
}
