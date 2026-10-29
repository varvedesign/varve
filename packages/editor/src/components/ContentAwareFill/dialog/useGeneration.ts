import { GenerativeEditError, NATIVE_GENERATIVE_MODEL_PROFILE } from '@varve/engine';
import { useCallback } from 'react';
import { objectSelectionCandidateReviewKey } from '../../../context/objectSelectionTypes';
import { maskCoverageFromRgba } from '../maskOperations';
import { analyzeSelectionHealth } from '../selectionHealth';
import { prepareGeneration } from './generationPrepare';
import { runGeneration } from './generationRun';
import type { GenerationPrepared } from './generationTypes';
import type { DialogDerived } from './useDialogDerived';
import type { DialogState } from './useDialogState';

type Params = DialogState & DialogDerived;
export function useGeneration(params: Params) {
  const {
    acceptedSourceAsset,
    announce,
    canGenerate,
    contextPadding,
    currentJobSnapshotRef,
    diffusionModelHandle,
    expandPadding,
    guidanceScale,
    imageGuidanceScale,
    imageSrc,
    jobControllerRef,
    maskCanvasRef,
    maskExpansion,
    maskFeather,
    maskOrigin,
    maskRevisionRef,
    mode,
    modeAvailable,
    modeCapability,
    naturalSize,
    negativePrompt,
    objectSelection,
    objectSelectionNeedsRefinement,
    objectSelectionNeedsReview,
    objectSelectionReviewKey,
    overlaySources,
    prompt,
    quality,
    reviewedObjectSelectionKey,
    seed,
    setErrorMessage,
    setGenerationProgress,
    setGenerationStage,
    setMaskHealth,
    setStatus,
    sourceAsset,
    sourceImage,
    sourceSignature,
    steps,
    strength,
    variationCount,
  } = params;
  const handleGenerate = useCallback(async () => {
    if (objectSelectionNeedsRefinement) {
      const message =
        'Refine the highlighted Object Selection extent with an include point on the missing edge or a box around the full target before generating.';
      setErrorMessage(message);
      announce(message);
      return;
    }
    if (objectSelectionNeedsReview) {
      const message =
        'Review every highlighted Object Selection region before generating. Confirm the target or refine the mask first.';
      setErrorMessage(message);
      announce(message);
      return;
    }
    if (!imageSrc || !modeAvailable || !canGenerate) return;
    if (maskOrigin === 'object-selection') {
      // This is the last guard before a potentially long native job. The
      // visible key is publication-cached for render performance; generation
      // must use an exact mask reread so a mutated candidate cannot silently
      // become the procedure's target.
      const exactObjectSelectionReviewKey = objectSelection
        ? objectSelectionCandidateReviewKey(objectSelection, objectSelection.selectedCandidate, {
            verifyMask: true,
          })
        : null;
      if (
        !exactObjectSelectionReviewKey ||
        exactObjectSelectionReviewKey !== objectSelectionReviewKey ||
        exactObjectSelectionReviewKey !== objectSelection?.reviewedCandidateKey ||
        exactObjectSelectionReviewKey !== reviewedObjectSelectionKey
      ) {
        const message =
          'The reviewed Object Selection changed after inspection. Create a new preview and review it again before generating.';
        setErrorMessage(message);
        announce(message);
        return;
      }
    }
    const jobSnapshot = currentJobSnapshotRef.current;
    if (!jobSnapshot) return;
    const token = jobControllerRef.current.start(jobSnapshot);
    const isCurrentJob = () => {
      const currentSnapshot = currentJobSnapshotRef.current;
      const candidate = currentSnapshot
        ? { ...currentSnapshot, maskRevision: maskRevisionRef.current }
        : null;
      const current = candidate ? jobControllerRef.current.isCurrent(token, candidate) : false;
      return current;
    };
    setStatus('generating');
    setErrorMessage(null);
    setGenerationProgress(0);
    setGenerationStage('Preparing');
    try {
      const sourceWidth =
        naturalSize.w || sourceImage?.imageWidth || sourceAsset?.naturalWidth || 0;
      const sourceHeight =
        naturalSize.h || sourceImage?.imageHeight || sourceAsset?.naturalHeight || 0;
      if (sourceWidth <= 0 || sourceHeight <= 0) {
        throw new GenerativeEditError(
          'invalid-image',
          'The source image dimensions are unavailable.',
        );
      }
      const needsDiffusion =
        mode === 'replace' || ((mode === 'fill' || mode === 'expand') && prompt.trim().length > 0);
      const targetModelAspectRatio = needsDiffusion
        ? NATIVE_GENERATIVE_MODEL_PROFILE.frameContract.frameWidth /
          NATIVE_GENERATIVE_MODEL_PROFILE.frameContract.frameHeight
        : undefined;
      if (!isCurrentJob()) {
        throw new GenerativeEditError('stale', 'The source changed before generation completed.');
      }

      const maskCanvas = maskCanvasRef.current;
      if (!maskCanvas) throw new GenerativeEditError('invalid-mask', 'The mask is unavailable.');

      const previewMaskImageData = maskCanvas
        .getContext('2d')
        ?.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
      if (!previewMaskImageData)
        throw new GenerativeEditError('invalid-mask', 'The mask is unavailable.');
      const previewMask = maskCoverageFromRgba(previewMaskImageData.data);
      const previewWidth = maskCanvas.width;
      const previewHeight = maskCanvas.height;
      if (previewWidth <= 0 || previewHeight <= 0) {
        throw new GenerativeEditError('invalid-mask', 'The mask is unavailable.');
      }
      const currentMaskHealth = analyzeSelectionHealth(
        previewMask,
        previewWidth,
        previewHeight,
        mode,
      );
      setMaskHealth(currentMaskHealth);
      if (mode !== 'expand' && currentMaskHealth.blockingReason) {
        throw new GenerativeEditError('invalid-mask', currentMaskHealth.blockingReason);
      }

      const prepared: GenerationPrepared = await prepareGeneration(params, {
        sourceWidth,
        sourceHeight,
        needsDiffusion,
        targetModelAspectRatio,
        maskCanvas,
        previewMask,
        previewWidth,
        previewHeight,
        currentMaskHealth,
        jobSnapshot,
        token,
        isCurrentJob,
      });
      await runGeneration(params, {
        ...prepared,
        sourceWidth,
        sourceHeight,
        needsDiffusion,
        targetModelAspectRatio,
        maskCanvas,
        previewMask,
        previewWidth,
        previewHeight,
        currentMaskHealth,
        jobSnapshot,
        token,
        isCurrentJob,
      });
    } catch (err) {
      if (token.signal.aborted) {
        setStatus('idle');
        return;
      }
      const msg = err instanceof Error ? err.message : 'Generative edit failed';
      setStatus('error');
      setErrorMessage(msg);
    }
  }, [
    announce,
    contextPadding,
    canGenerate,
    diffusionModelHandle,
    expandPadding,
    imageSrc,
    acceptedSourceAsset,
    maskExpansion,
    maskFeather,
    modeCapability,
    mode,
    modeAvailable,
    prompt,
    quality,
    sourceSignature,
    sourceAsset,
    overlaySources,
    negativePrompt,
    seed,
    strength,
    steps,
    guidanceScale,
    imageGuidanceScale,
    variationCount,
    objectSelectionNeedsReview,
    objectSelectionNeedsRefinement,
    maskOrigin,
    objectSelection,
    objectSelectionReviewKey,
    reviewedObjectSelectionKey,
  ]);
  return { handleGenerate };
}

export type DialogGeneration = ReturnType<typeof useGeneration>;
