/**
 * Phone capture for the safe-area validation harness (task 01a).
 *
 * Portrait emulates a top notch plus home indicator (inspector is a bottom
 * sheet); landscape emulates sensor housings on the vertical edges and the
 * short height (inspector is a side drawer). Also toggles distraction-free
 * mode through its real shortcut to measure the exit control.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { installInsets, openEditorDocument, toggleDistractionFree } from './bootstrap.mjs';
import { LANDSCAPE_INSETS, PORTRAIT_INSETS, relativeToRoot } from './config.mjs';
import { overlayProbe, shellProbe } from './page-probes.mjs';
import {
  buildExitFocusChecks,
  buildInsetPropagationChecks,
  buildOverlayChecks,
  buildShellChecks,
} from './probes.mjs';

const PHONE_SIZES = [
  { width: 390, height: 844, insets: PORTRAIT_INSETS, inspector: 'portrait-sheet' },
  { width: 320, height: 640, insets: PORTRAIT_INSETS, inspector: 'portrait-sheet' },
  { width: 844, height: 390, insets: LANDSCAPE_INSETS, inspector: 'side-drawer' },
];

async function captureSize(page, context, size, options) {
  await page.setViewportSize({ width: size.width, height: size.height });
  const cdp = await installInsets(context, page, size.insets);
  await page.waitForTimeout(500);
  const orientation = size.inspector === 'portrait-sheet' ? 'portrait' : 'landscape';
  const label = `editor ${size.width}x${size.height} ${orientation}`;
  const shell = await page.evaluate(shellProbe);
  const overlays = await page.evaluate(overlayProbe);
  options.checks.push(...buildShellChecks(shell, label, size.insets));
  options.checks.push(...buildOverlayChecks(shell, overlays, label, size.insets, size.inspector));
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: {} });
  await page.waitForTimeout(350);
  const baselineShell = await page.evaluate(shellProbe);
  const baselineOverlays = await page.evaluate(overlayProbe);
  options.checks.push(
    ...buildInsetPropagationChecks(
      { shell, overlays },
      { shell: baselineShell, overlays: baselineOverlays },
      label,
      size.insets,
    ),
  );
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: size.insets });
  await page.waitForTimeout(350);
  if (options.screenshots) {
    mkdirSync(options.out, { recursive: true });
    const file = path.join(options.out, `editor-${size.width}x${size.height}-safe-area.png`);
    await page.screenshot({ path: file });
    options.screenshotList.push({ file: relativeToRoot(file), viewport: label });
  }
  return { shell, insets: size.insets };
}

async function captureExitFocus(page, options, last) {
  const exitState = await toggleDistractionFree(page);
  options.checks.push({
    name: 'editor distraction-free mode toggles via its shortcut',
    ok: exitState.isOn === true,
    detail: exitState,
  });
  if (!exitState.isOn) return;
  const shell = await page.evaluate(shellProbe);
  const overlays = await page.evaluate(overlayProbe);
  options.checks.push(
    ...buildExitFocusChecks(shell, overlays, 'editor exit-focus landscape', last.insets),
  );
  if (options.screenshots) {
    const file = path.join(options.out, 'editor-844x390-exit-focus-safe-area.png');
    await page.screenshot({ path: file });
    options.screenshotList.push({
      file: relativeToRoot(file),
      viewport: 'editor exit-focus landscape',
    });
  }
  const back = await toggleDistractionFree(page);
  const restored = await page
    .locator('.editor-shell__menubar')
    .isVisible()
    .catch(() => false);
  options.checks.push({
    name: 'editor returns from distraction-free mode',
    ok: back.isOn === false && restored === true,
    detail: { back, restored },
  });
}

export async function captureEditor(browser, options) {
  const { context, page } = await openEditorDocument(browser, {
    url: options.url,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    insets: PORTRAIT_INSETS,
  });
  try {
    let last = null;
    for (const size of PHONE_SIZES) last = await captureSize(page, context, size, options);
    await captureExitFocus(page, options, last);
  } finally {
    await context.close();
  }
}
