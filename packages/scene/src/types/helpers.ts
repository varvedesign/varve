import type { Shape } from '@varve/engine';
import { normalizeImagePerspective } from '../imagePerspective';
import type { ImageCropRect, ImageFillData, ImageFit } from './fills';

// ── Shape geometry helpers for Inspector F6 ─────────────────────────────────

/** Extract width from a Shape, returning 0 for non-sizeable shape kinds. */
export function shapeWidth(shape: Shape): number {
  switch (shape.kind) {
    case 'table':
      return shape.w;
    case 'rect':
      return shape.w;
    case 'ellipse':
      return shape.rx * 2;
    case 'circle':
      return shape.r * 2;
    case 'polygon':
      return shape.radius * 2;
    case 'star':
      return shape.outerRadius * 2;
    case 'line':
      return Math.abs(shape.to[0] - shape.from[0]);
    case 'arrow':
      return Math.abs(shape.to[0] - shape.from[0]);
    case 'path': {
      if (shape.points.length === 0) return 0;
      const xs = shape.points.map((p) => p.x);
      return Math.max(...xs) - Math.min(...xs);
    }
  }
}

/** Extract height from a Shape. */
export function shapeHeight(shape: Shape): number {
  switch (shape.kind) {
    case 'table':
      return shape.h;
    case 'rect':
      return shape.h;
    case 'ellipse':
      return shape.ry * 2;
    case 'circle':
      return shape.r * 2;
    case 'polygon':
      return shape.radius * 2;
    case 'star':
      return shape.outerRadius * 2;
    case 'line':
      return Math.abs(shape.to[1] - shape.from[1]);
    case 'arrow':
      return Math.abs(shape.to[1] - shape.from[1]);
    case 'path': {
      if (shape.points.length === 0) return 0;
      const ys = shape.points.map((p) => p.y);
      return Math.max(...ys) - Math.min(...ys);
    }
  }
}

// ── Image crop + transform validation ──────────────────────────────────────

/** Clamp a crop rect to be within the source image bounds. */
export function clampImageCropRect(
  crop: ImageCropRect,
  sourceWidth: number,
  sourceHeight: number,
): ImageCropRect {
  const sw = Math.max(1, sourceWidth);
  const sh = Math.max(1, sourceHeight);
  const x = Math.max(0, Math.min(crop.x, sw - 1));
  const y = Math.max(0, Math.min(crop.y, sh - 1));
  const w = Math.max(1, Math.min(crop.w, sw - x));
  const h = Math.max(1, Math.min(crop.h, sh - y));
  return { x, y, w, h };
}

/** Returns true if the crop rect covers the entire source image (or is degenerate). */
export function isFullImageCrop(
  crop: ImageCropRect | undefined,
  sourceWidth: number,
  sourceHeight: number,
): boolean {
  if (!crop) return true;
  const sw = Math.max(1, sourceWidth);
  const sh = Math.max(1, sourceHeight);
  return crop.x <= 0 && crop.y <= 0 && crop.w >= sw && crop.h >= sh;
}

/** Validate and normalize an image crop rect. Returns undefined for full-image crops. */
export function normalizeImageCropRect(
  crop: ImageCropRect | undefined,
  sourceWidth: number,
  sourceHeight: number,
): ImageCropRect | undefined {
  if (!crop) return undefined;
  if (
    !Number.isFinite(crop.x) ||
    !Number.isFinite(crop.y) ||
    !Number.isFinite(crop.w) ||
    !Number.isFinite(crop.h)
  ) {
    return undefined;
  }
  const clamped = clampImageCropRect(crop, sourceWidth, sourceHeight);
  if (isFullImageCrop(clamped, sourceWidth, sourceHeight)) return undefined;
  return clamped;
}

/** Validate image rotation is finite. Normalizes to [0, 360). */
export function normalizeImageRotation(rotation: number | undefined): number | undefined {
  if (rotation === undefined) return undefined;
  if (!Number.isFinite(rotation)) return undefined;
  // Normalize to [0, 360) to avoid drift
  const normalized = ((rotation % 360) + 360) % 360;
  // Snap near-zero to 0
  if (Math.abs(normalized) < 1e-6 || Math.abs(normalized - 360) < 1e-6) return 0;
  return normalized;
}

function isImageFit(value: unknown): value is ImageFit {
  return (
    value === 'fill' ||
    value === 'fit' ||
    value === 'stretch' ||
    value === 'tile' ||
    value === 'crop'
  );
}

/**
 * Normalize persisted per-usage image geometry.
 *
 * This is intentionally independent from document-version migrations: malformed
 * values can also enter a current-version document through plugins, clipboard
 * data, or hand-edited JSON. Optional source dimensions remain optional for
 * legacy fills, but when present they must be positive finite values.
 */
export function normalizeImageFillData(
  image: ImageFillData,
  source?: { width?: number; height?: number },
): ImageFillData {
  const sourceWidth =
    Number.isFinite(source?.width) && (source?.width as number) > 0 ? source?.width : undefined;
  const sourceHeight =
    Number.isFinite(source?.height) && (source?.height as number) > 0 ? source?.height : undefined;
  const imageWidth =
    sourceWidth ??
    (Number.isFinite(image.imageWidth) && (image.imageWidth as number) > 0
      ? image.imageWidth
      : undefined);
  const imageHeight =
    sourceHeight ??
    (Number.isFinite(image.imageHeight) && (image.imageHeight as number) > 0
      ? image.imageHeight
      : undefined);
  const cropWidth =
    image.crop && Number.isFinite(image.crop.w) && image.crop.w > 0
      ? Math.max(
          image.crop.w,
          Number.isFinite(image.crop.x) ? image.crop.x + image.crop.w : image.crop.w,
        )
      : 1;
  const cropHeight =
    image.crop && Number.isFinite(image.crop.h) && image.crop.h > 0
      ? Math.max(
          image.crop.h,
          Number.isFinite(image.crop.y) ? image.crop.y + image.crop.h : image.crop.h,
        )
      : 1;
  const crop = normalizeImageCropRect(
    image.crop,
    imageWidth ?? cropWidth,
    imageHeight ?? cropHeight,
  );
  const rotation = normalizeImageRotation(image.rotation);
  const perspective = normalizeImagePerspective(image.perspective);

  const normalized: ImageFillData = {
    ...image,
    fit: isImageFit(image.fit) ? image.fit : 'fill',
    x: Number.isFinite(image.x) ? image.x : 0,
    y: Number.isFinite(image.y) ? image.y : 0,
    scale: Number.isFinite(image.scale) && image.scale > 0 ? image.scale : 1,
    ...(imageWidth !== undefined ? { imageWidth } : {}),
    ...(imageHeight !== undefined ? { imageHeight } : {}),
    ...(crop !== undefined ? { crop } : {}),
    ...(rotation !== undefined ? { rotation } : {}),
    ...(image.flipH !== undefined ? { flipH: image.flipH === true } : {}),
    ...(image.flipV !== undefined ? { flipV: image.flipV === true } : {}),
    ...(perspective !== undefined ? { perspective } : {}),
  };

  if (imageWidth === undefined) delete normalized.imageWidth;
  if (imageHeight === undefined) delete normalized.imageHeight;
  if (crop === undefined) delete normalized.crop;
  if (rotation === undefined) delete normalized.rotation;
  if (perspective === undefined) delete normalized.perspective;
  return normalized;
}
