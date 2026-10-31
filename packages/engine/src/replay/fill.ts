import { mapBlendMode } from '../compositeCanvas';
import type { ReplayTarget } from '../replayTypes';
import type { RenderItem, Stroke } from '../types';
import { replayPaintStrokeWithDependencies } from './backdrop';
import { rgba } from './color';
import { paintFill } from './paintFill';
import { paintShapeFill } from './primitive';

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
