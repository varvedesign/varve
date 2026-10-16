/**
 * PrototypePresenter — the run-time viewer for an authored prototype.
 *
 * Responsibilities are deliberately narrow: it owns the viewer chrome (screen
 * identity, exit, and the authored-history back control) and it composes the
 * transition. It does **not** own screen geometry — `PrototypeScreenView`
 * derives active regions from the same raster the image came from, so an
 * interpolated layer and its active region cannot drift apart.
 *
 * Keyboard contract: Escape exits the viewer. Arrow keys are *inspection*
 * (previous/next screen in flow order) and are therefore suppressed while a
 * screen control has focus, so pressing Enter/Space on an active region cannot
 * also advance the flow. Authored back/forward is a separate control that
 * walks the runtime's own history.
 */
import { prefersReducedMotion } from '@varve/prototype';
import type { Document, NodeId } from '@varve/scene';
import { nodeWorldBounds } from '@varve/scene';
import { Icon } from '@varve/ui';
import { type CSSProperties, useCallback, useEffect, useMemo } from 'react';
import { computeSmartAnimateHotspotOverrides } from '../../motion/smartAnimateBridge';
import { DeviceFrame } from './DeviceFrame';
import { PrototypeScreenView, type PrototypeScreenViewProps } from './PrototypeScreenView';
import {
  type ActivePrototypeTransition,
  computeTransitionVisuals,
  usePrototypeTransition,
} from './usePrototypeTransition';

interface PrototypePresenterProps {
  isOpen: boolean;
  onClose: () => void;
  screens: Array<{ id: string; name: string }>;
  currentScreenId: string;
  onNavigate: (screenId: string) => void;
  onEvent: (event: unknown) => void;
  /** Document for screen rendering (optional — falls back to placeholder). */
  prototypeDocument?: Document;
  overlayStack?: string[];
  activeTransition?: ActivePrototypeTransition | null;
  onClearTransition?: () => void;
  deviceConfig?: {
    type: string;
    name: string;
    width: number;
    height: number;
    dpr: number;
    showNotch?: boolean;
    showHomeIndicator?: boolean;
  };
  /** Authored navigation history depth; 0 hides the back control. */
  historyDepth?: number;
  onBack?: () => void;
  /** Draw the active region boxes (audience hints). */
  showHotspots?: boolean;
  onToggleHotspots?: () => void;
  /** Restart the flow at its entry point. */
  onRestart?: () => void;
  debugConsole?: unknown;
  onScreenshot?: () => void;
}

/** True when a key event came from a control that handles its own activation. */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[data-prototype-hotspot], button, a, input, textarea, select')) return true;
  return target.isContentEditable;
}

