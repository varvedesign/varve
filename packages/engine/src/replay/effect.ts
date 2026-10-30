import { CompositeCanvas } from '../compositeCanvas';
import { DepthMapCache, deserializeDepthMap, resizeDepthMap } from '../depthMap';
import { compositeMaskedEffectPixels } from '../effectMaskCompositor';
import { applyChromaticAberration, applyGlitch } from '../effectPipeline';
import { getImageCache } from '../imageCache';
import { applyDepthBlur } from '../lensBlur';
import { resolveReplayImage } from '../mockup/warpReplay';
import { validateRasterSurfaceDimensions } from '../rasterSurface';
import { imageLookupForCurrentReplay } from '../replay';
import type { ReplayTarget } from '../replayTypes';
import { applySpatialBlur, type SpatialBlurEffect, spatialBlurSupport } from '../spatialBlur';
import type { RenderItem } from '../types';
import { reportEffectDiagnostic } from './effectDiagnostics';
import { paintFillsAndStrokes } from './fill';
import { primitiveBounds } from './primitiveBounds';
import type { ContentEffect, DepthBlurEffect, EffectMaskResolver } from './types';

const decodedDepthMapCache = new DepthMapCache(3, 32 * 1024 * 1024);

function depthMapCacheKey(resource: NonNullable<DepthBlurEffect['depthMap']>): string {
  return [
    resource.id,
    resource.byteLength,
    resource.sourceHash ?? '',
    resource.sourceRevision ?? '',
    resource.generatedAt ?? '',
  ].join(':');
}

/** Create an offscreen 2D buffer, falling back to HTMLCanvasElement when needed. */
export function createEffectBuffer(
  w: number,
  h: number,
): {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
} | null {
  try {
    validateRasterSurfaceDimensions(w, h);
  } catch {
    return null;
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const oc = new OffscreenCanvas(w, h);
      const ctx = oc.getContext('2d');
      if (ctx) return { canvas: oc, ctx };
    } catch {
      // Fall through to the HTML canvas path.
    }
  }
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (ctx) return { canvas: c, ctx };
  }
  return null;
}

