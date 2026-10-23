/**
 * The canvas-wide focus ring.
 *
 * The inner <canvas tabIndex=0> takes keyboard focus, but the ring is drawn
 * around the whole canvas section (`[data-canvas-focus-visible]`, editor.css).
 * Deciding it from `:focus-visible` alone over-reported: the browser treats
 * any focus that follows a keypress as keyboard focus, so pressing a tool
 * shortcut (R, T, ...) and then drawing with the mouse framed the entire
 * canvas in the accent (shell audit 2026-10-21, F-08). The ring now needs
 * focus to have arrived by sequential navigation (Tab / Shift+Tab), and a
 * pointer press inside the canvas clears it.
 */
import { type FocusEvent, type RefObject, useCallback, useEffect, useRef } from 'react';

const RING_ATTRIBUTE = 'data-canvas-focus-visible';

/** A focus change this soon after a Tab press is the result of that press. */
const NAVIGATION_WINDOW_MS = 500;

function canvasSection(canvas: HTMLCanvasElement | null): HTMLElement | null {
  return canvas?.closest<HTMLElement>('.editor-canvas') ?? null;
}

export function useCanvasFocusRing(canvasRef: RefObject<HTMLCanvasElement | null>) {
  // Read by the input pipeline: canvas shortcuts only act while it is true.
  const canvasFocusedRef = useRef(false);
  const lastTabAt = useRef(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') lastTabAt.current = event.timeStamp;
    };
    const onPointerDown = (event: PointerEvent) => {
      const section = canvasSection(canvasRef.current);
      if (section && event.target instanceof Node && section.contains(event.target)) {
        section.removeAttribute(RING_ATTRIBUTE);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [canvasRef]);

  const handleCanvasFocus = useCallback(
    (event: FocusEvent<HTMLCanvasElement>) => {
      canvasFocusedRef.current = true;
      const section = canvasSection(canvasRef.current);
      if (section && event.timeStamp - lastTabAt.current < NAVIGATION_WINDOW_MS) {
        section.setAttribute(RING_ATTRIBUTE, 'true');
      }
    },
    [canvasRef],
  );

  const handleCanvasBlur = useCallback(() => {
    canvasFocusedRef.current = false;
    canvasSection(canvasRef.current)?.removeAttribute(RING_ATTRIBUTE);
  }, [canvasRef]);

  return { canvasFocusedRef, handleCanvasFocus, handleCanvasBlur };
}
