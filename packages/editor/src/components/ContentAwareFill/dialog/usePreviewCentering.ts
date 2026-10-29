import { useCallback, useEffect } from 'react';
import type { DialogState } from './useDialogState';

type Params = DialogState;
export function usePreviewCentering(params: Params) {
  const { naturalSize, previewAreaRef, previewViewport, previewZoom, zoomPercent } = params;
  const centerPreview = useCallback(() => {
    const area = previewAreaRef.current;
    if (!area) return;
    area.scrollLeft = Math.max(0, (area.scrollWidth - area.clientWidth) / 2);
    area.scrollTop = Math.max(0, (area.scrollHeight - area.clientHeight) / 2);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(centerPreview);
    return () => cancelAnimationFrame(frame);
  }, [centerPreview, naturalSize, previewZoom, zoomPercent, previewViewport]);
  return { centerPreview };
}

export type DialogPreviewCentering = ReturnType<typeof usePreviewCentering>;
