import { expect, test } from '@playwright/test';

test.describe('known issues', () => {
  test('reviews against 0.5.1 and documents the Linux AppImage host libraries', async ({
    page,
  }) => {
    await page.goto('/support/known-issues');

    await expect(page.getByRole('heading', { name: 'Known Issues & Limitations', level: 1 })).toBeVisible();
    await expect(page.locator('.known-issues-review')).toContainText(
      'Reviewed 21 October 2026 against the v0.5.1 source tag',
    );
    await expect(page.getByRole('heading', { name: 'Platform & packaging', level: 2 })).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: 'Linux AppImage for 0.5.1 can fail to start without WebKitGTK 4.1 or FUSE 2',
      }),
    ).toBeVisible();
    await expect(page.getByText(/libwebkit2gtk-4.1/)).toBeVisible();
    await expect(page.getByText(/libfuse2/)).toBeVisible();
    await expect(
      page.getByText(/A fix that bundles WebKitGTK is on the main branch and will ship in a future release/),
    ).toBeVisible();
    await expect(
      page.getByText(/Install WebKitGTK 4.1 and FUSE 2 from your distribution, or use the \.deb or \.rpm package instead/),
    ).toBeVisible();
  });
});
