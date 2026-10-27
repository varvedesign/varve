import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

// Each case opens its own editor and dialog; keep failures from skipping the
// rest of the visual suite (a serial gate hid later baselines from triage).
test.describe.configure({ mode: 'default' });

/**
 * Glyph-rasterization drift budget, measured 2026-10-24: Playwright's Chromium
 * links the system libharfbuzz, and the harfbuzz 14.5.1 -> 14.6.0 upgrade
 * (2026-10-10, after these baselines were captured) shifted glyph antialiasing
 * by 430-3262px per capture against baselines that still pass on the CI
 * ubuntu-latest runner. 5000 absorbs that measured drift (~0.5% of the frame);
 * structural changes — layout, colour, missing controls — exceed it by an
 * order of magnitude. See docs/audits/inspector-system-review-2026-10-23.md.
 */
const RASTER_DRIFT_BUDGET = 5000;

async function importTestImage(page: import('@playwright/test').Page) {
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
}

async function openDialog(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Enhance', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Enhance image' })).toBeVisible();
}

/**
 * Import a generated image of a chosen size.
 *
 * Aspect-ratio regressions only appear once the source is neither square nor
 * tiny, and the bundled favicon is both — so the fixture itself has to carry
 * the aspect under test.
 */
async function importGeneratedImage(
  page: import('@playwright/test').Page,
  width: number,
  height: number,
) {
  await navigateToEditor(page);
  const dataUrl = await page.evaluate(
    ({ w, h }) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      const gradient = ctx.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, '#39d0c6');
      gradient.addColorStop(0.5, '#e28c3c');
      gradient.addColorStop(1, '#c54b3a');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      return canvas.toDataURL('image/png');
    },
    { w: width, h: height },
  );
  const file = path.join('/tmp', `enhance-e2e-${width}x${height}-${Date.now()}.png`);
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
  await page.locator('#file-import-input').setInputFiles(file);
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
}

async function setEditorTheme(
  page: import('@playwright/test').Page,
  theme: 'dark' | 'high-contrast',
) {
  await page.evaluate((nextTheme) => {
    document.documentElement.setAttribute('data-theme', nextTheme);
  }, theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

/**
 * Screenshot only after the comparison preview has settled: the upscaled
 * image exists, has decoded, and both halves share one measured box. Without
 * this, a capture can land mid-layout and reproduce one of two stable-looking
 * but different dialog geometries (the pixel-art baseline flapped between a
 * 1088px glyph-only diff and a 174048px structural diff on identical code).
 */
async function waitForSettledPreview(page: import('@playwright/test').Page) {
  await expect(page.locator('.upscale-preview__image--upscaled')).toHaveCount(1);
  await expect
    .poll(() =>
      page.locator('.upscale-preview__image--upscaled').evaluate((image) => {
        return (image as HTMLImageElement).naturalWidth;
      }),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(async () => {
      const boxes = await page.locator('.upscale-preview__image').evaluateAll((images) =>
        images.map((image) => {
          const rect = image.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        }),
      );
      if (boxes.length !== 2) return false;
      const [first, second] = boxes;
      if (!first || !second) return false;
      const equal =
        Math.abs(first.width - second.width) < 1 && Math.abs(first.height - second.height) < 1;
      return equal && first.width > 100 && first.height > 100;
    })
    .toBe(true);
}

test('Enhance dialog default (Auto) state', async ({ page }) => {
  await importTestImage(page);
  await openDialog(page);

  // Auto is the default; the analysis recommends upscale for the 16x16 icon.
  await expect(page.getByText(/Low source resolution/i)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Output:\s*32x32px/)).toBeVisible();
  await expect(
    page.getByAltText('Enhanced preview — same crop and output size as original'),
  ).toBeVisible({ timeout: 15000 });
  await waitForSettledPreview(page);
  const comparisonSources = await page.locator('.upscale-preview__image').evaluateAll((images) =>
    images.map((image) => {
      const element = image as HTMLImageElement;
      return { src: element.currentSrc, naturalWidth: element.naturalWidth };
    }),
  );
  expect(comparisonSources[0]?.src).not.toBe(comparisonSources[1]?.src);
  expect(comparisonSources[1]?.naturalWidth).toBeGreaterThan(
    comparisonSources[0]?.naturalWidth ?? 0,
  );
  const recommendationColumns = await page
    .locator('.upscale-auto > .insp-hint')
    .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().width));
  expect(recommendationColumns.length).toBeGreaterThanOrEqual(3);
  expect(Math.min(...recommendationColumns)).toBeGreaterThan(140);
  await expect(page.locator('.upscale-preview__overlay')).toHaveAttribute(
    'style',
    /clip-path: inset\(0px 0px 0px 50%\)/,
  );

  // Selecting After must reveal the processed half across the full stage and
  // drop the comparison slider: there is nothing left to compare against.
  const viewGroup = page.getByRole('radiogroup', { name: 'Preview view' });
  await viewGroup.getByRole('radio', { name: 'After', exact: true }).click();
  await expect(page.locator('.upscale-preview__overlay')).not.toHaveAttribute('style', /clip-path/);
  await expect(page.getByRole('slider', { name: 'Before / after comparison' })).toHaveCount(0);
  await viewGroup.getByRole('radio', { name: 'Compare' }).click();
  await expect(page.getByRole('slider', { name: 'Before / after comparison' })).toBeVisible();

  const switcherWidths = await page.evaluate(() => {
    const settings = document.querySelector('.upscale-settings')?.getBoundingClientRect();
    const quality = document
      .querySelector('[aria-label="Quality policy"]')
      ?.getBoundingClientRect();
    return { settings: settings?.width ?? 0, quality: quality?.width ?? 0 };
  });
  expect(switcherWidths.quality).toBeLessThan(switcherWidths.settings);

  await expect(page).toHaveScreenshot('enhance-dialog-default.png', {
    maxDiffPixels: RASTER_DRIFT_BUDGET,
  });
});

