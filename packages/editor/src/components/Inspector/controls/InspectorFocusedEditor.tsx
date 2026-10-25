/**
 * InspectorFocusedEditor — an anchored, focused editor for dense property
 * details such as effect parameters. The owning row stays in the inspector;
 * the editor is portaled beside it so the rail remains scannable.
 *
 * This is a **non-modal dialog**, not a popover: the canvas, the layers panel,
 * and the rest of the Inspector stay operable while it is open. It previously
 * wrapped its content in `FocusTrap`, which contradicted the declared
 * `aria-modal="false"` by catching Tab and cycling focus inside the surface —
 * a keyboard user could not reach the owning row, the panel, or anything else
 * without pressing Escape first. It now follows the APG non-modal dialog
 * contract:
 *
 * - focus enters the surface when it opens, so keyboard activation is
 *   operable and the surface is never stranded outside the tab order of a
 *   portal that sits at the end of `<body>`;
 * - focus is never trapped — Tab past the last control closes the editor and
 *   continues after the anchor (`yieldTabToAnchor`);
 * - Escape and light dismissal close it;
 * - dismissal returns focus to the owning row unless focus already reached a
 *   deliberate destination.
 */
import { CloseButton, FloatingPortal, type OverlayCloseReason } from '@varve/ui';
import { type ReactNode, type RefObject, useEffect, useRef } from 'react';

/**
 * Stable array identity: an inline literal would change on every parent
 * render and restart the portal's placement effect, resetting the surface to
 * `visibility: hidden` for a frame (observed as a flapping/hidden popover on
 * every document edit while the editor is open).
 */
const FALLBACK_PLACEMENTS: Array<'right-start' | 'left-end' | 'right-end'> = [
  'right-start',
  'left-end',
  'right-end',
];

/** Mirrors the shared focusable contract used by FocusTrap and FloatingPortal. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])';

export interface InspectorFocusedEditorProps {
  anchorRef: RefObject<HTMLElement | null>;
  /**
   * Region that owns the editor. Pointer presses inside it must not count as
   * "outside" dismissal, so the owning row can toggle its own editor closed
   * instead of being closed and immediately reopened.
   */
  interactionRef?: RefObject<HTMLElement | null>;
  open: boolean;
  title: string;
  /** Short stage/context tag rendered in the header beside the title. */
  badge?: string;
  onClose: (reason?: OverlayCloseReason) => void;
  ownerKey: string;
  children: ReactNode;
}

export function InspectorFocusedEditor({
  anchorRef,
  interactionRef,
  open,
  title,
  badge,
  onClose,
  ownerKey,
  children,
}: InspectorFocusedEditorProps) {
  const editorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    // Hand focus back only when this surface still owned it, or when closing
    // dropped focus to the document (the editor node is already detached by
    // the time this cleanup runs). A deliberate destination — the Tab handoff
    // that `yieldTabToAnchor` just performed, another overlay that took focus,
    // a click into the canvas — is never stolen.
    //
    // This lives in the effect *cleanup*, not in an effect body watching
    // `open`: hosts such as EffectRow render this component only while it is
    // open (`{type && expanded && ...}`), so closing unmounts the component
    // and an open-prop-transition body would never run. Cleanup runs for both
    // that unmount and a host that keeps the component mounted.
    return () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const active = document.activeElement;
      const stranded =
        !active ||
        active === document.body ||
        Boolean(editorRef.current?.contains(active)) ||
        anchor.contains(active);
      if (!stranded) return;

      const target = anchor.matches(FOCUSABLE_SELECTOR)
        ? anchor
        : anchor.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (target ?? anchor).focus({ preventScroll: true });
    };
  }, [anchorRef, open]);

  if (!open) return null;

  return (
    <FloatingPortal
      anchorRef={anchorRef}
      open={open}
      onClose={onClose}
      placement="left-start"
      fallbackPlacements={FALLBACK_PLACEMENTS}
      maxHeight={560}
      kind="dialog"
      dismissOnEscape
      initialFocus
      yieldTabToAnchor
      insideRefs={interactionRef ? [interactionRef] : undefined}
      className="insp-focused-editor__portal"
    >
      <section
        ref={editorRef}
        key={ownerKey}
        className="insp-focused-editor"
        role="dialog"
        aria-modal="false"
        aria-label={title}
        data-inspector-focused-editor={ownerKey}
      >
        <header className="insp-focused-editor__header">
          <h2 className="insp-focused-editor__title">{title}</h2>
          {badge && (
            <span
              className="insp-focused-editor__stage-badge"
              title={`Effects render at the ${badge} stage`}
            >
              {badge}
            </span>
          )}
          <CloseButton
            size="sm"
            label={`Close ${title}`}
            className="insp-focused-editor__close"
            onClick={() => onClose('action')}
          />
        </header>
        <div className="insp-focused-editor__body">{children}</div>
      </section>
    </FloatingPortal>
  );
}
