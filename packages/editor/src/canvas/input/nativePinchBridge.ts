/** Tauri WebKitGTK pinch-bridge runtime for the native input effect (dynamic-import listener moved verbatim into a factory). */

import {
  beginEditorInteraction,
  endEditorInteraction,
  isEditorInteractionActive,
} from '../../performance/editorFrameRuntime';
import {
  beginInteraction,
  endInteractionIfKind,
  getActiveInteractionIdentity,
  isInteractionTracingEnabled,
  markInteractionCanvasChanged,
  recordInteractionSpan,
} from '../../performance/interactionTrace';
import { recordInputDiagnostic } from '../inputDiagnostics';
import { type PinchBridgePayload, resolvePinchBridgeAction } from '../pinchBridge';
import type { NativeGestureRuntime } from './nativeGestureRuntime';
import { zoomAboutClientPoint as zoomAboutClientPointWith } from './nativeZoomPlacement';
import type { UseCanvasInputsOptions } from './types';
import type { InputGesturePhase } from './useGestureDispatchRuntime';
import type { InputSetupPhase } from './useInputSetup';
import type { InputLifecyclePhase } from './useInteractionLifecycle';

export interface NativePinchBridgeControl {
  cancel: () => void;
  dispose: () => void;
}

export function createNativePinchBridge(
  options: UseCanvasInputsOptions,
  setup: InputSetupPhase,
  lifecycle: InputLifecyclePhase,
  gesture: InputGesturePhase,
  nativeGesture: NativeGestureRuntime,
): NativePinchBridgeControl {
  const {
    canvasRectRef,
    commitCamera,
    contentCanvasRef,
    previewCamera,
    refreshCanvasRect,
    stateRef,
  } = options;
  const { setViewportAnchor } = setup;
  const {
    cancelWheelInertiaRef,
    nativeFactorInteractionEndTimer,
    nativeGestureEditorInteractionOpen,
    nativeGestureRef,
  } = lifecycle;
  const { traceEventId } = gesture;
  const {
    isPinchPointerInside,
    onGestureCancel,
    onGestureChange,
    onGestureEnd,
    onGestureStart,
    resolveGesturePoint,
  } = nativeGesture;
  const zoomDeps = { canvasRectRef, contentCanvasRef, previewCamera, stateRef };
  const zoomAboutClientPoint = (clientX: number, clientY: number, newZoom: number): void =>
    zoomAboutClientPointWith(zoomDeps, clientX, clientY, newZoom);

  /**
   * WebKitGTK performs no pinch zoom of its own and no wheel or DOM gesture
   * event ever reaches this page for the gesture — the desktop shell handles
   * native GDK TouchpadPinch events on the WebKitGTK webview and re-emits the
   * gesture here as a structured stream:
   * `{ phase: 'begin'|'update'|'end'|'cancel', scale, x, y }`. `scale` is cumulative
   * since begin, and `x`/`y` are webview-local CSS pixels for the gesture
   * centre, so the update semantics are identical to the macOS WebKit
   * `gesturechange` stream above and reuse the same handlers.
   *
   * A second, fallback payload `{ factor }` (an absolute multiplicative
   * delta) covers WebKit builds that page-zoom on pinch themselves: the
   * native side intercepts that zoom, restores the page, and re-emits the
   * factor so the pinch lands on the artwork instead of scaling the whole UI.
   *
   * The three arms — ctrl+wheel (Chromium), gesture events (macOS WebKit),
   * and this bridge (WebKitGTK) — are one behaviour with per-platform
   * transports rather than separate features.
   */
  let disposePinchBridge: (() => void) | undefined;
  let pinchBridgeCancelled = false;
  let pinchBridgeUpdateCount = 0;
  const recordPinchBridgeDiagnostic = (phase: string, scale: number | undefined): void => {
    // Sample the (potentially 120 Hz) update stream so a pinch does not
    // flush the bounded diagnostic ring on its own.
    pinchBridgeUpdateCount += 1;
    if (phase === 'update' && pinchBridgeUpdateCount % 4 !== 0) return;
    recordInputDiagnostic({
      eventType: `pinch-bridge:${phase}`,
      source: 'trackpad',
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      wheel:
        phase === 'end'
          ? undefined
          : {
              deltaX: 0,
              deltaY: 0,
              deltaMode: 0,
              source: 'trackpad',
              kind: 'zoom',
              scale: typeof scale === 'number' && Number.isFinite(scale) ? scale : 1,
            },
      viewport: {
        zoom: stateRef.current.zoom,
        panX: stateRef.current.pan.x,
        panY: stateRef.current.pan.y,
        rotation: stateRef.current.cameraRotation,
      },
    });
  };
  const pinchBridgeEvent = (
    clientX: number | null | undefined,
    clientY: number | null | undefined,
    scale: number,
  ): Event => {
    const point = resolveGesturePoint(
      typeof clientX === 'number' ? clientX : undefined,
      typeof clientY === 'number' ? clientY : undefined,
    );
    return {
      preventDefault() {},
      clientX: point.x,
      clientY: point.y,
      scale,
    } as unknown as Event;
  };
  void import('@varve/platform')
    .then(({ isTauriRuntime }) => {
      if (!isTauriRuntime() || pinchBridgeCancelled) return;
      return import('@tauri-apps/api/event').then(({ listen }) =>
        listen<PinchBridgePayload>('canvas://pinch-zoom', (event) => {
          const action = resolvePinchBridgeAction(event.payload);
          if (action.kind === 'ignore') return;
          if (action.kind === 'gesture') {
            if (nativeFactorInteractionEndTimer.current !== null) {
              clearTimeout(nativeFactorInteractionEndTimer.current);
              nativeFactorInteractionEndTimer.current = null;
            }
            recordPinchBridgeDiagnostic(action.phase, action.scale);
            // Pinching over a panel should not move the artwork: drop the
            // gesture unless the pointer was last seen on the canvas (a
            // gesture that began before any pointer movement still zooms,
            // mirroring the `pointerInside === null` contract below).
            if (isPinchPointerInside() === false) {
              if (action.phase === 'cancel' && nativeGestureRef.current) {
                onGestureCancel(pinchBridgeEvent(action.x, action.y, 1));
              } else if (action.phase === 'end' && nativeGestureRef.current) {
                onGestureEnd(pinchBridgeEvent(action.x, action.y, 1));
              }
              return;
            }
            cancelWheelInertiaRef.current?.();
            const scale = action.phase === 'update' ? action.scale : 1;
            if (action.phase === 'begin') {
              onGestureStart(pinchBridgeEvent(action.x, action.y, 1));
            } else if (action.phase === 'update') {
              if (!nativeGestureRef.current) return;
              onGestureChange(pinchBridgeEvent(action.x, action.y, scale));
            } else if (action.phase === 'cancel') {
              if (!nativeGestureRef.current) return;
              onGestureCancel(pinchBridgeEvent(action.x, action.y, 1));
            } else if (nativeGestureRef.current) {
              onGestureEnd(pinchBridgeEvent(action.x, action.y, 1));
            }
            return;
          }
          if (nativeGestureRef.current) return;
          // Pinching over a panel should not move the artwork. The page zoom
          // has already been reverted natively, so swallowing it is enough.
          if (isPinchPointerInside() === false) return;
          recordPinchBridgeDiagnostic('factor', action.factor);
          refreshCanvasRect?.();
          const point = resolveGesturePoint(undefined, undefined);
          const x = point.x;
          const y = point.y;
          if (!isEditorInteractionActive()) {
            beginEditorInteraction();
            nativeGestureEditorInteractionOpen.current = true;
          }
          if (isInteractionTracingEnabled() && getActiveInteractionIdentity() === null) {
            // The native bridge does not share the DOM performance clock;
            // keep the sample explicitly handler-origin rather than
            // manufacturing a queue delay from Date.now().
            beginInteraction('pinch');
          }
          const bridgeStartedAt = performance.now();
          setViewportAnchor(x, y);
          cancelWheelInertiaRef.current?.();
          zoomAboutClientPoint(x, y, stateRef.current.zoom * action.factor);
          markInteractionCanvasChanged();
          if (isInteractionTracingEnabled()) {
            const eventSequenceId = traceEventId('pinch-bridge');
            recordInteractionSpan('pinch.input', performance.now() - bridgeStartedAt, {
              phase: 'factor',
              timestampSource: 'handler.performance.now',
              queueDelayClock: 'untrusted',
              ...(eventSequenceId ? { eventSequenceId } : {}),
            });
          }
          if (nativeFactorInteractionEndTimer.current !== null) {
            clearTimeout(nativeFactorInteractionEndTimer.current);
          }
          nativeFactorInteractionEndTimer.current = setTimeout(() => {
            nativeFactorInteractionEndTimer.current = null;
            const camera = stateRef.current;
            commitCamera({ zoom: camera.zoom, pan: camera.pan, rotation: camera.cameraRotation });
            if (nativeGestureEditorInteractionOpen.current && !nativeGestureRef.current) {
              nativeGestureEditorInteractionOpen.current = false;
              endEditorInteraction();
            }
            endInteractionIfKind('pinch');
          }, 150);
        }).then((unlisten) => {
          if (pinchBridgeCancelled) unlisten();
          else disposePinchBridge = unlisten;
        }),
      );
    })
    .catch(() => {
      // Non-desktop build, or the event API is unavailable — the wheel and
      // gesture paths above still cover their platforms.
    });

  return {
    cancel: () => {
      pinchBridgeCancelled = true;
    },
    dispose: () => {
      disposePinchBridge?.();
    },
  };
}
