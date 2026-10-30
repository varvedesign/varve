/**
 * Decide whether the canvas should ignore a keydown owned by another
 * interaction or an IME composition.
 *
 * Some IMEs (Windows/IBus) report keydowns on the focused element with
 * `isComposing` false while composition continues; `keyCode === 229` is the
 * "still composing" sentinel many engines use.
 */
export function shouldSkipCanvasKeydown(e: {
  defaultPrevented?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}): boolean {
  return e.defaultPrevented === true || e.isComposing === true || e.keyCode === 229;
}

/** Return a screen-space camera delta for explicit keyboard panning. */
export function keyboardPanDelta(key: string, large = false): { dx: number; dy: number } | null {
  const step = large ? 192 : 48;
  switch (key) {
    case 'ArrowLeft':
      return { dx: step, dy: 0 };
    case 'ArrowRight':
      return { dx: -step, dy: 0 };
    case 'ArrowUp':
      return { dx: 0, dy: step };
    case 'ArrowDown':
      return { dx: 0, dy: -step };
    default:
      return null;
  }
}

/**
 * A selected guide is its own keyboard target. Defer unmodified/Shift arrows
 * only from the generic Select tool so the window-level guide controller gets
 * the event; modal tools such as Crop and Node Edit retain first priority.
 */
export function shouldDeferArrowToSelectedGuide(input: {
  key: string;
  selectedGuideId: string | null;
  activeToolId: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): boolean {
  if (
    !input.selectedGuideId ||
    input.activeToolId !== 'select' ||
    input.altKey ||
    input.ctrlKey ||
    input.metaKey
  ) {
    return false;
  }
  return (
    input.key === 'ArrowUp' ||
    input.key === 'ArrowDown' ||
    input.key === 'ArrowLeft' ||
    input.key === 'ArrowRight'
  );
}
