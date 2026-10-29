/**
 * Tablet (>=900px) and desktop-baseline capture for the safe-area harness.
 *
 * The tablet pass forces documentElement[data-layout-mode="tablet"] (the mode
 * the app sets for coarse-pointer tablets) because headless Chromium reports
 * any-pointer:fine. Without it the inspector-aware launcher offsets and the
 * --menubar-total-height drawer anchor are never exercised. Each launcher is
 * measured with the inset override cleared in the SAME presentation, so the
 * inset terms are proven by exact delta (a floor check alone would accept a
 * dropped env() term). The desktop pass runs with no inset profile: every new
 * offset must resolve to 0 there.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { installInsets, openEditorDocument } from './bootstrap.mjs';
import { LANDSCAPE_INSETS, PORTRAIT_INSETS, relativeToRoot } from './config.mjs';
import { overlayProbe, shellProbe } from './page-probes.mjs';
import {
  buildBottomPropagationChecks,
  buildDesktopBaselineChecks,
  buildTabletChecks,
  buildTabletDeltaChecks,
  buildTopPropagationChecks,
} from './probes.mjs';

function passLabel(pass) {
  return `editor tablet ${pass.width}x${pass.height} ${pass.orientation}`;
}

async function setTabletMode(page, mirrored) {
  await page.evaluate((mirror) => {
    document.documentElement.dataset.layoutMode = 'tablet';
    document.documentElement.dataset.tabletControlsMirrored = mirror ? 'true' : 'false';
  }, mirrored);
  await page.waitForTimeout(400);
}

async function measure(page) {
  return {
    shell: await page.evaluate(shellProbe),
    overlays: await page.evaluate(overlayProbe),
  };
}

async function capturePair(page, cdp, pass, mirrored, label, options) {
  await setTabletMode(page, mirrored);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: pass.insets });
  await page.waitForTimeout(300);
  const insetState = await measure(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: {} });
  await page.waitForTimeout(300);
  const baseline = await measure(page);
  options.checks.push(
    ...buildTabletChecks(insetState.shell, insetState.overlays, label, pass.insets, mirrored),
  );
  options.checks.push(
    ...buildTabletDeltaChecks(insetState.overlays, baseline.overlays, label, pass.insets, mirrored),
  );
  if (!mirrored) {
    options.checks.push(...buildTopPropagationChecks(insetState, baseline, label, pass.insets));
    options.checks.push(...buildBottomPropagationChecks(insetState, baseline, label, pass.insets));
  }
}

async function captureTabletPass(context, page, pass, options) {
  await page.setViewportSize({ width: pass.width, height: pass.height });
  const cdp = await installInsets(context, page, pass.insets);
  await page.waitForTimeout(300);
  const label = passLabel(pass);
  await capturePair(page, cdp, pass, false, `${label} standard`, options);
  await capturePair(page, cdp, pass, true, `${label} mirrored`, options);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: pass.insets });
  await page.waitForTimeout(200);
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
    const state = await measure(page);
    options.checks.push(
      ...buildDesktopBaselineChecks(state.shell, state.overlays, 'editor desktop 1440x900 env=0'),
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
