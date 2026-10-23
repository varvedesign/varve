import { cleanup, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useCanvasFocusRing } from './canvasFocusRing';

function Harness() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { handleCanvasFocus, handleCanvasBlur } = useCanvasFocusRing(canvasRef);
  return (
    <section className="editor-canvas" data-testid="section">
      <button type="button">Before</button>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        data-testid="canvas"
        onFocus={handleCanvasFocus}
        onBlur={handleCanvasBlur}
      />
    </section>
  );
}

afterEach(cleanup);

const ring = (section: HTMLElement) => section.getAttribute('data-canvas-focus-visible');

describe('useCanvasFocusRing', () => {
  it('shows the ring when focus arrives by Tab', () => {
    const { getByTestId } = render(<Harness />);
    fireEvent.keyDown(window, { key: 'Tab' });
    getByTestId('canvas').focus();
    expect(ring(getByTestId('section'))).toBe('true');
  });

  it('does not show it when a tool shortcut moves focus to the canvas', () => {
    // F-08: pressing R and then drawing framed the whole canvas.
    const { getByTestId } = render(<Harness />);
    fireEvent.keyDown(window, { key: 'r' });
    getByTestId('canvas').focus();
    expect(ring(getByTestId('section'))).toBeNull();
  });

  it('clears it on a pointer press inside the canvas, and on blur', () => {
    const { getByTestId, getByText } = render(<Harness />);
    fireEvent.keyDown(window, { key: 'Tab' });
    getByTestId('canvas').focus();
    fireEvent.pointerDown(getByTestId('canvas'));
    expect(ring(getByTestId('section'))).toBeNull();

    fireEvent.keyDown(window, { key: 'Tab' });
    getByText('Before').focus();
    getByTestId('canvas').focus();
    expect(ring(getByTestId('section'))).toBe('true');
    getByText('Before').focus();
    expect(ring(getByTestId('section'))).toBeNull();
  });
});
