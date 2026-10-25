import type { ImagePlacement, OcrWord } from '@varve/engine';
import { type Affine, applyAffine } from '@varve/shared';

type Point = readonly [number, number];

/** Compose the already-resolved canonical image placement for one occurrence.
 * Fit/crop/offset/scale are owned by computeImagePlacement. Unlike the pointer
 * mapper this affine has no clipping or tile wrapping discontinuities. */
function sourceAffine(placement: ImagePlacement): Affine {
  const { drawRect, sourceWidth, sourceHeight, rotation, flipH, flipV } = placement;
  const radians = (rotation * Math.PI) / 180;
  const sx = (drawRect.w / sourceWidth) * (flipH ? -1 : 1);
  const sy = (drawRect.h / sourceHeight) * (flipV ? -1 : 1);
  const a = Math.cos(radians) * sx;
  const b = Math.sin(radians) * sx;
  const c = -Math.sin(radians) * sy;
  const d = Math.cos(radians) * sy;
  return [
    a,
    b,
    c,
    d,
    drawRect.x + drawRect.w / 2 - (a * sourceWidth + c * sourceHeight) / 2,
    drawRect.y + drawRect.h / 2 - (b * sourceWidth + d * sourceHeight) / 2,
  ];
}

function corners(x: number, y: number, right: number, bottom: number): Point[] {
  return [
    [x, y],
    [right, y],
    [right, bottom],
    [x, bottom],
  ];
}

/** Separating axes of a rectangle and an affine rectangle. Strict overlap
 * excludes regions which only touch the clipped image's edge. */
function overlaps(region: readonly Point[], bounds: readonly Point[]): boolean {
  const axes: Point[] = [
    [1, 0],
    [0, 1],
  ];
  for (let i = 0; i < 2; i++) {
    const start = region[i]!;
    const end = region[i + 1]!;
    axes.push([start[1] - end[1], end[0] - start[0]]);
  }
  return axes.every(([x, y]) => {
    const project = ([px, py]: Point) => px * x + py * y;
    const a = region.map(project);
    const b = bounds.map(project);
    return Math.max(...a) > Math.min(...b) && Math.max(...b) > Math.min(...a);
  });
}

/** One editable layer per recognized region, using the first painted tile
 * occurrence when the source repeats. A partial crop may reveal any interior
 * part of a region; visibility is polygon intersection, never sample guesses. */
export function ocrRegionPlacement(placement: ImagePlacement, word: OcrWord): Affine | null {
  if (![word.x, word.y, word.width, word.height].every(Number.isFinite)) return null;
  const { sourceRect, drawRect, bounds } = placement;
  const x = Math.max(word.x, sourceRect.x);
  const y = Math.max(word.y, sourceRect.y);
  const right = Math.min(word.x + word.width, sourceRect.x + sourceRect.w);
  const bottom = Math.min(word.y + word.height, sourceRect.y + sourceRect.h);
  if (right <= x || bottom <= y) return null;
  const transform = sourceAffine(placement);
  const polygon = corners(x, y, right, bottom).map((point) => applyAffine(transform, point));
  const clip = corners(bounds.x, bounds.y, bounds.x + bounds.w, bounds.y + bounds.h);
  if (placement.fit !== 'tile') return overlaps(polygon, clip) ? transform : null;

  // The renderer starts at the normalized anchor and paints positive rows and
  // columns. Limit the search to occurrences whose region bounds can overlap.
  const xs = polygon.map((point) => point[0]);
  const ys = polygon.map((point) => point[1]);
  const firstX = Math.max(0, Math.floor((bounds.x - Math.max(...xs)) / drawRect.w) + 1);
  const firstY = Math.max(0, Math.floor((bounds.y - Math.max(...ys)) / drawRect.h) + 1);
  const lastX = Math.min(
    Math.ceil((bounds.x + bounds.w - drawRect.x) / drawRect.w) - 1,
    Math.ceil((bounds.x + bounds.w - Math.min(...xs)) / drawRect.w) - 1,
  );
  const lastY = Math.min(
    Math.ceil((bounds.y + bounds.h - drawRect.y) / drawRect.h) - 1,
    Math.ceil((bounds.y + bounds.h - Math.min(...ys)) / drawRect.h) - 1,
  );
  for (let row = firstY; row <= lastY; row++) {
    for (let column = firstX; column <= lastX; column++) {
      const dx = column * drawRect.w;
      const dy = row * drawRect.h;
      const occurrence: Point[] = polygon.map(([px, py]) => [px + dx, py + dy]);
      if (!overlaps(occurrence, clip)) continue;
      return [
        transform[0],
        transform[1],
        transform[2],
        transform[3],
        transform[4] + dx,
        transform[5] + dy,
      ];
    }
  }
  return null;
}
