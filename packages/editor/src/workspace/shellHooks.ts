import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

/** Keep drawer width independent of the collapsed desktop grid column. */
export function layersDrawerStyle(
  dockStyle: CSSProperties | undefined,
  width: number | null,
  preferredWidth: string | undefined,
): CSSProperties {
  return {
    ...dockStyle,
    '--layers-drawer-width': width === null ? preferredWidth : `${width}px`,
  } as CSSProperties;
}

const RESPONSIVE_DRAWER_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])';

function getResponsiveDrawerFocusable(container: HTMLElement): HTMLElement[] {
  const ownerWindow = container.ownerDocument.defaultView;
  return Array.from(container.querySelectorAll<HTMLElement>(RESPONSIVE_DRAWER_FOCUSABLE)).filter(
    (element) => {
      let current: Element | null = element;
      while (current && current !== container.parentElement) {
        const style = ownerWindow?.getComputedStyle(current);
        if (style?.display === 'none' || style?.visibility === 'hidden') return false;
        current = current.parentElement;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    },
  );
}

type ResponsivePanelClosersOptions = {
  layersVisible: boolean;
  inspectorVisible: boolean;
  libraryPanelVisible: boolean;
  setLayersVisible: (visible: boolean) => void;
  setInspectorVisible: (visible: boolean) => void;
  toggleLibraryPanel: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

/**
 * The launcher that opened a drawer, or the one that replaced it. The shell
 * unmounts its launchers while a drawer is open, so on close the remembered
 * button is detached and focusing it silently dropped focus to <body>
 * (F-39, shell audit 2026-10-22).
 */
function connectedTrigger(trigger: HTMLElement | null): HTMLElement | null {
  if (!trigger || trigger.isConnected) return trigger;
  const controls = trigger.getAttribute('aria-controls');
  if (!controls) return null;
  const candidates = document.querySelectorAll<HTMLElement>(
    `[aria-controls="${CSS.escape(controls)}"]`,
  );
  return Array.from(candidates).find((el) => el.className === trigger.className) ?? null;
}

/** Close a drawer and restore focus without conflating its close controls. */
export function useResponsivePanelClosers({
  layersVisible,
  inspectorVisible,
  libraryPanelVisible,
  setLayersVisible,
  setInspectorVisible,
  toggleLibraryPanel,
  triggerRef,
}: ResponsivePanelClosersOptions) {
  const restoreTriggerFocus = useCallback(() => {
    const trigger = triggerRef.current;
    window.requestAnimationFrame(() => connectedTrigger(trigger)?.focus());
  }, [triggerRef]);

  const closeResponsivePanels = useCallback(() => {
    if (!layersVisible && !inspectorVisible && !libraryPanelVisible) return;
    setLayersVisible(false);
    setInspectorVisible(false);
    if (libraryPanelVisible) toggleLibraryPanel();
    restoreTriggerFocus();
  }, [
    inspectorVisible,
    layersVisible,
    libraryPanelVisible,
    restoreTriggerFocus,
    setInspectorVisible,
    setLayersVisible,
    toggleLibraryPanel,
  ]);

  const closeResponsiveInspector = useCallback(() => {
    setInspectorVisible(false);
    restoreTriggerFocus();
  }, [restoreTriggerFocus, setInspectorVisible]);

  const closeResponsiveLayers = useCallback(() => {
    setLayersVisible(false);
    restoreTriggerFocus();
  }, [restoreTriggerFocus, setLayersVisible]);

  /**
   * Resources needs its own closer: it is the one drawer whose panel ships no
   * in-panel close of its own, so without this its only pointer exit was the
   * scrim strip (20px wide at 320px) — the reported "can't close the asset
   * panel".
   */
  const closeResponsiveLibrary = useCallback(() => {
    if (!libraryPanelVisible) return;
    toggleLibraryPanel();
    restoreTriggerFocus();
  }, [libraryPanelVisible, restoreTriggerFocus, toggleLibraryPanel]);

  return {
    closeResponsivePanels,
    closeResponsiveInspector,
    closeResponsiveLayers,
    closeResponsiveLibrary,
  };
}

/**
 * Whether the shell is in its compact (drawer/sheet) tier.
 *
 * One reader for every panel that has to present itself differently there, so
 * the tier cannot be inferred from three copies of the same media query. The
 * Inspector's local copy was the only one before this; it now uses this.
 */
export function useCompactDrawerLayout(): boolean {
  const [compact, setCompact] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 899px)').matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(max-width: 899px)');
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  return compact;
}

type ResponsiveDrawerFocusOptions = Pick<
  ResponsivePanelClosersOptions,
  'layersVisible' | 'inspectorVisible' | 'libraryPanelVisible' | 'triggerRef'
> & {
  closeResponsivePanels: () => void;
};

