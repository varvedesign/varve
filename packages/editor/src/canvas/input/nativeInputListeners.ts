/** Installs the native wheel/gesture/pinch-bridge listener set and returns its cleanup; composes the runtime factories so the effect stays one effect with one cleanup order. */

import { createNativeGestureRuntime } from './nativeGestureRuntime';
import { createLostPointerCaptureHandler } from './nativeLostCapture';
import { createNativePinchBridge } from './nativePinchBridge';
import { createWheelInputRuntime } from './nativeWheelRuntime';
import type { UseCanvasInputsOptions } from './types';
import type { InputGesturePhase } from './useGestureDispatchRuntime';
import type { InputSetupPhase } from './useInputSetup';
import type { InputLifecyclePhase } from './useInteractionLifecycle';

export function installNativeInputListeners(
  el: HTMLCanvasElement,
  options: UseCanvasInputsOptions,
  setup: InputSetupPhase,
  lifecycle: InputLifecyclePhase,
  gesture: InputGesturePhase,
): () => void {
  const { nativeFactorInteractionEndTimer } = lifecycle;
  const wheel = createWheelInputRuntime(el, options, setup, lifecycle, gesture);
  const nativeGesture = createNativeGestureRuntime(options, setup, lifecycle, gesture);
  const bridge = createNativePinchBridge(options, setup, lifecycle, gesture, nativeGesture);
  const lostPointerCapture = createLostPointerCaptureHandler(options, setup, lifecycle);

  el.addEventListener('wheel', wheel.onWheel, { passive: false });
  el.addEventListener('pointermove', nativeGesture.trackPointer);
  el.addEventListener('pointerleave', nativeGesture.onPointerLeave);
  el.addEventListener('gesturestart', nativeGesture.onGestureStart, { passive: false });
  el.addEventListener('gesturechange', nativeGesture.onGestureChange, { passive: false });
  el.addEventListener('gestureend', nativeGesture.onGestureEnd, { passive: false });
  el.addEventListener('lostpointercapture', lostPointerCapture);

  return () => {
    el.removeEventListener('wheel', wheel.onWheel);
    el.removeEventListener('pointermove', nativeGesture.trackPointer);
    el.removeEventListener('pointerleave', nativeGesture.onPointerLeave);
    el.removeEventListener('gesturestart', nativeGesture.onGestureStart);
    el.removeEventListener('gesturechange', nativeGesture.onGestureChange);
    el.removeEventListener('gestureend', nativeGesture.onGestureEnd);
    el.removeEventListener('lostpointercapture', lostPointerCapture);
    bridge.cancel();
    if (nativeFactorInteractionEndTimer.current !== null) {
      clearTimeout(nativeFactorInteractionEndTimer.current);
      nativeFactorInteractionEndTimer.current = null;
    }
    bridge.dispose();
  };
}
