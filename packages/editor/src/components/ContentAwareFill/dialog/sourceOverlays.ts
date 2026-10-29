import type { ShapeNode } from '@varve/scene';

export interface VisibleSourceOverlay {
  src: string;
  width: number;
  height: number;
  x: number;
  y: number;
  frameWidth: number;
  frameHeight: number;
  editId: string;
}

export function validOverlaySourceFrame(
  frame: unknown,
): frame is { x: number; y: number; width: number; height: number } {
  if (!frame || typeof frame !== 'object') return false;
  const candidate = frame as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every(
    (key) => typeof candidate[key] === 'number' && Number.isFinite(candidate[key]),
  );
}

export function visibleSourceOverlays(
  node: ShapeNode | null,
  assets:
    | Record<string, { dataUrl?: string; naturalWidth?: number; naturalHeight?: number }>
    | undefined,
): VisibleSourceOverlay[] {
  if (!node) return [];
  return (node.fills ?? []).flatMap((fill) => {
    if (fill.type !== 'image' || !fill.image?.generativeEditOverlay) return [];
    const image = fill.image;
    const overlay = image.generativeEditOverlay;
    if (!overlay) return [];
    const asset = image.assetId ? assets?.[image.assetId] : undefined;
    const src = asset?.dataUrl ?? image.src;
    const width = image.imageWidth ?? asset?.naturalWidth ?? 0;
    const height = image.imageHeight ?? asset?.naturalHeight ?? 0;
    const sourceFrame = validOverlaySourceFrame(overlay.sourceFrame) ? overlay.sourceFrame : null;
    const x = sourceFrame?.x ?? image.x;
    const y = sourceFrame?.y ?? image.y;
    const imageScale = Number.isFinite(image.scale) && image.scale > 0 ? image.scale : 1;
    const frameWidth = sourceFrame?.width ?? width * imageScale;
    const frameHeight = sourceFrame?.height ?? height * imageScale;
    if (
      !src ||
      width <= 0 ||
      height <= 0 ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      !Number.isFinite(frameWidth) ||
      !Number.isFinite(frameHeight) ||
      frameWidth <= 0 ||
      frameHeight <= 0
    ) {
      return [];
    }
    return [
      {
        src,
        width,
        height,
        x,
        y,
        frameWidth,
        frameHeight,
        editId: overlay.editId,
      },
    ];
  });
}
