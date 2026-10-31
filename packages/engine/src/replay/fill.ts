import { mapBlendMode } from '../compositeCanvas';
import { paintPatternFill } from '../patterns/replayPatternFill';
import { createGradientStyle, paintTiledGradientFill } from '../replayGradient';
import type { ReplayTarget } from '../replayTypes';
import type { FillIR, RenderItem, Stroke } from '../types';
import { replayPaintStrokeWithDependencies } from './backdrop';
import { rgba } from './color';
import { paintImageFill } from './fillImage';
import { paintShapeFill, traceOutline } from './primitive';
import { primitiveBounds } from './primitiveBounds';
/** Paint fills and strokes to `target` (shared by direct and layerBlur offscreen paths). */
export function paintFillsAndStrokes(
  target: ReplayTarget,
  item: RenderItem,
  itemAlpha: number,
  itemBlend: string,
): void {
  const fills = item.fills;
  if (fills && fills.length > 0) {
    const restoreBlend = target.globalCompositeOperation;
    for (const fill of fills) {
      if (!fill.visible) continue;
      target.globalAlpha = itemAlpha * (fill.opacity ?? 1);
      if (fill.blendMode && fill.blendMode !== 'normal') {
        target.globalCompositeOperation = mapBlendMode(fill.blendMode);
      } else if (itemBlend !== 'source-over') {
        target.globalCompositeOperation = itemBlend;
      } else {
        target.globalCompositeOperation = restoreBlend;
      }
      paintFill(target, fill, item);
    }
  } else {
    target.fillStyle = rgba(item.fill);
    paintShapeFill(target, item);
  }

  const visibleStrokes = item.strokes?.filter((s) => s.visible) ?? [];
  if (visibleStrokes.length > 0) {
    for (const stroke of visibleStrokes) {
      replayPaintStrokeWithDependencies(target, stroke, item);
    }
  } else if (item.primitive.kind === 'line' || item.primitive.kind === 'arrow') {
    // Backward-compat fallback: lines/arrows with no visible stroke still render
    // with a default stroke so they don't vanish after the fill-pass removal.
    const fallback: Stroke = {
      color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      weight: item.primitive.kind === 'arrow' ? 2 : 2,
      align: 'center',
      dashPattern: [],
      dashOffset: 0,
      cap: 'round',
      join: 'miter',
      miterLimit: 4,
      visible: true,
      ...(item.primitive.kind === 'arrow' ? { arrowEnd: 'arrow' as const } : {}),
    };
    replayPaintStrokeWithDependencies(target, fallback, item);
  }
}

/** Paint a single fill (solid, gradient, image, or pattern) over the primitive shape. */
export function paintFill(target: ReplayTarget, fill: FillIR, item: RenderItem): void {
  if (fill.type === 'solid') {
    target.fillStyle = rgba(fill.color);
    paintShapeFill(target, item);
  } else if (fill.type === 'gradient') {
    const bounds = primitiveBounds(item.primitive);
    const tilingMode = fill.tilingMode;
    if (tilingMode && tilingMode !== 'none') {
      paintTiledGradientFill(
        target,
        fill,
        item,
        bounds,
        tilingMode as 'repeat' | 'reflect',
        paintShapeFill,
      );
    } else {
      target.fillStyle = createGradientStyle(target, fill, item, bounds);
      paintShapeFill(target, item);
    }
  } else if (fill.type === 'image') {
    // An image fill with no source yet is deliberately transparent: the grey
    // loading/error placeholders exist only for sources that are actually
    // loading or have failed. An empty (just-created) image fill on top of a
    // solid must not paper over the fills beneath it.
    if (!fill.src) return;
    target.save();
    try {
      if (!canSkipImageRectClip(fill, item)) {
        target.beginPath();
        traceOutline(target, item.primitive);
        target.clip();
      }
      paintImageFill(target, fill, item);
    } finally {
      target.restore();
    }
  } else if (fill.type === 'pattern') {
    if (!fill.tileSrc) return;
    target.save();
    try {
      target.beginPath();
      traceOutline(target, item.primitive);
      target.clip();
      paintPatternFill(target, fill, primitiveBounds(item.primitive), item.transform);
    } finally {
      target.restore();
    }
  }
}

/**
 * A plain rectangle needs no separate clip when the image draw exactly fills
 * it. Besides avoiding redundant work, this keeps worker and main-thread
 * Canvas2D output pixel-identical at fractional camera scales; their clip
 * masks can otherwise differ at the image edge.
 */
function canSkipImageRectClip(fill: Extract<FillIR, { type: 'image' }>, item: RenderItem): boolean {
  if (item.primitive.kind !== 'rect' || fill.alphaMask) return false;
  const primitive = item.primitive as typeof item.primitive & {
    cornerRadius?: number;
    cornerSmoothing?: number;
  };
  if ((primitive.cornerRadius ?? 0) > 0 || (primitive.cornerSmoothing ?? 0) > 0) return false;
  if (
    (fill.x ?? 0) !== 0 ||
    (fill.y ?? 0) !== 0 ||
    (fill.scale ?? 1) !== 1 ||
    (fill.rotation ?? 0) !== 0 ||
    fill.flipH ||
    fill.flipV ||
    fill.crop
  ) {
    return false;
  }

  const bounds = primitiveBounds(item.primitive);
  const sourceWidth = fill.imageWidth ?? bounds.w;
  const sourceHeight = fill.imageHeight ?? bounds.h;
  if (sourceWidth <= 0 || sourceHeight <= 0 || bounds.w <= 0 || bounds.h <= 0) return false;

  const fit = fill.fit ?? 'fill';
  if (fit === 'stretch') return true;
  if (fit !== 'fill' && fit !== 'fit') return false;
  const aspectDelta = Math.abs(sourceWidth * bounds.h - sourceHeight * bounds.w);
  return (
    aspectDelta <= Number.EPSILON * 16 * Math.max(sourceWidth * bounds.h, sourceHeight * bounds.w)
  );
}
