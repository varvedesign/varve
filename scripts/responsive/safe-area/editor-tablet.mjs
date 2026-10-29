/**
 * Tablet (>=900px) and desktop-baseline capture for the safe-area harness.
 *
 * The tablet pass forces documentElement[data-layout-mode="tablet"] (the mode
 * the app sets for coarse-pointer tablets) because headless Chromium reports
 * any-pointer:fine. Without it the inspector-aware launcher offsets and the
 * --menubar-total-height drawer anchor are never exercised. The desktop pass
 * runs with no inset profile: every new offset must resolve to 0 there.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { installInsets, openEditorDocument } from './bootstrap.mjs';
import { LANDSCAPE_INSETS, PORTRAIT_INSETS, relativeToRoot } from './config.mjs';
import { overlayProbe, shellProbe } from './page-probes.mjs';
import {
  buildDesktopBaselineChecks,
  buildInsetPropagationChecks,
  buildTabletChecks,
} from './probes.mjs';

async function setTabletMode(page, mirrored) {
  await page.evaluate((mirror) => {
    document.documentElement.dataset.layoutMode = 'tablet';
    document.documentElement.dataset.tabletControlsMirrored = mirror ? 'true' : 'false';
  }, mirrored);
  await page.waitForTimeout(400);
}

async function captureTabletPass(context, page, pass, options) {
  await page.setViewportSize({ width: pass.width, height: pass.height });
  const cdp = await installInsets(context, page, pass.insets);
  await page.waitForTimeout(400);
  await setTabletMode(page, false);
  const shell = await page.evaluate(shellProbe);
  const overlays = await page.evaluate(overlayProbe);
  const label = `editor tablet ${pass.width}x${pass.height} ${pass.orientation}`;
  options.checks.push(
    ...buildTabletChecks(shell, overlays, `${label} standard`, pass.insets, false),
  );
  await setTabletMode(page, true);
  options.checks.push(
    ...buildTabletChecks(
      await page.evaluate(shellProbe),
      await page.evaluate(overlayProbe),
      `${label} mirrored`,
      pass.insets,
      true,
    ),
  );
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: {} });
  await page.waitForTimeout(350);
  const baselineShell = await page.evaluate(shellProbe);
  const baselineOverlays = await page.evaluate(overlayProbe);
  options.checks.push(
    ...buildInsetPropagationChecks(
      { shell, overlays },
      { shell: baselineShell, overlays: baselineOverlays },
      label,
      pass.insets,
    ),
  );
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: pass.insets });
  await page.waitForTimeout(250);
  if (options.screenshots) {
    mkdirSync(options.out, { recursive: true });
    const file = path.join(options.out, `editor-tablet-${pass.width}x${pass.height}-safe-area.png`);
    await page.screenshot({ path: file });
    options.screenshotList.push({ file: relativeToRoot(file), viewport: label });
  }
}

export async function captureTablet(browser, options) {
  const { context, page } = await openEditorDocument(browser, {
    url: options.url,
    viewport: { width: 1024, height: 1366 },
    hasTouch: true,
    insets: PORTRAIT_INSETS,
  });
  try {
    await captureTabletPass(
      context,
      page,
      { width: 1024, height: 1366, insets: PORTRAIT_INSETS, orientation: 'portrait' },
      options,
    );
    await captureTabletPass(
      context,
      page,
      { width: 1366, height: 1024, insets: LANDSCAPE_INSETS, orientation: 'landscape' },
      options,
    );
  } finally {
    await context.close();
  }
}

export async function captureDesktopBaseline(browser, options) {
  const { context, page } = await openEditorDocument(browser, {
    url: options.url,
    viewport: { width: 1440, height: 900 },
  });
  try {
    const shell = await page.evaluate(shellProbe);
    const overlays = await page.evaluate(overlayProbe);
    options.checks.push(
      ...buildDesktopBaselineChecks(shell, overlays, 'editor desktop 1440x900 env=0'),
    );
    if (options.screenshots) {
      mkdirSync(options.out, { recursive: true });
      const file = path.join(options.out, 'editor-desktop-1440x900-env0.png');
      await page.screenshot({ path: file });
      options.screenshotList.push({
        file: relativeToRoot(file),
        viewport: 'editor desktop 1440x900 env=0',
      });
    }
  } finally {
    await context.close();
  }
}
