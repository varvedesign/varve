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
    page.getByText(/Inkscape live path effects keep their visible SVG path geometry/i),
  ).toBeVisible();
  await expect(
    page.getByText(/PDF import is a partial artwork extraction path.*not an in-place PDF editor/i),
  ).toBeVisible();
  await expect(
    page.getByText(
      /does not reconstruct PDF pages, images, annotations, AcroForm fields, or signatures/i,
    ),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('file-formats-local-actions.png'),
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
