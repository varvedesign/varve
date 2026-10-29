import {
  extractBoundedContext,
  GenerativeEditError,
  type GenerativeEditResult,
  getModelLoader,
  runGenerativeEdit,
} from '@varve/engine';
import { composeExpandedFullResolution } from '../expandComposition';
import {
  encodeMaskCoverageAtSourceSize,
  encodePreviewMaskAtSourceSize,
  renderGeneratedRegionToPatchCanvas,
  renderGeneratedRegionToPreviewCanvas,
  type SourceImageRegion,
} from '../generationRaster';
import { mergeGenerativeVariations } from '../variationSession';
import { MAX_BATCH_VARIATIONS, MAX_RETAINED_VARIATIONS, MODEL_ID } from './constants';
import type { GenerationPrelude, GenerationPrepared, GenerationRuntime } from './generationTypes';
import { loadVisibleImageSource } from './imageLoading';
import { metadataOnlyVariationResult, unloadedVariationImageData } from './persistedVariations';
import {
  imageDataDataUrl,
  maskCoverageDataUrl,
  thumbnailDataUrlFromCanvas,
} from './previewEncoding';

export async function runGeneration(
  runtime: GenerationRuntime,
  input: GenerationPrepared & GenerationPrelude,
): Promise<void> {
  const {
    activeVariationId,
    contextPadding,
    currentJobSnapshotRef,
    diffusionModelHandle,
    generationRef,
    guidanceScale,
    imageGuidanceScale,
    jobControllerRef,
    maskRevisionRef,
    mode,
    modeCapability,
    negativePrompt,
    overlaySources,
    previewCanvasRef,
    prompt,
    quality,
    seed,
    setActiveVariationId,
    setGenerationProgress,
    setGenerationStage,
    setIsRefiningMask,
    setPreviewDataUrl,
    setResult,
    setShowOriginal,
    setStatus,
    setVariations,
    sourceSignature,
    steps,
    strength,
    variationCount,
    variationSequenceRef,
  } = runtime;
  const {
    expandContext,
    generationImage,
    mask,
    maskHeight,
    maskWidth,
    outputFrame,
    sourceMaskForPersistence,
    sourceRegion,
    userMaskBounds,
  } = input;
  let userMaskDataUrl = input.userMaskDataUrl;
  const {
    isCurrentJob,
    jobSnapshot,
    needsDiffusion,
    previewHeight,
    previewMask,
    previewWidth,
    sourceHeight,
    sourceWidth,
    targetModelAspectRatio,
    token,
  } = input;
  const inferenceMaskDataUrl = maskCoverageDataUrl(mask, maskWidth, maskHeight);
  const preparedContext = extractBoundedContext(
    generationImage,
    mask,
    maskWidth,
    maskHeight,
    0,
    0,
    contextPadding,
    targetModelAspectRatio,
  );
  const contextDataUrl = imageDataDataUrl(preparedContext.imageData);
  const generationSeed = seed ?? jobSnapshot.sourceRevision + variationSequenceRef.current;
  let modelPath: string | undefined;
  if (needsDiffusion) {
    if (!diffusionModelHandle) {
      throw new GenerativeEditError(
        'missing-model',
        'Install a compatible local diffusion model before using this prompt-capable mode.',
      );
    }
    // The native adapter resolves this opaque handle inside the desktop
    // process. Model filesystem paths never cross the IPC boundary.
  } else if (quality === 'ai') {
    const loader = getModelLoader();
    modelPath = (await loader.getModelPath(MODEL_ID, token.signal)) ?? undefined;
    if (!modelPath) {
      throw new GenerativeEditError(
        'missing-model',
        'AI model not found. Download it or choose Draft quality.',
      );
    }
  }

  const effectiveVariationCount = Math.min(
    variationCount,
    modeCapability.limits.maxVariations,
    MAX_BATCH_VARIATIONS,
  );
  const generatedVariations: Array<{
    id: string;
    dataUrl: string;
    thumbnailDataUrl: string;
    patchDataUrl: string;
    patchWidth: number;
    patchHeight: number;
    patchFrame?: SourceImageRegion;
    assetKind: 'full-output' | 'region-overlay';
    result: GenerativeEditResult;
    seed: number;
  }> = [];
  let expandFullResolutionSource: Awaited<ReturnType<typeof loadVisibleImageSource>> | null = null;
  if (mode === 'expand') {
    if (!expandContext) throw new Error('Expansion plan is unavailable');
    expandFullResolutionSource = await loadVisibleImageSource(
      expandContext.sourceBase,
      sourceWidth,
      sourceHeight,
      Math.max(sourceWidth, sourceHeight),
      overlaySources,
    );
  }
  for (let index = 0; index < effectiveVariationCount; index += 1) {
    const variationSeed = generationSeed + index;
    const generated = await runGenerativeEdit({
      mode,
      imageData: generationImage,
      mask,
      maskWidth,
      maskHeight,
      maskOffsetX: 0,
      maskOffsetY: 0,
      quality: quality === 'fast' ? 'draft' : 'quality',
      prompt,
      negativePrompt,
      seed: variationSeed,
      strength,
      steps,
      guidanceScale,
      imageGuidanceScale,
      contextPadding,
      outputWidth: generationImage.width,
      outputHeight: generationImage.height,
      signal: token.signal,
      isCurrent: isCurrentJob,
      onProgress: ({ stage, progress }) => {
        if (!isCurrentJob() || !jobControllerRef.current.update(token, progress, stage)) return;
        setGenerationProgress((index + progress) / effectiveVariationCount);
        setGenerationStage(
          `${stage[0]?.toUpperCase() + stage.slice(1)} · variation ${index + 1}/${effectiveVariationCount}`,
        );
      },
      modelPath,
      modelHandle: diffusionModelHandle ?? undefined,
    });
    let dataUrl: string;
    let thumbnailDataUrl: string;
    let patchDataUrl: string;
    let patchWidth: number;
    let patchHeight: number;
    let patchFrame: SourceImageRegion | undefined;
    let assetKind: 'full-output' | 'region-overlay';
    let displayResult: GenerativeEditResult;
    if (mode === 'expand') {
      if (!expandContext || !expandFullResolutionSource) {
        throw new Error('Expansion plan is unavailable');
      }
      const composed = composeExpandedFullResolution({
        source: expandFullResolutionSource,
        sourceWidth,
        sourceHeight,
        plan: expandContext.fullPlan,
        generated: generated.imageData,
        working: expandContext.working,
      });
      dataUrl = composed.toDataURL('image/png');
      thumbnailDataUrl = thumbnailDataUrlFromCanvas(composed);
      patchDataUrl = dataUrl;
      patchWidth = composed.width;
      patchHeight = composed.height;
      assetKind = 'full-output';
      const scaleX = composed.width / generated.width;
      const scaleY = composed.height / generated.height;
      displayResult = {
        ...generated,
        imageData: unloadedVariationImageData(),
        width: composed.width,
        height: composed.height,
        filledBounds: {
          x: generated.filledBounds.x * scaleX,
          y: generated.filledBounds.y * scaleY,
          w: generated.filledBounds.w * scaleX,
          h: generated.filledBounds.h * scaleY,
        },
      };
    } else {
      if (!sourceRegion) throw new Error('Generated source region is unavailable');
      const patchCanvas = renderGeneratedRegionToPatchCanvas({
        source: generationImage,
        result: generated,
        mask,
      });
      const previewBase = previewCanvasRef.current;
      if (!previewBase) throw new Error('Preview canvas is unavailable');
      const previewResultCanvas = renderGeneratedRegionToPreviewCanvas({
        preview: previewBase,
        previewWidth,
        previewHeight,
        sourceWidth,
        sourceHeight,
        region: sourceRegion,
        source: generationImage,
        result: generated,
        mask,
      });
      dataUrl = previewResultCanvas.toDataURL('image/png');
      thumbnailDataUrl = thumbnailDataUrlFromCanvas(previewResultCanvas);
      patchDataUrl = patchCanvas.toDataURL('image/png');
      patchWidth = patchCanvas.width;
      patchHeight = patchCanvas.height;
      patchFrame = sourceRegion;
      assetKind = 'region-overlay';
      displayResult = {
        ...generated,
        imageData: unloadedVariationImageData(),
        width: sourceWidth,
        height: sourceHeight,
        filledBounds: {
          x:
            sourceRegion.x +
            (generated.filledBounds.x * sourceRegion.width) / generationImage.width,
          y:
            sourceRegion.y +
            (generated.filledBounds.y * sourceRegion.height) / generationImage.height,
          w: (generated.filledBounds.w * sourceRegion.width) / generationImage.width,
          h: (generated.filledBounds.h * sourceRegion.height) / generationImage.height,
        },
      };
    }
    generatedVariations.push({
      id: `variation-${++variationSequenceRef.current}`,
      dataUrl,
      thumbnailDataUrl,
      patchDataUrl,
      patchWidth,
      patchHeight,
      patchFrame,
      assetKind,
      // Keep only the active last candidate decoded in JS memory. Earlier
      // candidates remain fully available through their compressed data
      // URLs/assets and are rehydrated as metadata-only candidates.
      result:
        index === effectiveVariationCount - 1
          ? displayResult
          : metadataOnlyVariationResult(displayResult),
      seed: variationSeed,
    });
  }
  const generated = generatedVariations[generatedVariations.length - 1];
  const currentSnapshot = currentJobSnapshotRef.current;
  if (
    !generated ||
    !currentSnapshot ||
    !jobControllerRef.current.isCurrent(token, {
      ...currentSnapshot,
      maskRevision: maskRevisionRef.current,
    })
  ) {
    throw new GenerativeEditError('stale', 'The source changed while generation was running.');
  }
  if (mode !== 'expand') {
    if (sourceMaskForPersistence?.dataUrl) {
      userMaskDataUrl = sourceMaskForPersistence.dataUrl;
    } else if (sourceMaskForPersistence?.coverage) {
      userMaskDataUrl = await encodeMaskCoverageAtSourceSize(
        sourceMaskForPersistence.coverage,
        sourceMaskForPersistence.width,
        sourceMaskForPersistence.height,
        token.signal,
      );
    } else {
      userMaskDataUrl = await encodePreviewMaskAtSourceSize(
        previewMask,
        previewWidth,
        previewHeight,
        sourceWidth,
        sourceHeight,
        token.signal,
      );
    }
  }
  if (!isCurrentJob()) {
    throw new GenerativeEditError('stale', 'The source changed while saving the edit mask.');
  }
  if (
    !jobControllerRef.current.complete(token, {
      ...currentSnapshot,
      maskRevision: maskRevisionRef.current,
    })
  ) {
    throw new GenerativeEditError('stale', 'The source changed while finalizing the result.');
  }
  generationRef.current = {
    sourceSignature,
    userMaskDataUrl,
    inferenceMaskDataUrl,
    // Expand authors its mask as the full-frame border coverage at the
    // working output size; bounded modes author at source resolution.
    userMaskWidth: mode === 'expand' ? maskWidth : sourceWidth,
    userMaskHeight: mode === 'expand' ? maskHeight : sourceHeight,
    userMaskBounds,
    inferenceMaskWidth: maskWidth,
    inferenceMaskHeight: maskHeight,
    inferenceMaskOffsetX: sourceRegion?.x ?? 0,
    inferenceMaskOffsetY: sourceRegion?.y ?? 0,
    contextDataUrl,
    contextWidth: preparedContext.width,
    contextHeight: preparedContext.height,
    outputFrame,
    patchDataUrl: generated.patchDataUrl,
    patchWidth: generated.patchWidth,
    patchHeight: generated.patchHeight,
    patchFrame: generated.patchFrame,
    assetKind: generated.assetKind,
    result: generated.result,
    seed: generated.seed,
  };
  setVariations((previous) =>
    mergeGenerativeVariations(
      previous.map((variation) => ({
        ...variation,
        result: metadataOnlyVariationResult(variation.result),
      })),
      generatedVariations,
      activeVariationId,
      MAX_RETAINED_VARIATIONS,
    ),
  );
  setActiveVariationId(generated.id);
  setResult(generated.result);
  setPreviewDataUrl(generated.dataUrl);
  setIsRefiningMask(false);
  setShowOriginal(false);
  setStatus('idle');
}
