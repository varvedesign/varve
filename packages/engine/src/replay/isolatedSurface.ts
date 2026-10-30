import { blendPixels, mapBlendMode } from '../compositeCanvas';
import { applyFilterWithCompositing } from '../filterCompositor';
import { withoutIdentityFilters } from '../filterIdentity';
import { computePointwiseFilterSurface } from '../filterSurfaceRegion';
import { filterToCss, supportsCanvasFilter } from '../filters';
import type { ReplayImagePolicy } from '../mockup/warpReplay';
import { createRasterSurface } from '../rasterSurface';
import { effectMaskResolverForCurrentReplay, replayIr } from '../replay';
import type { ReplayTarget } from '../replayTypes';
import type { RenderItem } from '../types';
import { primitiveBounds } from './primitiveBounds';
import type { EffectMaskResolver, ReplayAffine, ReplayColorOptions } from './types';

function multiplyReplayAffine(left: ReplayAffine, right: ReplayAffine): ReplayAffine {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function invertReplayAffine(matrix: ReplayAffine): ReplayAffine | undefined {
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) return undefined;
  const inverse = 1 / determinant;
  return [
    matrix[3] * inverse,
    -matrix[1] * inverse,
    -matrix[2] * inverse,
    matrix[0] * inverse,
    (matrix[2] * matrix[5] - matrix[3] * matrix[4]) * inverse,
    (matrix[1] * matrix[4] - matrix[0] * matrix[5]) * inverse,
  ];
}

/**
 * Build object-local treatment coordinates for an isolated filter surface.
 * The surface itself is viewport-sized, but the treatments must evaluate in
 * the item's local space so grain, edge falloff, and spatial radii do not
 * change when the camera or object rotation changes.
 */
export function treatmentSpaceForReplayItem(
  camera: { a: number; b: number; c: number; d: number; e: number; f: number },
  item: RenderItem,
) {
  const cameraAffine: ReplayAffine = [camera.a, camera.b, camera.c, camera.d, camera.e, camera.f];
  const inverseCamera = invertReplayAffine(cameraAffine);
  const inverseItem = invertReplayAffine(item.transform);
  const bounds = primitiveBounds(item.primitive);
  if (!inverseCamera || !inverseItem || bounds.w <= 0 || bounds.h <= 0) return undefined;

  const localToDevice = multiplyReplayAffine(cameraAffine, item.transform);
  const scaleX = Math.hypot(localToDevice[0], localToDevice[1]);
  const scaleY = Math.hypot(localToDevice[2], localToDevice[3]);
  const pixelsPerUnit = Math.max(0.01, Math.sqrt(scaleX * scaleY));
  return {
    pixelToTreatment: multiplyReplayAffine(inverseItem, inverseCamera),
    bounds: { x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h },
    pixelsPerUnit,
  };
}

export function replayItemOnIsolatedSurface(
  target: ReplayTarget,
  item: RenderItem,
  imageLookup?: (src: string) => CanvasImageSource | undefined,
  effectMaskResolver?: EffectMaskResolver,
  imagePolicy?: ReplayImagePolicy,
  colorOptions?: ReplayColorOptions,
): boolean {
  const canvas = target.canvas;
  // Neutral entries must not force the isolated-surface round-trip: rendering
  // an item to an intermediate surface and drawing it back can shift
  // antialiased edge pixels even when no filter has an effect.
  const activeFilters =
    item.filters && item.filters.length > 0
      ? withoutIdentityFilters(item.filters)
      : (item.filters ?? []);
  const needsLinearBlend =
    colorOptions?.blendEvaluationSpace === 'linear-srgb' &&
    item.blendMode !== undefined &&
    item.blendMode !== 'normal';
  if (
    !canvas ||
    !target.drawImage ||
    !target.getTransform ||
    !target.setTransform ||
    (!activeFilters.some(
      (filter) =>
        !supportsCanvasFilter(target) ||
        filter.blendMode !== 'normal' ||
        (filter.opacity ?? 1) < 1 ||
        !filterToCss(filter),
    ) &&
      !needsLinearBlend) ||
    (needsLinearBlend && (!target.getImageData || !target.putImageData))
  ) {
    return false;
  }

  const matrix = target.getTransform();
  const region = computePointwiseFilterSurface({
    sourceBounds: primitiveBounds(item.primitive),
    cameraTransform: matrix,
    itemTransform: item.transform,
    strokes: item.strokes,
    filters: activeFilters,
    hasVisibleEffects: item.effects?.some((effect) => effect.visible) ?? false,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
  });
  const surfaceWidth = region?.width ?? canvas.width;
  const surfaceHeight = region?.height ?? canvas.height;

  let surface: ReturnType<typeof createRasterSurface>;
  try {
    surface = createRasterSurface(surfaceWidth, surfaceHeight);
  } catch {
    return false;
  }

  surface.context.setTransform(
    matrix.a,
    matrix.b,
    matrix.c,
    matrix.d,
    matrix.e - (region?.x ?? 0),
    matrix.f - (region?.y ?? 0),
  );
  replayIr(
    surface.context as unknown as ReplayTarget,
    [
      {
        ...item,
        opacity: 1,
        blendMode: 'normal',
        filters: undefined,
      },
    ],
    imageLookup,
    effectMaskResolver ?? effectMaskResolverForCurrentReplay ?? undefined,
    imagePolicy,
    colorOptions,
  );
  applyFilterWithCompositing(
    surface.context as CanvasRenderingContext2D,
    activeFilters,
    surfaceWidth,
    surfaceHeight,
    { treatmentSpace: treatmentSpaceForReplayItem(matrix, item) },
  );

  if (needsLinearBlend && target.getImageData && target.putImageData) {
    const x = region?.x ?? 0;
    const y = region?.y ?? 0;
    const backdrop = target.getImageData(x, y, surfaceWidth, surfaceHeight);
    const source = surface.context.getImageData(0, 0, surfaceWidth, surfaceHeight);
    target.putImageData(
      blendPixels(backdrop, source, item.blendMode ?? 'normal', item.opacity ?? 1, 'linear-srgb'),
      x,
      y,
    );
    return true;
  }

  const drawX = region?.x ?? 0;
  const drawY = region?.y ?? 0;
  target.save();
  try {
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = item.opacity ?? 1;
    target.globalCompositeOperation =
      item.blendMode && item.blendMode !== 'normal' ? mapBlendMode(item.blendMode) : 'source-over';
    target.drawImage(surface.canvas as CanvasImageSource, drawX, drawY);
  } finally {
    target.restore();
  }
  return true;
}
