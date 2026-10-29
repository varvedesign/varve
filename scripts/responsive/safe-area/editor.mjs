/**
 * Editor half of the safe-area validation harness (task 01a).
 *
 * Loads the real editor once, emulates the orientation-appropriate insets over
 * CDP, resizes through the phone viewports and asserts the shell, drawer,
 * launcher and toast geometry. Portrait emulates a top notch plus home
 * indicator; landscape emulates sensor housings on the vertical edges and the
 * short height. In portrait the inspector is a bottom sheet with env padding;
 * in landscape it is a side drawer with a safe right edge.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  LANDSCAPE_INSETS,
  numberFromCss,
  PORTRAIT_INSETS,
  READY_TIMEOUT_MS,
  relativeToRoot,
  TOLERANCE,
} from './config.mjs';

const EDITOR_SIZES = [
  { width: 390, height: 844, insets: PORTRAIT_INSETS, inspector: 'portrait-sheet' },
  { width: 320, height: 640, insets: PORTRAIT_INSETS, inspector: 'portrait-sheet' },
  { width: 844, height: 390, insets: LANDSCAPE_INSETS, inspector: 'side-drawer' },
];

/** Serialized into the page: chrome geometry under emulated insets. */
function editorProbe() {
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
  return {
    viewportMeta: meta ? meta.getAttribute('content') : null,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    shell: {
      paddingTop: style('.editor-shell', 'paddingTop'),
      paddingRight: style('.editor-shell', 'paddingRight'),
      paddingBottom: style('.editor-shell', 'paddingBottom'),
      paddingLeft: style('.editor-shell', 'paddingLeft'),
    },
    menubar: box('.editor-shell__menubar'),
    tabsLeft: box('.editor-tabs-row') ? box('.editor-tabs-row').left : null,
    status: box('.editor-status'),
    layersDrawer: {
      position: style('.editor__layers-panel', 'position'),
      left: style('.editor__layers-panel', 'left'),
      bottom: style('.editor__layers-panel', 'bottom'),
    },
    inspectorDrawer: {
      position: style('.editor__inspector-panel', 'position'),
      right: style('.editor__inspector-panel', 'right'),
      bottom: style('.editor__inspector-panel', 'bottom'),
      paddingBottom: style('.editor__inspector-panel', 'paddingBottom'),
    },
    fabLayers: {
      display: style('.editor__fab--layers', 'display'),
      box: box('.editor__fab--layers'),
    },
    fabInspector: {
      display: style('.editor__fab--inspector', 'display'),
      box: box('.editor__fab--inspector'),
    },
    toast: {
      exists: Boolean(document.querySelector('.varve-toast-container')),
      bottom: style('.varve-toast-container', 'bottom'),
      right: style('.varve-toast-container', 'right'),
    },
  };
}

