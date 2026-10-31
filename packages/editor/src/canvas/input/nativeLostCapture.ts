/** Lost-pointer-capture handler for the native input effect (moved verbatim from the native listener effect). */

import { endInteraction, endInteractionIfKind } from '../../performance/interactionTrace';
import { endPointerContact, getPointerContact } from '../../tools/inputPolicy';
import {
  cancelRecordedCanvasPointer,
  isTouchLikeContact,
  ownsCanvasPointerInteraction,
} from './primitives';
import type { UseCanvasInputsOptions } from './types';
import type { InputSetupPhase } from './useInputSetup';
import type { InputLifecyclePhase } from './useInteractionLifecycle';

export function createLostPointerCaptureHandler(
  options: UseCanvasInputsOptions,
  setup: InputSetupPhase,
  lifecycle: InputLifecyclePhase,
): (e: PointerEvent) => void {
  const { commitCamera, setSnapGuides, stateRef, tmRef } = options;
  const { clearViewportAnchor, pointerOwnershipRef, setViewportAnchor, touchPointers } = setup;
  const {
    activeDragPointer,
    activeInteractionRecord,
    advanceNavigation,
    closePointerEditorInteraction,
    closeTouchNavigationInteraction,
    pinchGeometry,
    pinchRef,
    stopAutoPan,
    transferredPointerIds,
  } = lifecycle;

  // G6: Monitor lostpointercapture to detect pointer capture leaks.
  // When the browser implicitly releases capture (e.g. the element is
  // removed from the DOM, or the pointer is lost), this event fires.
  // We forward it as a pointercancel to the active tool so it can clean
  // up drag state — otherwise the tool may remain in a "dragging" state
  // with no matching pointerup.
  const onLostPointerCapture = (e: PointerEvent) => {
    // A tool-owned touch may be cancelled specifically to transfer it into
    // the navigation set. Releasing and reacquiring capture is part of that
    // handoff, not a terminal cancellation of the pinch.
    if (transferredPointerIds.current.delete(e.pointerId)) return;
    // BaseTool releases capture during a normal pointer-up. The browser may
    // deliver the resulting lostpointercapture event after the up handler
    // has already cleared activeDragPointer; that is an expected release,
    // not a cancellation. Only forward capture loss for a pointer that is
    // still tracked as an active drag.
    const contact = getPointerContact(pointerOwnershipRef.current, e.pointerId);
    if (!contact) return;
    if (contact.role === 'ignored' && contact.requiresFreshContact) return;
    if (contact.role === 'tool' && activeDragPointer.current?.pointerId !== e.pointerId) return;
    const tmInst = tmRef.current;
    if (activeDragPointer.current?.pointerId === e.pointerId) {
      activeDragPointer.current = null;
    }
    stopAutoPan();
    const wasPinching = pinchRef.current !== null;
    const touchLike = isTouchLikeContact(contact);
    if (touchLike) {
      touchPointers.current.delete(e.pointerId);
      if (touchPointers.current.size >= 2) {
        const nextGeo = pinchGeometry();
        if (nextGeo) {
          pinchRef.current = { lastDist: nextGeo.dist, lastCentroid: nextGeo.centroid };
          setViewportAnchor(nextGeo.centroid.x, nextGeo.centroid.y);
        }
      } else {
        pinchRef.current = null;
        if (wasPinching) endInteractionIfKind('pinch');
        clearViewportAnchor();
      }
      closeTouchNavigationInteraction();
    } else {
      clearViewportAnchor();
    }
    advanceNavigation({
      type: 'pointer-cancel',
      pointerType: touchLike ? 'touch' : e.pointerType,
      pointerCount: touchLike ? touchPointers.current.size : undefined,
    });
    if (contact.role === 'tool') {
      const record = activeInteractionRecord.current;
      if (
        record &&
        ownsCanvasPointerInteraction(record, e.pointerId, stateRef.current.activeId, tmInst)
      ) {
        cancelRecordedCanvasPointer(record, e);
        activeInteractionRecord.current = null;
      } else if (record && !record.closed && record.pointerId === e.pointerId) {
        cancelRecordedCanvasPointer(record, e);
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
    endPointerContact(pointerOwnershipRef.current, e.pointerId);
  };

  return onLostPointerCapture;
}