export function PrototypePresenter({
  isOpen,
  onClose,
  screens,
  currentScreenId,
  onNavigate,
  onEvent,
  deviceConfig,
  prototypeDocument,
  overlayStack = [],
  activeTransition = null,
  onClearTransition,
  historyDepth = 0,
  onBack,
  showHotspots = false,
  onToggleHotspots,
  onRestart,
}: PrototypePresenterProps) {
  const transitionProgress = usePrototypeTransition(activeTransition ?? null);

  useEffect(() => {
    if (activeTransition && transitionProgress >= 1) {
      onClearTransition?.();
    }
  }, [activeTransition, transitionProgress, onClearTransition]);

  const reducedMotion = prefersReducedMotion();
  const currentIndex = useMemo(
    () => screens.findIndex((s) => s.id === currentScreenId),
    [screens, currentScreenId],
  );
  const currentScreen = useMemo(
    () => screens.find((s) => s.id === currentScreenId),
    [screens, currentScreenId],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // A focused control owns Enter/Space and the arrow keys it defines; the
      // viewer must not consume an activation as a flow step.
      if (isInteractiveTarget(e.target)) return;
      if (e.key === 'ArrowRight' && currentIndex < screens.length - 1) {
        const next = screens[currentIndex + 1];
        if (next) onNavigate(next.id);
      } else if (e.key === 'ArrowLeft' && currentIndex > 0) {
        const prev = screens[currentIndex - 1];
        if (prev) onNavigate(prev.id);
      }
    },
    [onClose, onNavigate, currentIndex, screens],
  );

  useEffect(() => {
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  /**
   * Composed scene bounds for a layer. Used only for Smart Animate hotspot
   * interpolation, which runs in scene space and is mapped by the screen view
   * exactly like the static regions are.
   */
  const getSceneBounds = useCallback(
    (nodeId: NodeId): { x: number; y: number; w: number; h: number } | null => {
      if (!prototypeDocument) return null;
      return nodeWorldBounds(prototypeDocument, nodeId) ?? null;
    },
    [prototypeDocument],
  );

  if (!isOpen) return null;

  const smartHotspotOverrides =
    activeTransition &&
    transitionProgress < 1 &&
    !reducedMotion &&
    activeTransition.transition.kind === 'smartAnimate' &&
    activeTransition.layerMatches &&
    activeTransition.smartAnimateValues &&
    prototypeDocument
      ? computeSmartAnimateHotspotOverrides(
          prototypeDocument,
          activeTransition.layerMatches,
          activeTransition.smartAnimateValues,
          transitionProgress,
          activeTransition.transition.easing ?? { kind: 'ease' },
          getSceneBounds,
        )
      : null;

  const renderScreen = (
    screenId: string,
    style?: CSSProperties,
    hotspotOverrides?: PrototypeScreenViewProps['hotspotOverrides'],
  ) => {
    if (!prototypeDocument) {
      const name = screens.find((s) => s.id === screenId)?.name ?? 'Unknown';
      return (
        <div className="prototype-presenter__screen" style={style}>
          Screen: {name}
        </div>
      );
    }
    return (
      <div className="prototype-presenter__screen-layer" style={style}>
        <PrototypeScreenView
          document={prototypeDocument}
          screenId={screenId}
          overlayStack={overlayStack}
          hotspotOverrides={hotspotOverrides}
          showHotspots={showHotspots}
          onEvent={(ev) => onEvent(ev)}
        />
      </div>
    );
  };

  const transitionVisuals =
    activeTransition && transitionProgress < 1 && !reducedMotion
      ? computeTransitionVisuals(activeTransition, transitionProgress)
      : null;

  const transitionCandidate =
    activeTransition && prototypeDocument
      ? prototypeDocument.nodes[activeTransition.fromScreenId]
      : null;
  const transitionFrame = transitionCandidate?.kind === 'frame' ? transitionCandidate : null;

  const screenContent =
    transitionVisuals && activeTransition ? (
      <div
        className="prototype-presenter__transition-stack"
        style={{
          width: transitionFrame?.w ?? 375,
          height: transitionFrame?.h ?? 812,
        }}
      >
        {renderScreen(
          activeTransition.fromScreenId,
          {
            opacity: transitionVisuals.from.opacity,
            transform: transitionVisuals.from.transform,
          },
          smartHotspotOverrides?.from,
        )}
        {renderScreen(
          activeTransition.toScreenId,
          {
            opacity: transitionVisuals.to.opacity,
            transform: transitionVisuals.to.transform,
          },
          smartHotspotOverrides?.to,
        )}
      </div>
    ) : prototypeDocument && currentScreenId ? (
      <PrototypeScreenView
        document={prototypeDocument}
        screenId={currentScreenId}
        overlayStack={overlayStack}
        showHotspots={showHotspots}
        onEvent={(ev) => onEvent(ev)}
      />
    ) : (
      <div className="prototype-presenter__screen">Screen: {currentScreen?.name ?? 'Unknown'}</div>
    );

  const contentInner = screenContent;

  const content =
    screens.length === 0 ? (
      <div className="prototype-presenter__empty">
        <p>No screens found. Add frames to your design to preview interactions.</p>
      </div>
    ) : deviceConfig ? (
      <div className="prototype-presenter__device-frame">
        <DeviceFrame device={deviceConfig} scale={1}>
          {contentInner}
        </DeviceFrame>
      </div>
    ) : (
      contentInner
    );

  return (
    <div
      className="prototype-presenter"
      role="dialog"
      aria-modal="true"
      aria-label="Prototype preview"
    >
      <div className="prototype-presenter__toolbar">
        <span className="prototype-presenter__screen-name">
          {currentScreen?.name ?? 'No screen'}
        </span>
        <span className="prototype-presenter__counter">
          {currentIndex + 1} / {screens.length}
        </span>
        {onRestart && (
          <button
            type="button"
            className="prototype-presenter__nav-btn"
            onClick={onRestart}
            aria-label="Restart flow"
          >
            <Icon name="RotateCcw" size={20} />
          </button>
        )}
        {onBack && (
          <button
            type="button"
            className="prototype-presenter__nav-btn"
            disabled={historyDepth === 0}
            onClick={onBack}
            aria-label="Back"
          >
            <Icon name="ArrowLeft" size={20} />
          </button>
        )}
        <button
          type="button"
          className="prototype-presenter__nav-btn"
          disabled={currentIndex <= 0}
          onClick={() => {
            const prev = screens[currentIndex - 1];
            if (prev) onNavigate(prev.id);
          }}
          aria-label="Previous screen"
        >
          <Icon name="ChevronLeft" size={24} />
        </button>
        <button
          type="button"
          className="prototype-presenter__nav-btn"
          disabled={currentIndex >= screens.length - 1}
          onClick={() => {
            const next = screens[currentIndex + 1];
            if (next) onNavigate(next.id);
          }}
          aria-label="Next screen"
        >
          <Icon name="ChevronRight" size={24} />
        </button>
        {onToggleHotspots && (
          <button
            type="button"
            className="prototype-presenter__nav-btn"
            aria-pressed={showHotspots}
            onClick={onToggleHotspots}
            aria-label="Show interactive areas"
          >
            <Icon name="MousePointerClick" size={20} />
          </button>
        )}
        <button
          type="button"
          className="prototype-presenter__exit-btn"
          onClick={onClose}
          aria-label="Exit prototype preview"
        >
          Exit
        </button>
      </div>
      <div className="prototype-presenter__content">{content}</div>
    </div>
  );
}
