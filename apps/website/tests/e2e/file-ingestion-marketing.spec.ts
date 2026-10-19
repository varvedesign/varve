import { expect, test } from '@playwright/test';

test('file formats documentation explains local file actions', async ({ page }) => {
  await page.goto('/docs/file-formats/');
  await expect(
    page.getByRole('heading', { name: /open, import, place, and install/i }),
  ).toBeVisible();
  await expect(
    page.getByText(/upload.*reserved for an explicit, consented remote service/i),
  ).toBeVisible();
  await expect(page.getByText(/duplicate names are allowed/i)).toBeVisible();
  await expect(
    page.getByText(
      /Inkscape 0\.91 or earlier.*older 90-dpi scale.*check the artwork's physical size/i,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Inkscape SVG 1\.2 flowed text.*shape-inside.*symbol.*referenced through.*use.*layout or instance geometry is not imported/i,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(/stroke dash patterns and offsets.*unitless, px, pt, mm, cm, or in/i),
  ).toBeVisible();
  await expect(
    page.getByText(/references to other SVG files are reported and not fetched/i),
  ).toBeVisible();
  await expect(page.getByText(/CSS rules in SVG.*style.*elements are not applied/i)).toBeVisible();
  await expect(
    page.getByText(
      /PDF import currently extracts text and plain axis-aligned rectangle fills.*Gradients, curved paths, strokes, images/i,
    ),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('file-formats-local-actions.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const overflowsHorizontally = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflowsHorizontally).toBe(false);
  await page.screenshot({
    path: test.info().outputPath('file-formats-local-actions-mobile.png'),
    fullPage: true,
  });
});

test('image conversion documentation explains bounded local workflow', async ({ page }) => {
  await page.goto('/docs/tools/image-conversion/');
  await expect(page.getByRole('heading', { name: /image conversion/i })).toBeVisible();
  await expect(page.getByText(/quick convert/i).first()).toBeVisible();
  await expect(page.getByText(/512 MiB/i)).toBeVisible();
  await expect(page.getByText(/TIFF uses the first IFD and is flattened/i)).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('image-conversion-local-workflow.png'),
    fullPage: true,
  });
});

test('touch guide explains optional rotation and stays usable on mobile', async ({ page }) => {
  await page.goto('/docs/touch-and-pen?test-motion=static');
  await expect(
    page.getByRole('heading', { name: 'Touch, pen, keyboard, and trackpad', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: /Two-finger twist is off by default.*Enable it in Settings/ }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('touch-guide-optional-rotation.png'),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole('cell', { name: /Two-finger twist is off by default/ }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: test.info().outputPath('touch-guide-optional-rotation-mobile.png'),
    fullPage: true,
  });
});
