import { validateRasterSurfaceDimensions } from '../rasterSurface';

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
