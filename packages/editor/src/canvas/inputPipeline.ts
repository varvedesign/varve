/**
 * Input pipeline — pointer, keyboard, wheel, and touch-pinch handling
 * extracted from CanvasArea.  Encapsulates auto-pan, snap session state,
 * and two-finger pinch zoom/pan so CanvasArea's event handlers delegate
 * here instead of managing ~200 lines of inline state-machine logic.
 */

export {
  keyboardPanDelta,
  shouldDeferArrowToSelectedGuide,
  shouldSkipCanvasKeydown,
} from './input/keyboardHelpers';
export { shouldResolveHover, shouldSuppressMiddleButtonPaste } from './input/primitives';
export type { UseCanvasInputsOptions, UseCanvasInputsResult } from './input/types';
export { useCanvasInputs } from './input/useCanvasInputs';
