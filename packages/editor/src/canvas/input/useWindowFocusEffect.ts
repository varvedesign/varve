/** Window blur / page-hidden cancellation effect (original hook call 62). */

import { useEffect } from 'react';
import type { InputLifecyclePhase } from './useInteractionLifecycle';

export function useWindowFocusEffect(lifecycle: InputLifecyclePhase) {
  const { cancelCanvasInteraction } = lifecycle;

  // B4 + G7: Reset modifier state and cancel active interactions when the
  // window loses focus or the page becomes hidden. Without this, a key
  // release that occurs outside the window (e.g. alt-tab while holding
  // Ctrl/Shift) leaves the modifier state stuck, and a drag started before
  // tab-switching can remain active indefinitely.
  useEffect(() => {
    function onWindowBlur() {
      cancelCanvasInteraction();
    }
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') cancelCanvasInteraction();
    }
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [cancelCanvasInteraction]);
}