/** Maximum padding needed to keep content effects from being cropped. */
function finiteNonNegative(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function finiteAbs(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.abs(value) : 0;
}

function addEffectSupport(total: number, support: number): number {
  if (!Number.isFinite(support) || support <= 0) return total;
  const next = total + support;
  return Number.isFinite(next) && next <= Number.MAX_SAFE_INTEGER ? next : Number.POSITIVE_INFINITY;
}

export function contentEffectPadding(effects: readonly ContentEffect[]): number {
  let padding = 0;
  for (const e of effects) {
    if (e.type === 'layerBlur') {
      padding = addEffectSupport(padding, finiteNonNegative(e.radius) * 3);
    } else if (e.type === 'depthBlur') {
      padding = addEffectSupport(padding, finiteNonNegative(e.blurStrength) * 3);
    } else if (
      e.type === 'gaussianBlur' ||
      e.type === 'fieldBlur' ||
      e.type === 'irisBlur' ||
      e.type === 'tiltShiftBlur' ||
      e.type === 'pathBlur' ||
      e.type === 'spinBlur'
    ) {
      padding = addEffectSupport(padding, spatialBlurSupport(e as SpatialBlurEffect));
    } else if (e.type === 'chromaticAberration') {
      const mix = finiteNonNegative(e.mix ?? 1);
      const maxOff =
        e.channelMode === 'custom' && e.customChannels
          ? Math.max(
              0,
              ...e.customChannels.map((channel) =>
                channel.enabled === false
                  ? 0
                  : Math.max(finiteAbs(channel.x), finiteAbs(channel.y)) *
                    finiteNonNegative(channel.strength),
              ),
            ) * finiteNonNegative(e.intensity ?? 1)
          : Math.max(
              finiteAbs(e.offsets.redX),
              finiteAbs(e.offsets.redY),
              finiteAbs(e.offsets.greenX),
              finiteAbs(e.offsets.greenY),
              finiteAbs(e.offsets.blueX),
              finiteAbs(e.offsets.blueY),
            ) * finiteNonNegative(e.intensity ?? 1);
      padding = addEffectSupport(padding, Math.ceil(maxOff * mix));
    } else if (e.type === 'glitch') {
      const cs = e.channelShift;
      const maxChannel = Math.max(
        finiteAbs(cs.redX),
        finiteAbs(cs.redY),
        finiteAbs(cs.greenX),
        finiteAbs(cs.greenY),
        finiteAbs(cs.blueX),
        finiteAbs(cs.blueY),
      );
      padding = addEffectSupport(
        padding,
        Math.ceil(
          Math.max(finiteNonNegative(e.strength), finiteNonNegative(e.blockStrength), maxChannel),
        ),
      );
    }
  }
  return padding;
}

/** Apply an effect-local raster mask to the current local effect surface. */
function applyRasterEffectMask(
  canvas: CompositeCanvas,
  input: ImageData,
  effect: NonNullable<RenderItem['effects']>[number],
  item: RenderItem,
  effectMaskResolver?: EffectMaskResolver,
): void {
  const binding = effect.mask;
  const source = binding?.source;
  if (!binding || binding.visible === false) return;
  if (source?.kind !== 'raster-asset') {
    const mask = effectMaskResolver?.(
      binding,
      item,
      canvas.ctx as unknown as ReplayTarget,
      input.width,
      input.height,
    );
    if (!mask) {
      reportEffectDiagnostic(
        effect,
        'effect-mask-unresolved',
        effectMaskResolver
          ? 'the effect-mask resolver returned no pixels'
          : 'no scene-node/vector mask resolver was provided for this replay',
      );
      return;
    }
    const evaluated = canvas.getImageData(0, 0, canvas.width, canvas.height);
    const merged = compositeMaskedEffectPixels(input, evaluated, mask, binding);
    canvas.putImageData(merged as unknown as ImageData, 0, 0);
    return;
  }
  if (!source.src) {
    reportEffectDiagnostic(
      effect,
      'effect-mask-unresolved',
      'the raster mask asset has no resolvable source',
    );
    return;
  }
  const image = resolveReplayImage(source.src, imageLookupForCurrentReplay, getImageCache());
  if (!image) {
    reportEffectDiagnostic(effect, 'effect-mask-unresolved', 'the raster mask image is not loaded');
    return;
  }
  const maskBuffer = createEffectBuffer(canvas.canvas.width, canvas.canvas.height);
  if (!maskBuffer) {
    reportEffectDiagnostic(
      effect,
      'effect-mask-budget',
      'the effect mask buffer could not be allocated',
    );
    return;
  }
  const maskCtx = maskBuffer.ctx as CanvasRenderingContext2D;
  maskCtx.setTransform(1, 0, 0, 1, 0, 0);
  maskCtx.clearRect(0, 0, maskBuffer.canvas.width, maskBuffer.canvas.height);
  maskCtx.drawImage(
    image as CanvasImageSource,
    0,
    0,
    maskBuffer.canvas.width,
    maskBuffer.canvas.height,
  );
  const mask = maskCtx.getImageData(0, 0, maskBuffer.canvas.width, maskBuffer.canvas.height);
  const evaluated = canvas.getImageData(0, 0, canvas.width, canvas.height);
  const merged = compositeMaskedEffectPixels(input, evaluated, mask, binding);
  canvas.putImageData(merged as unknown as ImageData, 0, 0);
}

/**
 * Render content effects into a bounded local surface. A malformed or hostile
 * authored extent falls back to the authoritative unfiltered content instead
 * of aborting the whole replay and leaving later items unpainted.
 */
export function paintContentEffects(
  target: ReplayTarget,
  item: RenderItem,
  contentEffects: readonly ContentEffect[],
  itemAlpha: number,
  itemBlend: string,
  effectMaskResolver?: EffectMaskResolver,
): void {
  const bounds = primitiveBounds(item.primitive);
  if (bounds.w <= 0 || bounds.h <= 0) return;
  const padding = contentEffectPadding(contentEffects);
  const surfaceWidth = Math.max(1, Math.ceil(bounds.w + padding * 2));
  const surfaceHeight = Math.max(1, Math.ceil(bounds.h + padding * 2));

  try {
    const canvas = new CompositeCanvas({
      width: surfaceWidth,
      height: surfaceHeight,
      devicePixelRatio: 1,
    });
    canvas.ctx.translate(-bounds.x + padding, -bounds.y + padding);
    paintFillsAndStrokes(canvas.ctx as unknown as ReplayTarget, item, itemAlpha, itemBlend);

    for (const effect of contentEffects) {
      const input = canvas.getImageData(0, 0, canvas.width, canvas.height);
      if (effect.type === 'layerBlur') {
        canvas.applyBlur(Math.max(0, effect.radius));
      } else if (effect.type === 'depthBlur') {
        if (!effect.depthMap) {
          reportEffectDiagnostic(
            effect,
            'effect-depth-missing',
            'the depth map resource is not present in the document',
          );
        } else {
          try {
            const resource = effect.depthMap;
            const cacheKey = depthMapCacheKey(resource);
            const decoded = decodedDepthMapCache.get(cacheKey) ?? deserializeDepthMap(resource);
            decodedDepthMapCache.set(cacheKey, decoded);
            const depthMap = resizeDepthMap(decoded, canvas.width, canvas.height);
            const blurred = applyDepthBlur(input, depthMap, {
              blurAmount: effect.blurStrength,
              focalDepth: effect.focusDepth,
              transitionRange: effect.focusRange * Math.max(0, effect.falloff),
              invert: effect.invert,
              edgeProtection: effect.edgeProtection,
            });
            canvas.putImageData(blurred, 0, 0);
          } catch {
            // A missing/corrupt persisted resource must not blank the
            // document; keeping the input is the safe render fallback.
            reportEffectDiagnostic(
              effect,
              'effect-depth-missing',
              'the persisted depth map failed to decode',
            );
          }
        }
      } else if (
        effect.type === 'gaussianBlur' ||
        effect.type === 'fieldBlur' ||
        effect.type === 'irisBlur' ||
        effect.type === 'tiltShiftBlur' ||
        effect.type === 'pathBlur' ||
        effect.type === 'spinBlur'
      ) {
        canvas.putImageData(applySpatialBlur(input, effect as SpatialBlurEffect), 0, 0);
      } else if (effect.type === 'chromaticAberration') {
        applyChromaticAberration(canvas, canvas.width, canvas.height, effect);
      } else if (effect.type === 'glitch') {
        applyGlitch(canvas, canvas.width, canvas.height, effect);
      }
      applyRasterEffectMask(canvas, input, effect, item, effectMaskResolver);
    }

    target.save();
    try {
      target.globalAlpha = 1;
      target.globalCompositeOperation = itemBlend;
      target.drawImage?.(
        canvas.canvas as unknown as CanvasImageSource,
        bounds.x - padding,
        bounds.y - padding,
        surfaceWidth,
        surfaceHeight,
      );
    } finally {
      target.restore();
    }
  } catch {
    // A surface allocation/readback failure is recoverable for this item: the
    // base content remains authoritative and later items must still render.
    // Report it so an offscreen-budget refusal is never mistaken for the
    // authored effect having been applied.
    for (const effect of contentEffects) {
      reportEffectDiagnostic(
        effect,
        'effect-surface-unavailable',
        'the content-effect surface could not be allocated or read back',
      );
    }
    paintFillsAndStrokes(target, item, itemAlpha, itemBlend);
  }
}
