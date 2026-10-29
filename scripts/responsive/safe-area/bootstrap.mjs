/**
 * Shared editor bootstrap for the safe-area validation harness (task 01a).
 *
 * Opens the real app on the home surface, creates one document through the
 * New/Create dialog, and exposes the CDP inset override. The editor has no
 * route that mounts .editor-shell directly, so every capture path starts here.
 */
import { READY_TIMEOUT_MS } from './config.mjs';

/** Dismiss stacked startup dialogs and the onboarding checklist. */
export async function dismissStartupSurfaces(page) {
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

/** Home -> New -> Create design; captures must run against a real document. */
export async function createDocument(page) {
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

/** Emulate one inset profile; the page resolves the real env() expressions. */
export async function installInsets(context, page, insets) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
  return cdp;
}

/** Create a context, load the editor, create a document and apply insets. */
export async function openEditorDocument(browser, options) {
  const context = await browser.newContext({
    viewport: options.viewport,
    hasTouch: options.hasTouch === true,
    isMobile: options.isMobile === true,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: READY_TIMEOUT_MS });
  await createDocument(page);
  await page.locator('.editor-shell').waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS });
  await dismissStartupSurfaces(page);
  if (options.insets) await installInsets(context, page, options.insets);
  await page.waitForTimeout(500);
  return { context, page };
}

/** Toggle distraction-free mode via its real Ctrl+Shift+'>' shortcut. */
export async function toggleDistractionFree(page) {
  const isOn = await page
    .locator('.editor-shell__exit-focus')
    .isVisible()
    .catch(() => false);
  const dispatch = (target) =>
    page.evaluate((targetName) => {
      const event = new KeyboardEvent('keydown', {
        key: '>',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      (targetName === 'window' ? window : document).dispatchEvent(event);
    }, target);
  await dispatch('window');
  await page.waitForTimeout(500);
  let nowOn = await page
    .locator('.editor-shell__exit-focus')
    .isVisible()
    .catch(() => false);
  if (nowOn === isOn) {
    await dispatch('document');
    await page.waitForTimeout(500);
    nowOn = await page
      .locator('.editor-shell__exit-focus')
      .isVisible()
      .catch(() => false);
  }
  return { requestedOn: !isOn, isOn: nowOn };
}
