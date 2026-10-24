/**
 * PaddleOCR text detection — locates text regions in an image (useful
 * standalone for redaction/accessibility workflows, and as the
 * foundation for full OCR).
 *
 * Shared by standalone text detection and the OCR recognition pipeline.
 * Recognition owns its separately acquired graph and matching dictionary.
 *
 * Model: PP-OCRv4 detection (Apache-2.0, PaddlePaddle/PaddleOCR, Baidu).
 * ONNX export: deepghs/paddleocr (det/ch_PP-OCRv4_det/model.onnx).
 * Verified 2026-07-21 by downloading the real graph:
 *   input: x [B,3,H,W] float32, fully dynamic H/W (fully convolutional —
 *     the DB/DBNet++ architecture has no fixed-size requirement, but its
 *     stride-32 downsampling means H and W should be padded to a
 *     multiple of 32 for correct upsampling back to full resolution)
 *   output: sigmoid_0.tmp_0 [B,1,H,W] — a per-pixel "is this near text"
 *     probability map (the DB algorithm's shrink map), already through
 *     Sigmoid. Turning this into actual text-region polygons needs
 *     thresholding + connected-component extraction + box "unclipping"
 *     (expanding the shrunk region back to the real text boundary) —
 *     implemented below as an axis-aligned bounding-box approximation
 *     (real DBNet postprocessing uses minimum-area rotated rectangles;
 *     axis-aligned boxes support upright lines; rotated/perspective text
 *     still requires a separate deskewing contract).
 * Opset 11, ImageNet-style normalization (standard PaddleOCR preprocessing).
 */
import type { TensorSpec } from '../imageTensor';

export const PADDLE_DET_TENSOR_SPEC: TensorSpec = {
  inputWidth: 0,
  inputHeight: 0,
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
  paddingRgb: [0, 0, 0],
};

const STRIDE = 32;

/** Round a dimension up to the nearest multiple of the detector's stride
 * so the fully-convolutional network's downsample/upsample stays aligned. */
export function padToStride(dimension: number, stride = STRIDE): number {
  return Math.ceil(dimension / stride) * stride;
}

/** Preserve source pixels at the origin; padding is not an image resize. */
export function padTextDetectionImage(source: ImageData): ImageData {
  const width = padToStride(source.width);
  const height = padToStride(source.height);
  const padded = new ImageData(width, height);
  for (let row = 0; row < source.height; row++) {
    padded.data.set(
      source.data.subarray(row * source.width * 4, (row + 1) * source.width * 4),
      row * width * 4,
    );
  }
  return padded;
}

export interface TextRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Mean detection confidence within the region. */
  confidence: number;
}

/** Convert a stride-padded detector map to source coordinates by clipping,
 * never by squeezing the padded extent back into the smaller source image. */
export function decodePaddedTextRegions(
  data: Float32Array,
  mapWidth: number,
  mapHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  probThreshold = 0.3,
): TextRegion[] {
  return decodeTextRegions(
    data,
    mapWidth,
    mapHeight,
    padToStride(sourceWidth),
    padToStride(sourceHeight),
    probThreshold,
    16,
    { width: sourceWidth, height: sourceHeight },
  );
}

/** DBPostProcess expands its shrink polygon by area * ratio / perimeter.
 * Our axis-aligned rectangle uses the same distance with the upstream default
 * ratio 2.0. Expand in map space before scaling and clipping to source pixels.
 * https://github.com/PaddlePaddle/PaddleOCR/blob/main/ppocr/postprocess/db_postprocess.py
 */
function unclipTextBox(
  minX: number,
  minY: number,
  width: number,
  height: number,
  scaleX: number,
  scaleY: number,
  source: { width: number; height: number },
): Omit<TextRegion, 'confidence'> {
  const distance = (width * height * 2) / (2 * (width + height));
  const x = Math.max(0, Math.floor((minX - distance) * scaleX));
  const y = Math.max(0, Math.floor((minY - distance) * scaleY));
  const right = Math.min(source.width, Math.ceil((minX + width + distance) * scaleX));
  const bottom = Math.min(source.height, Math.ceil((minY + height + distance) * scaleY));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Decode the detector's per-pixel probability map into axis-aligned
 * text-region boxes via thresholding, flood-fill and DB boundary expansion.
 * `probThreshold` follows PaddleOCR's default (0.3 on the shrink map);
 * `minRegionArea` filters out single-pixel noise.
 */
export function decodeTextRegions(
  data: Float32Array,
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
  probThreshold = 0.3,
  minRegionArea = 16,
  sourceExtent: { width: number; height: number } = { width: targetWidth, height: targetHeight },
): TextRegion[] {
  const visited = new Uint8Array(width * height);
  const regions: TextRegion[] = [];
  const scaleX = targetWidth / width;
  const scaleY = targetHeight / height;

  for (let start = 0; start < width * height; start++) {
    if (visited[start] || data[start]! < probThreshold) continue;

    // Flood fill (4-connected) to find this component's extent.
    const stack = [start];
    visited[start] = 1;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let sum = 0;
    let count = 0;

    while (stack.length > 0) {
      const idx = stack.pop()!;
      const x = idx % width;
      const y = Math.floor(idx / width);
      sum += data[idx]!;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      // Left/right neighbors must stay within the same row — checking only
      // "does n land in column 0 or width-1" (as a prior version of this
      // guard did) misfires for narrow grids, since a legitimate one-step
      // move can coincidentally land in the last column too.
      const left = x > 0 ? idx - 1 : -1;
      const right = x < width - 1 ? idx + 1 : -1;
      const neighbors = [left, right, idx - width, idx + width];
      for (const n of neighbors) {
        if (n < 0 || n >= width * height) continue;
        if (visited[n] || data[n]! < probThreshold) continue;
        visited[n] = 1;
        stack.push(n);
      }
    }

    if (count < minRegionArea) continue;
    // Exclude pure stride-padding components before expansion; otherwise a
    // padding false positive could grow back into the actual image.
    if (minX * scaleX >= sourceExtent.width || minY * scaleY >= sourceExtent.height) continue;

    regions.push({
      ...unclipTextBox(minX, minY, maxX - minX + 1, maxY - minY + 1, scaleX, scaleY, sourceExtent),
      confidence: sum / count,
    });
  }

  return regions.sort((a, b) => a.y - b.y || a.x - b.x);
}
