/** Pointer ownership, touch classification, hover, and clipboard-suppression primitives (moved verbatim from canvas/inputPipeline.ts). */

import type { ToolManager } from '../../tools';
import type { CanvasPointerInteractionRecord } from './types';

const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'reset',
  'submit',
]);

/** Preserve native clipboard actions in editable controls during the brief
 * suppression window for a browser-generated middle-click PRIMARY paste. */
export function shouldSuppressMiddleButtonPaste(guardActive: boolean, target: EventTarget | null) {
  if (!guardActive) return false;
  if (typeof HTMLElement !== 'undefined' && target instanceof HTMLElement) {
    if (target instanceof HTMLTextAreaElement) return target.disabled || target.readOnly;
    if (target instanceof HTMLInputElement) {
      return (
        target.disabled || target.readOnly || NON_TEXT_INPUT_TYPES.has(target.type.toLowerCase())
      );
    }
    // Walk explicit attributes so this also works in DOM test environments
    // that do not implement inherited `isContentEditable`.
    for (let ancestor: HTMLElement | null = target; ancestor; ancestor = ancestor.parentElement) {
      const value = ancestor.getAttribute('contenteditable')?.trim().toLowerCase();
      if (value === 'false') return true;
      if (value === '' || value === 'true' || value === 'plaintext-only') return false;
    }
    if (target.isContentEditable) return false;
  }
  return true;
}

function ownsCanvasPointerInteraction(
  record: CanvasPointerInteractionRecord | null,
  pointerId: number,
  sessionId: string,
  manager: ToolManager | null,
): boolean {
  return Boolean(
    record &&
      !record.closed &&
      record.pointerId === pointerId &&
      record.sessionId === sessionId &&
      record.toolManager === manager &&
      (record.isMiddlePan || record.toolManager.activeTool === record.toolInstance),
  );
}

function cancelRecordedCanvasPointer(
  record: CanvasPointerInteractionRecord,
  event: PointerEvent,
): void {
  if (record.closed) return;
  record.closed = true;
  if (record.isMiddlePan || record.toolManager.activeTool === record.toolInstance) {
    record.toolManager.handlePointerCancel(event, record.originalContext);
  } else {
    record.toolInstance.onPointerCancel?.(event, record.originalContext);
  }
}

/** Hover hit testing is informational and must never tax an active drag. */
export function shouldResolveHover(tool: string, buttons: number): boolean {
  // Knife joins select/inspect: it is the one drawing tool whose outcome
  // depends on which object is under the pointer, so it needs the hover hit to
  // show what it is about to cut and whether that object can be cut at all.
  return buttons === 0 && (tool === 'select' || tool === 'inspect' || tool === 'knife');
}

/**
 * Retain the scalar pointer state needed by an animation-frame continuation.
 * Keeping a browser event object beyond its dispatch callback is not portable:
 * some WebViews clear native-event accessors after React returns.
 */
function snapshotHeldPointer(ev: PointerEvent): PointerEvent {
  return new PointerEvent('pointermove', {
    pointerId: ev.pointerId,
    width: ev.width,
    height: ev.height,
    pressure: ev.pressure,
    tangentialPressure: ev.tangentialPressure,
    tiltX: ev.tiltX,
    tiltY: ev.tiltY,
    twist: ev.twist,
    pointerType: ev.pointerType,
    isPrimary: ev.isPrimary,
    clientX: ev.clientX,
    clientY: ev.clientY,
    button: ev.button,
    buttons: ev.buttons,
    ctrlKey: ev.ctrlKey,
    shiftKey: ev.shiftKey,
    altKey: ev.altKey,
    metaKey: ev.metaKey,
  });
}

function isTouchLikePointerType(pointerType: string): boolean {
  return pointerType === 'touch' || pointerType === 'unknown' || pointerType === '';
}

function isTouchLikeContact(contact: { pointerType: string } | null | undefined): boolean {
  return contact ? isTouchLikePointerType(contact.pointerType) : false;
}

export {
  cancelRecordedCanvasPointer,
  isTouchLikeContact,
  isTouchLikePointerType,
  NON_TEXT_INPUT_TYPES,
  ownsCanvasPointerInteraction,
  snapshotHeldPointer,
};
