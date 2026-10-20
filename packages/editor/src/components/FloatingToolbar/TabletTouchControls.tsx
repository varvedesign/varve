import { FloatingPortal, Icon, ToggleButton } from '@varve/ui';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useEditor } from '../../context';
import { interactionSession } from '../../tools/InteractionContext';
import './TabletTouchControls.css';
import { useTabletLayout } from './useTabletLayout';

const ALIGNMENT_ACTIONS = [
  { label: 'Align left', axis: 'left' },
  { label: 'Align horizontal center', axis: 'centerH' },
  { label: 'Align right', axis: 'right' },
  { label: 'Align top', axis: 'top' },
  { label: 'Align vertical center', axis: 'centerV' },
  { label: 'Align bottom', axis: 'bottom' },
] as const;

function safePortalPlacement(trigger: HTMLButtonElement | null, canvas: HTMLElement | null) {
  if (!trigger || !canvas) return null;
  const ownerDocument = trigger.ownerDocument;
  const triggerRect = trigger.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const launchers = [...ownerDocument.querySelectorAll<HTMLElement>('.editor__fab')]
    .map((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return { style, rect };
    })
    .filter(
      ({ style, rect }) =>
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.left > canvasRect.left + canvasRect.width / 2 &&
        rect.left < canvasRect.right &&
        rect.top < triggerRect.top &&
        rect.bottom > canvasRect.top,
    );
  const launcherLeft = launchers.reduce((left, { rect }) => Math.min(left, rect.left), Infinity);
  const anchorX = Math.min(triggerRect.right, launcherLeft - 8);
  const safeCanvasLeft = canvasRect.left + 8;
  const portalWidth = Math.min(340, Math.max(0, canvasRect.width - 16));
  const predictedRight = Math.max(safeCanvasLeft, anchorX - portalWidth) + portalWidth;
  const blockingLauncherTop = launchers.reduce(
    (top, { rect }) => (rect.left < predictedRight ? Math.min(top, rect.top) : top),
    Infinity,
  );
  const anchorY = Math.min(triggerRect.top, blockingLauncherTop - 8);
  const viewportHeight = ownerDocument.defaultView?.innerHeight ?? 480;
  return {
    anchor: {
      kind: 'point' as const,
      point: {
        space: 'viewport' as const,
        x: anchorX,
        y: anchorY,
      },
      ownerDocument,
      contextElement: trigger,
    },
    maxHeight: Math.max(
      0,
      Math.min(
        Math.floor(viewportHeight * 0.72),
        Math.floor(triggerRect.top - canvasRect.top - 16),
        Math.floor(blockingLauncherTop - canvasRect.top - 24),
      ),
    ),
  };
}

