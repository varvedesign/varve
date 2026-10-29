import {
  buildExpandedFrame,
  computeExpandPlan,
  type ExpandPlan,
  type ExpandWorkingFrame,
  expandPlanOutputFrame,
  GenerativeEditError,
  planExpandWorkingFrame,
} from '@varve/engine';
import { decodeRasterMaskRegionDataUrl } from '../../../tools/selectionMask';
import {
  computeSourceRegionFromMaskBounds,
  computeSourceRegionFromMaskCoverage,
  computeSourceRegionFromPreviewMask,
  fitSourceRegionToAspectRatio,
  loadImageRegionToImageData,
  mapSourceRegionToProxy,
  type SourceImageRegion,
  sampleMaskCoverageToRegion,
  samplePreviewMaskToRegion,
  workingPixelBudgetForTier,
  workingRasterDimensions,
} from '../generationRaster';
import { maskCoverageFromRgba, refineGenerativeMask } from '../maskOperations';
import { MAX_SOURCE_MASK_REFINEMENT_PIXELS, MAX_SOURCE_PROXY_DIMENSION } from './constants';
import type { GenerationPrelude, GenerationPrepared, GenerationRuntime } from './generationTypes';
import { imageSourceDims, loadVisibleImageSource } from './imageLoading';
import { maskCoverageDataUrl, previewRasterDimensions } from './previewEncoding';