for (const theme of ['dark', 'high-contrast'] as const) {
  test(`Enhance dialog remains legible in ${theme} theme`, async ({ page }) => {
    await importTestImage(page);
    await openDialog(page);
    await setEditorTheme(page, theme);

    await expect(page.getByText(/Low source resolution/i)).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByAltText('Enhanced preview — same crop and output size as original'),
    ).toBeVisible({ timeout: 15000 });
    await waitForSettledPreview(page);
    await expect(page).toHaveScreenshot(`enhance-dialog-${theme}.png`, {
      maxDiffPixels: RASTER_DRIFT_BUDGET,
    });
  });
}

test('Enhance dialog pixel-art mode', async ({ page }) => {
  await importTestImage(page);
  await openDialog(page);

  // Pin the async analysis to its settled state before interacting — the
  // same precondition the default and theme-loop tests already use. Without
  // it, an analysis completing after the manual selection re-inserts content
  // and scrolls the dialog, and the capture lands in one of two byte-stable
  // geometries (this baseline was captured in the raced one).
  await expect(page.getByText(/Low source resolution/i)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Output:\s*32x32px/i)).toBeVisible();

  await page.getByRole('combobox', { name: 'Enhancement operation' }).click();
  await page.getByRole('option', { name: 'Upscale', exact: true }).click();
  await page.getByRole('combobox', { name: 'Upscale quality' }).click();
  await page.getByRole('option', { name: 'Pixel art', exact: true }).click();
  await expect(page.getByText(/Hard edges, no blur/i)).toBeVisible();
  await expect(page.getByLabel('Pixel-art algorithm')).toBeVisible();
  await expect(
    page.getByAltText('Enhanced preview — same crop and output size as original'),
  ).toBeVisible({ timeout: 15000 });
  await waitForSettledPreview(page);

  await expect(page).toHaveScreenshot('enhance-dialog-pixel-art.png', {
    maxDiffPixels: RASTER_DRIFT_BUDGET,
  });
});

test('does not offer the anime model before its provenance and quality gates pass', async ({
  page,
}, testInfo) => {
  await importTestImage(page);
  await openDialog(page);

  await page.getByRole('combobox', { name: 'Enhancement operation' }).click();
  await page.getByRole('option', { name: 'Upscale', exact: true }).click();
  const modeSelect = page.getByRole('combobox', { name: 'Upscale quality' });
  await modeSelect.click();

  const animeOption = page.getByRole('option', {
    name: /Illustration & anime \(not available yet\)/,
  });
  await expect(animeOption).toBeDisabled();
  await expect(page.getByText(/320×320 tile used 1\.459 GB peak RSS/i)).toBeVisible();
  await expect(page.getByText(/conversion provenance.*artist-quality corpus/i)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('anime-model-unavailable.png') });
});

