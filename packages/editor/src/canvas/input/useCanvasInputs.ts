/** Orchestrator for the canvas input pipeline: calls each contiguous phase hook unconditionally in the original flattened hook order and returns the unchanged 10-field result contract. */

import type { UseCanvasInputsOptions, UseCanvasInputsResult } from './types';
import { useGestureDispatchRuntime } from './useGestureDispatchRuntime';
import { useInputLifecycleEffects } from './useInputLifecycleEffects';
import { useInputSetup } from './useInputSetup';
import { useInteractionLifecycle } from './useInteractionLifecycle';
import { useKeyboardCallbacks } from './useKeyboardCallbacks';
import { useKeyboardPhase } from './useKeyboardPhase';
import { useNativeInputListeners } from './useNativeInputListeners';
import { usePointerDownPhase } from './usePointerDownPhase';
import { usePointerMovePhase } from './usePointerMovePhase';
import { usePointerCancelPhase, usePointerUpPhase } from './usePointerReleasePhases';
import { useWindowFocusEffect } from './useWindowFocusEffect';

export function useCanvasInputs(options: UseCanvasInputsOptions): UseCanvasInputsResult {
  const setup = useInputSetup(options);
  const lifecycle = useInteractionLifecycle(options, setup);
  const gesture = useGestureDispatchRuntime(options);
  const pointerDown = usePointerDownPhase(options, setup, lifecycle, gesture);
  const pointerMove = usePointerMovePhase(options, setup, lifecycle, gesture);
  const pointerUp = usePointerUpPhase(options, setup, lifecycle, gesture);
  const pointerCancel = usePointerCancelPhase(options, setup, lifecycle);
  useNativeInputListeners(options, setup, lifecycle, gesture);
  useInputLifecycleEffects(options, setup, lifecycle);
  const keyboard = useKeyboardPhase(options, setup, lifecycle, gesture);
  const keyboardCallbacks = useKeyboardCallbacks(options, setup, lifecycle, gesture);
  useWindowFocusEffect(lifecycle);

  return {
    handlePointerDown: pointerDown.handlePointerDown,
    handlePointerMove: pointerMove.handlePointerMove,
    handlePointerUp: pointerUp.handlePointerUp,
    handlePointerCancel: pointerCancel.handlePointerCancel,
    handleKeyDown: keyboard.handleKeyDown,
    handleKeyUp: keyboardCallbacks.handleKeyUp,
    handleDoubleClick: keyboardCallbacks.handleDoubleClick,
    onPointerLeave: keyboardCallbacks.onPointerLeave,
    onBlur: keyboardCallbacks.onBlur,
    stopAutoPan: lifecycle.stopAutoPan,
  };
}
