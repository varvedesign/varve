import { CloseButton } from '@varve/ui';
import { useCallback, useEffect, useState } from 'react';
import type { MicroHint as MicroHintData } from './microHintsData';
import './MicroHint.css';

interface MicroHintProps {
  hint: MicroHintData;
  onDismiss: () => void;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Lightweight contextual micro-hint that appears near the toolbar
 * when the user first uses a tool. Auto-dismisses after a short delay.
 */
export function MicroHint({ hint, onDismiss }: MicroHintProps) {
  const [exiting, setExiting] = useState(false);
  const noAnimation = prefersReducedMotion();

  useEffect(() => {
    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(onDismiss, 200);
    }, hint.duration || 5000);

    return () => clearTimeout(timer);
  }, [hint.id, hint.duration, onDismiss]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setExiting(true);
        setTimeout(onDismiss, 200);
      }
    },
    [onDismiss],
  );

  return (
    <div
      className={`micro-hint${exiting ? ' micro-hint--exiting' : ''}${noAnimation ? ' micro-hint--no-animation' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={`${hint.title}: ${hint.body}`}
      onKeyDown={handleKeyDown}
    >
      <span className="micro-hint__title">
        {hint.title}
        {hint.shortcut && <kbd className="micro-hint__shortcut">{hint.shortcut}</kbd>}
      </span>
      <span className="micro-hint__body">{hint.body}</span>
      {/* The hint surface is pointer-transparent so it never captures a canvas
       * gesture; only the dismiss control opts back in (see .micro-hint__dismiss).
       * CloseButton is the documented dismiss primitive — the hand-rolled button
       * this replaces drew a literal "x" character in a 13x13 box, under the
       * WCAG 2.2 2.5.8 target floor, and bypassed the shared focus/hover states. */}
      <CloseButton
        size="sm"
        label="Dismiss hint"
        className="micro-hint__dismiss"
        onClick={() => {
          setExiting(true);
          setTimeout(onDismiss, 200);
        }}
      />
    </div>
  );
}
