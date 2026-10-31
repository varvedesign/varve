import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Open the toolbar Tool options popover. Text no longer auto-opens it (the
 * New text panel sat over the canvas and ate the first create gesture), so
 * specs that need writing-mode / orientation defaults call this after
 * activating the Text tool.
 */
export async function openToolOptions(page: Page): Promise<Locator> {
  const trigger = page.getByRole('button', { name: 'Tool options', exact: true });
  await expect(trigger).toBeVisible({ timeout: 10000 });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click();
  }
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const popover = page.locator('.tool-options__popover');
  await expect(popover).toBeVisible();
  return popover;
}
