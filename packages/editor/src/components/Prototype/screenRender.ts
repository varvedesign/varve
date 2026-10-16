/**
 * screenRender — prototype presentation screen rendering.
 *
 * Renders a frame (screen) subtree through the canonical pipeline —
 * `flattenSceneToEngine` with `localTransforms` (the frame's children render
 * in scene space) followed by the engine's `generateThumbnail` IR replay. This
 * is the same conversion the canvas and thumbnail system use; the presenter
 * must never hand-roll a mini-renderer.
 *
 * The raster is produced for an **explicit frame** — the screen frame's own
 * scene rectangle — rather than for the subtree's computed content bounds.
 * That distinction is what makes the active regions knowable:
 *
 *   - content-bounds rendering normalises its own origin, so the scene → pixel
 *     mapping changes whenever a child overflows, dragging every hotspot with
 *     it;
 *   - frame rendering pins the mapping to the frame, clips overflow exactly as
 *     the frame's own `overflow: hidden` box does, and reports the same
 *     rectangle the resolver uses.
 *
 * The engine reports `sourceBounds`, `scaleFactor`, `outputWidth` and
 * `outputHeight`; those four values are returned here and are the only inputs
 * to the scene → frame-box mapping. Nothing re-derives a position from a
 * node's raw transform.
 *
 * Results are cached per screenId + document revision + size (LRU) so overlay
 * stack changes and hotspot recomputes don't re-render the screen. In
 * environments without canvas/encoding (jsdom) the engine returns a
 * placeholder — the caller then renders hotspots against the frame's own
 * bounds, which keeps presentation tests meaningful without a raster path.
 */
import { generateThumbnail } from '@varve/engine';
import { buildParentIndex, type ScreenRasterInfo } from '@varve/prototype';
import type { Document, NodeId } from '@varve/scene';
import { nodeWorldBounds } from '@varve/scene';
import { flattenSceneToEngine } from '../../render/sceneToEngine';
import { documentRevisionHash } from '../../thumbnail/identity';

const CACHE_MAX = 12;

/** A rendered screen: the image plus the geometry it was rendered from. */
export interface ScreenRenderResult {
  dataUrl: string | null;
  /** Null when this environment has no raster path. */
  raster: ScreenRasterInfo | null;
}

interface CacheEntry {
  rich: Promise<ScreenRenderResult>;
  /** Memoised projection so the string adapter keeps a stable identity. */
  dataUrl: Promise<string | null>;
}

const screenRenderCache = new Map<string, CacheEntry>();

/**
 * The scene rectangle a screen frame occupies, and the scene → frame pixel
 * scale the engine should use. Kept in one place so the render request and the
 * hotspot resolver cannot disagree about which rectangle is being framed.
 */
function screenRenderFrame(
  document: Document,
  screenId: NodeId,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  const parentIndex = buildParentIndex(document);
  const bounds = nodeWorldBounds(document, screenId, parentIndex);
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) {
    return { x: 0, y: 0, w: Math.max(1, Math.round(width)), h: Math.max(1, Math.round(height)) };
  }
  return bounds;
}

/**
 * Render a prototype screen and report the raster geometry it produced.
 * Cached; safe to call per render.
 */
export function renderScreenRaster(
  document: Document,
  screenId: NodeId,
  width: number,
  height: number,
): Promise<ScreenRenderResult> {
  return screenRenderEntry(document, screenId, width, height).rich;
}

function screenRenderEntry(
  document: Document,
  screenId: NodeId,
  width: number,
  height: number,
): CacheEntry {
  const rev = documentRevisionHash(document);
  const key = `${screenId}:${rev}:${Math.round(width)}x${Math.round(height)}`;
  const cached = screenRenderCache.get(key);
  if (cached) return cached;

  const frame = screenRenderFrame(document, screenId, width, height);

  const rich = (async (): Promise<ScreenRenderResult> => {
    const { nodes } = flattenSceneToEngine(document, [screenId], { localTransforms: true });
    if (nodes.length === 0) return { dataUrl: null, raster: null };
    const result = await generateThumbnail(nodes, rev, {
      maxWidth: Math.max(1, Math.round(width)),
      maxHeight: Math.max(1, Math.round(height)),
      // The frame is the fit target, so the mapping is pinned to the frame
      // instead of being renormalised by whatever the children happen to span.
      frame,
      fit: 'contain',
      // Allow the contain fit to reach the DPR-scaled output size; without
      // this the raster stops at 1 CSS px per scene unit and is upscaled by
      // the browser into a soft image.
      allowUpscale: true,
      format: 'png',
      background: { type: 'transparent' },
      devicePixelRatio: 2,
    });
    if (!result?.dataUrl) {
      return { dataUrl: null, raster: null };
    }
    const meta = result.metadata;
    const sourceBounds = meta.sourceBounds;
    if (
      !sourceBounds ||
      meta.outputWidth <= 0 ||
      meta.outputHeight <= 0 ||
      !(meta.scaleFactor > 0)
    ) {
      return { dataUrl: result.dataUrl, raster: null };
    }
    return {
      dataUrl: result.dataUrl,
      raster: {
        sourceBounds,
        outputWidth: meta.outputWidth,
        outputHeight: meta.outputHeight,
        scaleFactor: meta.scaleFactor,
      },
    };
  })().catch((): ScreenRenderResult => ({ dataUrl: null, raster: null }));

  const dataUrl = rich.then((value) => value.dataUrl);

  const entry: CacheEntry = { rich, dataUrl };
  screenRenderCache.set(key, entry);
  if (screenRenderCache.size > CACHE_MAX) {
    const oldest = screenRenderCache.keys().next().value;
    if (oldest !== undefined) screenRenderCache.delete(oldest);
  }
  return entry;
}

/**
 * PNG data URL for a screen, or null when this environment has no raster path.
 * Convenience adapter over {@link renderScreenRaster}; both share one cache
 * entry (and one promise identity), so a caller mixing the two never renders a
 * screen twice.
 */
export function renderScreenToDataUrl(
  document: Document,
  screenId: NodeId,
  width: number,
  height: number,
): Promise<string | null> {
  return screenRenderEntry(document, screenId, width, height).dataUrl;
}

/** Clear the presentation cache (document replaced, tests). */
export function clearScreenRenderCache(): void {
  screenRenderCache.clear();
}
