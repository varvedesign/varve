/** Keyboard release, double-click, pointer-leave, and blur callbacks (original hook calls 58-61). */

import { useCallback } from 'react';
import { endInteraction, endInteractionIfKind } from '../../performance/interactionTrace';
import { publishCursorWorldPosition } from '../cursorPosition';
import type { UseCanvasInputsOptions } from './types';
import type { InputGesturePhase } from './useGestureDispatchRuntime';
import type { InputSetupPhase } from './useInputSetup';
import type { InputLifecyclePhase } from './useInteractionLifecycle';

export function useKeyboardCallbacks(
  options: UseCanvasInputsOptions,
  setup: InputSetupPhase,
  lifecycle: InputLifecyclePhase,
  gesture: InputGesturePhase,
) {
  const { tmRef } = options;
  const { buildToolCtx } = setup;
  const {
    activeDragPointer,
    cancelCanvasInteraction,
    closeKeyboardEditorInteraction,
    hoverTraceEndTimer,
    pressedKeyboardKeys,
    stopAutoPan,
  } = lifecycle;
  const { latestCursorWorld } = gesture;

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      const ne = e.nativeEvent as KeyboardEvent;
      pressedKeyboardKeys.current.delete(ne.code || ne.key);
      const lastKeyboardKeyReleased = pressedKeyboardKeys.current.size === 0;
      if (lastKeyboardKeyReleased) closeKeyboardEditorInteraction();
      const tmInst = tmRef.current;
      if (!tmInst) {
        if (lastKeyboardKeyReleased) endInteractionIfKind('keyboard');
        return;
      }
      const ctx = buildToolCtx({ pointerType: 'mouse', pressure: 0 } as PointerEvent);
      if (e.key === ' ' && tmInst.springKey === ' ') {
        e.preventDefault();
        tmInst.releaseSpring(ctx);
        if (lastKeyboardKeyReleased) endInteractionIfKind('keyboard');
        return;
      }
      tmInst.handleKeyUp(ne, ctx);
      if (lastKeyboardKeyReleased) endInteractionIfKind('keyboard');
    },
    [tmRef, buildToolCtx, closeKeyboardEditorInteraction],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const tmInst = tmRef.current;
      if (!tmInst) return;
      const ne = e.nativeEvent as unknown as PointerEvent;
      tmInst.handleDoubleClick(ne, buildToolCtx(ne));
    },
    [tmRef, buildToolCtx],
  );

  const onPointerLeave = useCallback(() => {
    // Pointer capture keeps an active drag owned by the canvas even when the
    // hit-test target becomes an SVG overlay or the pointer crosses the
    // physical edge. Keep edge motion running until the gesture ends.
    if (activeDragPointer.current) return;
    // Clear the pending sample too, so a queued frame cannot republish it.
    latestCursorWorld.current = null;
    publishCursorWorldPosition(null);
    stopAutoPan();
    if (hoverTraceEndTimer.current !== null) {
      clearTimeout(hoverTraceEndTimer.current);
      hoverTraceEndTimer.current = null;
    }
    endInteraction();
  }, [stopAutoPan]);

  const onBlur = useCallback(() => cancelCanvasInteraction(), [cancelCanvasInteraction]);

  return { handleDoubleClick, handleKeyUp, onBlur, onPointerLeave };
}
