import { CloseButton } from '@varve/ui';
import type { MicroHint as MicroHintData } from './microHintsData';
import { useHintDismissal } from './useHintDismissal';
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
  return <VisibleMicroHint key={`${hint.id}:${hint.duration}`} hint={hint} onDismiss={onDismiss} />;
}

function VisibleMicroHint({ hint, onDismiss }: MicroHintProps) {
  const { dismiss, pause, resume } = useHintDismissal(hint.duration, onDismiss);
  const noAnimation = prefersReducedMotion();

  return (
    <div
      className={`micro-hint${noAnimation ? ' micro-hint--no-animation' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={`${hint.title}: ${hint.body}`}
      onFocusCapture={pause}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) resume();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }}
    >
      <div className="micro-hint__header">
        <span className="micro-hint__title">
          {hint.title}
          {hint.shortcut && <kbd className="micro-hint__shortcut">{hint.shortcut}</kbd>}
        </span>
        {/* Only this shared dismiss control receives pointer input; the rest of
         * the hint lets drawing gestures pass through to the canvas. Native
         * button activation owns Enter/Space. Dismissal has no delayed callback. */}
        <CloseButton
          size="sm"
          label="Dismiss hint"
          className="micro-hint__dismiss"
          onClick={dismiss}
        />
      </div>
      <span className="micro-hint__body">{hint.body}</span>
    </div>
  );
}