test('preview crop and zoom controls update the comparison view', async ({ page }) => {
  await importTestImage(page);
  await openDialog(page);

  const viewGroup = page.getByRole('radiogroup', { name: 'Preview view' });
  const zoomGroup = page.getByRole('radiogroup', { name: 'Preview zoom' });

  // After and Compare stay selectable while their pixels are pending, so the
  // "no processed preview" notice stays reachable instead of being hidden
  // behind a disabled control. Only a missing source image disables Before.
  // The pending/failed copy itself is covered by the panel unit tests, since
  // the CPU preview lands too fast to assert here reliably.
  await expect(viewGroup.getByRole('radio', { name: 'After' })).toBeEnabled();
  await expect(viewGroup.getByRole('radio', { name: 'Compare' })).toBeEnabled();
  await expect(viewGroup.getByRole('radio', { name: 'Before' })).toBeChecked();

  // Fit is the default zoom.
  await expect(zoomGroup.getByRole('radio', { name: 'Fit' })).toBeChecked();

  const regionSelect = page.getByRole('combobox', { name: 'Inspect region' });
  await regionSelect.click();
  await page.getByRole('option', { name: 'Top left' }).click();
  // The 16x16 icon fits the whole preview budget, so the caption says the
  // region choice is doing nothing rather than inventing a crop size.
  await expect(page.getByText(/^Whole image · 16 x 16 px$/)).toBeVisible();

  // The 3x3 picker regenerates the preview crop; wait for the new Before side.
  await expect
    .poll(async () => {
      return page
        .locator('.upscale-preview__image--original')
        .evaluate((image) => (image as HTMLImageElement).naturalWidth);
    })
    .toBeGreaterThan(0);

  // Wait for the real processed preview before comparing and inspecting pixels.
  await waitForSettledPreview(page);

  await expect(viewGroup.getByRole('radio', { name: 'After' })).toBeEnabled();
  await viewGroup.getByRole('radio', { name: 'Compare' }).click();

  const slider = page.getByRole('slider', { name: 'Before / after comparison' });
  await slider.focus();
  await expect(slider).toHaveAttribute('aria-valuenow', '50');
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', '52');
  await page.keyboard.press('Home');
  await expect(slider).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('.upscale-preview__slider-handle')).toHaveClass(/--start/);

  const previewBounds = await page.locator('.upscale-preview__image-container').boundingBox();
  if (!previewBounds) throw new Error('preview bounds not found');
  await page.mouse.move(previewBounds.x + previewBounds.width * 0.2, previewBounds.y + 20);
  await page.mouse.down();
  await page.mouse.move(previewBounds.x + previewBounds.width * 0.8, previewBounds.y + 20);
  await page.mouse.up();
  await expect(slider).toHaveAttribute('aria-valuenow', /^(7[5-9]|8[0-5])$/);

  // The divider must sit exactly on the clip boundary it reveals: the image
  // left of the split stays original, the image right of it stays processed.
  // This is the regression guard for the inset/position mismatch.
  const alignment = await page.evaluate(() => {
    const overlay = document.querySelector('.upscale-preview__overlay') as HTMLElement;
    const line = document.querySelector('.upscale-preview__slider-line') as HTMLElement;
    const container = document.querySelector('.upscale-preview__image-container') as HTMLElement;
    const containerWidth = container.getBoundingClientRect().width;
    const linePct =
      (Number.parseFloat(getComputedStyle(line).left.replace('px', '')) / containerWidth) * 100;

    // The overlay is clipped with `inset(0 0 0 N%)`; the fourth box edge is
    // the left inset, i.e. the boundary the divider is supposed to sit on.
    const clip = getComputedStyle(overlay).clipPath;
    const edges = clip
      .slice(clip.indexOf('(') + 1, clip.lastIndexOf(')'))
      .trim()
      .split(/\s+/);
    const leftEdge = edges.length >= 4 ? (edges[3] ?? '0') : '0';
    const leftValue = Number.parseFloat(leftEdge);
    const clipPct = leftEdge.endsWith('%') ? leftValue : (leftValue / containerWidth) * 100;

    return { linePct, clipPct };
  });
  const sliderValue = Number(await slider.getAttribute('aria-valuenow'));
  expect(Math.abs(alignment.linePct - sliderValue)).toBeLessThan(1);
  expect(Math.abs(alignment.clipPct - sliderValue)).toBeLessThan(1);

  await slider.focus();
  await page.keyboard.press('End');
  await expect(slider).toHaveAttribute('aria-valuenow', '100');
  await expect(page.locator('.upscale-preview__slider-handle')).toHaveClass(/--end/);

  const previewContainer = page.locator('.upscale-preview__image-container');
  await zoomGroup.getByRole('radio', { name: '100%' }).click();
  await expect(previewContainer).toHaveClass(/upscale-preview__image-container--zoomed/);
  const pixelView = await previewContainer.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const images = Array.from(element.querySelectorAll('img')) as HTMLImageElement[];
    return {
      surface: { width: rect.width, height: rect.height },
      natural: images.map(({ naturalWidth, naturalHeight }) => ({ naturalWidth, naturalHeight })),
    };
  });
  expect(pixelView.surface.width).toBe(pixelView.natural[1]?.naturalWidth);
  expect(pixelView.surface.height).toBe(pixelView.natural[1]?.naturalHeight);

  // Center is enabled while zoomed and recentres the panned stage.
  const centerButton = page.getByRole('button', { name: 'Center', exact: true });
  await expect(centerButton).toBeEnabled();
  await centerButton.click();

  await zoomGroup.getByRole('radio', { name: 'Fit' }).click();
  await expect(previewContainer).not.toHaveClass(/upscale-preview__image-container--zoomed/);
  await expect(centerButton).toBeDisabled();
});

