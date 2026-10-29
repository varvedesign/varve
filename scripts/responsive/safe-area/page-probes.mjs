/**
 * Serialized page-side probes for the safe-area harness.
 *
 * These functions are passed to page.evaluate(), so they must be
 * self-contained: no imports, no closures over Node state. They return raw
 * geometry only; probes.mjs turns it into assertions.
 */

/** Grid-area chrome geometry. */
export function shellProbe() {
  const style = (selector, property) => {
    const element = document.querySelector(selector);
    return element ? getComputedStyle(element)[property] : null;
  };
  const box = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  };
  const meta = document.querySelector('meta[name=viewport]');
  const root = document.documentElement;
  return {
    viewportMeta: meta ? meta.getAttribute('content') : null,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollWidth: root.scrollWidth,
    layoutMode: root.dataset.layoutMode || null,
    mirrored: root.dataset.tabletControlsMirrored || null,
    shell: {
      paddingTop: style('.editor-shell', 'paddingTop'),
      paddingRight: style('.editor-shell', 'paddingRight'),
      paddingBottom: style('.editor-shell', 'paddingBottom'),
      paddingLeft: style('.editor-shell', 'paddingLeft'),
    },
    menubar: box('.editor-shell__menubar'),
    tabs: box('.editor-tabs-row'),
    status: box('.editor-status'),
  };
}

/** Viewport-relative overlay geometry. */
export function overlayProbe() {
  const style = (selector, property) => {
    const element = document.querySelector(selector);
    return element ? getComputedStyle(element)[property] : null;
  };
  const box = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  };
  const fab = (selector) => ({
    exists: Boolean(document.querySelector(selector)),
    display: style(selector, 'display'),
    box: box(selector),
    left: style(selector, 'left'),
    right: style(selector, 'right'),
  });
  return {
    layersDrawer: {
      position: style('.editor__layers-panel', 'position'),
      left: style('.editor__layers-panel', 'left'),
      top: style('.editor__layers-panel', 'top'),
      bottom: style('.editor__layers-panel', 'bottom'),
      box: box('.editor__layers-panel'),
    },
    inspectorDrawer: {
      position: style('.editor__inspector-panel', 'position'),
      right: style('.editor__inspector-panel', 'right'),
      bottom: style('.editor__inspector-panel', 'bottom'),
      paddingBottom: style('.editor__inspector-panel', 'paddingBottom'),
    },
    fabLayers: fab('.editor__fab--layers'),
    fabInspector: fab('.editor__fab--inspector'),
    fabLibrary: fab('.editor__fab--library'),
    toast: {
      exists: Boolean(document.querySelector('.varve-toast-container')),
      bottom: style('.varve-toast-container', 'bottom'),
      right: style('.varve-toast-container', 'right'),
    },
    exitFocus: {
      exists: Boolean(document.querySelector('.editor-shell__exit-focus')),
      box: box('.editor-shell__exit-focus'),
    },
  };
}
