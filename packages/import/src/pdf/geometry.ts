/**
 * Matrix and page-space math for PDF import.
 *
 * PDF user space has its origin at the bottom-left of the media box and y
 * increasing upward; Varve page space has its origin at the top-left and y
 * increasing downward. A text matrix is also composed with the current
 * transformation matrix, so a run's position is `textMatrix × ctm`, never the
 * raw `Td` operand alone.
 *
 * `/Rotate` is a clockwise display rotation in degrees and is applied here, so
 * page size and every mapped point agree about which edge is "up".
 */

/** A 2x3 affine matrix `[a b c d e f]`, applied as `x' = a·x + c·y + e`. */
export type Mat = readonly [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export interface Point {
  x: number;
  y: number;
}

/** `m × n` — apply `n` first, then `m`. */
export function multiply(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function translation(tx: number, ty: number): Mat {
  return [1, 0, 0, 1, tx, ty];
}

export function scaling(sx: number, sy: number): Mat {
  return [sx, 0, 0, sy, 0, 0];
}

export function applyMat(m: Mat, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** A page box in PDF user space, plus the page's clockwise display rotation. */
export interface PageBox {
  /** Box width in user-space units (before rotation). */
  readonly width: number;
  readonly height: number;
  readonly rotate: number;
  /** Lower-left corner of the box; a non-zero origin shifts every mapped point. */
  readonly originX?: number;
  readonly originY?: number;
}

/**
 * Display size of a page after its clockwise `/Rotate` is applied. A quarter
 * turn swaps the box dimensions; two quarter turns keep them.
 */
export function pageDisplaySize(box: PageBox): { width: number; height: number } {
  const rotate = normalizeRotate(box.rotate);
  return rotate === 90 || rotate === 270
    ? { width: box.height, height: box.width }
    : { width: box.width, height: box.height };
}

/**
 * Map a user-space point to display space: origin at the box's upper-left,
 * y increasing downward, with the clockwise `/Rotate` applied.
 */
export function toDisplaySpace(box: PageBox, userX: number, userY: number): Point {
  const x = userX - (box.originX ?? 0);
  const y = userY - (box.originY ?? 0);
  const { width: w, height: h } = box;
  switch (normalizeRotate(box.rotate)) {
    case 90:
      return { x: y, y: x };
    case 180:
      return { x: w - x, y };
    case 270:
      return { x: h - y, y: w - x };
    default:
      return { x, y: h - y };
  }
}

function normalizeRotate(rotate: number): 0 | 90 | 180 | 270 {
  if (!Number.isFinite(rotate)) return 0;
  const normalized = ((((Math.round(rotate / 90) * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  return normalized;
}
