/** Pointer-down phase: admission, ownership transfer, snap session reset, and the single tool dispatch (original hook call 50). */

import { useCallback } from 'react';
import { dispatchToTool, documentComplexityBucket } from '../../performance/dispatchSpan';
import { beginEditorInteraction } from '../../performance/editorFrameRuntime';
import {
  beginInteraction,
  endInteraction,
  endInteractionIfKind,
  isInteractionTracingEnabled,
  markInteractionCanvasChanged,
} from '../../performance/interactionTrace';
import { refreshDrawingInputSettings } from '../../tools/drawingInputRuntime';
import { observeInputCapabilities } from '../../tools/inputNormalizer';
import { beginPointerContact, endPointerContact, getPointerContact } from '../../tools/inputPolicy';
import { createSnapSession } from '../../tools/snapping';
import { createTwistRotationAccumulator } from '../twistRotation';
import {
  cancelRecordedCanvasPointer,
  isTouchLikeContact,
  isTouchLikePointerType,
  snapshotHeldPointer,
} from './primitives';
import type { UseCanvasInputsOptions } from './types';
import type { InputGesturePhase } from './useGestureDispatchRuntime';
import type { InputSetupPhase } from './useInputSetup';
import type { InputLifecyclePhase } from './useInteractionLifecycle';

