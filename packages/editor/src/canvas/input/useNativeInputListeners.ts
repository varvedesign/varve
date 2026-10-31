/** Native listener effect (original hook call 54): registers wheel, gesture, pinch-bridge, and lost-capture listeners once per dependency change. */

import { useEffect } from 'react';
import { installNativeInputListeners } from './nativeInputListeners';
import type { UseCanvasInputsOptions } from './types';
import type { InputGesturePhase } from './useGestureDispatchRuntime';
import type { InputSetupPhase } from './useInputSetup';
import type { InputLifecyclePhase } from './useInteractionLifecycle';

export function useNativeInputListeners(
  options: UseCanvasInputsOptions,
  setup: InputSetupPhase,
  lifecycle: InputLifecyclePhase,
  gesture: InputGesturePhase,
): void {
  const {
    commitCamera,
    contentCanvasRef,
    editor,
    previewCamera,
    refreshCanvasRect,
    setSnapGuides,
    stateRef,
    tmRef,
    viewportAnchorRef,
  } = options;
  const { buildToolCtx } = setup;
  const { closePointerEditorInteraction, stopAutoPan } = lifecycle;
  const { traceEventId } = gesture;

  useEffect(() => {
    const el = contentCanvasRef.current;
    if (!el) return;
    return installNativeInputListeners(el, options, setup, lifecycle, gesture);
  }, [
    contentCanvasRef,
    stateRef,
    editor,
    commitCamera,
    previewCamera,
    tmRef,
    buildToolCtx,
    refreshCanvasRect,
    viewportAnchorRef,
    closePointerEditorInteraction,
    stopAutoPan,
    setSnapGuides,
    traceEventId,
  ]);
}
