import { resizeMaskBilinear } from './maskOps';
import {
  computeLetterboxTransform,
  type ModelToSourceTransform,
  reconstructModelMask,
} from './reconstructMask';

/**
 * rembg and the official IS-Net / U2-Net / BiRefNet square-input graphs
 * stretch-resize to the model square. Letterbox padding only stays on for
 * extreme aspect ratios, where squash would destroy the subject.
 */
export const SQUARE_INPUT_LETTERBOX_ASPECT = 2.5;

export type SquareInputResizeMode = 'stretch' | 'letterbox';

export interface SquareInputTransform extends ModelToSourceTransform {
  mode: SquareInputResizeMode;
}

export function squareInputResizeMode(
  sourceWidth: number,
  sourceHeight: number,
  maxAspect: number = SQUARE_INPUT_LETTERBOX_ASPECT,
): SquareInputResizeMode {
  const shorter = Math.min(sourceWidth, sourceHeight);
  if (!(shorter > 0) || !Number.isFinite(maxAspect) || maxAspect <= 0) {
    return 'stretch';
  }
  return Math.max(sourceWidth, sourceHeight) / shorter > maxAspect ? 'letterbox' : 'stretch';
}

export function computeStretchTransform(
  sourceW: number,
  sourceH: number,
  modelW: number,
  modelH: number,
): ModelToSourceTransform {
  if (sourceW <= 0 || sourceH <= 0 || modelW <= 0 || modelH <= 0) {
    throw new Error('Stretch dimensions must be positive');
  }
  return {
    offsetX: 0,
    offsetY: 0,
    scaleX: modelW / sourceW,
    scaleY: modelH / sourceH,
    contentWidth: modelW,
    contentHeight: modelH,
    sourceWidth: sourceW,
    sourceHeight: sourceH,
    modelWidth: modelW,
    modelHeight: modelH,
  };
}

export function computeSquareInputTransform(
  sourceW: number,
  sourceH: number,
  modelW: number,
  modelH: number,
): SquareInputTransform {
  if (squareInputResizeMode(sourceW, sourceH) === 'letterbox') {
    return { mode: 'letterbox', ...computeLetterboxTransform(sourceW, sourceH, modelW, modelH) };
  }
  return { mode: 'stretch', ...computeStretchTransform(sourceW, sourceH, modelW, modelH) };
}

/** Map a square-input model mask back to source pixels. */
export function reconstructSquareInputMask(
  modelAlpha: Uint8Array,
  modelW: number,
  modelH: number,
  sourceW: number,
  sourceH: number,
): Uint8Array {
  const transform = computeSquareInputTransform(sourceW, sourceH, modelW, modelH);
  if (transform.mode === 'stretch') {
    return resizeMaskBilinear(modelAlpha, modelW, modelH, sourceW, sourceH);
  }
  return reconstructModelMask(modelAlpha, modelW, modelH, transform).alpha;
}
