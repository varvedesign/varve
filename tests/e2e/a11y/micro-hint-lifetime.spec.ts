import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

for (const width of [900, 1440]) {
  for (const theme of ['light', 'dark', 'high-contrast']) {
    test(`hint remains readable and keyboard-dismissible at ${width}px in ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: width === 900 ? 600 : 900 });
      await navigateToEditor(page);
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.clock.install();
      await page.keyboard.press('r');
      const hint = page.locator('.micro-hint');
      const dismiss = hint.getByRole('button', { name: 'Dismiss hint' });
      await expect(dismiss).toBeVisible();
      // Establish a nearby starting point, then exercise the real Tab traversal.
      await dismiss.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(dismiss).toBeFocused();
      await page.clock.fastForward(6000);
      await expect(hint).toBeVisible();

      const layout = await hint.evaluate((element) => {
        const body = element.querySelector<HTMLElement>('.micro-hint__body')!;
        const header = element.querySelector<HTMLElement>('.micro-hint__header')!;
        const close = element.querySelector<HTMLElement>('.micro-hint__dismiss')!;
        return {
          hint: element.getBoundingClientRect().toJSON(),
          body: body.getBoundingClientRect().toJSON(),
          header: header.getBoundingClientRect().toJSON(),
          close: close.getBoundingClientRect().toJSON(),
          bodySize: Number.parseFloat(getComputedStyle(body).fontSize),
          overflow: body.scrollWidth > body.clientWidth,
        };
      });
      expect(layout.body.y).toBeGreaterThanOrEqual(layout.header.bottom);
      expect(layout.body.width).toBeGreaterThan(layout.hint.width * 0.8);
      expect(layout.overflow).toBe(false);
      expect(layout.bodySize).toBeGreaterThanOrEqual(12);
      expect(Math.min(layout.close.width, layout.close.height)).toBeGreaterThanOrEqual(24);
      await testInfo.attach('focused-readable-hint', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });

      await page.keyboard.press('Space');
      await expect(hint).toHaveCount(0);
      const seen = await page.evaluate(
        () => JSON.parse(localStorage.getItem('strata:onboarding') ?? '{}').dismissedMicroHints,
      );
      expect(seen).toContain('rect.first-use');
    });
  }
}

test('hint copy lets a drawing gesture reach the canvas', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await navigateToEditor(page);
  await page.keyboard.press('r');
  const body = page.locator('.micro-hint__body');
  await expect(body).toBeVisible();
  const box = await body.boundingBox();
  if (!box) throw new Error('Hint body has no rendered box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.layers-panel [role="treeitem"]')).toHaveCount(1);
});
