import { GenerativeEditError } from '@varve/engine';
import { createEmbeddedAsset, hashContent, isImageShape } from '@varve/scene';
import { useCallback } from 'react';
import { replaceImageShapeContent } from '../../../imageOperations';
import { prepareImageMaskMapper } from '../../../tools/imageMaskCoordinates';
import {
  normalizeSam2Prompts,
  normalizeSourceSam2Prompts,
  type Sam2NormalizedPrompts,
} from '../../../tools/sam2PromptCoordinates';
import { buildGenerativeEditSelectionEvidence } from '../selectionEvidence';
import { createGenerativeMaskAssets, createVariationAssets } from './applyAssets';
import type { DialogDerived } from './useDialogDerived';
import type { DialogState } from './useDialogState';

type Params = DialogState & DialogDerived;
export function useApply(params: Params) {
  const {
    abortTransaction,
    acceptedSourceAsset,
    activeVariationId,
    announce,
    beginTransaction,
    commitTransaction,
    contextPadding,
    generationRef,
    guidanceScale,
    imageGuidanceScale,
    imageSrc,
    maskExpansion,
    maskFeather,
    maskOrigin,
    mode,
    naturalSize,
    negativePrompt,
    nodeId,
    objectSelection,
    objectSelectionReviewKey,
    onApplied,
    onClose,
    previewDataUrl,
    prompt,
    result,
    reviewedObjectSelectionAt,
    reviewedObjectSelectionKey,
    setErrorMessage,
    setSelection,
    setStatus,
    sourceSignature,
    state,
    steps,
    strength,
    updateDoc,
    usesDiffusion,
    variationSequenceRef,
    variations,
  } = params;
  const handleApply = useCallback(async () => {
    if (!nodeId || !previewDataUrl || !result) return;
    setStatus('applying');
    setErrorMessage(null);

    try {
      const currentDoc = state.document;
      const sourceNode = currentDoc.nodes[nodeId];
      if (sourceNode?.kind !== 'shape' || !isImageShape(sourceNode)) {
        throw new GenerativeEditError('stale', 'The source image no longer exists.');
      }
      if (!generationRef.current || generationRef.current.sourceSignature !== sourceSignature) {
        throw new GenerativeEditError(
          'stale',
          'The source changed. Generate a fresh result first.',
        );
      }

      const sourceFill =
        sourceNode.kind === 'shape'
          ? sourceNode.fills?.find((fill) => fill.type === 'image')?.image
          : undefined;
      const editId = `generative-edit-${Date.now()}-${++variationSequenceRef.current}`;
      const generatedFrame = generationRef.current.outputFrame;
      const sourceWidth = generatedFrame.sourceWidth || naturalSize.w || result.width;
      const sourceHeight = generatedFrame.sourceHeight || naturalSize.h || result.height;
      const currentSourceAsset = sourceFill?.assetId
        ? currentDoc.assets?.[sourceFill.assetId]
        : undefined;
      const sourceSnapshot =
        acceptedSourceAsset ??
        currentSourceAsset ??
        createEmbeddedAsset({
          dataUrl: imageSrc,
          mimeType: 'image/png',
          naturalWidth: sourceWidth,
          naturalHeight: sourceHeight,
        });
      const { userMaskAsset, inferenceMaskAsset, compositeMaskAsset, contextAsset } =
        createGenerativeMaskAssets(editId, generationRef.current);
      const { variationEntries, variationAssets, variationThumbnailAssets } = createVariationAssets(
        variations,
        previewDataUrl,
        result,
        generationRef.current,
      );
      const activeVariation =
        variationEntries.find((variation) => variation.id === activeVariationId) ??
        variationEntries[variationEntries.length - 1]!;
      const activeAsset = variationAssets[variationEntries.indexOf(activeVariation)]!;
      const now = Date.now();
      const settings = {
        ...(generationRef.current.seed !== undefined ? { seed: generationRef.current.seed } : {}),
        ...(result.provider.id === 'varve-diffusion-inpainting' && prompt.trim() ? { prompt } : {}),
        ...(negativePrompt.trim() ? { negativePrompt } : {}),
        quality: result.quality,
        contextPadding,
        maskExpansion,
        feather: maskFeather,
        ...(usesDiffusion ? { strength, steps, guidanceScale } : {}),
        ...(usesDiffusion ? { imageGuidanceScale } : {}),
      };
      let normalizedSelectionPrompts: Sam2NormalizedPrompts | undefined;
      if (maskOrigin === 'object-selection') {
        if (
          !objectSelection ||
          objectSelection.width !== sourceWidth ||
          objectSelection.height !== sourceHeight
        ) {
          throw new GenerativeEditError(
            'stale',
            'The reviewed Object Selection no longer matches the source image. Create a new preview.',
          );
        }
        const mapper = prepareImageMaskMapper({
          document: currentDoc,
          node: sourceNode,
          sourceWidth,
          sourceHeight,
        });
        if (!mapper || mapper.fingerprint !== objectSelection.mappingFingerprint) {
          throw new GenerativeEditError(
            'stale',
            'The image placement changed after Object Selection. Create a new preview.',
          );
        }
        normalizedSelectionPrompts = objectSelection.sourcePrompts
          ? normalizeSourceSam2Prompts(objectSelection.sourcePrompts)
          : normalizeSam2Prompts(
              {
                points: objectSelection.points,
                box: objectSelection.box ?? undefined,
              },
              mapper,
              sourceWidth,
              sourceHeight,
            );
        if (
          normalizedSelectionPrompts.unmappedPointCount > 0 ||
          normalizedSelectionPrompts.unmappedBoxCornerCount > 0
        ) {
          throw new GenerativeEditError(
            'stale',
            'The reviewed Object Selection prompt is no longer inside the image. Create a new preview.',
          );
        }
      }
      const selectionEvidence = buildGenerativeEditSelectionEvidence({
        source: maskOrigin,
        maskFingerprint: hashContent(generationRef.current.userMaskDataUrl),
        reviewedAt: now,
        objectSelection,
        objectSelectionReviewKey,
        generationReviewKey: reviewedObjectSelectionKey,
        generationReviewedAt: reviewedObjectSelectionAt,
        normalizedPrompts: normalizedSelectionPrompts,
      });
      if (!selectionEvidence) {
        throw new GenerativeEditError(
          'invalid-mask',
          'The selected object was not reviewed in the current image context. Review the highlighted mask and try again.',
        );
      }
      const outputFrame = {
        ...generatedFrame,
        sourceWidth,
        sourceHeight,
        coordinateSpace: 'source-image-pixels' as const,
      };
      const recordBase = {
        schemaVersion: 2 as const,
        id: editId,
        mode,
        sourceNodeId: nodeId,
        ...(sourceNode.generativeEditId && currentDoc.generativeEdits?.[sourceNode.generativeEditId]
          ? { parentEditId: sourceNode.generativeEditId }
          : {}),
        sourceAssetId: sourceSnapshot.id,
        sourceSnapshotAssetId: sourceSnapshot.id,
        sourceLocator: `asset:${sourceSnapshot.id}`,
        sourceRevision: state.revision,
        placementRevision: sourceSignature,
        masks: {
          userMaskAssetId: userMaskAsset.id,
          inferenceMaskAssetId: inferenceMaskAsset.id,
          compositeMaskAssetId: compositeMaskAsset.id,
          width: generationRef.current.inferenceMaskWidth,
          height: generationRef.current.inferenceMaskHeight,
          offsetX: generationRef.current.inferenceMaskOffsetX,
          offsetY: generationRef.current.inferenceMaskOffsetY,
          coordinateSpace: 'source-image-pixels' as const,
          userWidth: generationRef.current.userMaskWidth,
          userHeight: generationRef.current.userMaskHeight,
          userOffsetX: 0,
          userOffsetY: 0,
          ...(generationRef.current.userMaskBounds
            ? { userBounds: generationRef.current.userMaskBounds }
            : {}),
        },
        selectionEvidence,
        outputFrame,
        maskAssetId: userMaskAsset.id,
        maskWidth: generationRef.current.userMaskWidth,
        maskHeight: generationRef.current.userMaskHeight,
        maskCoordinateSpace: 'source-image-pixels' as const,
        settings,
        provider: result.provider,
        variations: variationEntries.map((variation, index) => ({
          id: variation.id,
          assetId: variationAssets[index]!.id,
          thumbnailAssetId: variationThumbnailAssets[index]!.id,
          width: variation.result.width,
          height: variation.result.height,
          createdAt: now,
          seed: variation.seed,
          settings: { ...settings, seed: variation.seed },
          assetKind: variation.assetKind,
          outputFrame: {
            ...outputFrame,
            ...(variation.patchFrame
              ? {
                  x: variation.patchFrame.x,
                  y: variation.patchFrame.y,
                  width: variation.patchFrame.width,
                  height: variation.patchFrame.height,
                }
              : {}),
          },
          provider: variation.result.provider,
          contextAssetId: contextAsset.id,
        })),
        activeVariationId: activeVariation.id,
        acceptedVariationId: activeVariation.id,
        createdAt: now,
        updatedAt: now,
      };

      const docWithAssets = {
        ...currentDoc,
        assets: {
          ...currentDoc.assets,
          [sourceSnapshot.id]: sourceSnapshot,
          ...Object.fromEntries(variationAssets.map((asset) => [asset.id, asset])),
          ...Object.fromEntries(variationThumbnailAssets.map((asset) => [asset.id, asset])),
          [contextAsset.id]: contextAsset,
        },
        rasterMaskAssets: {
          ...currentDoc.rasterMaskAssets,
          [userMaskAsset.id]: userMaskAsset,
          [inferenceMaskAsset.id]: inferenceMaskAsset,
          [compositeMaskAsset.id]: compositeMaskAsset,
        },
      };
      const accepted = replaceImageShapeContent(docWithAssets, nodeId, {
        dataUrl: sourceFill?.src ?? sourceSnapshot.dataUrl,
        assetId: sourceFill?.assetId ?? sourceSnapshot.id,
        generativeEditId: editId,
        width: sourceWidth,
        height: sourceHeight,
        ...(activeVariation.assetKind === 'region-overlay' && activeVariation.patchFrame
          ? {
              patch: {
                dataUrl: activeAsset.dataUrl,
                assetId: activeAsset.id,
                width: activeAsset.naturalWidth,
                height: activeAsset.naturalHeight,
                x: activeVariation.patchFrame.x,
                y: activeVariation.patchFrame.y,
                frameWidth: activeVariation.patchFrame.width,
                frameHeight: activeVariation.patchFrame.height,
                editId,
                variationId: activeVariation.id,
              },
            }
          : {
              dataUrl: activeAsset.dataUrl,
              assetId: activeAsset.id,
              width: result.width,
              height: result.height,
              ...(mode === 'expand'
                ? {
                    outputFrame: {
                      sourceOffsetX: -outputFrame.x,
                      sourceOffsetY: -outputFrame.y,
                      sourceWidth,
                      sourceHeight,
                    },
                  }
                : {}),
            }),
      });
      const record = { ...recordBase, resultNodeId: nodeId };
      beginTransaction();
      try {
        updateDoc(() => ({
          ...accepted,
          generativeEdits: { ...accepted.generativeEdits, [editId]: record },
        }));
        commitTransaction();
      } catch (error) {
        abortTransaction();
        throw error;
      }
      setSelection(nodeId);
      announce(
        `${mode[0]?.toUpperCase()}${mode.slice(1)} applied in place (${result.width} x ${result.height})`,
      );
      onApplied?.();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Apply failed';
      setStatus('error');
      setErrorMessage(msg);
    }
  }, [
    nodeId,
    previewDataUrl,
    result,
    abortTransaction,
    beginTransaction,
    commitTransaction,
    contextPadding,
    acceptedSourceAsset,
    variations,
    activeVariationId,
    mode,
    sourceSignature,
    imageSrc,
    state.document,
    state.revision,
    maskExpansion,
    maskFeather,
    setSelection,
    updateDoc,
    announce,
    negativePrompt,
    onApplied,
    onClose,
    prompt,
    strength,
    steps,
    guidanceScale,
    imageGuidanceScale,
    usesDiffusion,
    maskOrigin,
    objectSelection,
    objectSelectionReviewKey,
    reviewedObjectSelectionKey,
    reviewedObjectSelectionAt,
  ]);
  return { handleApply };
}

export type DialogApply = ReturnType<typeof useApply>;
