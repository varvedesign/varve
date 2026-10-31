/** Input pipeline setup phase: tool-context wrapper, pointer-ownership refs, and middle-button paste guard (hooks 1-11 of the original hook). */

import { useCallback, useEffect, useRef } from 'react';
import type { NormalizedInputEvent } from '../../tools/inputNormalizer';
import { createPointerOwnershipState } from '../../tools/inputPolicy';
import { shouldSuppressMiddleButtonPaste } from './primitives';
import type { UseCanvasInputsOptions } from './types';

export function useInputSetup(options: UseCanvasInputsOptions) {
  const { buildToolCtx: buildToolCtxOption, viewportAnchorRef } = options;

  // Canvas camera previews deliberately re-render the canvas subscriber at
  // display cadence. Keep the input handlers and native gesture listeners
  // attached across those renders while still building each tool context from
  // the latest canvas state and callbacks.
  const buildToolCtxRef = useRef(buildToolCtxOption);
  buildToolCtxRef.current = buildToolCtxOption;
  const buildToolCtx = useCallback(
    (event: PointerEvent, sourceEvents?: NormalizedInputEvent[]) =>
      buildToolCtxRef.current(event, sourceEvents),
    [],
  );
  const touchPointers = useRef(new Map<number, { x: number; y: number }>());
  const pointerOwnershipRef = useRef(createPointerOwnershipState());
  const pointerEditorInteractionOpen = useRef(false);
  const touchNavigationEditorInteractionOpen = useRef(false);
  const keyboardEditorInteractionOpen = useRef(false);
  // Linux browsers can dispatch a native `paste` from the PRIMARY selection
  // for a middle click. Keep that event out of Shell's document paste route
  // while a canvas middle-button pan is active, even if auxclick cancellation
  // arrives too late to suppress the browser's paste event.
  const middleButtonPasteGuardRef = useRef(false);
  const middleButtonPasteGuardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearMiddleButtonPasteGuard = useCallback(() => {
    middleButtonPasteGuardRef.current = false;
    if (middleButtonPasteGuardTimerRef.current !== null) {
      clearTimeout(middleButtonPasteGuardTimerRef.current);
      middleButtonPasteGuardTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const expireAfterMiddleButtonRelease = (event: { button: number }) => {
      if (event.button !== 1 || !middleButtonPasteGuardRef.current) return;
      if (middleButtonPasteGuardTimerRef.current !== null) {
        clearTimeout(middleButtonPasteGuardTimerRef.current);
      }
      // Keep the guard briefly after release in case the browser queues its
      // PRIMARY-selection paste after pointerup/auxclick dispatch.
      middleButtonPasteGuardTimerRef.current = setTimeout(clearMiddleButtonPasteGuard, 250);
    };
    const suppressMiddleButtonPaste = (event: ClipboardEvent) => {
      if (!shouldSuppressMiddleButtonPaste(middleButtonPasteGuardRef.current, event.target)) return;
      event.preventDefault();
      clearMiddleButtonPasteGuard();
    };
    const allowExplicitKeyboardPaste = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (
        ((event.ctrlKey || event.metaKey) && key === 'v') ||
        (event.shiftKey && key === 'insert')
      ) {
        clearMiddleButtonPasteGuard();
      }
    };
    window.addEventListener('pointerup', expireAfterMiddleButtonRelease, true);
    window.addEventListener('auxclick', expireAfterMiddleButtonRelease, true);
    window.addEventListener('paste', suppressMiddleButtonPaste, true);
    window.addEventListener('keydown', allowExplicitKeyboardPaste, true);
    return () => {
      window.removeEventListener('pointerup', expireAfterMiddleButtonRelease, true);
      window.removeEventListener('auxclick', expireAfterMiddleButtonRelease, true);
      window.removeEventListener('paste', suppressMiddleButtonPaste, true);
      window.removeEventListener('keydown', allowExplicitKeyboardPaste, true);
      clearMiddleButtonPasteGuard();
    };
  }, [clearMiddleButtonPasteGuard]);

  function setViewportAnchor(clientX: number, clientY: number): void {
    if (!viewportAnchorRef || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
    viewportAnchorRef.current = { clientX, clientY };
  }

  function clearViewportAnchor(): void {
    if (viewportAnchorRef) viewportAnchorRef.current = null;
  }

  return {
    buildToolCtx,
    clearMiddleButtonPasteGuard,
    clearViewportAnchor,
    keyboardEditorInteractionOpen,
    middleButtonPasteGuardRef,
    middleButtonPasteGuardTimerRef,
    pointerEditorInteractionOpen,
    pointerOwnershipRef,
    setViewportAnchor,
    touchNavigationEditorInteractionOpen,
    touchPointers,
  };
}

export type InputSetupPhase = ReturnType<typeof useInputSetup>;
