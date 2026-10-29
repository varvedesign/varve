/**
 * Phone capture for the safe-area validation harness (task 01a).
 *
 * Portrait emulates a top notch plus home indicator (inspector is a bottom
 * sheet); landscape emulates sensor housings on the vertical edges and the
 * short height (inspector is a side drawer). Also toggles distraction-free
 * mode through its real shortcut and measures the exit control in BOTH
 * orientations so the top-inset assertion is not vacuous.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { installInsets, openEditorDocument, toggleDistractionFree } from './bootstrap.mjs';
import { LANDSCAPE_INSETS, PORTRAIT_INSETS, relativeToRoot } from './config.mjs';
import { overlayProbe, shellProbe } from './page-probes.mjs';
import {
  buildBottomPropagationChecks,
  buildDrawerChecks,
  buildExitFocusChecks,
  buildLauncherChecks,
  buildShellChecks,
  buildTopPropagationChecks,
} from './probes.mjs';

const PHONE_SIZES = [
  { width: 390, height: 844, insets: PORTRAIT_INSETS, inspector: 'portrait-sheet' },
  { width: 320, height: 640, insets: PORTRAIT_INSETS, inspector: 'portrait-sheet' },
  { width: 844, height: 390, insets: LANDSCAPE_INSETS, inspector: 'side-drawer' },
];

function sizeLabel(width, height, orientation) {
  return `editor ${width}x${height} ${orientation}`;
}

/** The app skip link is absolutely positioned inside the shell; measure it. */
async function measureAppSkipLink(page) {
  return page.evaluate(() => {
    const link = document.querySelector('.editor-shell__skip-link');
    if (!link) return null;
    link.focus();
    const rect = link.getBoundingClientRect();
    const top = rect.top;
    link.blur();
    return { top };
  });
}

async function captureSize(page, context, size, options) {
  await page.setViewportSize({ width: size.width, height: size.height });
  const cdp = await installInsets(context, page, size.insets);
  await page.waitForTimeout(500);
  const orientation = size.inspector === 'portrait-sheet' ? 'portrait' : 'landscape';
  const label = sizeLabel(size.width, size.height, orientation);
  const shell = await page.evaluate(shellProbe);
  const overlays = await page.evaluate(overlayProbe);
  options.checks.push(...buildShellChecks(shell, label, size.insets));
  options.checks.push(...buildDrawerChecks(overlays, label, size.insets, size.inspector));
  options.checks.push(...buildLauncherChecks(shell, overlays, label, size.insets));
  const skip = await measureAppSkipLink(page);
  options.checks.push({
    name: `${label}: app skip link focus clears the top inset`,
    ok: skip !== null && skip.top >= size.insets.top - 1.5,
    detail: skip,
  });
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: {} });
  await page.waitForTimeout(350);
  const baseline = {
    shell: await page.evaluate(shellProbe),
    overlays: await page.evaluate(overlayProbe),
  };
  const states = { shell, overlays };
  options.checks.push(...buildTopPropagationChecks(states, baseline, label, size.insets));
  options.checks.push(...buildBottomPropagationChecks(states, baseline, label, size.insets));
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: size.insets });
  await page.waitForTimeout(350);
  if (options.screenshots) {
    mkdirSync(options.out, { recursive: true });
    const file = path.join(options.out, `editor-${size.width}x${size.height}-safe-area.png`);
    await page.screenshot({ path: file });
    options.screenshotList.push({ file: relativeToRoot(file), viewport: label });
  }
}

async function captureExitPhase(page, context, phase, options) {
  await page.setViewportSize(phase.size);
  await installInsets(context, page, phase.insets);
  await page.waitForTimeout(400);
  const shell = await page.evaluate(shellProbe);
  const overlays = await page.evaluate(overlayProbe);
  options.checks.push(...buildExitFocusChecks(shell, overlays, phase.label, phase.insets));
  if (options.screenshots && phase.screenshot) {
    const file = path.join(options.out, phase.screenshot);
    await page.screenshot({ path: file });
    options.screenshotList.push({ file: relativeToRoot(file), viewport: phase.label });
  }
}

async function captureExitFocus(page, context, options) {
  const exitState = await toggleDistractionFree(page);
  options.checks.push({
    name: 'editor distraction-free mode toggles via its shortcut',
    ok: exitState.isOn === true,
    detail: exitState,
  });
  if (!exitState.isOn) return;
  await captureExitPhase(
    page,
    context,
    {
      label: 'editor exit-focus portrait',
      size: { width: 390, height: 844 },
      insets: PORTRAIT_INSETS,
      screenshot: 'editor-390x844-exit-focus-safe-area.png',
    },
    options,
  );
  await captureExitPhase(
    page,
    context,
    {
      label: 'editor exit-focus landscape',
      size: { width: 844, height: 390 },
      insets: LANDSCAPE_INSETS,
      screenshot: null,
    },
    options,
  );
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
    for (const size of PHONE_SIZES) await captureSize(page, context, size, options);
    await captureExitFocus(page, context, options);
  } finally {
    await context.close();
  }
}
