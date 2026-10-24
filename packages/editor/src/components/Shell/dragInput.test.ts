import { describe, expect, it } from 'vitest';
import { dragClientPoint } from './dragInput';
import { DesktopPointerSensor } from './dragSensors';

describe('drag input coordinates', () => {
  it('uses mouse/pen client coordinates', () => {
    expect(dragClientPoint(new MouseEvent('pointermove', { clientX: 42, clientY: 75 }))).toEqual({
      x: 42,
      y: 75,
    });
  });

  it('uses a live touch and the final lifted touch', () => {
    const move = new Event('touchmove');
    Object.assign(move, { touches: [{ clientX: 100, clientY: 250 }], changedTouches: [] });
    expect(dragClientPoint(move)).toEqual({ x: 100, y: 250 });
    const end = new Event('touchend');
    Object.assign(end, { touches: [], changedTouches: [{ clientX: 125, clientY: 300 }] });
    expect(dragClientPoint(end)).toEqual({ x: 125, y: 300 });
  });

  it('does not invent coordinates for keyboard events', () => {
    expect(dragClientPoint(new KeyboardEvent('keydown'))).toBeNull();
  });
});

describe('scroll-safe drag activation', () => {
  it.each(['mouse', 'pen'])('retains primary %s input', (pointerType) => {
    const event = { nativeEvent: { pointerType, isPrimary: true, button: 0 } };
    const activator = DesktopPointerSensor.activators[0]!;
    expect(activator.handler(event as Parameters<typeof activator.handler>[0], {})).toBe(true);
  });

  it('leaves touch to the delayed touch sensor', () => {
    const activator = DesktopPointerSensor.activators[0]!;
    const event = { nativeEvent: { pointerType: 'touch', isPrimary: true, button: 0 } };
    expect(activator.handler(event as Parameters<typeof activator.handler>[0], {})).toBe(false);
  });
});
