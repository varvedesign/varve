/** Native gesture runtime for the native input effect: pointer presence, WebKit gesture handlers, and pointer tracking (moved verbatim into a factory). */

import { clampZoom, computeFloatingOrigin, screenToWorld } from '@varve/shared';
import { eventQueueDelayMs } from '../../performance/clockDomain';
import {
  beginEditorInteraction,
  endEditorInteraction,
  isEditorInteractionActive,
} from '../../performance/editorFrameRuntime';
import {
  beginInteraction,
  endInteraction,
  endInteractionIfKind,
  getActiveInteractionIdentity,
  isInteractionTracingEnabled,
  markInteractionCanvasChanged,
  recordInteractionSpan,
} from '../../performance/interactionTrace';
import { endPointerContact, getPointerContact } from '../../tools/inputPolicy';
import { placeWorldAnchorAtClientPoint as placeWorldAnchorAtClientPointWith } from './nativeZoomPlacement';
import {
  cancelRecordedCanvasPointer,
  isTouchLikeContact,
  ownsCanvasPointerInteraction,
} from './primitives';
import type { UseCanvasInputsOptions } from './types';
import type { InputGesturePhase } from './useGestureDispatchRuntime';
import type { InputSetupPhase } from './useInputSetup';
import type { InputLifecyclePhase } from './useInteractionLifecycle';

export interface NativeGestureRuntime {
  isPinchPointerInside: () => boolean | null;
  onGestureCancel: (e: Event) => void;
  onGestureChange: (e: Event) => void;
  onGestureEnd: (e: Event) => void;
  onGestureStart: (e: Event) => void;
  onPointerLeave: () => void;
  resolveGesturePoint: (clientX: unknown, clientY: unknown) => { x: number; y: number };
  trackPointer: (e: PointerEvent) => void;
}

