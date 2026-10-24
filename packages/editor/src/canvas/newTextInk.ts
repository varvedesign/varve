/**
 * Ink for text placed with the Text tool.
 *
 * New text used to be near-black everywhere, so on the dark-theme board it was
 * effectively invisible until recoloured (shell audit 2026-10-21, F-09). The
 * scene decides between its two default inks from what the text lands on
 * (`defaultTextFillAt`); this adapter supplies the one input the scene cannot
 * know: the colour the editor paints behind the document.
 */
import type { BoardColor, Document, NodeId, RgbColor } from '@varve/scene';
import { defaultTextFillAt } from '@varve/scene';
import { isPublishingPageFitTarget } from '../scene/activeWorkspace';

let cachedToken = '';
let cachedBoard: BoardColor | null = null;

/**
 * The board colour as sRGB. The token is authored in OKLCH, so it is resolved
 * by painting one pixel rather than parsed. Returns null where no 2D canvas
 * exists (unit-test DOMs), which keeps the scene's own default ink.
 */
function readBoardColor(): BoardColor | null {
  if (typeof document === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  const token = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-surface-sunken')
    .trim();
  if (!token) return null;
  if (token === cachedToken) return cachedBoard;
  const ctx = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = token;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
  cachedToken = token;
  cachedBoard = { r, g, b };
  return cachedBoard;
}

/**
 * The fill for a text node created inside `parentId`, or undefined to keep the
 * scene default. Pages keep the default: they print on paper whatever colour
 * the theme paints them on screen.
 */
export function newTextInk(
  doc: Document,
  parentId: NodeId | null | undefined,
  workspaceMode: string,
): RgbColor | undefined {
  if (isPublishingPageFitTarget(doc, workspaceMode)) return undefined;
  const board = readBoardColor();
  return board ? defaultTextFillAt(doc, parentId ?? null, board) : undefined;
}