test('Enhance dialog reflows to a usable narrow layout', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 800 });
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));
  await expect(page.getByRole('button', { name: 'Enhance', exact: true })).toBeVisible({
    timeout: 10000,
  });
  await openDialog(page);

  const dialog = page.getByRole('dialog', { name: 'Enhance image' });
  const body = dialog.locator('.upscale-dialog__body');
  const layout = await body.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return { columns: style.gridTemplateColumns, width: rect.width };
  });

  expect(layout.columns.split(' ').length).toBe(1);
  expect(layout.width).toBeLessThanOrEqual(640);
  await expect(dialog.locator('.upscale-preview__image-container')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Apply recommended' })).toBeVisible();
});

test('preview keeps a portrait source aspect and reports its inspect region', async ({ page }) => {
  await importGeneratedImage(page, 476, 848);
  await openDialog(page);

  // Pin a CPU-only operation. A smooth gradient analyses as "heavy blur", so
  // Auto picks Deblur + Upscale, which is honest but makes the preview wait on
  // a model that is not installed — the thing under test here is the crop and
  // the stage geometry, not model availability.
  await page.getByRole('combobox', { name: 'Enhancement operation' }).click();
  await page.getByRole('option', { name: 'Upscale', exact: true }).click();
  await waitForSettledPreview(page);

  // The dialog states the output it is promising; that ratio is what the stage
  // has to reproduce, whatever scale the auto analysis chose.
  const hint = await page.locator('.upscale-preview__hint').innerText();
  const output = hint.match(/Output:\s*(\d+)x(\d+)/i);
  expect(output, `hint read: ${hint}`).not.toBeNull();
  const outputAspect = Number(output?.[1]) / Number(output?.[2]);

  const box = await page.locator('.upscale-preview__image-container').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  const stageAspect = box.width / box.height;
  expect(
    Math.abs(stageAspect - outputAspect),
    `stage ${Math.round(box.width)}x${Math.round(box.height)} (ratio ${stageAspect.toFixed(3)}) vs output ratio ${outputAspect.toFixed(3)}`,
  ).toBeLessThan(0.02);

  // The inspect caption names the region and the source pixels it covers. The
  // regression this guards: width and height used to be clamped to the preview
  // budget independently, so any oversized source previewed as a square crop
  // that matched neither the source nor the output.
  const caption = page.getByText(/^Center · \d+ x \d+ px of 476 x 848 px$/);
  await expect(caption).toBeVisible();
  const region = (await caption.innerText()).match(/^Center · (\d+) x (\d+) px/);
  expect(region).not.toBeNull();
  const regionAspect = Number(region?.[1]) / Number(region?.[2]);
  expect(
    Math.abs(regionAspect - 476 / 848),
    `region ${region?.[1]}x${region?.[2]} (ratio ${regionAspect.toFixed(3)}) vs source ratio ${(476 / 848).toFixed(3)}`,
  ).toBeLessThan(0.02);

  await page.getByRole('combobox', { name: 'Inspect region' }).click();
  await page.getByRole('option', { name: 'Top left' }).click();
  await expect(page.getByText(/^Top left · \d+ x \d+ px of 476 x 848 px$/)).toBeVisible();

  // The dialog is a fixed workbench: the body must not scroll independently of
  // the settings column, or controls are cut off at both ends.
  const scroll = await page
    .getByRole('dialog', { name: 'Enhance image' })
    .locator('.upscale-dialog__body')
    .evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }));
  expect(scroll.scrollHeight).toBeLessThanOrEqual(scroll.clientHeight + 1);
});
