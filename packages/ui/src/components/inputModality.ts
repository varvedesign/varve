/**
 * The input modality the user is driving the interface with right now.
 *
 * `:focus-visible` alone is the wrong signal for surfaces that move focus on
 * their own: a menu focuses one of its rows when it opens and as the pointer
 * moves, and the browser decides whether that programmatic focus is "visible"
 * from history. After any keyboard shortcut, a menu opened by right-click drew
 * the keyboard ring and fill on whichever row sat under the pointer (shell
 * audit 2026-10-22, F-46). Surfaces read this when they open and then follow
 * their own events.
 */
export type InputModality = 'pointer' | 'keyboard';

let current: InputModality = 'pointer';
const tracked = new WeakSet<Window>();

/** Start tracking in a window (idempotent). */
export function trackInputModality(ownerWindow: Window): void {
  if (tracked.has(ownerWindow)) return;
  tracked.add(ownerWindow);
  const options = { capture: true, passive: true } as const;
  ownerWindow.addEventListener(
    'keydown',
    () => {
      current = 'keyboard';
    },
    options,
  );
  ownerWindow.addEventListener(
    'pointerdown',
    () => {
      current = 'pointer';
    },
    options,
  );
}

export function lastInputModality(): InputModality {
  return current;
}
