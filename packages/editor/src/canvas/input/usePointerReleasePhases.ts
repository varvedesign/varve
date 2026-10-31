/** Pointer release phases: pointer-up commit and pointer-cancel cleanup (original hook calls 52-53), kept adjacent so the hook order is unchanged. */

import { useCallback } from 'react';
import { dispatchToTool } from '../../performance/dispatchSpan';
import {
  endInteraction,
  endInteractionIfKind,
  markInteractionCanvasChanged,
} from '../../performance/interactionTrace';
import { endPointerContact, getPointerContact } from '../../tools/inputPolicy';
import { createTwistRotationAccumulator } from '../twistRotation';
import {
  cancelRecordedCanvasPointer,
  isTouchLikeContact,
  isTouchLikePointerType,
  ownsCanvasPointerInteraction,
} from './primitives';
import type { UseCanvasInputsOptions } from './types';
import type { InputGesturePhase } from './useGestureDispatchRuntime';
import type { InputSetupPhase } from './useInputSetup';
import type { InputLifecyclePhase } from './useInteractionLifecycle';

export function usePointerUpPhase(
  options: UseCanvasInputsOptions,
  setup: InputSetupPhase,
  lifecycle: InputLifecyclePhase,
  gesture: InputGesturePhase,
) {
  const { commitCamera, refreshCanvasRect, setSnapGuides, stateRef, tmRef } = options;
  const {
    buildToolCtx,
    clearViewportAnchor,
    pointerOwnershipRef,
    setViewportAnchor,
    touchPointers,
  } = setup;
  const {
    activeDragPointer,
    activeInteractionRecord,
    advanceNavigation,
    autoPanActive,
    closePointerEditorInteraction,
    closeTouchNavigationInteraction,
    nativeGestureRef,
    pinchGeometry,
    pinchRef,
    stopAutoPan,
    transferredPointerIds,
  } = lifecycle;
  const { dispatchAttributes } = gesture;

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const wasAutoPanning = autoPanActive.current;
      stopAutoPan();
      const pointerId = e.pointerId;
      const contact = getPointerContact(pointerOwnershipRef.current, pointerId);
      if (nativeGestureRef.current && isTouchLikePointerType(e.pointerType)) {
        if (contact) {
          endPointerContact(pointerOwnershipRef.current, pointerId);
          if (isTouchLikeContact(contact)) touchPointers.current.delete(pointerId);
        }
        closeTouchNavigationInteraction();
        return;
      }
      const wasPinching = pinchRef.current !== null;
      const touchLike = isTouchLikeContact(contact);
      if (contact?.role === 'navigation' || contact?.role === 'ignored') {
        endPointerContact(pointerOwnershipRef.current, pointerId);
        transferredPointerIds.current.delete(pointerId);
        if (touchLike) {
          touchPointers.current.delete(pointerId);
          advanceNavigation({
            type: 'pointer-up',
            pointerType: 'touch',
            pointerCount: touchPointers.current.size,
          });
        }
        if (touchPointers.current.size >= 2) {
          // A replacement/third contact changes the active pair. Rebase the
          // reference before the next move so its delta is relative to the
          // current pair rather than the released pointer's old centroid.
          const nextGeo = pinchGeometry();
          if (nextGeo) {
            // A replacement pair starts a fresh twist gesture: the atan2
            // branch cut between old and new angles would read as a spin.
            pinchRef.current = {
              lastDist: nextGeo.dist,
              lastCentroid: nextGeo.centroid,
              lastAngle: nextGeo.angle,
              twist: createTwistRotationAccumulator(),
            };
            setViewportAnchor(nextGeo.centroid.x, nextGeo.centroid.y);
          }
        } else {
          pinchRef.current = null;
          if (wasPinching) endInteractionIfKind('pinch');
          if (touchPointers.current.size === 0) clearViewportAnchor();
        }
        closeTouchNavigationInteraction();
        if (contact?.role === 'navigation' && touchPointers.current.size === 0) {
          const camera = stateRef.current;
          commitCamera({ zoom: camera.zoom, pan: camera.pan, rotation: camera.cameraRotation });
        }
        return;
      }

      if (contact?.role !== 'tool') {
        if (isTouchLikePointerType(e.pointerType)) {
          touchPointers.current.delete(pointerId);
          closeTouchNavigationInteraction();
        }
        return;
      }

      const activeRecord = activeInteractionRecord.current;
      if (
        !activeRecord ||
        !ownsCanvasPointerInteraction(
          activeRecord,
          pointerId,
          stateRef.current.activeId,
          tmRef.current,
        )
      ) {
        activeDragPointer.current = null;
        endPointerContact(pointerOwnershipRef.current, pointerId);
        if (activeRecord?.pointerId === pointerId) activeInteractionRecord.current = null;
        closePointerEditorInteraction();
        return;
      }

      if (activeDragPointer.current?.pointerId === pointerId) {
        activeDragPointer.current = null;
      }
      // Commit any layout change made during the gesture while its anchor is
      // still active. Moves no longer re-read layout, so a panel that resized
      // mid-drag would otherwise be applied after release around the viewport
      // centre and shift the artwork the pointer just placed.
      refreshCanvasRect?.();
      clearViewportAnchor();
      setSnapGuides([]);
      if (touchLike) {
        touchPointers.current.delete(e.pointerId);
        advanceNavigation({
          type: 'pointer-up',
          pointerType: 'touch',
          pointerCount: touchPointers.current.size,
        });
        if (touchPointers.current.size < 2) pinchRef.current = null;
        if (wasPinching) endInteractionIfKind('pinch');
      }
      closeTouchNavigationInteraction();
      const ne = e.nativeEvent as PointerEvent;
      const tmInst = tmRef.current;
      if (!tmInst) {
        const camera = stateRef.current;
        commitCamera({ zoom: camera.zoom, pan: camera.pan, rotation: camera.cameraRotation });
        endPointerContact(pointerOwnershipRef.current, pointerId);
        activeRecord.closed = true;
        activeInteractionRecord.current = null;
        endInteraction();
        closePointerEditorInteraction();
        return;
      }
      const upCtx = buildToolCtx(ne);
      if (wasAutoPanning) {
        // Settle the gesture against the final camera snapshot before commit.
        // A delayed frame may legally advance by the bounded 50 ms step; this
        // final sample prevents that last step from remaining as visual lag.
        dispatchToTool('move', ne, dispatchAttributes(), () => {
          tmInst.handlePointerMove(ne, upCtx);
        });
      }
      dispatchToTool('up', ne, dispatchAttributes(), () => {
        tmInst.handlePointerUp(ne, upCtx);
      });
      activeRecord.closed = true;
      activeInteractionRecord.current = null;
      markInteractionCanvasChanged();
      const camera = stateRef.current;
      commitCamera({ zoom: camera.zoom, pan: camera.pan, rotation: camera.cameraRotation });
      endPointerContact(pointerOwnershipRef.current, pointerId);
      endInteraction();
      closePointerEditorInteraction();
    },
    [
      tmRef,
      stopAutoPan,
      setSnapGuides,
      buildToolCtx,
      dispatchAttributes,
      pointerOwnershipRef,
      closePointerEditorInteraction,
      closeTouchNavigationInteraction,
      refreshCanvasRect,
      commitCamera,
      stateRef,
    ],
  );

  return { handlePointerUp };
}

