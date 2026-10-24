import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

// Tracing adds substantial overhead to the 97 real duplications. The same
// flow without tracing reached 100 and presented within the unchanged 180s
// budget. Playwright requires this worker-scoped option at file scope; keeping
// this case separate preserves tracing on ordinary presentation authoring.
// Retain the final screenshot and timing/heap evidence below.
test.use({ trace: 'off' });

test.describe('presentation authoring stress', () => {
  test('opens and navigates a populated 100-slide stress deck', async ({ page }, testInfo) => {
    await page.addInitScript(() => localStorage.removeItem('varve:crash-loop'));
    await navigateToEditor(page);
    await page.setInputFiles(
      '#file-open-input',
      resolve(process.cwd(), 'scripts/screenshots/fixtures/presentation.varve'),
    );
    await page.getByRole('tab', { name: 'Slides' }).click();
    const slides = page.getByRole('list', { name: 'Slides in presentation order' });
    await expect(slides.locator(':scope > li')).toHaveCount(3);

    const startedAt = Date.now();
    for (let slideNumber = 4; slideNumber <= 100; slideNumber += 1) {
      await slides
        .locator(':scope > li')
        .first()
        .getByRole('button', { name: 'Duplicate', exact: true })
        .click();
    }
    const authoringMs = Date.now() - startedAt;
    await expect(slides.locator(':scope > li')).toHaveCount(100, { timeout: 30000 });
    const lastSlide = slides.locator(':scope > li').last();
    const navigationStartedAt = Date.now();
    await lastSlide.getByRole('button', { name: /Select slide 100:/ }).click();
    await page.getByRole('button', { name: 'Present', exact: true }).click();
    const audience = page.getByRole('dialog', { name: /audience preview/ });
    await expect(audience.locator('.presentation-audience__canvas')).toBeVisible({
      timeout: 30000,
    });
    const navigationMs = Date.now() - navigationStartedAt;
    const captureState = await page.evaluate(() => ({
      loadedSlideImages: Array.from(
        document.querySelectorAll<HTMLImageElement>('.presentation-navigator__thumbnail img'),
      ).filter((image) => image.complete && image.naturalWidth > 0).length,
      usedHeapBytes:
        (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
          ?.usedJSHeapSize ?? null,
    }));
    await page.screenshot({
      path: testInfo.outputPath('presentation-100-slide-audience-preview.png'),
      animations: 'disabled',
    });
    console.info(
      `[presentation-stress] slides=100 authoringMs=${authoringMs} lastSlideNavigationMs=${navigationMs} loadedThumbnails=${captureState.loadedSlideImages} usedHeapBytes=${captureState.usedHeapBytes ?? 'unavailable'}`,
    );
    await expect(audience).not.toContainText('Internal note:');
    await audience.getByRole('button', { name: 'Exit' }).click();
    await expect(audience).toBeHidden();
  });
});
