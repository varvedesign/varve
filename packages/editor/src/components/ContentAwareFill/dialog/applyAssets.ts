import { createEmbeddedAsset, decodedDataUrlByteLength, sha256Utf8 } from '@varve/scene';
import { thumbnailDimensions } from './previewEncoding';
import type { GenerationRecord } from './types';
import type { DialogState } from './useDialogState';

export function createGenerativeMaskAssets(editId: string, generation: GenerationRecord) {
  const makeMaskAsset = (suffix: string, dataUrl: string, width: number, height: number) => ({
    id: `generative-mask-${editId}-${suffix}`,
    mimeType: 'image/png' as const,
    dataUrl,
    width,
    height,
    byteLength: decodedDataUrlByteLength(dataUrl),
    // Raster-mask validation reserves `checksum` for a real SHA-256
    // digest. The short FNV content id is useful for asset naming but is
    // not an integrity checksum and caused every generative mask to be
    // discarded by DocumentCodec on save/reopen.
    checksum: sha256Utf8(dataUrl),
  });
  const userMaskAsset = makeMaskAsset(
    'user',
    generation.userMaskDataUrl,
    generation.userMaskWidth,
    generation.userMaskHeight,
  );
  const inferenceMaskAsset = makeMaskAsset(
    'inference',
    generation.inferenceMaskDataUrl,
    generation.inferenceMaskWidth,
    generation.inferenceMaskHeight,
  );
  // The current compositing path uses the refined coverage. Keep a named
  // reference even when it is byte-identical so future providers can
  // distinguish the mask used for synthesis from the mask used for blend.
  const compositeMaskAsset = makeMaskAsset(
    'composite',
    generation.inferenceMaskDataUrl,
    generation.inferenceMaskWidth,
    generation.inferenceMaskHeight,
  );
  const contextAsset = createEmbeddedAsset({
    dataUrl: generation.contextDataUrl,
    mimeType: 'image/png',
    naturalWidth: generation.contextWidth,
    naturalHeight: generation.contextHeight,
  });
  return { userMaskAsset, inferenceMaskAsset, compositeMaskAsset, contextAsset };
}

export function createVariationAssets(
  variations: DialogState['variations'],
  previewDataUrl: string,
  result: NonNullable<DialogState['result']>,
  generation: GenerationRecord,
) {
  const variationEntries =
    variations.length > 0
      ? variations
      : [
          {
            id: 'variation-1',
            dataUrl: previewDataUrl,
            thumbnailDataUrl: undefined,
            patchDataUrl: generation.patchDataUrl,
            patchWidth: generation.patchWidth,
            patchHeight: generation.patchHeight,
            patchFrame: generation.patchFrame,
            assetKind: generation.assetKind,
            result,
            seed: generation.seed,
          },
        ];
  const variationAssets = variationEntries.map((variation) =>
    createEmbeddedAsset({
      dataUrl: variation.patchDataUrl,
      mimeType: 'image/png',
      naturalWidth: variation.patchWidth,
      naturalHeight: variation.patchHeight,
    }),
  );
  const variationThumbnailAssets = variationEntries.map((variation, index) => {
    const thumbnailDataUrl = variation.thumbnailDataUrl ?? variation.dataUrl;
    if (thumbnailDataUrl === variation.dataUrl) return variationAssets[index]!;
    const dimensions = thumbnailDimensions(variation.result.width, variation.result.height);
    return createEmbeddedAsset({
      dataUrl: thumbnailDataUrl,
      mimeType: 'image/png',
      naturalWidth: dimensions.width,
      naturalHeight: dimensions.height,
    });
  });
  return { variationEntries, variationAssets, variationThumbnailAssets };
}
