import {
  cachedImageDims,
  type GenerativeEditProvider,
  type GenerativeEditResult,
} from '@varve/engine';
import type { GenerativeEditRecord, GenerativeEditVariation } from '@varve/scene';
import { loadBoundedImageSource } from './imageLoading';

/** Rehydrate a persisted candidate for comparison without rerunning inference. */
export function persistedVariationResult(
  edit: GenerativeEditRecord,
  variation: GenerativeEditVariation,
  imageData: ImageData,
): GenerativeEditResult {
  const outputFrame = variation.outputFrame ?? edit.outputFrame;
  const persistedProvider = variation.provider ?? edit.provider;
  // Legacy records may contain an input frame without the explicit model
  // semantics added in schema 2. Do not pass that incomplete frame to the
  // engine result type or accidentally present it as reproducible diffusion
  // provenance; the baked candidate remains usable without it.
  const persistedInputFrame = persistedProvider.inputFrame;
  const inputFrame =
    persistedInputFrame?.inputKind !== undefined &&
    persistedInputFrame.maskConvention !== undefined &&
    persistedInputFrame.maskInput !== undefined
      ? {
          ...persistedInputFrame,
          inputKind: persistedInputFrame.inputKind,
          maskConvention: persistedInputFrame.maskConvention,
          maskInput: persistedInputFrame.maskInput,
        }
      : undefined;
  const provider: GenerativeEditProvider = { ...persistedProvider, inputFrame };
  return {
    imageData,
    width: variation.width,
    height: variation.height,
    filledBounds: {
      x: outputFrame.x,
      y: outputFrame.y,
      w: outputFrame.width,
      h: outputFrame.height,
    },
    mode: edit.mode,
    quality: variation.settings?.quality ?? edit.settings.quality,
    provider,
    processingTimeMs: 0,
    warnings: [],
  };
}

/**
 * Keep candidate metadata available without retaining another decoded full
 * raster. The persisted asset/data URL remains the source of truth for the
 * preview and Apply path; ImageData is only needed by the inference result
 * type and is not read by the dialog for an unloaded candidate.
 */
export function unloadedVariationImageData(): ImageData {
  return new ImageData(new Uint8ClampedArray(4), 1, 1);
}

export function metadataOnlyVariationResult(result: GenerativeEditResult): GenerativeEditResult {
  return { ...result, imageData: unloadedVariationImageData() };
}

/** Rebuild a bounded full-composition preview from a persisted candidate. */
export async function persistedVariationPreviewDataUrl(
  basePreview: HTMLCanvasElement,
  sourceWidth: number,
  sourceHeight: number,
  variation: GenerativeEditVariation,
  asset: { dataUrl: string; naturalWidth: number; naturalHeight: number },
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = basePreview.width;
  canvas.height = basePreview.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Preview canvas unavailable');
  context.drawImage(basePreview, 0, 0);

  const image = await loadBoundedImageSource(
    asset.dataUrl,
    asset.naturalWidth,
    asset.naturalHeight,
    Math.max(basePreview.width, basePreview.height),
  );
  const outputFrame = variation.outputFrame;
  const frame = outputFrame
    ? outputFrame
    : {
        x: 0,
        y: 0,
        width: sourceWidth,
        height: sourceHeight,
      };
  context.drawImage(
    image,
    0,
    0,
    cachedImageDims(image).width,
    cachedImageDims(image).height,
    (frame.x / sourceWidth) * basePreview.width,
    (frame.y / sourceHeight) * basePreview.height,
    (frame.width / sourceWidth) * basePreview.width,
    (frame.height / sourceHeight) * basePreview.height,
  );
  return canvas.toDataURL('image/png');
}