export async function prepareGeneration(
  runtime: GenerationRuntime,
  prelude: GenerationPrelude,
): Promise<GenerationPrepared> {
  const {
    acceptedSourceAsset,
    capabilities,
    contextPadding,
    editableSourceMaskRef,
    expandPadding,
    imageSrc,
    maskExpansion,
    maskFeather,
    mode,
    overlaySources,
    previewCanvasRef,
    sourceAsset,
  } = runtime;
  const {
    previewHeight,
    previewMask,
    previewWidth,
    sourceHeight,
    sourceWidth,
    targetModelAspectRatio,
    token,
  } = prelude;
  let generationImage: ImageData;
  let mask: Uint8Array;
  let maskWidth: number;
  let maskHeight: number;
  let sourceRegion: SourceImageRegion | null = null;
  let userMaskDataUrl: string;
  let outputFrame: {
    x: number;
    y: number;
    width: number;
    height: number;
    sourceWidth: number;
    sourceHeight: number;
  };
  let sourceMaskForPersistence: {
    width: number;
    height: number;
    coverage?: Uint8Array;
    dataUrl?: string;
    bounds?: SourceImageRegion;
  } | null = null;
  let userMaskBounds: SourceImageRegion | undefined;
  let expandContext: {
    fullPlan: ExpandPlan;
    working: ExpandWorkingFrame;
    sourceBase: string;
  } | null = null;

  if (mode === 'expand') {
    const planned = computeExpandPlan(sourceWidth, sourceHeight, expandPadding, {
      maxOutputPixels: 16_777_216,
    });
    if (!planned.ok) {
      throw new GenerativeEditError(
        planned.error.code === 'invalid-margin' ? 'invalid-mask' : 'insufficient-memory',
        planned.error.message,
      );
    }
    const fullPlan = planned.plan;
    const workingBudget = workingPixelBudgetForTier(capabilities.resourceProfile.tier);
    const working = planExpandWorkingFrame(fullPlan, workingBudget);
    const sourceBase = sourceAsset?.dataUrl ?? acceptedSourceAsset?.dataUrl ?? imageSrc;
    const visibleSource = await loadVisibleImageSource(
      sourceBase,
      sourceWidth,
      sourceHeight,
      Math.max(working.sourceWidth, working.sourceHeight),
      overlaySources,
    );
    const visibleDimensions = imageSourceDims(visibleSource);
    if (visibleDimensions.width <= 0 || visibleDimensions.height <= 0) {
      throw new GenerativeEditError('invalid-image', 'The source image could not be decoded.');
    }
    const sourceRaster = loadImageRegionToImageData(
      visibleSource,
      { x: 0, y: 0, width: sourceWidth, height: sourceHeight },
      { width: working.sourceWidth, height: working.sourceHeight },
    );
    const expanded = buildExpandedFrame(sourceRaster, working.plan);
    generationImage = expanded.imageData;
    mask = expanded.mask;
    maskWidth = expanded.width;
    maskHeight = expanded.height;
    userMaskDataUrl = maskCoverageDataUrl(mask, maskWidth, maskHeight);
    userMaskBounds =
      computeSourceRegionFromMaskCoverage(mask, maskWidth, maskHeight, 0) ?? undefined;
    expandContext = { fullPlan, working, sourceBase };
    const originalPreview = previewCanvasRef.current;
    if (originalPreview) {
      const previewDimensions = previewRasterDimensions(
        fullPlan.outputWidth,
        fullPlan.outputHeight,
      );
      originalPreview.width = previewDimensions.width;
      originalPreview.height = previewDimensions.height;
      const previewContext = originalPreview.getContext('2d');
      if (!previewContext) throw new Error('Preview canvas is unavailable');
      previewContext.clearRect(0, 0, originalPreview.width, originalPreview.height);
      previewContext.imageSmoothingEnabled = true;
      previewContext.imageSmoothingQuality = 'high';
      previewContext.drawImage(
        visibleSource,
        0,
        0,
        visibleDimensions.width,
        visibleDimensions.height,
        (fullPlan.sourceOffsetX / fullPlan.outputWidth) * originalPreview.width,
        (fullPlan.sourceOffsetY / fullPlan.outputHeight) * originalPreview.height,
        (fullPlan.sourceWidth / fullPlan.outputWidth) * originalPreview.width,
        (fullPlan.sourceHeight / fullPlan.outputHeight) * originalPreview.height,
      );
    }
    outputFrame = expandPlanOutputFrame(fullPlan);
  } else {
    const previewScaleX = previewWidth / sourceWidth;
    const previewScaleY = previewHeight / sourceHeight;
    const refinedPreviewMask = refineGenerativeMask(
      previewMask,
      { width: previewWidth, height: previewHeight },
      {
        expansion: Math.round(maskExpansion * previewScaleX),
        feather: Math.round(maskFeather * Math.min(previewScaleX, previewScaleY)),
      },
    );
    const exactSourceMask = editableSourceMaskRef.current;
    const hasExactSourceMask =
      exactSourceMask?.width === sourceWidth && exactSourceMask.height === sourceHeight;
    let effectiveSourceMask: Uint8Array | null = null;
    let boundedSourceMask: {
      coverage: Uint8Array;
      region: SourceImageRegion;
    } | null = null;
    if (hasExactSourceMask && exactSourceMask?.coverage) {
      sourceMaskForPersistence = exactSourceMask;
      userMaskBounds = exactSourceMask.bounds;
      if (
        (maskExpansion !== 0 || maskFeather !== 0) &&
        sourceWidth * sourceHeight > MAX_SOURCE_MASK_REFINEMENT_PIXELS
      ) {
        throw new GenerativeEditError(
          'insufficient-memory',
          'This source mask is too large for exact grow/shrink or feather refinement on this device. Reduce the image size or use the visible preview mask.',
        );
      }
      effectiveSourceMask =
        maskExpansion !== 0 || maskFeather !== 0
          ? refineGenerativeMask(
              exactSourceMask.coverage,
              {
                width: sourceWidth,
                height: sourceHeight,
              },
              {
                expansion: Math.round(maskExpansion),
                feather: Math.round(maskFeather),
              },
            )
          : exactSourceMask.coverage;
    } else if (hasExactSourceMask && exactSourceMask?.dataUrl && exactSourceMask.bounds) {
      sourceMaskForPersistence = exactSourceMask;
      userMaskBounds = exactSourceMask.bounds;
      const decodePadding = Math.max(
        contextPadding,
        Math.abs(Math.round(maskExpansion)) + Math.round(maskFeather),
      );
      const decodedMaskRegion = computeSourceRegionFromMaskBounds(
        exactSourceMask.bounds,
        sourceWidth,
        sourceHeight,
        decodePadding,
      );
      const maskRegion =
        decodedMaskRegion && targetModelAspectRatio
          ? fitSourceRegionToAspectRatio(
              decodedMaskRegion,
              sourceWidth,
              sourceHeight,
              targetModelAspectRatio,
            )
          : decodedMaskRegion;
      if (!maskRegion) {
        throw new GenerativeEditError(
          'invalid-mask',
          'The persisted source mask has no valid selection bounds. Review the mask before generating.',
        );
      }
      const decodedMask = await decodeRasterMaskRegionDataUrl(
        exactSourceMask.dataUrl,
        sourceWidth,
        sourceHeight,
        maskRegion,
        undefined,
        token.signal,
      );
      if (token.signal.aborted) throw new Error('Generative mask decode was cancelled.');
      if (!decodedMask) {
        throw new GenerativeEditError(
          'invalid-mask',
          'The persisted source mask could not be decoded at its recorded dimensions. Review the mask before generating.',
        );
      }
      const decodedCoverage = maskCoverageFromRgba(decodedMask.data);
      boundedSourceMask = {
        coverage:
          maskExpansion !== 0 || maskFeather !== 0
            ? refineGenerativeMask(
                decodedCoverage,
                { width: decodedMask.width, height: decodedMask.height },
                {
                  expansion: Math.round(maskExpansion),
                  feather: Math.round(maskFeather),
                },
              )
            : decodedCoverage,
        region: maskRegion,
      };
    }
    const baseRegion = effectiveSourceMask
      ? computeSourceRegionFromMaskCoverage(
          effectiveSourceMask,
          sourceWidth,
          sourceHeight,
          contextPadding,
        )
      : boundedSourceMask
        ? boundedSourceMask.region
        : computeSourceRegionFromPreviewMask(
            refinedPreviewMask,
            previewWidth,
            previewHeight,
            sourceWidth,
            sourceHeight,
            contextPadding,
          );
    const region =
      baseRegion && targetModelAspectRatio
        ? fitSourceRegionToAspectRatio(
            baseRegion,
            sourceWidth,
            sourceHeight,
            targetModelAspectRatio,
          )
        : baseRegion;
    if (!region) {
      throw new GenerativeEditError('empty-mask', 'Mask refinement removed the edit region.');
    }
    const working = workingRasterDimensions(
      region,
      workingPixelBudgetForTier(capabilities.resourceProfile.tier),
    );
    const sourceBase = sourceAsset?.dataUrl ?? acceptedSourceAsset?.dataUrl ?? imageSrc;
    const sourceProxy = await loadVisibleImageSource(
      sourceBase,
      sourceWidth,
      sourceHeight,
      MAX_SOURCE_PROXY_DIMENSION,
      overlaySources,
    );
    const proxyDimensions = imageSourceDims(sourceProxy);
    const proxyRegion = mapSourceRegionToProxy(
      region,
      sourceWidth,
      sourceHeight,
      proxyDimensions.width,
      proxyDimensions.height,
    );
    generationImage = loadImageRegionToImageData(sourceProxy, proxyRegion, working);
    mask = effectiveSourceMask
      ? sampleMaskCoverageToRegion(
          effectiveSourceMask,
          sourceWidth,
          sourceHeight,
          sourceWidth,
          sourceHeight,
          region,
          working,
        )
      : boundedSourceMask
        ? sampleMaskCoverageToRegion(
            boundedSourceMask.coverage,
            boundedSourceMask.region.width,
            boundedSourceMask.region.height,
            boundedSourceMask.region.width,
            boundedSourceMask.region.height,
            {
              x: 0,
              y: 0,
              width: boundedSourceMask.region.width,
              height: boundedSourceMask.region.height,
            },
            working,
          )
        : samplePreviewMaskToRegion(
            refinedPreviewMask,
            previewWidth,
            previewHeight,
            sourceWidth,
            sourceHeight,
            region,
            working,
          );
    if (!mask.some((value) => value > 0)) {
      throw new GenerativeEditError('empty-mask', 'Mask refinement removed the edit region.');
    }
    maskWidth = working.width;
    maskHeight = working.height;
    sourceRegion = region;
    if (!userMaskBounds) {
      userMaskBounds =
        computeSourceRegionFromPreviewMask(
          previewMask,
          previewWidth,
          previewHeight,
          sourceWidth,
          sourceHeight,
          0,
        ) ?? undefined;
    }
    // The editable mask is authored on the bounded preview canvas, then
    // encoded row-by-row at source resolution for persistence. This keeps
    // the record's source-image-pixels contract without allocating a
    // source-sized RGBA working buffer.
    userMaskDataUrl = '';
    outputFrame = {
      x: 0,
      y: 0,
      width: sourceWidth,
      height: sourceHeight,
      sourceWidth,
      sourceHeight,
    };
  }
  return {
    generationImage,
    mask,
    maskWidth,
    maskHeight,
    sourceRegion,
    userMaskDataUrl,
    outputFrame,
    sourceMaskForPersistence,
    userMaskBounds,
    expandContext,
  };
}
