/**
 * Editor scene bootstrap for the dense-data probe.
 *
 * A dense scene (two vector layers + one timeline track) is built through the
 * real UI so the probe measures product code paths, not fixtures. Each helper
 * owns one phase: startup dismissal, editor navigation, layers drawer, seeding.
 */
import { BOOT_TIMEOUT_MS } from './config.mjs';

/** Dismiss stacked startup dialogs and the onboarding checklist. */
export async function dismissStartup(page) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const dialogs = page.locator('dialog[open]');
    if ((await dialogs.count()) === 0) break;
    const close = dialogs
      .last()
      .getByRole('button', { name: /^(close|cancel|got it|skip|continue normal startup)$/i });
    if (await close.isVisible({ timeout: 400 }).catch(() => false)) {
      await close.click({ timeout: 3000, force: true }).catch(() => {});
    } else {
      await page.keyboard.press('Escape').catch(() => {});
    }
    await page.waitForTimeout(250);
  }
  const onboarding = page.locator('.onboarding-checklist__dismiss');
  if (await onboarding.isVisible({ timeout: 900 }).catch(() => false)) {
    await onboarding.click({ timeout: 3000 }).catch(() => {});
  }
  await page.waitForTimeout(400);
}

/** Load the editor and create a design document. */
export async function navigateToEditor(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 300000 });
  const continueNormal = page.getByRole('button', { name: /continue normal startup/i });
  if (await continueNormal.isVisible({ timeout: 6000 }).catch(() => false)) {
    await continueNormal.click({ timeout: 10000 }).catch(() => {});
  }
  const newButton = page.getByRole('button', { name: /^new$/i });
  await newButton.waitFor({ state: 'visible', timeout: BOOT_TIMEOUT_MS });
  await newButton.click({ timeout: 20000 });
  const create = page
    .locator('dialog[open]')
    .getByRole('button', { name: /^create(\s+design)?$/i })
    .first();
  if (!(await create.isVisible({ timeout: 60000 }).catch(() => false))) {
    await page
      .getByRole('button', { name: /create your first design/i })
      .first()
      .click({ timeout: 15000 });
    await create.waitFor({ timeout: 60000 });
  }
  await create.click({ timeout: 20000 });
  await page.locator('.editor-shell').waitFor({ state: 'visible', timeout: 90000 });
  await dismissStartup(page);
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: BOOT_TIMEOUT_MS });
  await page.locator('.layers-panel').waitFor({ state: 'attached', timeout: BOOT_TIMEOUT_MS });
  await page.waitForFunction(
    () => {
      const element = document.querySelector('canvas.editor-canvas__content-layer');
      return element !== null && element.clientWidth > 0 && element.clientHeight > 0;
    },
    undefined,
    { timeout: BOOT_TIMEOUT_MS },
  );
  await page.waitForTimeout(700);
}

/** Is the layers panel on-screen (docked or open drawer)? */
export async function isLayersVisible(page) {
  return page.evaluate(() => {
    const element = document.querySelector('#editor-layers-panel');
    if (!element) return false;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return (
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      box.width > 2 &&
      box.left >= 0 &&
      box.left < window.innerWidth
    );
  });
}

/** Open the layers drawer/FAB when the panel is not on-screen. */
export async function ensureLayersOpen(page) {
  if (await isLayersVisible(page)) return 'already-visible';
  const fab = page.locator('.editor__fab--layers');
  if (await fab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await fab.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(900);
    if (await isLayersVisible(page)) return 'fab-click';
  }
  const restore = page
    .getByRole('button', { name: /Expand layers panel|Show layers panel/i })
    .first();
  if (await restore.isVisible({ timeout: 1000 }).catch(() => false)) {
    await restore.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(800);
    if (await isLayersVisible(page)) return 'restore-button';
  }
  return 'failed';
}

/** Close an open layers drawer. */
export async function closeLayersDrawer(page) {
  const fab = page.locator('.editor__fab--layers');
  if (await fab.isVisible({ timeout: 1000 }).catch(() => false)) {
    await fab.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(600);
    return 'fab-toggle';
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
  return 'escape';
}

/** Seed a dense scene: two vector layers and one timeline track. */
export async function buildDenseScene(page) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 120000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas box missing');
  const drag = async (fromX, fromY, toX, toY) => {
    await page.mouse.move(box.x + fromX, box.y + fromY);
    await page.mouse.down();
    await page.mouse.move(box.x + (fromX + toX) / 2, box.y + (fromY + toY) / 2);
    await page.mouse.move(box.x + toX, box.y + toY);
    await page.mouse.up();
    await page.waitForTimeout(350);
  };
  await page.keyboard.press('f');
  await drag(100, 100, Math.min(box.width - 80, 460), Math.min(box.height - 60, 330));
  await page.keyboard.press('r');
  await drag(180, 170, 340, 260);
  await page.keyboard.press('v');
  await page.waitForTimeout(600);
  const layersRows = await page.locator('.layers-row').count();
  if (layersRows < 1) throw new Error('no layers rows after seeding');
  if (
    !(await page
      .locator('.timeline-panel')
      .isVisible()
      .catch(() => false))
  ) {
    await page.keyboard.press('Control+Alt+t');
  }
  await page.waitForFunction(
    () =>
      document.querySelector(
        '[data-testid="timeline-create-empty"], [data-testid="timeline-create"]',
      ) !== null,
    undefined,
    { timeout: 20000 },
  );
  const emptyCreate = page.getByTestId('timeline-create-empty');
  const createButton = (await emptyCreate.isVisible().catch(() => false))
    ? emptyCreate
    : page.getByTestId('timeline-create');
  await createButton.first().click({ timeout: 15000 });
  await page.locator('.timeline-ruler').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(400);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page
      .getByRole('treeitem')
      .first()
      .click({ timeout: 5000 })
      .catch(() => {});
    await page.waitForTimeout(250);
    await page.keyboard.press('Alt+p');
    if (
      await page
        .locator('.timeline-track-row')
        .first()
        .isVisible({ timeout: 4000 })
        .catch(() => false)
    ) {
      break;
    }
  }
  const trackRows = await page.locator('.timeline-track-row').count();
  if (trackRows === 0) throw new Error('no track row');
  await page.waitForTimeout(500);
  return { layersRows, trackRows };
}
