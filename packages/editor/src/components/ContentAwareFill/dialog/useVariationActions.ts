import { useCallback } from 'react';
import type { DialogState } from './useDialogState';

type Params = DialogState;
export function useVariationActions(params: Params) {
  const {
    activeVariationId,
    announce,
    generationRef,
    setActiveVariationId,
    setPreviewDataUrl,
    setResult,
    setVariations,
    variations,
  } = params;
  const handleDeleteVariation = useCallback(
    (variationId: string, variationNumber: number) => {
      if (variations.length <= 1) return;
      const removedIndex = variations.findIndex((variation) => variation.id === variationId);
      const nextVariations = variations.filter((variation) => variation.id !== variationId);
      const nextActive =
        activeVariationId === variationId
          ? nextVariations[Math.min(removedIndex, nextVariations.length - 1)]
          : (nextVariations.find((variation) => variation.id === activeVariationId) ??
            nextVariations[0]);
      setVariations(nextVariations);
      if (nextActive) {
        setActiveVariationId(nextActive.id);
        setResult(nextActive.result);
        setPreviewDataUrl(nextActive.dataUrl);
        if (generationRef.current) {
          generationRef.current.result = nextActive.result;
          generationRef.current.seed = nextActive.seed;
          generationRef.current.patchDataUrl = nextActive.patchDataUrl;
          generationRef.current.patchWidth = nextActive.patchWidth;
          generationRef.current.patchHeight = nextActive.patchHeight;
          generationRef.current.patchFrame = nextActive.patchFrame;
          generationRef.current.assetKind = nextActive.assetKind;
        }
      }
      announce(`Deleted variation ${variationNumber}`);
    },
    [activeVariationId, announce, variations],
  );
  return { handleDeleteVariation };
}

export type DialogVariationActions = ReturnType<typeof useVariationActions>;
