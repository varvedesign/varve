import type { TensorSpec } from '../imageTensor';
import { ocrImageTensor } from './ocrImageTensor';
import type { TrOcrTokenizer } from './trocrTokenizer';

export const TROCR_INPUT_SIZE = 384;
export const TROCR_MAX_SEQUENCE_LENGTH = 128;

export const TROCR_TENSOR_SPEC: TensorSpec = {
  inputWidth: TROCR_INPUT_SIZE,
  inputHeight: TROCR_INPUT_SIZE,
  mean: [0.5, 0.5, 0.5],
  std: [0.5, 0.5, 0.5],
  paddingRgb: [255, 255, 255],
};

export interface TrOcrInput {
  imageData: ImageData;
  maxLength?: number;
}

export interface TrOcrOutput {
  text: string;
  confidence: number;
  charConfidences: number[];
}

/** ViT image processor: RGB, bilinear 384-square resize (no letterbox),
 * rescale 1/255, mean/std 0.5. Transparent design pixels are matted white. */
export function preprocessTrOcr(imageData: ImageData): {
  tensor: Float32Array;
  originalWidth: number;
  originalHeight: number;
} {
  const tensor = ocrImageTensor(imageData, TROCR_INPUT_SIZE, TROCR_INPUT_SIZE);
  return { tensor, originalWidth: imageData.width, originalHeight: imageData.height };
}

export function postprocessTrOcr(
  tokenIds: readonly number[],
  tokenConfidences: readonly number[],
  tokenizer: TrOcrTokenizer,
): TrOcrOutput {
  return tokenizer.decode(tokenIds, tokenConfidences);
}

export function validateTrOcrInput(input: TrOcrInput): string | null {
  if (!input.imageData || input.imageData.width < 10 || input.imageData.height < 10) {
    return 'Image is too small for OCR (minimum 10x10 pixels)';
  }
  if (input.imageData.width > 4096 || input.imageData.height > 4096) {
    return 'Image is too large for OCR (maximum 4096x4096 pixels)';
  }
  return null;
}
