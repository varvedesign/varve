import { useCallback } from 'react';
import type { DialogState } from './useDialogState';

type Params = DialogState;
export function usePreviewZoom(params: Params) {
  const {
    customZoomBase,
    naturalSize,
    previewViewport,
    previewZoom,
    result,
    setCustomZoomBase,
    setPreviewZoom,
    setZoomPercent,
    zoomPercent,
  } = params;
  const previewNaturalWidth = result?.mode === 'expand' ? result.width : naturalSize.w;
  const previewNaturalHeight = result?.mode === 'expand' ? result.height : naturalSize.h;
  const fitScale =
    previewNaturalWidth > 0 &&
    previewNaturalHeight > 0 &&
    previewViewport.width > 0 &&
    previewViewport.height > 0
      ? Math.min(
          previewViewport.width / previewNaturalWidth,
          previewViewport.height / previewNaturalHeight,
        )
      : 1;
  const displayScale =
    previewZoom === 'fit'
      ? fitScale
      : customZoomBase === 'fit'
        ? fitScale * (zoomPercent / 100)
        : zoomPercent / 100;
  const displayWidth =
    previewNaturalWidth > 0 ? Math.max(1, Math.round(previewNaturalWidth * displayScale)) : 0;
  const displayHeight =
    previewNaturalHeight > 0 ? Math.max(1, Math.round(previewNaturalHeight * displayScale)) : 0;

  const selectFitZoom = useCallback(() => {
    setCustomZoomBase('fit');
    setPreviewZoom('fit');
  }, []);

  const selectOneToOneZoom = useCallback(() => {
    setCustomZoomBase('natural');
    setZoomPercent(100);
    setPreviewZoom('custom');
  }, []);

  const adjustZoom = useCallback(
    (delta: number) => {
      if (previewZoom === 'fit') setCustomZoomBase('fit');
      setZoomPercent((current) => Math.max(25, Math.min(400, current + delta)));
      setPreviewZoom('custom');
    },
    [previewZoom],
  );
  return {
    adjustZoom,
    displayHeight,
    displayScale,
    displayWidth,
    fitScale,
    previewNaturalHeight,
    previewNaturalWidth,
    selectFitZoom,
    selectOneToOneZoom,
  };
}

export type DialogPreviewZoom = ReturnType<typeof usePreviewZoom>;
