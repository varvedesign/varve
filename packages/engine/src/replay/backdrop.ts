import type { AlphaStrokeOps } from '../alphaStroke';
import { CompositeCanvas } from '../compositeCanvas';
import { applyGlassMaterialBackdrop, clampByte, computeScreenBounds } from '../effectPipeline';
import { createGradientStyle } from '../replayGradient';
import type { ReplayTarget } from '../replayTypes';
import { itemNeedsAlphaShadow, renderShadowSource, type ShadowOps } from '../shadowSource';
import { gradientStrokeToFill, paintStroke as replayPaintStroke } from '../strokeReplay';
import type { RenderItem, Stroke } from '../types';
import { backdropCacheKey, getBackdropCache, setBackdropCache } from './backdropCache';
import { rgba } from './color';
import { createEffectBuffer } from './effectBuffer';
import { reportEffectDiagnostic } from './effectDiagnostics';
import { paintImageFill } from './fillImage';
import { paintFill } from './paintFill';
import { paintShapeFill, traceOutline } from './primitive';
import { primitiveBounds } from './primitiveBounds';
import { paintCanonicalTextStroke } from './textCanonical';
import { paintPathText } from './textPath';
import type { BackgroundBlurEffect, GlassMaterialEffect } from './types';
import { applyTextCase, effectiveWeight, measureTextAdvance } from './typography';
/**
 * Rendering primitives injected into the alpha-aware shadow pipeline
 * (see `shadowSource.ts`). Kept in `replay.ts` so shadow rendering reuses the
 * exact same tracing/fill/image code paths as the main fill pass, without an
 * import cycle.
 */
export const shadowOps: ShadowOps = {
  traceOutline,
  paintFill,
  paintShapeFill,
  paintImageFill,
  paintStroke: replayPaintStrokeWithDependencies,
  primitiveBounds,
  rgba,
  createEffectBuffer,
};

/** Rendering primitives injected into the alpha-aware stroke leaf module. */
const alphaStrokeOps: AlphaStrokeOps = {
  createEffectBuffer,
  primitiveBounds,
  renderSource: (target, item) => renderShadowSource(target, item, shadowOps),
  strokeStyle: (target, stroke, item, bounds) =>
    stroke.gradient
      ? createGradientStyle(target, gradientStrokeToFill(stroke.gradient), item, bounds)
      : rgba(stroke.color),
};

export function replayPaintStrokeWithDependencies(
  target: ReplayTarget,
  stroke: Stroke,
  item: RenderItem,
): void {
  replayPaintStroke(target, stroke, item, {
    traceOutline,
    primitiveBounds,
    alphaStrokeOps,
    applyTextCase,
    effectiveTextWeight: effectiveWeight,
    measureTextAdvance,
    paintTextOnPath: paintPathText,
    paintTextCanonicalStroke: paintCanonicalTextStroke,
  });
}

/**
 * Backdrop effects use the same visible alpha as shadows for text, raster
 * layers, and image-filled/translucent objects. A geometric clip would blur
 * through the empty parts of a text box or transparent PNG.
 */
function createBackdropAlphaMask(
  item: RenderItem,
  matrix: { a: number; b: number; c: number; d: number; e: number; f: number },
  screen: { x: number; y: number; w: number; h: number },
): ReturnType<typeof createEffectBuffer> {
  if (!itemNeedsAlphaShadow(item)) return null;
  const mask = createEffectBuffer(screen.w, screen.h);
  if (!mask) return null;
  const ctx = mask.ctx;
  ctx.save();
  ctx.setTransform(
    matrix.a,
    matrix.b,
    matrix.c,
    matrix.d,
    matrix.e - screen.x,
    matrix.f - screen.y,
  );
  renderShadowSource(ctx as unknown as ReplayTarget, item, shadowOps);
  ctx.restore();
  return mask;
}

function compositeBackdropSurface(
  target: ReplayTarget,
  source: HTMLCanvasElement | OffscreenCanvas,
  mask: ReturnType<typeof createEffectBuffer>,
  item: RenderItem,
  localRect: { x: number; y: number; w: number; h: number },
  screen: { w: number; h: number },
): void {
  target.save();
  if (mask) {
    const masked = createEffectBuffer(screen.w, screen.h);
    if (masked) {
      masked.ctx.drawImage(source as unknown as CanvasImageSource, 0, 0);
      masked.ctx.globalCompositeOperation = 'destination-in';
      masked.ctx.drawImage(mask.canvas as unknown as CanvasImageSource, 0, 0);
      target.drawImage?.(
        masked.canvas as unknown as CanvasImageSource,
        localRect.x,
        localRect.y,
        localRect.w,
        localRect.h,
      );
    }
  } else {
    target.beginPath();
    traceOutline(target, item.primitive);
    target.clip?.();
    target.drawImage?.(
      source as unknown as CanvasImageSource,
      localRect.x,
      localRect.y,
      localRect.w,
      localRect.h,
    );
  }
  target.restore();
}

/**
 * Capture the canvas backdrop behind an item, blur it, and composite clipped to the shape.
 * Must run before the item's own fills are painted.
 */
