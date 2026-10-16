import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { selectInspectorTab } from '../helpers/inspector-tabs';
import { dragOnCanvas, navigateToEditor } from '../shared';

const requireFromEngine = createRequire(resolve('packages/engine/package.json'));
const { PNG } = requireFromEngine('pngjs') as {
  PNG: { sync: { read(input: Buffer): { width: number; height: number; data: Buffer } } };
};

/**
 * Pins the transparent-background export contract on the node raster path:
 * an ellipse export carries real alpha (0 in the empty corners of its
 * bounding box, 255 in the ink), not an implicit white or black matte. This
 * is the "transparent export silently becomes opaque" failure class reported
 * against comparable editors.
 */
test.describe('PNG export alpha', () => {
  test('default PNG export keeps transparent background and opaque artwork', async ({ page }) => {
    await navigateToEditor(page);

    // An ellipse's bounding box has empty corners, so the exported raster
    // must show transparent corners around opaque ink.
    await page.keyboard.press('o');
    await dragOnCanvas(page, 120, 120, 420, 380);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await selectInspectorTab(page, 'Export');
    await page
      .locator('.spec-export__group')
      .getByRole('radio', { name: 'PNG', exact: true })
      .click();

    const outDir = join(tmpdir(), `varve-png-alpha-${Date.now()}`);
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, 'alpha-check.png');
    try {
      const downloadPromise = page.waitForEvent('download', { timeout: 20000 });
      await page.getByRole('button', { name: /download/i }).click();
      const download = await downloadPromise;
      await download.saveAs(outPath);

      const image = PNG.sync.read(readFileSync(outPath));
      expect(image.width).toBeGreaterThan(0);
      expect(image.height).toBeGreaterThan(0);

      const alphaAt = (x: number, y: number): number =>
        image.data[(y * image.width + x) * 4 + 3] ?? -1;

      // Bounding-box corners are empty canvas: fully transparent, not matted.
      expect(alphaAt(0, 0)).toBe(0);
      expect(alphaAt(image.width - 1, 0)).toBe(0);
      expect(alphaAt(0, image.height - 1)).toBe(0);
      expect(alphaAt(image.width - 1, image.height - 1)).toBe(0);

      // The ellipse interior is opaque artwork.
      expect(alphaAt(Math.floor(image.width / 2), Math.floor(image.height / 2))).toBe(255);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