export function createNativeGestureRuntime(
  options: UseCanvasInputsOptions,
  setup: InputSetupPhase,
  lifecycle: InputLifecyclePhase,
  gesture: InputGesturePhase,
): NativeGestureRuntime {
  const {
    canvasRectRef,
    commitCamera,
    contentCanvasRef,
    previewCamera,
    refreshCanvasRect,
    setSnapGuides,
    stateRef,
    tmRef,
  } = options;
  const { clearViewportAnchor, pointerOwnershipRef, setViewportAnchor, touchPointers } = setup;
  const {
    activeDragPointer,
    activeInteractionRecord,
    cancelWheelInertiaRef,
    closePointerEditorInteraction,
    nativeGestureEditorInteractionOpen,
    nativeGestureRef,
    pinchGeometry,
    pinchRef,
    stopAutoPan,
  } = lifecycle;
  const { traceEventId } = gesture;
  const zoomDeps = { canvasRectRef, contentCanvasRef, previewCamera, stateRef };
  const placeWorldAnchorAtClientPoint = (
    worldAnchor: [number, number],
    clientX: number,
    clientY: number,
    newZoom: number,
  ): void => placeWorldAnchorAtClientPointWith(zoomDeps, worldAnchor, clientX, clientY, newZoom);

  interface WebKitGestureEvent extends Event {
    scale: number;
    clientX: number;
    clientY: number;
  }
  let lastPointer: { x: number; y: number } | null = null;
  // `null` until the pointer has been seen at all, so a pinch made before any
  // movement still zooms (about the canvas centre) rather than being dropped.
  let pointerInside: boolean | null = null;
  const canvasCenterClient = (): { x: number; y: number } => {
    const rect = canvasRectRef.current;
    const canvasEl = contentCanvasRef.current;
    const left = Number.isFinite(rect.left) ? rect.left : 0;
    const top = Number.isFinite(rect.top) ? rect.top : 0;
    return {
      x: left + (canvasEl?.clientWidth ?? 0) / 2,
      y: top + (canvasEl?.clientHeight ?? 0) / 2,
    };
  };
  const resolveGesturePoint = (clientX: unknown, clientY: unknown): { x: number; y: number } => {
    if (
      typeof clientX === 'number' &&
      Number.isFinite(clientX) &&
      typeof clientY === 'number' &&
      Number.isFinite(clientY)
    ) {
      return { x: clientX, y: clientY };
    }
    return pinchGeometry()?.centroid ?? lastPointer ?? canvasCenterClient();
  };

  const captureNativeGestureAnchor = (point: { x: number; y: number }): boolean => {
    const s = stateRef.current;
    const canvasEl = contentCanvasRef.current;
    const viewport = {
      width: canvasEl?.clientWidth ?? 800,
      height: canvasEl?.clientHeight ?? 600,
    };
    if (viewport.width <= 0 || viewport.height <= 0) return false;
    const rect = canvasRectRef.current;
    const left = Number.isFinite(rect.left) ? rect.left : 0;
    const top = Number.isFinite(rect.top) ? rect.top : 0;
    const cam = { pan: s.pan, zoom: s.zoom, rotation: s.cameraRotation };
    const origin = computeFloatingOrigin(cam, viewport);
    const anchor = screenToWorld(cam, point.x - left, point.y - top, viewport, origin);
    if (!anchor.every(Number.isFinite)) return false;
    nativeGestureRef.current = {
      worldAnchor: [anchor[0], anchor[1]],
      baseZoom: Number.isFinite(s.zoom) ? clampZoom(s.zoom) : 1,
      clientAnchor: [point.x, point.y],
    };
    return true;
  };

  const onGestureStart = (e: Event) => {
    const started = performance.now();
    e.preventDefault();
    refreshCanvasRect?.();
    const ge = e as Partial<WebKitGestureEvent>;
    const point = resolveGesturePoint(ge.clientX, ge.clientY);
    if (!captureNativeGestureAnchor(point)) return;
    pinchRef.current = null;
    const activePointer = activeDragPointer.current;
    const activeContact = activePointer
      ? getPointerContact(pointerOwnershipRef.current, activePointer.pointerId)
      : null;
    if (activePointer && activeContact?.role === 'tool') {
      const record = activeInteractionRecord.current;
      if (
        record &&
        ownsCanvasPointerInteraction(
          record,
          activePointer.pointerId,
          stateRef.current.activeId,
          tmRef.current,
        )
      ) {
        cancelRecordedCanvasPointer(record, activePointer);
        activeInteractionRecord.current = null;
      } else if (record && !record.closed && record.pointerId === activePointer.pointerId) {
        cancelRecordedCanvasPointer(record, activePointer);
        activeInteractionRecord.current = null;
      }
      endPointerContact(pointerOwnershipRef.current, activePointer.pointerId);
      activeDragPointer.current = null;
      stopAutoPan();
      setSnapGuides([]);
      closePointerEditorInteraction();
      endInteraction();
    }
    if (!isEditorInteractionActive()) {
      beginEditorInteraction();
      nativeGestureEditorInteractionOpen.current = true;
    }
    setViewportAnchor(point.x, point.y);
    cancelWheelInertiaRef.current?.();
    if (isInteractionTracingEnabled() && getActiveInteractionIdentity()?.kind !== 'pinch') {
      beginInteraction('pinch', e.timeStamp);
    }
    if (isInteractionTracingEnabled()) {
      const eventSequenceId = traceEventId('pinch');
      const queueDelayMs = eventQueueDelayMs(e.timeStamp, started);
      recordInteractionSpan('pinch.input', performance.now() - started, {
        phase: 'start',
        ...(Number.isFinite(e.timeStamp) ? { eventTimeStamp: e.timeStamp } : {}),
        ...(queueDelayMs === null
          ? { queueDelayClock: 'untrusted' }
          : { queueDelayMs, queueDelayClock: 'dom.event.timeStamp' }),
        ...(eventSequenceId ? { eventSequenceId } : {}),
      });
    }
  };
  const onGestureChange = (e: Event) => {
    const started = performance.now();
    e.preventDefault();
    const ge = e as WebKitGestureEvent;
    const point = resolveGesturePoint(ge.clientX, ge.clientY);
    if (!nativeGestureRef.current && !captureNativeGestureAnchor(point)) return;
    const scale =
      typeof ge.scale === 'number' && Number.isFinite(ge.scale) && ge.scale > 0 ? ge.scale : 1;
    setViewportAnchor(point.x, point.y);
    refreshCanvasRect?.();
    cancelWheelInertiaRef.current?.();
    placeWorldAnchorAtClientPoint(
      nativeGestureRef.current?.worldAnchor ?? [0, 0],
      point.x,
      point.y,
      (nativeGestureRef.current?.baseZoom ?? stateRef.current.zoom) * scale,
    );
    markInteractionCanvasChanged();
    if (isInteractionTracingEnabled()) {
      const eventSequenceId = traceEventId('pinch');
      const queueDelayMs = eventQueueDelayMs(e.timeStamp, started);
      recordInteractionSpan('pinch.input', performance.now() - started, {
        phase: 'change',
        ...(Number.isFinite(e.timeStamp) ? { eventTimeStamp: e.timeStamp } : {}),
        ...(queueDelayMs === null
          ? { queueDelayClock: 'untrusted' }
          : { queueDelayMs, queueDelayClock: 'dom.event.timeStamp' }),
        ...(eventSequenceId ? { eventSequenceId } : {}),
      });
    }
  };
  const onGestureEnd = (e: Event) => {
    const started = performance.now();
    e.preventDefault();
    nativeGestureRef.current = null;
    pinchRef.current = null;
    const camera = stateRef.current;
    commitCamera({ zoom: camera.zoom, pan: camera.pan, rotation: camera.cameraRotation });
    if (nativeGestureEditorInteractionOpen.current) {
      nativeGestureEditorInteractionOpen.current = false;
      endEditorInteraction();
    }
    if (isInteractionTracingEnabled()) {
      const eventSequenceId = traceEventId('pinch');
      const queueDelayMs = eventQueueDelayMs(e.timeStamp, started);
      recordInteractionSpan('pinch.input', performance.now() - started, {
        phase: 'end',
        ...(Number.isFinite(e.timeStamp) ? { eventTimeStamp: e.timeStamp } : {}),
        ...(queueDelayMs === null
          ? { queueDelayClock: 'untrusted' }
          : { queueDelayMs, queueDelayClock: 'dom.event.timeStamp' }),
        ...(eventSequenceId ? { eventSequenceId } : {}),
      });
    }
    endInteractionIfKind('pinch');
    clearViewportAnchor();
  };
  const onGestureCancel = (e: Event) => {
    const gesture = nativeGestureRef.current;
    if (gesture) {
      refreshCanvasRect?.();
      setViewportAnchor(gesture.clientAnchor[0], gesture.clientAnchor[1]);
      placeWorldAnchorAtClientPoint(
        gesture.worldAnchor,
        gesture.clientAnchor[0],
        gesture.clientAnchor[1],
        gesture.baseZoom,
      );
      markInteractionCanvasChanged();
    }
    onGestureEnd(e);
  };

  const trackPointer = (e: PointerEvent) => {
    lastPointer = { x: e.clientX, y: e.clientY };
    pointerInside = true;
    const contact = getPointerContact(pointerOwnershipRef.current, e.pointerId);
    if (contact && isTouchLikeContact(contact)) {
      touchPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  };
  const onPointerLeave = () => {
    pointerInside = false;
  };

  return {
    isPinchPointerInside: () => pointerInside,
    onGestureCancel,
    onGestureChange,
    onGestureEnd,
    onGestureStart,
    onPointerLeave,
    resolveGesturePoint,
    trackPointer,
  };
}
