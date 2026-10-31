import { getRasterLayerCache } from '../rasterLayerCache';
import {
  decideRasterStrategy,
  drawRasterLayerLod,
  effectiveScaleFromTransform,
  getPyramidResidency,
  getPyramidViewport,
  isRasterPyramidEnabled,
  layerVisibleRect,
  type PyramidLayerSource,
  registerPyramidSource,
} from '../rasterPyramid/renderTiles';
import { emitRasterReplaySample, isRasterReplayMeasured } from '../rasterReplayMetrics';
import type { ReplayTarget } from '../replayTypes';
import type { RenderItem } from '../types';
/** Render a raster layer by compositing its tiles onto an offscreen canvas. */
export function paintRasterLayer(
  target: ReplayTarget,
  p: Extract<RenderItem['primitive'], { kind: 'rasterLayer' }>,
): void {
  const { width, height, tiles } = p;
  if (width <= 0 || height <= 0) return;

  // Measurement is opt-in: with no sink installed the timing calls below are
  // skipped entirely and this path keeps its original shape.
  const measured = isRasterReplayMeasured();
  const startedAt = measured ? performance.now() : 0;

  const TILE = 128;
  const cache = getRasterLayerCache();
  // A stable identity for the layer. `layerId` is set by the IR builder where
  // available; without one the cache is bypassed entirely rather than risking
  // two different layers sharing a surface.
  const layerKey = (p as { layerId?: string }).layerId ?? null;

  // Spatial tiled-pyramid path (ADR-0214 D5): engages only when enabled and
  // the crossover says visible-tile drawing is cheaper (large layer, low
  // effective scale, low viewport coverage). Falls back to the retained
  // surface when nothing is resident, so correctness never depends on it.
  if (layerKey && isRasterPyramidEnabled() && target.getTransform) {
    const m = target.getTransform();
    if (m) {
      const scale = effectiveScaleFromTransform(m);
      const viewport = getPyramidViewport();
      const decision = decideRasterStrategy({
        width,
        height,
        scale,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        enabled: true,
      });
      if (decision.kind === 'pyramid') {
        const source: PyramidLayerSource = {
          layerId: layerKey,
          width,
          height,
          pixelMode: (p as { pixelMode?: boolean }).pixelMode ?? false,
          tiles,
        };
        registerPyramidSource(source);
        const rect = layerVisibleRect(m, viewport.width, viewport.height);
        const lodStartedAt = measured ? performance.now() : 0;
        const result = drawRasterLayerLod(
          target,
          source,
          getPyramidResidency(),
          decision.level,
          rect,
        );
        if (result.drawnTiles > 0) {
          if (measured) {
            const endedAt = performance.now();
            emitRasterReplaySample({
              width,
              height,
              totalTiles: Object.keys(tiles).length,
              compositedTiles: result.drawnTiles,
              intermediateBytes: 0,
              surfaceMs: 0,
              tileReplayMs: 0,
              drawMs: 0,
              totalMs: endedAt - lodStartedAt,
            });
          }
          return;
        }
        // Nothing resident yet: fall through to the retained path (the
        // scheduler is generating the visible tiles).
      }
    }
  }

  let surfaceCanvas: CanvasImageSource | null = null;
  let compositedTiles = 0;
  let surfaceEndedAt = 0;
  let tilesEndedAt = 0;

  const acquired = layerKey ? cache.acquire(layerKey, width, height, tiles, TILE) : null;
  if (acquired) {
    // Dirty-tile path: only tiles whose version changed were re-uploaded.
    // `putImageData` ignores transform/clip/alpha/blend, and tile writes never
    // overlap, so a partial upload is pixel-identical to a full one.
    surfaceEndedAt = measured ? performance.now() : 0;
    tilesEndedAt = surfaceEndedAt;
    compositedTiles = acquired.plan.changed.length;
    surfaceCanvas = acquired.surface.canvas as unknown as CanvasImageSource;
  } else {
    // Fallback: no layer identity, or no canvas backend. Rebuild in full,
    // exactly as before.
    const offscreen =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : typeof document !== 'undefined'
          ? document.createElement('canvas')
          : null;
    if (!offscreen) return;
    offscreen.width = width;
    offscreen.height = height;

    const ctx = offscreen.getContext('2d') as
      | (CanvasRenderingContext2D & OffscreenCanvasRenderingContext2D)
      | null;
    if (!ctx) return;
    surfaceEndedAt = measured ? performance.now() : 0;

    for (const [key, tile] of Object.entries(tiles)) {
      const [colStr, rowStr] = key.split(':');
      const col = Number(colStr);
      const row = Number(rowStr);
      if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
      const pixels = new Uint8ClampedArray(tile.pixels);
      const imageData = ctx.createImageData(TILE, TILE);
      imageData.data.set(pixels);
      ctx.putImageData(imageData, col * TILE, row * TILE);
      compositedTiles++;
    }
    tilesEndedAt = measured ? performance.now() : 0;
    surfaceCanvas = offscreen as unknown as CanvasImageSource;
  }

  // The composite step is unchanged on both paths: the finished surface is
  // drawn as one image, so transform, opacity, blend mode, masks and filters
  // continue to apply to the whole layer and no per-tile seams can appear.
  if (target.drawImage && surfaceCanvas) {
    target.drawImage(surfaceCanvas, 0, 0, width, height);
  }

  if (measured) {
    const endedAt = performance.now();
    emitRasterReplaySample({
      width,
      height,
      totalTiles: Object.keys(tiles).length,
      compositedTiles,
      intermediateBytes: width * height * 4,
      surfaceMs: surfaceEndedAt - startedAt,
      tileReplayMs: tilesEndedAt - surfaceEndedAt,
      drawMs: endedAt - tilesEndedAt,
      totalMs: endedAt - startedAt,
    });
  }
}
