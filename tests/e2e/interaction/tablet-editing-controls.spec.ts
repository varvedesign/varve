import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('keyboardless tablet editing controls', () => {
  test.use({ hasTouch: true, viewport: { width: 1200, height: 750 } });

  test('keeps the modifier popover reachable after landscape-to-portrait reflow', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);
    const coachmarkDismiss = page.getByRole('button', { name: /don't show again/i });
    if (await coachmarkDismiss.isVisible({ timeout: 500 }).catch(() => false)) {
      await coachmarkDismiss.click();
    }

    let latchedConstrain: boolean | undefined;
    for (const viewport of [
      { name: 'landscape', width: 1200, height: 750 },
      { name: 'portrait', width: 600, height: 960 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await expect(page.locator('html')).toHaveAttribute('data-layout-mode', 'tablet');

      const trigger = page.getByRole('button', { name: 'Tablet editing controls' });
      await expect(trigger).toBeVisible();
      const target = await trigger.boundingBox();
      expect(target?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(target?.height ?? 0).toBeGreaterThanOrEqual(44);
      await trigger.click();

      const panel = page.getByRole('dialog', { name: 'Tablet editing controls' });
      await expect(panel).toBeVisible();
      const portal = page.locator('.tablet-touch-controls__portal');
      await expect(portal).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Constrain movement' })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'From centre' })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Bypass snapping' })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Deep select next tap' })).toBeVisible();

      const modifiers = [
        panel.getByRole('button', { name: 'Constrain movement' }),
        panel.getByRole('button', { name: 'From centre' }),
        panel.getByRole('button', { name: 'Bypass snapping' }),
      ];
      const targets = await Promise.all(modifiers.map((button) => button.boundingBox()));
      for (const target of targets) {
        expect(target?.width ?? 0).toBeGreaterThanOrEqual(44);
        expect(target?.height ?? 0).toBeGreaterThanOrEqual(44);
      }

      // The inner dialog can be taller than the visible floating surface. The
      // portal owns scrolling and must stay inside the viewport and above the
      // toolbar; measuring the inner dialog falsely flags its scrollable tail.
      const portalBounds = await portal.boundingBox();
      expect(portalBounds).not.toBeNull();
      expect(portalBounds?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect(portalBounds?.y ?? -1).toBeGreaterThanOrEqual(0);
      expect((portalBounds?.x ?? 0) + (portalBounds?.width ?? 0)).toBeLessThanOrEqual(
        viewport.width + 1,
      );
      expect((portalBounds?.y ?? 0) + (portalBounds?.height ?? 0)).toBeLessThanOrEqual(
        viewport.height + 1,
      );
      const toolbarBounds = await page.locator('.floating-toolbar').boundingBox();
      if (toolbarBounds) {
        expect((portalBounds?.y ?? 0) + (portalBounds?.height ?? 0)).toBeLessThanOrEqual(
          toolbarBounds.y + 1,
        );
      }

      const constrain = panel.getByRole('button', { name: 'Constrain movement' });
      if (latchedConstrain !== undefined) {
        await expect(constrain).toHaveAttribute('aria-pressed', String(latchedConstrain));
      }
      await constrain.click();
      latchedConstrain = !(latchedConstrain ?? false);
      await expect(constrain).toHaveAttribute('aria-pressed', String(latchedConstrain));
      const screenshotPath = testInfo.outputPath(`tablet-controls-${viewport.name}.png`);
      await page.screenshot({
        path: screenshotPath,
        animations: 'disabled',
      });
      await testInfo.attach(`tablet-controls-${viewport.name}`, {
        path: screenshotPath,
        contentType: 'image/png',
      });
      const gestureGuide = panel.getByRole('heading', { name: 'Gestures' });
      await gestureGuide.scrollIntoViewIfNeeded();
      const guideBounds = await gestureGuide.boundingBox();
      const scrolledPortalBounds = await portal.boundingBox();
      expect(guideBounds).not.toBeNull();
      expect((guideBounds?.y ?? 0) + (guideBounds?.height ?? 0)).toBeLessThanOrEqual(
        (scrolledPortalBounds?.y ?? 0) + (scrolledPortalBounds?.height ?? 0),
      );
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
    }
  });
});