export function usePointerDownPhase(
  options: UseCanvasInputsOptions,
  setup: InputSetupPhase,
  lifecycle: InputLifecyclePhase,
  gesture: InputGesturePhase,
) {
  const { refreshCanvasRect, setSnapGuides, stateRef, tmRef } = options;
  const {
    buildToolCtx,
    clearMiddleButtonPasteGuard,
    clearViewportAnchor,
    middleButtonPasteGuardRef,
    middleButtonPasteGuardTimerRef,
    pointerEditorInteractionOpen,
    pointerOwnershipRef,
    setViewportAnchor,
    touchNavigationEditorInteractionOpen,
    touchPointers,
  } = setup;
  const {
    activeDragPointer,
    activeInteractionRecord,
    advanceNavigation,
    cancelWheelInertiaRef,
    closePointerEditorInteraction,
    closeTouchNavigationInteraction,
    interactionGeneration,
    nativeGestureRef,
    pinchGeometry,
    pinchRef,
    recordNavigationEvent,
    stopAutoPan,
    transferredPointerIds,
  } = lifecycle;
  const { dispatchAttributes, gestureComplexity, snapIndexForPointer, snapSessionForPointer } =
    gesture;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const ne = e.nativeEvent as PointerEvent;
      if (nativeGestureRef.current && isTouchLikePointerType(e.pointerType)) {
        e.preventDefault();
        return;
      }
      if (e.pointerType === 'pen') observeInputCapabilities(ne);
      // Refresh before registering this event as an active anchor. A canvas
      // may have moved since the observer's last frame; the new pointerdown
      // is not an in-progress gesture that should rebase the camera around a
      // stale client position.
      refreshCanvasRect?.();
      setViewportAnchor(e.clientX, e.clientY);
      const tmInst = tmRef.current;
      if (!tmInst) {
        clearViewportAnchor();
        return;
      }
      if (e.pointerType === 'mouse' && e.button === 1) {
        if (middleButtonPasteGuardTimerRef.current !== null) {
          clearTimeout(middleButtonPasteGuardTimerRef.current);
          middleButtonPasteGuardTimerRef.current = null;
        }
        middleButtonPasteGuardRef.current = true;
        // Recover if the platform drops pointerup/auxclick (for example when
        // the window loses focus during the gesture).
        middleButtonPasteGuardTimerRef.current = setTimeout(clearMiddleButtonPasteGuard, 5000);
      } else {
        clearMiddleButtonPasteGuard();
      }
      const drawingInput = refreshDrawingInputSettings();
      cancelWheelInertiaRef.current?.();
      const decision = beginPointerContact(
        pointerOwnershipRef.current,
        {
          pointerId: e.pointerId,
          pointerType: e.pointerType,
          clientX: e.clientX,
          clientY: e.clientY,
        },
        drawingInput.fingerMode,
      );

      if (decision.suppressedPointerIds.length > 0) {
        for (const suppressedId of decision.suppressedPointerIds) {
          touchPointers.current.delete(suppressedId);
        }
        if (pinchRef.current) endInteractionIfKind('pinch');
        pinchRef.current = null;
        if (touchPointers.current.size === 0) {
          clearViewportAnchor();
          closeTouchNavigationInteraction();
        }
        advanceNavigation({ type: 'reset' });
      }

      const contactToCancel =
        decision.cancelPointerId === null
          ? null
          : getPointerContact(pointerOwnershipRef.current, decision.cancelPointerId);
      const transferringTouchToNavigation = contactToCancel?.role === 'navigation';
      if (transferringTouchToNavigation && decision.cancelPointerId !== null) {
        transferredPointerIds.current.add(decision.cancelPointerId);
      }

      e.currentTarget.focus({ preventScroll: true });

      if (decision.cancelPointerId !== null) {
        const owner = activeDragPointer.current;
        const previousContact = getPointerContact(
          pointerOwnershipRef.current,
          decision.cancelPointerId,
        );
        const cancelEvent =
          owner?.pointerId === decision.cancelPointerId
            ? owner
            : ({
                pointerId: decision.cancelPointerId,
                pointerType: previousContact?.pointerType ?? 'unknown',
                clientX: e.clientX,
                clientY: e.clientY,
                button: -1,
                buttons: 0,
                pressure: 0,
              } as PointerEvent);
        const record = activeInteractionRecord.current;
        if (record && !record.closed && record.pointerId === decision.cancelPointerId) {
          cancelRecordedCanvasPointer(record, cancelEvent);
          activeInteractionRecord.current = null;
        } else {
          tmInst.handlePointerCancel(cancelEvent, buildToolCtx(cancelEvent));
        }
        if (transferringTouchToNavigation) {
          try {
            e.currentTarget.setPointerCapture(decision.cancelPointerId);
          } catch {
            // Capture transfer is best-effort in limited WebViews.
          }
        }
        activeDragPointer.current = null;
        stopAutoPan();
        setSnapGuides([]);
        closePointerEditorInteraction();
      }

      const contact = getPointerContact(pointerOwnershipRef.current, e.pointerId);
      const touchLike = isTouchLikeContact(contact);
      if (touchLike && decision.role !== 'ignored') {
        touchPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (decision.role === 'navigation' && !touchNavigationEditorInteractionOpen.current) {
          beginEditorInteraction();
          touchNavigationEditorInteractionOpen.current = true;
        }
        advanceNavigation({
          type: 'pointer-down',
          pointerType: 'touch',
          pointerCount: touchPointers.current.size,
        });
        recordNavigationEvent({
          type: 'pointer-down',
          pointerType: 'touch',
          pointerCount: touchPointers.current.size,
        });
        if (touchPointers.current.size >= 2) {
          const startedPinch = pinchRef.current === null;
          const geo = pinchGeometry();
          if (geo) {
            pinchRef.current = {
              lastDist: geo.dist,
              lastCentroid: geo.centroid,
              lastAngle: geo.angle,
              twist: createTwistRotationAccumulator(),
            };
            setViewportAnchor(geo.centroid.x, geo.centroid.y);
          }
          if (startedPinch && isInteractionTracingEnabled())
            beginInteraction('pinch', ne.timeStamp);
        }
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Pointer capture is optional for synthetic/limited WebViews.
        }
      }

      if (decision.role === 'navigation') {
        e.preventDefault();
        return;
      }

      if (decision.role === 'ignored') {
        e.preventDefault();
        return;
      }

      const ctx = buildToolCtx(ne);
      if (e.button === 1) e.preventDefault();

      // B6: Intercept mouse side buttons (back=3, forward=4) to prevent
      // browser navigation while the canvas owns the interaction.
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        endPointerContact(pointerOwnershipRef.current, e.pointerId);
        endInteraction();
        return;
      }

      gestureComplexity.current = isInteractionTracingEnabled()
        ? documentComplexityBucket(Object.keys(stateRef.current.document.nodes).length)
        : 'unknown';
      if (isInteractionTracingEnabled()) beginInteraction('pointer-drag', ne.timeStamp);
      activeDragPointer.current = snapshotHeldPointer(ne);
      activeInteractionRecord.current = {
        pointerId: ne.pointerId,
        toolManager: tmInst,
        toolInstance: tmInst.activeTool,
        sessionId: stateRef.current.activeId,
        generation: ++interactionGeneration.current,
        originalContext: ctx,
        isMiddlePan: e.button === 1 && tmInst.activeToolId !== 'hand',
        closed: false,
      };
      snapSessionForPointer.current = createSnapSession();
      snapIndexForPointer.current = null;
      beginEditorInteraction();
      pointerEditorInteractionOpen.current = true;
      dispatchToTool('down', ne, dispatchAttributes(), () => {
        tmInst.handlePointerDown(ne, ctx);
      });
      const record = activeInteractionRecord.current;
      if (record?.pointerId === ne.pointerId && e.button === 1 && tmInst.activeToolId !== 'hand') {
        record.toolInstance = tmInst.getTool('hand') ?? tmInst.activeTool;
      }
      markInteractionCanvasChanged();
    },
    [
      tmRef,
      buildToolCtx,
      refreshCanvasRect,
      snapSessionForPointer,
      snapIndexForPointer,
      stateRef,
      dispatchAttributes,
      stopAutoPan,
      setSnapGuides,
      closePointerEditorInteraction,
      clearMiddleButtonPasteGuard,
    ],
  );

  return { handlePointerDown };
}
