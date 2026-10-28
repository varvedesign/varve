// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { usePanOnDrag } from './usePanOnDrag';

/** jsdom has no layout: give the stage real scroll state and a 400x300 box. */
function Stage({ enabled }: { enabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { isPanning, panHandlers } = usePanOnDrag(ref, enabled);
  return (
    <div
      ref={(el) => {
        ref.current = el;
        if (!el || (el as HTMLElement & { __ready?: boolean }).__ready) return;
        (el as HTMLElement & { __ready?: boolean }).__ready = true;
        let left = 100;
        let top = 100;
        Object.defineProperties(el, {
          clientWidth: { value: 400 },
          clientHeight: { value: 300 },
          clientLeft: { value: 0 },
          clientTop: { value: 0 },
          scrollLeft: { get: () => left, set: (v: number) => (left = v) },
          scrollTop: { get: () => top, set: (v: number) => (top = v) },
        });
        el.getBoundingClientRect = () =>
          ({ left: 0, top: 0, right: 420, bottom: 320, width: 420, height: 320 }) as DOMRect;
      }}
      data-testid="stage"
      data-panning={isPanning}
      {...panHandlers}
    />
  );
}

const down = (el: HTMLElement, x: number, y: number) =>
  fireEvent.pointerDown(el, { clientX: x, clientY: y, button: 0, pointerId: 1 });
const move = (el: HTMLElement, x: number, y: number) =>
  fireEvent.pointerMove(el, { clientX: x, clientY: y, pointerId: 1 });

describe('usePanOnDrag', () => {
  it('scrolls opposite to the pointer, so the content follows the hand', () => {
    render(<Stage enabled />);
    const stage = screen.getByTestId('stage');
    down(stage, 200, 150);
    expect(stage).toHaveAttribute('data-panning', 'true');
    move(stage, 170, 110);
    expect(stage.scrollLeft).toBe(130);
    expect(stage.scrollTop).toBe(140);
  });

  it('stops following the pointer once released', () => {
    render(<Stage enabled />);
    const stage = screen.getByTestId('stage');
    down(stage, 200, 150);
    move(stage, 190, 150);
    fireEvent.pointerUp(stage, { pointerId: 1 });
    expect(stage).toHaveAttribute('data-panning', 'false');
    move(stage, 100, 150);
    expect(stage.scrollLeft).toBe(110);
  });

  it('does nothing while disabled, so a comparison keeps the drag for its split', () => {
    render(<Stage enabled={false} />);
    const stage = screen.getByTestId('stage');
    down(stage, 200, 150);
    move(stage, 100, 50);
    expect(stage).toHaveAttribute('data-panning', 'false');
    expect(stage.scrollLeft).toBe(100);
    expect(stage.scrollTop).toBe(100);
  });

  it('leaves a press on the scrollbar to the scrollbar', () => {
    render(<Stage enabled />);
    const stage = screen.getByTestId('stage');
    // x = 410 is past clientWidth (400): the vertical scrollbar track.
    down(stage, 410, 150);
    move(stage, 410, 50);
    expect(stage).toHaveAttribute('data-panning', 'false');
    expect(stage.scrollTop).toBe(100);
  });
});
