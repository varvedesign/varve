/**
 * Render alpha mask compositing using offscreen canvas double-buffering.
 *
 * Creates two offscreen canvases at the main canvas size:
 *   1. Mask canvas — renders the mask source content (alpha channel = opacity)
 *   2. Content canvas — renders the masked content
 *
 * Then composites content onto the content canvas using `destination-in`,
 * which keeps content pixels only where the mask canvas has non-zero alpha.
 * The composited result is drawn onto the main canvas.
 *
 * If the main canvas has zero dimensions, this is a no-op.
 */
export function renderAlphaMask(
  ctx: CanvasRenderingContext2D,
  maskSource: { draw: (ctx: CanvasRenderingContext2D) => void },
  content: { draw: (ctx: CanvasRenderingContext2D) => void },
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  if (w === 0 || h === 0) return;

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = w;
  maskCanvas.height = h;
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) return;

  const contentCanvas = document.createElement('canvas');
  contentCanvas.width = w;
  contentCanvas.height = h;
  const contentCtx = contentCanvas.getContext('2d');
  if (!contentCtx) return;

  // Render mask source content to mask canvas
  maskSource.draw(maskCtx);

  // Render masked content to content canvas
  content.draw(contentCtx);

  // Composite: destination-in keeps content only where mask has alpha
  contentCtx.globalCompositeOperation = 'destination-in';
  contentCtx.drawImage(maskCanvas, 0, 0);

  // Draw the composited result onto the main canvas
  ctx.drawImage(contentCanvas, 0, 0);
}