export function paintBackgroundBlur(
  target: ReplayTarget,
  item: RenderItem,
  effect: BackgroundBlurEffect,
): void {
  const canvas = target.canvas as HTMLCanvasElement | OffscreenCanvas | undefined;
  if (!canvas || !target.drawImage || typeof OffscreenCanvas === 'undefined') {
    reportEffectDiagnostic(
      effect,
      'effect-surface-unavailable',
      'the replay target cannot sample an offscreen backdrop for background blur',
    );
    return;
  }
  if (!target.getTransform) {
    reportEffectDiagnostic(
      effect,
      'effect-surface-unavailable',
      'the replay target has no transform stack for backdrop sampling',
    );
    return;
  }

  const bounds = primitiveBounds(item.primitive);
  if (bounds.w <= 0 || bounds.h <= 0) return;
  const pad = Math.ceil(effect.radius * 3);
  const lx = bounds.x - pad;
  const ly = bounds.y - pad;
  const lw = bounds.w + pad * 2;
  const lh = bounds.h + pad * 2;

  const m = target.getTransform();
  const screen = computeScreenBounds(m, lx, ly, lw, lh);
  const sw = screen.w;
  const sh = screen.h;
  const alphaMask = createBackdropAlphaMask(item, m, screen);

  // ── Backdrop cache lookup ─────────────────────────────────────
  const cacheKeyInput = backdropCacheKey(lx, ly, lw, lh, m, item.transform, effect.radius);
  const cached = getBackdropCache(cacheKeyInput);
  if (cached) {
    // Cache hit: composite the pre-blurred backdrop through visible alpha.
    compositeBackdropSurface(
      target,
      cached.canvas,
      alphaMask,
      item,
      { x: lx, y: ly, w: lw, h: lh },
      screen,
    );
    return;
  }

  let cc: CompositeCanvas;
  try {
    cc = new CompositeCanvas({ width: sw, height: sh, devicePixelRatio: 1 });
  } catch {
    reportEffectDiagnostic(
      effect,
      'effect-surface-unavailable',
      'the background-blur backdrop surface could not be allocated',
    );
    return;
  }
  cc.captureSource(canvas, screen.x, screen.y, sw, sh, 0, 0);
  cc.applyBlur(effect.radius);

  // ── Store in cache ────────────────────────────────────────────
  setBackdropCache(cacheKeyInput, cc.canvas);

  compositeBackdropSurface(
    target,
    cc.canvas,
    alphaMask,
    item,
    { x: lx, y: ly, w: lw, h: lh },
    screen,
  );
}

/**
 * Glass material: captures backdrop, blurs, tints, adjusts saturation/brightness,
 * adds noise, and composites as the item's visual content. Optional edge highlight
 * renders a light inner edge for depth.
 *
 * Renders before fills (like backgroundBlur) so fills/strokes sit on top.
 * Call paintGlassMaterialEdgeHighlight in the effects pass for the edge highlight.
 *
 * Research basis: Figma Glass effect (2025), Apple NSVisualEffectView/UIVisualEffectView,
 * CSS backdrop-filter with tint overlay.
 */
export function paintGlassMaterial(
  target: ReplayTarget,
  item: RenderItem,
  effect: GlassMaterialEffect,
): void {
  const canvas = target.canvas as HTMLCanvasElement | OffscreenCanvas | undefined;
  if (!canvas || !target.drawImage || typeof OffscreenCanvas === 'undefined') {
    reportEffectDiagnostic(
      effect,
      'effect-surface-unavailable',
      'the replay target cannot sample an offscreen backdrop for glass material',
    );
    return;
  }
  if (!target.getTransform) {
    reportEffectDiagnostic(
      effect,
      'effect-surface-unavailable',
      'the replay target has no transform stack for backdrop sampling',
    );
    return;
  }

  const bounds = primitiveBounds(item.primitive);
  if (bounds.w <= 0 || bounds.h <= 0) return;
  const pad = Math.ceil(effect.blur * 3 + 10);
  const lx = bounds.x - pad;
  const ly = bounds.y - pad;
  const lw = bounds.w + pad * 2;
  const lh = bounds.h + pad * 2;

  const m = target.getTransform();
  const screen = computeScreenBounds(m, lx, ly, lw, lh);
  const sw = screen.w;
  const sh = screen.h;
  const alphaMask = createBackdropAlphaMask(item, m, screen);

  let cc: CompositeCanvas;
  try {
    cc = new CompositeCanvas({ width: sw, height: sh, devicePixelRatio: 1 });
  } catch {
    reportEffectDiagnostic(
      effect,
      'effect-surface-unavailable',
      'the glass-material backdrop surface could not be allocated',
    );
    return;
  }
  cc.captureSource(canvas, screen.x, screen.y, sw, sh, 0, 0);

  // Step 1: Blur the backdrop
  cc.applyBlur(effect.blur);

  // Steps 2-5: tint, saturation, brightness, noise (shared pipeline)
  applyGlassMaterialBackdrop(cc, sw, sh, effect);

  // Composite the processed backdrop through visible content alpha.
  compositeBackdropSurface(
    target,
    cc.canvas,
    alphaMask,
    item,
    { x: lx, y: ly, w: lw, h: lh },
    screen,
  );
}

/**
 * Paint the glass material edge highlight after fills/strokes.
 * Renders a light inner edge for depth cue.
 */
export function paintGlassMaterialEdgeHighlight(
  target: ReplayTarget,
  item: RenderItem,
  effect: GlassMaterialEffect,
): void {
  if (!effect.edgeHighlight || effect.edgeHighlightWidth <= 0) return;
  target.save();
  target.globalAlpha = clampByte(effect.edgeHighlightOpacity * 255) / 255;
  target.strokeStyle = rgba(effect.edgeHighlightColor);
  target.lineWidth = effect.edgeHighlightWidth;
  target.beginPath();
  traceOutline(target, item.primitive);
  target.stroke();
  target.restore();
}
