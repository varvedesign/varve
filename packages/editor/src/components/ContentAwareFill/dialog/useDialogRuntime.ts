import type { ContentAwareFillDialogProps } from '../ContentAwareFillDialog';
import { useApply } from './useApply';
import { useDialogDerived } from './useDialogDerived';
import { useDialogSessionLifecycle } from './useDialogSessionLifecycle';
import { useDialogState } from './useDialogState';
import { useGeneration } from './useGeneration';
import { useMaskPainting } from './useMaskPainting';
import { useMaskSources } from './useMaskSources';
import { useModelStatus } from './useModelStatus';
import { usePreviewCentering } from './usePreviewCentering';
import { usePreviewZoom } from './usePreviewZoom';
import { useSourcePreviewRestore } from './useSourcePreviewRestore';
import { useVariationActions } from './useVariationActions';

export function useDialogRuntime(props: ContentAwareFillDialogProps) {
  const state = useDialogState(props);
  const derived = useDialogDerived(state);
  const lifecycle = useDialogSessionLifecycle({ ...state, ...derived });
  const modelStatus = useModelStatus({ ...state, ...derived });
  const sourcePreviewRestore = useSourcePreviewRestore({ ...state, ...derived });
  const centering = usePreviewCentering(state);
  const zoom = usePreviewZoom(state);
  const maskPainting = useMaskPainting({ ...state, ...derived, ...lifecycle });
  const maskSources = useMaskSources({ ...state, ...derived, ...maskPainting });
  const generation = useGeneration({ ...state, ...derived });
  const apply = useApply({ ...state, ...derived });
  const variationActions = useVariationActions(state);
  return {
    ...state,
    ...derived,
    ...lifecycle,
    ...modelStatus,
    ...sourcePreviewRestore,
    ...centering,
    ...zoom,
    ...maskPainting,
    ...maskSources,
    ...generation,
    ...apply,
    ...variationActions,
  };
}

export type DialogRuntime = ReturnType<typeof useDialogRuntime>;
