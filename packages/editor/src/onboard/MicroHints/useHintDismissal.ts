import { useCallback, useEffect, useRef, useState } from 'react';

/** One visible lifetime; focus pauses the remaining time without restarting it. */
export function useHintDismissal(duration: number, onDismiss: () => void) {
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(duration);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissedRef = useRef(false);
  const callbackRef = useRef(onDismiss);

  useEffect(() => {
    callbackRef.current = onDismiss;
  }, [onDismiss]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    clearTimer();
    callbackRef.current();
  }, [clearTimer]);

  useEffect(() => {
    if (duration <= 0 || paused || dismissedRef.current) return;
    const startedAt = Date.now();
    timerRef.current = setTimeout(dismiss, remainingRef.current);
    return () => {
      clearTimer();
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAt));
    };
  }, [duration, paused, clearTimer, dismiss]);

  return { dismiss, pause: () => setPaused(true), resume: () => setPaused(false) };
}
