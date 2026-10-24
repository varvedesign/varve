import { useCallback, useEffect, useRef, useState } from 'react';
import type { InspectorTab } from '../../context/types';

/** A deliberate panel handoff waits for its visible, non-modal destination. */
export function useInspectorFocus(activeTab: InspectorTab) {
  const inspectorRef = useRef<HTMLElement | null>(null);
  const [pending, setPending] = useState<{ tab: InspectorTab } | null>(null);
  const requestFocus = useCallback((tab: InspectorTab, focus = false) => {
    setPending(focus ? { tab } : null);
  }, []);

  useEffect(() => {
    if (!pending || pending.tab !== activeTab) return;
    const ownerDocument = inspectorRef.current?.ownerDocument;
    const ownerWindow = ownerDocument?.defaultView;
    if (!ownerDocument || !ownerWindow) return;
    let frame = 0;
    let attempts = 0;
    let cancelled = false;

    const cancel = () => {
      cancelled = true;
      ownerWindow.cancelAnimationFrame(frame);
      setPending(null);
    };
    const focusWhenReady = () => {
      if (cancelled) return;
      const target = inspectorRef.current?.querySelector<HTMLElement>(`#insp-tab-${pending.tab}`);
      // Native dialogs make the destination inert until close() completes.
      // Trying focus only once in the request callback loses that handoff.
      // checkVisibility is absent in jsdom and older engines; presence in the
      // mounted panel is the fallback signal there.
      const visible =
        !!target &&
        (typeof target.checkVisibility === 'function' ? target.checkVisibility() : true);
      if (visible && !ownerDocument.querySelector('dialog[open]')) {
        target.focus({ preventScroll: true });
        if (ownerDocument.activeElement === target) {
          setPending(null);
          return;
        }
      }
      attempts += 1;
      if (attempts >= 30) {
        setPending(null);
        return;
      }
      frame = ownerWindow.requestAnimationFrame(focusWhenReady);
    };

    // A later user action supersedes the pending handoff. Never chase focus
    // after they have started interacting elsewhere while a panel mounts.
    ownerDocument.addEventListener('pointerdown', cancel, true);
    ownerDocument.addEventListener('keydown', cancel, true);
    frame = ownerWindow.requestAnimationFrame(focusWhenReady);
    return () => {
      cancelled = true;
      ownerWindow.cancelAnimationFrame(frame);
      ownerDocument.removeEventListener('pointerdown', cancel, true);
      ownerDocument.removeEventListener('keydown', cancel, true);
    };
  }, [activeTab, pending]);

  return { inspectorRef, requestFocus };
}
