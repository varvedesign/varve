/**
 * Default ink for newly created text.
 *
 * A fixed near-black default made text typed straight onto the dark-theme
 * canvas effectively invisible (shell audit 2026-10-21, F-09). New text now
 * takes whichever of two inks reads better against what it is typed onto:
 * the fills of its ancestor frames, then the document's canvas background,
 * then the editor's board colour, composited in paint order.
 *
 * Solid fill stacks and shared paints use the renderer's resolution order.
 * Visible gradients, images and blends are looked through rather than guessed
 * at, unless an opaque solid above them completely covers them.
 */
import { contrastRatio, managedColorToRgba, relativeLuminance } from '@varve/shared';
import type { RgbColor } from './colorManagement';
import type { Document } from './document';
import { getParent } from './document-utils';
import { resolveNodePaints } from './paint';
import type { NodeId } from './types';

/** Ink for text on light surfaces (the long-standing default). */
export const DARK_TEXT_INK: RgbColor = { space: 'rgb', r: 16, g: 21, b: 31, a: 255 };

/** Ink for text on dark surfaces. */
export const LIGHT_TEXT_INK: RgbColor = { space: 'rgb', r: 236, g: 238, b: 243, a: 255 };

export interface BoardColor {
  r: number;
  g: number;
  b: number;
}

type Rgba = [number, number, number, number];

/** Cycle/depth bound for ancestor walks on possibly-corrupt documents. */
const MAX_ANCESTOR_DEPTH = 256;

const luminanceOf = (c: BoardColor) => relativeLuminance(c.r, c.g, c.b);
const DARK_INK_LUMINANCE = luminanceOf(DARK_TEXT_INK);
const LIGHT_INK_LUMINANCE = luminanceOf(LIGHT_TEXT_INK);

/**
 * The ink new text should take when created inside `parentId` (or on the
 * canvas when null). `board` is the colour the editor paints behind the
 * document when it has no canvas background of its own.
 */
export function defaultTextFillAt(
  doc: Document,
  parentId: NodeId | null,
  board: BoardColor,
): RgbColor {
  const behind = luminanceOf(surfaceBehind(doc, parentId, board));
  const darkInk = contrastRatio(DARK_INK_LUMINANCE, behind);
  const lightInk = contrastRatio(LIGHT_INK_LUMINANCE, behind);
  return darkInk >= lightInk ? DARK_TEXT_INK : LIGHT_TEXT_INK;
}

function frameFill(doc: Document, id: NodeId): Rgba | null {
  const node = doc.nodes[id];
  if (node?.kind !== 'frame' || node.visible === false) return null;
  if (node.frameRole === 'exportRegion') return null;
  if (node.blendMode !== 'normal' || node.opacity <= 0) return null;

  const fills = resolveNodePaints(
    { paintRefs: node.paintRefs, fills: node.fills, fill: { ...node.fill } },
    doc,
  );
  // Accumulate premultiplied colour from the top down. The frame's opacity
  // applies once to the resulting stack, not independently to each paint.
  let r = 0;
  let g = 0;
  let b = 0;
  let alpha = 0;
  for (let i = fills.length - 1; i >= 0 && alpha < 1; i--) {
    const fill = fills[i]!;
    if (!fill.visible || fill.opacity <= 0) continue;
    if (fill.type !== 'solid' || fill.blendMode !== 'normal' || !fill.color) return null;
    const [fr, fg, fb, fa] = managedColorToRgba(fill.color);
    const coverage = (fa / 255) * Math.min(1, fill.opacity) * (1 - alpha);
    r += fr * coverage;
    g += fg * coverage;
    b += fb * coverage;
    alpha += coverage;
  }
  return alpha > 0
    ? [r / alpha, g / alpha, b / alpha, alpha * Math.min(1, node.opacity) * 255]
    : null;
}

function surfaceBehind(doc: Document, parentId: NodeId | null, board: BoardColor): BoardColor {
  // Innermost first; stops at the first opaque layer since nothing behind it shows.
  const layers: Rgba[] = [];
  let id = parentId;
  for (let depth = 0; id !== null && depth < MAX_ANCESTOR_DEPTH; depth++) {
    const fill = frameFill(doc, id);
    if (fill && fill[3] > 0) {
      layers.push(fill);
      if (fill[3] >= 255) return composite(board, layers);
    }
    id = getParent(doc, id);
  }
  if (doc.canvasBackground) layers.push(managedColorToRgba(doc.canvasBackground));
  return composite(board, layers);
}

function composite(board: BoardColor, innerFirst: readonly Rgba[]): BoardColor {
  let { r, g, b } = board;
  for (let i = innerFirst.length - 1; i >= 0; i--) {
    const [fr, fg, fb, fa] = innerFirst[i]!;
    const t = fa / 255;
    r += (fr - r) * t;
    g += (fg - g) * t;
    b += (fb - b) * t;
  }
  return { r, g, b };
}
