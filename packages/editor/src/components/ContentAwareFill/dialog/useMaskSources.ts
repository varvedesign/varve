import { useCallback } from 'react';
import { objectSelectionCandidateReviewKey } from '../../../context/objectSelectionTypes';
import { prepareImageMaskMapper } from '../../../tools/imageMaskCoordinates';
import {
  decodeRasterMaskDataUrl,
  rasterizeAreaSelectionForNode,
} from '../../../tools/selectionMask';
import { maskCoverageFromRgba } from '../maskOperations';
import { loadImageToImageData } from './imageLoading';
import { previewRasterDimensions } from './previewEncoding';
import { readCurrentSourceIdentity } from './sourceIdentity';
import type { DialogDerived } from './useDialogDerived';
import type { DialogState } from './useDialogState';
import type { DialogMaskPainting } from './useMaskPainting';

type Params = DialogState & DialogDerived & DialogMaskPainting;
export function useMaskSources(params: Params) {
  const {
    announce,
    applyMaskCoverage,
    areaSelection,
    backgroundRemovalPreview,
    hasMaskStrokes,
    imageSrc,
    layerMaskAsset,
    maskCanvasRef,
    naturalSize,
    nodeId,
    objectSelection,
    objectSelectionReviewKey,
    onClose,
    setReviewedObjectSelectionAt,
    setReviewedObjectSelectionKey,
    setTool,
    sourceAsset,
    sourceImage,
    state,
    typedNode,
  } = params;
  const handleUsePixelSelection = useCallback(() => {
    if (!nodeId || !areaSelection) {
      announce('Create a pixel selection before using it as the edit mask');
      return;
    }
    const raster = rasterizeAreaSelectionForNode(state.document, nodeId, areaSelection);
    if (!raster) {
      announce('The current pixel selection cannot be mapped to this image');
      return;
    }
    applyMaskCoverage(raster.data, raster.width, raster.height, 'pixel-selection');
  }, [announce, applyMaskCoverage, areaSelection, nodeId, state.document]);

  const handleUseObjectSelection = useCallback(async () => {
    if (objectSelection?.status !== 'ready') {
      announce('Run Object Selection and choose a candidate before using it as the edit mask');
      return;
    }
    if (
      !objectSelectionReviewKey ||
      objectSelection.reviewedCandidateKey !== objectSelectionReviewKey
    ) {
      announce(
        'Review the highlighted Object Selection target in the Object Selection panel before importing it into Generative Edit.',
      );
      return;
    }
    if (!objectSelection.sourceFingerprint) {
      announce('This Object Selection is from an older session; create a new preview first');
      return;
    }
    const candidate = objectSelection.candidates[objectSelection.selectedCandidate];
    if (!candidate || objectSelection.width <= 0 || objectSelection.height <= 0) {
      announce('The selected Object Selection candidate is not available');
      return;
    }
    // The render-time review key uses the publication fingerprint so it does
    // not rescan a large photograph on every React render. Re-read the mask
    // once at this handoff boundary as well: a candidate that changed after
    // review must not become the editable generation mask under old approval.
    const exactObjectSelectionReviewKey = objectSelectionCandidateReviewKey(
      objectSelection,
      objectSelection.selectedCandidate,
      { verifyMask: true },
    );
    if (
      !exactObjectSelectionReviewKey ||
      exactObjectSelectionReviewKey !== objectSelectionReviewKey ||
      exactObjectSelectionReviewKey !== objectSelection.reviewedCandidateKey
    ) {
      announce(
        'The reviewed Object Selection changed after inspection. Create a new preview and review it again before using it for generation.',
      );
      return;
    }
    if (candidate.promptDiagnostics?.requiresRefinement) {
      announce(
        'The highlighted selection reaches an unsupported image edge. Add an include point on that extent or draw a box around the full target before using it for generation.',
      );
      return;
    }
    if (!objectSelectionReviewKey) {
      announce(
        'This Object Selection preview cannot be verified safely; create a new preview before using it.',
      );
      return;
    }
    const sourceHasImmutableLocator = /^(?:data|blob):/i.test(imageSrc);
    const currentSource = sourceHasImmutableLocator
      ? {
          width: objectSelection.width,
          height: objectSelection.height,
          fingerprint: objectSelection.sourceFingerprint,
        }
      : await readCurrentSourceIdentity(imageSrc);
    if (
      !currentSource ||
      currentSource.width !== objectSelection.width ||
      currentSource.height !== objectSelection.height ||
      currentSource.fingerprint !== objectSelection.sourceFingerprint
    ) {
      console.warn('[CAF] stale Object Selection candidate', {
        currentSource,
        candidate: {
          width: objectSelection.width,
          height: objectSelection.height,
          fingerprint: objectSelection.sourceFingerprint,
        },
      });
      announce('The image changed after Object Selection; create a new preview before using it');
      return;
    }
    if (objectSelection.mappingFingerprint) {
      const currentMapper =
        typedNode &&
        prepareImageMaskMapper({
          document: state.document,
          node: typedNode,
          sourceWidth: objectSelection.width,
          sourceHeight: objectSelection.height,
        });
      if (!currentMapper || currentMapper.fingerprint !== objectSelection.mappingFingerprint) {
        announce(
          'The image placement changed after Object Selection; create a new preview before using it',
        );
        return;
      }
    }
    const applied = applyMaskCoverage(
      candidate.mask,
      objectSelection.width,
      objectSelection.height,
      'object-selection',
    );
    if (applied) {
      // Importing the candidate into the edit mask is not the same as
      // confirming that it is the intended object. The model has only
      // satisfied prompt geometry; the user must review the overlay in the
      // generation context before any pixels can be changed.
      setReviewedObjectSelectionKey(null);
      setReviewedObjectSelectionAt(null);
    }
  }, [
    announce,
    applyMaskCoverage,
    imageSrc,
    objectSelection,
    objectSelectionReviewKey,
    state.document,
    typedNode,
  ]);

  const handleStartObjectSelection = useCallback(() => {
    if (!nodeId) {
      announce('Select one image before starting Object Selection');
      return;
    }
    if (hasMaskStrokes) {
      announce(
        'Finish or clear the current mask before leaving Generative Edit for Object Selection; the in-progress mask is not discarded.',
      );
      return;
    }
    // The dialog is modal, so the canvas cannot receive the click/box prompt
    // while it is open. Close this review session first, then hand control to
    // the canonical Object Selection tool. The transient candidate remains
    // attached to this image and can be imported when Generative Edit is
    // opened again.
    onClose();
    setTool('sam2Segment');
    announce(
      'Object Selection active. Click to include, Shift-click to subtract, or drag a box; reopen Generative Edit to use the candidate.',
    );
  }, [announce, hasMaskStrokes, nodeId, onClose, setTool]);

  const handleUseLayerMask = useCallback(async () => {
    if (!layerMaskAsset) {
      announce('This image has no raster layer mask to use');
      return;
    }
    const target = maskCanvasRef.current;
    if (!target || naturalSize.w <= 0 || naturalSize.h <= 0) {
      announce('The source image is still loading; try again in a moment');
      return;
    }
    const decoded = await decodeRasterMaskDataUrl(layerMaskAsset.dataUrl, {
      width: target.width,
      height: target.height,
    });
    if (!decoded) {
      announce('The layer mask could not be decoded');
      return;
    }
    if (
      (decoded.sourceWidth ?? decoded.width) !== layerMaskAsset.width ||
      (decoded.sourceHeight ?? decoded.height) !== layerMaskAsset.height
    ) {
      announce('The layer mask dimensions do not match the stored mask asset');
      return;
    }
    applyMaskCoverage(
      maskCoverageFromRgba(decoded.data),
      decoded.width,
      decoded.height,
      'layer-mask',
    );
  }, [announce, applyMaskCoverage, layerMaskAsset, naturalSize.h, naturalSize.w]);

  const handleUseBackgroundRemovalPreview = useCallback(async () => {
    if (!backgroundRemovalPreview) {
      announce('The background removal preview is no longer current; run it again first');
      return;
    }
    const target = maskCanvasRef.current;
    if (!target || naturalSize.w <= 0 || naturalSize.h <= 0) {
      announce('The source image is still loading; try again in a moment');
      return;
    }
    const decoded = await decodeRasterMaskDataUrl(backgroundRemovalPreview.maskDataUrl, {
      width: target.width,
      height: target.height,
    });
    if (!decoded) {
      announce('The background removal preview mask could not be decoded');
      return;
    }
    const expectedSourceWidth =
      naturalSize.w || sourceImage?.imageWidth || sourceAsset?.naturalWidth || 0;
    const expectedSourceHeight =
      naturalSize.h || sourceImage?.imageHeight || sourceAsset?.naturalHeight || 0;
    if (
      (decoded.sourceWidth ?? decoded.width) !== backgroundRemovalPreview.width ||
      (decoded.sourceHeight ?? decoded.height) !== backgroundRemovalPreview.height ||
      backgroundRemovalPreview.sourceWidth !== expectedSourceWidth ||
      backgroundRemovalPreview.sourceHeight !== expectedSourceHeight
    ) {
      announce('The background removal preview does not match the current source dimensions');
      return;
    }
    const applied = applyMaskCoverage(
      maskCoverageFromRgba(decoded.data),
      decoded.width,
      decoded.height,
      'background-removal',
    );
    if (applied) {
      announce(
        `Using the ${backgroundRemovalPreview.actualMethod} background removal preview as an editable mask`,
      );
    }
  }, [
    announce,
    applyMaskCoverage,
    backgroundRemovalPreview,
    naturalSize.h,
    naturalSize.w,
    sourceAsset?.naturalHeight,
    sourceAsset?.naturalWidth,
    sourceImage?.imageHeight,
    sourceImage?.imageWidth,
  ]);

  const handleUseImageAlpha = useCallback(async () => {
    if (!imageSrc) {
      announce('The source image is not available for alpha selection');
      return;
    }
    try {
      const preview = previewRasterDimensions(naturalSize.w, naturalSize.h);
      const imageData = await loadImageToImageData(imageSrc, preview.width, preview.height);
      const coverage = new Uint8Array(imageData.width * imageData.height);
      for (let index = 0; index < coverage.length; index += 1) {
        coverage[index] = imageData.data[index * 4 + 3]!;
      }
      applyMaskCoverage(coverage, imageData.width, imageData.height, 'image-alpha');
    } catch (error) {
      announce(error instanceof Error ? error.message : 'The image alpha could not be loaded');
    }
  }, [announce, applyMaskCoverage, imageSrc]);
  return {
    handleStartObjectSelection,
    handleUseBackgroundRemovalPreview,
    handleUseImageAlpha,
    handleUseLayerMask,
    handleUseObjectSelection,
    handleUsePixelSelection,
  };
}

export type DialogMaskSources = ReturnType<typeof useMaskSources>;
