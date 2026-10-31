/** Input interaction lifecycle phase: navigation refs and helpers, open/close/cancel callbacks, and their effects (hooks 12-42). */

import { useCallback, useEffect, useRef } from 'react';
import {
  endEditorInteraction,
  resetEditorInteractions,
} from '../../performance/editorFrameRuntime';
import { endInteraction } from '../../performance/interactionTrace';
import { interactionSession } from '../../tools/InteractionContext';
import {
  endPointerContact,
  getPointerContact,
  resetPointerOwnership,
} from '../../tools/inputPolicy';
import { recordInputDiagnostic } from '../inputDiagnostics';
import type { NavigationGestureEvent, NavigationGestureState } from '../navigationState';
import { transitionNavigationState } from '../navigationState';
import { cancelCanvasFrame, createCanvasFrameKey } from '../perfRuntime';
import type { createWheelGestureClassifier } from '../wheelGesture';
import { cancelRecordedCanvasPointer } from './primitives';
import type { CanvasPointerInteractionRecord, UseCanvasInputsOptions } from './types';
import type { InputSetupPhase } from './useInputSetup';

export function useInteractionLifecycle(options: UseCanvasInputsOptions, setup: InputSetupPhase) {
  const { commitCamera, contentCanvasRef, editor, setSnapGuides, stateRef, tmRef } = options;
  const {
    buildToolCtx,
    clearViewportAnchor,
    keyboardEditorInteractionOpen,
    pointerEditorInteractionOpen,
    pointerOwnershipRef,
    touchNavigationEditorInteractionOpen,
    touchPointers,
  } = setup;

  const pressedKeyboardKeys = useRef(new Set<string>());
  // Rate limiters for the expanded interaction traces (wheel / keyboard /
  // hover bursts) so instrumentation never alters behaviour.
  const lastWheelTraceAt = useRef(0);
  const lastHoverTraceAt = useRef(0);
  const wheelTraceEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverTraceEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinchRef = useRef<{
    lastDist: number;
    lastCentroid: { x: number; y: number };
  } | null>(null);
  // Safari/WebKit gesture events can accompany Pointer Events for the same
  // fingers. Once that native stream is admitted, it owns the touch contacts
  // until gestureend so the pointer pinch path cannot apply a second zoom.
  const nativeGestureRef = useRef<{
    worldAnchor: [number, number];
    baseZoom: number;
    clientAnchor: [number, number];
  } | null>(null);
  const nativeGestureEditorInteractionOpen = useRef(false);
  const nativeFactorInteractionEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Explicit navigation-gesture state machine (see navigationState.ts). Owns
  // the viewport-level pan/pinch transitions; tools own their own drag state.
  const navigationStateRef = useRef<NavigationGestureState>('idle');
  // Deferred end for wheel bursts: the wheel interaction stays open until the
  // burst has been quiet for this long, so prefetch/thumbnail work does not
  // interleave with an active flick.
  const wheelInteractionEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelEditorInteractionOpen = useRef(false);
  const wheelInertiaActive = useRef(false);
  const cancelWheelInertiaRef = useRef<(() => void) | null>(null);
  const wheelGestureClassifierRef = useRef<ReturnType<typeof createWheelGestureClassifier> | null>(
    null,
  );

  function endWheelInteractionSoon(): void {
    if (wheelInteractionEndTimer.current !== null) {
      clearTimeout(wheelInteractionEndTimer.current);
    }
    wheelInteractionEndTimer.current = setTimeout(() => {
      wheelInteractionEndTimer.current = null;
      if (!wheelInertiaActive.current) {
        const camera = stateRef.current;
        commitCamera({ zoom: camera.zoom, pan: camera.pan, rotation: camera.cameraRotation });
      }
      if (wheelEditorInteractionOpen.current) {
        wheelEditorInteractionOpen.current = false;
        endEditorInteraction();
      }
      clearViewportAnchor();
    }, 150);
  }

  function advanceNavigation(event: NavigationGestureEvent): NavigationGestureState {
    const t = transitionNavigationState(navigationStateRef.current, event);
    navigationStateRef.current = t.next;
    return t.next;
  }

  function recordNavigationEvent(event: NavigationGestureEvent): void {
    recordInputDiagnostic({
      eventType: `nav:${event.type}`,
      source: 'unknown',
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      viewport: {
        zoom: stateRef.current.zoom,
        panX: stateRef.current.pan.x,
        panY: stateRef.current.pan.y,
        rotation: stateRef.current.cameraRotation,
      },
    });
  }

  function pinchGeometry() {
    const pts = [...touchPointers.current.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
    return {
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      centroid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }

  const autoPanFrameKey = useRef<string | null>(null);
  autoPanFrameKey.current ??= createCanvasFrameKey('auto-pan');
  const autoPanActive = useRef(false);
  const autoPanVelocity = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const autoPanFrameTime = useRef<number | null>(null);
  const activeDragPointer = useRef<PointerEvent | null>(null);
  const transferredPointerIds = useRef(new Set<number>());
  const activeInteractionRecord = useRef<CanvasPointerInteractionRecord | null>(null);
  const interactionGeneration = useRef(0);

  const stopAutoPan = useCallback(() => {
    const frameKey = autoPanFrameKey.current;
    if (frameKey) cancelCanvasFrame(frameKey);
    autoPanActive.current = false;
    autoPanVelocity.current = { x: 0, y: 0 };
    autoPanFrameTime.current = null;
  }, []);

  const closePointerEditorInteraction = useCallback(() => {
    if (!pointerEditorInteractionOpen.current) return;
    pointerEditorInteractionOpen.current = false;
    endEditorInteraction();
  }, []);

  const closeTouchNavigationInteraction = useCallback(() => {
    if (touchNavigationEditorInteractionOpen.current && touchPointers.current.size === 0) {
      touchNavigationEditorInteractionOpen.current = false;
      endEditorInteraction();
    }
  }, []);

  const closeKeyboardEditorInteraction = useCallback(() => {
    pressedKeyboardKeys.current.clear();
    if (keyboardEditorInteractionOpen.current) {
      keyboardEditorInteractionOpen.current = false;
      endEditorInteraction();
    }
  }, []);

  const cancelCanvasInteraction = useCallback(() => {
    const canvas = contentCanvasRef.current;
    const contacts = [...pointerOwnershipRef.current.contacts.keys()];
    const heldPointer = activeDragPointer.current;
    const heldContact = heldPointer
      ? getPointerContact(pointerOwnershipRef.current, heldPointer.pointerId)
      : null;

    const camera = stateRef.current;
    commitCamera({ zoom: camera.zoom, pan: camera.pan, rotation: camera.cameraRotation });
    stopAutoPan();
    cancelWheelInertiaRef.current?.();
    if (wheelInteractionEndTimer.current !== null) {
      clearTimeout(wheelInteractionEndTimer.current);
      wheelInteractionEndTimer.current = null;
    }
    if (wheelEditorInteractionOpen.current) {
      wheelEditorInteractionOpen.current = false;
      endEditorInteraction();
    }
    if (nativeFactorInteractionEndTimer.current !== null) {
      clearTimeout(nativeFactorInteractionEndTimer.current);
      nativeFactorInteractionEndTimer.current = null;
    }
    if (nativeGestureEditorInteractionOpen.current) {
      nativeGestureEditorInteractionOpen.current = false;
      endEditorInteraction();
    }

    if (heldPointer && heldContact?.role === 'tool') {
      const record = activeInteractionRecord.current;
      if (record && !record.closed && record.pointerId === heldPointer.pointerId) {
        cancelRecordedCanvasPointer(record, heldPointer);
      } else {
        tmRef.current?.handlePointerCancel(heldPointer, buildToolCtx(heldPointer));
      }
    }
    for (const pointerId of contacts) {
      try {
        if (canvas?.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
      } catch {
        // Capture may already have been released by the tool's cancel hook.
      }
    }

    activeDragPointer.current = null;
    activeInteractionRecord.current = null;
    touchPointers.current.clear();
    pinchRef.current = null;
    nativeGestureRef.current = null;
    transferredPointerIds.current.clear();
    resetPointerOwnership(pointerOwnershipRef.current);
    wheelEditorInteractionOpen.current = false;
    clearViewportAnchor();
    advanceNavigation({ type: 'reset' });
    setSnapGuides([]);
    closePointerEditorInteraction();
    closeTouchNavigationInteraction();
    closeKeyboardEditorInteraction();
    resetEditorInteractions();
    if (hoverTraceEndTimer.current !== null) {
      clearTimeout(hoverTraceEndTimer.current);
      hoverTraceEndTimer.current = null;
    }
    endInteraction();
    tmRef.current?.resetModifiers();
    interactionSession.reset();
    const cancelEvent = heldPointer ?? ({ pointerType: 'mouse', pressure: 0 } as PointerEvent);
    const ctx = buildToolCtx(cancelEvent);
    tmRef.current?.handleFocusLoss(ctx);
    if (tmRef.current?.springActive) tmRef.current.releaseSpring(ctx);
  }, [
    contentCanvasRef,
    stateRef,
    commitCamera,
    stopAutoPan,
    tmRef,
    buildToolCtx,
    pointerOwnershipRef,
    setSnapGuides,
    closePointerEditorInteraction,
    closeTouchNavigationInteraction,
    closeKeyboardEditorInteraction,
  ]);

  const interactionSessionId = stateRef.current.activeId;
  useEffect(
    () =>
      editor.registerCanvasInteractionCancellation(interactionSessionId, cancelCanvasInteraction),
    [editor.registerCanvasInteractionCancellation, interactionSessionId, cancelCanvasInteraction],
  );
  useEffect(() => () => cancelCanvasInteraction(), [cancelCanvasInteraction]);
  useEffect(() => {
    const endSuppressedContact = (event: PointerEvent) => {
      const contact = getPointerContact(pointerOwnershipRef.current, event.pointerId);
      if (contact?.role !== 'ignored' || !contact.requiresFreshContact) return;
      touchPointers.current.delete(event.pointerId);
      transferredPointerIds.current.delete(event.pointerId);
      endPointerContact(pointerOwnershipRef.current, event.pointerId);
      closeTouchNavigationInteraction();
      if (touchPointers.current.size === 0) {
        pinchRef.current = null;
        clearViewportAnchor();
      }
    };
    document.addEventListener('pointerup', endSuppressedContact, true);
    document.addEventListener('pointercancel', endSuppressedContact, true);
    return () => {
      document.removeEventListener('pointerup', endSuppressedContact, true);
      document.removeEventListener('pointercancel', endSuppressedContact, true);
    };
  }, [pointerOwnershipRef, closeTouchNavigationInteraction]);

  return {
    activeDragPointer,
    activeInteractionRecord,
    advanceNavigation,
    autoPanActive,
    autoPanFrameKey,
    autoPanFrameTime,
    autoPanVelocity,
    cancelCanvasInteraction,
    cancelWheelInertiaRef,
    closeKeyboardEditorInteraction,
    closePointerEditorInteraction,
    closeTouchNavigationInteraction,
    endWheelInteractionSoon,
    hoverTraceEndTimer,
    interactionGeneration,
    lastHoverTraceAt,
    lastWheelTraceAt,
    nativeFactorInteractionEndTimer,
    nativeGestureEditorInteractionOpen,
    nativeGestureRef,
    pinchGeometry,
    pinchRef,
    pressedKeyboardKeys,
    recordNavigationEvent,
    stopAutoPan,
    transferredPointerIds,
    wheelEditorInteractionOpen,
    wheelGestureClassifierRef,
    wheelInertiaActive,
    wheelTraceEndTimer,
  };
}

export type InputLifecyclePhase = ReturnType<typeof useInteractionLifecycle>;
