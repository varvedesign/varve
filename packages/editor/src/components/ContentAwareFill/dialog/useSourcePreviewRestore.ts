import { useEffect } from 'react';
import { decodeRasterMaskDataUrl } from '../../../tools/selectionMask';
import {
  computeSourceRegionFromMaskBounds,
  computeSourceRegionFromMaskCoverage,
} from '../generationRaster';
import { maskCoverageFromRgba, putMaskCoverage } from '../maskOperations';
import { analyzeSelectionHealth } from '../selectionHealth';
import { MAX_SOURCE_MASK_REFINEMENT_PIXELS } from './constants';
import { imageSourceDims, loadImageToImageData, loadVisibleImageSource } from './imageLoading';
import {
  persistedVariationPreviewDataUrl,
  persistedVariationResult,
  unloadedVariationImageData,
} from './persistedVariations';
import { previewRasterDimensions } from './previewEncoding';
import type { DialogDerived } from './useDialogDerived';
import type { DialogState } from './useDialogState';

type Params = DialogState & DialogDerived;
export function useSourcePreviewRestore(params: Params) {
  const {
    acceptedContextAsset,
    acceptedEdit,
    acceptedInferenceMaskAsset,
    acceptedResultAsset,
    acceptedSourceAsset,
    acceptedUserMaskAsset,
    acceptedVariation,
    editableSourceMaskRef,
    generationRef,
    imageSrc,
    isOpen,
    maskCanvasRef,
    maskRevisionRef,
    overlaySources,
    previewCanvasRef,
    setActiveVariationId,
    setHasMaskStrokes,
    setMaskHealth,
    setMaskOrigin,
    setMaskRevision,
    setNaturalSize,
    setPreviewDataUrl,
    setResult,
    setShowOriginal,
    setVariations,
    sourceAsset,
    sourceImage,
    sourcePreviewImageRef,
    sourceSignature,
    state,
  } = params;
  useEffect(() => {
    if (!isOpen || !imageSrc) return;
    let cancelled = false;
    (async () => {
      try {
        const knownWidth =
          sourceImage?.imageWidth ??
          sourceAsset?.naturalWidth ??
          acceptedSourceAsset?.naturalWidth ??
          0;
        const knownHeight =
          sourceImage?.imageHeight ??
          sourceAsset?.naturalHeight ??
          acceptedSourceAsset?.naturalHeight ??
          0;
        const previewHint =
          knownWidth > 0 && knownHeight > 0
            ? previewRasterDimensions(knownWidth, knownHeight)
            : { width: 1024, height: 1024 };
        // Bounded edits rebuild the review baseline from the immutable source
        // plus accepted overlay patches. Expand replaces the source fill with
        // a full output, so reopening or expanding again must start from that
        // current accepted frame instead of reverting to the old snapshot.
        const baseSource =
          acceptedEdit?.mode === 'expand'
            ? (sourceAsset?.dataUrl ?? imageSrc ?? acceptedSourceAsset?.dataUrl ?? '')
            : (acceptedSourceAsset?.dataUrl ?? sourceAsset?.dataUrl ?? imageSrc);
        const reviewOverlays = overlaySources.filter(
          (overlay) => overlay.editId !== acceptedEdit?.id,
        );
        const img = await loadVisibleImageSource(
          baseSource,
          knownWidth,
          knownHeight,
          Math.max(previewHint.width, previewHint.height),
          reviewOverlays,
        );
        if (cancelled) return;
        sourcePreviewImageRef.current = img;

        const decoded = imageSourceDims(img);
        const nw = knownWidth || decoded.width;
        const nh = knownHeight || decoded.height;
        if (nw <= 0 || nh <= 0) throw new Error('Image dimensions are unavailable');
        const preview = previewRasterDimensions(nw, nh);
        setNaturalSize({ w: nw, h: nh });

        const previewCanvas = previewCanvasRef.current;
        const maskCanvas = maskCanvasRef.current;
        if (previewCanvas) {
          previewCanvas.width = preview.width;
          previewCanvas.height = preview.height;
          const ctx = previewCanvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, preview.width, preview.height);
        }
        if (maskCanvas) {
          maskCanvas.width = preview.width;
          maskCanvas.height = preview.height;
          const mctx = maskCanvas.getContext('2d');
          if (mctx) {
            mctx.fillStyle = 'black';
            mctx.fillRect(0, 0, preview.width, preview.height);
            setMaskHealth(
              analyzeSelectionHealth(
                new Uint8Array(preview.width * preview.height),
                preview.width,
                preview.height,
                'remove',
              ),
            );
          }
        }
        setHasMaskStrokes(false);

        if (acceptedUserMaskAsset?.dataUrl && maskCanvas && acceptedEdit) {
          // Persisted masks can be source-resolution masks from large photos.
          // Decode them directly into the bounded preview rather than routing
          // them through the interactive mask limit used for new selections.
          const decoded = await loadImageToImageData(
            acceptedUserMaskAsset.dataUrl,
            preview.width,
            preview.height,
          );
          if (cancelled) return;
          const coverage = maskCoverageFromRgba(decoded.data);
          const maskContext = maskCanvas.getContext('2d');
          if (maskContext) {
            putMaskCoverage(maskContext, coverage, {
              width: preview.width,
              height: preview.height,
            });
            setHasMaskStrokes(coverage.some((value) => value > 0));
            setMaskHealth(
              analyzeSelectionHealth(coverage, preview.width, preview.height, 'remove'),
            );
            setMaskOrigin('persisted');
            maskRevisionRef.current = 1;
            setMaskRevision(1);
          }

          // Keep a source-resolution persisted mask as the authority for the
          // next generation. The dialog preview is bounded and may erase
          // thin details when it is reduced from a large photograph. Newer
          // records carry exact bounds, so reopening can defer decoding to
          // only the bounded context used by generation. Legacy records do
          // not have those bounds; recover them exactly only under the normal
          // source-mask memory ceiling and otherwise retain the safe preview
          // fallback.
          const persistedUserWidth = acceptedEdit.masks.userWidth ?? acceptedEdit.maskWidth;
          const persistedUserHeight = acceptedEdit.masks.userHeight ?? acceptedEdit.maskHeight;
          const sourceMaskMatchesCurrentImage =
            acceptedUserMaskAsset.width === nw &&
            acceptedUserMaskAsset.height === nh &&
            persistedUserWidth === nw &&
            persistedUserHeight === nh;
          if (sourceMaskMatchesCurrentImage) {
            const persistedBounds = acceptedEdit.masks.userBounds;
            if (persistedBounds) {
              try {
                const bounds = computeSourceRegionFromMaskBounds(persistedBounds, nw, nh, 0);
                if (bounds) {
                  editableSourceMaskRef.current = {
                    dataUrl: acceptedUserMaskAsset.dataUrl,
                    width: nw,
                    height: nh,
                    bounds,
                  };
                }
              } catch {
                // An invalid persisted bound must not make reopening fail;
                // the preview mask remains available for explicit review.
              }
            } else if (nw * nh <= MAX_SOURCE_MASK_REFINEMENT_PIXELS) {
              const exact = await decodeRasterMaskDataUrl(acceptedUserMaskAsset.dataUrl);
              if (cancelled) return;
              if (
                exact &&
                exact.width === nw &&
                exact.height === nh &&
                exact.sourceWidth === nw &&
                exact.sourceHeight === nh
              ) {
                const exactCoverage = maskCoverageFromRgba(exact.data);
                const bounds = computeSourceRegionFromMaskCoverage(exactCoverage, nw, nh, 0);
                if (bounds) {
                  editableSourceMaskRef.current = {
                    coverage: exactCoverage,
                    width: nw,
                    height: nh,
                    bounds,
                  };
                }
              }
            }
          }
        }

        if (acceptedEdit && acceptedVariation && acceptedResultAsset?.dataUrl) {
          if (cancelled) return;
          if (!previewCanvas) throw new Error('Preview canvas is unavailable');
          const restoredVariations = (
            await Promise.all(
              acceptedEdit.variations.map(async (variation) => {
                const asset = variation.assetId
                  ? state.document.assets?.[variation.assetId]
                  : undefined;
                const thumbnail = variation.thumbnailAssetId
                  ? state.document.assets?.[variation.thumbnailAssetId]
                  : undefined;
                if (!asset?.dataUrl) return null;
                const assetKind = variation.assetKind ?? 'full-output';
                const dataUrl = await persistedVariationPreviewDataUrl(
                  previewCanvas,
                  nw,
                  nh,
                  variation,
                  asset,
                );
                return {
                  id: variation.id,
                  dataUrl,
                  thumbnailDataUrl: thumbnail?.dataUrl,
                  patchDataUrl: asset.dataUrl,
                  patchWidth: asset.naturalWidth,
                  patchHeight: asset.naturalHeight,
                  patchFrame:
                    assetKind === 'region-overlay' && variation.outputFrame
                      ? {
                          x: variation.outputFrame.x,
                          y: variation.outputFrame.y,
                          width: variation.outputFrame.width,
                          height: variation.outputFrame.height,
                        }
                      : undefined,
                  assetKind,
                  result: persistedVariationResult(
                    acceptedEdit,
                    variation,
                    unloadedVariationImageData(),
                  ),
                  seed:
                    variation.seed ?? variation.settings?.seed ?? acceptedEdit.settings.seed ?? 0,
                };
              }),
            )
          ).filter((variation): variation is NonNullable<typeof variation> => variation !== null);
          const restoredResult =
            restoredVariations.find((variation) => variation.id === acceptedVariation.id)?.result ??
            persistedVariationResult(acceptedEdit, acceptedVariation, unloadedVariationImageData());
          const restoredActive =
            restoredVariations.find((variation) => variation.id === acceptedVariation.id) ??
            restoredVariations[0];
          // The session's output frame describes the accepted node bounds. A
          // region-overlay variation carries its bounded patch frame on the
          // variation itself and must not replace this source frame.
          const restoredOutputFrame = acceptedEdit.outputFrame;
          const inferenceMaskWidth = acceptedEdit.masks.width;
          const inferenceMaskHeight = acceptedEdit.masks.height;
          const context = acceptedContextAsset;
          generationRef.current = {
            sourceSignature,
            userMaskDataUrl: acceptedUserMaskAsset?.dataUrl ?? '',
            inferenceMaskDataUrl: acceptedInferenceMaskAsset?.dataUrl ?? '',
            userMaskWidth: acceptedEdit.masks.userWidth ?? acceptedEdit.maskWidth,
            userMaskHeight: acceptedEdit.masks.userHeight ?? acceptedEdit.maskHeight,
            userMaskBounds: acceptedEdit.masks.userBounds,
            inferenceMaskWidth,
            inferenceMaskHeight,
            inferenceMaskOffsetX: acceptedEdit.masks.offsetX,
            inferenceMaskOffsetY: acceptedEdit.masks.offsetY,
            contextDataUrl: context?.dataUrl ?? '',
            contextWidth: context?.naturalWidth ?? 1,
            contextHeight: context?.naturalHeight ?? 1,
            outputFrame: {
              x: restoredOutputFrame.x,
              y: restoredOutputFrame.y,
              width: restoredOutputFrame.width,
              height: restoredOutputFrame.height,
              sourceWidth: restoredOutputFrame.sourceWidth,
              sourceHeight: restoredOutputFrame.sourceHeight,
            },
            patchDataUrl: restoredActive?.patchDataUrl ?? acceptedResultAsset.dataUrl,
            patchWidth: restoredActive?.patchWidth ?? acceptedResultAsset.naturalWidth,
            patchHeight: restoredActive?.patchHeight ?? acceptedResultAsset.naturalHeight,
            patchFrame: restoredActive?.patchFrame,
            assetKind: restoredActive?.assetKind ?? 'full-output',
            result: restoredResult,
            seed: restoredActive?.seed ?? acceptedVariation.seed ?? acceptedEdit.settings.seed ?? 0,
          };
          setVariations(restoredVariations);
          setActiveVariationId(acceptedVariation.id);
          setResult(restoredResult);
          setPreviewDataUrl(restoredActive?.dataUrl ?? acceptedResultAsset.dataUrl);
          setShowOriginal(false);
        }
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    acceptedContextAsset,
    acceptedEdit,
    acceptedInferenceMaskAsset,
    acceptedResultAsset,
    acceptedSourceAsset,
    acceptedUserMaskAsset,
    acceptedVariation,
    imageSrc,
    isOpen,
    overlaySources,
    sourceSignature,
    sourceAsset,
    sourceImage?.imageHeight,
    sourceImage?.imageWidth,
    state.document.assets,
  ]);
  return {};
}

export type DialogSourcePreviewRestore = ReturnType<typeof useSourcePreviewRestore>;