/** Focus a newly opened drawer once; document updates keep its current focus. */
export function useResponsiveDrawerFocus({
  layersVisible,
  inspectorVisible,
  libraryPanelVisible,
  triggerRef,
  closeResponsivePanels,
}: ResponsiveDrawerFocusOptions): void {
  const latestRef = useRef({ triggerRef, closeResponsivePanels });
  latestRef.current = { triggerRef, closeResponsivePanels };

  useEffect(() => {
    if (!layersVisible && !inspectorVisible && !libraryPanelVisible) return;
    const mediaQuery = window.matchMedia('(max-width: 899px)');
    let releaseFocusScope: (() => void) | undefined;
    const syncFocusScope = () => {
      releaseFocusScope?.();
      releaseFocusScope = undefined;
      if (!mediaQuery.matches) return;

      const trigger = latestRef.current.triggerRef.current;
      const panelId = trigger?.getAttribute('aria-controls');
      const panel = panelId ? document.getElementById(panelId) : null;
      if (!panel) return;

      const focusTimer = window.requestAnimationFrame(() => {
        const first = getResponsiveDrawerFocusable(panel);
        if (first[0]) {
          first[0].focus({ preventScroll: true });
          return;
        }
        panel.setAttribute('tabindex', '-1');
        panel.focus({ preventScroll: true });
      });

      const onKey = (event: KeyboardEvent) => {
        if (
          document.documentElement.dataset.layoutMode === 'tablet' &&
          inspectorVisible &&
          !layersVisible &&
          !libraryPanelVisible
        ) {
          if (event.key === 'Escape') {
            event.preventDefault();
            latestRef.current.closeResponsivePanels();
          }
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          latestRef.current.closeResponsivePanels();
          return;
        }
        if (event.key !== 'Tab' || !panel.contains(document.activeElement)) return;
        const focusable = getResponsiveDrawerFocusable(panel);
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus({ preventScroll: true });
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus({ preventScroll: true });
        }
      };
      // Capture Escape/Tab before nested widgets consume them or focus exits.
      window.addEventListener('keydown', onKey, true);
      releaseFocusScope = () => {
        window.cancelAnimationFrame(focusTimer);
        window.removeEventListener('keydown', onKey, true);
        if (panel.getAttribute('tabindex') === '-1') panel.removeAttribute('tabindex');
      };
    };
    syncFocusScope();
    mediaQuery.addEventListener('change', syncFocusScope);
    return () => {
      mediaQuery.removeEventListener('change', syncFocusScope);
      releaseFocusScope?.();
    };
  }, [inspectorVisible, layersVisible, libraryPanelVisible]);
}

/** E4 (2026-08-10): document-level heading label for SR heading navigation. */
export function editorHeadingLabel(
  sessions: { id: string; name: string }[],
  activeId: string | null,
): string {
  const name = sessions.find((s) => s.id === activeId)?.name;
  return name ? `${name} — Varve` : 'Varve editor';
}

type FitEditor = {
  state: { document: { nodes: Record<string, unknown> } };
  fitAll: () => void;
};

/** Fit a newly loaded document once the canvas has a measurable viewport. */
export function useFitOnFirstDocument(editor: FitEditor, enabled: boolean): void {
  const fittedRef = useRef(false);
  const hasNodes = Object.keys(editor.state.document.nodes).length > 0;
  const fitAllRef = useRef(editor.fitAll);
  fitAllRef.current = editor.fitAll;

  useEffect(() => {
    if (!enabled || fittedRef.current || !hasNodes) return;
    let frame = 0;
    let attempts = 0;
    let previousGeometry = '';
    let stableReads = 0;
    const tryFit = () => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas.editor-canvas__content-layer',
      );
      if (canvas && canvas.clientWidth > 0 && canvas.clientHeight > 0) {
        const rect = canvas.getBoundingClientRect();
        const geometry = `${rect.left}:${rect.top}:${canvas.clientWidth}:${canvas.clientHeight}`;
        // Canvas geometry settles after two unchanged animation-frame reads.
        // Fitting during the initial dock resize lets its pending anchor
        // commit restore the camera sampled before this first fit.
        stableReads = geometry === previousGeometry ? stableReads + 1 : 0;
        previousGeometry = geometry;
        if (stableReads >= 2) {
          fitAllRef.current();
          fittedRef.current = true;
          return;
        }
      } else {
        previousGeometry = '';
        stableReads = 0;
      }
      if (++attempts > 300) return;
      frame = requestAnimationFrame(tryFit);
    };
    frame = requestAnimationFrame(tryFit);
    return () => cancelAnimationFrame(frame);
  }, [enabled, hasNodes]);
}

/**
 * Shell hook barrel — consolidates Shell's workspace hook imports.
 *
 * Shell is at its import ceiling (audit-health); grouping the workspace
 * hooks behind one barrel keeps the statement count down without
 * changing behavior.
 */

export { getDockPanelA11yProps, useEditorDockGeometry } from './dock/useEditorDockGeometry';
export { useDetachedPanels } from './useDetachedPanels';
export {
  isPagePanelUserControlled,
  resolvePageSurfaceVisibility,
  useEffectiveWorkspaceConfig,
} from './useWorkspaceConfig';
export { useWorkspacePanelWidths } from './useWorkspacePanelWidths';
