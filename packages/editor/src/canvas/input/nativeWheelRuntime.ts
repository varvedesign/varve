/** Native wheel listener and inertial pan runtime for the native input effect (moved verbatim into a factory that owns the inertia state). */

import { eventQueueDelayMs } from '../../performance/clockDomain';
import {
  beginEditorInteraction,
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
import {
  decayRateFromFrameRetention,
  frameDisplacementToVelocity,
  navigationFrameDeltaMs,
  prefersReducedNavigationMotion,
  stepDecayedMotion,
} from '../../tools/navigationPhysics';
import { installInputDiagnosticsHandle, recordInputDiagnostic } from '../inputDiagnostics';
import { getNavigationSettings } from '../navigationRuntime';
import { cancelCanvasFrame, createCanvasFrameKey, scheduleCanvasFrame } from '../perfRuntime';
import { resolveWheelAction } from '../wheelClassifier';
import { createWheelGestureClassifier } from '../wheelGesture';
import { zoomAboutClientPoint as zoomAboutClientPointWith } from './nativeZoomPlacement';
import type { UseCanvasInputsOptions } from './types';
import type { InputGesturePhase } from './useGestureDispatchRuntime';
import type { InputSetupPhase } from './useInputSetup';
import type { InputLifecyclePhase } from './useInteractionLifecycle';

export interface NativeWheelRuntime {
  onWheel: (e: WheelEvent) => void;
}

export function createWheelInputRuntime(
  el: HTMLCanvasElement,
  options: UseCanvasInputsOptions,
  setup: InputSetupPhase,
  lifecycle: InputLifecyclePhase,
  gesture: InputGesturePhase,
): NativeWheelRuntime {
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
    advanceNavigation,
    cancelWheelInertiaRef,
    endWheelInteractionSoon,
    lastWheelTraceAt,
    wheelEditorInteractionOpen,
    wheelGestureClassifierRef,
    wheelInertiaActive,
    wheelTraceEndTimer,
  } = lifecycle;
  const { traceEventId } = gesture;
  const zoomDeps = { canvasRectRef, contentCanvasRef, previewCamera, stateRef };
  const zoomAboutClientPoint = (clientX: number, clientY: number, newZoom: number): void =>
    zoomAboutClientPointWith(zoomDeps, clientX, clientY, newZoom);

  const inertiaRef = { current: { vx: 0, vy: 0, active: false } };
  const inertiaFrameKey = createCanvasFrameKey('wheel-inertia');
  const inertiaDecayRate = decayRateFromFrameRetention(0.9);
  const inertiaStopSpeed = frameDisplacementToVelocity(0.5);
  let inertiaFrameTime: number | null = null;

  function startInertia() {
    if (inertiaRef.current.active) return;
    if (prefersReducedNavigationMotion()) {
      inertiaRef.current.vx = 0;
      inertiaRef.current.vy = 0;
      return;
    }
    inertiaRef.current.active = true;
    wheelInertiaActive.current = true;
    inertiaFrameTime = null;
    const tick = (frameTimeMs: number) => {
      const v = inertiaRef.current;
      const elapsedMs = navigationFrameDeltaMs(inertiaFrameTime, frameTimeMs);
      inertiaFrameTime = frameTimeMs;
      const step = stepDecayedMotion(
        { x: v.vx, y: v.vy },
        elapsedMs,
        inertiaDecayRate,
        inertiaStopSpeed,
      );
      if (step.stopped) {
        v.active = false;
        v.vx = 0;
        v.vy = 0;
        wheelInertiaActive.current = false;
        const camera = stateRef.current;
        commitCamera({ zoom: camera.zoom, pan: camera.pan, rotation: camera.cameraRotation });
        return;
      }
      // Relative, so a frame that runs before React commits the previous
      // step still advances the scroll instead of re-applying it.
      previewCamera({
        zoom: stateRef.current.zoom,
        pan: {
          x: stateRef.current.pan.x + step.delta.x,
          y: stateRef.current.pan.y + step.delta.y,
        },
        rotation: stateRef.current.cameraRotation,
      });
      v.vx = step.velocity.x;
      v.vy = step.velocity.y;
      scheduleCanvasFrame(inertiaFrameKey, 'input', tick);
    };
    scheduleCanvasFrame(inertiaFrameKey, 'input', tick);
  }

  function cancelInertia() {
    cancelCanvasFrame(inertiaFrameKey);
    inertiaRef.current.active = false;
    wheelInertiaActive.current = false;
    inertiaRef.current.vx = 0;
    inertiaRef.current.vy = 0;
    inertiaFrameTime = null;
  }
  cancelWheelInertiaRef.current = cancelInertia;

  // The gesture classifier's sticky history must survive effect rebinds (a
  // rebind happens on any camera/editor dependency change, which tools
  // trigger on every pointerdown) — exactly the lifetime rule the pointer
  // ownership state documents below. A classifier recreated per rebind
  // would forget mid-gesture evidence and could flip inertia on/off.
  if (!wheelGestureClassifierRef.current) {
    wheelGestureClassifierRef.current = createWheelGestureClassifier();
  }
  const wheelClassifier = wheelGestureClassifierRef.current;
  installInputDiagnosticsHandle();

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // The first wheel event after a layout shift is a new gesture. Refresh
    // before storing its anchor so a position-only move is not interpreted
    // as an already-active gesture that needs camera rebasing.
    refreshCanvasRect?.();
    setViewportAnchor(e.clientX, e.clientY);
    const started = performance.now();
    const activeTrace = isInteractionTracingEnabled() ? getActiveInteractionIdentity() : null;
    if (
      isInteractionTracingEnabled() &&
      (activeTrace === null ||
        (activeTrace.kind === 'wheel' &&
          (lastWheelTraceAt.current === 0 || started - lastWheelTraceAt.current > 150)))
    ) {
      beginInteraction('wheel', e.timeStamp);
    }
    lastWheelTraceAt.current = started;
    const s = stateRef.current;
    // Keep the scheduler interaction open for the whole wheel burst (and
    // past the last event by the quiet window) so background work defers.
    if (!isEditorInteractionActive()) {
      beginEditorInteraction();
      wheelEditorInteractionOpen.current = true;
    }
    endWheelInteractionSoon();
    // Sequence-aware source: a fast trackpad flick whose per-event deltas
    // land in the ambiguous band must not be reclassified mid-gesture and
    // receive app inertia on top of the OS momentum it already carries.
    const wheelSource = wheelClassifier.classify(e.deltaMode, e.deltaX, e.deltaY, started);
    const action = resolveWheelAction({
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      deltaMode: e.deltaMode,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
      clientHeight: el.clientHeight,
      source: wheelSource,
      ...getNavigationSettings(),
    });
    advanceNavigation({ type: 'wheel', zoom: action.kind === 'zoom' });
    if (action.kind === 'zoom') {
      zoomAboutClientPoint(e.clientX, e.clientY, s.zoom * action.scale);
      cancelInertia();
    } else if (action.shiftHeld) {
      previewCamera({
        zoom: stateRef.current.zoom,
        pan: { x: stateRef.current.pan.x + action.deltaX, y: stateRef.current.pan.y },
        rotation: stateRef.current.cameraRotation,
      });
      cancelInertia();
    } else {
      // Relative pan: several wheel events can be delivered in one task, all
      // before React commits. Resolving each against `s.pan` would make every
      // event in the burst compute the same destination, dropping deltas.
      previewCamera({
        zoom: stateRef.current.zoom,
        pan: {
          x: stateRef.current.pan.x + action.deltaX,
          y: stateRef.current.pan.y + action.deltaY,
        },
        rotation: stateRef.current.cameraRotation,
      });
      if (action.applyInertia) {
        // Cancel the previously scheduled continuation before replacing its
        // velocity. `cancelInertia` also zeros the stored velocity, so doing
        // this after assignment would silently disable wheel inertia.
        const previousVx = inertiaRef.current.vx;
        const previousVy = inertiaRef.current.vy;
        cancelInertia();
        inertiaRef.current.vx = previousVx * 0.4 + frameDisplacementToVelocity(action.deltaX) * 0.6;
        inertiaRef.current.vy = previousVy * 0.4 + frameDisplacementToVelocity(action.deltaY) * 0.6;
        const maxV = frameDisplacementToVelocity(80);
        inertiaRef.current.vx = Math.max(-maxV, Math.min(maxV, inertiaRef.current.vx));
        inertiaRef.current.vy = Math.max(-maxV, Math.min(maxV, inertiaRef.current.vy));
        startInertia();
      } else {
        // Trackpad input already carries its own OS momentum; adding
        // application inertia would double it.
        cancelInertia();
      }
    }
    markInteractionCanvasChanged();
    const processingMs = performance.now() - started;
    const queueDelayMs = eventQueueDelayMs(e.timeStamp, started);
    recordInputDiagnostic({
      eventType: 'wheel',
      source: action.source === 'trackpad' ? 'trackpad' : 'wheel',
      modifiers: { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey },
      wheel: {
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        ...(Number.isFinite(e.timeStamp) ? { eventTimeStamp: e.timeStamp } : {}),
        source: action.source,
        kind: action.kind,
        scale: action.scale,
      },
      viewport: { zoom: s.zoom, panX: s.pan.x, panY: s.pan.y, rotation: s.cameraRotation },
      processingMs,
      preventedDefault: true,
    });
    if (isInteractionTracingEnabled()) {
      const eventSequenceId = traceEventId('wheel');
      recordInteractionSpan('wheel.input', processingMs, {
        source: action.source,
        action: action.kind,
        deltaMode: e.deltaMode,
        ...(queueDelayMs === null
          ? { queueDelayClock: 'untrusted' }
          : {
              queueDelayMs,
              queueDelayClock: 'dom.event.timeStamp',
            }),
        ...(eventSequenceId ? { eventSequenceId } : {}),
      });
      if (wheelTraceEndTimer.current !== null) clearTimeout(wheelTraceEndTimer.current);
      wheelTraceEndTimer.current = setTimeout(() => {
        wheelTraceEndTimer.current = null;
        endInteractionIfKind('wheel');
      }, 150);
    }
  };

  return { onWheel };
}