function buildEditorChecks(metrics, label, insets, inspectorMode) {
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({
      name: `${label}: ${name}`,
      ok: Boolean(ok),
      detail: detail === undefined ? null : detail,
    });
  };
  const pad = metrics.shell;
  const drawer = metrics.layersDrawer;
  const inspector = metrics.inspectorDrawer;
  check(
    'viewport meta has viewport-fit=cover',
    typeof metrics.viewportMeta === 'string' &&
      metrics.viewportMeta.indexOf('viewport-fit=cover') !== -1,
    metrics.viewportMeta,
  );
  check(
    'shell carries all four safe-area insets',
    Math.abs(numberFromCss(pad.paddingTop) - insets.top) <= TOLERANCE &&
      Math.abs(numberFromCss(pad.paddingRight) - insets.right) <= TOLERANCE &&
      Math.abs(numberFromCss(pad.paddingBottom) - insets.bottom) <= TOLERANCE &&
      Math.abs(numberFromCss(pad.paddingLeft) - insets.left) <= TOLERANCE,
    pad,
  );
  check(
    'menubar starts below the top inset',
    metrics.menubar !== null && metrics.menubar.top >= insets.top - TOLERANCE,
    metrics.menubar,
  );
  check(
    'tab strip starts after the left inset',
    metrics.tabsLeft !== null && metrics.tabsLeft >= insets.left - TOLERANCE,
    metrics.tabsLeft,
  );
  check(
    'status bar sits above the bottom inset',
    metrics.status !== null &&
      metrics.status.bottom <= metrics.innerHeight - insets.bottom + TOLERANCE,
    metrics.status,
  );
  check(
    'layers drawer is notch-safe',
    drawer.position === 'fixed' &&
      Math.abs(numberFromCss(drawer.left) - insets.left) <= TOLERANCE &&
      Math.abs(numberFromCss(drawer.bottom) - insets.bottom) <= TOLERANCE,
    drawer,
  );
  if (inspectorMode === 'portrait-sheet') {
    check(
      'inspector bottom sheet pads the bottom inset',
      inspector.position === 'fixed' &&
        Math.abs(numberFromCss(inspector.bottom)) <= TOLERANCE &&
        Math.abs(numberFromCss(inspector.paddingBottom) - insets.bottom) <= TOLERANCE,
      inspector,
    );
  } else {
    check(
      'inspector side drawer is notch-safe',
      Math.abs(numberFromCss(inspector.right) - insets.right) <= TOLERANCE &&
        Math.abs(numberFromCss(inspector.bottom) - insets.bottom) <= TOLERANCE,
      inspector,
    );
  }
  if (metrics.fabLayers.display !== 'none' && metrics.fabLayers.box) {
    check(
      'layers launcher clears the left inset',
      metrics.fabLayers.box.left >= insets.left - TOLERANCE,
      metrics.fabLayers.box,
    );
    check(
      'layers launcher clears the bottom inset',
      metrics.fabLayers.box.bottom <= metrics.innerHeight - insets.bottom + TOLERANCE,
      metrics.fabLayers.box,
    );
  }
  if (metrics.fabInspector.display !== 'none' && metrics.fabInspector.box) {
    check(
      'inspector launcher clears the right inset',
      metrics.fabInspector.box.right <= metrics.innerWidth - insets.right + TOLERANCE,
      metrics.fabInspector.box,
    );
  }
  if (metrics.toast.exists) {
    check(
      'toast clears the bottom inset',
      numberFromCss(metrics.toast.bottom) >= insets.bottom - TOLERANCE,
      metrics.toast,
    );
    check(
      'toast clears the right inset',
      numberFromCss(metrics.toast.right) >= insets.right - TOLERANCE,
      metrics.toast,
    );
  }
  check('no page horizontal overflow', metrics.scrollWidth <= metrics.innerWidth + 1, {
    scrollWidth: metrics.scrollWidth,
    innerWidth: metrics.innerWidth,
  });
  return checks;
}

/** Home -> New -> Create design; the harness must run against a real document. */
async function createDocument(page) {
  const newButton = page.getByRole('button', { name: /^new$/i });
  await newButton.waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS });
  await page.evaluate(() => document.fonts.ready);
  await newButton.click({ timeout: 60000 });
  const createButton = page
    .locator('dialog[open]')
    .getByRole('button', { name: /^create/i })
    .first();
  await createButton.waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS });
  await createButton.click({ timeout: 60000 });
}

/** Dismiss stacked startup dialogs and the onboarding checklist. */
async function dismissStartupSurfaces(page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const dialogs = page.locator('dialog[open]');
    if ((await dialogs.count()) === 0) break;
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(250);
  }
  const onboarding = page.locator('.onboarding-checklist__dismiss');
  if (await onboarding.isVisible({ timeout: 800 }).catch(() => false)) {
    await onboarding.click({ timeout: 3000 }).catch(() => {});
  }
}

/** Emulate one inset profile; the page resolves the real env() expressions. */
async function installInsets(context, page, insets) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
  return cdp;
}

export async function captureEditor(browser, options) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
  });
  try {
    const page = await context.newPage();
    await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: READY_TIMEOUT_MS });
    await createDocument(page);
    await page.locator('.editor-shell').waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS });
    await dismissStartupSurfaces(page);
    for (const size of EDITOR_SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await installInsets(context, page, size.insets);
      await page.waitForTimeout(500);
      const orientation = size.inspector === 'portrait-sheet' ? 'portrait' : 'landscape';
      const label = `editor ${size.width}x${size.height} ${orientation}`;
      options.checks.push(
        ...buildEditorChecks(await page.evaluate(editorProbe), label, size.insets, size.inspector),
      );
      if (options.screenshots) {
        mkdirSync(options.out, { recursive: true });
        const file = path.join(options.out, `editor-${size.width}x${size.height}-safe-area.png`);
        await page.screenshot({ path: file });
        options.screenshotList.push({ file: relativeToRoot(file), viewport: label });
      }
    }
  } finally {
    await context.close();
  }
}
