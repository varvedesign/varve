import { type AlphaMaskCombineMode, combineAlphaMasks } from '@varve/engine';
import { type Document, getOwnRasterMaskAsset, type NodeId } from '@varve/scene';
import { decodeRasterMaskDataUrl } from '../../tools/selectionMask';

/** Count non-zero coverage pixels in a one-channel mask. */
export function countMaskCoverage(mask: Uint8Array): number {
  let count = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]! > 0) count += 1;
  }
  return count;
}

export function maskMatchesDimensions(mask: Uint8Array, width: number, height: number): boolean {
  return (
    mask instanceof Uint8Array &&
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0 &&
    mask.length === width * height
  );
}
/** Bound a mask-asset decode so Apply can never park on a corrupt PNG. */
const MASK_DECODE_TIMEOUT_MS = 10_000;

type MaskPayloadResult =
  | { ok: true; dataUrl: string; mask: Uint8Array }
  | { ok: false; code: string; message: string };

/**
 * Resolve the exact RGBA payload that Apply as mask will commit.
 *
 * Exported for direct tests: the combination arithmetic is already covered by
 * `maskAlgebra.test.ts`; what needs its own coverage is the decision to combine
 * at all — and to refuse — before the document is touched.
 *
 * `replace` is the historical behaviour and needs no existing mask. The other
 * combination modes are meaningful only against the mask already on the node:
 * applying them must never silently discard a mask the user painted or
 * refined, and an impossible combination must fail closed *before* the
 * document is touched rather than committing a surprising result.
 */
export async function buildMaskPayload(
  doc: Document,
  nodeId: NodeId,
  candidate: Uint8Array,
  width: number,
  height: number,
  combination: AlphaMaskCombineMode,
): Promise<MaskPayloadResult> {
  if (combination === 'replace') {
    return { ok: true, dataUrl: await maskToDataUrl(candidate, width, height), mask: candidate };
  }

  const node = doc.nodes[nodeId];
  const assetId = node?.kind === 'shape' ? node.mask?.rasterMask?.assetId : undefined;
  const asset = assetId ? getOwnRasterMaskAsset(doc, assetId) : undefined;
  if (!asset) {
    return {
      ok: false,
      code: 'combination_requires_mask',
      message: `The "${combination}" mask combination needs an existing mask on this image. Keep Replace, or paint a mask first.`,
    };
  }

  const decoded = await Promise.race([
    decodeRasterMaskDataUrl(asset.dataUrl),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), MASK_DECODE_TIMEOUT_MS)),
  ]);
  if (!decoded) {
    return {
      ok: false,
      code: 'mask_decode_failed',
      message:
        'The existing mask could not be read, so it was left unchanged. Try Replace instead.',
    };
  }
  if (decoded.width !== width || decoded.height !== height) {
    return {
      ok: false,
      code: 'mask_size_mismatch',
      message:
        'The existing mask does not match this image’s pixel dimensions, so it cannot be combined. It was left unchanged.',
    };
  }

  const existing = new Uint8Array(width * height);
  // Mask assets are white RGB with coverage in alpha; alpha is the coverage.
  for (let index = 0; index < existing.length; index += 1) {
    existing[index] = decoded.data[index * 4 + 3] ?? 0;
  }
  const combined = combineAlphaMasks(
    { data: existing, width, height },
    { data: candidate, width, height },
    combination,
  );
  if (countMaskCoverage(combined.data) === 0) {
    return {
      ok: false,
      code: 'empty_result',
      message: `Combining these masks produced no visible pixels, so nothing was applied. Adjust the prompts or choose Replace.`,
    };
  }
  return {
    ok: true,
    dataUrl: await maskToDataUrl(combined.data, width, height),
    mask: combined.data,
  };
}

async function maskToDataUrl(mask: Uint8Array, width: number, height: number): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i]!;
    imageData.data[i * 4] = 255;
    imageData.data[i * 4 + 1] = 255;
    imageData.data[i * 4 + 2] = 255;
    imageData.data[i * 4 + 3] = v;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}