export function TabletTouchControls() {
  const editor = useEditor();
  const isTabletLayout = useTabletLayout();
  const snapshot = useSyncExternalStore(
    interactionSession.subscribe,
    interactionSession.getControlSnapshot,
    interactionSession.getControlSnapshot,
  );
  const [open, setOpen] = useState(false);
  const [, setViewportRevision] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const controlsId = `tablet-touch-controls-${useId().replace(/:/g, '')}`;
  const guideId = `${controlsId}-gestures`;
  const selectionCount = editor.state.selection.length;
  const hasSelection = selectionCount > 0;
  const canAlign = selectionCount > 1;
  const collisionBoundary = open
    ? (triggerRef.current?.ownerDocument.querySelector<HTMLElement>('.editor-canvas') ?? null)
    : null;
  const portalPlacement = open ? safePortalPlacement(triggerRef.current, collisionBoundary) : null;

  useEffect(() => {
    if (!open) return;
    const view = triggerRef.current?.ownerDocument.defaultView;
    const update = () => setViewportRevision((current) => current + 1);
    view?.addEventListener('resize', update);
    view?.visualViewport?.addEventListener('resize', update);
    return () => {
      view?.removeEventListener('resize', update);
      view?.visualViewport?.removeEventListener('resize', update);
    };
  }, [open]);

  // The control exists only in the tablet layout. Rendering it off-tablet left
  // a `display: none` node in the palette's trailing cluster, which then had no
  // content at all and painted a stray divider (see
  // docs/architecture/toolbar-system.md).
  if (!isTabletLayout) return null;

  return (
    <div className="tablet-touch-controls">
      <button
        ref={triggerRef}
        type="button"
        className="tablet-touch-controls__trigger"
        aria-label="Tablet editing controls"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={controlsId}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="Settings" size={18} />
      </button>
      <FloatingPortal
        anchorRef={triggerRef}
        anchor={portalPlacement?.anchor}
        open={open}
        placement="top-end"
        fallbackPlacements={['bottom-end', 'top-start', 'bottom-start']}
        collisionBoundary={collisionBoundary}
        offsetDistance={8}
        maxHeight={portalPlacement?.maxHeight ?? 480}
        onClose={() => setOpen(false)}
        dismissOnEscape
        className="tablet-touch-controls__portal"
        zIndex="calc(var(--z-toast) + 1)"
        id={controlsId}
        kind="popover"
      >
        <div
          className="tablet-touch-controls__panel"
          role="dialog"
          aria-label="Tablet editing controls"
        >
          <h2 className="tablet-touch-controls__heading">Editing controls</h2>
          <fieldset className="tablet-touch-controls__grid">
            <legend>Tool modifiers</legend>
            <ToggleButton
              label="Constrain movement"
              pressed={snapshot.constrain}
              onPressedChange={(pressed) =>
                interactionSession.setLatchedModifier('constrain', pressed)
              }
              className="tablet-touch-controls__action"
              size="md"
            >
              Constrain
            </ToggleButton>
            <ToggleButton
              label="From centre"
              pressed={snapshot.fromCenter}
              onPressedChange={(pressed) =>
                interactionSession.setLatchedModifier('fromCenter', pressed)
              }
              className="tablet-touch-controls__action"
              size="md"
            >
              From centre
            </ToggleButton>
            <ToggleButton
              label="Bypass snapping"
              pressed={snapshot.bypassSnap}
              onPressedChange={(pressed) =>
                interactionSession.setLatchedModifier('bypassSnap', pressed)
              }
              className="tablet-touch-controls__action"
              size="md"
            >
              Bypass snap
            </ToggleButton>
          </fieldset>
          <fieldset className="tablet-touch-controls__section">
            <legend>Selection actions</legend>
            <button
              type="button"
              className="tablet-touch-controls__action"
              aria-pressed={snapshot.deepSelectArmed}
              disabled={editor.state.tool !== 'select'}
              onClick={() => interactionSession.armDeepSelect(!snapshot.deepSelectArmed)}
            >
              {snapshot.deepSelectArmed ? 'Deep select: tap canvas' : 'Deep select next tap'}
            </button>
            <button
              type="button"
              className="tablet-touch-controls__action"
              disabled={!hasSelection}
              onClick={editor.duplicateSelected}
            >
              Duplicate
            </button>
          </fieldset>
          <fieldset className="tablet-touch-controls__grid">
            <legend>Align selection</legend>
            {ALIGNMENT_ACTIONS.map(({ label, axis }) => (
              <button
                key={axis}
                type="button"
                className="tablet-touch-controls__action"
                aria-label={label}
                disabled={!canAlign}
                onClick={() => editor.alignSelected(axis, 'selection')}
              >
                {label.replace('Align ', '').replace(' center', ' ctr.')}
              </button>
            ))}
          </fieldset>
          <fieldset className="tablet-touch-controls__section">
            <legend>Layer order</legend>
            <button
              type="button"
              className="tablet-touch-controls__action"
              disabled={!hasSelection}
              onClick={() => editor.arrangeSelected('forward')}
            >
              Bring forward
            </button>
            <button
              type="button"
              className="tablet-touch-controls__action"
              disabled={!hasSelection}
              onClick={() => editor.arrangeSelected('backward')}
            >
              Send backward
            </button>
          </fieldset>
          {/* A compact gesture reference. The gestures are the same ones the
           * input contract documents; naming them here keeps them discoverable
           * without a keyboard, and advanced gestures never become the only
           * path (every one has a visible control in this panel). */}
          <section className="tablet-touch-controls__guide" aria-labelledby={guideId}>
            <h3 className="tablet-touch-controls__guide-title" id={guideId}>
              Gestures
            </h3>
            <dl className="tablet-touch-controls__gestures">
              <dt>One finger</dt>
              <dd>Follows Drawing input: draws, or pans when set to navigate.</dd>
              <dt>Two fingers</dt>
              <dd>Pan and zoom the canvas.</dd>
              <dt>Long press</dt>
              <dd>Pick a nested object under your finger.</dd>
              <dt>Multi</dt>
              <dd>Tap the Multi control, then tap objects to add them.</dd>
              <dt>Pen</dt>
              <dd>Always draws. Finger contacts stay out of the way while it is down.</dd>
            </dl>
          </section>
          <p className="tablet-touch-controls__hint">
            From centre applies to drawing tools and selection resize handles. Alt-drag while
            selecting keeps its duplicate behavior.
          </p>
        </div>
      </FloatingPortal>
    </div>
  );
}
