import { expect, test } from '@playwright/test';
import { navigateToCleanEditor } from '../helpers/nav';

test.use({ viewport: { width: 1440, height: 1000 } });

/** Graphite #2445: pointer-up must not replace the selected stop with the end. */
test('start and middle gradient stops stay selected after clicks and drags', async ({ page }) => {
  await navigateToCleanEditor(page);
  await page.locator('#file-import-input').setInputFiles({
    name: 'three-stops.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg><defs><linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset=".5" stop-color="lime"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect width="240" height="160" fill="url(#g)"/></svg>',
    ),
  });
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 30000 });
  const report = page.getByRole('dialog', { name: 'Import Results', exact: true });
  await expect(report).toBeVisible();
  await report.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Fill gradient', exact: true }).click();
  const bar = page.getByRole('slider', { name: /Gradient stop bar/ });
  const start = bar.getByRole('button', { name: /^Stop 1 at/ });
  const middle = bar.getByRole('button', { name: /^Stop 2 at/ });
  const end = bar.getByRole('button', { name: /^Stop 3 at/ });

  await end.click();
  await expect(end).toHaveAttribute('aria-pressed', 'true');
  await start.click();
  await expect(start).toHaveAttribute('aria-pressed', 'true');
  await expect(end).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('spinbutton', { name: 'Stop 1 position', exact: true })).toHaveValue(
    '0',
  );

  await middle.click();
  await expect(middle).toHaveAttribute('aria-pressed', 'true');
  const box = await bar.boundingBox();
  const stop = await middle.boundingBox();
  if (!box || !stop) throw new Error('Gradient stop bar has no layout');
  await page.mouse.move(stop.x + stop.width / 2, stop.y + stop.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, stop.y + stop.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(middle).toHaveAttribute('aria-pressed', 'true');
  await expect(end).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('spinbutton', { name: 'Stop 2 position', exact: true })).toHaveValue(
    '65',
  );
  await expect(start).toHaveAccessibleName(/at 0%/);
  await expect(end).toHaveAccessibleName(/at 100%/);
  await page.screenshot({ path: test.info().outputPath('middle-stop-selected.png') });
});
