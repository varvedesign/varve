import {
  PointerSensor,
  type PointerSensorOptions,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { PointerEvent } from 'react';

/** Keep pen/mouse distance activation without claiming touch scroll gestures. */
export class DesktopPointerSensor extends PointerSensor {
  static override activators = PointerSensor.activators.map((activator) => ({
    ...activator,
    handler: (event: PointerEvent, options: PointerSensorOptions) =>
      event.nativeEvent.pointerType !== 'touch' && activator.handler(event, options),
  }));
}

export function useEditorDragSensors() {
  return useSensors(
    useSensor(DesktopPointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
}
