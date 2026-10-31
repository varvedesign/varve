/** Unmount cleanup and modal-crop key effects (original hook calls 55-56), one custom hook so their order and cleanup order are unchanged. */

import { useEffect } from 'react';
import { endEditorInteraction } from '../../performance/editorFrameRuntime';
import { shouldIgnoreCropShortcutTarget } from '../../shortcuts/ShortcutManager';
import { resetPointerOwnership } from '../../tools/inputPolicy';
import type { UseCanvasInputsOptions } from './types';
import type { InputSetupPhase } from './useInputSetup';
import type { InputLifecyclePhase } from './useInteractionLifecycle';

export function useInputLifecycleEffects(
  options: UseCanvasInputsOptions,
  setup: InputSetupPhase,
  lifecycle: InputLifecyclePhase,
) {
  const { stateRef, tmRef } = options;
  const { buildToolCtx, clearViewportAnchor, pointerOwnershipRef, touchPointers } = setup;
  const {
    activeDragPointer,
    closeKeyboardEditorInteraction,
    closePointerEditorInteraction,
    closeTouchNavigationInteraction,
    nativeFactorInteractionEndTimer,
    nativeGestureEditorInteractionOpen,
    nativeGestureRef,
    pinchRef,
  } = lifecycle;

  // The native gesture effect is allowed to rebind when camera/editor
  // dependencies change. Do not clear pointer ownership from that cleanup:
  // a tool commonly updates draft state on pointerdown, which rerenders the
  // canvas before the matching pointerup. Ownership is lifetime state of this
  // hook, not lifetime state of one native-listener registration.
  useEffect(() => {
    return () => {
      activeDragPointer.current = null;
      touchPointers.current.clear();
      closeTouchNavigationInteraction();
      closeKeyboardEditorInteraction();
      pinchRef.current = null;
      nativeGestureRef.current = null;
      if (nativeFactorInteractionEndTimer.current !== null) {
        clearTimeout(nativeFactorInteractionEndTimer.current);
        nativeFactorInteractionEndTimer.current = null;
      }
      if (nativeGestureEditorInteractionOpen.current) {
        nativeGestureEditorInteractionOpen.current = false;
        endEditorInteraction();
      }
      closeTouchNavigationInteraction();
      resetPointerOwnership(pointerOwnershipRef.current);
      closePointerEditorInteraction();
      closeKeyboardEditorInteraction();
      clearViewportAnchor();
    };
  }, [closePointerEditorInteraction, pointerOwnershipRef]);

  // Crop is a modal editing state. It can be entered from a Layers row or an
  // Inspector button, both of which legitimately keep focus outside the
  // canvas. Letting the window-level shortcut registry win in that case made
  // CropTool's F key activate the Frame tool instead of cycling the image fit.
  // Capture only crop's consumed modal keys, before generic shortcuts, while
  // preserving normal typing ownership for form fields and other widgets.
  useEffect(() => {
    const handleModalCropKey = (e: KeyboardEvent) => {
      if (stateRef.current.tool !== 'crop') return;
      if (
        e.defaultPrevented ||
        e.isComposing ||
        shouldIgnoreCropShortcutTarget(e.target as Element)
      ) {
        return;
      }
      const tmInst = tmRef.current;
      if (!tmInst) return;
      const ctx = buildToolCtx({ pointerType: 'mouse', pressure: 0 } as PointerEvent);
      if (!tmInst.handleKeyDown(e, ctx)) return;
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener('keydown', handleModalCropKey, true);
    return () => window.removeEventListener('keydown', handleModalCropKey, true);
  }, [stateRef, tmRef, buildToolCtx]);
}