export function usePointerCancelPhase(
  options: UseCanvasInputsOptions,
  setup: InputSetupPhase,
  lifecycle: InputLifecyclePhase,
) {
  const { commitCamera, setSnapGuides, stateRef, tmRef } = options;
  const {
    buildToolCtx,
    clearViewportAnchor,
    pointerOwnershipRef,
    setViewportAnchor,
    touchPointers,
  } = setup;
  const {
    activeDragPointer,
    activeInteractionRecord,
    advanceNavigation,
    closePointerEditorInteraction,
    closeTouchNavigationInteraction,
    nativeGestureRef,
    pinchGeometry,
    pinchRef,
    stopAutoPan,
    transferredPointerIds,
  } = lifecycle;

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      stopAutoPan();
      const pointerId = e.pointerId;
      const contact = getPointerContact(pointerOwnershipRef.current, pointerId);
      if (!contact) {
        if (isTouchLikePointerType(e.pointerType)) {
          touchPointers.current.delete(pointerId);
          closeTouchNavigationInteraction();
        }
        return;
      }
      transferredPointerIds.current.delete(pointerId);
      if (nativeGestureRef.current && isTouchLikePointerType(e.pointerType)) {
        endPointerContact(pointerOwnershipRef.current, pointerId);
        if (isTouchLikeContact(contact)) touchPointers.current.delete(pointerId);
        closeTouchNavigationInteraction();
        return;
      }
      if (activeDragPointer.current?.pointerId === pointerId) {
        activeDragPointer.current = null;
        clearViewportAnchor();
      }
      const wasPinching = pinchRef.current !== null;
      const touchLike = isTouchLikeContact(contact);
      if (touchLike) {
        touchPointers.current.delete(pointerId);
        if (touchPointers.current.size >= 2) {
          const nextGeo = pinchGeometry();
          if (nextGeo) {
            // Replacement pair: fresh twist gesture (see the pointerup rebase).
            pinchRef.current = {
              lastDist: nextGeo.dist,
              lastCentroid: nextGeo.centroid,
              lastAngle: nextGeo.angle,
              twist: createTwistRotationAccumulator(),
            };
            setViewportAnchor(nextGeo.centroid.x, nextGeo.centroid.y);
          }
        } else {
          pinchRef.current = null;
          if (wasPinching) endInteractionIfKind('pinch');
          if (touchPointers.current.size === 0) clearViewportAnchor();
        }
      }
      closeTouchNavigationInteraction();
      advanceNavigation({
        type: 'pointer-cancel',
        pointerType: touchLike ? 'touch' : e.pointerType,
        pointerCount: touchLike ? touchPointers.current.size : undefined,
      });
      const ne = e.nativeEvent as PointerEvent;
      if (contact.role === 'tool') {
        const record = activeInteractionRecord.current;
        if (
          record &&
          ownsCanvasPointerInteraction(record, pointerId, stateRef.current.activeId, tmRef.current)
        ) {
          cancelRecordedCanvasPointer(record, ne);
          activeInteractionRecord.current = null;
        } else if (record && !record.closed && record.pointerId === pointerId) {
          cancelRecordedCanvasPointer(record, ne);
          activeInteractionRecord.current = null;
        }
        setSnapGuides([]);
        closePointerEditorInteraction();
        endInteraction();
      }
      if (
        (contact.role === 'navigation' || contact.role === 'tool') &&
        touchPointers.current.size === 0
      ) {
        const camera = stateRef.current;
        commitCamera({ zoom: camera.zoom, pan: camera.pan, rotation: camera.cameraRotation });
      }
      endPointerContact(pointerOwnershipRef.current, pointerId);
    },
    [
      tmRef,
      stopAutoPan,
      setSnapGuides,
      buildToolCtx,
      pointerOwnershipRef,
      closePointerEditorInteraction,
      closeTouchNavigationInteraction,
      commitCamera,
      stateRef,
    ],
  );

  return { handlePointerCancel };
}
