import {
  computeExpandPlan,
  getGenerativeEditCapabilities,
  planExpandWorkingFrame,
} from '@varve/engine';
import { hashContent, imageShapeSrc, isImageShape, resolveRasterMaskAsset } from '@varve/scene';
import { useMemo } from 'react';
import { computePlacementRevision } from '../../../backgroundRemoval/SubjectIsolationService';
import { objectSelectionCandidateReviewKey } from '../../../context/objectSelectionTypes';
import { prepareImageMaskMapper } from '../../../tools/imageMaskCoordinates';
import { workingPixelBudgetForTier } from '../generationRaster';
import { visibleSourceOverlays } from './sourceOverlays';
import type { DialogModeCapability } from './types';
import type { DialogState } from './useDialogState';

type Params = DialogState;
export function useDialogDerived(params: Params) {
  const {
    contextPadding,
    currentJobSnapshotRef,
    diffusionModelHandle,
    diffusionResource,
    expandPadding,
    guidanceScale,
    hasMaskStrokes,
    imageGuidanceScale,
    isRefiningMask,
    maskExpansion,
    maskFeather,
    maskHealth,
    maskOrigin,
    maskRevision,
    mode,
    modelAvailable,
    modelFitsMemory,
    naturalSize,
    negativePrompt,
    nodeId,
    previewDataUrl,
    prompt,
    quality,
    result,
    reviewedObjectSelectionKey,
    seed,
    state,
    status,
    steps,
    strength,
    variationCount,
  } = params;
  const isProcessing =
    status === 'downloading' ||
    status === 'qualifying' ||
    status === 'generating' ||
    status === 'applying';
  const hasResult = !isRefiningMask && previewDataUrl != null && result != null;
  const capabilities = getGenerativeEditCapabilities('local', {
    nativeModelReady: diffusionModelHandle != null,
  });
  const modeCapability: DialogModeCapability = capabilities.modes[mode];
  const resourceProfile = capabilities.resourceProfile;
  const resourceLabel = [
    resourceProfile.platform,
    resourceProfile.tier === 'unknown' ? null : `${resourceProfile.tier} memory`,
    resourceProfile.architecture,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' · ');
  const promptNeedsDiffusion =
    (mode === 'replace' || mode === 'expand' || mode === 'fill') && prompt.trim().length > 0;
  const usesDiffusion = mode === 'replace' || promptNeedsDiffusion;
  // Fast/PatchMatch border continuation visibly repeated/striped
  // photographic edges on real-photo review and stays blocked for Expand
  // specifically wherever no native diffusion helper is present (the
  // browser). AI-quality Expand runs the same reconstruction model
  // Fill/Remove already use here and is not subject to that failure.
  const expandFastBlockedHere = mode === 'expand' && quality === 'fast' && !modeCapability.prompt;
  const modeMissingModel =
    (!usesDiffusion && quality === 'ai' && (!modelAvailable || modelFitsMemory === false)) ||
    (usesDiffusion && !diffusionModelHandle) ||
    expandFastBlockedHere;
  const diffusionMemoryFits =
    !usesDiffusion ||
    !diffusionResource ||
    diffusionResource.availableBytes == null ||
    diffusionResource.availableBytes >= diffusionResource.requiredBytes;
  const hasExpandPadding = Object.values(expandPadding).some((value) => value > 0);
  const expandPlanPreview = useMemo(() => {
    if (mode !== 'expand' || naturalSize.w <= 0 || naturalSize.h <= 0) return null;
    return computeExpandPlan(naturalSize.w, naturalSize.h, expandPadding, {
      maxOutputPixels: 16_777_216,
    });
  }, [mode, naturalSize.w, naturalSize.h, expandPadding]);
  const expandWorkingPlanPreview = useMemo(() => {
    if (mode !== 'expand' || !expandPlanPreview?.ok) return null;
    try {
      return {
        ok: true as const,
        plan: planExpandWorkingFrame(
          expandPlanPreview.plan,
          workingPixelBudgetForTier(capabilities.resourceProfile.tier),
        ),
      };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : 'The expansion working frame is invalid.',
      };
    }
  }, [capabilities.resourceProfile.tier, expandPlanPreview, mode]);
  const modeAvailable =
    modeCapability.available &&
    (!usesDiffusion || modeCapability.ready) &&
    !modeMissingModel &&
    diffusionMemoryFits &&
    (mode !== 'expand' ||
      (expandPlanPreview?.ok === true && expandWorkingPlanPreview?.ok === true));
  const node = nodeId ? state.document.nodes[nodeId] : undefined;
  const isImage = Boolean(node && isImageShape(node));
  const typedNode = isImage ? (node as import('@varve/scene').ShapeNode) : null;
  const imageSrc = typedNode ? imageShapeSrc(typedNode) : '';
  const areaSelection = state.areaSelection;
  const layerMaskAsset = typedNode ? resolveRasterMaskAsset(state.document, typedNode) : null;
  const objectSelection =
    typedNode &&
    state.objectSelectionSession?.nodeId === typedNode.id &&
    (!state.objectSelectionSession.documentId ||
      state.objectSelectionSession.documentId === state.document.id) &&
    state.objectSelectionSession.sourceLocator === imageSrc
      ? state.objectSelectionSession
      : null;
  const objectSelectionCandidate = objectSelection
    ? objectSelection.candidates[objectSelection.selectedCandidate]
    : undefined;
  const objectSelectionReviewKey =
    objectSelection && objectSelectionCandidate
      ? objectSelectionCandidateReviewKey(objectSelection, objectSelection.selectedCandidate)
      : null;
  const objectSelectionMappingMatchesCurrent = useMemo(() => {
    // Older transient sessions did not carry a mapping fingerprint and are
    // still accepted for compatibility. Every current production session has
    // one; when present, it must match the live source-to-world transform.
    if (!objectSelection?.mappingFingerprint) return true;
    if (!typedNode || objectSelection.width <= 0 || objectSelection.height <= 0) return false;
    const mapper = prepareImageMaskMapper({
      document: state.document,
      node: typedNode,
      sourceWidth: objectSelection.width,
      sourceHeight: objectSelection.height,
    });
    return mapper?.fingerprint === objectSelection.mappingFingerprint;
  }, [objectSelection, state.document, typedNode]);
  const objectSelectionInitialReviewMissing =
    objectSelection?.status === 'ready' &&
    (objectSelectionReviewKey === null ||
      objectSelection.reviewedCandidateKey !== objectSelectionReviewKey);
  const objectSelectionCandidateNeedsRefinement =
    objectSelectionCandidate?.promptDiagnostics?.requiresRefinement === true;
  const objectSelectionNeedsRefinement =
    maskOrigin === 'object-selection' && objectSelectionCandidateNeedsRefinement;
  const objectSelectionNeedsReview =
    maskOrigin === 'object-selection' &&
    (!objectSelectionCandidate ||
      !objectSelectionReviewKey ||
      objectSelectionInitialReviewMissing ||
      !objectSelectionMappingMatchesCurrent ||
      reviewedObjectSelectionKey !== objectSelectionReviewKey ||
      objectSelectionNeedsRefinement);
  const canGenerate =
    (hasMaskStrokes || (mode === 'expand' && hasExpandPadding)) &&
    (mode !== 'replace' || prompt.trim().length > 0) &&
    (mode !== 'expand' || modeAvailable) &&
    !objectSelectionNeedsReview &&
    (mode === 'expand' || !maskHealth.blockingReason);
  const modeUnavailableReason =
    mode === 'expand' && expandWorkingPlanPreview && !expandWorkingPlanPreview.ok
      ? expandWorkingPlanPreview.message
      : mode === 'expand' && expandPlanPreview && !expandPlanPreview.ok
        ? expandPlanPreview.error.message
        : expandFastBlockedHere
          ? 'Fast preview cannot expand image borders reliably here. Switch to AI quality (downloads the local reconstruction model), or use the desktop app.'
          : (modeCapability.reason ?? null);

  const sourceSignature = typedNode
    ? JSON.stringify({
        src: imageSrc,
        assetId: typedNode.fills?.find((fill) => fill.type === 'image')?.image?.assetId,
        imagePlacement: typedNode.fills?.find((fill) => fill.type === 'image')?.image,
        overlays: (typedNode.fills ?? []).flatMap((fill) => {
          if (fill.type !== 'image' || !fill.image?.generativeEditOverlay) return [];
          const image = fill.image;
          const overlay = image.generativeEditOverlay;
          if (!overlay) return [];
          return [
            {
              assetId: image.assetId ?? null,
              editId: overlay.editId,
              variationId: overlay.variationId,
              x: image.x,
              y: image.y,
              imageWidth: image.imageWidth,
              imageHeight: image.imageHeight,
              scale: image.scale,
              sourceFrame: overlay.sourceFrame ?? null,
            },
          ];
        }),
        shape: typedNode.shape,
        transform: typedNode.transform,
      })
    : '';
  const sourceImage = typedNode?.fills?.find((fill) => fill.type === 'image')?.image;
  const backgroundRemovalPreview =
    typedNode &&
    state.backgroundRemovalPreviewSession?.nodeId === typedNode.id &&
    state.backgroundRemovalPreviewSession.documentId === state.document.id &&
    state.backgroundRemovalPreviewSession.sourceLocator === imageSrc &&
    computePlacementRevision(sourceImage ?? null) ===
      state.backgroundRemovalPreviewSession.placementRevision &&
    (!state.backgroundRemovalPreviewSession.sourceIdentity ||
      state.backgroundRemovalPreviewSession.sourceIdentity.image === sourceImage)
      ? state.backgroundRemovalPreviewSession
      : null;
  const acceptedEdit = typedNode?.generativeEditId
    ? state.document.generativeEdits?.[typedNode.generativeEditId]
    : undefined;
  const acceptedVariation = acceptedEdit
    ? (acceptedEdit.variations.find(
        (variation) =>
          variation.id === (acceptedEdit.acceptedVariationId ?? acceptedEdit.activeVariationId),
      ) ?? acceptedEdit.variations[0])
    : undefined;
  const acceptedResultAsset = acceptedVariation?.assetId
    ? state.document.assets?.[acceptedVariation.assetId]
    : undefined;
  const acceptedSourceAsset = acceptedEdit?.sourceSnapshotAssetId
    ? state.document.assets?.[acceptedEdit.sourceSnapshotAssetId]
    : acceptedEdit?.sourceAssetId
      ? state.document.assets?.[acceptedEdit.sourceAssetId]
      : undefined;
  const acceptedUserMaskAsset = acceptedEdit?.masks.userMaskAssetId
    ? state.document.rasterMaskAssets?.[acceptedEdit.masks.userMaskAssetId]
    : undefined;
  const acceptedInferenceMaskAsset = acceptedEdit?.masks.inferenceMaskAssetId
    ? state.document.rasterMaskAssets?.[acceptedEdit.masks.inferenceMaskAssetId]
    : undefined;
  const acceptedContextAsset = acceptedVariation?.contextAssetId
    ? state.document.assets?.[acceptedVariation.contextAssetId]
    : undefined;
  const sourceAssetId = sourceImage?.assetId ?? null;
  const sourceAsset = sourceAssetId ? state.document.assets?.[sourceAssetId] : undefined;
  const overlaySources = useMemo(
    () => visibleSourceOverlays(typedNode, state.document.assets),
    [state.document.assets, typedNode?.fills],
  );
  const sourceHash = sourceAssetId
    ? (state.document.assets?.[sourceAssetId]?.hash ?? hashContent(imageSrc))
    : hashContent(imageSrc);
  // The editor revision changes for unrelated document edits too. Use the
  // source fingerprint for the job's source revision so an unrelated layer
  // edit does not invalidate a valid generation; sourceHash/placement still
  // guard the actual image and its mapping independently.
  const sourceRevision = Number.parseInt(sourceHash.slice(0, 8), 16) || 0;
  const settingsFingerprint = JSON.stringify({
    mode,
    quality,
    prompt,
    negativePrompt,
    seed,
    variationCount,
    strength,
    steps,
    guidanceScale,
    imageGuidanceScale,
    maskExpansion,
    maskFeather,
    contextPadding,
  });
  currentJobSnapshotRef.current = typedNode
    ? {
        documentId: state.document.id,
        targetId: nodeId ?? '',
        sourceRevision,
        sourceAssetId,
        sourceHash,
        placementFingerprint: sourceSignature,
        maskRevision,
        settingsFingerprint,
        outputFrameFingerprint: JSON.stringify(mode === 'expand' ? expandPadding : null),
      }
    : null;
  return {
    acceptedContextAsset,
    acceptedEdit,
    acceptedInferenceMaskAsset,
    acceptedResultAsset,
    acceptedSourceAsset,
    acceptedUserMaskAsset,
    acceptedVariation,
    areaSelection,
    backgroundRemovalPreview,
    canGenerate,
    capabilities,
    diffusionMemoryFits,
    expandFastBlockedHere,
    expandPlanPreview,
    expandWorkingPlanPreview,
    hasExpandPadding,
    hasResult,
    imageSrc,
    isImage,
    isProcessing,
    layerMaskAsset,
    modeAvailable,
    modeCapability,
    modeMissingModel,
    modeUnavailableReason,
    node,
    objectSelection,
    objectSelectionCandidate,
    objectSelectionCandidateNeedsRefinement,
    objectSelectionInitialReviewMissing,
    objectSelectionMappingMatchesCurrent,
    objectSelectionNeedsRefinement,
    objectSelectionNeedsReview,
    objectSelectionReviewKey,
    overlaySources,
    promptNeedsDiffusion,
    resourceLabel,
    resourceProfile,
    settingsFingerprint,
    sourceAsset,
    sourceAssetId,
    sourceHash,
    sourceImage,
    sourceRevision,
    sourceSignature,
    typedNode,
    usesDiffusion,
  };
}

export type DialogDerived = ReturnType<typeof useDialogDerived>;
