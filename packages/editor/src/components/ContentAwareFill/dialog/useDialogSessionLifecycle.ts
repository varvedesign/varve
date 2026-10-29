import { useCallback, useEffect } from 'react';
import { emptySelectionHealth } from '../selectionHealth';
import { DEFAULT_BRUSH_SIZE, MAX_BATCH_VARIATIONS } from './constants';
import { previewRasterDimensions } from './previewEncoding';
import type { DialogDerived } from './useDialogDerived';
import type { DialogState } from './useDialogState';

type Params = DialogState & DialogDerived;
export function useDialogSessionLifecycle(params: Params) {
  const {
    acceptedEdit,
    announce,
    dialogRef,
    diffusionDownloadAbortRef,
    downloadAbortRef,
    editableSourceMaskRef,
    generationRef,
    imageSrc,
    isOpen,
    jobControllerRef,
    lastPaintPointRef,
    maskRevisionRef,
    naturalSize,
    onClose,
    previewAreaRef,
    previewCanvasRef,
    qualificationAbortRef,
    qualificationRunRef,
    sessionSourceSignatureRef,
    setActiveVariationId,
    setBrushSize,
    setContextPadding,
    setCustomZoomBase,
    setDiffusionModelDownloadAvailable,
    setDiffusionModelHandle,
    setDiffusionModelInstalled,
    setDiffusionModelQualificationAvailable,
    setDiffusionModelReason,
    setDiffusionModelSize,
    setDownloadProgress,
    setErrorMessage,
    setExpandAnchor,
    setExpandAspectRatio,
    setExpandPadding,
    setExpandTargetHeight,
    setExpandTargetWidth,
    setGenerationProgress,
    setGenerationStage,
    setGuidanceScale,
    setHasMaskStrokes,
    setImageGuidanceScale,
    setIsRefiningMask,
    setMaskExpansion,
    setMaskFeather,
    setMaskHealth,
    setMaskOperation,
    setMaskOrigin,
    setMaskRevision,
    setMaskVisible,
    setMode,
    setModelAvailable,
    setModelFitsMemory,
    setNaturalSize,
    setNegativePrompt,
    setPreviewDataUrl,
    setPreviewViewport,
    setPreviewZoom,
    setPrompt,
    setQuality,
    setResult,
    setReviewedObjectSelectionAt,
    setReviewedObjectSelectionKey,
    setSeed,
    setShowOriginal,
    setStatus,
    setSteps,
    setStrength,
    setVariationCount,
    setVariations,
    setZoomPercent,
    sourcePreviewImageRef,
    sourceSignature,
    typedNode,
  } = params;
  const invalidatePreview = useCallback(() => {
    jobControllerRef.current.cancel();
    generationRef.current = null;
    setResult(null);
    setPreviewDataUrl(null);
    setVariations([]);
    setActiveVariationId(null);
    setStatus('idle');
  }, []);

  // Expand temporarily resizes the review canvas to the proposed output frame.
  // Returning to a bounded mode must restore the source-sized canvas, or the
  // next review would composite onto the expanded frame dimensions.
  const resetPreviewToSource = useCallback(() => {
    const image = sourcePreviewImageRef.current;
    const previewCanvas = previewCanvasRef.current;
    if (!image || !previewCanvas || naturalSize.w <= 0 || naturalSize.h <= 0) return;
    const preview = previewRasterDimensions(naturalSize.w, naturalSize.h);
    previewCanvas.width = preview.width;
    previewCanvas.height = preview.height;
    const context = previewCanvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, preview.width, preview.height);
    context.drawImage(image, 0, 0, preview.width, preview.height);
  }, [naturalSize.w, naturalSize.h]);

  const handleEditMask = useCallback(() => {
    jobControllerRef.current.cancel();
    generationRef.current = null;
    setIsRefiningMask(true);
    setResult(null);
    setPreviewDataUrl(null);
    setActiveVariationId(null);
    setShowOriginal(false);
    setStatus('idle');
    setErrorMessage(null);
  }, []);

  const bumpMaskRevision = useCallback(() => {
    const nextRevision = maskRevisionRef.current + 1;
    maskRevisionRef.current = nextRevision;
    setMaskRevision(nextRevision);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const area = previewAreaRef.current;
    if (!area) return;
    const measure = () =>
      setPreviewViewport({ width: area.clientWidth, height: area.clientHeight });
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(area);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isOpen]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (isOpen && !el.open) {
      el.showModal();
    } else if (!isOpen && el.open) {
      el.close();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    jobControllerRef.current.cancel();
    editableSourceMaskRef.current = null;
    qualificationRunRef.current += 1;
    sessionSourceSignatureRef.current = sourceSignature;
    setQuality('fast');
    setMode('remove');
    setPrompt('');
    setNegativePrompt('');
    setSeed(null);
    setVariationCount(1);
    setStrength(0.75);
    setSteps(24);
    setGuidanceScale(7);
    setImageGuidanceScale(1);
    setBrushSize(DEFAULT_BRUSH_SIZE);
    setMaskExpansion(0);
    setMaskFeather(0);
    setContextPadding(32);
    setMaskOrigin('brush');
    setMaskOperation('replace');
    setReviewedObjectSelectionKey(null);
    setReviewedObjectSelectionAt(null);
    maskRevisionRef.current = 0;
    setMaskRevision(0);
    setModelAvailable(false);
    setModelFitsMemory(null);
    setDiffusionModelInstalled(false);
    setDiffusionModelDownloadAvailable(false);
    setDiffusionModelQualificationAvailable(false);
    setDiffusionModelHandle(null);
    setDiffusionModelSize(0);
    setDiffusionModelReason(null);
    setStatus('idle');
    setErrorMessage(null);
    setResult(null);
    setPreviewDataUrl(null);
    setVariations([]);
    setActiveVariationId(null);
    generationRef.current = null;
    setHasMaskStrokes(false);
    lastPaintPointRef.current = null;
    setMaskHealth(emptySelectionHealth());
    setIsRefiningMask(false);
    setShowOriginal(false);
    setPreviewZoom('fit');
    setCustomZoomBase('fit');
    setZoomPercent(100);
    setMaskVisible(true);
    setDownloadProgress(0);
    setGenerationProgress(0);
    setGenerationStage('Preparing');
    setNaturalSize({ w: 0, h: 0 });
    setExpandPadding({ top: 0, right: 0, bottom: 0, left: 0 });
    setExpandAspectRatio('free');
    setExpandAnchor('center');
    setExpandTargetWidth('');
    setExpandTargetHeight('');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !acceptedEdit) return;
    const settings = acceptedEdit.settings;
    setMode(acceptedEdit.mode);
    setQuality(settings.quality === 'draft' ? 'fast' : 'ai');
    setPrompt(settings.prompt ?? '');
    setNegativePrompt(settings.negativePrompt ?? '');
    setSeed(settings.seed ?? null);
    setStrength(settings.strength ?? 0.75);
    setSteps(settings.steps ?? 24);
    setGuidanceScale(settings.guidanceScale ?? 7);
    setImageGuidanceScale(settings.imageGuidanceScale ?? 1);
    setMaskExpansion(settings.maskExpansion ?? 0);
    setMaskFeather(settings.feather ?? 0);
    setContextPadding(settings.contextPadding ?? 32);
    if (acceptedEdit.mode === 'expand') {
      setExpandPadding({
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      });
      setExpandAspectRatio('free');
      setExpandAnchor('center');
      // Reopening an accepted Expand reviews the accepted output, which is
      // now the current source for a possible subsequent expansion. Reusing
      // the original margins here would silently plan the same expansion a
      // second time against an already-expanded frame.
      setExpandTargetWidth(String(acceptedEdit.outputFrame.width));
      setExpandTargetHeight(String(acceptedEdit.outputFrame.height));
    }
    setVariationCount(
      Math.max(1, Math.min(MAX_BATCH_VARIATIONS, acceptedEdit.variations.length || 1)),
    );
  }, [acceptedEdit, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (!typedNode || !imageSrc) {
      invalidatePreview();
      announce('Generative Edit closed because its source image is no longer available');
      onClose();
      return;
    }
    const previous = sessionSourceSignatureRef.current;
    if (previous && previous !== sourceSignature) {
      invalidatePreview();
      editableSourceMaskRef.current = null;
      setReviewedObjectSelectionKey(null);
      setReviewedObjectSelectionAt(null);
      setErrorMessage('The source image changed. Review the mask and generate again.');
      sessionSourceSignatureRef.current = sourceSignature;
    }
  }, [announce, imageSrc, invalidatePreview, isOpen, onClose, sourceSignature, typedNode]);

  useEffect(() => {
    if (!isOpen) {
      jobControllerRef.current.cancel();
      downloadAbortRef.current?.abort();
      diffusionDownloadAbortRef.current?.abort();
      qualificationAbortRef.current?.abort();
      qualificationRunRef.current += 1;
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      jobControllerRef.current.cancel();
      downloadAbortRef.current?.abort();
      diffusionDownloadAbortRef.current?.abort();
      qualificationAbortRef.current?.abort();
      qualificationRunRef.current += 1;
    };
  }, []);
  return { bumpMaskRevision, handleEditMask, invalidatePreview, resetPreviewToSource };
}

export type DialogLifecycle = ReturnType<typeof useDialogSessionLifecycle>;
