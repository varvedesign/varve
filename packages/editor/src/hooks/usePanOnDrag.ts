/**
 * usePanOnDrag — drag-to-pan for a scroll container.
 *
 * A zoomed preview stage advertises a grab cursor, so dragging it has to pan.
 * The scroll container stays the single source of pan state: the hook only
 * moves `scrollLeft` / `scrollTop`, so wheel, scrollbars, arrow keys and drag
 * can never disagree about where the view is, and nothing here is mirrored in
 * React state except the transient "is dragging" flag that drives the cursor.
 *
 * `enabled` is the caller's decision about whether a drag means "pan" right
 * now (a before/after comparison, for one, spends the same gesture on moving
 * its split). A press on the container's own scrollbar is never a pan: it
 * belongs to the scrollbar.
 */
import { type PointerEvent, type RefObject, useCallback, useRef, useState } from 'react';

export interface PanOnDragHandlers {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onLostPointerCapture: () => void;
}

export interface PanOnDragResult {
  /** True between pointer-down and release; drives the grabbing cursor. */
  isPanning: boolean;
  /** Spread onto the scroll container. */
  panHandlers: PanOnDragHandlers;
}

export function usePanOnDrag(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
): PanOnDragResult {
  const startRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const el = ref.current;
      if (!enabled || !el || event.button !== 0) return;
      const rect = el.getBoundingClientRect();
      const onScrollbar =
        event.clientX - rect.left - el.clientLeft >= el.clientWidth ||
        event.clientY - rect.top - el.clientTop >= el.clientHeight;
      if (onScrollbar) return;
      startRef.current = {
        x: event.clientX,
        y: event.clientY,
        left: el.scrollLeft,
        top: el.scrollTop,
      };
      setIsPanning(true);
      // Missing in some test DOM shims; a real browser always has it.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [enabled, ref],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const start = startRef.current;
      const el = ref.current;
      if (!start || !el) return;
      el.scrollLeft = start.left - (event.clientX - start.x);
      el.scrollTop = start.top - (event.clientY - start.y);
    },
    [ref],
  );

  const end = useCallback(() => {
    startRef.current = null;
    setIsPanning(false);
  }, []);

  return {
    isPanning,
    panHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
      onLostPointerCapture: end,
    },
  };
}
